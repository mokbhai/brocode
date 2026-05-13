import {
  KanbanBoardSnapshot,
  KanbanReadModel,
  type KanbanBoard,
  type KanbanCard,
  type KanbanReview,
  type KanbanRun,
  type KanbanTask,
} from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  isPersistenceError,
  type PersistenceDecodeError,
  toPersistenceDecodeCauseError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "../../persistence/Errors.ts";
import {
  KanbanSnapshotNotFoundError,
  KanbanSnapshotQuery,
  type KanbanSnapshotQueryShape,
} from "../Services/KanbanSnapshotQuery.ts";

const decodeReadModel = Schema.decodeUnknownEffect(KanbanReadModel);
const decodeBoardSnapshot = Schema.decodeUnknownEffect(KanbanBoardSnapshot);

interface BoardRow {
  readonly boardId: string;
  readonly projectId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface CardRow {
  readonly cardId: string;
  readonly boardId: string;
  readonly projectId: string;
  readonly sourceThreadId: string | null;
  readonly workerThreadIdsJson: string;
  readonly reviewerThreadIdsJson: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: string;
  readonly modelSelectionJson: string;
  readonly runtimeMode: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly associatedWorktreePath: string | null;
  readonly associatedWorktreeBranch: string | null;
  readonly associatedWorktreeRef: string | null;
  readonly blockerReason: string | null;
  readonly loopCount: number;
  readonly maxLoopCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface TaskRow {
  readonly taskId: string;
  readonly cardId: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: string;
  readonly taskOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RunRow {
  readonly runId: string;
  readonly cardId: string;
  readonly role: string;
  readonly status: string;
  readonly threadId: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly errorMessage: string | null;
}

interface ReviewRow {
  readonly reviewId: string;
  readonly cardId: string;
  readonly runId: string;
  readonly reviewerThreadId: string;
  readonly outcome: string;
  readonly summary: string;
  readonly findingsJson: string;
  readonly completedAt: string;
}

interface StateRow {
  readonly lastAppliedSequence: number;
  readonly updatedAt: string;
}

function parseJson(
  operation: string,
  value: string,
): Effect.Effect<unknown, PersistenceDecodeError> {
  return Effect.try({
    try: () => JSON.parse(value) as unknown,
    catch: (cause) => toPersistenceDecodeCauseError(operation)(cause),
  });
}

function optionalField<T>(name: string, value: T | null | undefined): Record<string, T> {
  return value === null || value === undefined ? {} : { [name]: value };
}

const makeKanbanSnapshotQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listBoards = sql<BoardRow>`
    SELECT
      board_id AS "boardId",
      project_id AS "projectId",
      title,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM projection_kanban_boards
    ORDER BY updated_at ASC, board_id ASC
  `.pipe(Effect.mapError(toPersistenceSqlError("KanbanSnapshotQuery.listBoards:query")));

  const listCards = sql<CardRow>`
    SELECT
      card_id AS "cardId",
      board_id AS "boardId",
      project_id AS "projectId",
      source_thread_id AS "sourceThreadId",
      worker_thread_ids_json AS "workerThreadIdsJson",
      reviewer_thread_ids_json AS "reviewerThreadIdsJson",
      title,
      description,
      status,
      model_selection_json AS "modelSelectionJson",
      runtime_mode AS "runtimeMode",
      branch,
      worktree_path AS "worktreePath",
      associated_worktree_path AS "associatedWorktreePath",
      associated_worktree_branch AS "associatedWorktreeBranch",
      associated_worktree_ref AS "associatedWorktreeRef",
      blocker_reason AS "blockerReason",
      loop_count AS "loopCount",
      max_loop_count AS "maxLoopCount",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM projection_kanban_cards
    ORDER BY updated_at ASC, card_id ASC
  `.pipe(Effect.mapError(toPersistenceSqlError("KanbanSnapshotQuery.listCards:query")));

  const listTasks = sql<TaskRow>`
    SELECT
      task_id AS "taskId",
      card_id AS "cardId",
      title,
      description,
      status,
      task_order AS "taskOrder",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM projection_kanban_tasks
    ORDER BY card_id ASC, task_order ASC, task_id ASC
  `.pipe(Effect.mapError(toPersistenceSqlError("KanbanSnapshotQuery.listTasks:query")));

  const listRuns = sql<RunRow>`
    SELECT
      run_id AS "runId",
      card_id AS "cardId",
      role,
      status,
      thread_id AS "threadId",
      started_at AS "startedAt",
      completed_at AS "completedAt",
      error_message AS "errorMessage"
    FROM projection_kanban_runs
    ORDER BY card_id ASC, started_at ASC, run_id ASC
  `.pipe(Effect.mapError(toPersistenceSqlError("KanbanSnapshotQuery.listRuns:query")));

  const listReviews = sql<ReviewRow>`
    SELECT
      review_id AS "reviewId",
      card_id AS "cardId",
      run_id AS "runId",
      reviewer_thread_id AS "reviewerThreadId",
      outcome,
      summary,
      findings_json AS "findingsJson",
      completed_at AS "completedAt"
    FROM projection_kanban_reviews
    ORDER BY card_id ASC, completed_at ASC, review_id ASC
  `.pipe(Effect.mapError(toPersistenceSqlError("KanbanSnapshotQuery.listReviews:query")));

  const readState = sql<StateRow>`
    SELECT
      last_applied_sequence AS "lastAppliedSequence",
      updated_at AS "updatedAt"
    FROM projection_kanban_state
    WHERE projector = 'kanban.projection'
  `.pipe(
    Effect.map((rows) => rows[0] ?? null),
    Effect.mapError(toPersistenceSqlError("KanbanSnapshotQuery.readState:query")),
  );

  const toCards = (rows: ReadonlyArray<CardRow>) =>
    Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        const workerThreadIds = yield* parseJson(
          "KanbanSnapshotQuery.decodeCard.workerThreadIds",
          row.workerThreadIdsJson,
        );
        const reviewerThreadIds = yield* parseJson(
          "KanbanSnapshotQuery.decodeCard.reviewerThreadIds",
          row.reviewerThreadIdsJson,
        );
        const modelSelection = yield* parseJson(
          "KanbanSnapshotQuery.decodeCard.modelSelection",
          row.modelSelectionJson,
        );

        return {
          id: row.cardId,
          boardId: row.boardId,
          projectId: row.projectId,
          sourceThreadId: row.sourceThreadId,
          workerThreadIds,
          reviewerThreadIds,
          title: row.title,
          ...optionalField("description", row.description),
          status: row.status,
          modelSelection,
          runtimeMode: row.runtimeMode,
          branch: row.branch,
          worktreePath: row.worktreePath,
          associatedWorktreePath: row.associatedWorktreePath,
          associatedWorktreeBranch: row.associatedWorktreeBranch,
          associatedWorktreeRef: row.associatedWorktreeRef,
          blockerReason: row.blockerReason,
          loopCount: row.loopCount,
          maxLoopCount: row.maxLoopCount,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      }),
    );

