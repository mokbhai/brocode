# Phase 3: Single Worker Run

## Goal

Allow a card to start one worker run through existing provider architecture and record the result.

## Non-Negotiable Boundary

Do not call model vendor SDKs directly. Do not add a new LLM abstraction. Worker execution must use existing provider orchestration, especially `ProviderService`, existing provider adapters, `ModelSelection`, `ProviderStartOptions`, provider runtime events, and existing thread/session handling.

## Scope

Add a server-side coordinator that can:

- prepare a card worktree and branch
- create or attach a provider thread for the worker run
- build a worker prompt from title, description/context, existing generated tasks if any, worktree, and run policy
- dispatch the prompt through existing provider turn APIs
- record `kanban.run.started`
- observe provider completion
- record `kanban.run.completed`
- create missing initial tasks and update task status conservatively from structured worker summary

Worker output should be parsed conservatively. The first version should prefer structured run summaries over letting the worker directly mutate card state. If a card has no tasks when the worker starts, the worker must generate the initial to-do list in the structured summary. The server validates those generated tasks before persisting them.

## Acceptance Criteria

- User can start a single worker run from a ready card.
- The card moves to `Implementing`.
- The worker run uses the configured existing provider/model.
- The worker run is linked to a provider thread visible through existing thread UI.
- Provider completion records a Kanban run result.
- Cards do not require user-provided initial tasks before a worker run can start.
- If no tasks exist yet, the structured worker result can create a validated initial to-do list.
- Card task status updates are validated server-side.
- Generated tasks and task updates are persisted through server-owned/internal task commands or events, not public client task commands.
- Provider failure moves the card to `Agent Error` or `Blocked` with a visible reason.

## Verification

- Reactor tests with fake `ProviderService`.
- Prompt builder tests for required context and guardrail text.
- Summary parser tests for generated tasks and task updates.
- Event tests for run start, generated task persistence, and completion.
- Integration-style test for card ready -> implementing -> run completed.
