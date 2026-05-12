// FILE: kanbanStatus.ts
// Purpose: Share pure Kanban status ordering and labels without importing store state.
// Exports: Exhaustive card status presentation metadata and ordered status helpers.

import type { KanbanCardStatus } from "@t3tools/contracts";

interface KanbanCardStatusPresentation {
  readonly title: string;
}

export const KANBAN_CARD_STATUS_PRESENTATION = {
  draft: { title: "Draft" },
  ready: { title: "Ready" },
  implementing: { title: "Implementing" },
  reviewing: { title: "Reviewing" },
  needs_work: { title: "Needs Work" },
  approved: { title: "Approved" },
  ready_to_submit: { title: "Ready to Submit" },
  submitted: { title: "Submitted" },
  blocked: { title: "Blocked" },
  loop_limit_reached: { title: "Loop Limit Reached" },
  agent_error: { title: "Agent Error" },
  review_inconclusive: { title: "Review Inconclusive" },
} satisfies Record<KanbanCardStatus, KanbanCardStatusPresentation>;

export const KANBAN_CARD_STATUSES = Object.keys(
  KANBAN_CARD_STATUS_PRESENTATION,
) as readonly KanbanCardStatus[];

export function getKanbanCardStatusTitle(status: KanbanCardStatus): string {
  return KANBAN_CARD_STATUS_PRESENTATION[status].title;
}
