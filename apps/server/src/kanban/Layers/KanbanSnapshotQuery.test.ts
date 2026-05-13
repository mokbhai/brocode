import {
  CommandId,
  KanbanBoardId,
  KanbanCardId,
  KanbanTaskId,
  ProjectId,
  type KanbanCommand,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { KanbanLayerLive } from "../runtimeLayer.ts";
import { KanbanEngineService } from "../Services/KanbanEngine.ts";
import { KanbanSnapshotQuery } from "../Services/KanbanSnapshotQuery.ts";

const projectId = ProjectId.makeUnsafe("project-kanban-snapshot");
const boardId = KanbanBoardId.makeUnsafe("board-kanban-snapshot");
const cardId = KanbanCardId.makeUnsafe("card-kanban-snapshot");
const taskId = KanbanTaskId.makeUnsafe("task-kanban-snapshot");

async function createKanbanSystem() {
  const runtime = ManagedRuntime.make(
    KanbanLayerLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  );
  const engine = await runtime.runPromise(Effect.service(KanbanEngineService));
  const snapshotQuery = await runtime.runPromise(
    Effect.gen(function* () {
      return yield* KanbanSnapshotQuery;
    }),
  );
  return {
    engine,
    snapshotQuery,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

function boardCreate(createdAt: string): KanbanCommand {
  return {
    type: "kanban.board.create",
    commandId: CommandId.makeUnsafe("cmd-kanban-snapshot-board"),
    boardId,
    projectId,
    title: "Snapshot Board",
    createdAt,
  };
}

function cardCreate(createdAt: string): KanbanCommand {
  return {
    type: "kanban.card.create",
    commandId: CommandId.makeUnsafe("cmd-kanban-snapshot-card"),
    boardId,
    cardId,
    projectId,
    sourceThreadId: null,
    title: "Snapshot Card",
    description: "Snapshot description",
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    runtimeMode: "approval-required",
    createdAt,
  };
}

function taskUpsert(updatedAt: string): KanbanCommand {
  return {
    type: "kanban.task.upsert",
    commandId: CommandId.makeUnsafe("cmd-kanban-snapshot-task"),
    cardId,
    task: {
      taskId,
      title: "Snapshot task",
      description: "Task description",
      status: "todo",
      order: 0,
    },
    updatedAt,
  };
}

describe("KanbanSnapshotQuery", () => {
  it("hydrates a board snapshot from durable projection tables", async () => {
    const system = await createKanbanSystem();
    const createdAt = "2026-05-12T00:09:00.000Z";

    await system.run(system.engine.dispatch(boardCreate(createdAt)));
    await system.run(system.engine.dispatch(cardCreate(createdAt)));
    const result = await system.run(system.engine.dispatch(taskUpsert(createdAt)));

    const snapshot = await system.run(system.snapshotQuery.getSnapshot({ boardId }));

    expect(snapshot.snapshotSequence).toBe(result.sequence);
    expect(snapshot.board).toMatchObject({
      id: boardId,
      projectId,
      title: "Snapshot Board",
    });
    expect(snapshot.cards).toHaveLength(1);
    expect(snapshot.cards[0]).toMatchObject({
      id: cardId,
      boardId,
      title: "Snapshot Card",
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
    });
    expect(snapshot.tasksByCardId[cardId]).toEqual([
      expect.objectContaining({
        id: taskId,
        cardId,
        title: "Snapshot task",
        order: 0,
      }),
    ]);
    expect(snapshot.runsByCardId[cardId] ?? []).toEqual([]);
    expect(snapshot.reviewsByCardId[cardId] ?? []).toEqual([]);

    await system.dispose();
  });

  it("fails when the board is absent", async () => {
    const system = await createKanbanSystem();

    const exit = await system.run(
      Effect.exit(
        system.snapshotQuery.getSnapshot({
          boardId: KanbanBoardId.makeUnsafe("missing-kanban-board"),
        }),
      ),
    );

    expect(exit._tag).toBe("Failure");

    await system.dispose();
  });
});
