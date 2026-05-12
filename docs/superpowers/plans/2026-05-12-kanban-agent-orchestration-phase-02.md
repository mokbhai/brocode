# Kanban Agent Orchestration Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Kanban workspace section, board UI, card detail panel, and card creation/editing flows.

**Complete Target:** Native BroCode Kanban cards execute bounded worker/reviewer loops through existing provider architecture, with one shared card worktree and human-gated submission.

**Architecture:** Use the Phase 1 Kanban snapshot/subscription API. Keep Kanban UI state light and derived, mirroring existing store patterns for orchestration shell/detail state.

**Tech Stack:** React 19, TanStack Router, Zustand-style app store, existing BroCode UI components, Vitest.

**Spec Source:** `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/00-overview.md` + `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/02-kanban-ui-and-card-creation.md`

**Phase:** Phase 2: Kanban UI and Card Creation

**Next Required Phase:** Phase 3: Single Worker Run, `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/03-single-worker-run.md`

---

## File Structure

- Create `apps/web/src/kanbanStore.ts`: Kanban snapshot, subscriptions, actions, derived selectors.
- Create `apps/web/src/kanbanStore.test.ts`: store and selector tests.
- Create `apps/web/src/components/kanban/KanbanBoard.tsx`: board columns and cards.
- Create `apps/web/src/components/kanban/KanbanCard.tsx`: card summary.
- Create `apps/web/src/components/kanban/KanbanCardDetailPanel.tsx`: side panel.
- Create `apps/web/src/components/kanban/KanbanCreateCardDialog.tsx`: create from thread/spec/manual.
- Create `apps/web/src/components/kanban/kanbanBoard.logic.ts`: grouping and presentation helpers.
- Test `apps/web/src/components/kanban/kanbanBoard.logic.test.ts`.
- Create `apps/web/src/routes/_chat.workspace.$workspaceId.kanban.tsx` or the route pattern matching the current workspace route tree.
- Modify `apps/web/src/components/WorkspaceView.tsx`: add Kanban navigation/section entry.
- Modify `apps/web/src/components/ChatView.tsx` or `apps/web/src/components/chat/ChatHeader.tsx`: add "Create Kanban Card" action for a planning thread.
- Modify `apps/web/src/wsNativeApi.ts`: use Phase 1 `api.kanban`.

## Task 1: Store and Selectors

**Files:**
- Create: `apps/web/src/kanbanStore.ts`
- Test: `apps/web/src/kanbanStore.test.ts`

- [ ] **Step 1: Write failing store tests**

Test that a Kanban snapshot loads boards/cards/tasks and that `selectCardsByStatus` groups cards into expected columns.

- [ ] **Step 2: Run test and confirm failure**

Run: `bun run --cwd apps/web test src/kanbanStore.test.ts`

Expected: fail because `kanbanStore` does not exist.

- [ ] **Step 3: Implement store**

Expose:

```ts
loadKanbanSnapshot(): Promise<void>
subscribeKanbanBoard(projectId: ProjectId): Promise<() => Promise<void>>
createKanbanCard(input: CreateCardInput): Promise<void>
upsertKanbanTask(input: UpsertTaskInput): Promise<void>
```

Keep derived selectors in pure functions so UI tests do not need transport mocks.

- [ ] **Step 4: Run focused test**

Run: `bun run --cwd apps/web test src/kanbanStore.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/kanbanStore.ts apps/web/src/kanbanStore.test.ts
git commit -m "feat: add kanban web store"
```

## Task 2: Board Presentation Logic

**Files:**
- Create: `apps/web/src/components/kanban/kanbanBoard.logic.ts`
- Test: `apps/web/src/components/kanban/kanbanBoard.logic.test.ts`

- [ ] **Step 1: Write failing logic tests**

Cover grouping statuses into columns, progress text, retry text, and blocked/error badges.

- [ ] **Step 2: Run test and confirm failure**

Run: `bun run --cwd apps/web test src/components/kanban/kanbanBoard.logic.test.ts`

Expected: fail.

- [ ] **Step 3: Implement logic helpers**

Keep helpers pure:

```ts
export function groupKanbanCardsByColumn(cards: KanbanCard[]): KanbanColumnViewModel[]
export function formatKanbanCardProgress(card: KanbanCard, tasks: KanbanTask[]): string
```

- [ ] **Step 4: Run focused test**

