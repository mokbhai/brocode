import {
  CommandId,
  EventId,
  KanbanBoardId,
  KanbanCardId,
  KanbanTaskId,
  ProjectId,
  type KanbanEvent,
  type KanbanTask,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createEmptyKanbanReadModel, projectKanbanEvent } from "./projector.ts";

const boardId = KanbanBoardId.makeUnsafe("board_1");
const cardId = KanbanCardId.makeUnsafe("card_1");
const otherCardId = KanbanCardId.makeUnsafe("card_2");
const projectId = ProjectId.makeUnsafe("project_1");

const eventBase = (
  sequence: number,
  type: KanbanEvent["type"],
): Omit<KanbanEvent, "type" | "payload"> => ({
  sequence,
  eventId: EventId.makeUnsafe(`event_${sequence}`),
  aggregateKind: type === "kanban.board.created" ? "board" : "card",
  aggregateId: type === "kanban.board.created" ? boardId : cardId,
  occurredAt: `2026-05-12T00:00:0${sequence}.000Z`,
  commandId: CommandId.makeUnsafe(`cmd_${sequence}`),
  causationEventId: null,
  correlationId: CommandId.makeUnsafe(`cmd_${sequence}`),
  metadata: {},
});

const boardCreated: KanbanEvent = {
  ...eventBase(1, "kanban.board.created"),
  type: "kanban.board.created",
  payload: {
    board: {
      id: boardId,
      projectId,
      title: "Project board",
      createdAt: "2026-05-12T00:00:01.000Z",
      updatedAt: "2026-05-12T00:00:01.000Z",
    },
  },
};

const cardCreated: KanbanEvent = {
  ...eventBase(2, "kanban.card.created"),
  type: "kanban.card.created",
  payload: {
    card: {
      id: cardId,
      boardId,
      projectId,
      sourceThreadId: null,
      workerThreadIds: [],
      reviewerThreadIds: [],
      title: "Build Kanban orchestration",
      status: "draft",
      modelSelection: { provider: "codex", model: "gpt-5" },
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      associatedWorktreePath: null,
      associatedWorktreeBranch: null,
      associatedWorktreeRef: null,
      blockerReason: null,
      loopCount: 0,
      maxLoopCount: 3,
      createdAt: "2026-05-12T00:00:02.000Z",
      updatedAt: "2026-05-12T00:00:02.000Z",
    },
    tasks: [
      {
        id: KanbanTaskId.makeUnsafe("task_1"),
        cardId,
        title: "Write decider",
        status: "todo",
        order: 0,
        createdAt: "2026-05-12T00:00:02.000Z",
        updatedAt: "2026-05-12T00:00:02.000Z",
      },
    ],
  },
};

const taskWithCard = (cardId: KanbanCardId, title: string, updatedAt: string): KanbanTask => ({
  id: KanbanTaskId.makeUnsafe("task_shared"),
  cardId,
  title,
  status: "todo",
  order: 0,
  createdAt: updatedAt,
  updatedAt,
});

