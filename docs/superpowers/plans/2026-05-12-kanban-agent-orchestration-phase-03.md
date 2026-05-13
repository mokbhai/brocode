# Kanban Agent Orchestration Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a ready Kanban card start one worker run through BroCode's existing provider/thread architecture and record the result.

**Complete Target:** Native BroCode Kanban cards execute bounded worker/reviewer loops through existing provider architecture, with one shared card worktree and human-gated submission.

**Architecture:** Add a server-side Kanban worker coordinator that owns worktree preparation, worker-thread creation, prompt construction, run command dispatch, provider completion observation, and conservative task-status updates. It must not call model SDKs or provider adapters directly; it dispatches existing orchestration commands so `ProviderCommandReactor` and `ProviderService` remain the only provider execution path.

**Tech Stack:** Effect services/layers, existing Kanban event engine, existing orchestration engine, existing provider runtime event stream, GitCore worktree helpers, React/Zustand Kanban UI, Vitest.

**Spec Source:** `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/00-overview.md` + `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/02-kanban-ui-and-card-creation.md` + `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/03-single-worker-run.md`

**Phase:** Phase 3: Single Worker Run

**Next Required Phase:** Phase 4: Reviewer Run and Loop Policy, `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/04-reviewer-run-and-loop-policy.md`

---

## File Structure

- Modify `apps/web/src/components/kanban/KanbanCreateCardDialog.tsx`: simplify card creation to title, description, runtime mode, provider, and model.
- Modify `apps/web/src/components/kanban/kanbanCreateCard.logic.ts`: remove source modes, spec-path/inline-spec merging, and initial-task parsing from create-card input building.
- Modify `apps/web/src/components/kanban/kanbanCreateCard.logic.test.ts`: assert removed fields are neither required nor submitted.
- Modify `apps/web/src/kanbanStore.ts`: stop requiring UI-supplied initial tasks for card creation and remove public task mutation actions.
- Modify `apps/web/src/components/kanban/KanbanBoard.tsx`, `apps/web/src/components/kanban/KanbanCardDetailPanel.tsx`, and `apps/web/src/routes/_chat.kanban.$projectId.tsx`: remove manual task add/edit/delete wiring and separate spec-path editing.
- Modify `packages/contracts/src/kanban.ts`: remove `specPath`, client task mutation commands, and worktree metadata from the public card/create/update contract surface.
- Modify `apps/server/src/kanban/decider.ts` and projection/snapshot/RPC tests: stop deriving or exposing a separate card spec path and treat task mutation commands as server-owned/internal.
- Create `apps/server/src/kanban/workerPrompt.ts`: pure worker prompt builder.
- Test `apps/server/src/kanban/workerPrompt.test.ts`: required context, guardrails, generated-task instructions, structured summary instructions.
- Create `apps/server/src/kanban/workerSummary.ts`: pure parser/validator for structured worker summaries extracted from assistant text.
- Test `apps/server/src/kanban/workerSummary.test.ts`: strict JSON extraction, generated-task validation, task-status validation, malformed output handling.
- Create `apps/server/src/kanban/Layers/KanbanWorkerCoordinator.ts`: Effect service implementation for start/run/observe.
- Create `apps/server/src/kanban/Services/KanbanWorkerCoordinator.ts`: service interface and typed errors.
- Test `apps/server/src/kanban/Layers/KanbanWorkerCoordinator.test.ts`: fake engines/provider stream/git behavior.
- Use `apps/server/src/serverSettings.ts`: read server provider settings for `ProviderStartOptions`.
- Modify `apps/server/src/kanban/runtimeLayer.ts`: provide the coordinator layer.
- Modify `apps/server/src/wsRpc.ts`: add RPC handler for starting a worker run.
- Modify `packages/contracts/src/kanban.ts`: add `kanban.startWorkerRun` RPC input/output schemas.
- Test `packages/contracts/src/kanban.test.ts` and `packages/contracts/src/ws.test.ts`: schema/RPC decoding.
- Modify `apps/server/src/kanban/decider.ts`: make worker run completion update card status to `reviewing` on success and `agent_error` on provider failure/interruption.
- Test `apps/server/src/kanban/decider.test.ts`: status changes for worker run completion and failure.
- Modify `packages/contracts/src/kanban.ts`: add a server-only `kanban.card.worktree.set` internal command for worktree metadata.
- Test `packages/contracts/src/kanban.test.ts`: public client commands cannot mutate card worktree metadata, internal command can.
- Modify `apps/web/src/kanbanStore.ts`: add `startKanbanWorkerRun(cardId)` action calling the new native API method.
- Test `apps/web/src/kanbanStore.test.ts`: store calls native API with the card ID.
- Modify `apps/web/src/wsNativeApi.ts`: expose `api.kanban.startWorkerRun`.
- Test `apps/web/src/wsNativeApi.test.ts`: request uses `KANBAN_WS_METHODS.startWorkerRun`.
- Modify `apps/web/src/components/kanban/KanbanBoard.tsx` and `apps/web/src/routes/_chat.kanban.$projectId.tsx`: wire existing Start run buttons.
- Modify `apps/web/src/components/kanban/KanbanCardDetailPanel.tsx`: disable/start button state when not ready or already running.

