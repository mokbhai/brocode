import {
  AutomationId,
  AutomationRunId,
  CommandId,
  ProjectId,
  type Automation,
  type AutomationRun,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { AutomationSnapshotQuery } from "../Services/AutomationSnapshotQuery.ts";
import { AUTOMATION_PROJECTOR_NAME } from "./AutomationProjectionPipeline.ts";
import { AutomationSnapshotQueryLive } from "./AutomationSnapshotQuery.ts";

const projectId = ProjectId.makeUnsafe("project-automation-snapshot");
const firstAutomationId = AutomationId.makeUnsafe("automation-snapshot-1");
const secondAutomationId = AutomationId.makeUnsafe("automation-snapshot-2");
const firstRunId = AutomationRunId.makeUnsafe("automation-run-snapshot-1");
const secondRunId = AutomationRunId.makeUnsafe("automation-run-snapshot-2");

async function createSnapshotSystem() {
  const runtime = ManagedRuntime.make(
    AutomationSnapshotQueryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  );
  const snapshotQuery = await runtime.runPromise(Effect.service(AutomationSnapshotQuery));
  const sql = await runtime.runPromise(Effect.service(SqlClient.SqlClient));
  return {
    snapshotQuery,
    sql,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

function automation(id: AutomationId, updatedAt: string): Automation {
  return {
    id,
    title: `Automation ${id}`,
    prompt: "Summarize project state.",
    target: { type: "project", projectId },
    schedule: { kind: "daily", hour: 9, minute: 0 },
    timezone: "Asia/Kolkata",
    status: "enabled",
    environmentMode: "worktree",
    writePolicy: { writesEnabled: false, allowDirtyLocalCheckout: true },
    modelSelection: { provider: "codex", model: "gpt-5.2" },
    runtimeMode: "approval-required",
    resultThreadId: null,
    nextRunAt: updatedAt,
    lastRunAt: null,
    deletedAt: null,
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt,
  };
}

function run(input: {
  readonly id: AutomationRunId;
  readonly automationId: AutomationId;
  readonly createdAt: string;
}): AutomationRun {
  return {
    id: input.id,
    automationId: input.automationId,
    status: "completed",
    trigger: "manual",
    resultThreadId: null,
    orchestrationCommandIds: [CommandId.makeUnsafe(`cmd-${input.id}`)],
    startedAt: input.createdAt,
    completedAt: input.createdAt,
    errorMessage: null,
    skippedReason: null,
    changedFiles: [`changed-${input.id}.ts`],
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

function insertAutomation(sql: SqlClient.SqlClient, entry: Automation) {
  return sql`
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
      ${entry.id},
      ${entry.title},
      ${entry.prompt},
      ${JSON.stringify(entry.target)},
      ${JSON.stringify(entry.schedule)},
      ${entry.timezone},
      ${entry.status},
      ${entry.environmentMode},
      ${JSON.stringify(entry.writePolicy)},
      ${JSON.stringify(entry.modelSelection)},
      ${entry.runtimeMode},
      ${entry.resultThreadId},
      ${entry.nextRunAt},
      ${entry.lastRunAt},
      ${entry.createdAt},
      ${entry.updatedAt},
      ${entry.deletedAt}
    )
  `.pipe(Effect.asVoid);
}

function insertRun(sql: SqlClient.SqlClient, entry: AutomationRun) {
  return sql`
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
      ${entry.id},
      ${entry.automationId},
      ${entry.status},
      ${entry.trigger},
      ${entry.resultThreadId},
      ${JSON.stringify(entry.orchestrationCommandIds)},
      ${entry.startedAt},
      ${entry.completedAt},
      ${entry.errorMessage},
      ${entry.skippedReason},
      ${JSON.stringify(entry.changedFiles)},
      ${entry.createdAt},
      ${entry.updatedAt}
    )
  `.pipe(Effect.asVoid);
}

describe("AutomationSnapshotQuery", () => {
  it("reads an empty snapshot with sequence 0", async () => {
    const system = await createSnapshotSystem();

    const snapshot = await system.run(system.snapshotQuery.getSnapshot());

    expect(snapshot).toEqual({
      snapshotSequence: 0,
      automations: [],
      runsByAutomationId: {},
    });

    await system.dispose();
  });

  it("reads automations ordered by most recently updated and decodes JSON fields", async () => {
    const system = await createSnapshotSystem();
    const older = automation(firstAutomationId, "2026-05-13T00:01:00.000Z");
    const newer = automation(secondAutomationId, "2026-05-13T00:02:00.000Z");

    await system.run(
      Effect.all(
        [
          insertAutomation(system.sql, older),
          insertAutomation(system.sql, newer),
          system.sql`
            INSERT INTO projection_automation_state (projector, last_applied_sequence, updated_at)
            VALUES (${AUTOMATION_PROJECTOR_NAME}, ${4}, ${newer.updatedAt})
          `.pipe(Effect.asVoid),
        ],
        { concurrency: 1 },
      ),
    );

    const readModel = await system.run(system.snapshotQuery.getReadModel());
    expect(readModel.snapshotSequence).toBe(4);
    expect(readModel.automations.map((entry) => entry.id)).toEqual([
      secondAutomationId,
      firstAutomationId,
    ]);
    expect(readModel.automations[0]).toMatchObject({
      target: { type: "project", projectId },
      schedule: { kind: "daily", hour: 9, minute: 0 },
      writePolicy: { writesEnabled: false, allowDirtyLocalCheckout: true },
      modelSelection: { provider: "codex", model: "gpt-5.2" },
    });

    await system.dispose();
  });

  it("groups runs by automation id in created order", async () => {
    const system = await createSnapshotSystem();
    const entry = automation(firstAutomationId, "2026-05-13T00:01:00.000Z");
    const firstRun = run({
      id: firstRunId,
      automationId: firstAutomationId,
      createdAt: "2026-05-13T00:03:00.000Z",
    });
    const secondRun = run({
      id: secondRunId,
      automationId: firstAutomationId,
      createdAt: "2026-05-13T00:04:00.000Z",
    });

    await system.run(
      Effect.all(
        [
          insertAutomation(system.sql, entry),
          insertRun(system.sql, secondRun),
          insertRun(system.sql, firstRun),
        ],
        { concurrency: 1 },
      ),
    );

    const snapshot = await system.run(system.snapshotQuery.getSnapshot());

    expect(snapshot.runsByAutomationId[firstAutomationId]?.map((item) => item.id)).toEqual([
      firstRunId,
      secondRunId,
    ]);
    expect(snapshot.runsByAutomationId[firstAutomationId]?.[0]).toMatchObject({
      orchestrationCommandIds: [`cmd-${firstRunId}`],
      changedFiles: [`changed-${firstRunId}.ts`],
    });

    await system.dispose();
  });

  it("reports decode errors for malformed JSON", async () => {
    const system = await createSnapshotSystem();
    const entry = automation(firstAutomationId, "2026-05-13T00:01:00.000Z");
    await system.run(insertAutomation(system.sql, entry));
    await system.run(
      system.sql`
        UPDATE projection_automations
        SET target_json = ${"{not-json"}
        WHERE automation_id = ${firstAutomationId}
      `.pipe(Effect.asVoid),
    );

    const exit = await system.run(Effect.exit(system.snapshotQuery.getSnapshot()));

    expect(exit._tag).toBe("Failure");
    expect(String(exit.cause)).toContain("PersistenceDecodeError");

    await system.dispose();
  });
});
