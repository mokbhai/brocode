import type { KanbanStartWorkerRunInput, KanbanStartWorkerRunResult } from "@t3tools/contracts";
import { Schema, Scope, ServiceMap } from "effect";
import type { Effect } from "effect";

export class KanbanWorkerCoordinatorError extends Schema.TaggedErrorClass<KanbanWorkerCoordinatorError>()(
  "KanbanWorkerCoordinatorError",
  {
    reason: Schema.Literals([
      "not-found",
      "invalid-state",
      "worktree",
      "provider-dispatch",
      "summary-parse",
    ]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Kanban worker coordinator failed (${this.reason}): ${this.detail}`;
  }
}

export interface KanbanWorkerCoordinatorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly startWorkerRun: (
    input: KanbanStartWorkerRunInput,
  ) => Effect.Effect<KanbanStartWorkerRunResult, KanbanWorkerCoordinatorError>;
}

export class KanbanWorkerCoordinator extends ServiceMap.Service<
  KanbanWorkerCoordinator,
  KanbanWorkerCoordinatorShape
>()("t3/kanban/Services/KanbanWorkerCoordinator") {}
