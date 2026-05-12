# Kanban Agent Orchestration Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Kanban contracts, durable events, projections, and WebSocket access without starting provider agents.

**Complete Target:** Native BroCode Kanban cards execute bounded worker/reviewer loops through existing provider architecture, with one shared card worktree and human-gated submission.

**Architecture:** Extend the existing orchestration event pipeline with Kanban aggregate kinds and schemas. Keep runtime logic out of `packages/contracts`; Phase 1 only adds durable state, projection, and API access.

**Tech Stack:** TypeScript, Effect Schema, Effect services/layers, SQLite migrations, Vitest, WebSocket RPC contracts.

**Spec Source:** `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/00-overview.md` + `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/01-kanban-domain-and-projection.md`

**Phase:** Phase 1: Kanban Domain and Projection

**Next Required Phase:** Phase 2: Kanban UI and Card Creation, `docs/superpowers/specs/2026-05-12-kanban-agent-orchestration/02-kanban-ui-and-card-creation.md`

---

## File Structure

- Create `packages/contracts/src/kanban.ts`: Kanban IDs, statuses, entities, commands, events, snapshots, RPC schemas.
- Modify `packages/contracts/src/index.ts`: export Kanban contracts.
- Modify `packages/contracts/src/ws.ts`: add Kanban RPC request bodies and push channel schema.
- Modify `packages/contracts/src/ipc.ts`: add `NativeApi.kanban`.
- Modify `packages/contracts/src/rpc.ts`: add typed Kanban RPC definitions.
- Test `packages/contracts/src/kanban.test.ts`: schema decode/round-trip coverage.
- Create `apps/server/src/kanban/decider.ts`: validate Kanban commands against read model and emit events.
- Create `apps/server/src/kanban/projector.ts`: in-memory read model projection.
- Create `apps/server/src/kanban/Schemas.ts`: server aliases to contract schemas.
- Create `apps/server/src/kanban/Services/KanbanEngine.ts` and `apps/server/src/kanban/Layers/KanbanEngine.ts`: serialized command dispatch and event stream.
- Create `apps/server/src/kanban/Services/KanbanSnapshotQuery.ts` and `apps/server/src/kanban/Layers/KanbanSnapshotQuery.ts`: read projection tables into snapshots.
- Create `apps/server/src/kanban/Services/KanbanProjectionPipeline.ts` and `apps/server/src/kanban/Layers/KanbanProjectionPipeline.ts`: write projections from events.
- Create `apps/server/src/persistence/Migrations/036_KanbanProjections.ts`: projection tables and aggregate-kind compatibility.
- Modify `apps/server/src/persistence/Migrations.ts`: register migration 36.
- Modify `apps/server/src/persistence/Layers/OrchestrationEventStore.ts`: allow `board` and `card` aggregate kinds if reusing `orchestration_events`.
- Modify `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`: do not assume every non-project command is a thread command if Kanban reuses event store helpers.
- Modify `apps/server/src/wsRpc.ts`: route Kanban snapshot, dispatch, subscribe, unsubscribe.
- Test `apps/server/src/kanban/decider.test.ts`, `apps/server/src/kanban/projector.test.ts`, `apps/server/src/kanban/Layers/KanbanEngine.test.ts`, `apps/server/src/kanban/Layers/KanbanProjectionPipeline.test.ts`, `apps/server/src/kanban/Layers/KanbanSnapshotQuery.test.ts`.

## Task 1: Contract Surface

**Files:**
- Create: `packages/contracts/src/kanban.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/kanban.test.ts`

- [ ] **Step 1: Write failing schema tests**

```ts
import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  KanbanCard,
  KanbanCardStatus,
  KanbanCommand,
  KanbanEvent,
  KanbanReadModel,
} from "./kanban";

const decode = <A>(schema: Schema.Schema<A>, value: unknown): A =>
  Schema.decodeUnknownSync(schema as never)(value) as A;

describe("kanban contracts", () => {
  it("decodes a card linked to project and source thread", () => {
    const card = decode(KanbanCard, {
      id: "card_1",
      boardId: "board_1",
      projectId: "project_1",
      title: "Auth architecture",
      status: "ready",
      sourceThreadId: "thread_1",
      spec: { type: "path", path: "spec/auth.md" },
      modelSelection: { provider: "codex", model: "gpt-5.5" },
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      taskIds: [],
      runIds: [],
      reviewIds: [],
      loopCount: 0,
      consecutiveReviewFailures: 0,
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      archivedAt: null,
    });
    expect(card.status).toBe("ready");
  });

  it("rejects unknown card status", () => {
    expect(() => decode(KanbanCardStatus, "almost_done")).toThrow();
  });
});
```

- [ ] **Step 2: Run the contract test and confirm failure**

Run: `bun run --cwd packages/contracts test src/kanban.test.ts`

Expected: fail because `./kanban` does not exist.

- [ ] **Step 3: Implement `packages/contracts/src/kanban.ts`**

Include:

