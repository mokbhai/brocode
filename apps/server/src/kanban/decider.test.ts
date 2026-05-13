import {
  CommandId,
  KanbanBoardId,
  KanbanCardId,
  KanbanReviewId,
  KanbanRunId,
  KanbanTaskId,
  ProjectId,
  ThreadId,
  type KanbanCard,
  type KanbanCommand,
  type KanbanEvent,
  type KanbanReadModel,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideKanbanCommand } from "./decider.ts";
import { createEmptyKanbanReadModel } from "./projector.ts";

const now = "2026-05-12T00:00:00.000Z";
const boardId = KanbanBoardId.makeUnsafe("board_1");
const cardId = KanbanCardId.makeUnsafe("card_1");
const otherCardId = KanbanCardId.makeUnsafe("card_2");
const projectId = ProjectId.makeUnsafe("project_1");

const runDecision = (command: KanbanCommand, readModel: KanbanReadModel) =>
  Effect.runPromise(decideKanbanCommand({ command, readModel }));

const runDecisionExit = (command: KanbanCommand, readModel: KanbanReadModel) =>
  Effect.runPromiseExit(decideKanbanCommand({ command, readModel }));

const asEvents = (
  eventOrEvents: Omit<KanbanEvent, "sequence"> | ReadonlyArray<Omit<KanbanEvent, "sequence">>,
) => (Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents]);

const readModelWithBoard = (): KanbanReadModel => ({
  ...createEmptyKanbanReadModel(now),
  boards: [
    {
      id: boardId,
      projectId,
      title: "Project board",
      createdAt: now,
      updatedAt: now,
    },
  ],
});

const readyCard = (status: KanbanCard["status"] = "ready"): KanbanCard => ({
  id: cardId,
  boardId,
  projectId,
  sourceThreadId: null,
  workerThreadIds: [],
  reviewerThreadIds: [],
  title: "Build Kanban orchestration",
  description: "Create the server domain surface",
  status,
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
  createdAt: now,
  updatedAt: now,
});

const cardWithId = (id: KanbanCardId, status: KanbanCard["status"] = "ready"): KanbanCard => ({
  ...readyCard(status),
  id,
});

