import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe } from "vitest";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const withMemoryDb = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  effect.pipe(Effect.provide(NodeSqliteClient.layerMemory()));

const tableNames = (sql: SqlClient.SqlClient) =>
  sql<{ readonly name: string }>`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND (name LIKE 'projection_automation%' OR name LIKE 'automation_%')
    ORDER BY name ASC
  `.pipe(Effect.map((rows) => rows.map((row) => row.name)));

const columnNames = (sql: SqlClient.SqlClient, tableName: string) =>
  sql<{ readonly name: string }>`
    SELECT name FROM pragma_table_info(${tableName})
  `.pipe(Effect.map((rows) => rows.map((row) => row.name)));

const indexNames = (sql: SqlClient.SqlClient, tableName: string) =>
  sql<{ readonly name: string }>`
    SELECT name FROM pragma_index_list(${tableName})
  `.pipe(Effect.map((rows) => rows.map((row) => row.name)));

describe("038_AutomationDomain", () => {
  it.effect("creates automation event storage and projection tables", () =>
    withMemoryDb(Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 38 });

      assert.includeMembers(yield* tableNames(sql), [
        "automation_command_receipts",
        "automation_events",
        "projection_automation_runs",
        "projection_automation_state",
        "projection_automations",
      ]);

      assert.includeMembers(yield* columnNames(sql, "automation_events"), [
        "sequence",
        "event_id",
        "aggregate_kind",
        "stream_id",
        "stream_version",
        "event_type",
        "occurred_at",
        "command_id",
        "causation_event_id",
        "correlation_id",
        "actor_kind",
        "payload_json",
        "metadata_json",
      ]);

      assert.includeMembers(yield* columnNames(sql, "automation_command_receipts"), [
        "command_id",
        "aggregate_kind",
        "aggregate_id",
        "accepted_at",
        "result_sequence",
        "status",
        "error",
      ]);

      assert.includeMembers(yield* columnNames(sql, "projection_automations"), [
        "automation_id",
        "title",
        "prompt",
        "target_json",
        "schedule_json",
        "timezone",
        "status",
        "environment_mode",
        "write_policy_json",
        "model_selection_json",
        "runtime_mode",
        "result_thread_id",
        "next_run_at",
        "last_run_at",
        "created_at",
        "updated_at",
        "deleted_at",
      ]);

      assert.includeMembers(yield* columnNames(sql, "projection_automation_runs"), [
        "run_id",
        "automation_id",
        "status",
        "trigger",
        "result_thread_id",
        "orchestration_command_ids_json",
        "started_at",
        "completed_at",
        "error_message",
        "skipped_reason",
        "changed_files_json",
        "created_at",
        "updated_at",
      ]);

      assert.includeMembers(yield* columnNames(sql, "projection_automation_state"), [
        "projector",
        "last_applied_sequence",
        "updated_at",
      ]);

      assert.includeMembers(yield* indexNames(sql, "projection_automations"), [
        "idx_projection_automations_status_next_run",
        "idx_projection_automations_result_thread",
      ]);
      assert.includeMembers(yield* indexNames(sql, "projection_automation_runs"), [
        "idx_projection_automation_runs_automation_created",
        "idx_projection_automation_runs_automation_status",
      ]);
      assert.includeMembers(yield* indexNames(sql, "automation_events"), [
        "idx_automation_events_stream_version",
        "idx_automation_events_stream_sequence",
        "idx_automation_events_command_id",
        "idx_automation_events_correlation_id",
      ]);
      assert.includeMembers(yield* indexNames(sql, "automation_command_receipts"), [
        "idx_automation_command_receipts_aggregate",
        "idx_automation_command_receipts_sequence",
      ]);
    })),
  );
});
