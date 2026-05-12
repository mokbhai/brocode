# Kanban Agent Orchestration Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a ready Kanban card start one worker run through BroCode's existing provider/thread architecture and record the result.

**Complete Target:** Native BroCode Kanban cards execute bounded worker/reviewer loops through existing provider architecture, with one shared card worktree and human-gated submission.

**Architecture:** Add a server-side Kanban worker coordinator that owns worktree preparation, worker-thread creation, prompt construction, run command dispatch, provider completion observation, and conservative task-status updates. It must not call model SDKs or provider adapters directly; it dispatches existing orchestration commands so `ProviderCommandReactor` and `ProviderService` remain the only provider execution path.

**Tech Stack:** Effect services/layers, existing Kanban event engine, existing orchestration engine, existing provider runtime event stream, GitCore worktree helpers, React/Zustand Kanban UI, Vitest.

**Spec Source:** `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/00-overview.md` + `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/03-single-worker-run.md`

**Phase:** Phase 3: Single Worker Run

**Next Required Phase:** Phase 4: Reviewer Run and Loop Policy, `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/04-reviewer-run-and-loop-policy.md`

---

## File Structure

- Create `apps/server/src/kanban/workerPrompt.ts`: pure worker prompt builder.
- Test `apps/server/src/kanban/workerPrompt.test.ts`: required context, guardrails, task list, structured summary instructions.
- Create `apps/server/src/kanban/workerSummary.ts`: pure parser/validator for structured worker summaries extracted from assistant text.
- Test `apps/server/src/kanban/workerSummary.test.ts`: strict JSON extraction, task status validation, malformed output handling.
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

- The coordinator starts provider work by dispatching `thread.create` and `thread.turn.start` through `OrchestrationEngineService`. It must not call `ProviderService.startSession`, `ProviderService.sendTurn`, provider adapters, Codex app-server, Claude SDKs, or any vendor SDK directly.
- The worker thread is a normal BroCode thread with `subagentRole: "kanban-worker"`, `modelSelection` from the card, and `runtimeMode` from the card. This keeps logs visible in existing thread UI.
- The card worktree is prepared once per card and persisted back with the server-only `kanban.card.worktree.set` command. If the card already has `worktreePath` and associated worktree metadata, reuse it after checking it is a Git repo and not dirty.
- Worktree metadata is server-owned. It must be persisted through an internal `kanban.card.worktree.set` command, not through the public `ClientKanbanCommand` update path.
- The first version parses a structured worker summary from assistant messages after completion. The worker cannot directly mutate card state. The server validates task IDs/statuses before dispatching `kanban.task.upsert`.
- Provider completion is observed through orchestration state as the source of truth, with provider runtime events used only as wake-up signals. The coordinator must wait until provider ingestion has projected terminal assistant output or a startup failure before parsing results. On success, record `kanban.run.complete` with `status: "completed"`. On provider error/abort/timeout, record `status: "failed"` or `status: "interrupted"` and move the card to `agent_error` with a visible reason.

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
- decoding `kanban.card.update` as `ClientKanbanCommand` does not expose `worktreePath`, `branch`, or associated worktree fields on the parsed command
- `KanbanCommand` accepts `kanban.card.worktree.set`

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

- title, description, optional spec path, task list, worktree path, branch, runtime policy all appear in the prompt
- prompt says provider execution is through BroCode and must not request external model credentials
- prompt requires a final fenced JSON summary

Expected summary shape:

```json
{
  "summary": "short human-readable result",
  "taskUpdates": [
    { "taskId": "task-1", "status": "done" }
  ]
}
```

- [ ] **Step 2: Write failing parser tests**

Cover:

- extracts the last fenced `json` block containing `summary`
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
- reads assistant output from orchestration read model, parses summary, dispatches task updates preserving task title/description/order, and completes the run
- on malformed summary, completes the run as failed, moves the card to `agent_error`, records visible error text, and applies no partial task updates
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

- terminal assistant output projected into the worker thread -> parse summary, preserve task metadata while applying valid status updates, complete run as `completed`
- projected `provider.turn.start.failed` activity or errored session before a provider turn starts -> complete run as `failed`
- provider `turn.completed` with error state or `errorMessage` after projection settles -> complete as `failed`
- provider `turn.aborted` -> complete as `interrupted`
- provider `runtime.error` for the worker thread while the run is active -> complete as `failed`
- malformed or missing structured summary -> complete as `failed`, do not apply task updates

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
- [ ] Do not run `bun test`; use `bun run test` commands only.
- [ ] Request final phase review before moving to Phase 4.
