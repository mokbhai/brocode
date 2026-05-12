# Phase 5: Submission Gate

## Goal

Add the human-gated submission step after reviewer approval.

## Scope

When a card is approved, move it to `Ready to Submit`. Show enough context for the user to decide whether to submit:

- spec reference
- completed checklist
- worker and reviewer run history
- reviewer approval summary
- branch/worktree
- diff/checkpoint summary
- linked provider threads

Submission can use existing git and GitHub services where available. The user must explicitly approve PR creation or final submission.

## Acceptance Criteria

- Approved card moves to `Ready to Submit`.
- User can inspect diff/checkpoint summary from card detail.
- User can open linked worker and reviewer threads.
- User can trigger PR/submission from the card when supported.
- Submission result is recorded on the card.
- Submission failure leaves the card actionable with an error reason.

## Verification

- UI tests for ready-to-submit state and submission action availability.
- Server tests for submission commands and failure events.
- Integration-style test for approved card -> human submit -> submitted.

