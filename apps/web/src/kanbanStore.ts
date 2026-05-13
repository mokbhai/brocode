// FILE: kanbanStore.ts
// Purpose: Keep Kanban board snapshots and subscriptions in lightweight web state.
// Layer: Web view-model state
// Exports: Zustand store, Kanban actions, and pure snapshot selectors/projectors.

import {
  type ClientKanbanCommand,
  type CommandId,
  type KanbanBoardId,
  type KanbanBoardSnapshot,
  type KanbanCard,
  type KanbanCardId,
  type KanbanCardStatus,
  type KanbanEvent,
  type KanbanEventCard,
  type KanbanReview,
  type KanbanRun,
  type KanbanTask,
  type ModelSelection,
  type ProjectId,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import { create } from "zustand";

import { KANBAN_CARD_STATUSES } from "./kanbanStatus";
import { ensureNativeApi } from "./nativeApi";

export type KanbanCardsByStatus = Record<KanbanCardStatus, KanbanCard[]>;

export interface CreateKanbanBoardInput {
  boardId: KanbanBoardId;
  projectId: ProjectId;
  title: string;
}

export interface CreateKanbanCardInput {
  boardId: KanbanBoardId;
  cardId?: KanbanCardId;
  projectId: ProjectId;
  sourceThreadId?: ThreadId | null;
  title: string;
  description?: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
}

export interface UpdateKanbanCardInput {
  cardId: KanbanCardId;
  title?: string;
  description?: string | null;
  modelSelection?: ModelSelection;
  runtimeMode?: RuntimeMode;
}

export interface KanbanStoreData {
  snapshotsByBoardId: Record<string, KanbanBoardSnapshot | undefined>;
  loadingBoardIds: Record<string, boolean | undefined>;
  errorByBoardId: Record<string, string | undefined>;
  subscribedBoardIds: Record<string, boolean | undefined>;
  subscriptionCountByBoardId: Record<string, number | undefined>;
  removeBoardEventListenerByBoardId: Record<string, (() => void) | undefined>;
}

export interface KanbanStoreState extends KanbanStoreData {
  loadKanbanSnapshot: (boardId: KanbanBoardId) => Promise<void>;
  subscribeKanbanBoard: (boardId: KanbanBoardId) => Promise<() => Promise<void>>;
  createKanbanBoard: (input: CreateKanbanBoardInput) => Promise<void>;
  createKanbanCard: (input: CreateKanbanCardInput) => Promise<void>;
  updateKanbanCard: (input: UpdateKanbanCardInput) => Promise<void>;
  applyKanbanBoardEvent: (event: KanbanEvent) => void;
}

export function createInitialKanbanStoreState(): KanbanStoreData {
  return {
    snapshotsByBoardId: {},
    loadingBoardIds: {},
    errorByBoardId: {},
    subscribedBoardIds: {},
    subscriptionCountByBoardId: {},
    removeBoardEventListenerByBoardId: {},
  };
}

function randomId(prefix: string): string {
  const value =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${value}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function commandId(): CommandId {
  return randomId("kanban-command") as CommandId;
}

function cardId(): KanbanCardId {
  return randomId("kanban-card") as KanbanCardId;
}

function upsertById<T extends { readonly id: string }>(items: readonly T[], item: T): T[] {
  let replaced = false;
  const next = items.map((existing) => {
    if (existing.id !== item.id) {
      return existing;
    }
    replaced = true;
    return item;
  });
  return replaced ? next : [...next, item];
}

function removeById<T extends { readonly id: string }>(items: readonly T[], id: string): T[] {
  return items.filter((item) => item.id !== id);
}

function snapshotHasCard(snapshot: KanbanBoardSnapshot, cardIdToFind: KanbanCardId): boolean {
  return snapshot.cards.some((card) => card.id === cardIdToFind);
}

function updateCard(
  snapshot: KanbanBoardSnapshot,
  cardIdToUpdate: KanbanCardId,
  patch: Partial<KanbanCard>,
): KanbanBoardSnapshot {
  if (!snapshotHasCard(snapshot, cardIdToUpdate)) {
    return snapshot;
  }
  return {
    ...snapshot,
    cards: snapshot.cards.map((card) =>
      card.id === cardIdToUpdate
        ? {
            ...card,
            ...patch,
          }
        : card,
    ),
  };
}

function stripLegacySpecPath(card: KanbanEventCard): KanbanCard {
  const { specPath: _specPath, ...nextCard } = card;
  return nextCard;
}

function statusReasonPatch(
  toStatus: KanbanCardStatus,
  reason: string | null,
): string | null {
  return toStatus === "blocked" || toStatus === "agent_error" ? reason : null;
}

function upsertTaskInSnapshot(snapshot: KanbanBoardSnapshot, task: KanbanTask): KanbanBoardSnapshot {
  if (!snapshotHasCard(snapshot, task.cardId)) {
    return snapshot;
  }
  const tasks = snapshot.tasksByCardId[task.cardId] ?? [];
  return {
    ...snapshot,
    tasksByCardId: {
      ...snapshot.tasksByCardId,
      [task.cardId]: upsertById(tasks, task).sort((left, right) => left.order - right.order),
    },
  };
}

function upsertRunInSnapshot(snapshot: KanbanBoardSnapshot, run: KanbanRun): KanbanBoardSnapshot {
  if (!snapshotHasCard(snapshot, run.cardId)) {
    return snapshot;
  }
  const runs = snapshot.runsByCardId[run.cardId] ?? [];
  return {
    ...snapshot,
    runsByCardId: {
      ...snapshot.runsByCardId,
      [run.cardId]: upsertById(runs, run),
    },
  };
}

function upsertReviewInSnapshot(
  snapshot: KanbanBoardSnapshot,
  review: KanbanReview,
): KanbanBoardSnapshot {
  if (!snapshotHasCard(snapshot, review.cardId)) {
    return snapshot;
  }
  const reviews = snapshot.reviewsByCardId[review.cardId] ?? [];
  return {
    ...snapshot,
    reviewsByCardId: {
      ...snapshot.reviewsByCardId,
      [review.cardId]: upsertById(reviews, review),
    },
  };
}

function patchCardThreadIds(
  snapshot: KanbanBoardSnapshot,
  input: { cardId: KanbanCardId; threadId: ThreadId; role: "worker" | "reviewer" },
): KanbanBoardSnapshot {
  const card = snapshot.cards.find((candidate) => candidate.id === input.cardId);
  if (!card) {
    return snapshot;
  }

  if (input.role === "worker") {
    return updateCard(snapshot, input.cardId, {
      workerThreadIds: [...new Set([...card.workerThreadIds, input.threadId])],
    });
  }

  return updateCard(snapshot, input.cardId, {
    reviewerThreadIds: [...new Set([...card.reviewerThreadIds, input.threadId])],
  });
}

function withEventSequence(snapshot: KanbanBoardSnapshot, event: KanbanEvent): KanbanBoardSnapshot {
  return {
    ...snapshot,
    snapshotSequence: Math.max(snapshot.snapshotSequence, event.sequence),
  };
}

export function applyKanbanEventToSnapshot(
  snapshot: KanbanBoardSnapshot,
  event: KanbanEvent,
): KanbanBoardSnapshot {
  if (event.sequence <= snapshot.snapshotSequence) {
    return snapshot;
  }

  switch (event.type) {
    case "kanban.board.created":
      return event.payload.board.id === snapshot.board.id
        ? {
            ...withEventSequence(snapshot, event),
            board: event.payload.board,
          }
        : snapshot;

    case "kanban.card.created": {
      if (event.payload.card.boardId !== snapshot.board.id) {
        return snapshot;
      }
      const next = withEventSequence(snapshot, event);
      const card = stripLegacySpecPath(event.payload.card);
      return {
        ...next,
        cards: upsertById(next.cards, card),
        tasksByCardId: {
          ...next.tasksByCardId,
          [card.id]: event.payload.tasks,
        },
      };
    }

    case "kanban.card.updated":
      return event.payload.card.boardId === snapshot.board.id
        ? {
            ...withEventSequence(snapshot, event),
            cards: upsertById(snapshot.cards, stripLegacySpecPath(event.payload.card)),
          }
        : snapshot;

    case "kanban.card.status-changed":
      if (!snapshotHasCard(snapshot, event.payload.cardId)) {
        return snapshot;
      }
      return updateCard(withEventSequence(snapshot, event), event.payload.cardId, {
        status: event.payload.toStatus,
        blockerReason: statusReasonPatch(event.payload.toStatus, event.payload.reason),
        updatedAt: event.payload.updatedAt,
      });

    case "kanban.task.upserted":
      if (!snapshotHasCard(snapshot, event.payload.task.cardId)) {
        return snapshot;
      }
      return upsertTaskInSnapshot(withEventSequence(snapshot, event), event.payload.task);

    case "kanban.task.deleted":
      if (!snapshotHasCard(snapshot, event.payload.cardId)) {
        return snapshot;
      }
      return {
        ...withEventSequence(snapshot, event),
        tasksByCardId: {
          ...snapshot.tasksByCardId,
          [event.payload.cardId]: removeById(
            snapshot.tasksByCardId[event.payload.cardId] ?? [],
            event.payload.taskId,
          ),
        },
      };

    case "kanban.run.started": {
      if (!snapshotHasCard(snapshot, event.payload.run.cardId)) {
        return snapshot;
      }
      const runSnapshot = upsertRunInSnapshot(withEventSequence(snapshot, event), event.payload.run);
      return event.payload.run.threadId
        ? patchCardThreadIds(runSnapshot, {
            cardId: event.payload.run.cardId,
            threadId: event.payload.run.threadId,
            role: event.payload.run.role,
          })
        : runSnapshot;
    }

    case "kanban.run.completed":
      if (!snapshotHasCard(snapshot, event.payload.run.cardId)) {
        return snapshot;
      }
      return upsertRunInSnapshot(withEventSequence(snapshot, event), event.payload.run);

    case "kanban.review.completed":
      if (!snapshotHasCard(snapshot, event.payload.review.cardId)) {
        return snapshot;
      }
      return patchCardThreadIds(
        upsertReviewInSnapshot(withEventSequence(snapshot, event), event.payload.review),
        {
          cardId: event.payload.review.cardId,
          threadId: event.payload.review.reviewerThreadId,
          role: "reviewer",
        },
      );

    case "kanban.card.blocked":
      if (!snapshotHasCard(snapshot, event.payload.cardId)) {
        return snapshot;
      }
      return updateCard(withEventSequence(snapshot, event), event.payload.cardId, {
        status: "blocked",
        blockerReason: event.payload.reason,
        updatedAt: event.payload.blockedAt,
      });

    case "kanban.card.approved":
      if (!snapshotHasCard(snapshot, event.payload.cardId)) {
        return snapshot;
      }
      return updateCard(withEventSequence(snapshot, event), event.payload.cardId, {
        status: "approved",
        blockerReason: null,
        updatedAt: event.payload.approvedAt,
      });

    case "kanban.card.ready-to-submit":
      if (!snapshotHasCard(snapshot, event.payload.cardId)) {
        return snapshot;
      }
      return updateCard(withEventSequence(snapshot, event), event.payload.cardId, {
        status: "ready_to_submit",
        blockerReason: null,
        updatedAt: event.payload.readyAt,
      });
  }
}

export function groupKanbanCardsByStatus(snapshot: KanbanBoardSnapshot): KanbanCardsByStatus {
  const grouped = Object.fromEntries(
    KANBAN_CARD_STATUSES.map((status) => [status, []]),
  ) as KanbanCardsByStatus;
  for (const card of snapshot.cards) {
    grouped[card.status].push(card);
  }
  return grouped;
}

export function selectCardsByStatus(
  snapshot: KanbanBoardSnapshot | null | undefined,
  status: KanbanCardStatus,
): KanbanCard[] {
  return snapshot?.cards.filter((card) => card.status === status) ?? [];
}

export function selectKanbanSnapshot(
  state: KanbanStoreData,
  boardId: KanbanBoardId,
): KanbanBoardSnapshot | null {
  return state.snapshotsByBoardId[boardId] ?? null;
}

export function selectKanbanTasksForCard(
  snapshot: KanbanBoardSnapshot | null | undefined,
  cardIdToSelect: KanbanCardId,
): KanbanTask[] {
  return snapshot?.tasksByCardId[cardIdToSelect] ?? [];
}

const pendingBoardSubscriptionByBoardId = new Map<string, Promise<void>>();

function createBoardCommand(input: CreateKanbanBoardInput): ClientKanbanCommand {
  return {
    type: "kanban.board.create",
    commandId: commandId(),
    boardId: input.boardId,
    projectId: input.projectId,
    title: input.title,
    createdAt: nowIso(),
  };
}

function createCardCommand(input: CreateKanbanCardInput): ClientKanbanCommand {
  const createdAt = nowIso();
  return {
    type: "kanban.card.create",
    commandId: commandId(),
    boardId: input.boardId,
    cardId: input.cardId ?? cardId(),
    projectId: input.projectId,
    sourceThreadId: input.sourceThreadId ?? null,
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    createdAt,
  };
}

function createCardUpdateCommand(input: UpdateKanbanCardInput): ClientKanbanCommand {
  return {
    type: "kanban.card.update",
    commandId: commandId(),
    cardId: input.cardId,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
    ...(input.runtimeMode !== undefined ? { runtimeMode: input.runtimeMode } : {}),
    updatedAt: nowIso(),
  };
}

export const useKanbanStore = create<KanbanStoreState>()((set, get) => ({
  ...createInitialKanbanStoreState(),
  loadKanbanSnapshot: async (boardIdToLoad) => {
    set((state) => ({
      loadingBoardIds: {
        ...state.loadingBoardIds,
        [boardIdToLoad]: true,
      },
      errorByBoardId: {
        ...state.errorByBoardId,
        [boardIdToLoad]: undefined,
      },
    }));
    try {
      const snapshot = await ensureNativeApi().kanban.getSnapshot({ boardId: boardIdToLoad });
      set((state) => ({
        snapshotsByBoardId: {
          ...state.snapshotsByBoardId,
          [boardIdToLoad]:
            (state.snapshotsByBoardId[boardIdToLoad]?.snapshotSequence ?? -1) >
            snapshot.snapshotSequence
              ? state.snapshotsByBoardId[boardIdToLoad]
              : snapshot,
        },
        loadingBoardIds: {
          ...state.loadingBoardIds,
          [boardIdToLoad]: false,
        },
      }));
    } catch (error) {
      set((state) => ({
        loadingBoardIds: {
          ...state.loadingBoardIds,
          [boardIdToLoad]: false,
        },
        errorByBoardId: {
          ...state.errorByBoardId,
          [boardIdToLoad]: error instanceof Error ? error.message : String(error),
        },
      }));
      throw error;
    }
  },
  subscribeKanbanBoard: async (boardIdToSubscribe) => {
    const api = ensureNativeApi();
    const releaseBoardSubscription = async () => {
      const current = get();
      const currentCount = current.subscriptionCountByBoardId[boardIdToSubscribe] ?? 0;
      if (currentCount <= 0) {
        return;
      }
      const nextCount = Math.max(
        currentCount - 1,
        0,
      );
      if (nextCount > 0) {
        set((state) => ({
          subscriptionCountByBoardId: {
            ...state.subscriptionCountByBoardId,
            [boardIdToSubscribe]: nextCount,
          },
          subscribedBoardIds: {
            ...state.subscribedBoardIds,
            [boardIdToSubscribe]: true,
          },
        }));
        return;
      }

      const removeBoardEventListener =
        current.removeBoardEventListenerByBoardId[boardIdToSubscribe];
      set((state) => ({
        subscribedBoardIds: {
          ...state.subscribedBoardIds,
          [boardIdToSubscribe]: false,
        },
        subscriptionCountByBoardId: {
          ...state.subscriptionCountByBoardId,
          [boardIdToSubscribe]: 0,
        },
        removeBoardEventListenerByBoardId: {
          ...state.removeBoardEventListenerByBoardId,
          [boardIdToSubscribe]: undefined,
        },
      }));
      removeBoardEventListener?.();
      await api.kanban.unsubscribeBoard({ boardId: boardIdToSubscribe });
    };
    const currentSubscriptionCount = get().subscriptionCountByBoardId[boardIdToSubscribe] ?? 0;
    const pendingSubscription = pendingBoardSubscriptionByBoardId.get(boardIdToSubscribe);
    if (currentSubscriptionCount > 0) {
      set((state) => ({
        subscriptionCountByBoardId: {
          ...state.subscriptionCountByBoardId,
          [boardIdToSubscribe]: currentSubscriptionCount + 1,
        },
        subscribedBoardIds: {
          ...state.subscribedBoardIds,
          [boardIdToSubscribe]: true,
        },
      }));
      if (pendingSubscription) {
        await pendingSubscription;
      }
      let unsubscribed = false;
      return async () => {
        if (unsubscribed) {
          return;
        }
        unsubscribed = true;
        await releaseBoardSubscription();
      };
    }

    const removeBoardEventListener = api.kanban.onBoardEvent((event) => {
      get().applyKanbanBoardEvent(event);
    });
    set((state) => ({
      subscribedBoardIds: {
        ...state.subscribedBoardIds,
        [boardIdToSubscribe]: true,
      },
      subscriptionCountByBoardId: {
        ...state.subscriptionCountByBoardId,
        [boardIdToSubscribe]: 1,
      },
      removeBoardEventListenerByBoardId: {
        ...state.removeBoardEventListenerByBoardId,
        [boardIdToSubscribe]: removeBoardEventListener,
      },
    }));
    const subscribePromise = api.kanban.subscribeBoard({ boardId: boardIdToSubscribe });
    pendingBoardSubscriptionByBoardId.set(boardIdToSubscribe, subscribePromise);
    try {
      await subscribePromise;
    } catch (error) {
      pendingBoardSubscriptionByBoardId.delete(boardIdToSubscribe);
      removeBoardEventListener();
      set((state) => ({
        subscribedBoardIds: {
          ...state.subscribedBoardIds,
          [boardIdToSubscribe]: false,
        },
        subscriptionCountByBoardId: {
          ...state.subscriptionCountByBoardId,
          [boardIdToSubscribe]: 0,
        },
        removeBoardEventListenerByBoardId: {
          ...state.removeBoardEventListenerByBoardId,
          [boardIdToSubscribe]: undefined,
        },
      }));
      throw error;
    }
    if (pendingBoardSubscriptionByBoardId.get(boardIdToSubscribe) === subscribePromise) {
      pendingBoardSubscriptionByBoardId.delete(boardIdToSubscribe);
    }

    let unsubscribed = false;
    return async () => {
      if (unsubscribed) {
        return;
      }
      unsubscribed = true;
      await releaseBoardSubscription();
    };
  },
  createKanbanBoard: async (input) => {
    await ensureNativeApi().kanban.dispatchCommand(createBoardCommand(input));
  },
  createKanbanCard: async (input) => {
    await ensureNativeApi().kanban.dispatchCommand(createCardCommand(input));
  },
  updateKanbanCard: async (input) => {
    await ensureNativeApi().kanban.dispatchCommand(createCardUpdateCommand(input));
  },
  applyKanbanBoardEvent: (event) => {
    set((state) => {
      let changed = false;
      const snapshotsByBoardId = { ...state.snapshotsByBoardId };
      for (const [snapshotBoardId, snapshot] of Object.entries(state.snapshotsByBoardId)) {
        if (!snapshot) {
          continue;
        }
        const nextSnapshot = applyKanbanEventToSnapshot(snapshot, event);
        if (nextSnapshot !== snapshot) {
          snapshotsByBoardId[snapshotBoardId] = nextSnapshot;
          changed = true;
        }
      }
      return changed ? { snapshotsByBoardId } : state;
    });
  },
}));
