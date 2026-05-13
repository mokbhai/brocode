# Phase 5: Hardening and Verification

## Goal

Prove the Automations system behaves predictably under restart, sleep, reconnect, provider failure, and concurrent UI/server activity.

## Scope

This phase hardens the complete feature:

- restart recovery
- missed-run behavior
- duplicate prevention
- WebSocket consistency
- target deletion or archival
- provider errors
- pending approvals and user input
- long-running runs
- disabled/deleted automation behavior
- retention interactions

## Reliability Cases

The system must explicitly handle:

- BroCode starts after a run was missed.
- BroCode starts while a run record was left active from a previous process.
- The selected target project/thread was deleted.
- The result thread was deleted or archived.
- The provider fails before session start.
- The provider fails after file changes.
- A run asks for approval or user input and waits.
- The scheduler tick fires while another run is active.
- The user disables or deletes an automation while a run is active.
- The web client reconnects while run events are streaming.

## Recovery Rules

Restart recovery should not blindly restart active runs. It should inspect persisted run state and provider/orchestration state, then choose one of:

- resume observation of an active run
- mark stale active run failed/interrupted
- schedule one startup-recovery run if due
- skip because disabled/deleted/target missing

Deleting an automation should stop future scheduling. It should not destroy result threads or run history unless the user explicitly asks for destructive cleanup.

## Performance Rules

The scheduler should avoid frequent full read-model scans under normal operation. Prefer indexed due-run lookup and modest polling. Snapshot payloads should remain bounded by returning recent run history by default, with pagination or detail queries if needed.

The UI must not cause transcript auto-scroll churn. Automation list updates should stay separate from active transcript scroll-follow paths.

## Testing Strategy

Use focused tests rather than repeated full workspace checks during iteration:

- contract schema tests
- service/decider tests
- scheduler unit tests with injected clock
- persistence migration tests
- WebSocket handler tests
- UI store/component tests
- integration-style fake provider run tests

Per project instruction, final workspace verification should use `bun fmt`, `bun lint`, and `bun typecheck` only when explicitly requested in the current conversation. Tests should use `bun run test`, never `bun test`.

## Acceptance Criteria

- Restart behavior is deterministic and covered by tests.
- Missed runs execute once, not once per missed tick.
- Duplicate overlapping runs are prevented under concurrent claims.
- Disabled or deleted automations do not run.
- Target deletion produces clear skipped/failed state.
- Provider failures surface in run history and result thread.
- Pending approvals/user input do not corrupt scheduler state.
- Snapshot/subscription behavior remains consistent after reconnect.
- The feature has focused tests for schedule math, run locking, local dirty policy, worktree policy, and UI state.

## Verification

- Run the targeted test suites added in phases 1-5.
- Run final full workspace verification only when the user explicitly asks for it, using the repository-approved commands.
