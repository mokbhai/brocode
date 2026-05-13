# Phase 2: Scheduler and Run Engine

## Goal

Execute automations on schedule and via `Run now` by creating run records and dispatching normal BroCode orchestration commands to automation-owned result threads.

## Scope

Add server-owned scheduling and run orchestration:

- next-run calculation
- due-run polling
- startup recovery
- duplicate-run lock
- manual `Run now`
- result thread creation/reuse
- orchestration dispatch
- terminal run state updates

This phase should produce real agent output in result threads. Write-mode guardrails and richer diff review are completed in later phases, but this phase must not knowingly allow duplicate overlapping runs.

## Schedule Calculation

The scheduler must use explicit timezone-aware schedule evaluation. Structured presets should cover:

- hourly
- daily at time
- weekdays at time
- weekly day/time
- monthly day/time

Store both normalized schedule config and derived `nextRunAt`. On startup and after every terminal run state, compute the next future run time.

Missed-run policy:

- If an enabled automation is overdue on startup, claim one run.
- Do not backfill every missed interval.
- Record that the run was startup-recovered or skipped.

Overlap policy:

- If an automation has an active run, a due tick records a skipped run by default.
- There must be no unbounded queue of pending automation runs.

## Run Triggers

Support trigger types:

- `scheduled`
- `startup-recovery`
- `manual`

Manual `Run now` should bypass `nextRunAt` timing but still respect active-run locking and target validation.

## Result Thread Behavior

Each automation owns a result thread. The first run creates that thread if missing. Later runs append to the same result thread unless the automation is deleted.

Result thread creation should dispatch existing orchestration commands. The result thread should have a recognizable title and metadata link back to the automation if the current contracts can support that cleanly. If a direct metadata link would require broad thread contract changes, store the link in the automation domain first and keep the thread title descriptive.

Generated run prompt should include:

- automation title
- trigger type
- schedule time
- selected target context
- user-authored automation prompt
- execution policy summary

The prompt should be deterministic and testable. Avoid embedding UI-only text.

## Orchestration Dispatch

The run engine must use existing orchestration commands such as:

- `thread.create`
- `thread.turn.start`
- thread metadata updates where needed

It must not call provider adapters directly. Provider lifecycle, pending approvals, user input, transcript output, and turn completion should continue through the existing orchestration/provider pipeline.

## Run Completion

The engine should observe enough orchestration/provider state to mark runs terminal:

- completed
- failed
- skipped
- cancelled

If provider completion cannot be reliably correlated in the first implementation, the phase must add the missing correlation metadata rather than guessing from latest thread state.

## Acceptance Criteria

- Enabled automations run when `nextRunAt` is due.
- Manual `Run now` creates a run immediately when no active run exists.
- Startup recovery runs at most one overdue run per automation.
- The scheduler updates `nextRunAt` after a run is claimed or completed.
- Duplicate overlapping runs for the same automation are prevented.
- A result thread is created automatically and reused on later runs.
- Provider output appears in the result thread.
- Run status updates are persisted and visible in snapshots.
- Failures during target validation, thread creation, or turn dispatch mark the run failed with a useful message.

## Verification

- Schedule calculation tests across timezones and boundaries.
- Startup recovery tests for overdue, disabled, deleted, and already-active automations.
- Duplicate lock tests.
- Manual run tests.
- Orchestration dispatch tests with a fake orchestration engine/provider service.
- Run completion and failure correlation tests.
