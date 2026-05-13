import {
  AutomationReadModel,
  AutomationSnapshot,
  type Automation,
  type AutomationRun,
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
  AutomationSnapshotQuery,
  type AutomationSnapshotQueryShape,
} from "../Services/AutomationSnapshotQuery.ts";
import { AUTOMATION_PROJECTOR_NAME } from "./AutomationProjectionPipeline.ts";

const decodeReadModel = Schema.decodeUnknownEffect(AutomationReadModel);
const decodeSnapshot = Schema.decodeUnknownEffect(AutomationSnapshot);

interface AutomationRow {
  readonly automationId: string;
  readonly title: string;
  readonly prompt: string;
  readonly targetJson: string;
  readonly scheduleJson: string;
  readonly timezone: string;
  readonly status: string;
  readonly environmentMode: string;
  readonly writePolicyJson: string;
  readonly modelSelectionJson: string;
  readonly runtimeMode: string;
  readonly resultThreadId: string | null;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

interface RunRow {
  readonly runId: string;
  readonly automationId: string;
  readonly status: string;
  readonly trigger: string;
  readonly resultThreadId: string | null;
  readonly orchestrationCommandIdsJson: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly errorMessage: string | null;
  readonly skippedReason: string | null;
  readonly changedFilesJson: string;
  readonly createdAt: string;
  readonly updatedAt: string;
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

const makeAutomationSnapshotQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listAutomations = sql<AutomationRow>`
    SELECT
      automation_id AS "automationId",
      title,
      prompt,
      target_json AS "targetJson",
      schedule_json AS "scheduleJson",
      timezone,
      status,
      environment_mode AS "environmentMode",
      write_policy_json AS "writePolicyJson",
      model_selection_json AS "modelSelectionJson",
      runtime_mode AS "runtimeMode",
      result_thread_id AS "resultThreadId",
      next_run_at AS "nextRunAt",
      last_run_at AS "lastRunAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      deleted_at AS "deletedAt"
    FROM projection_automations
    ORDER BY updated_at DESC, automation_id ASC
  `.pipe(Effect.mapError(toPersistenceSqlError("AutomationSnapshotQuery.listAutomations:query")));

  const listRuns = sql<RunRow>`
    SELECT
      run_id AS "runId",
      automation_id AS "automationId",
      status,
      trigger,
      result_thread_id AS "resultThreadId",
      orchestration_command_ids_json AS "orchestrationCommandIdsJson",
      started_at AS "startedAt",
      completed_at AS "completedAt",
      error_message AS "errorMessage",
      skipped_reason AS "skippedReason",
      changed_files_json AS "changedFilesJson",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM projection_automation_runs
    ORDER BY automation_id ASC, created_at ASC, run_id ASC
  `.pipe(Effect.mapError(toPersistenceSqlError("AutomationSnapshotQuery.listRuns:query")));

  const readState = sql<StateRow>`
    SELECT
      last_applied_sequence AS "lastAppliedSequence",
      updated_at AS "updatedAt"
    FROM projection_automation_state
    WHERE projector = ${AUTOMATION_PROJECTOR_NAME}
  `.pipe(
    Effect.map((rows) => rows[0] ?? null),
    Effect.mapError(toPersistenceSqlError("AutomationSnapshotQuery.readState:query")),
  );

  const toAutomations = (rows: ReadonlyArray<AutomationRow>) =>
    Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        const target = yield* parseJson(
          "AutomationSnapshotQuery.decodeAutomation.target",
          row.targetJson,
        );
        const schedule = yield* parseJson(
          "AutomationSnapshotQuery.decodeAutomation.schedule",
          row.scheduleJson,
        );
        const writePolicy = yield* parseJson(
          "AutomationSnapshotQuery.decodeAutomation.writePolicy",
          row.writePolicyJson,
        );
        const modelSelection = yield* parseJson(
          "AutomationSnapshotQuery.decodeAutomation.modelSelection",
          row.modelSelectionJson,
        );

        return {
          id: row.automationId,
          title: row.title,
          prompt: row.prompt,
          target,
          schedule,
          timezone: row.timezone,
          status: row.status,
          environmentMode: row.environmentMode,
          writePolicy,
          modelSelection,
          runtimeMode: row.runtimeMode,
          resultThreadId: row.resultThreadId,
          nextRunAt: row.nextRunAt,
          lastRunAt: row.lastRunAt,
          deletedAt: row.deletedAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      }),
    );

  const toRuns = (rows: ReadonlyArray<RunRow>) =>
    Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        const orchestrationCommandIds = yield* parseJson(
          "AutomationSnapshotQuery.decodeRun.orchestrationCommandIds",
          row.orchestrationCommandIdsJson,
        );
        const changedFiles = yield* parseJson(
          "AutomationSnapshotQuery.decodeRun.changedFiles",
          row.changedFilesJson,
        );

        return {
          id: row.runId,
          automationId: row.automationId,
          status: row.status,
          trigger: row.trigger,
          resultThreadId: row.resultThreadId,
          orchestrationCommandIds,
          startedAt: row.startedAt,
          completedAt: row.completedAt,
          errorMessage: row.errorMessage,
          skippedReason: row.skippedReason,
          changedFiles,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      }),
    );

  const getReadModel: AutomationSnapshotQueryShape["getReadModel"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [automationRows, runRows, state] = yield* Effect.all(
            [listAutomations, listRuns, readState],
            { concurrency: "unbounded" },
          );
          const automations = yield* toAutomations(automationRows);
          const runs = yield* toRuns(runRows);
          const updatedAt =
            state?.updatedAt ??
            [...automationRows, ...runRows].map((row) => row.updatedAt).sort().at(-1) ??
            new Date(0).toISOString();

          return yield* decodeReadModel({
            snapshotSequence: state?.lastAppliedSequence ?? 0,
            updatedAt,
            automations,
            runs,
          }).pipe(
            Effect.mapError(toPersistenceDecodeError("AutomationSnapshotQuery.decodeReadModel")),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) =>
          isPersistenceError(error)
            ? error
            : toPersistenceSqlError("AutomationSnapshotQuery.getReadModel:transaction")(error),
        ),
      );

  const getSnapshot: AutomationSnapshotQueryShape["getSnapshot"] = () =>
    Effect.gen(function* () {
      const readModel = yield* getReadModel();
      const runsByAutomationId = Object.fromEntries(
        readModel.automations.map((automation) => [
          automation.id,
          readModel.runs.filter((run) => run.automationId === automation.id),
        ]),
      );

      return yield* decodeSnapshot({
        snapshotSequence: readModel.snapshotSequence,
        automations: readModel.automations as ReadonlyArray<Automation>,
        runsByAutomationId: runsByAutomationId as Record<string, ReadonlyArray<AutomationRun>>,
      }).pipe(
        Effect.mapError(toPersistenceDecodeError("AutomationSnapshotQuery.decodeSnapshot")),
      );
    });

  return {
    getReadModel,
    getSnapshot,
  } satisfies AutomationSnapshotQueryShape;
});

export const AutomationSnapshotQueryLive = Layer.effect(
  AutomationSnapshotQuery,
  makeAutomationSnapshotQuery,
);
