// FILE: kanbanBoard.logic.ts
// Purpose: Build pure Kanban board view models for column and card presentation.
// Exports: Kanban board grouping, progress, retry, and badge presentation helpers.
// Depends on: Kanban contracts and store status ordering only.

import type { KanbanCard, KanbanCardStatus, KanbanTask } from "@t3tools/contracts";

import { getKanbanCardStatusTitle, KANBAN_CARD_STATUSES } from "../../kanbanStatus";

export type KanbanCardBadgeTone = "blocked" | "error" | "warning";

export interface KanbanCardBadgeViewModel {
  readonly tone: KanbanCardBadgeTone;
  readonly label: string;
  readonly title: string;
}

export interface KanbanCardViewModel {
  readonly card: KanbanCard;
  readonly tasks: readonly KanbanTask[];
  readonly progressText: string;
  readonly retryText: string | null;
  readonly badges: readonly KanbanCardBadgeViewModel[];
}

export interface KanbanColumnViewModel {
  readonly id: KanbanCardStatus;
  readonly title: string;
  readonly cards: readonly KanbanCardViewModel[];
  readonly cardCount: number;
}

export type KanbanTasksByCardId = Readonly<Record<string, readonly KanbanTask[] | undefined>>;

export function getKanbanColumnTitle(status: KanbanCardStatus): string {
  return getKanbanCardStatusTitle(status);
}

export function formatKanbanCardProgress(
  _card: KanbanCard,
  tasks: readonly KanbanTask[],
): string {
  if (tasks.length === 0) {
    return "No tasks";
  }

  const doneCount = tasks.filter((task) => task.status === "done").length;
  const taskLabel = tasks.length === 1 ? "task" : "tasks";
  return `${doneCount}/${tasks.length} ${taskLabel} done`;
}

export function formatKanbanCardRetryText(card: KanbanCard): string | null {
  if (card.status === "loop_limit_reached") {
    return "Retry limit reached";
  }
  if (card.loopCount <= 0 || card.maxLoopCount <= 0) {
    return null;
  }
  return `Retry ${card.loopCount}/${card.maxLoopCount}`;
}

export function getKanbanCardBadges(card: KanbanCard): KanbanCardBadgeViewModel[] {
  switch (card.status) {
    case "blocked":
      return [
        {
          tone: "blocked",
          label: "Blocked",
          title: card.blockerReason ?? "Blocked",
        },
      ];
    case "agent_error":
      return [
        {
          tone: "error",
          label: "Agent error",
          title:
            card.maxLoopCount > 0 && card.loopCount < card.maxLoopCount
              ? "Retry available"
              : "Agent run failed",
        },
      ];
    case "loop_limit_reached":
      return [
        {
          tone: "error",
          label: "Loop limit reached",
          title: "Retry limit reached",
        },
      ];
    case "review_inconclusive":
      return [
        {
          tone: "warning",
          label: "Review inconclusive",
          title: "Reviewer could not reach a decision",
        },
      ];
    default:
      return [];
  }
}

export function createKanbanCardViewModel(
  card: KanbanCard,
  tasks: readonly KanbanTask[] = [],
): KanbanCardViewModel {
  return {
    card,
    tasks,
    progressText: formatKanbanCardProgress(card, tasks),
    retryText: formatKanbanCardRetryText(card),
    badges: getKanbanCardBadges(card),
  };
}

export function groupKanbanCardsByColumn(
  cards: readonly KanbanCard[],
  tasksByCardId: KanbanTasksByCardId = {},
): KanbanColumnViewModel[] {
  const cardsByStatus = new Map<KanbanCardStatus, KanbanCardViewModel[]>(
    KANBAN_CARD_STATUSES.map((status) => [status, []]),
  );

  for (const card of cards) {
    const columnCards = cardsByStatus.get(card.status);
    if (!columnCards) {
      continue;
    }
    columnCards.push(createKanbanCardViewModel(card, tasksByCardId[card.id] ?? []));
  }

  return KANBAN_CARD_STATUSES.map((status) => {
    const columnCards = cardsByStatus.get(status) ?? [];
    return {
      id: status,
      title: getKanbanColumnTitle(status),
      cards: columnCards,
      cardCount: columnCards.length,
    };
  });
}
