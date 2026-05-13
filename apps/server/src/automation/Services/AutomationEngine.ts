import type { AutomationCommand, AutomationEvent, AutomationReadModel } from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

import type {
  OrchestrationCommandReceiptRepositoryError,
  OrchestrationEventStoreError,
  ProjectionRepositoryError,
} from "../../persistence/Errors.ts";
import type { AutomationCommandInvariantError } from "../decider.ts";
import type { AutomationProjectorDecodeError } from "../projector.ts";

export class AutomationCommandPreviouslyRejectedError extends Schema.TaggedErrorClass<AutomationCommandPreviouslyRejectedError>()(
  "AutomationCommandPreviouslyRejectedError",
  {
    commandId: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Automation command '${this.commandId}' was previously rejected: ${this.detail}`;
  }
}

export class AutomationCommandInternalError extends Schema.TaggedErrorClass<AutomationCommandInternalError>()(
  "AutomationCommandInternalError",
  {
    commandId: Schema.String,
    commandType: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Automation command '${this.commandId}' failed internally (${this.commandType}): ${this.detail}`;
  }
}

export type AutomationDispatchError =
  | AutomationCommandInvariantError
  | AutomationCommandPreviouslyRejectedError
  | AutomationCommandInternalError
  | AutomationProjectorDecodeError
  | OrchestrationCommandReceiptRepositoryError
  | OrchestrationEventStoreError
  | ProjectionRepositoryError;

export interface AutomationEngineShape {
  readonly getReadModel: () => Effect.Effect<AutomationReadModel>;
  readonly readEvents: (
    fromSequenceExclusive: number,
  ) => Stream.Stream<AutomationEvent, OrchestrationEventStoreError>;
  readonly dispatch: (
    command: AutomationCommand,
  ) => Effect.Effect<{ sequence: number }, AutomationDispatchError>;
  readonly streamDomainEvents: Stream.Stream<AutomationEvent>;
}

export class AutomationEngineService extends ServiceMap.Service<
  AutomationEngineService,
  AutomationEngineShape
>()("t3/automation/Services/AutomationEngine") {}