## Architectural Decisions

- Card creation captures only user intent and execution settings: title, description, runtime mode, provider, and model. The description is the single user-authored context field and may contain pasted spec text, notes, a path to a spec, or any combination of those. Do not add a source selector, separate spec-path field, separate inline-spec field, manual initial-task field, or worktree metadata field.
- Initial tasks are model-generated. If a card has no tasks when the worker finishes, the structured worker summary may include `generatedTasks`; the server validates and persists those tasks before applying task updates. The UI must not require tasks before execution.
- Manual task CRUD is not part of the Kanban UI or public client command surface. Task creation, updates, and deletion are server-owned so worker/reviewer outputs remain the single source of truth for the checklist.
- The coordinator starts provider work by dispatching `thread.create` and `thread.turn.start` through `OrchestrationEngineService`. It must not call `ProviderService.startSession`, `ProviderService.sendTurn`, provider adapters, Codex app-server, Claude SDKs, or any vendor SDK directly.
- The worker thread is a normal BroCode thread with `subagentRole: "kanban-worker"`, `modelSelection` from the card, and `runtimeMode` from the card. This keeps logs visible in existing thread UI.
- The card worktree is prepared once per card and persisted back with the server-only `kanban.card.worktree.set` command. If the card already has `worktreePath` and associated worktree metadata, reuse it after checking it is a Git repo and not dirty.
- Worktree metadata is server-owned. It must be persisted through an internal `kanban.card.worktree.set` command, not through the public `ClientKanbanCommand` update path.
- The first version parses a structured worker summary from assistant messages after completion. The worker cannot directly mutate card state. The server validates generated task titles/descriptions/statuses and validates task IDs/statuses before dispatching server-owned task upsert events/commands.
- Provider completion is observed through orchestration state as the source of truth, with provider runtime events used only as wake-up signals. The coordinator must wait until provider ingestion has projected terminal assistant output or a startup failure before parsing results. On success, record `kanban.run.complete` with `status: "completed"`. On provider error/abort/timeout, record `status: "failed"` or `status: "interrupted"` and move the card to `agent_error` with a visible reason.

## Task 0: Simplify Card Creation Before Worker Runs

**Files:**
- Modify: `packages/contracts/src/kanban.ts`
- Modify: `packages/contracts/src/kanban.test.ts`
- Modify: `apps/web/src/components/kanban/KanbanCreateCardDialog.tsx`
- Modify: `apps/web/src/components/kanban/kanbanCreateCard.logic.ts`
- Modify: `apps/web/src/components/kanban/kanbanCreateCard.logic.test.ts`
- Modify: `apps/web/src/components/kanban/KanbanBoard.tsx`
- Modify: `apps/web/src/components/kanban/KanbanCardDetailPanel.tsx`
- Modify: `apps/web/src/routes/_chat.kanban.$projectId.tsx`
- Modify: `apps/web/src/kanbanStore.ts`
- Modify: `apps/web/src/kanbanStore.test.ts`
- Modify: `apps/web/src/components/kanban/KanbanBoard.browser.tsx`
- Modify: `apps/web/src/components/kanban/kanbanBoard.logic.test.ts`
- Modify: `apps/server/src/kanban/decider.ts`
- Modify: `apps/server/src/kanban/decider.test.ts`
- Modify: `apps/server/src/kanban/projector.test.ts`
- Modify: `apps/server/src/kanban/Layers/KanbanEngine.test.ts`
- Modify: `apps/server/src/kanban/Layers/KanbanSnapshotQuery.ts`
- Modify: `apps/server/src/kanban/Layers/KanbanSnapshotQuery.test.ts`
- Modify: `apps/server/src/kanban/Layers/KanbanProjectionPipeline.ts`
- Modify: `apps/server/src/kanban/Layers/KanbanProjectionPipeline.test.ts`
- Modify: `apps/server/src/wsRpc.test.ts`

