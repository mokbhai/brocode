import {
  AutomationId,
  CommandId,
  KanbanBoardId,
  KanbanCardId,
  KanbanRunId,
  ProjectId,
  ThreadId,
  type AutomationCommand,
  type AutomationEvent,
  type KanbanCommand,
  type KanbanEvent,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime, Queue, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import { makeAutomationWsHandlers, makeKanbanWsHandlers } from "./wsRpc.ts";
import { AutomationEngineLive } from "./automation/Layers/AutomationEngine.ts";
import { AutomationEventStoreLive } from "./automation/Layers/AutomationEventStore.ts";
import { AutomationProjectionPipelineLive } from "./automation/Layers/AutomationProjectionPipeline.ts";
import { AutomationSnapshotQueryLive } from "./automation/Layers/AutomationSnapshotQuery.ts";
import { AutomationEngineService } from "./automation/Services/AutomationEngine.ts";
import { AutomationSnapshotQuery } from "./automation/Services/AutomationSnapshotQuery.ts";
import { KanbanEngineLive } from "./kanban/Layers/KanbanEngine.ts";
import { KanbanEventStoreLive } from "./kanban/Layers/KanbanEventStore.ts";
import { KanbanProjectionPipelineLive } from "./kanban/Layers/KanbanProjectionPipeline.ts";
import { KanbanSnapshotQueryLive } from "./kanban/Layers/KanbanSnapshotQuery.ts";
import { KanbanEngineService } from "./kanban/Services/KanbanEngine.ts";
import { KanbanSnapshotQuery } from "./kanban/Services/KanbanSnapshotQuery.ts";
import type { KanbanWorkerCoordinatorShape } from "./kanban/Services/KanbanWorkerCoordinator.ts";

const projectId = ProjectId.makeUnsafe("project-kanban-ws");
const boardId = KanbanBoardId.makeUnsafe("board-kanban-ws");
const otherBoardId = KanbanBoardId.makeUnsafe("board-kanban-ws-other");
const cardId = KanbanCardId.makeUnsafe("card-kanban-ws");
const automationProjectId = ProjectId.makeUnsafe("project-automation-ws");
const automationId = AutomationId.makeUnsafe("automation-ws");

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
    modelSelection: { provider: "codex", model: "gpt-5-codex" },
    runtimeMode: "approval-required",
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
  const workerCoordinator: KanbanWorkerCoordinatorShape = {
    start: () => Effect.never,
    startWorkerRun: () =>
      Effect.succeed({
        runId: KanbanRunId.makeUnsafe("run-kanban-ws-worker"),
        threadId: ThreadId.makeUnsafe("thread-kanban-ws-worker"),
      }),
  };
  return {
    handlers: makeKanbanWsHandlers({
      kanbanEngine: engine,
      kanbanSnapshotQuery: snapshotQuery,
      kanbanWorkerCoordinator: workerCoordinator,
    }),
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

function automationCreate(commandId: string, createdAt: string): AutomationCommand {
  return {
    type: "automation.create",
    commandId: CommandId.makeUnsafe(commandId),
    automationId,
    title: "Automation WS digest",
    prompt: "Summarize project activity.",
    target: { type: "project", projectId: automationProjectId },
    schedule: { kind: "daily", hour: 9, minute: 0 },
    timezone: "Asia/Kolkata",
    environmentMode: "local",
    modelSelection: { provider: "codex", model: "gpt-5.2" },
    runtimeMode: "full-access",
    writesEnabled: true,
    allowDirtyLocalCheckout: false,
    nextRunAt: createdAt,
    createdAt,
  };
}

async function createAutomationRpcSystem() {
  const projectionLayer = AutomationProjectionPipelineLive.pipe(
    Layer.provide(AutomationEventStoreLive),
  );
  const automationLayer = AutomationEngineLive.pipe(
    Layer.provide(Layer.mergeAll(AutomationEventStoreLive, projectionLayer)),
  );
  const layer = Layer.mergeAll(automationLayer, AutomationSnapshotQueryLive).pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
  );
  const runtime = ManagedRuntime.make(layer);
  const engine = await runtime.runPromise(Effect.service(AutomationEngineService));
  const snapshotQuery = await runtime.runPromise(
    Effect.gen(function* () {
      return yield* AutomationSnapshotQuery;
    }),
  );
  return {
    handlers: makeAutomationWsHandlers({
      automationEngine: engine,
      automationSnapshotQuery: snapshotQuery,
    }),
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
    expect(snapshot.tasksByCardId[cardId] ?? []).toEqual([]);

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

  it("streams board history beyond the event store default page size", async () => {
    const system = await createKanbanRpcSystem();

    await system.run(
      system.handlers["kanban.dispatchCommand"](boardCreate("cmd-kanban-ws-deep-board")),
    );
    for (let index = 0; index < 1_001; index += 1) {
      await system.run(
        system.handlers["kanban.dispatchCommand"](
          boardCreate(
            `cmd-kanban-ws-deep-other-${index}`,
            KanbanBoardId.makeUnsafe(`board-kanban-ws-deep-other-${index}`),
          ),
        ),
      );
    }
    await system.run(
      system.handlers["kanban.dispatchCommand"](cardCreate("cmd-kanban-ws-deep-card")),
    );

    const streamed = await system.run(
      Stream.runCollect(Stream.take(system.handlers["kanban.subscribeBoard"]({ boardId }), 2)),
    );

    expect(streamed.map((event) => event.type)).toEqual([
      "kanban.board.created",
      "kanban.card.created",
    ]);

    await system.dispose();
  });

  it("starts worker runs through the Kanban coordinator handler", async () => {
    const system = await createKanbanRpcSystem();

    const result = await system.run(system.handlers["kanban.startWorkerRun"]({ cardId }));

    expect(result).toEqual({
      runId: "run-kanban-ws-worker",
      threadId: "thread-kanban-ws-worker",
    });
    await system.dispose();
  });
});


describe("Automation WebSocket RPC handlers", () => {
  it("dispatches commands, reads snapshots, and streams automation history plus hot events", async () => {
    const system = await createAutomationRpcSystem();
    const createdAt = "2026-05-13T00:20:00.000Z";

    await system.run(
      system.handlers["automation.dispatchCommand"](
        automationCreate("cmd-automation-ws-create", createdAt),
      ),
    );

    const snapshot = await system.run(system.handlers["automation.getSnapshot"]({}));
    expect(snapshot.automations.map((automation) => automation.id)).toEqual([automationId]);
    expect(snapshot.automations[0]).toMatchObject({
      environmentMode: "local",
      writePolicy: { writesEnabled: true, allowDirtyLocalCheckout: false },
    });
    expect(snapshot.runsByAutomationId[automationId]).toEqual([]);

    const streamedTypes: string[] = [];
    await system.run(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<AutomationEvent>();
        yield* Effect.forkScoped(
          Stream.take(system.handlers["automation.subscribe"]({}), 2).pipe(
            Stream.runForEach((event) => Queue.offer(queue, event).pipe(Effect.asVoid)),
          ),
        );

        streamedTypes.push((yield* Queue.take(queue)).type);
        yield* system.handlers["automation.dispatchCommand"]({
          type: "automation.status.set",
          commandId: CommandId.makeUnsafe("cmd-automation-ws-status"),
          automationId,
          status: "disabled",
          updatedAt: "2026-05-13T00:21:00.000Z",
        });
        streamedTypes.push((yield* Queue.take(queue)).type);
      }).pipe(Effect.scoped),
    );

    expect(streamedTypes).toEqual(["automation.created", "automation.status-changed"]);
    await system.run(system.handlers["automation.unsubscribe"]({}));

    await system.dispose();
  });
});
