import { assert, it } from "@effect/vitest";
import {
  AutomationId,
  AutomationRunId,
  CommandId,
  ProjectId,
  ThreadId,
  type Automation,
  type AutomationCommand,
  type AutomationEvent,
  type AutomationReadModel,
  type AutomationRun,
} from "@t3tools/contracts";
import { Effect } from "effect";

import { decideAutomationCommand } from "./decider.ts";
import { createEmptyAutomationReadModel } from "./projector.ts";

const now = "2026-05-13T00:00:00.000Z";
const later = "2026-05-13T00:05:00.000Z";
const automationId = AutomationId.makeUnsafe("automation-1");
const deletedAutomationId = AutomationId.makeUnsafe("automation-deleted");
const runId = AutomationRunId.makeUnsafe("run-1");
const missingRunId = AutomationRunId.makeUnsafe("missing-run");
const projectId = ProjectId.makeUnsafe("project-1");

const automation = (overrides: Partial<Automation> = {}): Automation => ({
  id: automationId,
  title: "Daily standup",
  prompt: "Summarize yesterday and today.",
  target: { type: "project", projectId },
  schedule: { kind: "daily", hour: 9, minute: 0 },
  timezone: "Asia/Kolkata",
  status: "enabled",
  environmentMode: "local",
  writePolicy: { writesEnabled: true, allowDirtyLocalCheckout: false },
  modelSelection: { provider: "codex", model: "gpt-5.2" },
  runtimeMode: "full-access",
  resultThreadId: null,
  nextRunAt: now,
  lastRunAt: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const run = (overrides: Partial<AutomationRun> = {}): AutomationRun => ({
  id: runId,
  automationId,
  status: "running",
  trigger: "manual",
  resultThreadId: ThreadId.makeUnsafe("thread-1"),
  orchestrationCommandIds: [CommandId.makeUnsafe("cmd-orchestration-1")],
  startedAt: now,
  completedAt: null,
  errorMessage: null,
  skippedReason: null,
  changedFiles: [],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const readModelWithAutomation = (
  overrides: Partial<AutomationReadModel> = {},
): AutomationReadModel => ({
  ...createEmptyAutomationReadModel(now),
  automations: [automation()],
  ...overrides,
});

it.effect("creates an enabled local automation", () =>
  Effect.gen(function* () {
    const events = yield* decideAutomationCommand({
      readModel: createEmptyAutomationReadModel(now),
      command: {
        type: "automation.create",
        commandId: CommandId.makeUnsafe("cmd-create"),
        automationId,
        title: "Daily standup",
        prompt: "Summarize",
        target: { type: "project", projectId },
        schedule: { kind: "daily", hour: 9, minute: 0 },
        timezone: "Asia/Kolkata",
        environmentMode: "local",
        writesEnabled: true,
        allowDirtyLocalCheckout: false,
        modelSelection: { provider: "codex", model: "gpt-5.2" },
        runtimeMode: "full-access",
        nextRunAt: now,
        createdAt: now,
      },
    });

    assert.strictEqual(Array.isArray(events), false);
    assert.strictEqual(events.type, "automation.created");
    assert.strictEqual(events.payload.automation.status, "enabled");
    assert.strictEqual(events.payload.automation.environmentMode, "local");
    assert.deepStrictEqual(events.payload.automation.writePolicy, {
      writesEnabled: true,
      allowDirtyLocalCheckout: false,
    });
    assert.strictEqual(events.payload.automation.resultThreadId, null);
    assert.strictEqual(events.payload.automation.lastRunAt, null);
  }),
);

it.effect("rejects duplicate active automation creation", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decideAutomationCommand({
        readModel: readModelWithAutomation(),
        command: {
          type: "automation.create",
          commandId: CommandId.makeUnsafe("cmd-create-duplicate"),
          automationId,
          title: "Daily standup",
          prompt: "Summarize",
          target: { type: "project", projectId },
          schedule: { kind: "daily", hour: 9, minute: 0 },
          timezone: "Asia/Kolkata",
          environmentMode: "local",
          writesEnabled: true,
          allowDirtyLocalCheckout: false,
          modelSelection: { provider: "codex", model: "gpt-5.2" },
          runtimeMode: "full-access",
          nextRunAt: now,
          createdAt: now,
        },
      }),
    );

    assert.strictEqual(result._tag, "Failure");
    assert.strictEqual(String(result.cause).includes("already exists"), true);
  }),
);

it.effect("rejects updates for missing automations", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decideAutomationCommand({
        readModel: createEmptyAutomationReadModel(now),
        command: {
          type: "automation.update",
          commandId: CommandId.makeUnsafe("cmd-update-missing"),
          automationId,
          title: "Updated standup",
          updatedAt: later,
        },
      }),
    );

    assert.strictEqual(result._tag, "Failure");
    assert.strictEqual(String(result.cause).includes("does not exist"), true);
  }),
);