- [ ] **Step 1: Write failing simplification tests**

Cover:

- create-card logic accepts only title, description, runtime mode, provider, and model as user-visible inputs
- create-card command omits user-provided tasks
- contract tests reject `specPath` and worktree metadata on public create/update commands, reject `tasks` on public create commands, reject public `kanban.task.upsert/delete`, and do not expose `specPath` on `KanbanCard`
- source mode, separate spec path, inline spec, and initial tasks are not required to build a valid create-card input
- dialog does not render Source, Spec path, Inline spec, or Initial tasks controls
- detail panel does not render Add task, task edit, or task delete controls
- provider/model selection follows the same model-selection shape used by Threads
- detail panel edits title/description/runtime/model metadata without exposing a separate spec-path editor
- route, board, and store no longer expose public `upsertKanbanTask` or `deleteKanbanTask` actions

- [ ] **Step 2: Run focused simplification tests and confirm failure**

Run:

```bash
bun run --cwd packages/contracts test src/kanban.test.ts
bun run --cwd apps/server test src/kanban/decider.test.ts src/kanban/projector.test.ts src/kanban/Layers/KanbanEngine.test.ts src/kanban/Layers/KanbanSnapshotQuery.test.ts src/kanban/Layers/KanbanProjectionPipeline.test.ts src/wsRpc.test.ts
bun run --cwd apps/web test src/components/kanban/kanbanCreateCard.logic.test.ts src/components/kanban/kanbanBoard.logic.test.ts src/kanbanStore.test.ts
```

Expected: fail because the current create flow still supports source modes, separate spec fields, and user-provided tasks.

- [ ] **Step 3: Simplify create-card logic**

Remove `specPath` from `KanbanCard`, public create/update commands, and public read-model decoding. Existing projection storage columns can remain nullable and ignored until a dedicated schema cleanup, but new snapshots and commands must not expose them.

Remove `branch`, `worktreePath`, `associatedWorktreePath`, `associatedWorktreeBranch`, and `associatedWorktreeRef` from the public `kanban.card.create` command. Newly created cards should initialize these fields as absent/null server-side until the coordinator persists real metadata through `kanban.card.worktree.set`.

Move `kanban.task.upsert` and `kanban.task.delete` out of `ClientKanbanCommand`. If the existing decider needs these command shapes for worker/reviewer output, keep or introduce them only on the server/internal command path. The browser should receive task changes through projected events, not by issuing manual task commands.

Remove `KanbanCreateCardMode`, `parseKanbanInitialTasks`, `inlineSpec`, and source-mode branching from `kanbanCreateCard.logic.ts`.

Expose a simple builder input:

```ts
export interface BuildCreateKanbanCardInputOptions {
  readonly boardId: KanbanBoardId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly description?: string;
  readonly runtimeMode: RuntimeMode;
  readonly modelSelection: ModelSelection;
  readonly sourceThreadId?: ThreadId | null;
}
```

Keep `sourceThreadId` only as optional hidden metadata for actions launched from a thread. Do not expose it as a source selector in the dialog.

- [ ] **Step 4: Simplify the dialog**

Render only:

- Title
- Description
- Runtime mode
- Provider
- Model

Use the same provider/model option helpers used by the Threads composer where practical. Do not create a new model/provider registry or call provider APIs from the dialog.

- [ ] **Step 5: Keep card creation server-compatible**

The public `kanban.card.create` contract must not accept user-provided tasks or worktree metadata. `kanban.card.created` event payloads may retain a task array for replay compatibility, but the decider should emit an empty task array for newly created cards. Server-generated tasks from worker summaries should be persisted later through internal task upsert events/commands. Do not add another public card source field or separate spec-path field.

- [ ] **Step 6: Run focused simplification tests**

Run:

