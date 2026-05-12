import type { KanbanCommand, KanbanEvent, KanbanReadModel } from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

import type {
  OrchestrationCommandReceiptRepositoryError,
  OrchestrationEventStoreError,
  ProjectionRepositoryError,
} from "../../persistence/Errors.ts";
import type { KanbanCommandInvariantError } from "../decider.ts";
import type { KanbanProjectorDecodeError } from "../projector.ts";

export class KanbanCommandPreviouslyRejectedError extends Schema.TaggedErrorClass<KanbanCommandPreviouslyRejectedError>()(
  "KanbanCommandPreviouslyRejectedError",
  {
    commandId: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Kanban command '${this.commandId}' was previously rejected: ${this.detail}`;
  }
}

export class KanbanCommandInternalError extends Schema.TaggedErrorClass<KanbanCommandInternalError>()(
  "KanbanCommandInternalError",
  {
    commandId: Schema.String,
    commandType: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Kanban command '${this.commandId}' failed internally (${this.commandType}): ${this.detail}`;
  }
}

export type KanbanDispatchError =
  | KanbanCommandInvariantError
  | KanbanCommandPreviouslyRejectedError
  | KanbanCommandInternalError
  | KanbanProjectorDecodeError
  | OrchestrationCommandReceiptRepositoryError
  | OrchestrationEventStoreError
  | ProjectionRepositoryError;

export interface KanbanEngineShape {
  readonly getReadModel: () => Effect.Effect<KanbanReadModel>;
  readonly readEvents: (
    fromSequenceExclusive: number,
  ) => Stream.Stream<KanbanEvent, OrchestrationEventStoreError>;
  readonly dispatch: (
    command: KanbanCommand,
  ) => Effect.Effect<{ sequence: number }, KanbanDispatchError>;
  readonly streamDomainEvents: Stream.Stream<KanbanEvent>;
}

export class KanbanEngineService extends ServiceMap.Service<KanbanEngineService, KanbanEngineShape>()(
  "t3/kanban/Services/KanbanEngine",
) {}
