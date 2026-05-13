# Phase 3: Automations UI

## Goal

Add the user-facing Automations route, list, create/edit experience, schedule controls, environment dropdown, and run history surfaces.

## Scope

Build the UI around the server snapshot and command APIs:

- sidebar Automations item
- Automations route
- list of automation definitions
- create/edit sheet or dialog
- target picker
- schedule picker
- timezone control
- environment dropdown defaulting to `Local`
- write policy controls
- enabled toggle
- Run now button
- recent run history
- result thread navigation

This UI should feel like a dense operational tool, not a landing page. Keep it scan-friendly and consistent with existing BroCode sidebar, sheets, buttons, menus, and typography.

## List View

The Automations route should show:

- title
- target label
- schedule summary
- environment mode
- writes enabled/disabled
- enabled state
- last run status/time
- next run time
- current active/skipped/failed state

The list should support empty, loading, and error states. Empty state should directly offer creating an automation without marketing copy.

## Create/Edit Sheet

Fields:

- title
- prompt editor
- target picker
- schedule picker
- timezone
- provider/model selection
- runtime mode
- environment dropdown
- writes enabled control
- advanced dirty-local toggle
- enabled toggle

Environment dropdown:

- default value: `Local`
- selectable value: `Worktree`
- local mode should carry a concise warning when writes are enabled

The UI should not expose raw JSON schedule config. If cron is included, it belongs in an advanced section with validation feedback.

## Target Picker

Target picker should let users choose:

- project
- thread
- chat/home when supported

For thread targets, the UI should make clear that the source thread is read as context but output goes to the automation result thread.

## Run History

Each automation detail should show recent runs:

- status
- trigger type
- started/completed times
- result thread link
- error/skipped reason
- changed-file summary when available

Run actions:

- Run now
- Cancel active run
- Retry failed/skipped run when safe
- Open result thread

## Acceptance Criteria

- Users can navigate to Automations from the sidebar.
- Users can create, edit, delete, enable, and disable automations.
- Environment defaults to `Local` and can be switched to `Worktree`.
- Schedule summary is readable and matches stored schedule config.
- Run now dispatches a manual run command.
- Active, failed, skipped, and completed runs render distinctly.
- Result thread navigation works from run history.
- The route stays current via WebSocket subscription or query invalidation.

## Verification

- UI logic tests for schedule summaries and form normalization.
- Store/query tests for snapshot hydration and streamed updates.
- Component tests for create/edit validation.
- Route tests for sidebar navigation and empty/error states.
- Accessibility checks for controls, labels, menus, and dialogs.
