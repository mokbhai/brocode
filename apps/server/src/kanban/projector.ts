import type {
  KanbanCard,
  KanbanCardId,
  KanbanEvent,
  KanbanReadModel,
  KanbanReview,
  KanbanRun,
  KanbanTask,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, Schema, SchemaIssue } from "effect";

import {
  KanbanBoardCreatedPayload,
  KanbanCardApprovedPayload,
  KanbanCardBlockedPayload,
  KanbanCardCreatedPayload,
  KanbanCardReadyToSubmitPayload,
  KanbanCardStatusChangedPayload,
  KanbanCardUpdatedPayload,
  KanbanReviewCompletedPayload,
  KanbanRunCompletedPayload,
  KanbanRunStartedPayload,
  KanbanTaskDeletedPayload,
  KanbanTaskUpsertedPayload,
} from "./Schemas.ts";

type CardPatch = Partial<Omit<KanbanCard, "id">>;

export class KanbanProjectorDecodeError extends Schema.TaggedErrorClass<KanbanProjectorDecodeError>()(
  "KanbanProjectorDecodeError",
  {
    eventType: Schema.String,
    issue: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Kanban projector decode failed for ${this.eventType}: ${this.issue}`;
  }
}

function toKanbanProjectorDecodeError(eventType: string) {
  return (error: Schema.SchemaError): KanbanProjectorDecodeError =>
    new KanbanProjectorDecodeError({
      eventType,
      issue: SchemaIssue.makeFormatterDefault()(error.issue),
      cause: error,
    });
}

function decodeForEvent<A>(
  schema: Schema.Schema<A>,
  value: unknown,
  eventType: KanbanEvent["type"],
): Effect.Effect<A, KanbanProjectorDecodeError> {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(schema as any)(value) as A,
    catch: (error) => toKanbanProjectorDecodeError(eventType)(error as Schema.SchemaError),
  });
}

function upsertById<T extends { readonly id: string }>(
  entries: ReadonlyArray<T>,
  next: T,
): ReadonlyArray<T> {
  return entries.some((entry) => entry.id === next.id)
    ? entries.map((entry) => (entry.id === next.id ? next : entry))
    : [...entries, next];
}

function updateCard(
  cards: ReadonlyArray<KanbanCard>,
  cardId: KanbanCardId,
  patch: CardPatch,
): ReadonlyArray<KanbanCard> {
  return cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card));
}

function appendUnique<T extends string>(entries: ReadonlyArray<T>, entry: T): ReadonlyArray<T> {
  return entries.includes(entry) ? entries : [...entries, entry];
}

function patchCardThread(
  cards: ReadonlyArray<KanbanCard>,
  run: KanbanRun | KanbanReview,
  threadId: ThreadId,
  role: "worker" | "reviewer",
): ReadonlyArray<KanbanCard> {
  return cards.map((card) => {
    if (card.id !== run.cardId) return card;
    return role === "worker"
      ? { ...card, workerThreadIds: appendUnique(card.workerThreadIds, threadId) }
      : { ...card, reviewerThreadIds: appendUnique(card.reviewerThreadIds, threadId) };
  });
}

function upsertTasks(
  tasks: ReadonlyArray<KanbanTask>,
  nextTasks: ReadonlyArray<KanbanTask>,
): ReadonlyArray<KanbanTask> {
  return nextTasks.reduce((current, task) => upsertById(current, task), tasks);
}

export function createEmptyKanbanReadModel(nowIso: string): KanbanReadModel {
  return {
    snapshotSequence: 0,
    updatedAt: nowIso,
    boards: [],
    cards: [],
    tasks: [],
    runs: [],
    reviews: [],
  };
}

export function projectKanbanEvent(
  model: KanbanReadModel,
  event: KanbanEvent,
): Effect.Effect<KanbanReadModel, KanbanProjectorDecodeError> {
  const nextBase: KanbanReadModel = {
    ...model,
    snapshotSequence: event.sequence,
    updatedAt: event.occurredAt,
  };

  switch (event.type) {
    case "kanban.board.created":
      return decodeForEvent(KanbanBoardCreatedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          boards: upsertById(nextBase.boards, payload.board),
        })),
      );

    case "kanban.card.created":
      return decodeForEvent(KanbanCardCreatedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: upsertById(nextBase.cards, payload.card),
          tasks: upsertTasks(nextBase.tasks, payload.tasks),
        })),
      );

    case "kanban.card.updated":
      return decodeForEvent(KanbanCardUpdatedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: upsertById(nextBase.cards, payload.card),
        })),
      );

    case "kanban.card.status-changed":
      return decodeForEvent(KanbanCardStatusChangedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: updateCard(nextBase.cards, payload.cardId, {
            status: payload.toStatus,
            blockerReason: payload.toStatus === "blocked" ? payload.reason : null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "kanban.task.upserted":
      return decodeForEvent(KanbanTaskUpsertedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: upsertById(nextBase.tasks, payload.task),
        })),
      );

    case "kanban.task.deleted":
      return decodeForEvent(KanbanTaskDeletedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          tasks: nextBase.tasks.filter(
            (task) => task.cardId !== payload.cardId || task.id !== payload.taskId,
          ),
        })),
      );

    case "kanban.run.started":
      return decodeForEvent(KanbanRunStartedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards:
            payload.run.threadId === undefined
              ? nextBase.cards
              : patchCardThread(nextBase.cards, payload.run, payload.run.threadId, payload.run.role),
          runs: upsertById(nextBase.runs, payload.run),
        })),
      );

    case "kanban.run.completed":
      return decodeForEvent(KanbanRunCompletedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          runs: upsertById(nextBase.runs, payload.run),
        })),
      );

    case "kanban.review.completed":
      return decodeForEvent(KanbanReviewCompletedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: patchCardThread(
            nextBase.cards,
            payload.review,
            payload.review.reviewerThreadId,
            "reviewer",
          ),
          reviews: upsertById(nextBase.reviews, payload.review),
        })),
      );

    case "kanban.card.blocked":
      return decodeForEvent(KanbanCardBlockedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: updateCard(nextBase.cards, payload.cardId, {
            status: "blocked",
            blockerReason: payload.reason,
            updatedAt: payload.blockedAt,
          }),
        })),
      );

    case "kanban.card.approved":
      return decodeForEvent(KanbanCardApprovedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: updateCard(nextBase.cards, payload.cardId, {
            status: "approved",
            blockerReason: null,
            updatedAt: payload.approvedAt,
          }),
        })),
      );

    case "kanban.card.ready-to-submit":
      return decodeForEvent(KanbanCardReadyToSubmitPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: updateCard(nextBase.cards, payload.cardId, {
            status: "ready_to_submit",
            blockerReason: null,
            updatedAt: payload.readyAt,
          }),
        })),
      );
  }
}
