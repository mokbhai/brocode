import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS kanban_events (
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_events_stream_version
    ON kanban_events(aggregate_kind, stream_id, stream_version)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_kanban_events_stream_sequence
    ON kanban_events(aggregate_kind, stream_id, sequence)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_kanban_events_command_id
    ON kanban_events(command_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_kanban_events_correlation_id
    ON kanban_events(correlation_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS kanban_command_receipts (
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
    CREATE INDEX IF NOT EXISTS idx_kanban_command_receipts_aggregate
    ON kanban_command_receipts(aggregate_kind, aggregate_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_kanban_command_receipts_sequence
    ON kanban_command_receipts(result_sequence)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_kanban_boards (
      board_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_kanban_cards (
      card_id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      source_thread_id TEXT,
      worker_thread_ids_json TEXT NOT NULL,
      reviewer_thread_ids_json TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      spec_path TEXT,
      spec_json TEXT,
      status TEXT NOT NULL,
      model_selection_json TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      branch TEXT,
      worktree_path TEXT,
      associated_worktree_path TEXT,
      associated_worktree_branch TEXT,
      associated_worktree_ref TEXT,
      blocker_reason TEXT,
      loop_count INTEGER NOT NULL,
      max_loop_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_kanban_tasks (
      task_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      task_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (card_id, task_id)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_kanban_runs (
      run_id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      thread_id TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error_message TEXT,
      result_json TEXT,
      metadata_json TEXT
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_kanban_reviews (
      review_id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      reviewer_thread_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      summary TEXT NOT NULL,
      findings_json TEXT NOT NULL,
      completed_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_kanban_state (
      projector TEXT PRIMARY KEY,
      last_applied_sequence INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_kanban_boards_project_updated
    ON projection_kanban_boards(project_id, updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_kanban_cards_project_status_updated
    ON projection_kanban_cards(project_id, status, updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_kanban_cards_board_status_updated
    ON projection_kanban_cards(board_id, status, updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_kanban_cards_source_thread
    ON projection_kanban_cards(source_thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_kanban_tasks_card_order
    ON projection_kanban_tasks(card_id, task_order)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_kanban_tasks_status_updated
    ON projection_kanban_tasks(status, updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_kanban_runs_card_status_started
    ON projection_kanban_runs(card_id, status, started_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_kanban_runs_thread
    ON projection_kanban_runs(thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_kanban_reviews_card_completed
    ON projection_kanban_reviews(card_id, completed_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_kanban_reviews_run
    ON projection_kanban_reviews(run_id)
  `;
});
