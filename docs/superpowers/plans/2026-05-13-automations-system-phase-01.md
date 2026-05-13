# Automations System Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native Automation contracts, persistence, projections, snapshots, and WebSocket access without running scheduled agents yet.

**Complete Target:** BroCode has a complete local-first Automations system where scheduled prompts run against projects, chats, or threads, write to automation-owned result threads, and can perform local or worktree file changes with guardrails.

**Architecture:** Phase 1 creates a first-class Automation domain alongside Kanban. Automations get their own contracts, event store, command receipts, projection tables, engine, snapshot query, runtime layer, and WS handlers. They do not call providers or dispatch orchestration turns in this phase.

**Tech Stack:** TypeScript, Effect Schema/Layer/ServiceMap, Effect SQL SQLite migrations, Vitest via `bun run test`, existing WsRpcGroup handlers.

**Spec Source:** `docs/superpowers/specs/2026-05-13-automations-system/00-overview.md` and `docs/superpowers/specs/2026-05-13-automations-system/01-automation-domain-and-projections.md`

**Phase:** Phase 1: Automation Domain and Projections

**Next Required Phase:** Phase 2: Scheduler and Run Engine, `docs/superpowers/specs/2026-05-13-automations-system/02-scheduler-and-run-engine.md`

---

## Scope Check

Implement only the durable Automation domain and read APIs. Do not add scheduler polling, `Run now` provider execution, result thread creation, dirty checkout preflight, worktree creation, or UI route work in this phase. This phase is complete when tests can create/update/delete automations and run records through server APIs and read them back from snapshots/subscriptions.

## File Structure

Create these files:

- `packages/contracts/src/automation.ts` - automation schemas, IDs, commands, events, snapshots, RPC schema constants.
- `packages/contracts/src/automation.test.ts` - schema and decoding tests.
- `apps/server/src/automation/Schemas.ts` - server aliases for contract payload schemas used by projector decoding.
- `apps/server/src/automation/decider.ts` - command invariant checks and event creation.
- `apps/server/src/automation/decider.test.ts` - domain invariant tests.
- `apps/server/src/automation/projector.ts` - pure read-model projection from automation events.
- `apps/server/src/automation/projector.test.ts` - replay tests.
- `apps/server/src/automation/Services/AutomationEventStore.ts` - service tag, receipt schema, shape.
- `apps/server/src/automation/Services/AutomationEngine.ts` - service tag and dispatch/read stream shape.
- `apps/server/src/automation/Services/AutomationProjectionPipeline.ts` - projection service tag.
- `apps/server/src/automation/Services/AutomationSnapshotQuery.ts` - snapshot query service tag and not-found errors if needed.
- `apps/server/src/automation/Layers/AutomationEventStore.ts` - SQLite event store and command receipts.
- `apps/server/src/automation/Layers/AutomationEngine.ts` - serialized command queue and in-memory read model.
- `apps/server/src/automation/Layers/AutomationProjectionPipeline.ts` - durable projection writer/cursor.
- `apps/server/src/automation/Layers/AutomationSnapshotQuery.ts` - projection table reader.
- `apps/server/src/automation/runtimeLayer.ts` - merged Automation layer wiring.
- `apps/server/src/persistence/Migrations/038_AutomationDomain.ts` - event, receipt, projection tables and indexes.
- `apps/server/src/persistence/Migrations/038_AutomationDomain.test.ts` - migration shape tests.
- `apps/server/src/automation/Layers/AutomationEventStore.test.ts` - event store persistence/idempotency tests.
- `apps/server/src/automation/Layers/AutomationEngine.test.ts` - dispatch/replay tests.
- `apps/server/src/automation/Layers/AutomationProjectionPipeline.test.ts` - durable projection tests.
- `apps/server/src/automation/Layers/AutomationSnapshotQuery.test.ts` - snapshot tests.

Modify these files:

- `packages/contracts/src/index.ts` - export automation contracts.
- `packages/contracts/src/ws.ts` - import automation RPC schemas and tag request bodies.
- `apps/server/src/persistence/Migrations.ts` - statically import and register migration 38.
- `apps/server/src/wsRpc.ts` - add automation handlers and inject services.
- `apps/server/src/serverLayers.ts` - provide `AutomationLayerLive`.

Do not modify web UI files in Phase 1 except if a generated route/type import requires compilation repair. UI route work belongs to Phase 3.

## Domain Model Decisions

