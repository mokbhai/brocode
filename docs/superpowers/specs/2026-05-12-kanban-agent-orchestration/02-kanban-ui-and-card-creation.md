# Phase 2: Kanban UI and Card Creation

## Goal

Add the Kanban section and allow users to create, inspect, and edit cards before agent execution exists.

## Scope

Add Kanban as a peer section beside Threads and Workspace. The first version should use a board plus side detail layout.

Columns:

- `Ready`
- `Implementing`
- `Reviewing`
- `Needs Work`
- `Blocked`
- `Ready to Submit`
- `Submitted`

Card summary:

- title
- spec path or source
- task count and completion count
- current status
- active role when present
- retry count when present
- provider/model selection
- branch/worktree when present

Card detail panel:

- spec reference
- source thread link
- editable checklist
- run history placeholder
- reviewer findings placeholder
- worktree/branch metadata
- start/stop controls disabled until later phases

## Create Flows

Support:

- create card from current planning thread
- create card from spec path
- create card manually

The create-from-thread flow should link the card to the source thread. It does not need to extract perfect tasks automatically in this phase; manual task editing is enough.

## Acceptance Criteria

- User can open a Kanban section for a project.
- User can create a card from a thread or spec path.
- User can edit the checklist before execution.
- User can change basic card metadata.
- UI reflects event-backed board updates from the server.
- Full transcript rendering stays in the existing thread view; Kanban links to thread logs instead of embedding them.

## Verification

- UI logic tests for board grouping and card status display.
- UI tests for create-card command payloads.
- Store/projection application tests for Kanban snapshots and updates.
- Accessibility checks for card actions and side panel controls.

