import {
  type KanbanBoardId,
  type KanbanCard,
  type KanbanCardId,
  type KanbanTask,
  type KanbanTaskId,
  type ProjectId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  formatKanbanCardProgress,
  formatKanbanCardRetryText,
  getKanbanCardBadges,
  groupKanbanCardsByColumn,
} from "./kanbanBoard.logic";

const boardId = "board-1" as KanbanBoardId;
const cardId = "card-1" as KanbanCardId;
const projectId = "project-1" as ProjectId;
const now = "2026-05-12T00:00:00.000Z";

function makeCard(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: cardId,
    boardId,
    projectId,
    sourceThreadId: null,
    workerThreadIds: [],
    reviewerThreadIds: [],
    title: "Implement Kanban board",
    description: "Add the board presentation logic",
    status: "ready",
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    runtimeMode: "full-access",
    branch: null,
    worktreePath: null,
    associatedWorktreePath: null,
    associatedWorktreeBranch: null,
    associatedWorktreeRef: null,
    blockerReason: null,
    loopCount: 0,
    maxLoopCount: 3,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1" as KanbanTaskId,
    cardId,
    title: "Wire column model",
    status: "todo",
    order: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("groupKanbanCardsByColumn", () => {
  it("returns stable lifecycle columns and groups matching card view models", () => {
    const blockedCard = makeCard({
      id: "card-blocked" as KanbanCardId,
      title: "Blocked card",
      status: "blocked",
      blockerReason: "Waiting on credentials",
    });
    const readyCard = makeCard({
      id: "card-ready" as KanbanCardId,
      title: "Ready card",
      status: "ready",
    });
    const errorCard = makeCard({
      id: "card-error" as KanbanCardId,
      title: "Error card",
      status: "agent_error",
      loopCount: 2,
      maxLoopCount: 3,
    });
    const tasksByCardId = {
      [blockedCard.id]: [
        makeTask({
          id: "task-blocked" as KanbanTaskId,
          cardId: blockedCard.id,
          status: "blocked",
        }),
      ],
      [readyCard.id]: [
        makeTask({ id: "task-done" as KanbanTaskId, cardId: readyCard.id, status: "done" }),
        makeTask({ id: "task-todo" as KanbanTaskId, cardId: readyCard.id, status: "todo" }),
      ],
    };

    const columns = groupKanbanCardsByColumn([blockedCard, readyCard, errorCard], tasksByCardId);

    expect(columns.map((column) => column.id)).toEqual([
      "draft",
      "ready",
      "implementing",
      "reviewing",
      "needs_work",
      "approved",
      "ready_to_submit",
      "submitted",
      "blocked",
      "loop_limit_reached",
      "agent_error",
      "review_inconclusive",
    ]);
    expect(columns.find((column) => column.id === "ready")).toMatchObject({
      title: "Ready",
      cardCount: 1,
      cards: [
        {
          card: readyCard,
          tasks: tasksByCardId[readyCard.id],
          progressText: "1/2 tasks done",
          retryText: null,
          badges: [],
        },
      ],
    });
    expect(columns.find((column) => column.id === "blocked")?.cards[0]?.badges).toEqual([
      {
        tone: "blocked",
        label: "Blocked",
        title: "Waiting on credentials",
      },
    ]);
    expect(columns.find((column) => column.id === "agent_error")?.cards[0]).toMatchObject({
      retryText: "Retry 2/3",
      badges: [
        {
          tone: "error",
          label: "Agent error",
          title: "Retry available",
        },
      ],
    });
  });
});

describe("kanban card presentation helpers", () => {
  it("formats task progress without mutating or sorting the task list", () => {
    const tasks = [
      makeTask({ id: "task-2" as KanbanTaskId, status: "done", order: 2 }),
      makeTask({ id: "task-1" as KanbanTaskId, status: "in_progress", order: 1 }),
      makeTask({ id: "task-3" as KanbanTaskId, status: "blocked", order: 3 }),
    ];

    expect(formatKanbanCardProgress(makeCard(), tasks)).toBe("1/3 tasks done");
    expect(tasks.map((task) => task.id)).toEqual(["task-2", "task-1", "task-3"]);
  });

  it("uses empty-state progress text when a card has no tasks", () => {
    expect(formatKanbanCardProgress(makeCard(), [])).toBe("No tasks");
  });

  it("formats retry text only after a card has retried or exhausted the loop limit", () => {
    expect(formatKanbanCardRetryText(makeCard({ loopCount: 0, maxLoopCount: 3 }))).toBeNull();
    expect(formatKanbanCardRetryText(makeCard({ loopCount: 1, maxLoopCount: 3 }))).toBe(
      "Retry 1/3",
    );
    expect(
      formatKanbanCardRetryText(
        makeCard({ status: "loop_limit_reached", loopCount: 3, maxLoopCount: 3 }),
      ),
    ).toBe("Retry limit reached");
  });

  it("returns blocked, error, and warning badges from status and blocker details", () => {
    expect(
      getKanbanCardBadges(
        makeCard({ status: "blocked", blockerReason: "Reviewer requested clarification" }),
      ),
    ).toEqual([
      {
        tone: "blocked",
        label: "Blocked",
        title: "Reviewer requested clarification",
      },
    ]);
    expect(getKanbanCardBadges(makeCard({ status: "agent_error" }))).toEqual([
      {
        tone: "error",
        label: "Agent error",
        title: "Retry available",
      },
    ]);
    expect(getKanbanCardBadges(makeCard({ status: "review_inconclusive" }))).toEqual([
      {
        tone: "warning",
        label: "Review inconclusive",
        title: "Reviewer could not reach a decision",
      },
    ]);
  });
});
