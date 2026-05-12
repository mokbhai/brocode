import {
  CommandId,
  KanbanBoardId,
  KanbanCardId,
  KanbanTaskId,
  ProjectId,
  type KanbanCommand,
  type KanbanEvent,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime, Queue, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { KanbanEngineLive } from "./KanbanEngine.ts";
import { KanbanEventStoreLive } from "./KanbanEventStore.ts";
import { KanbanProjectionPipelineLive } from "./KanbanProjectionPipeline.ts";
import { KanbanEngineService } from "../Services/KanbanEngine.ts";

const projectId = ProjectId.makeUnsafe("project-kanban-engine");
const boardId = KanbanBoardId.makeUnsafe("board-kanban-engine");
const cardId = KanbanCardId.makeUnsafe("card-kanban-engine");
const taskId = KanbanTaskId.makeUnsafe("task-kanban-engine");

async function createKanbanSystem() {
  const projectionLayer = KanbanProjectionPipelineLive.pipe(Layer.provide(KanbanEventStoreLive));
  const kanbanLayer = KanbanEngineLive.pipe(
    Layer.provide(Layer.mergeAll(KanbanEventStoreLive, projectionLayer)),
  );
  const layer = kanbanLayer.pipe(Layer.provideMerge(SqlitePersistenceMemory));
  const runtime = ManagedRuntime.make(layer);
  const engine = await runtime.runPromise(Effect.service(KanbanEngineService));
  const sql = await runtime.runPromise(Effect.service(SqlClient.SqlClient));
  return {
    engine,
    sql,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

function boardCreate(commandId: string, createdAt: string): KanbanCommand {
  return {
    type: "kanban.board.create",
    commandId: CommandId.makeUnsafe(commandId),
    boardId,
    projectId,
    title: "Engine Board",
    createdAt,
  };
}

function cardCreate(commandId: string, createdAt: string): KanbanCommand {
  return {
    type: "kanban.card.create",
    commandId: CommandId.makeUnsafe(commandId),
    boardId,
    cardId,
    projectId,
    sourceThreadId: null,
    title: "Engine Card",
    description: "Card created by the engine test",
    specPath: "docs/spec.md",
    tasks: [
      {
        taskId,
        title: "First task",
        status: "todo",
        order: 0,
      },
    ],
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: null,
    associatedWorktreePath: null,
    associatedWorktreeBranch: null,
    associatedWorktreeRef: null,
    createdAt,
  };
}

describe("KanbanEngine", () => {
  it("serializes dispatches, updates the read model, replays events, and publishes hot events", async () => {
    const system = await createKanbanSystem();
    const createdAt = "2026-05-12T00:00:00.000Z";
    const eventTypes: string[] = [];

    await system.run(
      Effect.gen(function* () {
        const eventQueue = yield* Queue.unbounded<KanbanEvent>();
        yield* Effect.forkScoped(
          Stream.take(system.engine.streamDomainEvents, 2).pipe(
            Stream.runForEach((event) => Queue.offer(eventQueue, event).pipe(Effect.asVoid)),
          ),
        );
        yield* Effect.sleep("10 millis");

        const [boardResult, cardResult] = yield* Effect.all(
          [
            system.engine.dispatch(boardCreate("cmd-kanban-board-create", createdAt)),
            system.engine.dispatch(cardCreate("cmd-kanban-card-create", createdAt)),
          ],
          { concurrency: "unbounded" },
        );

        expect(boardResult.sequence).toBe(1);
        expect(cardResult.sequence).toBe(2);
        eventTypes.push((yield* Queue.take(eventQueue)).type);
        eventTypes.push((yield* Queue.take(eventQueue)).type);
      }).pipe(Effect.scoped),
    );

    expect(eventTypes).toEqual(["kanban.board.created", "kanban.card.created"]);

    const readModel = await system.run(system.engine.getReadModel());
    expect(readModel.snapshotSequence).toBe(2);
    expect(readModel.boards.map((board) => board.id)).toEqual([boardId]);
    expect(readModel.cards.map((card) => card.id)).toEqual([cardId]);
    expect(readModel.tasks.map((task) => task.id)).toEqual([taskId]);

    const replayed = await system.run(
      Stream.runCollect(system.engine.readEvents(0)).pipe(
        Effect.map((chunk): KanbanEvent[] => Array.from(chunk)),
      ),
    );
    expect(replayed.map((event) => event.type)).toEqual([
      "kanban.board.created",
      "kanban.card.created",
    ]);

    await system.dispose();
  });

  it("stores Kanban events and receipts without polluting orchestration tables", async () => {
    const system = await createKanbanSystem();
    const createdAt = "2026-05-12T00:04:00.000Z";

    await system.run(
      system.engine.dispatch(boardCreate("cmd-kanban-storage-isolation-board", createdAt)),
    );

    const kanbanEvents = await system.run(
      system.sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM kanban_events`,
    );
    const orchestrationEvents = await system.run(
      system.sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM orchestration_events`,
    );
    const kanbanReceipts = await system.run(
      system.sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM kanban_command_receipts`,
    );
    const orchestrationReceipts = await system.run(
      system.sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM orchestration_command_receipts
      `,
    );

    expect(kanbanEvents).toEqual([{ count: 1 }]);
    expect(orchestrationEvents).toEqual([{ count: 0 }]);
    expect(kanbanReceipts).toEqual([{ count: 1 }]);
    expect(orchestrationReceipts).toEqual([{ count: 0 }]);

    await system.dispose();
  });

  it("projects accepted dispatch events into durable Kanban tables before completing", async () => {
    const system = await createKanbanSystem();
    const createdAt = "2026-05-12T00:07:00.000Z";

    await system.run(
      system.engine.dispatch(boardCreate("cmd-kanban-dispatch-projects-board", createdAt)),
    );

    const boards = await system.run(
      system.sql<{ readonly boardId: string; readonly title: string }>`
        SELECT board_id AS "boardId", title
        FROM projection_kanban_boards
      `,
    );

    expect(boards).toEqual([{ boardId, title: "Engine Board" }]);

    await system.dispose();
  });

  it("repairs projection gaps before returning an accepted duplicate command", async () => {
    const system = await createKanbanSystem();
    const createdAt = "2026-05-12T00:08:00.000Z";
    const command = boardCreate("cmd-kanban-duplicate-repairs-projection", createdAt);

    const accepted = await system.run(system.engine.dispatch(command));
    await system.run(system.sql`DELETE FROM projection_kanban_boards`);
    await system.run(system.sql`DELETE FROM projection_kanban_state`);

    const duplicate = await system.run(system.engine.dispatch(command));
    expect(duplicate).toEqual(accepted);

    const boards = await system.run(
      system.sql<{ readonly boardId: string; readonly title: string }>`
        SELECT board_id AS "boardId", title
        FROM projection_kanban_boards
      `,
    );
    expect(boards).toEqual([{ boardId, title: "Engine Board" }]);

    await system.dispose();
  });

  it("returns the accepted sequence for duplicate command ids and rejects previously rejected ids", async () => {
    const system = await createKanbanSystem();
    const createdAt = "2026-05-12T00:01:00.000Z";

    const accepted = await system.run(
      system.engine.dispatch(boardCreate("cmd-kanban-duplicate-accepted", createdAt)),
    );
    const duplicate = await system.run(
      system.engine.dispatch(boardCreate("cmd-kanban-duplicate-accepted", createdAt)),
    );
    expect(duplicate).toEqual(accepted);
    await system.dispose();

    const rejectedSystem = await createKanbanSystem();
    const rejectedExit = await rejectedSystem.run(
      Effect.exit(rejectedSystem.engine.dispatch(cardCreate("cmd-kanban-rejected", createdAt))),
    );
    expect(rejectedExit._tag).toBe("Failure");

    const repeatedRejectedExit = await rejectedSystem.run(
      Effect.exit(rejectedSystem.engine.dispatch(boardCreate("cmd-kanban-rejected", createdAt))),
    );
    expect(repeatedRejectedExit._tag).toBe("Failure");

    await rejectedSystem.dispose();
  });
});
