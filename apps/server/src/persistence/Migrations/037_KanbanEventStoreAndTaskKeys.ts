import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const isCompositeTaskPrimaryKey = (
  rows: ReadonlyArray<{ readonly name: string; readonly pk: number }>,
) => {
  const primaryKeyColumns = rows
    .filter((row) => row.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((row) => row.name);
  return primaryKeyColumns[0] === "card_id" && primaryKeyColumns[1] === "task_id";
};

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

  const taskPrimaryKeyRows = yield* sql<{ readonly name: string; readonly pk: number }>`
    SELECT name, pk FROM pragma_table_info('projection_kanban_tasks')
  `;

  if (!isCompositeTaskPrimaryKey(taskPrimaryKeyRows)) {
    yield* sql`
      DROP TABLE IF EXISTS projection_kanban_tasks_037_old
    `;
    yield* sql`
      ALTER TABLE projection_kanban_tasks
      RENAME TO projection_kanban_tasks_037_old
    `;
    yield* sql`
      CREATE TABLE projection_kanban_tasks (
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
      INSERT OR REPLACE INTO projection_kanban_tasks (
        task_id,
        card_id,
        title,
        description,
        status,
        task_order,
        created_at,
        updated_at
      )
      SELECT
        task_id,
        card_id,
        title,
        description,
        status,
        task_order,
        created_at,
        updated_at
      FROM projection_kanban_tasks_037_old
    `;
    yield* sql`
      DROP TABLE projection_kanban_tasks_037_old
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_kanban_tasks_card_order
    ON projection_kanban_tasks(card_id, task_order)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_kanban_tasks_status_updated
    ON projection_kanban_tasks(status, updated_at)
  `;
});
