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
  specPath: "docs/spec.md",
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

  it("creates a card with required spec, model, runtime, and initial tasks", async () => {
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
          specPath: "docs/spec.md",
          tasks: [
            {
              taskId: KanbanTaskId.makeUnsafe("task_1"),
              title: "Write decider",
              status: "todo",
              order: 0,
            },
          ],
          modelSelection: { provider: "codex", model: "gpt-5" },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          associatedWorktreePath: null,
          associatedWorktreeBranch: null,
          associatedWorktreeRef: null,
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
      specPath: "docs/spec.md",
      status: "draft",
      modelSelection: { provider: "codex", model: "gpt-5" },
      runtimeMode: "full-access",
      loopCount: 0,
      maxLoopCount: 3,
    });
    expect(event.payload.tasks).toEqual([
      expect.objectContaining({
        id: "task_1",
        cardId,
        title: "Write decider",
        status: "todo",
        order: 0,
      }),
    ]);
  });

  it("rejects card creation when specPath is absent even though the contract allows it", async () => {
    const command = {
      type: "kanban.card.create",
      commandId: CommandId.makeUnsafe("cmd_card_create_without_spec"),
      boardId,
      cardId,
      projectId,
      sourceThreadId: null,
      title: "Build Kanban orchestration",
      tasks: [],
      modelSelection: { provider: "codex", model: "gpt-5" },
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      associatedWorktreePath: null,
      associatedWorktreeBranch: null,
      associatedWorktreeRef: null,
      createdAt: now,
    } as KanbanCommand;

    const exit = await runDecisionExit(command, readModelWithBoard());

    expect(exit._tag).toBe("Failure");
    expect(String(exit.cause)).toContain("specPath");
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
      specPath: "docs/spec.md",
      tasks: [],
      modelSelection: { provider: "codex", model: "gpt-5" },
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      associatedWorktreePath: null,
      associatedWorktreeBranch: null,
      associatedWorktreeRef: null,
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
