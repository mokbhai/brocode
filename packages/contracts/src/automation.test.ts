import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  Automation,
  AutomationClientCommand,
  AutomationCommand,
  AutomationEvent,
  AutomationReadModel,
  AutomationRpcSchemas,
  AutomationSnapshot,
} from "./automation";

const now = "2026-05-13T00:00:00.000Z";

it.effect("decodes an automation with local environment as an explicit value", () =>
  Effect.gen(function* () {
    const automation = yield* Schema.decodeUnknownEffect(Automation)({
      id: "automation-1",
      title: "Daily standup",
      prompt: "Summarize yesterday and today.",
      target: { type: "project", projectId: "project-1" },
      schedule: { kind: "weekdays", hour: 9, minute: 0 },
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
    });

    assert.strictEqual(automation.environmentMode, "local");
    assert.strictEqual(automation.writePolicy.allowDirtyLocalCheckout, false);
  }),
);

it.effect("defaults omitted environment mode and dirty local policy on create commands", () =>
  Effect.gen(function* () {
    const command = yield* Schema.decodeUnknownEffect(AutomationClientCommand)({
      type: "automation.create",
      commandId: "cmd-create",
      automationId: "automation-1",
      title: "Daily standup",
      prompt: "Summarize yesterday and today.",
      target: { type: "project", projectId: "project-1" },
      schedule: { kind: "daily", hour: 9, minute: 0 },
      timezone: "Asia/Kolkata",
      modelSelection: { provider: "codex", model: "gpt-5.2" },
      runtimeMode: "full-access",
      writesEnabled: true,
      nextRunAt: now,
      createdAt: now,
    });

    assert.strictEqual(command.type, "automation.create");
    assert.strictEqual(command.environmentMode, "local");
    assert.strictEqual(command.allowDirtyLocalCheckout, false);
  }),
);

it.effect("rejects invalid schedule ranges", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      Schema.decodeUnknownEffect(AutomationClientCommand)({
        type: "automation.create",
        commandId: "cmd-create",
        automationId: "automation-1",
        title: "Bad schedule",
        prompt: "Run",
        target: { type: "project", projectId: "project-1" },
        schedule: { kind: "daily", hour: 24, minute: 0 },
        timezone: "Asia/Kolkata",
        modelSelection: { provider: "codex", model: "gpt-5.2" },
        runtimeMode: "full-access",
        writesEnabled: false,
        nextRunAt: now,
        createdAt: now,
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes run record events and snapshots", () =>
  Effect.gen(function* () {
    const event = yield* Schema.decodeUnknownEffect(AutomationEvent)({
      sequence: 1,
      eventId: "event-1",
      aggregateKind: "automationRun",
      aggregateId: "run-1",
      type: "automation.run-created",
      occurredAt: now,
      commandId: "cmd-run-record",
      causationEventId: null,
      correlationId: "cmd-run-record",
      metadata: {},
      payload: {
        run: {
          id: "run-1",
          automationId: "automation-1",
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
        },
      },
    });

    assert.strictEqual(event.type, "automation.run-created");

    yield* Schema.decodeUnknownEffect(AutomationReadModel)({
      snapshotSequence: 1,
      updatedAt: now,
      automations: [],
      runs: [event.payload.run],
    });

    yield* Schema.decodeUnknownEffect(AutomationSnapshot)({
      snapshotSequence: 1,
      automations: [],
      runsByAutomationId: { "automation-1": [event.payload.run] },
    });
  }),
);

it("defines automation rpc methods", () => {
  assert.strictEqual(AutomationRpcSchemas.getSnapshot.input !== undefined, true);
  assert.strictEqual(AutomationRpcSchemas.dispatchCommand.input !== undefined, true);
});