```bash
bun run --cwd packages/contracts test src/kanban.test.ts
bun run --cwd apps/server test src/kanban/decider.test.ts src/kanban/projector.test.ts src/kanban/Layers/KanbanEngine.test.ts src/kanban/Layers/KanbanSnapshotQuery.test.ts src/kanban/Layers/KanbanProjectionPipeline.test.ts src/wsRpc.test.ts
bun run --cwd apps/web test src/components/kanban/kanbanCreateCard.logic.test.ts src/components/kanban/kanbanBoard.logic.test.ts src/kanbanStore.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/kanban.ts packages/contracts/src/kanban.test.ts apps/server/src/kanban/decider.ts apps/server/src/kanban/decider.test.ts apps/server/src/kanban/projector.test.ts apps/server/src/kanban/Layers/KanbanEngine.test.ts apps/server/src/kanban/Layers/KanbanSnapshotQuery.ts apps/server/src/kanban/Layers/KanbanSnapshotQuery.test.ts apps/server/src/kanban/Layers/KanbanProjectionPipeline.ts apps/server/src/kanban/Layers/KanbanProjectionPipeline.test.ts apps/server/src/wsRpc.test.ts apps/web/src/components/kanban/KanbanCreateCardDialog.tsx apps/web/src/components/kanban/kanbanCreateCard.logic.ts apps/web/src/components/kanban/kanbanCreateCard.logic.test.ts apps/web/src/components/kanban/KanbanBoard.tsx apps/web/src/components/kanban/KanbanCardDetailPanel.tsx apps/web/src/components/kanban/KanbanBoard.browser.tsx apps/web/src/components/kanban/kanbanBoard.logic.test.ts apps/web/src/routes/_chat.kanban.$projectId.tsx apps/web/src/kanbanStore.ts apps/web/src/kanbanStore.test.ts
git commit -m "fix: simplify kanban card creation"
```

## Task 1: Contracts and RPC Surface

**Files:**
- Modify: `packages/contracts/src/kanban.ts`
- Modify: `packages/contracts/src/kanban.test.ts`
- Modify: `packages/contracts/src/ws.ts`
- Modify: `packages/contracts/src/ws.test.ts`
- Modify: `packages/contracts/src/rpc.ts`
- Modify: `packages/contracts/src/ipc.ts`

- [ ] **Step 1: Write failing contract tests**

Add tests that decode:

```ts
{
  cardId: "card-1"
}
```

as `KanbanStartWorkerRunInput`, and verify `KANBAN_WS_METHODS.startWorkerRun === "kanban.startWorkerRun"`.

Add command-shape tests proving:

- `ClientKanbanCommand` rejects `kanban.card.worktree.set`
- `ClientKanbanCommand` rejects `kanban.task.upsert` and `kanban.task.delete`
- decoding `kanban.card.create` as `ClientKanbanCommand` rejects `worktreePath`, `branch`, and associated worktree fields
- decoding `kanban.card.update` as `ClientKanbanCommand` rejects `worktreePath`, `branch`, and associated worktree fields
- server/internal command decoding accepts `kanban.card.worktree.set`, `kanban.task.upsert`, and `kanban.task.delete`

- [ ] **Step 2: Run tests and confirm failure**

Run: `bun run --cwd packages/contracts test src/kanban.test.ts src/ws.test.ts`

Expected: fail because the schema and method do not exist.

- [ ] **Step 3: Add RPC schemas**

Add:

```ts
export const KanbanStartWorkerRunInput = Schema.Struct({
  cardId: KanbanCardId,
});

export const KanbanStartWorkerRunResult = Schema.Struct({
  runId: KanbanRunId,
  threadId: ThreadId,
});
```

Extend `KANBAN_WS_METHODS`, `KanbanRpcSchemas`, `WsRequestBody`, `WsKanban...Rpc`, and `NativeApi["kanban"]` equivalents.

Add an internal command only to `KanbanInternalCommand`:

```ts
{
  type: "kanban.card.worktree.set",
  commandId: CommandId,
  cardId: KanbanCardId,
  branch: NullableBranchOrWorktree,
  worktreePath: NullableBranchOrWorktree,
  associatedWorktreePath: NullableTrimmedString,
  associatedWorktreeBranch: NullableTrimmedString,
  associatedWorktreeRef: NullableTrimmedString,
  updatedAt: IsoDateTime,
}
```

Do not add these fields to the public `kanban.card.update` client command.

- [ ] **Step 4: Run focused contract tests**

Run: `bun run --cwd packages/contracts test src/kanban.test.ts src/ws.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/kanban.ts packages/contracts/src/kanban.test.ts packages/contracts/src/ws.ts packages/contracts/src/ws.test.ts packages/contracts/src/rpc.ts packages/contracts/src/ipc.ts
git commit -m "feat: add kanban worker run rpc contract"
```

## Task 2: Worker Prompt and Summary Parser

