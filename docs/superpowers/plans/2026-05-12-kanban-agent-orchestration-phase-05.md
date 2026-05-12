# Kanban Agent Orchestration Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add human-gated submission from approved Kanban cards.

**Complete Target:** Native BroCode Kanban cards execute bounded worker/reviewer loops through existing provider architecture, with one shared card worktree and human-gated submission.

**Architecture:** Keep submission as an explicit user action. Reuse existing git and GitHub services; do not let the agent loop create PRs automatically.

**Tech Stack:** TypeScript, existing GitCore/GitManager/GitHub services, Kanban events/projections, React UI, Vitest.

**Spec Source:** `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/00-overview.md` + `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/05-submission-gate.md`

**Phase:** Phase 5: Submission Gate

**Next Required Phase:** none

---

## File Structure

- Create `apps/server/src/kanban/submissionSummary.ts`: pure summary builder for approved cards.
- Test `apps/server/src/kanban/submissionSummary.test.ts`.
- Modify `packages/contracts/src/kanban.ts`: submission commands/events.
- Modify `apps/server/src/kanban/decider.ts` and `apps/server/src/kanban/projector.ts`: ready-to-submit/submitted/failure states.
- Create `apps/server/src/kanban/Services/KanbanSubmissionService.ts` and `apps/server/src/kanban/Layers/KanbanSubmissionService.ts`: explicit submission action.
- Test `apps/server/src/kanban/Layers/KanbanSubmissionService.test.ts`.
- Modify `apps/web/src/components/kanban/KanbanCardDetailPanel.tsx`: submission gate UI.
- Modify `apps/web/src/components/kanban/kanbanBoard.logic.ts`: ready-to-submit/submitted presentation.

## Task 1: Submission Summary

**Files:**
- Create: `apps/server/src/kanban/submissionSummary.ts`
- Test: `apps/server/src/kanban/submissionSummary.test.ts`

- [ ] **Step 1: Write failing summary tests**

Assert summary includes spec reference, checklist completion, worker/reviewer runs, reviewer approval, branch/worktree, diff/checkpoint references, and linked provider threads.

- [ ] **Step 2: Run test and confirm failure**

Run: `bun run --cwd apps/server test src/kanban/submissionSummary.test.ts`

Expected: fail.

- [ ] **Step 3: Implement summary builder**

Export:

```ts
export function buildKanbanSubmissionSummary(input: KanbanSubmissionSummaryInput): string
```

Keep it deterministic for tests.

- [ ] **Step 4: Run focused test**

Run: same command.

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/kanban/submissionSummary.ts apps/server/src/kanban/submissionSummary.test.ts
git commit -m "feat: add kanban submission summary"
```

## Task 2: Submission Contracts and Projection

**Files:**
- Modify: `packages/contracts/src/kanban.ts`
- Modify: `apps/server/src/kanban/decider.ts`
- Modify: `apps/server/src/kanban/projector.ts`
- Test: `packages/contracts/src/kanban.test.ts`
- Test: `apps/server/src/kanban/decider.test.ts`
- Test: `apps/server/src/kanban/projector.test.ts`

- [ ] **Step 1: Add failing tests**

Cover `kanban.card.ready-to-submit`, `kanban.card.submit.requested`, `kanban.card.submitted`, and `kanban.card.submit.failed`.

- [ ] **Step 2: Run focused tests**

Run: `bun run --cwd packages/contracts test src/kanban.test.ts && bun run --cwd apps/server test src/kanban/decider.test.ts src/kanban/projector.test.ts`

Expected: fail.

- [ ] **Step 3: Implement events and state transitions**

Only `approved` cards can become `ready_to_submit`. Only `ready_to_submit` cards can submit.

- [ ] **Step 4: Run focused tests**

Run: same command.

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/kanban.ts packages/contracts/src/kanban.test.ts apps/server/src/kanban/decider.ts apps/server/src/kanban/projector.ts apps/server/src/kanban/*.test.ts
git commit -m "feat: add kanban submission events"
```

## Task 3: Submission Service

**Files:**
- Create: `apps/server/src/kanban/Services/KanbanSubmissionService.ts`
- Create: `apps/server/src/kanban/Layers/KanbanSubmissionService.ts`
- Modify: `apps/server/src/wsRpc.ts`
- Test: `apps/server/src/kanban/Layers/KanbanSubmissionService.test.ts`

- [ ] **Step 1: Write failing service tests**

Use fake git/GitHub services. Test successful PR preparation and failure recording.

- [ ] **Step 2: Run test and confirm failure**

Run: `bun run --cwd apps/server test src/kanban/Layers/KanbanSubmissionService.test.ts`

Expected: fail.

- [ ] **Step 3: Implement service**

Use existing git/GitHub services already present under `apps/server/src/git/Services`. Do not shell out directly unless those services already do.

- [ ] **Step 4: Wire explicit command route**

Ensure submission happens only after a user command, not as an automatic reactor continuation.

- [ ] **Step 5: Run focused tests**

Run: same command.

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/kanban/Services/KanbanSubmissionService.ts apps/server/src/kanban/Layers/KanbanSubmissionService.ts apps/server/src/wsRpc.ts apps/server/src/kanban/Layers/KanbanSubmissionService.test.ts
git commit -m "feat: add human-gated kanban submission service"
```

## Task 4: Submission UI

**Files:**
- Modify: `apps/web/src/components/kanban/KanbanCardDetailPanel.tsx`
- Modify: `apps/web/src/components/kanban/KanbanCard.tsx`
- Modify: `apps/web/src/components/kanban/kanbanBoard.logic.ts`
- Test: `apps/web/src/components/kanban/kanbanBoard.logic.test.ts`

- [ ] **Step 1: Write failing UI logic tests**

Assert submit action appears only for `ready_to_submit`, submitted state shows PR/submission metadata, and failure state shows an actionable error.

- [ ] **Step 2: Implement UI**

Show a confirmation dialog before dispatching submission. Include summary, branch, worktree, diff/checkpoint links, and linked worker/reviewer threads.

- [ ] **Step 3: Run focused tests**

Run: `bun run --cwd apps/web test src/components/kanban/kanbanBoard.logic.test.ts`

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/kanban
git commit -m "feat: add kanban submission gate UI"
```

## Final Verification

- [ ] Run targeted tests:

```bash
bun run --cwd apps/server test src/kanban
bun run --cwd apps/web test src/components/kanban
```

- [ ] Only if explicitly requested for this phase, run workspace checks:

```bash
bun fmt
bun lint
bun typecheck
```

