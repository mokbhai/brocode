import type { KanbanEvent } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type {
  OrchestrationEventStoreError,
  ProjectionRepositoryError,
} from "../../persistence/Errors.ts";

export interface KanbanProjectionPipelineShape {
  readonly bootstrap: Effect.Effect<void, OrchestrationEventStoreError | ProjectionRepositoryError>;
  readonly projectEvent: (
    event: KanbanEvent,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class KanbanProjectionPipeline extends ServiceMap.Service<
  KanbanProjectionPipeline,
  KanbanProjectionPipelineShape
>()("t3/kanban/Services/KanbanProjectionPipeline") {}
