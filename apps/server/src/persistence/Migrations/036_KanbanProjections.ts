import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

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
      task_id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      task_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_projection_kanban_runs_card_status_updated
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
