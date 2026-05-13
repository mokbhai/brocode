import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  KANBAN_WS_CHANNELS,
  KANBAN_WS_METHODS,
  ClientKanbanCommand,
  KanbanBoardSnapshot,
  KanbanCard,
  KanbanClientCommand,
  KanbanCommand,
  KanbanDispatchCommandResult,
  KanbanEvent,
  KanbanGetSnapshotInput,
  KanbanReadModel,
  KanbanRpcSchemas,
  KanbanSubscribeBoardInput,
  KanbanUnsubscribeBoardInput,
} from "./kanban";

const decodeKanbanCard = Schema.decodeUnknownEffect(KanbanCard);
const decodeClientKanbanCommand = Schema.decodeUnknownEffect(ClientKanbanCommand);
const decodeKanbanCommand = Schema.decodeUnknownEffect(KanbanCommand);
const decodeKanbanRpcDispatchInput = Schema.decodeUnknownEffect(
  KanbanRpcSchemas.dispatchCommand.input,
);
const decodeKanbanGetSnapshotInput = Schema.decodeUnknownEffect(KanbanGetSnapshotInput);
const decodeKanbanDispatchCommandResult = Schema.decodeUnknownEffect(KanbanDispatchCommandResult);
const decodeKanbanSubscribeBoardInput = Schema.decodeUnknownEffect(KanbanSubscribeBoardInput);
const decodeKanbanUnsubscribeBoardInput = Schema.decodeUnknownEffect(KanbanUnsubscribeBoardInput);
const decodeKanbanEvent = Schema.decodeUnknownEffect(KanbanEvent);
const decodeKanbanReadModel = Schema.decodeUnknownEffect(KanbanReadModel);
const decodeKanbanBoardSnapshot = Schema.decodeUnknownEffect(KanbanBoardSnapshot);

const createdAt = "2026-05-12T00:00:00.000Z";

const baseCard = {
  id: "card-1",
  boardId: "board-1",
  projectId: "project-1",
  sourceThreadId: "thread-source",
  workerThreadIds: ["thread-worker-1"],
  reviewerThreadIds: ["thread-reviewer-1"],
  title: "Implement task",
  description: "Detailed spec",
  status: "ready",
  modelSelection: {
    provider: "codex",
    model: "gpt-5.2",
  },
  runtimeMode: "full-access",
  branch: "feat/card-1",
  worktreePath: "/tmp/card-1",
  associatedWorktreePath: "/repo",
  associatedWorktreeBranch: "main",
  associatedWorktreeRef: "abc123",
  loopCount: 0,
  maxLoopCount: 3,
  createdAt,
  updatedAt: createdAt,
};

it.effect("decodes a card linked to project, source thread, agent threads, and worktree metadata", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeKanbanCard(baseCard);

    assert.strictEqual(parsed.projectId, "project-1");
    assert.strictEqual(parsed.sourceThreadId, "thread-source");
    assert.deepStrictEqual(parsed.workerThreadIds, ["thread-worker-1"]);
    assert.deepStrictEqual(parsed.reviewerThreadIds, ["thread-reviewer-1"]);
    assert.deepStrictEqual(parsed.modelSelection, {
      provider: "codex",
      model: "gpt-5.2",
    });
    assert.strictEqual(parsed.runtimeMode, "full-access");
    assert.strictEqual(parsed.branch, "feat/card-1");
    assert.strictEqual(parsed.worktreePath, "/tmp/card-1");
    assert.strictEqual(parsed.associatedWorktreePath, "/repo");
    assert.strictEqual(parsed.associatedWorktreeBranch, "main");
    assert.strictEqual(parsed.associatedWorktreeRef, "abc123");
  }),
);

