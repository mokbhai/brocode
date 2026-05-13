import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  Automation,
  AUTOMATION_WS_CHANNELS,
  AUTOMATION_WS_METHODS,
  AutomationClientCommand,
  AutomationCommand,
  AutomationEvent,
  AutomationReadModel,
  AutomationRpcSchemas,
  AutomationSnapshot,
} from "./automation";
import { WebSocketRequest, WsResponse } from "./ws";

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

it.effect("distinguishes omitted update next run from explicit null", () =>
  Effect.gen(function* () {
    const omitted = yield* Schema.decodeUnknownEffect(AutomationClientCommand)({
      type: "automation.update",
      commandId: "cmd-update",
      automationId: "automation-1",
      title: "Daily standup updated",
      updatedAt: now,
    });

    assert.strictEqual(omitted.type, "automation.update");
    assert.strictEqual(Object.hasOwn(omitted, "nextRunAt"), false);

    const explicitNull = yield* Schema.decodeUnknownEffect(AutomationClientCommand)({
      type: "automation.update",
      commandId: "cmd-update",
      automationId: "automation-1",
      nextRunAt: null,
      updatedAt: now,
    });

    assert.strictEqual(explicitNull.type, "automation.update");
    assert.strictEqual(Object.hasOwn(explicitNull, "nextRunAt"), true);
    assert.strictEqual(explicitNull.nextRunAt, null);
  }),
);

it.effect("rejects deleted as a client settable status", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      Schema.decodeUnknownEffect(AutomationClientCommand)({
        type: "automation.status.set",
        commandId: "cmd-status",
        automationId: "automation-1",
        status: "deleted",
        updatedAt: now,
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects non-terminal run completion statuses", () =>
  Effect.gen(function* () {
    for (const status of ["pending", "running"] as const) {
      const result = yield* Effect.exit(
        Schema.decodeUnknownEffect(AutomationCommand)({
          type: "automation.run.complete",
          commandId: "cmd-run-complete",
          runId: "run-1",
          automationId: "automation-1",
          status,
          errorMessage: null,
          skippedReason: null,
          changedFiles: [],
          completedAt: now,
        }),
      );

      assert.strictEqual(result._tag, "Failure");
    }
  }),
);

it.effect("rejects run completed events with non-terminal status", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      Schema.decodeUnknownEffect(AutomationEvent)({
        sequence: 1,
        eventId: "event-1",
        aggregateKind: "automationRun",
        aggregateId: "run-1",
        type: "automation.run-completed",
        occurredAt: now,
        commandId: "cmd-run-complete",
        causationEventId: null,
        correlationId: "cmd-run-complete",
        metadata: {},
        payload: {
          run: {
            id: "run-1",
            automationId: "automation-1",
            status: "running",
            trigger: "manual",
            resultThreadId: null,
            orchestrationCommandIds: [],
            startedAt: now,
            completedAt: now,
            errorMessage: null,
            skippedReason: null,
            changedFiles: [],
            createdAt: now,
            updatedAt: now,
          },
        },
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

it.effect("decodes automation websocket dispatch requests", () =>
  Effect.gen(function* () {
    const parsed = yield* Schema.decodeUnknownEffect(WebSocketRequest)({
      id: "req-automation-dispatch-1",
      body: {
        _tag: AUTOMATION_WS_METHODS.dispatchCommand,
        command: {
          type: "automation.status.set",
          commandId: "cmd-automation-status-1",
          automationId: "automation-1",
          status: "enabled",
          updatedAt: now,
        },
      },
    });

    assert.strictEqual(parsed.body._tag, AUTOMATION_WS_METHODS.dispatchCommand);
    if (parsed.body._tag === AUTOMATION_WS_METHODS.dispatchCommand) {
      assert.strictEqual(parsed.body.command.type, "automation.status.set");
    }
  }),
);

it.effect("decodes automation websocket event pushes", () =>
  Effect.gen(function* () {
    const parsed = yield* Schema.decodeUnknownEffect(WsResponse)({
      type: "push",
      sequence: 5,
      channel: AUTOMATION_WS_CHANNELS.event,
      data: {
        sequence: 1,
        eventId: "event-automation-1",
        aggregateKind: "automationRun",
        aggregateId: "run-1",
        occurredAt: now,
        commandId: "cmd-run-complete",
        causationEventId: null,
        correlationId: "cmd-run-complete",
        metadata: {},
        type: "automation.run-completed",
        payload: {
          run: {
            id: "run-1",
            automationId: "automation-1",
            status: "completed",
            trigger: "manual",
            resultThreadId: null,
            orchestrationCommandIds: [],
            startedAt: now,
            completedAt: now,
            errorMessage: null,
            skippedReason: null,
            changedFiles: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      },
    });

    if (!("type" in parsed) || parsed.type !== "push") {
      assert.fail("expected websocket response to decode as a push envelope");
    }

    assert.strictEqual(parsed.channel, AUTOMATION_WS_CHANNELS.event);
  }),
);

it("defines automation rpc methods", () => {
  for (const method of ["getSnapshot", "dispatchCommand", "subscribe", "unsubscribe"] as const) {
    assert.strictEqual(AutomationRpcSchemas[method].input !== undefined, true);
    assert.strictEqual(AutomationRpcSchemas[method].output !== undefined, true);
  }
});
