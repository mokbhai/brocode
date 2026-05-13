import type { Automation, AutomationEvent, AutomationRun } from "@t3tools/contracts";
import { Effect, Layer, Semaphore, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceSqlError, toPersistenceSqlError } from "../../persistence/Errors.ts";
import { AutomationEventStore } from "../Services/AutomationEventStore.ts";
import {
  AutomationProjectionPipeline,
  type AutomationProjectionPipelineShape,
} from "../Services/AutomationProjectionPipeline.ts";

export const AUTOMATION_PROJECTOR_NAME = "automation.projection";

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

const makeAutomationProjectionPipeline = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventStore = yield* AutomationEventStore;
  const projectionSemaphore = yield* Semaphore.make(1);

  const readCursor = sql<{ readonly lastAppliedSequence: number }>`
    SELECT last_applied_sequence AS "lastAppliedSequence"
    FROM projection_automation_state
    WHERE projector = ${AUTOMATION_PROJECTOR_NAME}
  `.pipe(
    Effect.map((rows) => rows[0]?.lastAppliedSequence ?? 0),
    Effect.mapError(toPersistenceSqlError("AutomationProjectionPipeline.readCursor:query")),
  );

  const advanceCursor = (event: AutomationEvent) =>
    sql`
      INSERT INTO projection_automation_state (
        projector,
        last_applied_sequence,
        updated_at
      )
      VALUES (
        ${AUTOMATION_PROJECTOR_NAME},
        ${event.sequence},
        ${event.occurredAt}
      )
      ON CONFLICT (projector)
      DO UPDATE SET
        last_applied_sequence = excluded.last_applied_sequence,
        updated_at = excluded.updated_at
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("AutomationProjectionPipeline.advanceCursor:query")),
    );

  const upsertAutomation = (automation: Automation) =>
    sql`
      INSERT INTO projection_automations (
        automation_id,
        title,
        prompt,
        target_json,
        schedule_json,
        timezone,
        status,
        environment_mode,
        write_policy_json,
        model_selection_json,
        runtime_mode,
        result_thread_id,
        next_run_at,
        last_run_at,
        created_at,
        updated_at,
        deleted_at
      )
      VALUES (
        ${automation.id},
        ${automation.title},
        ${automation.prompt},
        ${stringifyJson(automation.target)},
        ${stringifyJson(automation.schedule)},
        ${automation.timezone},
        ${automation.status},
        ${automation.environmentMode},
        ${stringifyJson(automation.writePolicy)},
        ${stringifyJson(automation.modelSelection)},
        ${automation.runtimeMode},
        ${nullable(automation.resultThreadId)},
        ${nullable(automation.nextRunAt)},
        ${nullable(automation.lastRunAt)},
        ${automation.createdAt},
        ${automation.updatedAt},
        ${nullable(automation.deletedAt)}
      )
      ON CONFLICT (automation_id)
      DO UPDATE SET
        title = excluded.title,
        prompt = excluded.prompt,
        target_json = excluded.target_json,
        schedule_json = excluded.schedule_json,
        timezone = excluded.timezone,
        status = excluded.status,
        environment_mode = excluded.environment_mode,
        write_policy_json = excluded.write_policy_json,
        model_selection_json = excluded.model_selection_json,
        runtime_mode = excluded.runtime_mode,
        result_thread_id = excluded.result_thread_id,
        next_run_at = excluded.next_run_at,
        last_run_at = excluded.last_run_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("AutomationProjectionPipeline.upsertAutomation:query")),
    );

  const updateAutomationStatus = (input: {
    readonly automationId: string;
    readonly status: string;
    readonly updatedAt: string;
  }) =>
    sql`
      UPDATE projection_automations
      SET
        status = ${input.status},
        updated_at = ${input.updatedAt}
      WHERE automation_id = ${input.automationId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(
        toPersistenceSqlError("AutomationProjectionPipeline.updateAutomationStatus:query"),
      ),
    );

  const markAutomationDeleted = (input: {
    readonly automationId: string;
    readonly deletedAt: string;
  }) =>
    sql`
      UPDATE projection_automations
      SET
        status = 'deleted',
        deleted_at = ${input.deletedAt},
        updated_at = ${input.deletedAt}
      WHERE automation_id = ${input.automationId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(
        toPersistenceSqlError("AutomationProjectionPipeline.markAutomationDeleted:query"),
      ),
    );

  const upsertRun = (run: AutomationRun) =>
    sql`
      INSERT INTO projection_automation_runs (
        run_id,
        automation_id,
        status,
        trigger,
        result_thread_id,
        orchestration_command_ids_json,
        started_at,
        completed_at,
        error_message,
        skipped_reason,
        changed_files_json,
        created_at,
        updated_at
      )
      VALUES (
        ${run.id},
        ${run.automationId},
        ${run.status},
        ${run.trigger},
        ${nullable(run.resultThreadId)},
        ${stringifyJson(run.orchestrationCommandIds)},
        ${nullable(run.startedAt)},
        ${nullable(run.completedAt)},
        ${nullable(run.errorMessage)},
        ${nullable(run.skippedReason)},
        ${stringifyJson(run.changedFiles)},
        ${run.createdAt},
        ${run.updatedAt}
      )
      ON CONFLICT (run_id)
      DO UPDATE SET
        automation_id = excluded.automation_id,
        status = excluded.status,
        trigger = excluded.trigger,
        result_thread_id = excluded.result_thread_id,
        orchestration_command_ids_json = excluded.orchestration_command_ids_json,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        error_message = excluded.error_message,
        skipped_reason = excluded.skipped_reason,
        changed_files_json = excluded.changed_files_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("AutomationProjectionPipeline.upsertRun:query")),
    );

  const applyEvent = (event: AutomationEvent) => {
    switch (event.type) {
      case "automation.created":
      case "automation.updated":
        return upsertAutomation(event.payload.automation);

      case "automation.status-changed":
        return updateAutomationStatus({
          automationId: event.payload.automationId,
          status: event.payload.toStatus,
          updatedAt: event.payload.updatedAt,
        });

      case "automation.deleted":
        return markAutomationDeleted({
          automationId: event.payload.automationId,
          deletedAt: event.payload.deletedAt,
        });

      case "automation.run-created":
      case "automation.run-started":
      case "automation.run-completed":
        return upsertRun(event.payload.run);
    }
  };

  const projectEvent: AutomationProjectionPipelineShape["projectEvent"] = (event) =>
    projectionSemaphore
      .withPermits(1)(
        sql.withTransaction(
          Effect.gen(function* () {
            const cursor = yield* readCursor;
            if (event.sequence <= cursor) {
              return;
            }
            if (event.sequence !== cursor + 1) {
              return yield* new PersistenceSqlError({
                operation: "AutomationProjectionPipeline.projectEvent:sequence",
                detail: `Cannot project sequence ${event.sequence}; expected ${cursor + 1}.`,
              });
            }
            yield* applyEvent(event);
            yield* advanceCursor(event);
          }),
        ),
      )
      .pipe(
        Effect.catchTag("SqlError", (sqlError) =>
          Effect.fail(
            toPersistenceSqlError("AutomationProjectionPipeline.projectEvent:transaction")(
              sqlError,
            ),
          ),
        ),
      );

  const bootstrap: AutomationProjectionPipelineShape["bootstrap"] = Effect.gen(function* () {
    const cursor = yield* readCursor;
    yield* Stream.runForEach(
      eventStore.readFromSequence(cursor, Number.MAX_SAFE_INTEGER),
      projectEvent,
    );
  });

  return {
    bootstrap,
    projectEvent,
  } satisfies AutomationProjectionPipelineShape;
});

export const AutomationProjectionPipelineLive = Layer.effect(
  AutomationProjectionPipeline,
  makeAutomationProjectionPipeline,
);
