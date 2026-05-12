import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const tableNames = (sql: SqlClient.SqlClient) =>
  sql<{ readonly name: string }>`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name LIKE 'projection_kanban_%'
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

layer("036_KanbanProjections", (it) => {
  it.effect("creates durable Kanban projection tables with key columns and indexes", () =>
    Effect.gen(function* () {
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
        "idx_projection_kanban_runs_card_status_updated",
      ]);
      assert.includeMembers(yield* indexNames(sql, "projection_kanban_reviews"), [
        "idx_projection_kanban_reviews_card_completed",
      ]);
    }),
  );
});