**Files:**
- Create: `apps/server/src/kanban/workerPrompt.ts`
- Create: `apps/server/src/kanban/workerPrompt.test.ts`
- Create: `apps/server/src/kanban/workerSummary.ts`
- Create: `apps/server/src/kanban/workerSummary.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Cover:

- title, description/context, existing generated task list when present, worktree path, branch, runtime policy all appear in the prompt
- when no tasks exist, prompt explicitly asks the worker to generate the initial to-do list in the final structured summary
- prompt says provider execution is through BroCode and must not request external model credentials
- prompt requires a final fenced JSON summary

Expected summary shape:

```json
{
  "summary": "short human-readable result",
  "generatedTasks": [
    { "title": "Add payload tests", "description": "Optional detail", "status": "done" }
  ],
  "taskUpdates": [
    { "taskId": "task-1", "status": "done" }
  ]
}
```

`generatedTasks` is used only for new tasks the worker derives from the card context, especially when the card has no tasks yet. `taskUpdates` is used only for tasks that already have server-issued task IDs.

- [ ] **Step 2: Write failing parser tests**

Cover:

- extracts the last fenced `json` block containing `summary`
- accepts generated tasks with trimmed titles, optional descriptions, and valid Kanban task statuses
- rejects generated tasks with empty titles or unknown statuses
- accepts only existing task IDs
- accepts only Kanban task statuses
- rejects unknown task IDs, malformed JSON, non-object values, and missing summary

- [ ] **Step 3: Run tests and confirm failure**

Run: `bun run --cwd apps/server test src/kanban/workerPrompt.test.ts src/kanban/workerSummary.test.ts`

Expected: fail because files do not exist.

- [ ] **Step 4: Implement prompt builder**

Expose:

```ts
export interface BuildKanbanWorkerPromptInput {
  readonly card: KanbanCard;
  readonly tasks: readonly KanbanTask[];
  readonly worktreePath: string;
  readonly branch: string | null;
}

export function buildKanbanWorkerPrompt(input: BuildKanbanWorkerPromptInput): string;
```

Keep this pure and provider-agnostic.

- [ ] **Step 5: Implement summary parser**

Expose:

```ts
export type ParsedKanbanWorkerSummary = {
  readonly summary: string;
  readonly generatedTasks: ReadonlyArray<{
    readonly title: string;
    readonly description?: string;
    readonly status: KanbanTaskStatus;
  }>;
  readonly taskUpdates: ReadonlyArray<{
    readonly taskId: KanbanTaskId;
    readonly status: KanbanTaskStatus;
  }>;
};

export function parseKanbanWorkerSummary(
  text: string,
  tasks: readonly KanbanTask[],
): ParsedKanbanWorkerSummary;
```

Parser should throw a local typed error or plain `Error` with a useful message. Do not infer completion from prose.

- [ ] **Step 6: Run focused tests**

Run: `bun run --cwd apps/server test src/kanban/workerPrompt.test.ts src/kanban/workerSummary.test.ts`

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/kanban/workerPrompt.ts apps/server/src/kanban/workerPrompt.test.ts apps/server/src/kanban/workerSummary.ts apps/server/src/kanban/workerSummary.test.ts
git commit -m "feat: add kanban worker prompt parser"
```

## Task 3: Decider Status Semantics and Worktree Metadata

**Files:**
- Modify: `apps/server/src/kanban/decider.ts`
- Modify: `apps/server/src/kanban/decider.test.ts`
- Modify: `apps/server/src/kanban/projector.test.ts`

- [ ] **Step 1: Write failing decider tests**

Add tests for:

- worker `kanban.run.complete` with `status: "completed"` from `implementing` emits `kanban.card.status-changed` to `reviewing` before `kanban.run.completed`
- worker `status: "failed"` emits status change to `agent_error` with the run error message
- worker `status: "interrupted"` emits status change to `agent_error` with an interruption reason
- reviewer run completion behavior remains unchanged for Phase 4
- internal `kanban.card.worktree.set` updates branch/worktree metadata by emitting `kanban.card.updated`
- projection preserves worktree metadata from the emitted `kanban.card.updated` event
- public `kanban.card.update` still cannot mutate worktree metadata

- [ ] **Step 2: Run test and confirm failure**

Run: `bun run --cwd apps/server test src/kanban/decider.test.ts`

Expected: fail because run completion currently only records `kanban.run.completed`.

- [ ] **Step 3: Implement worktree metadata command**

