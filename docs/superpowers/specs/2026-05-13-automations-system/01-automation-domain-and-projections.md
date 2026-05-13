# Phase 1: Automation Domain and Projections

## Goal

Add native Automation contracts, durable persistence, read models, snapshot queries, and WebSocket access without running any scheduled agents yet.

## Scope

Define Automations as first-class BroCode state:

- automation definition
- target context
- schedule config
- environment mode
- write policy
- output thread link
- run record
- read model snapshot

This phase should make it possible to create, update, enable/disable, delete, and inspect automations and their run history through server APIs. It should not start providers or schedule background work yet.

## Contracts

Add schemas for:

- `AutomationId`
- `AutomationRunId`
- `AutomationTarget`
- `AutomationSchedule`
- `AutomationEnvironmentMode`
- `AutomationWritePolicy`
- `AutomationStatus`
- `AutomationRunStatus`
- `Automation`
- `AutomationRun`
- `AutomationReadModel`
- `AutomationSnapshot`
- client commands
- server/internal commands
- events and payloads
- WebSocket methods and channels

`AutomationTarget` must support project, thread, and chat/home targets where the current BroCode model can represent them safely. It must include enough information to validate that the target still exists before execution.

`AutomationEnvironmentMode` starts with:

- `local`
- `worktree`

`local` is the creation default.

`AutomationWritePolicy` should represent at least:

- writes enabled/disabled
- allow dirty local checkout true/false

`AutomationSchedule` should represent structured presets and explicit timezone. If advanced cron is included in this phase, it must be schema-validated and hidden behind a distinct schedule kind rather than being the only schedule representation.

## Events and Commands

Recommended command types:

- `automation.create`
- `automation.update`
- `automation.delete`
- `automation.enable`
- `automation.disable`
- `automation.run.record`
- `automation.run.update`

Recommended event types:

- `automation.created`
- `automation.updated`
- `automation.deleted`
- `automation.enabled`
- `automation.disabled`
- `automation.run-created`
- `automation.run-started`
- `automation.run-completed`
- `automation.run-failed`
- `automation.run-skipped`
- `automation.run-cancelled`

The implementation may use an event store like Kanban or direct durable tables if that is materially simpler, but it must preserve command idempotency and auditable run history. Do not overload orchestration thread events to store schedule state.

## Persistence

Add SQLite migrations for automation definitions and run records. Required indexed lookup paths:

- enabled automations by `next_run_at`
- runs by automation id and created/started time
- active runs by automation id
- output thread id lookup

Definitions should store normalized schedule config JSON and derived `nextRunAt`/`lastRunAt` fields. Run records should store status, trigger type, result thread id, optional orchestration command ids, started/completed timestamps, error message, changed-file summary JSON, and skipped reason.

## Server

Add Automation services following the current server layering style:

- command/decider logic for invariants
- projection or row writer
- snapshot query
- WebSocket handlers
- runtime layer wiring

The server must validate target existence and project/thread ownership where possible during create/update. It should not allow the web client to decide derived status fields directly.

## WebSocket API

Add methods similar to:

- `automation.getSnapshot`
- `automation.dispatchCommand`
- `automation.subscribe`
- `automation.unsubscribe`

Subscriptions should stream initial snapshot plus updates or expose a durable event stream pattern consistent with the existing Kanban/orchestration WebSocket handlers.

## Acceptance Criteria

- A client can create an automation with title, prompt, target, schedule, timezone, model selection, runtime mode, environment mode, and write policy.
- New automations default to `local` environment mode.
- Automations can be updated, enabled, disabled, and deleted.
- Run records can be created and projected without starting providers.
- Snapshot query returns definitions and recent runs.
- Web clients can subscribe to automation updates.
- Command retries with the same command id are idempotent or rejected consistently.
- Invalid targets, invalid schedules, and missing required fields are rejected server-side.

## Verification

- Contract schema tests for automation commands, events, schedules, targets, and snapshots.
- Decider or service tests for create/update/delete invariants.
- Persistence migration tests.
- Snapshot query tests.
- WebSocket handler tests for snapshot and command dispatch.
