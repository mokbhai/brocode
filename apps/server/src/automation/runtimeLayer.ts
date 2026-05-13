import { Layer } from "effect";

import { AutomationEngineLive } from "./Layers/AutomationEngine.ts";
import { AutomationEventStoreLive } from "./Layers/AutomationEventStore.ts";
import { AutomationProjectionPipelineLive } from "./Layers/AutomationProjectionPipeline.ts";
import { AutomationSnapshotQueryLive } from "./Layers/AutomationSnapshotQuery.ts";

export const AutomationProjectionPipelineLayerLive = AutomationProjectionPipelineLive.pipe(
  Layer.provide(AutomationEventStoreLive),
);

export const AutomationInfrastructureLayerLive = Layer.mergeAll(
  AutomationEventStoreLive,
  AutomationProjectionPipelineLayerLive,
  AutomationSnapshotQueryLive,
);

export const AutomationLayerLive = Layer.mergeAll(
  AutomationInfrastructureLayerLive,
  AutomationEngineLive.pipe(Layer.provide(AutomationInfrastructureLayerLive)),
);
