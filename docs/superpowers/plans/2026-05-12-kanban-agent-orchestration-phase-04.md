# Kanban Agent Orchestration Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reviewer runs and the bounded worker-reviewer loop.

**Complete Target:** Native BroCode Kanban cards execute bounded worker/reviewer loops through existing provider architecture, with one shared card worktree and human-gated submission.

**Architecture:** Extend the Phase 3 reactor with reviewer scheduling and loop policy. Reviewer execution still goes through `ProviderService`; loop transitions are event-backed and server-owned.

**Tech Stack:** TypeScript, Effect streams, ProviderService, existing checkpoint/diff services, Vitest.

**Spec Source:** `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/00-overview.md` + `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/04-reviewer-run-and-loop-policy.md`

**Phase:** Phase 4: Reviewer Run and Loop Policy

**Next Required Phase:** Phase 5: Submission Gate, `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/05-submission-gate.md`

---

## File Structure

- Create `apps/server/src/kanban/reviewerPrompt.ts`: pure reviewer prompt builder.
- Create `apps/server/src/kanban/reviewerResult.ts`: conservative reviewer result parser.
- Create `apps/server/src/kanban/loopPolicy.ts`: retry and blocker policy.
- Test corresponding `.test.ts` files.
- Modify `apps/server/src/kanban/Layers/KanbanAgentReactor.ts`: worker completion starts review, review completion decides next state.
- Modify `packages/contracts/src/kanban.ts`: reviewer commands/events and loop policy fields if missing.
- Modify `apps/web/src/components/kanban/KanbanCardDetailPanel.tsx`: show review findings, retry count, blocker reason.

## Task 1: Loop Policy

**Files:**
- Create: `apps/server/src/kanban/loopPolicy.ts`
- Test: `apps/server/src/kanban/loopPolicy.test.ts`

- [ ] **Step 1: Write failing policy tests**

Cover max loop iterations, max consecutive review failures, pending approval blocker, unparseable reviewer blocker, and dirty worktree blocker.

- [ ] **Step 2: Run test and confirm failure**

Run: `bun run --cwd apps/server test src/kanban/loopPolicy.test.ts`

Expected: fail.

- [ ] **Step 3: Implement policy**

Export:

```ts
export function evaluateKanbanLoopPolicy(input: KanbanLoopPolicyInput): KanbanLoopDecision
```

Decision values: `continueWorker`, `startReviewer`, `approve`, `block`, `loopLimitReached`.

- [ ] **Step 4: Run focused test**

Run: `bun run --cwd apps/server test src/kanban/loopPolicy.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/kanban/loopPolicy.ts apps/server/src/kanban/loopPolicy.test.ts
git commit -m "feat: add kanban loop policy"
```

## Task 2: Reviewer Prompt and Parser

**Files:**
- Create: `apps/server/src/kanban/reviewerPrompt.ts`
- Create: `apps/server/src/kanban/reviewerResult.ts`
- Test: `apps/server/src/kanban/reviewerPrompt.test.ts`
- Test: `apps/server/src/kanban/reviewerResult.test.ts`

- [ ] **Step 1: Write failing tests**

Prompt test asserts spec, tasks, worker summary, diff/checkpoint summary, and required JSON verdict are included. Parser tests cover `approved`, `needs_work`, `blocked`, `inconclusive`, invalid JSON, and findings without task titles.

- [ ] **Step 2: Run tests and confirm failure**

Run: `bun run --cwd apps/server test src/kanban/reviewerPrompt.test.ts src/kanban/reviewerResult.test.ts`

Expected: fail.

- [ ] **Step 3: Implement prompt builder and parser**

Require reviewer output JSON:

```json
{
  "verdict": "approved",
  "summary": "string",
  "findings": []
}
```

For `needs_work`, every finding must include an actionable task title and rationale.

- [ ] **Step 4: Run focused tests**

Run: same command.

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/kanban/reviewerPrompt.ts apps/server/src/kanban/reviewerResult.ts apps/server/src/kanban/*review*.test.ts
git commit -m "feat: add kanban reviewer prompt and parser"
```

## Task 3: Reviewer Events and Projection

**Files:**
- Modify: `packages/contracts/src/kanban.ts`
- Modify: `apps/server/src/kanban/decider.ts`
- Modify: `apps/server/src/kanban/projector.ts`
- Test: `packages/contracts/src/kanban.test.ts`
- Test: `apps/server/src/kanban/decider.test.ts`
- Test: `apps/server/src/kanban/projector.test.ts`

- [ ] **Step 1: Add failing event tests**

Cover `kanban.review.started`, `kanban.review.completed`, follow-up task creation, status transitions to `needs_work`, `approved`, `blocked`, and `loop_limit_reached`.

- [ ] **Step 2: Run focused tests**

Run: `bun run --cwd packages/contracts test src/kanban.test.ts && bun run --cwd apps/server test src/kanban/decider.test.ts src/kanban/projector.test.ts`

Expected: fail.

- [ ] **Step 3: Implement contracts/decider/projector changes**

Keep task creation event-backed; do not mutate task arrays inside run payloads only.

- [ ] **Step 4: Run focused tests**

Run: same command.

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/kanban.ts packages/contracts/src/kanban.test.ts apps/server/src/kanban/decider.ts apps/server/src/kanban/projector.ts apps/server/src/kanban/*.test.ts
git commit -m "feat: add kanban review events"
```

## Task 4: Reactor Loop

**Files:**
- Modify: `apps/server/src/kanban/Layers/KanbanAgentReactor.ts`
- Test: `apps/server/src/kanban/Layers/KanbanAgentReactor.test.ts`

- [ ] **Step 1: Add fake-provider loop tests**

Test worker -> reviewer -> approved, worker -> reviewer -> needs work -> worker, reviewer blocked, provider failure, and loop limit.

- [ ] **Step 2: Run tests and confirm failure**

Run: `bun run --cwd apps/server test src/kanban/Layers/KanbanAgentReactor.test.ts`

Expected: fail.

- [ ] **Step 3: Implement reviewer scheduling**

When worker run completes successfully, start reviewer run with existing `ProviderService`.

- [ ] **Step 4: Implement loop decisions**

Use `evaluateKanbanLoopPolicy`; dispatch explicit Kanban events for every transition.

- [ ] **Step 5: Run focused tests**

Run: same command.

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/kanban/Layers/KanbanAgentReactor.ts apps/server/src/kanban/Layers/KanbanAgentReactor.test.ts
git commit -m "feat: add bounded kanban review loop"
```

## Task 5: UI Review State

**Files:**
- Modify: `apps/web/src/components/kanban/KanbanCard.tsx`
- Modify: `apps/web/src/components/kanban/KanbanCardDetailPanel.tsx`
- Modify: `apps/web/src/components/kanban/kanbanBoard.logic.ts`
- Test: `apps/web/src/components/kanban/kanbanBoard.logic.test.ts`

- [ ] **Step 1: Add failing presentation tests**

Assert retry count, review findings, blocker reason, and loop-limit status are displayed in view models.

- [ ] **Step 2: Implement presentation updates**

Show review findings as actionable tasks or blocker messages. Keep full logs linked to existing threads.

- [ ] **Step 3: Run focused tests**

Run: `bun run --cwd apps/web test src/components/kanban/kanbanBoard.logic.test.ts`

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/kanban
git commit -m "feat: show kanban review loop state"
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