describe("projectKanbanEvent", () => {
  it("replays board, card, task, and status events into an immutable read model", async () => {
    const initial = createEmptyKanbanReadModel("2026-05-12T00:00:00.000Z");
    const afterBoard = await Effect.runPromise(projectKanbanEvent(initial, boardCreated));
    const afterCard = await Effect.runPromise(projectKanbanEvent(afterBoard, cardCreated));
    const afterTask = await Effect.runPromise(
      projectKanbanEvent(afterCard, {
        ...eventBase(3, "kanban.task.upserted"),
        type: "kanban.task.upserted",
        payload: {
          task: {
            id: KanbanTaskId.makeUnsafe("task_2"),
            cardId,
            title: "Write projector",
            status: "in_progress",
            order: 1,
            createdAt: "2026-05-12T00:00:03.000Z",
            updatedAt: "2026-05-12T00:00:03.000Z",
          },
        },
      }),
    );
    const afterStatus = await Effect.runPromise(
      projectKanbanEvent(afterTask, {
        ...eventBase(4, "kanban.card.status-changed"),
        type: "kanban.card.status-changed",
        payload: {
          cardId,
          fromStatus: "draft",
          toStatus: "ready",
          reason: null,
          updatedAt: "2026-05-12T00:00:04.000Z",
        },
      }),
    );

    expect(initial.boards).toEqual([]);
    expect(initial.cards).toEqual([]);
    expect(afterStatus.snapshotSequence).toBe(4);
    expect(afterStatus.updatedAt).toBe("2026-05-12T00:00:04.000Z");
    expect(afterStatus.boards).toEqual([expect.objectContaining({ id: boardId, projectId })]);
    expect(afterStatus.cards).toEqual([
      expect.objectContaining({
        id: cardId,
        boardId,
        projectId,
        status: "ready",
        updatedAt: "2026-05-12T00:00:04.000Z",
      }),
    ]);
    expect(afterStatus.tasks).toEqual([
      expect.objectContaining({ id: "task_1", cardId, title: "Write decider" }),
      expect.objectContaining({
        id: "task_2",
        cardId,
        title: "Write projector",
        status: "in_progress",
      }),
    ]);
  });

  it("strips legacy specPath from card event payloads during replay", async () => {
    const initial = createEmptyKanbanReadModel("2026-05-12T00:00:00.000Z");
    const next = await Effect.runPromise(
      projectKanbanEvent(initial, {
        ...cardCreated,
        payload: {
          ...cardCreated.payload,
          card: {
            ...cardCreated.payload.card,
            specPath: "docs/legacy-spec.md",
          },
        },
      }),
    );

    expect(next.cards[0]).toBeDefined();
    expect("specPath" in next.cards[0]!).toBe(false);
  });

  it("preserves server-owned worktree metadata from card updates", async () => {
    const initial = createEmptyKanbanReadModel("2026-05-12T00:00:00.000Z");
    const afterCard = await Effect.runPromise(projectKanbanEvent(initial, cardCreated));
    const next = await Effect.runPromise(
      projectKanbanEvent(afterCard, {
        ...eventBase(3, "kanban.card.updated"),
        type: "kanban.card.updated",
        payload: {
          card: {
            ...cardCreated.payload.card,
            branch: "kanban/card-1",
            worktreePath: "/tmp/card-1",
            associatedWorktreePath: "/repo",
            associatedWorktreeBranch: "main",
            associatedWorktreeRef: "abc123",
            updatedAt: "2026-05-12T00:00:03.000Z",
          },
        },
      }),
    );

    expect(next.cards[0]).toMatchObject({
      branch: "kanban/card-1",
      worktreePath: "/tmp/card-1",
      associatedWorktreePath: "/repo",
      associatedWorktreeBranch: "main",
      associatedWorktreeRef: "abc123",
      updatedAt: "2026-05-12T00:00:03.000Z",
    });
  });

  it("preserves the visible reason for agent error status changes", async () => {
    const initial = createEmptyKanbanReadModel("2026-05-12T00:00:00.000Z");
    const afterCard = await Effect.runPromise(projectKanbanEvent(initial, cardCreated));
    const next = await Effect.runPromise(
      projectKanbanEvent(afterCard, {
        ...eventBase(3, "kanban.card.status-changed"),
        type: "kanban.card.status-changed",
        payload: {
          cardId,
          fromStatus: "implementing",
          toStatus: "agent_error",
          reason: "Worker summary was malformed",
          updatedAt: "2026-05-12T00:00:03.000Z",
        },
      }),
    );

    expect(next.cards[0]).toMatchObject({
      status: "agent_error",
      blockerReason: "Worker summary was malformed",
      updatedAt: "2026-05-12T00:00:03.000Z",
    });
  });

  it("upserts tasks by card id and task id so different cards can share task ids", async () => {
    const initial = {
      ...createEmptyKanbanReadModel("2026-05-12T00:00:00.000Z"),
      tasks: [taskWithCard(cardId, "Card one task", "2026-05-12T00:00:01.000Z")],
    };

    const next = await Effect.runPromise(
      projectKanbanEvent(initial, {
        ...eventBase(2, "kanban.task.upserted"),
        aggregateId: otherCardId,
        type: "kanban.task.upserted",
        payload: {
          task: taskWithCard(otherCardId, "Card two task", "2026-05-12T00:00:02.000Z"),
        },
      }),
    );

    expect(next.tasks).toEqual([
      expect.objectContaining({
        id: KanbanTaskId.makeUnsafe("task_shared"),
        cardId,
        title: "Card one task",
      }),
      expect.objectContaining({
        id: KanbanTaskId.makeUnsafe("task_shared"),
        cardId: otherCardId,
        title: "Card two task",
      }),
    ]);
  });
});
