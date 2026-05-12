import type { KanbanCard, KanbanEvent, KanbanRun } from "@t3tools/contracts";
import { Effect, Layer, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import { KanbanEventStore } from "../Services/KanbanEventStore.ts";
import {
  KanbanProjectionPipeline,
  type KanbanProjectionPipelineShape,
} from "../Services/KanbanProjectionPipeline.ts";

export const KANBAN_PROJECTOR_NAME = "kanban.projection";

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

const makeKanbanProjectionPipeline = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventStore = yield* KanbanEventStore;

  const readCursor = sql<{ readonly lastAppliedSequence: number }>`
    SELECT last_applied_sequence AS "lastAppliedSequence"
    FROM projection_kanban_state
    WHERE projector = ${KANBAN_PROJECTOR_NAME}
  `.pipe(
    Effect.map((rows) => rows[0]?.lastAppliedSequence ?? 0),
    Effect.mapError(toPersistenceSqlError("KanbanProjectionPipeline.readCursor:query")),
  );

  const advanceCursor = (event: KanbanEvent) =>
    sql`
      INSERT INTO projection_kanban_state (
        projector,
        last_applied_sequence,
        updated_at
      )
      VALUES (
        ${KANBAN_PROJECTOR_NAME},
        ${event.sequence},
        ${event.occurredAt}
      )
      ON CONFLICT (projector)
      DO UPDATE SET
        last_applied_sequence = excluded.last_applied_sequence,
        updated_at = excluded.updated_at
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("KanbanProjectionPipeline.advanceCursor:query")),
    );

  const upsertBoard = (
    board: Extract<KanbanEvent, { readonly type: "kanban.board.created" }>["payload"]["board"],
  ) =>
    sql`
      INSERT INTO projection_kanban_boards (
        board_id,
        project_id,
        title,
        created_at,
        updated_at
      )
      VALUES (
        ${board.id},
        ${board.projectId},
        ${board.title},
        ${board.createdAt},
        ${board.updatedAt}
      )
      ON CONFLICT (board_id)
      DO UPDATE SET
        project_id = excluded.project_id,
        title = excluded.title,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("KanbanProjectionPipeline.upsertBoard:query")),
    );

  const upsertCard = (card: KanbanCard) =>
    sql`
      INSERT INTO projection_kanban_cards (
        card_id,
        board_id,
        project_id,
        source_thread_id,
        worker_thread_ids_json,
        reviewer_thread_ids_json,
        title,
        description,
        spec_path,
        spec_json,
        status,
        model_selection_json,
        runtime_mode,
        branch,
        worktree_path,
        associated_worktree_path,
        associated_worktree_branch,
        associated_worktree_ref,
        blocker_reason,
        loop_count,
        max_loop_count,
        created_at,
        updated_at
      )
      VALUES (
        ${card.id},
        ${card.boardId},
        ${card.projectId},
        ${card.sourceThreadId},
        ${stringifyJson(card.workerThreadIds)},
        ${stringifyJson(card.reviewerThreadIds)},
        ${card.title},
        ${nullable(card.description)},
        ${nullable(card.specPath)},
        ${null},
        ${card.status},
        ${stringifyJson(card.modelSelection)},
        ${card.runtimeMode},
        ${card.branch},
        ${card.worktreePath},
        ${card.associatedWorktreePath},
        ${card.associatedWorktreeBranch},
        ${card.associatedWorktreeRef},
        ${card.blockerReason},
        ${card.loopCount},
        ${card.maxLoopCount},
        ${card.createdAt},
        ${card.updatedAt}
      )
      ON CONFLICT (card_id)
      DO UPDATE SET
        board_id = excluded.board_id,
        project_id = excluded.project_id,
        source_thread_id = excluded.source_thread_id,
        worker_thread_ids_json = excluded.worker_thread_ids_json,
        reviewer_thread_ids_json = excluded.reviewer_thread_ids_json,
        title = excluded.title,
        description = excluded.description,
        spec_path = excluded.spec_path,
        spec_json = excluded.spec_json,
        status = excluded.status,
        model_selection_json = excluded.model_selection_json,
        runtime_mode = excluded.runtime_mode,
        branch = excluded.branch,
        worktree_path = excluded.worktree_path,
        associated_worktree_path = excluded.associated_worktree_path,
        associated_worktree_branch = excluded.associated_worktree_branch,
        associated_worktree_ref = excluded.associated_worktree_ref,
        blocker_reason = excluded.blocker_reason,
        loop_count = excluded.loop_count,
        max_loop_count = excluded.max_loop_count,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("KanbanProjectionPipeline.upsertCard:query")),
    );

  const updateCardStatus = (input: {
    readonly cardId: string;
    readonly status: string;
    readonly blockerReason: string | null;
    readonly updatedAt: string;
  }) =>
    sql`
      UPDATE projection_kanban_cards
      SET
        status = ${input.status},
        blocker_reason = ${input.blockerReason},
        updated_at = ${input.updatedAt}
      WHERE card_id = ${input.cardId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("KanbanProjectionPipeline.updateCardStatus:query")),
    );

  const upsertTask = (
    task: Extract<KanbanEvent, { readonly type: "kanban.task.upserted" }>["payload"]["task"],
  ) =>
    sql`
      INSERT INTO projection_kanban_tasks (
        task_id,
        card_id,
        title,
        description,
        status,
        task_order,
        created_at,
        updated_at
      )
      VALUES (
        ${task.id},
        ${task.cardId},
        ${task.title},
        ${nullable(task.description)},
        ${task.status},
        ${task.order},
        ${task.createdAt},
        ${task.updatedAt}
      )
      ON CONFLICT (task_id)
      DO UPDATE SET
        card_id = excluded.card_id,
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        task_order = excluded.task_order,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("KanbanProjectionPipeline.upsertTask:query")),
    );

  const upsertRun = (run: KanbanRun) =>
    sql`
      INSERT INTO projection_kanban_runs (
        run_id,
        card_id,
        role,
        status,
        thread_id,
        started_at,
        completed_at,
        error_message,
        result_json,
        metadata_json
      )
      VALUES (
        ${run.id},
        ${run.cardId},
        ${run.role},
        ${run.status},
        ${nullable(run.threadId)},
        ${run.startedAt},
        ${nullable(run.completedAt)},
        ${nullable(run.errorMessage)},
        ${null},
        ${stringifyJson({})}
      )
      ON CONFLICT (run_id)
      DO UPDATE SET
        card_id = excluded.card_id,
        role = excluded.role,
        status = excluded.status,
        thread_id = excluded.thread_id,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        error_message = excluded.error_message,
        result_json = excluded.result_json,
        metadata_json = excluded.metadata_json
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("KanbanProjectionPipeline.upsertRun:query")),
    );

  const applyEvent = (event: KanbanEvent) => {
    switch (event.type) {
      case "kanban.board.created":
        return upsertBoard(event.payload.board);

      case "kanban.card.created":
        return Effect.all(
          [upsertCard(event.payload.card), Effect.forEach(event.payload.tasks, upsertTask)],
          { concurrency: 1 },
        ).pipe(Effect.asVoid);

      case "kanban.card.updated":
        return upsertCard(event.payload.card);

      case "kanban.card.status-changed":
        return updateCardStatus({
          cardId: event.payload.cardId,
          status: event.payload.toStatus,
          blockerReason: event.payload.toStatus === "blocked" ? event.payload.reason : null,
          updatedAt: event.payload.updatedAt,
        });

      case "kanban.task.upserted":
        return upsertTask(event.payload.task);

      case "kanban.task.deleted":
        return sql`
          DELETE FROM projection_kanban_tasks
          WHERE card_id = ${event.payload.cardId}
            AND task_id = ${event.payload.taskId}
        `.pipe(
          Effect.asVoid,
          Effect.mapError(toPersistenceSqlError("KanbanProjectionPipeline.deleteTask:query")),
        );

      case "kanban.run.started":
      case "kanban.run.completed":
        return upsertRun(event.payload.run);

      case "kanban.review.completed":
        return sql`
          INSERT INTO projection_kanban_reviews (
            review_id,
            card_id,
            run_id,
            reviewer_thread_id,
            outcome,
            summary,
            findings_json,
            completed_at
          )
          VALUES (
            ${event.payload.review.id},
            ${event.payload.review.cardId},
            ${event.payload.review.runId},
            ${event.payload.review.reviewerThreadId},
            ${event.payload.review.outcome},
            ${event.payload.review.summary},
            ${stringifyJson(event.payload.review.findings)},
            ${event.payload.review.completedAt}
          )
          ON CONFLICT (review_id)
          DO UPDATE SET
            card_id = excluded.card_id,
            run_id = excluded.run_id,
            reviewer_thread_id = excluded.reviewer_thread_id,
            outcome = excluded.outcome,
            summary = excluded.summary,
            findings_json = excluded.findings_json,
            completed_at = excluded.completed_at
        `.pipe(
          Effect.asVoid,
          Effect.mapError(toPersistenceSqlError("KanbanProjectionPipeline.upsertReview:query")),
        );

      case "kanban.card.blocked":
        return updateCardStatus({
          cardId: event.payload.cardId,
          status: "blocked",
          blockerReason: event.payload.reason,
          updatedAt: event.payload.blockedAt,
        });

      case "kanban.card.approved":
        return updateCardStatus({
          cardId: event.payload.cardId,
          status: "approved",
          blockerReason: null,
          updatedAt: event.payload.approvedAt,
        });

      case "kanban.card.ready-to-submit":
        return updateCardStatus({
          cardId: event.payload.cardId,
          status: "ready_to_submit",
          blockerReason: null,
          updatedAt: event.payload.readyAt,
        });
    }
  };

  const projectEvent: KanbanProjectionPipelineShape["projectEvent"] = (event) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const cursor = yield* readCursor;
          if (event.sequence <= cursor) {
            return;
          }
          yield* applyEvent(event);
          yield* advanceCursor(event);
        }),
      )
      .pipe(
        Effect.catchTag("SqlError", (sqlError) =>
          Effect.fail(
            toPersistenceSqlError("KanbanProjectionPipeline.projectEvent:transaction")(sqlError),
          ),
        ),
      );

  const bootstrap: KanbanProjectionPipelineShape["bootstrap"] = Effect.gen(function* () {
    const cursor = yield* readCursor;
    yield* Stream.runForEach(eventStore.readFromSequence(cursor), projectEvent);
  });

  return {
    bootstrap,
    projectEvent,
  } satisfies KanbanProjectionPipelineShape;
});

export const KanbanProjectionPipelineLive = Layer.effect(
  KanbanProjectionPipeline,
  makeKanbanProjectionPipeline,
);
