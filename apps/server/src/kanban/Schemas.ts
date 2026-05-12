import {
  IsoDateTime,
  KanbanBoard,
  KanbanCard,
  KanbanCardId,
  KanbanCardStatus,
  KanbanCompletedRun,
  KanbanReview,
  KanbanRun,
  KanbanTask,
  KanbanTaskId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Schema } from "effect";

const NullableTrimmedString = Schema.NullOr(TrimmedNonEmptyString);

// Server-internal alias surface, backed by contract schemas as the source of truth.
export const KanbanBoardCreatedPayload = Schema.Struct({
  board: KanbanBoard,
});

export const KanbanCardCreatedPayload = Schema.Struct({
  card: KanbanCard,
  tasks: Schema.Array(KanbanTask),
});

export const KanbanCardUpdatedPayload = Schema.Struct({
  card: KanbanCard,
});

export const KanbanCardStatusChangedPayload = Schema.Struct({
  cardId: KanbanCardId,
  fromStatus: KanbanCardStatus,
  toStatus: KanbanCardStatus,
  reason: NullableTrimmedString,
  updatedAt: IsoDateTime,
});

export const KanbanTaskUpsertedPayload = Schema.Struct({
  task: KanbanTask,
});

export const KanbanTaskDeletedPayload = Schema.Struct({
  cardId: KanbanCardId,
  taskId: KanbanTaskId,
  deletedAt: IsoDateTime,
});

export const KanbanRunStartedPayload = Schema.Struct({
  run: KanbanRun,
});

export const KanbanRunCompletedPayload = Schema.Struct({
  run: KanbanCompletedRun,
});

export const KanbanReviewCompletedPayload = Schema.Struct({
  review: KanbanReview,
});

export const KanbanCardBlockedPayload = Schema.Struct({
  cardId: KanbanCardId,
  reason: TrimmedNonEmptyString,
  blockedAt: IsoDateTime,
});

export const KanbanCardApprovedPayload = Schema.Struct({
  cardId: KanbanCardId,
  approvedAt: IsoDateTime,
});

export const KanbanCardReadyToSubmitPayload = Schema.Struct({
  cardId: KanbanCardId,
  readyAt: IsoDateTime,
});
