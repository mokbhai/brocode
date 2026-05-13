import type { AutomationReadModel, AutomationSnapshot } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface AutomationSnapshotQueryShape {
  readonly getReadModel: () => Effect.Effect<AutomationReadModel, ProjectionRepositoryError>;
  readonly getSnapshot: () => Effect.Effect<AutomationSnapshot, ProjectionRepositoryError>;
}

export class AutomationSnapshotQuery extends ServiceMap.Service<
  AutomationSnapshotQuery,
  AutomationSnapshotQueryShape
>()("t3/automation/Services/AutomationSnapshotQuery") {}