it.effect("rejects enable and disable commands for deleted automations", () =>
  Effect.gen(function* () {
    const model = readModelWithAutomation({
      automations: [
        automation({
          id: deletedAutomationId,
          status: "deleted",
          updatedAt: later,
        }),
      ],
    });

    for (const status of ["enabled", "disabled"] as const) {
      const result = yield* Effect.exit(
        decideAutomationCommand({
          readModel: model,
          command: {
            type: "automation.status.set",
            commandId: CommandId.makeUnsafe(`cmd-status-${status}`),
            automationId: deletedAutomationId,
            status,
            updatedAt: later,
          },
        }),
      );

      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(String(result.cause).includes("deleted"), true);
    }
  }),
);

it.effect("creates a pending run from a manual run request", () =>
  Effect.gen(function* () {
    const event = yield* decideAutomationCommand({
      readModel: readModelWithAutomation(),
      command: {
        type: "automation.run.request",
        commandId: CommandId.makeUnsafe("cmd-run-request"),
        automationId,
        runId,
        trigger: "manual",
        requestedAt: now,
      },
    });

    assert.strictEqual(Array.isArray(event), false);
    assert.strictEqual(event.type, "automation.run-created");
    assert.strictEqual(event.payload.run.status, "pending");
    assert.strictEqual(event.payload.run.startedAt, null);
    assert.strictEqual(event.payload.run.completedAt, null);
    assert.strictEqual(event.payload.run.createdAt, now);
  }),
);

it.effect("rejects run updates for missing runs", () =>
  Effect.gen(function* () {
    const startResult = yield* Effect.exit(
      decideAutomationCommand({
        readModel: readModelWithAutomation(),
        command: {
          type: "automation.run.start",
          commandId: CommandId.makeUnsafe("cmd-run-start-missing"),
          automationId,
          runId: missingRunId,
          resultThreadId: ThreadId.makeUnsafe("thread-1"),
          orchestrationCommandIds: [CommandId.makeUnsafe("cmd-orchestration-1")],
          startedAt: now,
        },
      }),
    );

    const completeResult = yield* Effect.exit(
      decideAutomationCommand({
        readModel: readModelWithAutomation(),
        command: {
          type: "automation.run.complete",
          commandId: CommandId.makeUnsafe("cmd-run-complete-missing"),
          automationId,
          runId: missingRunId,
          status: "failed",
          errorMessage: "No run",
          skippedReason: null,
          changedFiles: [],
          completedAt: later,
        },
      }),
    );

    assert.strictEqual(startResult._tag, "Failure");
    assert.strictEqual(String(startResult.cause).includes("Run"), true);
    assert.strictEqual(completeResult._tag, "Failure");
    assert.strictEqual(String(completeResult.cause).includes("Run"), true);
  }),
);

it.effect("sets terminal run status and completed timestamp", () =>
  Effect.gen(function* () {
    const event = yield* decideAutomationCommand({
      readModel: readModelWithAutomation({
        runs: [run()],
      }),
      command: {
        type: "automation.run.complete",
        commandId: CommandId.makeUnsafe("cmd-run-complete"),
        automationId,
        runId,
        status: "completed",
        errorMessage: null,
        skippedReason: null,
        changedFiles: ["apps/server/src/automation/decider.ts"],
        completedAt: later,
      },
    });

    assert.strictEqual(Array.isArray(event), false);
    assert.strictEqual(event.type, "automation.run-completed");
    assert.strictEqual(event.payload.run.status, "completed");
    assert.strictEqual(event.payload.run.completedAt, later);
    assert.deepStrictEqual(event.payload.run.changedFiles, [
      "apps/server/src/automation/decider.ts",
    ]);
  }),
);