describe("decideKanbanCommand", () => {
  it("accepts board creation input and emits a board-created event without project lookup", async () => {
    const event = await runDecision(
      {
        type: "kanban.board.create",
        commandId: CommandId.makeUnsafe("cmd_board_create"),
        boardId,
        projectId,
        title: "Project board",
        createdAt: now,
      },
      createEmptyKanbanReadModel(now),
    );

    expect(event.type).toBe("kanban.board.created");
    expect(event.aggregateKind).toBe("board");
    expect(event.aggregateId).toBe(boardId);
    expect(event.commandId).toBe("cmd_board_create");
    expect(event.correlationId).toBe("cmd_board_create");
    expect(event.payload.board).toMatchObject({
      id: boardId,
      projectId,
      title: "Project board",
    });
  });

  it("creates a card from user intent and emits no user-provided tasks", async () => {
    const events = asEvents(
      await runDecision(
        {
          type: "kanban.card.create",
          commandId: CommandId.makeUnsafe("cmd_card_create"),
          boardId,
          cardId,
          projectId,
          sourceThreadId: ThreadId.makeUnsafe("thread_1"),
          title: "Build Kanban orchestration",
          description: "Create the server domain surface",
          modelSelection: { provider: "codex", model: "gpt-5" },
          runtimeMode: "full-access",
          createdAt: now,
        },
        readModelWithBoard(),
      ),
    );

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.type).toBe("kanban.card.created");
    expect(event.aggregateKind).toBe("card");
    expect(event.aggregateId).toBe(cardId);
    expect(event.payload.card).toMatchObject({
      id: cardId,
      boardId,
      projectId,
      sourceThreadId: "thread_1",
      status: "draft",
      modelSelection: { provider: "codex", model: "gpt-5" },
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      associatedWorktreePath: null,
      associatedWorktreeBranch: null,
      associatedWorktreeRef: null,
      loopCount: 0,
      maxLoopCount: 3,
    });
    expect(event.payload.tasks).toEqual([]);
  });

  it("creates a card without a separate spec path", async () => {
    const command = {
      type: "kanban.card.create",
      commandId: CommandId.makeUnsafe("cmd_card_create_without_spec"),
      boardId,
      cardId,
      projectId,
      sourceThreadId: null,
      title: "Build Kanban orchestration",
      modelSelection: { provider: "codex", model: "gpt-5" },
      runtimeMode: "full-access",
      createdAt: now,
    } as KanbanCommand;

    const events = asEvents(await runDecision(command, readModelWithBoard()));
    const event = events[0]!;

    expect(events).toHaveLength(1);
    expect(event.type).toBe("kanban.card.created");
    expect(event.payload.card).toMatchObject({
      id: cardId,
      title: "Build Kanban orchestration",
    });
    expect("specPath" in event.payload.card).toBe(false);
  });

  it("requires an existing board and absent card for card creation", async () => {
    const command: KanbanCommand = {
      type: "kanban.card.create",
      commandId: CommandId.makeUnsafe("cmd_card_create"),
      boardId,
      cardId,
      projectId,
      sourceThreadId: null,
      title: "Build Kanban orchestration",
      modelSelection: { provider: "codex", model: "gpt-5" },
      runtimeMode: "full-access",
      createdAt: now,
    };

    const missingBoard = await runDecisionExit(command, createEmptyKanbanReadModel(now));
    const duplicateCard = await runDecisionExit(command, {
      ...readModelWithBoard(),
      cards: [readyCard()],
    });

    expect(missingBoard._tag).toBe("Failure");
    expect(String(missingBoard.cause)).toContain("Board");
    expect(duplicateCard._tag).toBe("Failure");
    expect(String(duplicateCard.cause)).toContain("already exists");
  });

  it("updates public card metadata without exposing a separate spec path", async () => {
    const events = asEvents(
      await runDecision(
        {
          type: "kanban.card.update",
          commandId: CommandId.makeUnsafe("cmd_card_update"),
          cardId,
          title: "Updated Kanban orchestration",
          description: null,
          runtimeMode: "approval-required",
          updatedAt: now,
        },
        {
          ...readModelWithBoard(),
          cards: [readyCard()],
        },
      ),
    );
    const event = events[0]!;

    expect(events).toHaveLength(1);
    expect(event.type).toBe("kanban.card.updated");
    expect(event.payload.card).toMatchObject({
      id: cardId,
      title: "Updated Kanban orchestration",
      runtimeMode: "approval-required",
    });
    expect(event.payload.card.description).toBeUndefined();
    expect("specPath" in event.payload.card).toBe(false);
  });

  it("updates server-owned worktree metadata through the internal worktree command", async () => {
    const events = asEvents(
      await runDecision(
        {
          type: "kanban.card.worktree.set",
          commandId: CommandId.makeUnsafe("cmd_card_worktree_set"),
          cardId,
          branch: "feat/card-1",
          worktreePath: "/tmp/card-1",
          associatedWorktreePath: "/repo",
          associatedWorktreeBranch: "main",
          associatedWorktreeRef: "abc123",
          updatedAt: now,
        },
        {
          ...readModelWithBoard(),
          cards: [readyCard()],
        },
      ),
    );
    const event = events[0]!;

    expect(events).toHaveLength(1);
    expect(event.type).toBe("kanban.card.updated");
    expect(event.payload.card).toMatchObject({
      id: cardId,
      branch: "feat/card-1",
      worktreePath: "/tmp/card-1",
      associatedWorktreePath: "/repo",
      associatedWorktreeBranch: "main",
      associatedWorktreeRef: "abc123",
    });
  });

  it("requires an existing card for task upsert", async () => {
    const exit = await runDecisionExit(
      {
        type: "kanban.task.upsert",
        commandId: CommandId.makeUnsafe("cmd_task_upsert"),
        cardId,
        task: {
          taskId: KanbanTaskId.makeUnsafe("task_1"),
          title: "Write projector",
          status: "todo",
          order: 0,
        },
        updatedAt: now,
      },
      readModelWithBoard(),
    );

    expect(exit._tag).toBe("Failure");
    expect(String(exit.cause)).toContain("Card");
  });

  it("requires a task to exist on the requested card before deleting it", async () => {
    const existingTaskId = KanbanTaskId.makeUnsafe("task_existing");
    const missingTaskId = KanbanTaskId.makeUnsafe("task_missing");
    const exit = await runDecisionExit(
      {
        type: "kanban.task.delete",
        commandId: CommandId.makeUnsafe("cmd_task_delete_missing"),
        cardId,
        taskId: missingTaskId,
        deletedAt: now,
      },
      {
        ...readModelWithBoard(),
        cards: [readyCard()],
        tasks: [
          {
            id: existingTaskId,
            cardId,
            title: "Existing task",
            status: "todo",
            order: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    );

    expect(exit._tag).toBe("Failure");
    expect(String(exit.cause)).toContain("does not exist on card");
  });

  it("rejects invalid lifecycle transitions such as submitted to implementing", async () => {
    const exit = await runDecisionExit(
      {
        type: "kanban.run.start",
        commandId: CommandId.makeUnsafe("cmd_run_start"),
        runId: KanbanRunId.makeUnsafe("run_1"),
        cardId,
        role: "worker",
        threadId: ThreadId.makeUnsafe("thread_worker_1"),
        startedAt: now,
      },
      {
        ...readModelWithBoard(),
        cards: [readyCard("submitted")],
      },
    );

    expect(exit._tag).toBe("Failure");
    expect(String(exit.cause)).toContain("submitted");
    expect(String(exit.cause)).toContain("implementing");
  });

  it("allows a worker run to start after a needs-work review outcome", async () => {
    const result = await runDecision(
      {
        type: "kanban.run.start",
        commandId: CommandId.makeUnsafe("cmd_retry_worker"),
        runId: KanbanRunId.makeUnsafe("run_retry_worker"),
        cardId,
        role: "worker",
        threadId: ThreadId.makeUnsafe("thread_worker_retry"),
        startedAt: now,
      },
      {
        ...readModelWithBoard(),
        cards: [readyCard("needs_work")],
      },
    );

    const events = asEvents(result);
    expect(events.map((event) => event.type)).toEqual([
      "kanban.card.status-changed",
      "kanban.run.started",
    ]);
    expect(events[0]?.payload).toMatchObject({
      cardId,
      fromStatus: "needs_work",
      toStatus: "implementing",
    });
  });

  it("moves an implementing card to reviewing before recording a successful worker run", async () => {
    const result = await runDecision(
      {
        type: "kanban.run.complete",
        commandId: CommandId.makeUnsafe("cmd_worker_complete"),
        runId: KanbanRunId.makeUnsafe("run_worker"),
        cardId,
        status: "completed",
        completedAt: now,
      },
      {
        ...readModelWithBoard(),
        cards: [readyCard("implementing")],
        runs: [
          {
            id: KanbanRunId.makeUnsafe("run_worker"),
            cardId,
            role: "worker",
            status: "running",
            threadId: ThreadId.makeUnsafe("thread_worker_1"),
            startedAt: now,
          },
        ],
      },
    );

    const events = asEvents(result);
    expect(events.map((event) => event.type)).toEqual([
      "kanban.card.status-changed",
      "kanban.run.completed",
    ]);
    expect(events[0]?.payload).toMatchObject({
      cardId,
      fromStatus: "implementing",
      toStatus: "reviewing",
      reason: null,
    });
    expect(events[1]?.payload).toMatchObject({
      run: {
        id: KanbanRunId.makeUnsafe("run_worker"),
        status: "completed",
      },
    });
  });

  it.each([
    {
      status: "failed" as const,
      errorMessage: "Worker summary was malformed",
      expectedReason: "Worker summary was malformed",
    },
    {
      status: "interrupted" as const,
      errorMessage: undefined,
      expectedReason: "Worker run interrupted",
    },
  ])(
    "moves an implementing card to agent_error before recording a $status worker run",
    async ({ status, errorMessage, expectedReason }) => {
      const result = await runDecision(
        {
          type: "kanban.run.complete",
          commandId: CommandId.makeUnsafe(`cmd_worker_${status}`),
          runId: KanbanRunId.makeUnsafe(`run_worker_${status}`),
          cardId,
          status,
          ...(errorMessage !== undefined ? { errorMessage } : {}),
          completedAt: now,
        },
        {
          ...readModelWithBoard(),
          cards: [readyCard("implementing")],
          runs: [
            {
              id: KanbanRunId.makeUnsafe(`run_worker_${status}`),
              cardId,
              role: "worker",
              status: "running",
              threadId: ThreadId.makeUnsafe("thread_worker_1"),
              startedAt: now,
            },
          ],
        },
      );

      const events = asEvents(result);
      expect(events.map((event) => event.type)).toEqual([
        "kanban.card.status-changed",
        "kanban.run.completed",
      ]);
      expect(events[0]?.payload).toMatchObject({
        cardId,
        fromStatus: "implementing",
        toStatus: "agent_error",
        reason: expectedReason,
      });
      expect(events[1]?.payload).toMatchObject({
        run: {
          id: KanbanRunId.makeUnsafe(`run_worker_${status}`),
          status,
          ...(errorMessage !== undefined ? { errorMessage } : {}),
        },
      });
    },
  );

  it("records reviewer run completion without changing card status in phase 3", async () => {
    const result = await runDecision(
      {
        type: "kanban.run.complete",
        commandId: CommandId.makeUnsafe("cmd_reviewer_complete"),
        runId: KanbanRunId.makeUnsafe("run_reviewer"),
        cardId,
        status: "completed",
        completedAt: now,
      },
      {
        ...readModelWithBoard(),
        cards: [readyCard("reviewing")],
        runs: [
          {
            id: KanbanRunId.makeUnsafe("run_reviewer"),
            cardId,
            role: "reviewer",
            status: "running",
            threadId: ThreadId.makeUnsafe("thread_reviewer_1"),
            startedAt: now,
          },
        ],
      },
    );

    const events = asEvents(result);
    expect(events.map((event) => event.type)).toEqual(["kanban.run.completed"]);
    expect(events[0]?.payload).toMatchObject({
      run: {
        id: KanbanRunId.makeUnsafe("run_reviewer"),
        status: "completed",
      },
    });
  });

  it("rejects review completion when the referenced run belongs to another card or is a worker run", async () => {
    const otherCardRunExit = await runDecisionExit(
      {
        type: "kanban.review.complete",
        commandId: CommandId.makeUnsafe("cmd_review_wrong_card"),
        review: {
          id: KanbanReviewId.makeUnsafe("review_wrong_card"),
          cardId,
          runId: KanbanRunId.makeUnsafe("run_other_card"),
          reviewerThreadId: ThreadId.makeUnsafe("thread_reviewer_1"),
          outcome: "approved",
          summary: "Looks ready",
          findings: [],
          completedAt: now,
        },
      },
      {
        ...readModelWithBoard(),
        cards: [readyCard("reviewing"), cardWithId(otherCardId, "reviewing")],
        runs: [
          {
            id: KanbanRunId.makeUnsafe("run_other_card"),
            cardId: otherCardId,
            role: "reviewer",
            status: "completed",
            threadId: ThreadId.makeUnsafe("thread_reviewer_1"),
            startedAt: now,
            completedAt: now,
          },
        ],
      },
    );

    const workerRunExit = await runDecisionExit(
      {
        type: "kanban.review.complete",
        commandId: CommandId.makeUnsafe("cmd_review_worker_run"),
        review: {
          id: KanbanReviewId.makeUnsafe("review_worker_run"),
          cardId,
          runId: KanbanRunId.makeUnsafe("run_worker"),
          reviewerThreadId: ThreadId.makeUnsafe("thread_reviewer_1"),
          outcome: "approved",
          summary: "Looks ready",
          findings: [],
          completedAt: now,
        },
      },
      {
        ...readModelWithBoard(),
        cards: [readyCard("reviewing")],
        runs: [
          {
            id: KanbanRunId.makeUnsafe("run_worker"),
            cardId,
            role: "worker",
            status: "completed",
            threadId: ThreadId.makeUnsafe("thread_worker_1"),
            startedAt: now,
            completedAt: now,
          },
        ],
      },
    );

    expect(otherCardRunExit._tag).toBe("Failure");
    expect(String(otherCardRunExit.cause)).toContain("card");
    expect(workerRunExit._tag).toBe("Failure");
    expect(String(workerRunExit.cause)).toContain("reviewer");
  });

  it.each(["running", "failed", "interrupted"] as const)(
    "rejects review completion when the reviewer run is %s",
    async (runStatus) => {
      const exit = await runDecisionExit(
        {
          type: "kanban.review.complete",
          commandId: CommandId.makeUnsafe(`cmd_review_${runStatus}`),
          review: {
            id: KanbanReviewId.makeUnsafe(`review_${runStatus}`),
            cardId,
            runId: KanbanRunId.makeUnsafe(`run_${runStatus}`),
            reviewerThreadId: ThreadId.makeUnsafe("thread_reviewer_1"),
            outcome: "approved",
            summary: "Looks ready",
            findings: [],
            completedAt: now,
          },
        },
        {
          ...readModelWithBoard(),
          cards: [readyCard("reviewing")],
          runs: [
            {
              id: KanbanRunId.makeUnsafe(`run_${runStatus}`),
              cardId,
              role: "reviewer",
              status: runStatus,
              threadId: ThreadId.makeUnsafe("thread_reviewer_1"),
              startedAt: now,
              ...(runStatus === "running" ? {} : { completedAt: now }),
            },
          ],
        },
      );

      expect(exit._tag).toBe("Failure");
      expect(String(exit.cause)).toContain("completed");
    },
  );

  it("emits a needs-work status change before recording a needs-work review", async () => {
    const result = await runDecision(
      {
        type: "kanban.review.complete",
        commandId: CommandId.makeUnsafe("cmd_review_needs_work"),
        review: {
          id: KanbanReviewId.makeUnsafe("review_needs_work"),
          cardId,
          runId: KanbanRunId.makeUnsafe("run_reviewer"),
          reviewerThreadId: ThreadId.makeUnsafe("thread_reviewer_1"),
          outcome: "needs_work",
          summary: "Revise the error handling",
          findings: ["Handle duplicate completion"],
          completedAt: now,
        },
      },
      {
        ...readModelWithBoard(),
        cards: [readyCard("reviewing")],
        runs: [
          {
            id: KanbanRunId.makeUnsafe("run_reviewer"),
            cardId,
            role: "reviewer",
            status: "completed",
            threadId: ThreadId.makeUnsafe("thread_reviewer_1"),
            startedAt: now,
            completedAt: now,
          },
        ],
      },
    );

    const events = asEvents(result);
    expect(events.map((event) => event.type)).toEqual([
      "kanban.card.status-changed",
      "kanban.review.completed",
    ]);
    expect(events[0]?.payload).toMatchObject({
      cardId,
      fromStatus: "reviewing",
      toStatus: "needs_work",
      reason: "Revise the error handling",
    });
    expect(events[1]?.payload).toMatchObject({
      review: {
        id: KanbanReviewId.makeUnsafe("review_needs_work"),
        outcome: "needs_work",
      },
    });
  });

  it("rejects repeated terminal run completion", async () => {
    const exit = await runDecisionExit(
      {
        type: "kanban.run.complete",
        commandId: CommandId.makeUnsafe("cmd_run_complete_again"),
        runId: KanbanRunId.makeUnsafe("run_completed"),
        cardId,
        status: "completed",
        completedAt: now,
      },
      {
        ...readModelWithBoard(),
        cards: [readyCard("reviewing")],
        runs: [
          {
            id: KanbanRunId.makeUnsafe("run_completed"),
            cardId,
            role: "reviewer",
            status: "completed",
            threadId: ThreadId.makeUnsafe("thread_reviewer_1"),
            startedAt: now,
            completedAt: now,
          },
        ],
      },
    );

    expect(exit._tag).toBe("Failure");
    expect(String(exit.cause)).toContain("running");
  });
});
