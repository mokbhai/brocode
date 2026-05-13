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
      AND (name LIKE 'projection_kanban_%' OR name LIKE 'kanban_%')
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

const primaryKeyColumns = (sql: SqlClient.SqlClient, tableName: string) =>
  sql<{ readonly name: string; readonly pk: number }>`
    SELECT name, pk FROM pragma_table_info(${tableName})
    WHERE pk > 0
    ORDER BY pk ASC
  `.pipe(Effect.map((rows) => rows.map((row) => row.name)));

describe("036_KanbanProjections", () => {
  it.effect("creates only the original durable Kanban projection tables", () =>
    withMemoryDb(Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 36 });

      assert.deepStrictEqual(yield* tableNames(sql), [
        "projection_kanban_boards",
        "projection_kanban_cards",
        "projection_kanban_reviews",
        "projection_kanban_runs",
        "projection_kanban_state",
        "projection_kanban_tasks",
      ]);

      const cardColumns = yield* columnNames(sql, "projection_kanban_cards");
      assert.includeMembers(cardColumns, [
        "card_id",
        "board_id",
        "project_id",
        "worker_thread_ids_json",
        "reviewer_thread_ids_json",
        "spec_json",
        "model_selection_json",
        "associated_worktree_path",
        "associated_worktree_branch",
        "associated_worktree_ref",
        "status",
        "updated_at",
      ]);

      const taskColumns = yield* columnNames(sql, "projection_kanban_tasks");
      assert.includeMembers(taskColumns, ["task_id", "card_id", "status", "task_order"]);
      assert.notInclude(taskColumns, "order");
      assert.deepStrictEqual(yield* primaryKeyColumns(sql, "projection_kanban_tasks"), ["task_id"]);

      const runColumns = yield* columnNames(sql, "projection_kanban_runs");
      assert.includeMembers(runColumns, [
        "run_id",
        "card_id",
        "role",
        "status",
        "result_json",
        "metadata_json",
      ]);

      const reviewColumns = yield* columnNames(sql, "projection_kanban_reviews");
      assert.includeMembers(reviewColumns, [
        "review_id",
        "card_id",
        "run_id",
        "reviewer_thread_id",
        "findings_json",
      ]);

      const stateColumns = yield* columnNames(sql, "projection_kanban_state");
      assert.includeMembers(stateColumns, ["projector", "last_applied_sequence", "updated_at"]);

      assert.includeMembers(yield* indexNames(sql, "projection_kanban_boards"), [
        "idx_projection_kanban_boards_project_updated",
      ]);
      assert.includeMembers(yield* indexNames(sql, "projection_kanban_cards"), [
        "idx_projection_kanban_cards_project_status_updated",
        "idx_projection_kanban_cards_board_status_updated",
      ]);
      assert.includeMembers(yield* indexNames(sql, "projection_kanban_tasks"), [
        "idx_projection_kanban_tasks_card_order",
        "idx_projection_kanban_tasks_status_updated",
      ]);
      assert.includeMembers(yield* indexNames(sql, "projection_kanban_runs"), [
        "idx_projection_kanban_runs_card_status_started",
      ]);
      assert.includeMembers(yield* indexNames(sql, "projection_kanban_reviews"), [
        "idx_projection_kanban_reviews_card_completed",
      ]);
    })),
  );

  it.effect("037 creates Kanban event storage and rebuilds task projection keys from old 036", () =>
    withMemoryDb(Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 36 });
      yield* sql`
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
          'task-old-036',
          'card-old-036',
          'Preserved task',
          NULL,
          'todo',
          0,
          '2026-05-12T00:00:00.000Z',
          '2026-05-12T00:00:00.000Z'
        )
      `;

      yield* runMigrations();

      assert.includeMembers(yield* tableNames(sql), ["kanban_command_receipts", "kanban_events"]);
      assert.deepStrictEqual(yield* primaryKeyColumns(sql, "projection_kanban_tasks"), [
        "card_id",
        "task_id",
      ]);

      const taskRows = yield* sql<{
        readonly taskId: string;
        readonly cardId: string;
        readonly title: string;
      }>`
        SELECT task_id AS "taskId", card_id AS "cardId", title
        FROM projection_kanban_tasks
      `;
      assert.deepStrictEqual(taskRows, [
        { taskId: "task-old-036", cardId: "card-old-036", title: "Preserved task" },
      ]);

      assert.includeMembers(yield* indexNames(sql, "kanban_events"), [
        "idx_kanban_events_stream_version",
        "idx_kanban_events_stream_sequence",
        "idx_kanban_events_command_id",
        "idx_kanban_events_correlation_id",
      ]);
      assert.includeMembers(yield* indexNames(sql, "kanban_command_receipts"), [
        "idx_kanban_command_receipts_aggregate",
        "idx_kanban_command_receipts_sequence",
      ]);
    })),
  );

  it.effect("037 is safe when migration 36 is recorded with the new task key shape", () =>
    withMemoryDb(Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 35 });
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
          'task-new-shape',
          'card-new-shape',
          'Already migrated task',
          NULL,
          'todo',
          0,
          '2026-05-12T00:00:00.000Z',
          '2026-05-12T00:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (36, 'KanbanProjections')
      `;

      yield* runMigrations();

      assert.includeMembers(yield* tableNames(sql), ["kanban_command_receipts", "kanban_events"]);
      assert.deepStrictEqual(yield* primaryKeyColumns(sql, "projection_kanban_tasks"), [
        "card_id",
        "task_id",
      ]);

      const taskRows = yield* sql<{
        readonly taskId: string;
        readonly cardId: string;
        readonly title: string;
      }>`
        SELECT task_id AS "taskId", card_id AS "cardId", title
        FROM projection_kanban_tasks
      `;
      assert.deepStrictEqual(taskRows, [
        {
          taskId: "task-new-shape",
          cardId: "card-new-shape",
          title: "Already migrated task",
        },
      ]);
    })),
  );
});
