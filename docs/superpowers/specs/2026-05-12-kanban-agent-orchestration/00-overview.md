# Kanban Agent Orchestration

## Complete Target

BroCode should add a native Kanban section where a completed planning thread or spec becomes an executable card. A card owns the execution lifecycle: user-provided execution context, model/runtime settings, model-generated checklist, isolated worktree and branch, linked provider threads, worker runs, reviewer runs, retry policy, blocker state, and submission readiness.

The experience should preserve BroCode's current architecture. Kanban orchestration schedules existing provider sessions and turns. It must not introduce a new LLM calling layer, direct model SDK integration, duplicate streaming system, or provider-specific protocol handling. All model execution goes through existing provider abstractions such as `ProviderService`, provider adapters, `ModelSelection`, `ProviderStartOptions`, provider runtime events, and orchestration events.

The first complete version uses one shared isolated worktree and branch per card. Worker and reviewer agents operate against that card context. The implementation loop is bounded and automated, while PR/submission remains human-gated.

## User Experience

The user plans work in Threads. Once a spec is ready, they create a Kanban card with a title, description, runtime mode, provider, and model. The description is the single user-authored context field: the user can paste a spec, paste notes, or include a path to a spec file. Kanban does not expose separate source modes, separate spec-path input, separate inline-spec input, or a manual initial-task list. The first worker run generates the initial to-do list from the card context.

The Kanban board is a peer section beside Threads and Workspace. It is an execution control plane, not another transcript view. The card detail panel shows the description/context, generated checklist, run history, reviewer findings, linked threads, worktree and branch, diff/checkpoint links, and start/stop controls.

## Required Lifecycle

Cards move through these states:

- `Draft`
- `Ready`
- `Implementing`
- `Reviewing`
- `Needs Work`
- `Approved`
- `Ready to Submit`
- `Submitted`

Failure and stop states:

- `Blocked`
- `Loop Limit Reached`
- `Agent Error`
- `Review Inconclusive`

The normal loop is:

1. Card enters `Ready`.
2. Worker run starts through existing provider orchestration.
3. Worker generates missing tasks from the card context, then works through card tasks in the card worktree.
4. Worker completion moves the card to `Reviewing`.
5. Reviewer run starts through existing provider orchestration.
6. Reviewer either approves, blocks, or creates concrete follow-up tasks.
7. Follow-up tasks return the card to implementation.
8. Approval moves the card to `Ready to Submit`.
9. Human action submits or opens a PR.

## Architecture Quality Bar

Kanban state should be native BroCode state, preferably event-sourced alongside the current orchestration model. Runtime logic belongs in `apps/server`. Shared contracts and schemas belong in `packages/contracts`. Shared runtime utilities belong in `packages/shared` only when they are truly cross-package and not Kanban business logic.

The server owns card transitions. UI actions request commands, but the UI does not decide whether a card is approved, blocked, or ready to submit.

Provider execution is role-bound thread execution:

- A Kanban worker is a provider thread/run with worker prompt context.
- A Kanban reviewer is a provider thread/run with reviewer prompt context.
- Provider output returns through existing runtime ingestion.
- Kanban maps provider completion back to card runs and card status.

## Guardrails

The autonomous loop must stop or block on:

- max loop iterations per card
- max consecutive reviewer failures
- max wall-clock duration per run
- provider failure
- pending approval or user input without human response
- vague reviewer feedback that cannot become actionable tasks
- unexpected dirty or untracked worktree state before starting
- missing test/lint commands when required by the spec

Submission and PR creation are human-gated in the complete target for this spec set.

## Required Phases

1. [Kanban Domain and Projection](./01-kanban-domain-and-projection.md)
2. [Kanban UI and Card Creation](./02-kanban-ui-and-card-creation.md)
3. [Single Worker Run](./03-single-worker-run.md)
4. [Reviewer Run and Loop Policy](./04-reviewer-run-and-loop-policy.md)
5. [Submission Gate](./05-submission-gate.md)

Each phase should produce working software and focused tests. The feature is complete when all phases are implemented.
