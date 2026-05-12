import {
  CommandId,
  EventId,
  KanbanBoardId,
  KanbanCardId,
  KanbanTaskId,
  ProjectId,
  type KanbanEvent,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { KanbanEventStoreLive } from "./KanbanEventStore.ts";
import { KanbanProjectionPipelineLive } from "./KanbanProjectionPipeline.ts";
import { KanbanEventStore } from "../Services/KanbanEventStore.ts";
import { KanbanProjectionPipeline } from "../Services/KanbanProjectionPipeline.ts";

const projectId = ProjectId.makeUnsafe("project-kanban-projection");
const boardId = KanbanBoardId.makeUnsafe("board-kanban-projection");
const cardId = KanbanCardId.makeUnsafe("card-kanban-projection");
const taskId = KanbanTaskId.makeUnsafe("task-kanban-projection");

async function createProjectionSystem() {
  const pipelineLayer = KanbanProjectionPipelineLive.pipe(Layer.provide(KanbanEventStoreLive));
  const layer = Layer.mergeAll(pipelineLayer, KanbanEventStoreLive).pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
  );
  const runtime = ManagedRuntime.make(layer);
  const pipeline = await runtime.runPromise(Effect.service(KanbanProjectionPipeline));
  const eventStore = await runtime.runPromise(Effect.service(KanbanEventStore));
  const sql = await runtime.runPromise(Effect.service(SqlClient.SqlClient));
  return {
    pipeline,
    eventStore,
    sql,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

function eventBase(input: {
  readonly eventId: string;
  readonly aggregateKind: "board" | "card";
  readonly aggregateId: string;
  readonly commandId: string;
  readonly occurredAt: string;
}): Omit<KanbanEvent, "sequence" | "type" | "payload"> {
  return {
    eventId: EventId.makeUnsafe(input.eventId),
    aggregateKind: input.aggregateKind,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt,
    commandId: CommandId.makeUnsafe(input.commandId),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe(input.commandId),
    metadata: {},
  };
}

describe("KanbanProjectionPipeline", () => {
  it("bootstraps persisted Kanban events into projection tables and advances the cursor", async () => {
    const system = await createProjectionSystem();
    const createdAt = "2026-05-12T00:02:00.000Z";

    const boardEvent = await system.run(
      system.eventStore.append({
        ...eventBase({
          eventId: "evt-kanban-projection-board",
          aggregateKind: "board",
          aggregateId: boardId,
          commandId: "cmd-kanban-projection-board",
          occurredAt: createdAt,
        }),
        type: "kanban.board.created",
        payload: {
          board: {
            id: boardId,
            projectId,
            title: "Projection Board",
            createdAt,
            updatedAt: createdAt,
          },
        },
      }),
    );

    const card = {
      id: cardId,
      boardId,
      projectId,
      sourceThreadId: null,
      workerThreadIds: [],
      reviewerThreadIds: [],
      title: "Projection Card",
      description: "Projected card",
      specPath: "docs/projection.md",
      status: "draft" as const,
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      runtimeMode: "approval-required" as const,
      branch: null,
      worktreePath: null,
      associatedWorktreePath: null,
      associatedWorktreeBranch: null,
      associatedWorktreeRef: null,
      blockerReason: null,
      loopCount: 0,
      maxLoopCount: 3,
      createdAt,
      updatedAt: createdAt,
    };

    const task = {
      id: taskId,
      cardId,
      title: "Projection task",
      status: "todo" as const,
      order: 0,
      createdAt,
      updatedAt: createdAt,
    };

    const cardEvent = await system.run(
      system.eventStore.append({
        ...eventBase({
          eventId: "evt-kanban-projection-card",
          aggregateKind: "card",
          aggregateId: cardId,
          commandId: "cmd-kanban-projection-card",
          occurredAt: createdAt,
        }),
        type: "kanban.card.created",
        payload: {
          card,
          tasks: [task],
        },
      }),
    );

    const statusEvent = await system.run(
      system.eventStore.append({
        ...eventBase({
          eventId: "evt-kanban-projection-status",
          aggregateKind: "card",
          aggregateId: cardId,
          commandId: "cmd-kanban-projection-status",
          occurredAt: createdAt,
        }),
        type: "kanban.card.status-changed",
        payload: {
          cardId,
          fromStatus: "draft",
          toStatus: "ready",
          reason: null,
          updatedAt: createdAt,
        },
      }),
    );

    await system.run(system.pipeline.bootstrap);

    const boards = await system.run(
      system.sql<{ readonly boardId: string; readonly title: string }>`
        SELECT board_id AS "boardId", title
        FROM projection_kanban_boards
      `,
    );
    expect(boards).toEqual([{ boardId, title: "Projection Board" }]);

    const cards = await system.run(
      system.sql<{
        readonly cardId: string;
        readonly status: string;
        readonly modelSelectionJson: string;
      }>`
        SELECT
          card_id AS "cardId",
          status,
          model_selection_json AS "modelSelectionJson"
        FROM projection_kanban_cards
      `,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ cardId, status: "ready" });
    expect(JSON.parse(cards[0]!.modelSelectionJson)).toEqual({
      provider: "codex",
      model: "gpt-5-codex",
    });

    const tasks = await system.run(
      system.sql<{ readonly taskId: string; readonly taskOrder: number }>`
        SELECT task_id AS "taskId", task_order AS "taskOrder"
        FROM projection_kanban_tasks
      `,
    );
    expect(tasks).toEqual([{ taskId, taskOrder: 0 }]);

    const state = await system.run(
      system.sql<{ readonly lastAppliedSequence: number }>`
        SELECT last_applied_sequence AS "lastAppliedSequence"
        FROM projection_kanban_state
        WHERE projector = 'kanban.projection'
      `,
    );
    expect(state).toEqual([{ lastAppliedSequence: statusEvent.sequence }]);
    expect(boardEvent.sequence).toBeLessThan(cardEvent.sequence);
    expect(cardEvent.sequence).toBeLessThan(statusEvent.sequence);

    await system.dispose();
  });

  it("projects one event transactionally and advances the cursor", async () => {
    const system = await createProjectionSystem();
    const createdAt = "2026-05-12T00:03:00.000Z";
    const event = await system.run(
      system.eventStore.append({
        ...eventBase({
          eventId: "evt-kanban-project-one",
          aggregateKind: "board",
          aggregateId: boardId,
          commandId: "cmd-kanban-project-one",
          occurredAt: createdAt,
        }),
        type: "kanban.board.created",
        payload: {
          board: {
            id: boardId,
            projectId,
            title: "Single Event Board",
            createdAt,
            updatedAt: createdAt,
          },
        },
      }),
    );

    await system.run(system.pipeline.projectEvent(event));

    const rows = await system.run(
      system.sql<{ readonly boardId: string; readonly lastAppliedSequence: number }>`
        SELECT b.board_id AS "boardId", s.last_applied_sequence AS "lastAppliedSequence"
        FROM projection_kanban_boards b
        CROSS JOIN projection_kanban_state s
        WHERE s.projector = 'kanban.projection'
      `,
    );
    expect(rows).toEqual([{ boardId, lastAppliedSequence: event.sequence }]);

    await system.dispose();
  });
});
