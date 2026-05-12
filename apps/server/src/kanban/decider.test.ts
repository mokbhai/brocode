import {
  CommandId,
  KanbanBoardId,
  KanbanCardId,
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
});
