# Kanban Agent Orchestration Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start one worker run from a Kanban card through existing provider orchestration and record its result.

**Complete Target:** Native BroCode Kanban cards execute bounded worker/reviewer loops through existing provider architecture, with one shared card worktree and human-gated submission.

**Architecture:** Add a Kanban agent reactor that calls existing `ProviderService` and dispatches Kanban events. Do not add direct model SDK calls or a new LLM abstraction.

**Tech Stack:** TypeScript, Effect services/streams, existing ProviderService, existing Git services, SQLite projections, Vitest.

**Spec Source:** `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/00-overview.md` + `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/03-single-worker-run.md`

**Phase:** Phase 3: Single Worker Run

**Next Required Phase:** Phase 4: Reviewer Run and Loop Policy, `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/04-reviewer-run-and-loop-policy.md`

---

## File Structure

- Create `apps/server/src/kanban/workerPrompt.ts`: pure worker prompt builder.
- Test `apps/server/src/kanban/workerPrompt.test.ts`.
- Create `apps/server/src/kanban/runSummary.ts`: conservative structured summary parser.
- Test `apps/server/src/kanban/runSummary.test.ts`.
- Create `apps/server/src/kanban/Services/KanbanAgentReactor.ts`.
- Create `apps/server/src/kanban/Layers/KanbanAgentReactor.ts`.
- Test `apps/server/src/kanban/Layers/KanbanAgentReactor.test.ts`.
- Modify `apps/server/src/effectServer.ts`: start Kanban reactor with other reactors.
- Modify `packages/contracts/src/kanban.ts`: add start worker/run commands and run-result payloads if not already present.
- Modify `apps/web/src/components/kanban/KanbanCardDetailPanel.tsx`: enable start worker action.
- Test `apps/web/src/components/kanban/kanbanBoard.logic.test.ts`.

## Task 1: Worker Prompt Builder

**Files:**
- Create: `apps/server/src/kanban/workerPrompt.ts`
- Test: `apps/server/src/kanban/workerPrompt.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Assert the prompt includes spec reference/content, tasks, worktree path, role instructions, output format, and guardrails saying task mutations must be reported in the structured summary.

- [ ] **Step 2: Run test and confirm failure**

Run: `bun run --cwd apps/server test src/kanban/workerPrompt.test.ts`

Expected: fail because module does not exist.

- [ ] **Step 3: Implement prompt builder**

Export:

```ts
export function buildKanbanWorkerPrompt(input: KanbanWorkerPromptInput): string
```

Use XML-ish sections for predictable parsing:

```text
<kanban_card>...</kanban_card>
<spec>...</spec>
<tasks>...</tasks>
<required_output>...</required_output>
```

- [ ] **Step 4: Run focused test**

Run: `bun run --cwd apps/server test src/kanban/workerPrompt.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/kanban/workerPrompt.ts apps/server/src/kanban/workerPrompt.test.ts
git commit -m "feat: add kanban worker prompt builder"
```

## Task 2: Worker Summary Parser

**Files:**
- Create: `apps/server/src/kanban/runSummary.ts`
- Test: `apps/server/src/kanban/runSummary.test.ts`

- [ ] **Step 1: Write parser tests**

Test valid JSON fenced block, missing block, invalid status, unknown task id, and ambiguous completion text.

- [ ] **Step 2: Run test and confirm failure**

Run: `bun run --cwd apps/server test src/kanban/runSummary.test.ts`

Expected: fail.

- [ ] **Step 3: Implement conservative parser**

Return a discriminated result:

```ts
type ParsedWorkerSummary =
  | { type: "parsed"; completedTaskIds: string[]; blockedTaskIds: string[]; notes: string }
  | { type: "unparseable"; reason: string };