Handle `kanban.card.worktree.set` by requiring the card, then emitting `kanban.card.updated` with the existing card plus:

```ts
branch,
worktreePath,
associatedWorktreePath,
associatedWorktreeBranch,
associatedWorktreeRef,
updatedAt
```

Do not widen `kanban.card.update` for this; the UI must not be able to claim arbitrary worktree ownership.

- [ ] **Step 4: Implement status-changing run completion**

For worker runs only:

- `completed` -> card status `reviewing`
- `failed` or `interrupted` -> card status `agent_error`

Use existing `statusChangedEvent` and `requireStatusTransition`. Preserve the current `kanban.run.completed` payload.

- [ ] **Step 5: Run focused decider test**

Run: `bun run --cwd apps/server test src/kanban/decider.test.ts`

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/kanban/decider.ts apps/server/src/kanban/decider.test.ts apps/server/src/kanban/projector.test.ts
git commit -m "feat: add kanban worker status transitions"
```

## Task 4: Worker Coordinator Core

**Files:**
- Create: `apps/server/src/kanban/Services/KanbanWorkerCoordinator.ts`
- Create: `apps/server/src/kanban/Layers/KanbanWorkerCoordinator.ts`
- Create: `apps/server/src/kanban/Layers/KanbanWorkerCoordinator.test.ts`
- Modify: `apps/server/src/kanban/runtimeLayer.ts`

- [ ] **Step 1: Write failing coordinator tests**

Use fake services for `KanbanEngineService`, `OrchestrationEngineService`, `GitCore`, and `ProviderService.streamEvents`.

Cover:

- rejects non-ready cards
- rejects missing project/workspace root
- creates or reuses a card worktree and dispatches internal `kanban.card.worktree.set`
- dispatches `thread.create` with `subagentRole: "kanban-worker"`, card model/runtime, and worktree metadata
- dispatches `kanban.run.start` before the worker turn
- dispatches `thread.turn.start` with the worker prompt and `ProviderStartOptions` from `ServerSettingsService`
- observes delayed provider ingestion by waiting for terminal assistant output in the orchestration read model before parsing
- handles `provider.turn.start.failed` / errored thread session without requiring a provider runtime event
- reads assistant output from orchestration read model, parses summary, creates generated tasks when present through internal task upserts, dispatches task updates preserving task title/description/order, and completes the run
- when a card has no tasks, accepts validated `generatedTasks` from the summary and persists them in stable order before applying status updates
- on malformed summary, completes the run as failed, moves the card to `agent_error`, records visible error text, and applies no generated tasks or partial task updates
- on provider `turn.aborted` or `runtime.error`, dispatches failed/interrupted run completion with visible error text

- [ ] **Step 2: Run test and confirm failure**

Run: `bun run --cwd apps/server test src/kanban/Layers/KanbanWorkerCoordinator.test.ts`

Expected: fail because service does not exist.

- [ ] **Step 3: Add service interface**

Expose:

```ts
export interface KanbanWorkerCoordinatorShape {
  readonly startWorkerRun: (
    input: KanbanStartWorkerRunInput,
  ) => Effect.Effect<KanbanStartWorkerRunResult, KanbanWorkerCoordinatorError>;
}
```

Use tagged errors for not-found, invalid-state, worktree failure, provider failure, and summary-parse failure.

- [ ] **Step 4: Implement worktree preparation**

Algorithm:

1. Read Kanban read model and orchestration read model.
2. Find card, card tasks, board, and project.
3. Resolve `baseBranch` as `card.branch` when present, otherwise `GitCore.statusDetails(project.workspaceRoot).branch`.
4. If `baseBranch` is null or detached, fail clearly before creating anything.
5. If card has `worktreePath`, call `GitCore.statusDetails(card.worktreePath)` and fail if dirty.
6. If no card worktree, create one with `GitCore.createWorktree({ cwd: project.workspaceRoot, branch: baseBranch, newBranch, path: null })`.
7. Dispatch internal `kanban.card.worktree.set` with `worktreePath`, `branch`, `associatedWorktreePath`, `associatedWorktreeBranch`, and `associatedWorktreeRef`.

Branch naming should be deterministic enough for retry safety, for example `kanban/${card.id}` sanitized through a helper.

- [ ] **Step 5: Implement thread and run start**

Dispatch `thread.create` through `OrchestrationEngineService`:

```ts
{
  type: "thread.create",
  threadId,
  projectId: card.projectId,
  title: `Worker: ${card.title}`,
  modelSelection: card.modelSelection,
  runtimeMode: card.runtimeMode,
  interactionMode: "default",
  envMode: "worktree",
  branch,
  worktreePath,
  associatedWorktreePath: worktreePath,
  associatedWorktreeBranch: branch,
  associatedWorktreeRef,
  parentThreadId: card.sourceThreadId ?? null,
  subagentRole: "kanban-worker",
  createBranchFlowCompleted: true
}
```

Then dispatch `kanban.run.start` with role `worker` and the worker thread ID.

Then dispatch `thread.turn.start` with the prompt from `buildKanbanWorkerPrompt` and provider settings:

1. Inject `ServerSettingsService`.
2. Read `settings.providers`.
3. Build `ProviderStartOptions` from settings: codex binary/home/browser-tool, Claude binary plus existing derived launch settings if already available, Cursor binary/API endpoint, Gemini binary, and OpenCode binary/server credentials.
4. Include `providerOptions` on `thread.turn.start`.

Do not bypass `ProviderCommandReactor`; this command is still the only way the provider turn starts.

- [ ] **Step 6: Implement completion observation**

The coordinator may subscribe to `ProviderService.streamEvents` for the worker thread before it dispatches the turn, but runtime events are only wake-up hints. Completion decisions must be based on orchestration state so the coordinator does not race `ProviderRuntimeIngestion`.

It should handle:

- terminal assistant output projected into the worker thread -> parse summary, persist validated generated tasks through internal task upserts, preserve existing task metadata while applying valid status updates, complete run as `completed`
- projected `provider.turn.start.failed` activity or errored session before a provider turn starts -> complete run as `failed`
- provider `turn.completed` with error state or `errorMessage` after projection settles -> complete as `failed`
- provider `turn.aborted` -> complete as `interrupted`
- provider `runtime.error` for the worker thread while the run is active -> complete as `failed`
- malformed or missing structured summary -> complete as `failed`, do not apply generated tasks or task updates

Use bounded waiting in tests. Production should fork the observation fiber in the layer scope so the RPC can return after the run is started.

- [ ] **Step 7: Wire layer**

Add `KanbanWorkerCoordinatorLive` to `apps/server/src/kanban/runtimeLayer.ts` using existing app-server layer composition.

- [ ] **Step 8: Run focused coordinator tests**

Run: `bun run --cwd apps/server test src/kanban/Layers/KanbanWorkerCoordinator.test.ts`

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/kanban/Services/KanbanWorkerCoordinator.ts apps/server/src/kanban/Layers/KanbanWorkerCoordinator.ts apps/server/src/kanban/Layers/KanbanWorkerCoordinator.test.ts apps/server/src/kanban/runtimeLayer.ts
git commit -m "feat: add kanban worker coordinator"
```