Run: `bun run --cwd apps/web test src/components/kanban/kanbanBoard.logic.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/kanban/kanbanBoard.logic.ts apps/web/src/components/kanban/kanbanBoard.logic.test.ts
git commit -m "feat: add kanban board presentation logic"
```

## Task 3: Board and Card Components

**Files:**
- Create: `apps/web/src/components/kanban/KanbanBoard.tsx`
- Create: `apps/web/src/components/kanban/KanbanCard.tsx`
- Create: `apps/web/src/components/kanban/KanbanCardDetailPanel.tsx`

- [ ] **Step 1: Add minimal component tests if existing test setup supports rendering**

Prefer testing visible column labels and card actions. If rendering tests are brittle, keep behavior in `kanbanBoard.logic.test.ts`.

- [ ] **Step 2: Implement board UI**

Use existing `Button`, `Badge`, `Sheet`, `ScrollArea`, and related UI components. Avoid embedded transcript rendering; link to existing thread route for logs.

- [ ] **Step 3: Verify visual constraints manually**

Check that cards have stable dimensions, no nested card-in-card layouts, and status text does not overflow.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/kanban/KanbanBoard.tsx apps/web/src/components/kanban/KanbanCard.tsx apps/web/src/components/kanban/KanbanCardDetailPanel.tsx
git commit -m "feat: add kanban board components"
```

## Task 4: Card Creation and Task Editing

**Files:**
- Create: `apps/web/src/components/kanban/KanbanCreateCardDialog.tsx`
- Modify: `apps/web/src/components/kanban/KanbanCardDetailPanel.tsx`
- Test: `apps/web/src/components/kanban/kanbanCreateCard.logic.test.ts`

- [ ] **Step 1: Write failing payload tests**

Test create-from-thread, create-from-spec-path, and manual create payloads. Assert model selection and runtime mode pass through existing contract shapes.

- [ ] **Step 2: Implement dialog**

Fields:

- title
- spec path or inline spec
- source thread
- model selection
- runtime mode
- initial tasks

- [ ] **Step 3: Implement task editing in detail panel**

Allow add/edit/delete/reorder if simple. If reorder is non-trivial, defer reorder and keep add/edit/delete.

- [ ] **Step 4: Run focused tests**

Run: `bun run --cwd apps/web test src/components/kanban/kanbanCreateCard.logic.test.ts src/kanbanStore.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/kanban/KanbanCreateCardDialog.tsx apps/web/src/components/kanban/KanbanCardDetailPanel.tsx apps/web/src/components/kanban/kanbanCreateCard.logic.test.ts
git commit -m "feat: add kanban card creation and task editing"
```

## Task 5: Route and Navigation

**Files:**
- Create: `apps/web/src/routes/_chat.workspace.$workspaceId.kanban.tsx`
- Modify: `apps/web/src/components/WorkspaceView.tsx`
- Modify: `apps/web/src/components/ChatView.tsx`
- Modify: `apps/web/src/components/chat/ChatHeader.tsx`

- [ ] **Step 1: Inspect current route conventions**

Read `apps/web/src/routes/_chat.workspace.$workspaceId.tsx`, `apps/web/src/routes/_chat.$threadId.tsx`, and `apps/web/src/components/WorkspaceView.tsx` before editing.

- [ ] **Step 2: Add Kanban route**

Route should load the Kanban store snapshot and render `KanbanBoard`.

- [ ] **Step 3: Add navigation affordance**

Expose Kanban beside Threads and Workspace. Keep labels consistent with existing navigation.

- [ ] **Step 4: Add create-card action from thread**

In thread context, action opens `KanbanCreateCardDialog` with `sourceThreadId` and project inferred from the active thread.

- [ ] **Step 5: Run focused tests**

Run: `bun run --cwd apps/web test src/kanbanStore.test.ts src/components/kanban/kanbanBoard.logic.test.ts`

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes apps/web/src/components/WorkspaceView.tsx apps/web/src/components/ChatView.tsx apps/web/src/components/chat/ChatHeader.tsx
git commit -m "feat: add kanban workspace route"
```

## Final Verification

- [ ] Run targeted tests:

```bash
bun run --cwd apps/web test src/kanbanStore.test.ts src/components/kanban
```

- [ ] If a dev-server visual check is requested, follow AGENTS.md isolated-port guidance before starting any BroCode instance.

- [ ] Only if explicitly requested for this phase, run workspace checks:

```bash
bun fmt
bun lint
bun typecheck
```

