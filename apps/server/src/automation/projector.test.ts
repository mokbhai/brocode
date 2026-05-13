import { assert, it } from "@effect/vitest";
import {
  AutomationId,
  AutomationRunId,
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  type Automation,
  type AutomationEvent,
  type AutomationRun,
} from "@t3tools/contracts";
import { Effect } from "effect";

import { createEmptyAutomationReadModel, projectAutomationEvent } from "./projector.ts";

const now = "2026-05-13T00:00:00.000Z";
const automationId = AutomationId.makeUnsafe("automation-1");
const runId = AutomationRunId.makeUnsafe("run-1");
const projectId = ProjectId.makeUnsafe("project-1");

const eventBase = (
  sequence: number,
  type: AutomationEvent["type"],
): Omit<AutomationEvent, "type" | "payload"> => ({
  sequence,
  eventId: EventId.makeUnsafe(`event-${sequence}`),
  aggregateKind: type.startsWith("automation.run-") ? "automationRun" : "automation",
  aggregateId: type.startsWith("automation.run-") ? runId : automationId,
  occurredAt: `2026-05-13T00:00:0${sequence}.000Z`,
  commandId: CommandId.makeUnsafe(`cmd-${sequence}`),
  causationEventId: null,
  correlationId: CommandId.makeUnsafe(`cmd-${sequence}`),
  metadata: {},
});

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
});

const createdEvent: AutomationEvent = {
  ...eventBase(1, "automation.created"),
  type: "automation.created",
  payload: {
    automation: automation(),
  },
};

it.effect("replays created automation into the read model", () =>
  Effect.gen(function* () {
    const model = yield* projectAutomationEvent(createEmptyAutomationReadModel(now), createdEvent);

    assert.strictEqual(model.snapshotSequence, 1);
    assert.strictEqual(model.updatedAt, "2026-05-13T00:00:01.000Z");
    assert.deepStrictEqual(model.automations, [automation()]);
  }),
);

it.effect("replaces automation fields on update replay", () =>
  Effect.gen(function* () {
    const afterCreate = yield* projectAutomationEvent(
      createEmptyAutomationReadModel(now),
      createdEvent,
    );
    const nextAutomation = automation({
      title: "Updated standup",
      prompt: "Summarize blockers.",
      nextRunAt: null,
      updatedAt: "2026-05-13T00:00:02.000Z",
    });
    const model = yield* projectAutomationEvent(afterCreate, {
      ...eventBase(2, "automation.updated"),
      type: "automation.updated",
      payload: {
        automation: nextAutomation,
      },
    });

    assert.deepStrictEqual(model.automations, [nextAutomation]);
  }),
);

it.effect("replays disable and enable status changes", () =>
  Effect.gen(function* () {
    const afterCreate = yield* projectAutomationEvent(
      createEmptyAutomationReadModel(now),
      createdEvent,
    );
    const afterDisable = yield* projectAutomationEvent(afterCreate, {
      ...eventBase(2, "automation.status-changed"),
      type: "automation.status-changed",
      payload: {
        automationId,
        fromStatus: "enabled",
        toStatus: "disabled",
        updatedAt: "2026-05-13T00:00:02.000Z",
      },
    });
    const afterEnable = yield* projectAutomationEvent(afterDisable, {
      ...eventBase(3, "automation.status-changed"),
      type: "automation.status-changed",
      payload: {
        automationId,
        fromStatus: "disabled",
        toStatus: "enabled",
        updatedAt: "2026-05-13T00:00:03.000Z",
      },
    });

    assert.strictEqual(afterDisable.automations[0]?.status, "disabled");
    assert.strictEqual(afterEnable.automations[0]?.status, "enabled");
    assert.strictEqual(afterEnable.automations[0]?.updatedAt, "2026-05-13T00:00:03.000Z");
  }),
);

it.effect("marks deleted automation while preserving history", () =>
  Effect.gen(function* () {
    const afterCreate = yield* projectAutomationEvent(
      createEmptyAutomationReadModel(now),
      createdEvent,
    );
    const model = yield* projectAutomationEvent(afterCreate, {
      ...eventBase(2, "automation.deleted"),
      type: "automation.deleted",
      payload: {
        automationId,
        deletedAt: "2026-05-13T00:00:02.000Z",
      },
    });

    assert.strictEqual(model.automations.length, 1);
    assert.strictEqual(model.automations[0]?.status, "deleted");
    assert.strictEqual(model.automations[0]?.updatedAt, "2026-05-13T00:00:02.000Z");
  }),
);

it.effect("appends a created run", () =>
  Effect.gen(function* () {
    const model = yield* projectAutomationEvent(createEmptyAutomationReadModel(now), {
      ...eventBase(1, "automation.run-created"),
      type: "automation.run-created",
      payload: {
        run: run(),
      },
    });

    assert.deepStrictEqual(model.runs, [run()]);
  }),
);

it.effect("replaces a run on start and terminal completion replay", () =>
  Effect.gen(function* () {
    const initial = yield* projectAutomationEvent(createEmptyAutomationReadModel(now), {
      ...eventBase(1, "automation.run-created"),
      type: "automation.run-created",
      payload: {
        run: run(),
      },
    });
    const startedRun = run({
      status: "running",
      resultThreadId: ThreadId.makeUnsafe("thread-1"),
      orchestrationCommandIds: [CommandId.makeUnsafe("cmd-orchestration-1")],
      startedAt: "2026-05-13T00:00:02.000Z",
      updatedAt: "2026-05-13T00:00:02.000Z",
    });
    const afterStart = yield* projectAutomationEvent(initial, {
      ...eventBase(2, "automation.run-started"),
      type: "automation.run-started",
      payload: {
        run: startedRun,
      },
    });
    const completedRun = {
      ...startedRun,
      status: "completed" as const,
      completedAt: "2026-05-13T00:00:03.000Z",
      changedFiles: ["apps/server/src/automation/projector.ts"],
      updatedAt: "2026-05-13T00:00:03.000Z",
    };
    const afterComplete = yield* projectAutomationEvent(afterStart, {
      ...eventBase(3, "automation.run-completed"),
      type: "automation.run-completed",
      payload: {
        run: completedRun,
      },
    });

    assert.deepStrictEqual(afterStart.runs, [startedRun]);
    assert.deepStrictEqual(afterComplete.runs, [completedRun]);
  }),
);