## Task 5: Server RPC Wiring

**Files:**
- Modify: `apps/server/src/wsRpc.ts`
- Modify: `apps/server/src/wsRpc.test.ts`

- [ ] **Step 1: Write failing RPC test**

Add a WebSocket/RPC test that calls `kanban.startWorkerRun` and verifies the coordinator fake receives `{ cardId }` and returns `{ runId, threadId }`.

- [ ] **Step 2: Run test and confirm failure**

Run: `bun run --cwd apps/server test src/wsRpc.test.ts`

Expected: fail because handler is not registered.

- [ ] **Step 3: Register handler**

Inject `KanbanWorkerCoordinator` next to `KanbanEngineService` and `KanbanSnapshotQuery`, then add:

```ts
[KANBAN_WS_METHODS.startWorkerRun]: (input) =>
  rpcEffect(workerCoordinator.startWorkerRun(input), "Failed to start Kanban worker run")
```

- [ ] **Step 4: Run focused RPC test**

Run: `bun run --cwd apps/server test src/wsRpc.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/wsRpc.ts apps/server/src/wsRpc.test.ts
git commit -m "feat: expose kanban worker start rpc"
```

## Task 6: Web Start-Run Wiring

**Files:**
- Modify: `apps/web/src/wsNativeApi.ts`
- Modify: `apps/web/src/wsNativeApi.test.ts`
- Modify: `apps/web/src/kanbanStore.ts`
- Modify: `apps/web/src/kanbanStore.test.ts`
- Modify: `apps/web/src/components/kanban/KanbanBoard.tsx`
- Modify: `apps/web/src/components/kanban/KanbanCardDetailPanel.tsx`
- Modify: `apps/web/src/routes/_chat.kanban.$projectId.tsx`