Use a sibling event store like Kanban instead of overloading orchestration events. Aggregate kinds should be `automation` and `automationRun`.

Recommended status shapes:

```ts
export const AutomationStatus = Schema.Literals(["enabled", "disabled", "deleted"]);
export const AutomationRunStatus = Schema.Literals([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);
export const AutomationRunTrigger = Schema.Literals(["scheduled", "startup-recovery", "manual"]);
export const AutomationEnvironmentMode = Schema.Literals(["local", "worktree"]);
```

Recommended schedule shape:

```ts
export const AutomationSchedule = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("hourly"), minute: NonNegativeInt }),
  Schema.Struct({
    kind: Schema.Literal("daily"),
    hour: NonNegativeInt,
    minute: NonNegativeInt,
  }),
  Schema.Struct({
    kind: Schema.Literal("weekdays"),
    hour: NonNegativeInt,
    minute: NonNegativeInt,
  }),
  Schema.Struct({
    kind: Schema.Literal("weekly"),
    dayOfWeek: NonNegativeInt,
    hour: NonNegativeInt,
    minute: NonNegativeInt,
  }),
  Schema.Struct({
    kind: Schema.Literal("monthly"),
    dayOfMonth: NonNegativeInt,
    hour: NonNegativeInt,
    minute: NonNegativeInt,
  }),
]);
```

Apply range checks in implementation: hour 0-23, minute 0-59, dayOfWeek 0-6, dayOfMonth 1-31.

Recommended target shape:

```ts
export const AutomationTarget = Schema.Union([
  Schema.Struct({ type: Schema.Literal("project"), projectId: ProjectId }),
  Schema.Struct({ type: Schema.Literal("thread"), projectId: ProjectId, threadId: ThreadId }),
  Schema.Struct({ type: Schema.Literal("chat"), projectId: Schema.optional(ProjectId) }),
]);
```

If `chat` cannot be represented safely during implementation, keep the schema but reject it in the server decider with a precise invariant message. Do not silently map it to a project.

## Task 1: Add Automation Contract Schemas

**Files:**

- Create: `packages/contracts/src/automation.ts`
- Create: `packages/contracts/src/automation.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/ws.ts`

- [ ] **Step 1: Write failing contract tests**

Add `packages/contracts/src/automation.test.ts` with tests that decode:

```ts
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
```

- [ ] **Step 2: Run contract tests and verify failure**

Run: `bun run test packages/contracts/src/automation.test.ts`

Expected: fail because `./automation` does not exist.

- [ ] **Step 3: Implement `packages/contracts/src/automation.ts`**

Follow `packages/contracts/src/kanban.ts`. Include:

- `AUTOMATION_WS_METHODS`
- `AUTOMATION_WS_CHANNELS`
- branded IDs
- model/read types
- client commands and internal commands
- event union
- `AutomationRpcSchemas`

Use `ModelSelection` and `RuntimeMode` from orchestration contracts. Use `ProjectId`, `ThreadId`, `CommandId`, `EventId`, `IsoDateTime`, `NonNegativeInt`, and `TrimmedNonEmptyString` from base schemas.

