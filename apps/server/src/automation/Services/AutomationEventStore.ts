import {
  AutomationId,
  AutomationRunId,
  CommandId,
  IsoDateTime,
  type AutomationEvent,
  NonNegativeInt,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

import type {
  OrchestrationCommandReceiptRepositoryError,
  OrchestrationEventStoreError,
} from "../../persistence/Errors.ts";

export const AutomationCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type AutomationCommandReceiptStatus = typeof AutomationCommandReceiptStatus.Type;

export const AutomationCommandReceipt = Schema.Struct({
  commandId: CommandId,
  aggregateKind: Schema.Literals(["automation", "automationRun"]),
  aggregateId: Schema.Union([AutomationId, AutomationRunId]),
  acceptedAt: IsoDateTime,
  resultSequence: NonNegativeInt,
  status: AutomationCommandReceiptStatus,
  error: Schema.NullOr(Schema.String),
});
export type AutomationCommandReceipt = typeof AutomationCommandReceipt.Type;

export interface AutomationEventStoreShape {
  readonly append: (
    event: Omit<AutomationEvent, "sequence">,
  ) => Effect.Effect<AutomationEvent, OrchestrationEventStoreError>;

  readonly readFromSequence: (
    sequenceExclusive: number,
    limit?: number,
  ) => Stream.Stream<AutomationEvent, OrchestrationEventStoreError>;

  readonly readAll: () => Stream.Stream<AutomationEvent, OrchestrationEventStoreError>;

  readonly getCommandReceipt: (
    commandId: CommandId,
  ) => Effect.Effect<
    Option.Option<AutomationCommandReceipt>,
    OrchestrationCommandReceiptRepositoryError
  >;

  readonly upsertCommandReceipt: (
    receipt: AutomationCommandReceipt,
  ) => Effect.Effect<void, OrchestrationCommandReceiptRepositoryError>;
}

export class AutomationEventStore extends ServiceMap.Service<
  AutomationEventStore,
  AutomationEventStoreShape
>()("t3/automation/Services/AutomationEventStore") {}
