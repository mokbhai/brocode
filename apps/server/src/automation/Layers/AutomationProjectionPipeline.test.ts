import {
  AutomationId,
  AutomationRunId,
  CommandId,
  EventId,
  ProjectId,
  type Automation,
  type AutomationEvent,
  type AutomationRun,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { AutomationEventStore } from "../Services/AutomationEventStore.ts";
import { AutomationProjectionPipeline } from "../Services/AutomationProjectionPipeline.ts";
import { AutomationEventStoreLive } from "./AutomationEventStore.ts";
import { AUTOMATION_PROJECTOR_NAME, AutomationProjectionPipelineLive } from "./AutomationProjectionPipeline.ts";

const automationId = AutomationId.makeUnsafe("automation-projection-1");
const runId = AutomationRunId.makeUnsafe("automation-run-projection-1");
const projectId = ProjectId.makeUnsafe("project-automation-projection");
const now = "2026-05-13T00:00:00.000Z";

async function createProjectionSystem() {
  const pipelineLayer = AutomationProjectionPipelineLive.pipe(Layer.provide(AutomationEventStoreLive));
  const layer = Layer.mergeAll(pipelineLayer, AutomationEventStoreLive).pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
  );
  const runtime = ManagedRuntime.make(layer);
  const pipeline = await runtime.runPromise(Effect.service(AutomationProjectionPipeline));
  const eventStore = await runtime.runPromise(Effect.service(AutomationEventStore));
  const sql = await runtime.runPromise(Effect.service(SqlClient.SqlClient));
  return {
    pipeline,
    eventStore,
    sql,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: automationId,
    title: "Daily digest",
    prompt: "Summarize recent project activity.",
    target: { type: "project", projectId },
    schedule: { kind: "daily", hour: 9, minute: 15 },
    timezone: "Asia/Kolkata",
    status: "enabled",
    environmentMode: "local",
    writePolicy: { writesEnabled: true, allowDirtyLocalCheckout: false },
    modelSelection: { provider: "codex", model: "gpt-5.2" },
    runtimeMode: "full-access",
    resultThreadId: null,
    nextRunAt: now,
    lastRunAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: runId,
    automationId,
    status: "pending",
    trigger: "manual",
    resultThreadId: null,
    orchestrationCommandIds: [],
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    skippedReason: null,
    changedFiles: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function eventBase(input: {
  readonly eventId: string;
  readonly aggregateKind: "automation" | "automationRun";
  readonly aggregateId: string;
  readonly commandId: string;
  readonly occurredAt?: string;
}): Omit<AutomationEvent, "sequence" | "type" | "payload"> {
  return {
    eventId: EventId.makeUnsafe(input.eventId),
    aggregateKind: input.aggregateKind,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt ?? now,
    commandId: CommandId.makeUnsafe(input.commandId),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe(input.commandId),
    metadata: {},
  };
}

describe("AutomationProjectionPipeline", () => {
  it("bootstraps persisted Automation events into projection tables and advances the cursor", async () => {
    const system = await createProjectionSystem();
    const created = await system.run(
      system.eventStore.append({
        ...eventBase({
          eventId: "evt-automation-projection-created",
          aggregateKind: "automation",
          aggregateId: automationId,
          commandId: "cmd-automation-projection-created",
        }),
        type: "automation.created",
        payload: { automation: automation() },
      }),
    );
    const updatedAt = "2026-05-13T00:05:00.000Z";
    const updated = await system.run(
      system.eventStore.append({
        ...eventBase({
          eventId: "evt-automation-projection-updated",
          aggregateKind: "automation",
          aggregateId: automationId,
          commandId: "cmd-automation-projection-updated",
          occurredAt: updatedAt,
        }),
        type: "automation.updated",
        payload: { automation: automation({ title: "Updated digest", updatedAt }) },
      }),
    );

    await system.run(system.pipeline.bootstrap);
    await system.run(system.pipeline.bootstrap);

    const rows = await system.run(
      system.sql<{
        readonly automationId: string;
        readonly title: string;
        readonly targetJson: string;
        readonly scheduleJson: string;
        readonly writePolicyJson: string;
        readonly modelSelectionJson: string;
      }>`
        SELECT
          automation_id AS "automationId",
          title,
          target_json AS "targetJson",
          schedule_json AS "scheduleJson",
          write_policy_json AS "writePolicyJson",
          model_selection_json AS "modelSelectionJson"
        FROM projection_automations
      `,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ automationId, title: "Updated digest" });
    expect(JSON.parse(rows[0]!.targetJson)).toEqual({ type: "project", projectId });
    expect(JSON.parse(rows[0]!.scheduleJson)).toEqual({ kind: "daily", hour: 9, minute: 15 });
    expect(JSON.parse(rows[0]!.writePolicyJson)).toEqual({
      writesEnabled: true,
      allowDirtyLocalCheckout: false,
    });
    expect(JSON.parse(rows[0]!.modelSelectionJson)).toEqual({
      provider: "codex",
      model: "gpt-5.2",
    });

    const state = await system.run(
      system.sql<{ readonly lastAppliedSequence: number }>`
        SELECT last_applied_sequence AS "lastAppliedSequence"
        FROM projection_automation_state
        WHERE projector = ${AUTOMATION_PROJECTOR_NAME}
      `,
    );
    expect(created.sequence).toBeLessThan(updated.sequence);
    expect(state).toEqual([{ lastAppliedSequence: updated.sequence }]);

    await system.dispose();
  });

  it("projects automation and run rows one event at a time and ignores already-projected events", async () => {
    const system = await createProjectionSystem();
    const createdEvent = await system.run(
      system.eventStore.append({
        ...eventBase({
          eventId: "evt-automation-project-one",
          aggregateKind: "automation",
          aggregateId: automationId,
          commandId: "cmd-automation-project-one",
        }),
        type: "automation.created",
        payload: { automation: automation() },
      }),
    );
    const runEvent = await system.run(
      system.eventStore.append({
        ...eventBase({
          eventId: "evt-automation-project-run",
          aggregateKind: "automationRun",
          aggregateId: runId,
          commandId: "cmd-automation-project-run",
        }),
        type: "automation.run-created",
        payload: {
          run: run({
            orchestrationCommandIds: [CommandId.makeUnsafe("cmd-orchestration-1")],
            changedFiles: ["apps/server/src/example.ts"],
          }),
        },
      }),
    );

    await system.run(system.pipeline.projectEvent(createdEvent));
    await system.run(system.pipeline.projectEvent(runEvent));
    await system.run(system.pipeline.projectEvent(runEvent));

    const rows = await system.run(
      system.sql<{
        readonly automationId: string;
        readonly runId: string;
        readonly orchestrationCommandIdsJson: string;
        readonly changedFilesJson: string;
        readonly lastAppliedSequence: number;
      }>`
        SELECT
          a.automation_id AS "automationId",
          r.run_id AS "runId",
          r.orchestration_command_ids_json AS "orchestrationCommandIdsJson",
          r.changed_files_json AS "changedFilesJson",
          s.last_applied_sequence AS "lastAppliedSequence"
        FROM projection_automations a
        CROSS JOIN projection_automation_runs r
        CROSS JOIN projection_automation_state s
        WHERE s.projector = ${AUTOMATION_PROJECTOR_NAME}
      `,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      automationId,
      runId,
      lastAppliedSequence: runEvent.sequence,
    });
    expect(JSON.parse(rows[0]!.orchestrationCommandIdsJson)).toEqual(["cmd-orchestration-1"]);
    expect(JSON.parse(rows[0]!.changedFilesJson)).toEqual(["apps/server/src/example.ts"]);

    await system.dispose();
  });

  it("rejects non-contiguous projection so callers cannot skip earlier events", async () => {
    const system = await createProjectionSystem();
    const first = await system.run(
      system.eventStore.append({
        ...eventBase({
          eventId: "evt-automation-gap-first",
          aggregateKind: "automation",
          aggregateId: automationId,
          commandId: "cmd-automation-gap-first",
        }),
        type: "automation.created",
        payload: { automation: automation() },
      }),
    );
    const second = await system.run(
      system.eventStore.append({
        ...eventBase({
          eventId: "evt-automation-gap-second",
          aggregateKind: "automation",
          aggregateId: automationId,
          commandId: "cmd-automation-gap-second",
        }),
        type: "automation.status-changed",
        payload: {
          automationId,
          fromStatus: "enabled",
          toStatus: "disabled",
          updatedAt: now,
        },
      }),
    );

    const skipped = await system.run(Effect.exit(system.pipeline.projectEvent(second)));
    expect(skipped._tag).toBe("Failure");

    await system.run(system.pipeline.projectEvent(first));
    await system.run(system.pipeline.projectEvent(second));

    const rows = await system.run(
      system.sql<{ readonly status: string }>`
        SELECT status FROM projection_automations WHERE automation_id = ${automationId}
      `,
    );
    expect(rows).toEqual([{ status: "disabled" }]);

    await system.dispose();
  });
});
