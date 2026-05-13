import type { AutomationEvent } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type {
  OrchestrationEventStoreError,
  ProjectionRepositoryError,
} from "../../persistence/Errors.ts";

export interface AutomationProjectionPipelineShape {
  readonly bootstrap: Effect.Effect<
    void,
    OrchestrationEventStoreError | ProjectionRepositoryError
  >;
  readonly projectEvent: (
    event: AutomationEvent,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class AutomationProjectionPipeline extends ServiceMap.Service<
  AutomationProjectionPipeline,
  AutomationProjectionPipelineShape
>()("t3/automation/Services/AutomationProjectionPipeline") {}