```

Do not infer task completion from prose in Phase 3.

- [ ] **Step 4: Run focused test**

Run: `bun run --cwd apps/server test src/kanban/runSummary.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/kanban/runSummary.ts apps/server/src/kanban/runSummary.test.ts
git commit -m "feat: parse kanban worker summaries"
```

## Task 3: Start Worker Command and Events

**Files:**
- Modify: `packages/contracts/src/kanban.ts`
- Modify: `apps/server/src/kanban/decider.ts`
- Modify: `apps/server/src/kanban/projector.ts`
- Test: `packages/contracts/src/kanban.test.ts`
- Test: `apps/server/src/kanban/decider.test.ts`
- Test: `apps/server/src/kanban/projector.test.ts`

- [ ] **Step 1: Add failing command/event tests**

Cover:

- `kanban.card.worker.start`
- `kanban.run.started`
- `kanban.run.completed`
- card status `implementing`
- provider thread id stored on the run

- [ ] **Step 2: Run focused tests**

Run: `bun run --cwd packages/contracts test src/kanban.test.ts && bun run --cwd apps/server test src/kanban/decider.test.ts src/kanban/projector.test.ts`

Expected: fail.

- [ ] **Step 3: Implement contracts and projection**

Add commands/events without starting providers yet.

- [ ] **Step 4: Run focused tests**

Run the same command.

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/kanban.ts packages/contracts/src/kanban.test.ts apps/server/src/kanban/decider.ts apps/server/src/kanban/projector.ts apps/server/src/kanban/*.test.ts
git commit -m "feat: add kanban worker run events"
```

## Task 4: Kanban Agent Reactor

**Files:**
- Create: `apps/server/src/kanban/Services/KanbanAgentReactor.ts`
- Create: `apps/server/src/kanban/Layers/KanbanAgentReactor.ts`
- Modify: `apps/server/src/effectServer.ts`
- Test: `apps/server/src/kanban/Layers/KanbanAgentReactor.test.ts`

- [ ] **Step 1: Write fake-provider reactor tests**

Use a fake `ProviderService` that records `startSession` and `sendTurn` inputs. Assert model selection, runtime mode, cwd/worktree path, and thread id are routed through existing provider contracts.

- [ ] **Step 2: Run test and confirm failure**

Run: `bun run --cwd apps/server test src/kanban/Layers/KanbanAgentReactor.test.ts`

Expected: fail.

- [ ] **Step 3: Implement reactor**

The reactor should:

- observe Kanban run-start requests
- resolve card and task context
- ensure card worktree metadata is present, or block with a clear reason
- call `ProviderService.startSession`
- call `ProviderService.sendTurn`
- dispatch `kanban.run.started`

- [ ] **Step 4: Handle provider errors**

Provider errors dispatch `kanban.card.blocked` or `kanban.run.completed` with error result. Do not throw unhandled stream errors.

- [ ] **Step 5: Start reactor**

Wire into `apps/server/src/effectServer.ts` next to existing orchestration reactors.

- [ ] **Step 6: Run focused test**

Run: `bun run --cwd apps/server test src/kanban/Layers/KanbanAgentReactor.test.ts`

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/kanban/Services/KanbanAgentReactor.ts apps/server/src/kanban/Layers/KanbanAgentReactor.ts apps/server/src/effectServer.ts apps/server/src/kanban/Layers/KanbanAgentReactor.test.ts
git commit -m "feat: start kanban worker runs through provider service"
```

## Task 5: UI Start Worker Action

**Files:**
- Modify: `apps/web/src/components/kanban/KanbanCardDetailPanel.tsx`
- Modify: `apps/web/src/kanbanStore.ts`
- Test: `apps/web/src/kanbanStore.test.ts`

- [ ] **Step 1: Write failing action test**

Assert `startWorkerRun(cardId)` dispatches the Kanban start command and disables when status is not `ready`.

- [ ] **Step 2: Implement UI action**

Enable start button only for cards with ready status and at least one task.

- [ ] **Step 3: Run focused tests**

Run: `bun run --cwd apps/web test src/kanbanStore.test.ts src/components/kanban/kanbanBoard.logic.test.ts`

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/kanbanStore.ts apps/web/src/components/kanban/KanbanCardDetailPanel.tsx apps/web/src/kanbanStore.test.ts
git commit -m "feat: add kanban worker start action"
```

## Final Verification

- [ ] Run targeted tests:

```bash
bun run --cwd apps/server test src/kanban
bun run --cwd apps/web test src/kanbanStore.test.ts src/components/kanban
```

- [ ] Only if explicitly requested for this phase, run workspace checks:

```bash
bun fmt
bun lint
bun typecheck
```