```ts
export const KANBAN_WS_METHODS = {
  getSnapshot: "kanban.getSnapshot",
  dispatchCommand: "kanban.dispatchCommand",
  subscribeBoard: "kanban.subscribeBoard",
  unsubscribeBoard: "kanban.unsubscribeBoard",
} as const;

export const KANBAN_WS_CHANNELS = {
  boardEvent: "kanban.boardEvent",
} as const;
```

Use existing `ProjectId`, `ThreadId`, `CommandId`, `EventId`, `IsoDateTime`, `TrimmedNonEmptyString`, `ModelSelection`, and `RuntimeMode`.

- [ ] **Step 4: Export contracts**

Add `export * from "./kanban";` to `packages/contracts/src/index.ts`.

- [ ] **Step 5: Run focused tests**

Run: `bun run --cwd packages/contracts test src/kanban.test.ts`

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/kanban.ts packages/contracts/src/kanban.test.ts packages/contracts/src/index.ts
git commit -m "feat: add kanban contract schemas"
```

## Task 2: WebSocket and Native API Contracts

**Files:**
- Modify: `packages/contracts/src/ws.ts`
- Modify: `packages/contracts/src/ipc.ts`
- Modify: `packages/contracts/src/rpc.ts`
- Test: `packages/contracts/src/ws.test.ts`

- [ ] **Step 1: Add failing WebSocket decode test**

Add a test that decodes:

```ts
{
  id: "1",
  method: "kanban.getSnapshot",
  body: { _tag: "kanban.getSnapshot" }
}
```

Expected output tag: `KANBAN_WS_METHODS.getSnapshot`.

- [ ] **Step 2: Run focused contract tests**

Run: `bun run --cwd packages/contracts test src/ws.test.ts`

Expected: fail because Kanban methods are unknown.

- [ ] **Step 3: Add Kanban request body tags**

Import Kanban RPC schemas into `packages/contracts/src/ws.ts` and add `tagRequestBody(...)` entries for snapshot, dispatch, subscribe, and unsubscribe.

- [ ] **Step 4: Add `NativeApi.kanban`**

Add an interface section:

```ts
kanban: {
  getSnapshot: () => Promise<KanbanReadModel>;
  dispatchCommand: (command: ClientKanbanCommand) => Promise<{ sequence: number }>;
  subscribeBoard: (input: KanbanSubscribeBoardInput) => Promise<void>;
  unsubscribeBoard: (input: KanbanSubscribeBoardInput) => Promise<void>;
};
```

- [ ] **Step 5: Add RPC definitions**

Mirror the orchestration RPC pattern in `packages/contracts/src/rpc.ts`.

- [ ] **Step 6: Run focused tests**

Run: `bun run --cwd packages/contracts test src/ws.test.ts src/rpc.test.ts`

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/ws.ts packages/contracts/src/ipc.ts packages/contracts/src/rpc.ts packages/contracts/src/ws.test.ts packages/contracts/src/rpc.test.ts
git commit -m "feat: expose kanban websocket contracts"
```

## Task 3: Persistence Migration

**Files:**
- Create: `apps/server/src/persistence/Migrations/036_KanbanProjections.ts`
- Modify: `apps/server/src/persistence/Migrations.ts`
- Test: `apps/server/src/persistence/Migrations/036_KanbanProjections.test.ts`

- [ ] **Step 1: Write failing migration test**

Assert that running through migration 36 creates:

- `projection_kanban_boards`
- `projection_kanban_cards`
- `projection_kanban_tasks`
- `projection_kanban_runs`
- `projection_kanban_reviews`
- `projection_kanban_state`

- [ ] **Step 2: Run migration test**

Run: `bun run --cwd apps/server test src/persistence/Migrations/036_KanbanProjections.test.ts`

Expected: fail because migration 36 is absent.

- [ ] **Step 3: Add migration**

Create projection tables with JSON columns for `model_selection_json`, `spec_json`, `result_json`, and `metadata_json` where appropriate. Use `CREATE TABLE IF NOT EXISTS`. Add indexes for project, board, card, status, and updated time.

- [ ] **Step 4: Register migration**

Import `Migration0036` in `apps/server/src/persistence/Migrations.ts` and append `[36, "KanbanProjections", Migration0036]`.

- [ ] **Step 5: Run migration test**