  const toReviews = (rows: ReadonlyArray<ReviewRow>) =>
    Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        const findings = yield* parseJson(
          "KanbanSnapshotQuery.decodeReview.findings",
          row.findingsJson,
        );
        return {
          id: row.reviewId,
          cardId: row.cardId,
          runId: row.runId,
          reviewerThreadId: row.reviewerThreadId,
          outcome: row.outcome,
          summary: row.summary,
          findings,
          completedAt: row.completedAt,
        };
      }),
    );

  const getReadModel: KanbanSnapshotQueryShape["getReadModel"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [boards, cardRows, taskRows, runRows, reviewRows, state] = yield* Effect.all(
            [listBoards, listCards, listTasks, listRuns, listReviews, readState],
            { concurrency: "unbounded" },
          );
          const cards = yield* toCards(cardRows);
          const reviews = yield* toReviews(reviewRows);
          const updatedAt =
            state?.updatedAt ??
            [...boards, ...cardRows, ...taskRows, ...runRows, ...reviewRows]
              .map((row) =>
                "updatedAt" in row
                  ? row.updatedAt
                  : "completedAt" in row
                    ? row.completedAt
                    : row.startedAt,
              )
              .sort()
              .at(-1) ??
            new Date(0).toISOString();

          return yield* decodeReadModel({
            snapshotSequence: state?.lastAppliedSequence ?? 0,
            updatedAt,
            boards: boards.map(
              (row): KanbanBoard => ({
                id: row.boardId,
                projectId: row.projectId,
                title: row.title,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
              }),
            ),
            cards,
            tasks: taskRows.map(
              (row): KanbanTask => ({
                id: row.taskId,
                cardId: row.cardId,
                title: row.title,
                ...optionalField("description", row.description),
                status: row.status as KanbanTask["status"],
                order: row.taskOrder,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
              }),
            ),
            runs: runRows.map(
              (row): KanbanRun => ({
                id: row.runId,
                cardId: row.cardId,
                role: row.role as KanbanRun["role"],
                status: row.status as KanbanRun["status"],
                ...optionalField("threadId", row.threadId),
                startedAt: row.startedAt,
                ...optionalField("completedAt", row.completedAt),
                ...optionalField("errorMessage", row.errorMessage),
              }),
            ),
            reviews,
          }).pipe(Effect.mapError(toPersistenceDecodeError("KanbanSnapshotQuery.decodeReadModel")));
        }),
      )
      .pipe(
        Effect.mapError((error) =>
          isPersistenceError(error)
            ? error
            : toPersistenceSqlError("KanbanSnapshotQuery.getReadModel:transaction")(error),
        ),
      );

  const getSnapshot: KanbanSnapshotQueryShape["getSnapshot"] = (input) =>
    Effect.gen(function* () {
      const readModel = yield* getReadModel();
      const board = readModel.boards.find((candidate) => candidate.id === input.boardId);
      if (!board) {
        return yield* new KanbanSnapshotNotFoundError({ boardId: input.boardId });
      }

      const cards = readModel.cards.filter((card) => card.boardId === input.boardId);
      const cardIds = new Set(cards.map((card) => card.id));
      const groupByCardId = <T extends { readonly cardId: string }>(entries: ReadonlyArray<T>) =>
        Object.fromEntries(
          cards.map((card) => [
            card.id,
            entries.filter((entry) => entry.cardId === card.id),
          ]),
        );

      return yield* decodeBoardSnapshot({
        snapshotSequence: readModel.snapshotSequence,
        board,
        cards,
        tasksByCardId: groupByCardId(readModel.tasks.filter((task) => cardIds.has(task.cardId))),
        runsByCardId: groupByCardId(readModel.runs.filter((run) => cardIds.has(run.cardId))),
        reviewsByCardId: groupByCardId(
          readModel.reviews.filter((review) => cardIds.has(review.cardId)),
        ),
      }).pipe(
        Effect.mapError(toPersistenceDecodeError("KanbanSnapshotQuery.decodeBoardSnapshot")),
      );
    });

  return {
    getReadModel,
    getSnapshot,
  } satisfies KanbanSnapshotQueryShape;
});

export const KanbanSnapshotQueryLive = Layer.effect(
  KanbanSnapshotQuery,
  makeKanbanSnapshotQuery,
);
