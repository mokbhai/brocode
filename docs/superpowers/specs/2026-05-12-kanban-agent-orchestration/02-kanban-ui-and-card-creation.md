# Phase 2: Kanban UI and Card Creation

## Goal

Add the Kanban section and allow users to create and inspect cards before agent execution exists.

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
- generated task count and completion count when tasks exist
- current status
- active role when present
- retry count when present
- provider/model selection
- runtime mode
- branch/worktree when present

Card detail panel:

- title and description/context
- read-only generated checklist when tasks exist
- run history placeholder
- reviewer findings placeholder
- worktree/branch metadata
- start/stop controls disabled until later phases

## Create Flows

Support one create-card flow with these fields only:

- title
- description
- runtime mode
- provider
- model

The description is the single user-authored context field. The user can paste a full spec, paste planning notes, or type a spec path into the description. Do not add a source selector, separate spec-path input, separate inline-spec input, or manual initial-task input.

Provider and model selection should reuse the same interaction pattern and data shape as Threads. Kanban must not add a provider/model abstraction or a separate LLM-calling path.

If the dialog is opened from a planning thread, it may prefill title/description and retain a hidden `sourceThreadId` for navigation, but the user should still see the same simple form. There should be no user-visible source mode.

## Acceptance Criteria

- User can open a Kanban section for a project.
- User can create a card with title, description, runtime mode, provider, and model.
- User can paste spec content or a spec path into the description without choosing a separate source.
- User is not asked to provide initial tasks during card creation.
- User cannot manually add, edit, or delete tasks from the Kanban UI.
- User can change basic card metadata.
- UI reflects event-backed board updates from the server.
- Full transcript rendering stays in the existing thread view; Kanban links to thread logs instead of embedding them.

## Verification

- UI logic tests for board grouping and card status display.
- UI tests for create-card command payloads.
- UI tests proving removed fields are not required or submitted: source, spec path, inline spec, and initial tasks.
- UI tests proving manual task add/edit/delete controls are not rendered.
- Store/projection application tests for Kanban snapshots and updates.
- Accessibility checks for card actions and side panel controls.
