import { Layer } from "effect";

import { KanbanEngineLive } from "./Layers/KanbanEngine.ts";
import { KanbanEventStoreLive } from "./Layers/KanbanEventStore.ts";
import { KanbanProjectionPipelineLive } from "./Layers/KanbanProjectionPipeline.ts";
import { KanbanSnapshotQueryLive } from "./Layers/KanbanSnapshotQuery.ts";

export const KanbanProjectionPipelineLayerLive = KanbanProjectionPipelineLive.pipe(
  Layer.provide(KanbanEventStoreLive),
);

export const KanbanInfrastructureLayerLive = Layer.mergeAll(
  KanbanEventStoreLive,
  KanbanProjectionPipelineLayerLive,
  KanbanSnapshotQueryLive,
);

export const KanbanLayerLive = Layer.mergeAll(
  KanbanInfrastructureLayerLive,
  KanbanEngineLive.pipe(Layer.provide(KanbanInfrastructureLayerLive)),
);
