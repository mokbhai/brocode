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
  type KanbanReview,
  type KanbanRun,
  type KanbanTask,
  type KanbanTaskId,
  type KanbanTaskStatus,
  type ModelSelection,
  type ProjectId,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import { create } from "zustand";

import { ensureNativeApi } from "./nativeApi";

export const KANBAN_CARD_STATUSES: readonly KanbanCardStatus[] = [
  "draft",
  "ready",
  "implementing",
  "reviewing",
  "needs_work",
  "approved",
  "ready_to_submit",
  "submitted",
  "blocked",
  "loop_limit_reached",
  "agent_error",
  "review_inconclusive",
];

export type KanbanCardsByStatus = Record<KanbanCardStatus, KanbanCard[]>;

export interface CreateKanbanCardTaskInput {
  taskId?: KanbanTaskId;
  title: string;
  description?: string;
  status?: KanbanTaskStatus;
  order?: number;
}

export interface CreateKanbanCardInput {
  boardId: KanbanBoardId;
  cardId?: KanbanCardId;
  projectId: ProjectId;
  sourceThreadId?: ThreadId | null;
  title: string;
  description?: string;
  specPath?: string;
  tasks?: readonly CreateKanbanCardTaskInput[];
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  branch?: string | null;
  worktreePath?: string | null;
  associatedWorktreePath?: string | null;
  associatedWorktreeBranch?: string | null;
  associatedWorktreeRef?: string | null;
}

export interface UpsertKanbanTaskInput {
  cardId: KanbanCardId;
  taskId?: KanbanTaskId;
  title: string;
  description?: string;
  status?: KanbanTaskStatus;
  order?: number;
}

export interface KanbanStoreData {
  snapshotsByBoardId: Record<string, KanbanBoardSnapshot | undefined>;
  loadingBoardIds: Record<string, boolean | undefined>;
  errorByBoardId: Record<string, string | undefined>;
  subscribedBoardIds: Record<string, boolean | undefined>;
}

export interface KanbanStoreState extends KanbanStoreData {
  loadKanbanSnapshot: (boardId: KanbanBoardId) => Promise<void>;
  subscribeKanbanBoard: (boardId: KanbanBoardId) => Promise<() => Promise<void>>;
  createKanbanCard: (input: CreateKanbanCardInput) => Promise<void>;
  upsertKanbanTask: (input: UpsertKanbanTaskInput) => Promise<void>;
  applyKanbanBoardEvent: (event: KanbanEvent) => void;
}

export function createInitialKanbanStoreState(): KanbanStoreData {
  return {
    snapshotsByBoardId: {},
    loadingBoardIds: {},
    errorByBoardId: {},
    subscribedBoardIds: {},
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

function taskId(): KanbanTaskId {
  return randomId("kanban-task") as KanbanTaskId;
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
      return {
        ...next,
        cards: upsertById(next.cards, event.payload.card),
        tasksByCardId: {
          ...next.tasksByCardId,
          [event.payload.card.id]: event.payload.tasks,
        },
      };
    }

    case "kanban.card.updated":
      return event.payload.card.boardId === snapshot.board.id
        ? {
            ...withEventSequence(snapshot, event),
            cards: upsertById(snapshot.cards, event.payload.card),
          }
        : snapshot;

    case "kanban.card.status-changed":
      if (!snapshotHasCard(snapshot, event.payload.cardId)) {
        return snapshot;
      }
      return updateCard(withEventSequence(snapshot, event), event.payload.cardId, {
        status: event.payload.toStatus,
        blockerReason: event.payload.toStatus === "blocked" ? event.payload.reason : null,
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
    ...(input.specPath ? { specPath: input.specPath } : {}),
    tasks: (input.tasks ?? []).map((task, index) => ({
      taskId: task.taskId ?? taskId(),
      title: task.title,
      ...(task.description ? { description: task.description } : {}),
      status: task.status ?? "todo",
      order: task.order ?? index,
    })),
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    branch: input.branch ?? null,
    worktreePath: input.worktreePath ?? null,
    associatedWorktreePath: input.associatedWorktreePath ?? null,
    associatedWorktreeBranch: input.associatedWorktreeBranch ?? null,
    associatedWorktreeRef: input.associatedWorktreeRef ?? null,
    createdAt,
  };
}

function createTaskUpsertCommand(input: UpsertKanbanTaskInput): ClientKanbanCommand {
  const updatedAt = nowIso();
  return {
    type: "kanban.task.upsert",
    commandId: commandId(),
    cardId: input.cardId,
    task: {
      taskId: input.taskId ?? taskId(),
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      status: input.status ?? "todo",
      order: input.order ?? 0,
    },
    updatedAt,
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
          [boardIdToLoad]: snapshot,
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
    const removeBoardEventListener = api.kanban.onBoardEvent((event) => {
      get().applyKanbanBoardEvent(event);
    });
    try {
      await api.kanban.subscribeBoard({ boardId: boardIdToSubscribe });
    } catch (error) {
      removeBoardEventListener();
      throw error;
    }
    set((state) => ({
      subscribedBoardIds: {
        ...state.subscribedBoardIds,
        [boardIdToSubscribe]: true,
      },
    }));

    return async () => {
      removeBoardEventListener();
      await api.kanban.unsubscribeBoard({ boardId: boardIdToSubscribe });
      set((state) => ({
        subscribedBoardIds: {
          ...state.subscribedBoardIds,
          [boardIdToSubscribe]: false,
        },
      }));
    };
  },
  createKanbanCard: async (input) => {
    await ensureNativeApi().kanban.dispatchCommand(createCardCommand(input));
  },
  upsertKanbanTask: async (input) => {
    await ensureNativeApi().kanban.dispatchCommand(createTaskUpsertCommand(input));
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
