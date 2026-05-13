import { Layer } from "effect";

import { KanbanEngineLive } from "./Layers/KanbanEngine.ts";
import { KanbanEventStoreLive } from "./Layers/KanbanEventStore.ts";
import { KanbanProjectionPipelineLive } from "./Layers/KanbanProjectionPipeline.ts";
import { KanbanSnapshotQueryLive } from "./Layers/KanbanSnapshotQuery.ts";
import { KanbanWorkerCoordinatorLive } from "./Layers/KanbanWorkerCoordinator.ts";

export const KanbanProjectionPipelineLayerLive = KanbanProjectionPipelineLive.pipe(
  Layer.provide(KanbanEventStoreLive),
);

export const KanbanInfrastructureLayerLive = Layer.mergeAll(
  KanbanEventStoreLive,
  KanbanProjectionPipelineLayerLive,
  KanbanSnapshotQueryLive,
);

export const KanbanEngineLayerLive = KanbanEngineLive.pipe(
  Layer.provide(KanbanInfrastructureLayerLive),
);

export const KanbanLayerLive = Layer.mergeAll(
  KanbanInfrastructureLayerLive,
  KanbanEngineLayerLive,
);

export const KanbanWorkerCoordinatorLayerLive = KanbanWorkerCoordinatorLive.pipe(
  Layer.provide(KanbanLayerLive),
);
