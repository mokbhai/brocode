import {
  CommandId,
  IsoDateTime,
  KanbanBoardId,
  KanbanCardId,
  type KanbanEvent,
  NonNegativeInt,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

import type {
  OrchestrationCommandReceiptRepositoryError,
  OrchestrationEventStoreError,
} from "../../persistence/Errors.ts";

export const KanbanCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type KanbanCommandReceiptStatus = typeof KanbanCommandReceiptStatus.Type;

export const KanbanCommandReceipt = Schema.Struct({
  commandId: CommandId,
  aggregateKind: Schema.Literals(["board", "card"]),
  aggregateId: Schema.Union([KanbanBoardId, KanbanCardId]),
  acceptedAt: IsoDateTime,
  resultSequence: NonNegativeInt,
  status: KanbanCommandReceiptStatus,
  error: Schema.NullOr(Schema.String),
});
export type KanbanCommandReceipt = typeof KanbanCommandReceipt.Type;

export interface KanbanEventStoreShape {
  readonly append: (
    event: Omit<KanbanEvent, "sequence">,
  ) => Effect.Effect<KanbanEvent, OrchestrationEventStoreError>;

  readonly readFromSequence: (
    sequenceExclusive: number,
    limit?: number,
  ) => Stream.Stream<KanbanEvent, OrchestrationEventStoreError>;

  readonly readAll: () => Stream.Stream<KanbanEvent, OrchestrationEventStoreError>;

  readonly getCommandReceipt: (
    commandId: CommandId,
  ) => Effect.Effect<
    Option.Option<KanbanCommandReceipt>,
    OrchestrationCommandReceiptRepositoryError
  >;

  readonly upsertCommandReceipt: (
    receipt: KanbanCommandReceipt,
  ) => Effect.Effect<void, OrchestrationCommandReceiptRepositoryError>;
}

export class KanbanEventStore extends ServiceMap.Service<KanbanEventStore, KanbanEventStoreShape>()(
  "t3/kanban/Services/KanbanEventStore",
) {}
