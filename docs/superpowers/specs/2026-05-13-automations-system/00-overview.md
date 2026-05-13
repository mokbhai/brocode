# Automations System

## Complete Target

BroCode should add a native Automations section where users define scheduled agent work. An automation owns a title, prompt, target context, schedule, model/runtime settings, execution environment, enabled state, output thread, and run history. Runs can read a project, chat, or thread context and write their output to an automation-owned result thread. When writes are enabled, runs can change files using the selected environment mode.

The system must be a first-class server-owned domain, not a web-only timer. It should persist automation definitions and run records, recover after restart, prevent duplicate overlapping runs, and dispatch actual agent work through existing BroCode orchestration and provider services.

The first complete version defaults new automations to local execution. The create/edit UI includes an environment dropdown where the user can switch to worktree/branch isolation. Local execution is allowed to make code and file changes, but unattended local writes must have explicit guardrails for dirty checkout conflicts, cancellation, failure recording, and review.

## Research Notes

OpenAI's Codex Automations product runs recurring tasks on schedules and returns results for review. OpenAI also notes that local automations depend on the local machine and Codex being available. That is relevant for BroCode because the complete target is local-first and must treat restart, sleep, and missed-run behavior as core product concerns rather than edge cases.

OpenAI's Codex App Server architecture keeps the agent loop, thread lifecycle, persistence, approvals, streaming, and diff events behind a client-facing JSON-RPC surface. BroCode already follows this shape through its provider and orchestration layers. Automations should therefore reuse orchestration commands and provider runtime ingestion instead of introducing a second agent execution path.

References:

- OpenAI Codex Automations: https://openai.com/academy/codex-automations
- OpenAI Codex app-server architecture: https://openai.com/index/unlocking-the-codex-harness/
- `cron-parser` timezone-capable parser reference: https://www.npmjs.com/package/cron-parser

## User Experience

The sidebar includes an `Automations` route with a badge/count and a `+ New automation` action. The list shows current automations with title, target label, schedule summary, enabled state, last run, next run, and current status.

Creating or editing an automation uses a focused sheet or dialog with:

- title
- prompt editor
- target picker
- schedule picker
- timezone
- environment dropdown, defaulting to `Local`
- model/provider settings
- runtime/permission controls
- writes-enabled state
- enabled toggle

Targets should support:

- `Project`: run with project workspace context.
- `Thread`: read a selected source thread as context while writing to the automation-owned result thread.
- `Chat/home`: run without a project when the current home-chat model supports it cleanly.

Each automation has an automation-owned result thread. Scheduled runs and manual `Run now` both append a generated user message to that thread and let the provider produce normal assistant output there. The run detail links to the result thread and shows status, started/completed times, failure reason, changed-file summary, and retry/cancel controls.

## Architecture Quality Bar

Automations state should be native BroCode state, separate from orchestration but integrated with it. Runtime scheduling logic belongs in `apps/server`. Shared schemas and transport contracts belong in `packages/contracts`. Shared runtime utilities belong in `packages/shared` only when they are genuinely cross-package.

The Automation domain owns:

- definitions
- schedule config
- enabled state
- next-run and last-run metadata
- run attempts
- duplicate-run locks
- missed-run decisions
- snapshots and subscriptions

The Orchestration domain still owns:

- projects
- threads
- messages
- provider sessions
- approvals and user input
- transcript rendering
- provider runtime ingestion
- checkpoints and diffs

The server creates or reuses result threads by dispatching existing orchestration commands. Automations must not directly call provider adapters, bypass orchestration, or duplicate transcript/persistence logic.

## Scheduling Policy

The first user-facing schedule model should use structured presets: hourly, daily, weekdays, weekly, and monthly. Raw cron can be an advanced mode only if the implementation remains well-tested and timezone-explicit.

Every schedule stores an explicit timezone, `nextRunAt`, `lastRunAt`, and normalized schedule config. The scheduler computes the next future run time after every terminal run state and after startup recovery.

Missed-run policy:

- If BroCode starts and an enabled automation is overdue, run it once.
- Do not backfill every missed tick.
- After the recovery run is claimed or skipped, compute the next future run.

Overlap policy:

- Only one active run per automation.
- If the next tick arrives while a run is active, record a skipped run by default.
- Do not create an unbounded queue of agent runs.

## Execution Policy

New automations default to `Local` environment mode. Users can switch to `Worktree` from the environment dropdown.

Local mode:

- Uses the selected project checkout.
- Can make code/file changes when writes are enabled.
- Runs a dirty-checkout preflight before scheduled write-enabled runs.
- By default, skips the run if the checkout is dirty and records the reason in run history and the result thread.
- Provides an advanced per-automation toggle to allow running on dirty local state.

Worktree mode:

- Uses an isolated branch/worktree compatible with existing BroCode thread/worktree helpers.
- Reports changed files and branch/worktree metadata after the run.
- Keeps submission/merge human-controlled.

Both modes:

- support `Run now`
- support cancellation of active runs
- record failures
- surface provider pending approvals/user input through existing thread UI
- prevent duplicate overlapping runs

## Required Phases

1. [Automation Domain and Projections](./01-automation-domain-and-projections.md)
2. [Scheduler and Run Engine](./02-scheduler-and-run-engine.md)
3. [Automations UI](./03-automations-ui.md)
4. [Write-Mode Guardrails and Output Review](./04-write-mode-guardrails-and-output-review.md)
5. [Hardening and Verification](./05-hardening-and-verification.md)

Each phase should produce working software with focused tests. The feature is complete when all required phases are implemented.

## Completion Criteria

- Users can create, edit, enable, disable, delete, and run automations.
- Automations can run on a schedule and manually via `Run now`.
- Each run creates an auditable run record.
- Each automation writes output to an automation-owned result thread.
- Project/thread/chat targets are represented in contracts and validated server-side.
- Local mode is the default and can perform writes with dirty-checkout guardrails.
- Worktree mode is selectable and runs in isolation.
- The scheduler survives app restart and handles missed runs once.
- Duplicate overlapping runs are prevented.
- Run failures are visible in both run history and the result thread.
- WebSocket snapshots/subscriptions keep the Automations route current.