Run: `bun run --cwd apps/server test src/persistence/Migrations/036_KanbanProjections.test.ts`

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/persistence/Migrations.ts apps/server/src/persistence/Migrations/036_KanbanProjections.ts apps/server/src/persistence/Migrations/036_KanbanProjections.test.ts
git commit -m "feat: add kanban projection tables"
```

## Task 4: Kanban Decider and Projector

**Files:**
- Create: `apps/server/src/kanban/decider.ts`
- Create: `apps/server/src/kanban/projector.ts`
- Create: `apps/server/src/kanban/Schemas.ts`
- Test: `apps/server/src/kanban/decider.test.ts`
- Test: `apps/server/src/kanban/projector.test.ts`

- [ ] **Step 1: Write decider tests**

Cover:

- board creation requires existing project id input but does not query project state yet
- card creation requires board id, project id, title, spec, model selection, and runtime mode
- task upsert requires existing card
- status changes reject invalid lifecycle jumps such as `submitted -> implementing`

- [ ] **Step 2: Write projector tests**

Replay board created, card created, task upserted, status changed. Assert `KanbanReadModel` contains board, card, task, and updated sequence.

- [ ] **Step 3: Run tests and confirm failure**

Run: `bun run --cwd apps/server test src/kanban/decider.test.ts src/kanban/projector.test.ts`

Expected: fail because modules do not exist.

- [ ] **Step 4: Implement decider**

Follow `apps/server/src/orchestration/decider.ts` style. Keep helpers small. Return one event or a readonly event array.

- [ ] **Step 5: Implement projector**

Follow `apps/server/src/orchestration/projector.ts` style. Decode payloads with contract schemas and update immutable read model arrays.

- [ ] **Step 6: Run focused tests**

Run: `bun run --cwd apps/server test src/kanban/decider.test.ts src/kanban/projector.test.ts`

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/kanban/decider.ts apps/server/src/kanban/projector.ts apps/server/src/kanban/Schemas.ts apps/server/src/kanban/decider.test.ts apps/server/src/kanban/projector.test.ts
git commit -m "feat: add kanban decider and projector"
```

## Task 5: Kanban Engine and Projection Pipeline

**Files:**
- Create: `apps/server/src/kanban/Services/KanbanEngine.ts`
- Create: `apps/server/src/kanban/Layers/KanbanEngine.ts`
- Create: `apps/server/src/kanban/Services/KanbanProjectionPipeline.ts`
- Create: `apps/server/src/kanban/Layers/KanbanProjectionPipeline.ts`
- Test: `apps/server/src/kanban/Layers/KanbanEngine.test.ts`
- Test: `apps/server/src/kanban/Layers/KanbanProjectionPipeline.test.ts`

- [ ] **Step 1: Write engine tests**

Test dispatch serialization, command receipt behavior if reused, and event publication order.

- [ ] **Step 2: Write projection tests**

Persist events and assert projection tables are updated.

- [ ] **Step 3: Run tests and confirm failure**

Run: `bun run --cwd apps/server test src/kanban/Layers/KanbanEngine.test.ts src/kanban/Layers/KanbanProjectionPipeline.test.ts`

Expected: fail because services do not exist.

- [ ] **Step 4: Implement services**

Prefer reusing the existing event store only if aggregate kinds can be extended cleanly. If `OrchestrationEventStore` changes become invasive, stop and create a dedicated `KanbanEventStore`; do not wedge cards into thread streams.

- [ ] **Step 5: Run focused tests**

Run: `bun run --cwd apps/server test src/kanban/Layers/KanbanEngine.test.ts src/kanban/Layers/KanbanProjectionPipeline.test.ts`

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/kanban/Services apps/server/src/kanban/Layers
git commit -m "feat: add kanban engine and projection pipeline"
```

## Task 6: Snapshot Query and WebSocket Routing

**Files:**
- Create: `apps/server/src/kanban/Services/KanbanSnapshotQuery.ts`
- Create: `apps/server/src/kanban/Layers/KanbanSnapshotQuery.ts`
- Modify: `apps/server/src/wsRpc.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/web/src/wsNativeApi.ts`
- Test: `apps/server/src/kanban/Layers/KanbanSnapshotQuery.test.ts`
- Test: `apps/server/src/main.test.ts`
- Test: `apps/web/src/wsTransport.test.ts`

- [ ] **Step 1: Write failing snapshot/routing tests**

Assert `kanban.getSnapshot` returns the projected model and `kanban.subscribeBoard` immediately pushes the latest board snapshot.

- [ ] **Step 2: Run focused tests**

Run: `bun run --cwd apps/server test src/kanban/Layers/KanbanSnapshotQuery.test.ts src/main.test.ts`

Expected: fail.

- [ ] **Step 3: Implement query and routing**

Mirror orchestration shell/thread subscription behavior in `apps/server/src/wsRpc.ts`. Add `api.kanban` methods in `apps/web/src/wsNativeApi.ts`.

- [ ] **Step 4: Run focused tests**

Run: `bun run --cwd apps/server test src/kanban/Layers/KanbanSnapshotQuery.test.ts src/main.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/kanban/Services/KanbanSnapshotQuery.ts apps/server/src/kanban/Layers/KanbanSnapshotQuery.ts apps/server/src/wsRpc.ts apps/server/src/main.ts apps/web/src/wsNativeApi.ts
git commit -m "feat: expose kanban snapshots over websocket"
```

## Final Verification

- [ ] Run targeted tests:

```bash
bun run --cwd packages/contracts test src/kanban.test.ts src/ws.test.ts src/rpc.test.ts
bun run --cwd apps/server test src/kanban src/persistence/Migrations/036_KanbanProjections.test.ts
```

- [ ] Only if explicitly requested for this phase, run workspace checks:

```bash
bun fmt
bun lint
bun typecheck
```

