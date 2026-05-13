import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS automation_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      aggregate_kind TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      stream_version INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      command_id TEXT,
      causation_event_id TEXT,
      correlation_id TEXT,
      actor_kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_events_stream_version
    ON automation_events(aggregate_kind, stream_id, stream_version)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_events_stream_sequence
    ON automation_events(aggregate_kind, stream_id, sequence)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_events_command_id
    ON automation_events(command_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_events_correlation_id
    ON automation_events(correlation_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS automation_command_receipts (
      command_id TEXT PRIMARY KEY,
      aggregate_kind TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      result_sequence INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_command_receipts_aggregate
    ON automation_command_receipts(aggregate_kind, aggregate_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_command_receipts_sequence
    ON automation_command_receipts(result_sequence)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_automations (
      automation_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      target_json TEXT NOT NULL,
      schedule_json TEXT NOT NULL,
      timezone TEXT NOT NULL,
      status TEXT NOT NULL,
      environment_mode TEXT NOT NULL,
      write_policy_json TEXT NOT NULL,
      model_selection_json TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      result_thread_id TEXT,
      next_run_at TEXT,
      last_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_automations_status_next_run
    ON projection_automations(status, next_run_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_automations_result_thread
    ON projection_automations(result_thread_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_automation_runs (
      run_id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      result_thread_id TEXT,
      orchestration_command_ids_json TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      skipped_reason TEXT,
      changed_files_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_automation_runs_automation_created
    ON projection_automation_runs(automation_id, created_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_automation_runs_automation_status
    ON projection_automation_runs(automation_id, status)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_automation_state (
      projector TEXT PRIMARY KEY,
      last_applied_sequence INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});
