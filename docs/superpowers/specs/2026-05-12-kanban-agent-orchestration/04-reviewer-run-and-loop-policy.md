# Phase 4: Reviewer Run and Loop Policy

## Goal

Add reviewer runs and the bounded implementation-review loop.

## Scope

Add reviewer orchestration through existing provider architecture:

- build reviewer prompt from title, description/context, generated task list, diff/checkpoint summary, worker summary, and guardrail policy
- dispatch reviewer through existing provider turn APIs
- parse reviewer result as `approved`, `needs_work`, `blocked`, or `inconclusive`
- create or update follow-up tasks from concrete reviewer findings
- transition card status based on reviewer result
- enforce loop limits and blocker conditions

The loop should be server-owned. The UI can start or stop it, but the server decides the next state from durable events and provider runtime events.

## Required Guardrails

- max loop iterations per card
- max consecutive reviewer failures
- max wall-clock duration per run
- explicit blocker state for pending provider approvals or user input
- explicit blocker state for vague or non-actionable reviewer feedback
- explicit blocker state for unexpected dirty worktree state before a run
- visible retry/run counters

## Acceptance Criteria

- Worker completion can trigger reviewer run.
- Reviewer approval moves card to `Approved`.
- Reviewer follow-up findings create tasks and move card to `Needs Work`.
- `Needs Work` can loop back to implementation within configured limits.
- Loop limit moves card to `Loop Limit Reached`.
- Blockers stop automation and show a human-readable reason.

## Verification

- Reactor tests for approved, needs-work, blocked, inconclusive, and loop-limit outcomes.
- Parser tests for reviewer result handling.
- Projector tests for run/review/task event replay.
- Integration-style test for worker -> reviewer -> needs work -> worker -> reviewer -> approved.