it.effect("rejects specPath on public card read models", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeKanbanCard({
        ...baseCard,
        specPath: "docs/spec.md",
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes legacy card events with specPath for projection replay compatibility", () =>
  Effect.gen(function* () {
    const event = yield* decodeKanbanEvent({
      sequence: 1,
      eventId: "event-legacy-card",
      aggregateKind: "card",
      aggregateId: "card-1",
      type: "kanban.card.created",
      occurredAt: createdAt,
      commandId: "cmd-1",
      causationEventId: null,
      correlationId: "cmd-1",
      metadata: {},
      payload: {
        card: {
          ...baseCard,
          specPath: "docs/spec.md",
        },
        tasks: [],
      },
    });

    assert.strictEqual(event.type, "kanban.card.created");
    assert.strictEqual(event.payload.card.specPath, "docs/spec.md");
  }),
);

it.effect("decodes a card without worker and reviewer thread links as empty arrays", () =>
  Effect.gen(function* () {
    const { workerThreadIds: _workerThreadIds, reviewerThreadIds: _reviewerThreadIds, ...card } =
      baseCard;

    const parsed = yield* decodeKanbanCard(card);

    assert.deepStrictEqual(parsed.workerThreadIds, []);
    assert.deepStrictEqual(parsed.reviewerThreadIds, []);
  }),
);

it.effect("decodes omitted nullable card links as null", () =>
  Effect.gen(function* () {
    const {
      sourceThreadId: _sourceThreadId,
      associatedWorktreePath: _associatedWorktreePath,
      associatedWorktreeBranch: _associatedWorktreeBranch,
      associatedWorktreeRef: _associatedWorktreeRef,
      ...card
    } = baseCard;

    const parsed = yield* decodeKanbanCard(card);

    assert.strictEqual(parsed.sourceThreadId, null);
    assert.strictEqual(parsed.associatedWorktreePath, null);
    assert.strictEqual(parsed.associatedWorktreeBranch, null);
    assert.strictEqual(parsed.associatedWorktreeRef, null);
    assert.strictEqual(parsed.blockerReason, null);
  }),
);

it.effect("decodes omitted branch and worktree path as null on cards", () =>
  Effect.gen(function* () {
    const { branch: _branch, worktreePath: _worktreePath, ...card } = baseCard;

    const parsedCard = yield* decodeKanbanCard(card);

    assert.strictEqual(parsedCard.branch, null);
    assert.strictEqual(parsedCard.worktreePath, null);
  }),
);

it.effect("rejects specPath, tasks, and worktree metadata on public card create commands", () =>
  Effect.gen(function* () {
    const createCommand = {
      type: "kanban.card.create",
      commandId: "cmd-1",
      boardId: "board-1",
      cardId: "card-1",
      projectId: "project-1",
      sourceThreadId: "thread-source",
      title: "Implement task",
      description: "Detailed spec",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.2",
      },
      runtimeMode: "approval-required",
      createdAt,
    };

    const parsed = yield* decodeClientKanbanCommand(createCommand);
    assert.strictEqual(parsed.type, "kanban.card.create");

    for (const forbidden of [
      { specPath: "docs/spec.md" },
      { tasks: [] },
      { branch: "feat/card-1" },
      { worktreePath: "/tmp/card-1" },
      { associatedWorktreePath: "/repo" },
      { associatedWorktreeBranch: "main" },
      { associatedWorktreeRef: "abc123" },
    ]) {
      const result = yield* Effect.exit(
        decodeClientKanbanCommand({
          ...createCommand,
          ...forbidden,
        }),
      );
      assert.strictEqual(result._tag, "Failure");
    }
  }),
);

it.effect("rejects specPath and worktree metadata on public card update commands", () =>
  Effect.gen(function* () {
    const updateCommand = {
      type: "kanban.card.update",
      commandId: "cmd-update",
      cardId: "card-1",
      title: "Updated task",
      updatedAt: createdAt,
    };

    const parsed = yield* decodeClientKanbanCommand(updateCommand);
    assert.strictEqual(parsed.type, "kanban.card.update");

    for (const forbidden of [
      { specPath: "docs/spec.md" },
      { branch: "feat/card-1" },
      { worktreePath: "/tmp/card-1" },
      { associatedWorktreePath: "/repo" },
      { associatedWorktreeBranch: "main" },
      { associatedWorktreeRef: "abc123" },
    ]) {
      const result = yield* Effect.exit(
        decodeClientKanbanCommand({
          ...updateCommand,
          ...forbidden,
        }),
      );
      assert.strictEqual(result._tag, "Failure");
    }
  }),
);

it.effect("rejects task mutation commands through public client command decoding", () =>
  Effect.gen(function* () {
    for (const command of [
      {
        type: "kanban.task.upsert",
        commandId: "cmd-task-upsert",
        cardId: "card-1",
        task: {
          taskId: "task-1",
          title: "Write test",
          status: "todo",
          order: 0,
        },
        updatedAt: createdAt,
      },
      {
        type: "kanban.task.delete",
        commandId: "cmd-task-delete",
        cardId: "card-1",
        taskId: "task-1",
        deletedAt: createdAt,
      },
    ]) {
      const publicResult = yield* Effect.exit(decodeClientKanbanCommand(command));
      assert.strictEqual(publicResult._tag, "Failure");

      const internalResult = yield* Effect.exit(decodeKanbanCommand(command));
      assert.strictEqual(internalResult._tag, "Success");
    }
  }),
);

it.effect("keeps worktree metadata mutation internal to the server command surface", () =>
  Effect.gen(function* () {
    const command = {
      type: "kanban.card.worktree.set",
      commandId: "cmd-worktree-set",
      cardId: "card-1",
      branch: "feat/card-1",
      worktreePath: "/tmp/card-1",
      associatedWorktreePath: "/repo",
      associatedWorktreeBranch: "main",
      associatedWorktreeRef: "abc123",
      updatedAt: createdAt,
    };

    const publicResult = yield* Effect.exit(decodeClientKanbanCommand(command));
    assert.strictEqual(publicResult._tag, "Failure");

    const internalResult = yield* Effect.exit(decodeKanbanCommand(command));
    assert.strictEqual(internalResult._tag, "Success");
  }),
);

it.effect("rejects unknown card status", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeKanbanCard({
        ...baseCard,
        status: "almost_done",
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects submit commands during Phase 1", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeKanbanCommand({
        type: "kanban.card.submit",
        commandId: "cmd-submit",
        cardId: "card-1",
        submittedAt: createdAt,
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects non-terminal run completion statuses", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeKanbanCommand({
        type: "kanban.run.complete",
        commandId: "cmd-run-complete",
        runId: "run-1",
        cardId: "card-1",
        status: "running",
        completedAt: createdAt,
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects internal commands through the Kanban dispatch RPC schema", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeKanbanRpcDispatchInput({
        type: "kanban.run.start",
        commandId: "cmd-run-start",
        runId: "run-1",
        cardId: "card-1",
        role: "worker",
        threadId: "thread-worker-1",
        startedAt: createdAt,
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects server-owned card statuses through the Kanban dispatch RPC schema", () =>
  Effect.gen(function* () {
    const approvedResult = yield* Effect.exit(
      decodeKanbanRpcDispatchInput({
        type: "kanban.card.status.set",
        commandId: "cmd-approve",
        cardId: "card-1",
        status: "approved",
        reason: "Reviewer approved",
        updatedAt: createdAt,
      }),
    );

    assert.strictEqual(approvedResult._tag, "Failure");

    const blockedResult = yield* Effect.exit(
      decodeKanbanRpcDispatchInput({
        type: "kanban.card.status.set",
        commandId: "cmd-block",
        cardId: "card-1",
        status: "blocked",
        reason: "Waiting on user",
        updatedAt: createdAt,
      }),
    );

    assert.strictEqual(blockedResult._tag, "Failure");
  }),
);

it.effect("rejects run-completed events with non-terminal run status", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeKanbanEvent({
        sequence: 1,
        eventId: "event-run-completed",
        aggregateKind: "card",
        aggregateId: "card-1",
        type: "kanban.run.completed",
        occurredAt: createdAt,
        commandId: "cmd-run-complete",
        causationEventId: null,
        correlationId: "cmd-run-complete",
        metadata: {},
        payload: {
          run: {
            id: "run-1",
            cardId: "card-1",
            role: "worker",
            status: "running",
            threadId: "thread-worker-1",
            startedAt: createdAt,
            completedAt: createdAt,
          },
        },
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes command, event, and read model schemas", () =>
  Effect.gen(function* () {
    const command = yield* decodeKanbanCommand({
      type: "kanban.card.create",
      commandId: "cmd-1",
      boardId: "board-1",
      cardId: "card-1",
      projectId: "project-1",
      sourceThreadId: "thread-source",
      title: "Implement task",
      description: "Detailed spec",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.2",
      },
      runtimeMode: "approval-required",
      createdAt,
    });
    assert.strictEqual(command.type, "kanban.card.create");

    const event = yield* decodeKanbanEvent({
      sequence: 1,
      eventId: "event-1",
      aggregateKind: "card",
      aggregateId: "card-1",
      type: "kanban.card.created",
      occurredAt: createdAt,
      commandId: "cmd-1",
      causationEventId: null,
      correlationId: "cmd-1",
      metadata: {},
      payload: {
        card: baseCard,
        tasks: [
          {
            id: "task-1",
            cardId: "card-1",
            title: "Write test",
            description: "Pin schema behavior",
            status: "todo",
            order: 0,
            createdAt,
            updatedAt: createdAt,
          },
        ],
      },
    });
    assert.strictEqual(event.type, "kanban.card.created");

    const readModel = yield* decodeKanbanReadModel({
      snapshotSequence: 1,
      updatedAt: createdAt,
      boards: [
        {
          id: "board-1",
          projectId: "project-1",
          title: "Project board",
          createdAt,
          updatedAt: createdAt,
        },
      ],
      cards: [baseCard],
      tasks: [],
      runs: [],
      reviews: [],
    });
    assert.strictEqual(readModel.cards[0]?.id, "card-1");

    const snapshot = yield* decodeKanbanBoardSnapshot({
      snapshotSequence: 1,
      board: readModel.boards[0],
      cards: [baseCard],
      tasksByCardId: {
        "card-1": [],
      },
      runsByCardId: {
        "card-1": [],
      },
      reviewsByCardId: {
        "card-1": [],
      },
    });
    assert.strictEqual(snapshot.board.id, "board-1");
  }),
);

it("exports Kanban websocket method and channel names", () => {
  assert.deepStrictEqual(KANBAN_WS_METHODS, {
    getSnapshot: "kanban.getSnapshot",
    dispatchCommand: "kanban.dispatchCommand",
    subscribeBoard: "kanban.subscribeBoard",
    unsubscribeBoard: "kanban.unsubscribeBoard",
  });
  assert.deepStrictEqual(KANBAN_WS_CHANNELS, {
    boardEvent: "kanban.boardEvent",
  });
});

it.effect("decodes Kanban RPC schemas keyed by websocket methods", () =>
  Effect.gen(function* () {
    const snapshotInput = yield* decodeKanbanGetSnapshotInput({
      boardId: "board-1",
    });
    assert.strictEqual(snapshotInput.boardId, "board-1");

    const receipt = yield* decodeKanbanDispatchCommandResult({
      sequence: 1,
    });
    assert.strictEqual(receipt.sequence, 1);

    const subscribeInput = yield* decodeKanbanSubscribeBoardInput({
      boardId: "board-1",
    });
    assert.strictEqual(subscribeInput.boardId, "board-1");

    const unsubscribeInput = yield* decodeKanbanUnsubscribeBoardInput({
      boardId: "board-1",
    });
    assert.strictEqual(unsubscribeInput.boardId, "board-1");

    assert.strictEqual(KanbanRpcSchemas.getSnapshot.input, KanbanGetSnapshotInput);
    assert.strictEqual(KanbanRpcSchemas.getSnapshot.output, KanbanBoardSnapshot);
    assert.strictEqual(KanbanRpcSchemas.dispatchCommand.input, ClientKanbanCommand);
    assert.strictEqual(KanbanClientCommand, ClientKanbanCommand);
    assert.strictEqual(KanbanRpcSchemas.dispatchCommand.output, KanbanDispatchCommandResult);
    assert.strictEqual(KanbanRpcSchemas.subscribeBoard.input, KanbanSubscribeBoardInput);
    assert.strictEqual(KanbanRpcSchemas.unsubscribeBoard.input, KanbanUnsubscribeBoardInput);
    assert.deepStrictEqual(Object.keys(KanbanRpcSchemas), Object.keys(KANBAN_WS_METHODS));
  }),
);