- [ ] **Step 1: Write failing web transport/store tests**

Tests:

- `wsNativeApi` sends `KANBAN_WS_METHODS.startWorkerRun`
- `kanbanStore.startKanbanWorkerRun(cardId)` delegates to native API
- start button is disabled unless selected card status is `ready`

- [ ] **Step 2: Run tests and confirm failure**

Run: `bun run --cwd apps/web test src/wsNativeApi.test.ts src/kanbanStore.test.ts src/components/kanban/kanbanBoard.logic.test.ts`

Expected: fail because API/store action does not exist.

- [ ] **Step 3: Implement API and store action**

Add `api.kanban.startWorkerRun(input)` and store action:

```ts
startKanbanWorkerRun: (cardId) =>
  ensureNativeApi().kanban.startWorkerRun({ cardId })
```

- [ ] **Step 4: Wire UI**

Pass `startKanbanWorkerRun` from route to `KanbanBoard.onStartRun`. In `KanbanCardDetailPanel`, keep the button visible but disabled with current status unless the card can start a worker run.

For Phase 3, only `ready` can start a worker run. Do not enable `needs_work`; retry loop policy belongs to Phase 4.

Do not reintroduce task mutation callbacks while wiring start-run. The detail panel may display generated tasks, but manual add/edit/delete remains removed.

- [ ] **Step 5: Run focused web tests**

Run: `bun run --cwd apps/web test src/wsNativeApi.test.ts src/kanbanStore.test.ts src/components/kanban/kanbanBoard.logic.test.ts`

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/wsNativeApi.ts apps/web/src/wsNativeApi.test.ts apps/web/src/kanbanStore.ts apps/web/src/kanbanStore.test.ts apps/web/src/components/kanban/KanbanBoard.tsx apps/web/src/components/kanban/KanbanCardDetailPanel.tsx apps/web/src/routes/_chat.kanban.$projectId.tsx
git commit -m "feat: wire kanban worker run start"
```

## Task 7: Integration Verification

**Files:**
- Modify or create: `apps/server/src/kanban/Layers/KanbanWorkerCoordinator.test.ts`
- Modify: `apps/web/src/components/kanban/KanbanBoard.browser.tsx` if the button state needs browser coverage.

- [ ] **Step 1: Add integration-style server test**

Use the live Kanban decider/engine pieces where practical and fakes for provider/git. Cover card `ready` -> `implementing` -> provider completion -> run `completed` -> card `reviewing`.

- [ ] **Step 2: Run server Kanban suite**

Run: `bun run --cwd apps/server test src/kanban`

Expected: pass.

- [ ] **Step 3: Run web Kanban suite**

Run: `bun run --cwd apps/web test src/kanbanStore.test.ts src/components/kanban`

Expected: pass.

- [ ] **Step 4: Run browser component test**

Run: `bun run --cwd apps/web test:browser src/components/kanban/KanbanBoard.browser.tsx`

Expected: pass.

- [ ] **Step 5: Run build checks scoped to touched apps**

Run:

```bash
bun run --cwd apps/server test src/kanban src/wsRpc.test.ts
bun run --cwd apps/web build
```

Expected: both pass. The web build may continue to print the existing Vite large-chunk warning.

- [ ] **Step 6: Commit any final fixes**

```bash
git status --short
git add <only Phase 3 files>
git commit -m "test: verify kanban worker run flow"
```

## Final Verification

- [ ] Run targeted contract/server/web tests:

```bash
bun run --cwd packages/contracts test src/kanban.test.ts src/ws.test.ts
bun run --cwd apps/server test src/kanban src/wsRpc.test.ts
bun run --cwd apps/web test src/wsNativeApi.test.ts src/kanbanStore.test.ts src/components/kanban
bun run --cwd apps/web test:browser src/components/kanban/KanbanBoard.browser.tsx
bun run --cwd apps/web build
```

- [ ] Do not run `bun fmt`, `bun lint`, or `bun typecheck` unless explicitly requested in the current conversation.
- [ ] Because repo policy also requires `bun fmt`, `bun lint`, and `bun typecheck` before considering implementation fully complete, report the task as not fully workspace-verified unless the user explicitly asks to run those heavyweight checks.
- [ ] Do not run `bun test`; use `bun run test` commands only.
- [ ] Request final phase review before moving to Phase 4.