- [ ] **Step 4: Export and wire request decoding**

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./automation";
```

Modify `packages/contracts/src/ws.ts` to import automation constants and add request body tags near Kanban:

```ts
import {
  AUTOMATION_WS_METHODS,
  AutomationRpcSchemas,
} from "./automation";
```

Add:

```ts
tagRequestBody(AUTOMATION_WS_METHODS.getSnapshot, AutomationRpcSchemas.getSnapshot.input),
tagRequestBody(
  AUTOMATION_WS_METHODS.dispatchCommand,
  Schema.Struct({ command: AutomationRpcSchemas.dispatchCommand.input }),
),
tagRequestBody(AUTOMATION_WS_METHODS.subscribe, AutomationRpcSchemas.subscribe.input),
tagRequestBody(AUTOMATION_WS_METHODS.unsubscribe, AutomationRpcSchemas.unsubscribe.input),
```

- [ ] **Step 5: Run contract tests and ws tests**

Run:

```bash
bun run test packages/contracts/src/automation.test.ts packages/contracts/src/ws.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/automation.ts packages/contracts/src/automation.test.ts packages/contracts/src/index.ts packages/contracts/src/ws.ts
git commit -m "feat: add automation contracts"
```

## Task 2: Add Automation SQLite Migration

**Files:**

- Create: `apps/server/src/persistence/Migrations/038_AutomationDomain.ts`
- Create: `apps/server/src/persistence/Migrations/038_AutomationDomain.test.ts`
- Modify: `apps/server/src/persistence/Migrations.ts`

- [ ] **Step 1: Write failing migration tests**

Create `038_AutomationDomain.test.ts` modeled after `036_KanbanProjections.test.ts`.

Test assertions:

```ts
assert.includeMembers(yield* tableNames(sql), [
  "automation_command_receipts",
  "automation_events",
  "projection_automation_runs",
  "projection_automation_state",
  "projection_automations",
]);
```

Check `projection_automations` has:

- `automation_id`
- `title`
- `prompt`
- `target_json`
- `schedule_json`
- `timezone`
- `status`
- `environment_mode`
- `write_policy_json`
- `model_selection_json`
- `runtime_mode`
- `result_thread_id`
- `next_run_at`
- `last_run_at`
- `created_at`
- `updated_at`
- `deleted_at`

Check `projection_automation_runs` has:

- `run_id`
- `automation_id`
- `status`
- `trigger`
- `result_thread_id`
- `orchestration_command_ids_json`
- `started_at`
- `completed_at`
- `error_message`
- `skipped_reason`
- `changed_files_json`
- `created_at`
- `updated_at`

Check indexes:

- `idx_projection_automations_status_next_run`
- `idx_projection_automations_result_thread`
- `idx_projection_automation_runs_automation_created`
- `idx_projection_automation_runs_automation_status`
- `idx_automation_events_stream_version`
- `idx_automation_events_stream_sequence`
- `idx_automation_events_command_id`
- `idx_automation_command_receipts_aggregate`

- [ ] **Step 2: Run migration test and verify failure**

Run: `bun run test apps/server/src/persistence/Migrations/038_AutomationDomain.test.ts`

Expected: fail because migration 38 does not exist.

- [ ] **Step 3: Implement migration**

Create tables:

```sql
CREATE TABLE IF NOT EXISTS automation_events (...)
CREATE TABLE IF NOT EXISTS automation_command_receipts (...)
CREATE TABLE IF NOT EXISTS projection_automations (...)
CREATE TABLE IF NOT EXISTS projection_automation_runs (...)
CREATE TABLE IF NOT EXISTS projection_automation_state (...)
```

Use the Kanban event store table shape for events and receipts. Use projection tables for query efficiency instead of reading all events for snapshots.

- [ ] **Step 4: Register migration**

Modify `apps/server/src/persistence/Migrations.ts`:

```ts
import Migration0038 from "./Migrations/038_AutomationDomain.ts";
```

Add:

```ts
[38, "AutomationDomain", Migration0038],
```

- [ ] **Step 5: Run migration tests**

Run:

```bash
bun run test apps/server/src/persistence/Migrations/038_AutomationDomain.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/persistence/Migrations.ts apps/server/src/persistence/Migrations/038_AutomationDomain.ts apps/server/src/persistence/Migrations/038_AutomationDomain.test.ts
git commit -m "feat: add automation persistence"
```

## Task 3: Add Pure Decider and Projector

**Files:**

- Create: `apps/server/src/automation/Schemas.ts`
- Create: `apps/server/src/automation/decider.ts`
- Create: `apps/server/src/automation/decider.test.ts`
- Create: `apps/server/src/automation/projector.ts`
- Create: `apps/server/src/automation/projector.test.ts`

- [ ] **Step 1: Write decider tests**

Cover:

- create automation emits `automation.created`
- duplicate create rejects
- update missing automation rejects
- enable/disable deleted automation rejects
- run record creates `automation.run-created`
- run update cannot mutate a missing run
- terminal run status sets completed timestamp

Representative test:

```ts
it.effect("creates an enabled local automation", () =>
  Effect.gen(function* () {
    const events = yield* decideAutomationCommand({
      readModel: createEmptyAutomationReadModel(now),
      command: {
        type: "automation.create",
        commandId: "cmd-create",
        automationId: "automation-1",
        title: "Daily standup",
        prompt: "Summarize",
        target: { type: "project", projectId: "project-1" },
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
    assert.strictEqual(events.payload.automation.environmentMode, "local");
  }),
);
```

- [ ] **Step 2: Write projector tests**

Cover replay:

- created automation appears
- update replaces fields
- disable/enable status changes
- delete marks status/deletedAt and keeps history
- run-created appends run
- run terminal updates replace run

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
bun run test apps/server/src/automation/decider.test.ts apps/server/src/automation/projector.test.ts
```

Expected: fail because implementation files do not exist.

- [ ] **Step 4: Implement `Schemas.ts`**

Re-export payload schemas from `@t3tools/contracts`, matching `apps/server/src/kanban/Schemas.ts`.

- [ ] **Step 5: Implement `decider.ts`**

Use Kanban's decider style:

- `AutomationCommandInvariantError`
- `eventBase`
- `fail`
- `findAutomation`
- `findRun`
- `buildAutomation`
- `buildUpdatedAutomation`
- `decideAutomationCommand`

Keep invariant logic server-owned. Client commands should not directly decide derived run fields beyond fields allowed by the contract.

- [ ] **Step 6: Implement `projector.ts`**

Use Kanban's pure projector style:

- `createEmptyAutomationReadModel(nowIso)`
- `projectAutomationEvent(model, event)`
- decode payload per event through `Schemas.ts`
- upsert automations by id
- upsert runs by id

- [ ] **Step 7: Run tests**

Run:

```bash
bun run test apps/server/src/automation/decider.test.ts apps/server/src/automation/projector.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/automation/Schemas.ts apps/server/src/automation/decider.ts apps/server/src/automation/decider.test.ts apps/server/src/automation/projector.ts apps/server/src/automation/projector.test.ts
git commit -m "feat: add automation domain projection"
```

## Task 4: Add Event Store and Engine

**Files:**

- Create: `apps/server/src/automation/Services/AutomationEventStore.ts`
- Create: `apps/server/src/automation/Services/AutomationEngine.ts`
- Create: `apps/server/src/automation/Layers/AutomationEventStore.ts`
- Create: `apps/server/src/automation/Layers/AutomationEventStore.test.ts`
- Create: `apps/server/src/automation/Layers/AutomationEngine.ts`
- Create: `apps/server/src/automation/Layers/AutomationEngine.test.ts`

- [ ] **Step 1: Write event store tests**

Cover:

- append event and read it back
- command receipt upsert/read
- `readFromSequence` ordering
- duplicate command receipt lookup

- [ ] **Step 2: Write engine tests**

Cover:

- dispatch create persists event and updates in-memory read model
- repeated accepted command id returns receipt sequence
- previously rejected command id fails consistently
- worker continues after an invariant failure
- `streamDomainEvents` publishes committed events

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
bun run test apps/server/src/automation/Layers/AutomationEventStore.test.ts apps/server/src/automation/Layers/AutomationEngine.test.ts
```

Expected: fail because service/layer files do not exist.

- [ ] **Step 4: Implement service tags**

`AutomationEventStoreShape` should expose:

- `append`
- `readFromSequence`
- `readAll`
- `getCommandReceipt`
- `upsertCommandReceipt`

`AutomationEngineShape` should expose:

- `getReadModel`
- `readEvents`
- `dispatch`
- `streamDomainEvents`

- [ ] **Step 5: Implement event store layer**

Copy the Kanban event store structure and rename SQL tables/index operations for automation. Decode rows through `AutomationEvent`.

- [ ] **Step 6: Implement engine layer**

Copy the Kanban engine structure:

- in-memory `AutomationReadModel`
- unbounded serialized command queue
- command receipt check
- `decideAutomationCommand`
- append events in transaction
- project into read model
- project durable pipeline in Task 5 after it exists

During this task, temporarily keep durable projection call behind the `AutomationProjectionPipeline` service if Task 5 is implemented next. If strict compile order is awkward, implement Task 5 service tag first with a no-op test double in the engine test.

- [ ] **Step 7: Run tests**

Run:

```bash
bun run test apps/server/src/automation/Layers/AutomationEventStore.test.ts apps/server/src/automation/Layers/AutomationEngine.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/automation/Services/AutomationEventStore.ts apps/server/src/automation/Services/AutomationEngine.ts apps/server/src/automation/Layers/AutomationEventStore.ts apps/server/src/automation/Layers/AutomationEventStore.test.ts apps/server/src/automation/Layers/AutomationEngine.ts apps/server/src/automation/Layers/AutomationEngine.test.ts
git commit -m "feat: add automation engine"
```

## Task 5: Add Projection Pipeline and Snapshot Query

**Files:**

- Create: `apps/server/src/automation/Services/AutomationProjectionPipeline.ts`
- Create: `apps/server/src/automation/Services/AutomationSnapshotQuery.ts`
- Create: `apps/server/src/automation/Layers/AutomationProjectionPipeline.ts`
- Create: `apps/server/src/automation/Layers/AutomationProjectionPipeline.test.ts`
- Create: `apps/server/src/automation/Layers/AutomationSnapshotQuery.ts`
- Create: `apps/server/src/automation/Layers/AutomationSnapshotQuery.test.ts`
- Modify: `apps/server/src/automation/Layers/AutomationEngine.ts`

- [ ] **Step 1: Write projection pipeline tests**

Cover:

- bootstrap catches projection tables up from automation events
- event projection upserts automation rows
- event projection upserts run rows
- cursor advances after each event
- repeated bootstrap is idempotent

- [ ] **Step 2: Write snapshot query tests**

Cover:

- reads empty snapshot
- reads automations ordered by updated time
- groups recent runs by automation id
- decodes JSON fields through contract schemas
- reports decode errors for malformed JSON

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
bun run test apps/server/src/automation/Layers/AutomationProjectionPipeline.test.ts apps/server/src/automation/Layers/AutomationSnapshotQuery.test.ts
```

Expected: fail because projection/snapshot layers do not exist.

- [ ] **Step 4: Implement projection service tag**

Shape:

```ts
export interface AutomationProjectionPipelineShape {
  readonly bootstrap: Effect.Effect<void, AutomationProjectionPipelineError>;
  readonly projectEvent: (event: AutomationEvent) => Effect.Effect<void, AutomationProjectionPipelineError>;
}
```

Use existing persistence errors where possible. Avoid a broad new error taxonomy unless tests require it.

- [ ] **Step 5: Implement projection layer**

Follow `KanbanProjectionPipeline.ts`:

- `AUTOMATION_PROJECTOR_NAME = "automation.projection"`
- semaphore for single projection
- read cursor from `projection_automation_state`
- stream events from `AutomationEventStore.readFromSequence`
- write `projection_automations`
- write `projection_automation_runs`
- advance cursor

Use JSON stringify helpers for target, schedule, write policy, model selection, orchestration command ids, and changed files.

- [ ] **Step 6: Implement snapshot query service/layer**

Return `AutomationSnapshot`:

- `snapshotSequence`
- `automations`
- `runsByAutomationId`

Default to a bounded recent run query per automation or global limit. For Phase 1, a simple all-runs query is acceptable if tests and comments call out that pagination/detail queries are Phase 5 hardening.

- [ ] **Step 7: Wire engine durable projection**

Modify `AutomationEngineLive` to:

- call `projectionPipeline.bootstrap` on startup
- project each committed event through `projectionPipeline.projectEvent`
- update in-memory read model after append
- publish events after durable projection succeeds

- [ ] **Step 8: Run projection and engine tests**

Run:

```bash
bun run test apps/server/src/automation/Layers/AutomationProjectionPipeline.test.ts apps/server/src/automation/Layers/AutomationSnapshotQuery.test.ts apps/server/src/automation/Layers/AutomationEngine.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/automation/Services/AutomationProjectionPipeline.ts apps/server/src/automation/Services/AutomationSnapshotQuery.ts apps/server/src/automation/Layers/AutomationProjectionPipeline.ts apps/server/src/automation/Layers/AutomationProjectionPipeline.test.ts apps/server/src/automation/Layers/AutomationSnapshotQuery.ts apps/server/src/automation/Layers/AutomationSnapshotQuery.test.ts apps/server/src/automation/Layers/AutomationEngine.ts
git commit -m "feat: add automation projections"
```

## Task 6: Add Runtime Layer and WebSocket Handlers

**Files:**

- Create: `apps/server/src/automation/runtimeLayer.ts`
- Modify: `apps/server/src/serverLayers.ts`
- Modify: `apps/server/src/wsRpc.ts`
- Modify: existing or new `apps/server/src/wsRpc.test.ts` automation cases

- [ ] **Step 1: Write WS handler tests**

Add focused tests to `apps/server/src/wsRpc.test.ts` or create a local unit around exported `makeAutomationWsHandlers`.

Cover:

- `automation.getSnapshot` calls snapshot query
- `automation.dispatchCommand` calls automation engine dispatch
- subscription emits initial snapshot then matching automation events
- unsubscribe is a no-op

- [ ] **Step 2: Run WS tests and verify failure**

Run: `bun run test apps/server/src/wsRpc.test.ts`

Expected: fail because automation handlers are not wired.

- [ ] **Step 3: Implement runtime layer**

Create `apps/server/src/automation/runtimeLayer.ts` similar to Kanban:

```ts
export const AutomationProjectionPipelineLayerLive = AutomationProjectionPipelineLive.pipe(
  Layer.provide(AutomationEventStoreLive),
);

export const AutomationInfrastructureLayerLive = Layer.mergeAll(
  AutomationEventStoreLive,
  AutomationProjectionPipelineLayerLive,
  AutomationSnapshotQueryLive,
);

export const AutomationEngineLayerLive = AutomationEngineLive.pipe(
  Layer.provide(AutomationInfrastructureLayerLive),
);

export const AutomationLayerLive = Layer.mergeAll(
  AutomationInfrastructureLayerLive,
  AutomationEngineLayerLive,
);
```

- [ ] **Step 4: Wire server layer**

Modify `apps/server/src/serverLayers.ts`:

```ts
import { AutomationLayerLive } from "./automation/runtimeLayer";
```

Add `AutomationLayerLive` to `runtimeServicesLayer`.

- [ ] **Step 5: Add WS handlers**

In `apps/server/src/wsRpc.ts`, import automation contracts and services. Add `makeAutomationWsHandlers` next to `makeKanbanWsHandlers`.

Handlers:

- `automation.getSnapshot`
- `automation.dispatchCommand`
- `automation.subscribe`
- `automation.unsubscribe`

For subscribe, use a durable stream pattern similar to Kanban. Start with snapshot from `AutomationSnapshotQuery`, then emit events from `AutomationEngine.streamDomainEvents`. If implementing durable replay is simpler with `readEvents`, use the same polling pattern as `durableBoardEventStream` but without board filtering.

- [ ] **Step 6: Update WS request body if not already complete**

Confirm `packages/contracts/src/ws.ts` includes automation request tags from Task 1 and `ws.test.ts` passes.

- [ ] **Step 7: Run WS tests**

Run:

```bash
bun run test apps/server/src/wsRpc.test.ts packages/contracts/src/ws.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/automation/runtimeLayer.ts apps/server/src/serverLayers.ts apps/server/src/wsRpc.ts apps/server/src/wsRpc.test.ts packages/contracts/src/ws.ts
git commit -m "feat: expose automation ws api"
```

## Task 7: Phase 1 Verification Pass

**Files:**

- Review all Phase 1 files.

- [ ] **Step 1: Run focused Phase 1 tests**

Run:

```bash
bun run test \
  packages/contracts/src/automation.test.ts \
  packages/contracts/src/ws.test.ts \
  apps/server/src/persistence/Migrations/038_AutomationDomain.test.ts \
  apps/server/src/automation/decider.test.ts \
  apps/server/src/automation/projector.test.ts \
  apps/server/src/automation/Layers/AutomationEventStore.test.ts \
  apps/server/src/automation/Layers/AutomationEngine.test.ts \
  apps/server/src/automation/Layers/AutomationProjectionPipeline.test.ts \
  apps/server/src/automation/Layers/AutomationSnapshotQuery.test.ts \
  apps/server/src/wsRpc.test.ts
```

Expected: all pass.

- [ ] **Step 2: Check staged diff hygiene**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 3: Inspect final status**

Run:

```bash
git status --short
```

Expected: only intended Phase 1 files changed, plus any pre-existing unrelated dirty worktree files untouched.

- [ ] **Step 4: Do not run heavyweight workspace checks unless requested**

Per `AGENTS.md`, do not run `bun fmt`, `bun lint`, or `bun typecheck` unless the user explicitly asks in the current conversation. If the user asks for full validation, run those once as a final bundled pass.

- [ ] **Step 5: Commit final fixups if needed**

If Task 7 required fixes:

```bash
git add <fixed-files>
git commit -m "fix: harden automation phase one"
```

If no fixes were needed, no commit is required.

## Handoff Notes

Phase 2 should start from the Automation API and persisted snapshot created here. It should add next-run calculation, due-run polling, startup recovery, manual `Run now`, result thread creation/reuse, and orchestration dispatch. Do not start Phase 2 until Phase 1 tests pass and the user approves moving from domain/API work into scheduled execution.
