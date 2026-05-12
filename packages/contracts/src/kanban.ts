import { Schema } from "effect";
import {
  CommandId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { ModelSelection, RuntimeMode } from "./orchestration";

export const KANBAN_WS_METHODS = {
  getSnapshot: "kanban.getSnapshot",
  dispatchCommand: "kanban.dispatchCommand",
  subscribeBoard: "kanban.subscribeBoard",
  unsubscribeBoard: "kanban.unsubscribeBoard",
} as const;

export const KANBAN_WS_CHANNELS = {
  boardEvent: "kanban.boardEvent",
} as const;

export const KanbanBoardId = TrimmedNonEmptyString.pipe(Schema.brand("KanbanBoardId"));
export type KanbanBoardId = typeof KanbanBoardId.Type;
export const KanbanCardId = TrimmedNonEmptyString.pipe(Schema.brand("KanbanCardId"));
export type KanbanCardId = typeof KanbanCardId.Type;
export const KanbanTaskId = TrimmedNonEmptyString.pipe(Schema.brand("KanbanTaskId"));
export type KanbanTaskId = typeof KanbanTaskId.Type;
export const KanbanRunId = TrimmedNonEmptyString.pipe(Schema.brand("KanbanRunId"));
export type KanbanRunId = typeof KanbanRunId.Type;
export const KanbanReviewId = TrimmedNonEmptyString.pipe(Schema.brand("KanbanReviewId"));
export type KanbanReviewId = typeof KanbanReviewId.Type;

export const KanbanCardStatus = Schema.Literals([
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
export type KanbanCardStatus = typeof KanbanCardStatus.Type;

export const KanbanTaskStatus = Schema.Literals(["todo", "in_progress", "done", "blocked"]);
export type KanbanTaskStatus = typeof KanbanTaskStatus.Type;

export const KanbanRunRole = Schema.Literals(["worker", "reviewer"]);
export type KanbanRunRole = typeof KanbanRunRole.Type;

export const KanbanRunStatus = Schema.Literals(["running", "completed", "failed", "interrupted"]);
export type KanbanRunStatus = typeof KanbanRunStatus.Type;

export const KanbanRunTerminalStatus = Schema.Literals(["completed", "failed", "interrupted"]);
export type KanbanRunTerminalStatus = typeof KanbanRunTerminalStatus.Type;

export const KanbanReviewOutcome = Schema.Literals([
  "approved",
  "needs_work",
  "blocked",
  "inconclusive",
]);
export type KanbanReviewOutcome = typeof KanbanReviewOutcome.Type;

const NullableThreadId = Schema.optional(Schema.NullOr(ThreadId)).pipe(
  Schema.withDecodingDefault(() => null),
);
const NullableTrimmedString = Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
  Schema.withDecodingDefault(() => null),
);
const NullableBranchOrWorktree = Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
  Schema.withDecodingDefault(() => null),
);

export const KanbanBoard = Schema.Struct({
  id: KanbanBoardId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type KanbanBoard = typeof KanbanBoard.Type;

export const KanbanCard = Schema.Struct({
  id: KanbanCardId,
  boardId: KanbanBoardId,
  projectId: ProjectId,
  sourceThreadId: NullableThreadId,
  workerThreadIds: Schema.optional(Schema.Array(ThreadId)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  reviewerThreadIds: Schema.optional(Schema.Array(ThreadId)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  title: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  specPath: Schema.optional(TrimmedNonEmptyString),
  status: KanbanCardStatus,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  branch: NullableBranchOrWorktree,
  worktreePath: NullableBranchOrWorktree,
  associatedWorktreePath: NullableTrimmedString,
  associatedWorktreeBranch: NullableTrimmedString,
  associatedWorktreeRef: NullableTrimmedString,
  blockerReason: NullableTrimmedString,
  loopCount: NonNegativeInt,
  maxLoopCount: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type KanbanCard = typeof KanbanCard.Type;

export const KanbanTask = Schema.Struct({
  id: KanbanTaskId,
  cardId: KanbanCardId,
  title: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  status: KanbanTaskStatus,
  order: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type KanbanTask = typeof KanbanTask.Type;

export const KanbanRun = Schema.Struct({
  id: KanbanRunId,
  cardId: KanbanCardId,
  role: KanbanRunRole,
  status: KanbanRunStatus,
  threadId: Schema.optional(ThreadId),
  startedAt: IsoDateTime,
  completedAt: Schema.optional(IsoDateTime),
  errorMessage: Schema.optional(TrimmedNonEmptyString),
});
export type KanbanRun = typeof KanbanRun.Type;

export const KanbanCompletedRun = Schema.Struct({
  id: KanbanRunId,
  cardId: KanbanCardId,
  role: KanbanRunRole,
  status: KanbanRunTerminalStatus,
  threadId: Schema.optional(ThreadId),
  startedAt: IsoDateTime,
  completedAt: IsoDateTime,
  errorMessage: Schema.optional(TrimmedNonEmptyString),
});
export type KanbanCompletedRun = typeof KanbanCompletedRun.Type;

export const KanbanReview = Schema.Struct({
  id: KanbanReviewId,
  cardId: KanbanCardId,
  runId: KanbanRunId,
  reviewerThreadId: ThreadId,
  outcome: KanbanReviewOutcome,
  summary: TrimmedNonEmptyString,
  findings: Schema.Array(TrimmedNonEmptyString),
  completedAt: IsoDateTime,
});
export type KanbanReview = typeof KanbanReview.Type;

export const KanbanReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  updatedAt: IsoDateTime,
  boards: Schema.Array(KanbanBoard),
  cards: Schema.Array(KanbanCard),
  tasks: Schema.Array(KanbanTask),
  runs: Schema.Array(KanbanRun),
  reviews: Schema.Array(KanbanReview),
});
export type KanbanReadModel = typeof KanbanReadModel.Type;

export const KanbanBoardSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  board: KanbanBoard,
  cards: Schema.Array(KanbanCard),
  tasksByCardId: Schema.Record(KanbanCardId, Schema.Array(KanbanTask)),
  runsByCardId: Schema.Record(KanbanCardId, Schema.Array(KanbanRun)),
  reviewsByCardId: Schema.Record(KanbanCardId, Schema.Array(KanbanReview)),
});
export type KanbanBoardSnapshot = typeof KanbanBoardSnapshot.Type;

export const KanbanGetSnapshotInput = Schema.Struct({
  boardId: KanbanBoardId,
});
export type KanbanGetSnapshotInput = typeof KanbanGetSnapshotInput.Type;

export const KanbanDispatchCommandResult = Schema.Struct({
  sequence: NonNegativeInt,
});
export type KanbanDispatchCommandResult = typeof KanbanDispatchCommandResult.Type;

export const KanbanSubscribeBoardInput = Schema.Struct({
  boardId: KanbanBoardId,
});
export type KanbanSubscribeBoardInput = typeof KanbanSubscribeBoardInput.Type;

export const KanbanUnsubscribeBoardInput = KanbanSubscribeBoardInput;
export type KanbanUnsubscribeBoardInput = typeof KanbanUnsubscribeBoardInput.Type;

export const KanbanCreateTaskInput = Schema.Struct({
  taskId: KanbanTaskId,
  title: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  status: KanbanTaskStatus,
  order: NonNegativeInt,
});
export type KanbanCreateTaskInput = typeof KanbanCreateTaskInput.Type;

export const KanbanClientCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("kanban.board.create"),
    commandId: CommandId,
    boardId: KanbanBoardId,
    projectId: ProjectId,
    title: TrimmedNonEmptyString,
    createdAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("kanban.card.create"),
    commandId: CommandId,
    boardId: KanbanBoardId,
    cardId: KanbanCardId,
    projectId: ProjectId,
    sourceThreadId: NullableThreadId,
    title: TrimmedNonEmptyString,
    description: Schema.optional(TrimmedNonEmptyString),
    specPath: Schema.optional(TrimmedNonEmptyString),
    tasks: Schema.Array(KanbanCreateTaskInput),
    modelSelection: ModelSelection,
    runtimeMode: RuntimeMode,
    branch: NullableBranchOrWorktree,
    worktreePath: NullableBranchOrWorktree,
    associatedWorktreePath: NullableTrimmedString,
    associatedWorktreeBranch: NullableTrimmedString,
    associatedWorktreeRef: NullableTrimmedString,
    createdAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("kanban.card.update"),
    commandId: CommandId,
    cardId: KanbanCardId,
    title: Schema.optional(TrimmedNonEmptyString),
    description: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
    specPath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
    modelSelection: Schema.optional(ModelSelection),
    runtimeMode: Schema.optional(RuntimeMode),
    updatedAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("kanban.card.status.set"),
    commandId: CommandId,
    cardId: KanbanCardId,
    status: KanbanCardStatus,
    reason: NullableTrimmedString,
    updatedAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("kanban.task.upsert"),
    commandId: CommandId,
    cardId: KanbanCardId,
    task: KanbanCreateTaskInput,
    updatedAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("kanban.task.delete"),
    commandId: CommandId,
    cardId: KanbanCardId,
    taskId: KanbanTaskId,
    deletedAt: IsoDateTime,
  }),
]);
export type KanbanClientCommand = typeof KanbanClientCommand.Type;

export const KanbanInternalCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("kanban.run.start"),
    commandId: CommandId,
    runId: KanbanRunId,
    cardId: KanbanCardId,
    role: KanbanRunRole,
    threadId: ThreadId,
    startedAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("kanban.run.complete"),
    commandId: CommandId,
    runId: KanbanRunId,
    cardId: KanbanCardId,
    status: KanbanRunTerminalStatus,
    errorMessage: Schema.optional(TrimmedNonEmptyString),
    completedAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("kanban.review.complete"),
    commandId: CommandId,
    review: KanbanReview,
  }),
  Schema.Struct({
    type: Schema.Literal("kanban.card.block"),
    commandId: CommandId,
    cardId: KanbanCardId,
    reason: TrimmedNonEmptyString,
    blockedAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("kanban.card.approve"),
    commandId: CommandId,
    cardId: KanbanCardId,
    approvedAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("kanban.card.ready-to-submit"),
    commandId: CommandId,
    cardId: KanbanCardId,
    readyAt: IsoDateTime,
  }),
]);
export type KanbanInternalCommand = typeof KanbanInternalCommand.Type;

