# Phase 1: Kanban Domain and Projection

## Goal

Add native Kanban contracts, durable events, read models, projection, and WebSocket access without running any agents yet.

## Scope

Define Kanban as first-class BroCode state:

- board
- card
- task
- run
- review

The first version can create one default board per project. Multi-board customization is not required for the complete target.

## Contracts

Add schemas for:

- `KanbanBoard`
- `KanbanCard`
- `KanbanTask`
- `KanbanRun`
- `KanbanReview`
- `KanbanReadModel`
- `KanbanBoardSnapshot`
- client commands
- server/internal commands
- events and payloads

`KanbanCard` must include explicit links back to BroCode state:

- `projectId`
- optional `sourceThreadId`
- optional worker thread ids
- optional reviewer thread ids
- model selection through existing `ModelSelection`
- runtime mode through existing runtime mode contracts
- branch/worktree metadata compatible with existing thread/worktree helpers

Recommended event types:

- `kanban.board.created`
- `kanban.card.created`
- `kanban.card.updated`
- `kanban.card.status-changed`
- `kanban.task.upserted`
- `kanban.task.deleted`
- `kanban.run.started`
- `kanban.run.completed`
- `kanban.review.completed`
- `kanban.card.blocked`
- `kanban.card.approved`
- `kanban.card.ready-to-submit`

The event store should not overload thread aggregates for cards. Prefer extending aggregate kinds with Kanban-specific aggregates such as `board` and `card`, unless implementation review shows a sibling Kanban event store is materially safer.

## Server

Add a Kanban decider/projector pair following existing orchestration patterns. Add snapshot query and subscription APIs for the board shell and card detail.

No provider execution happens in this phase.

## Acceptance Criteria

- A project can have a default Kanban board.
- A card with spec reference and tasks can be created and projected.
- Card status changes are event-backed and replayable.
- Task creation, update, and deletion are event-backed and replayable.
- Web clients can fetch a Kanban snapshot.
- Web clients can subscribe to Kanban state updates.

## Verification

- Contract schema tests for commands, events, and read models.
- Decider tests for card/task invariants.
- Projector replay tests.
- Persistence compatibility tests for any event store aggregate-kind changes.
