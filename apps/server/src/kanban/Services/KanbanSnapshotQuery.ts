import type {
  KanbanBoardSnapshot,
  KanbanGetSnapshotInput,
  KanbanReadModel,
} from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export class KanbanSnapshotNotFoundError extends Schema.TaggedErrorClass<KanbanSnapshotNotFoundError>()(
  "KanbanSnapshotNotFoundError",
  {
    boardId: Schema.String,
  },
) {
  override get message(): string {
    return `Kanban board '${this.boardId}' was not found in the projection snapshot.`;
  }
}

export type KanbanSnapshotQueryError = ProjectionRepositoryError | KanbanSnapshotNotFoundError;

export interface KanbanSnapshotQueryShape {
  readonly getReadModel: () => Effect.Effect<KanbanReadModel, ProjectionRepositoryError>;
  readonly getSnapshot: (
    input: KanbanGetSnapshotInput,
  ) => Effect.Effect<KanbanBoardSnapshot, KanbanSnapshotQueryError>;
}

export class KanbanSnapshotQuery extends ServiceMap.Service<
  KanbanSnapshotQuery,
  KanbanSnapshotQueryShape
>()("t3/kanban/Services/KanbanSnapshotQuery") {}