export const KanbanCommand = Schema.Union([KanbanClientCommand, KanbanInternalCommand]);
export type KanbanCommand = typeof KanbanCommand.Type;

export const KanbanEventMetadata = Schema.Struct({});
export type KanbanEventMetadata = typeof KanbanEventMetadata.Type;

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literals(["board", "card"]),
  aggregateId: Schema.Union([KanbanBoardId, KanbanCardId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: KanbanEventMetadata,
} as const;

export const KanbanEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("kanban.board.created"),
    payload: Schema.Struct({
      board: KanbanBoard,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("kanban.card.created"),
    payload: Schema.Struct({
      card: KanbanCard,
      tasks: Schema.Array(KanbanTask),
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("kanban.card.updated"),
    payload: Schema.Struct({
      card: KanbanCard,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("kanban.card.status-changed"),
    payload: Schema.Struct({
      cardId: KanbanCardId,
      fromStatus: KanbanCardStatus,
      toStatus: KanbanCardStatus,
      reason: NullableTrimmedString,
      updatedAt: IsoDateTime,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("kanban.task.upserted"),
    payload: Schema.Struct({
      task: KanbanTask,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("kanban.task.deleted"),
    payload: Schema.Struct({
      cardId: KanbanCardId,
      taskId: KanbanTaskId,
      deletedAt: IsoDateTime,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("kanban.run.started"),
    payload: Schema.Struct({
      run: KanbanRun,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("kanban.run.completed"),
    payload: Schema.Struct({
      run: KanbanCompletedRun,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("kanban.review.completed"),
    payload: Schema.Struct({
      review: KanbanReview,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("kanban.card.blocked"),
    payload: Schema.Struct({
      cardId: KanbanCardId,
      reason: TrimmedNonEmptyString,
      blockedAt: IsoDateTime,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("kanban.card.approved"),
    payload: Schema.Struct({
      cardId: KanbanCardId,
      approvedAt: IsoDateTime,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("kanban.card.ready-to-submit"),
    payload: Schema.Struct({
      cardId: KanbanCardId,
      readyAt: IsoDateTime,
    }),
  }),
]);
export type KanbanEvent = typeof KanbanEvent.Type;

export const KanbanRpcSchemas = {
  getSnapshot: {
    input: KanbanGetSnapshotInput,
    output: KanbanBoardSnapshot,
  },
  dispatchCommand: {
    input: KanbanClientCommand,
    output: KanbanDispatchCommandResult,
  },
  subscribeBoard: {
    input: KanbanSubscribeBoardInput,
    output: Schema.Void,
  },
  unsubscribeBoard: {
    input: KanbanUnsubscribeBoardInput,
    output: Schema.Void,
  },
} as const;
