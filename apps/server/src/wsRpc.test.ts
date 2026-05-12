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
import { describe, expect, it } from "vitest";

import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import { makeKanbanWsHandlers } from "./wsRpc.ts";
import { KanbanEngineLive } from "./kanban/Layers/KanbanEngine.ts";
import { KanbanEventStoreLive } from "./kanban/Layers/KanbanEventStore.ts";
import { KanbanProjectionPipelineLive } from "./kanban/Layers/KanbanProjectionPipeline.ts";
import { KanbanSnapshotQueryLive } from "./kanban/Layers/KanbanSnapshotQuery.ts";
import { KanbanEngineService } from "./kanban/Services/KanbanEngine.ts";
import { KanbanSnapshotQuery } from "./kanban/Services/KanbanSnapshotQuery.ts";

const projectId = ProjectId.makeUnsafe("project-kanban-ws");
const boardId = KanbanBoardId.makeUnsafe("board-kanban-ws");
const otherBoardId = KanbanBoardId.makeUnsafe("board-kanban-ws-other");
const cardId = KanbanCardId.makeUnsafe("card-kanban-ws");
const taskId = KanbanTaskId.makeUnsafe("task-kanban-ws");

function boardCreate(commandId: string, targetBoardId = boardId): KanbanCommand {
  return {
    type: "kanban.board.create",
    commandId: CommandId.makeUnsafe(commandId),
    boardId: targetBoardId,
    projectId,
    title: targetBoardId === boardId ? "Kanban WS Board" : "Other Kanban WS Board",
    createdAt: "2026-05-12T00:20:00.000Z",
  };
}

function cardCreate(commandId: string): KanbanCommand {
  return {
    type: "kanban.card.create",
    commandId: CommandId.makeUnsafe(commandId),
    boardId,
    cardId,
    projectId,
    sourceThreadId: null,
    title: "Kanban WS Card",
    specPath: "docs/kanban-ws.md",
    tasks: [
      {
        taskId,
        title: "Route this task",
        status: "todo",
        order: 0,
      },
    ],
    modelSelection: { provider: "codex", model: "gpt-5-codex" },
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: null,
    associatedWorktreePath: null,
    associatedWorktreeBranch: null,
    associatedWorktreeRef: null,
    createdAt: "2026-05-12T00:21:00.000Z",
  };
}

async function createKanbanRpcSystem() {
  const projectionLayer = KanbanProjectionPipelineLive.pipe(Layer.provide(KanbanEventStoreLive));
  const kanbanLayer = KanbanEngineLive.pipe(
    Layer.provide(Layer.mergeAll(KanbanEventStoreLive, projectionLayer)),
  );
  const layer = Layer.mergeAll(kanbanLayer, KanbanSnapshotQueryLive).pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
  );
  const runtime = ManagedRuntime.make(layer);
  const engine = await runtime.runPromise(Effect.service(KanbanEngineService));
  const snapshotQuery = await runtime.runPromise(
    Effect.gen(function* () {
      return yield* KanbanSnapshotQuery;
    }),
  );
  return {
    handlers: makeKanbanWsHandlers({ kanbanEngine: engine, kanbanSnapshotQuery: snapshotQuery }),
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

describe("Kanban WebSocket RPC handlers", () => {
  it("dispatches commands, reads snapshots, and streams board history plus hot events", async () => {
    const system = await createKanbanRpcSystem();

    await system.run(system.handlers["kanban.dispatchCommand"](boardCreate("cmd-kanban-ws-board")));
    await system.run(
      system.handlers["kanban.dispatchCommand"](boardCreate("cmd-kanban-ws-other", otherBoardId)),
    );
    await system.run(system.handlers["kanban.dispatchCommand"](cardCreate("cmd-kanban-ws-card")));

    const snapshot = await system.run(system.handlers["kanban.getSnapshot"]({ boardId }));
    expect(snapshot.board.id).toBe(boardId);
    expect(snapshot.cards.map((card) => card.id)).toEqual([cardId]);
    expect(snapshot.tasksByCardId[cardId]?.map((task) => task.id)).toEqual([taskId]);

    const streamedTypes: string[] = [];
    await system.run(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<KanbanEvent>();
        yield* Effect.forkScoped(
          Stream.take(system.handlers["kanban.subscribeBoard"]({ boardId }), 3).pipe(
            Stream.runForEach((event) => Queue.offer(queue, event).pipe(Effect.asVoid)),
          ),
        );

        streamedTypes.push((yield* Queue.take(queue)).type);
        streamedTypes.push((yield* Queue.take(queue)).type);
        yield* system.handlers["kanban.dispatchCommand"]({
          type: "kanban.card.status.set",
          commandId: CommandId.makeUnsafe("cmd-kanban-ws-status"),
          cardId,
          status: "ready",
          reason: null,
          updatedAt: "2026-05-12T00:22:00.000Z",
        });
        streamedTypes.push((yield* Queue.take(queue)).type);
      }).pipe(Effect.scoped),
    );

    expect(streamedTypes).toEqual([
      "kanban.board.created",
      "kanban.card.created",
      "kanban.card.status-changed",
    ]);
    await system.run(system.handlers["kanban.unsubscribeBoard"]({ boardId }));

    await system.dispose();
  });
});
