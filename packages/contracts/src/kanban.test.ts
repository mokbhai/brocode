import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  KANBAN_WS_CHANNELS,
  KANBAN_WS_METHODS,
  KanbanBoardSnapshot,
  KanbanCard,
  KanbanCommand,
  KanbanEvent,
  KanbanReadModel,
} from "./kanban";

const decodeKanbanCard = Schema.decodeUnknownEffect(KanbanCard);
const decodeKanbanCommand = Schema.decodeUnknownEffect(KanbanCommand);
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
  specPath: "docs/spec.md",
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

it.effect("decodes a card without worker and reviewer thread links as empty arrays", () =>
  Effect.gen(function* () {
    const { workerThreadIds: _workerThreadIds, reviewerThreadIds: _reviewerThreadIds, ...card } =
      baseCard;

    const parsed = yield* decodeKanbanCard(card);

    assert.deepStrictEqual(parsed.workerThreadIds, []);
    assert.deepStrictEqual(parsed.reviewerThreadIds, []);
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
      specPath: "docs/spec.md",
      tasks: [
        {
          taskId: "task-1",
          title: "Write test",
          description: "Pin schema behavior",
          status: "todo",
          order: 0,
        },
      ],
      modelSelection: {
        provider: "codex",
        model: "gpt-5.2",
      },
      runtimeMode: "approval-required",
      branch: "feat/card-1",
      worktreePath: "/tmp/card-1",
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
