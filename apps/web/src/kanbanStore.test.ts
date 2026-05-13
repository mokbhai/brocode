import {
  type EventId,
  type KanbanBoard,
  type KanbanBoardId,
  type KanbanBoardSnapshot,
  type KanbanCard,
  type KanbanCardId,
  type KanbanEvent,
  type KanbanTask,
  type KanbanTaskId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyKanbanEventToSnapshot,
  createInitialKanbanStoreState,
  groupKanbanCardsByStatus,
  selectCardsByStatus,
  useKanbanStore,
} from "./kanbanStore";

const boardId = "board-1" as KanbanBoardId;
const cardId = "card-1" as KanbanCardId;
const taskId = "task-1" as KanbanTaskId;
const projectId = "project-1" as ProjectId;
const now = "2026-05-12T00:00:00.000Z";

function makeBoard(overrides: Partial<KanbanBoard> = {}): KanbanBoard {
  return {
    id: boardId,
    projectId,
    title: "Project Board",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCard(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: cardId,
    boardId,
    projectId,
    sourceThreadId: null,
    workerThreadIds: [],
    reviewerThreadIds: [],
    title: "Implement store",
    description: "Add the Kanban store",
    status: "ready",
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    runtimeMode: "full-access",
    branch: null,
    worktreePath: null,
    associatedWorktreePath: null,
    associatedWorktreeBranch: null,
    associatedWorktreeRef: null,
    blockerReason: null,
    loopCount: 0,
    maxLoopCount: 3,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: taskId,
    cardId,
    title: "Wire store",
    status: "todo",
    order: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<KanbanBoardSnapshot> = {}): KanbanBoardSnapshot {
  const card = makeCard();
  const task = makeTask();
  return {
    snapshotSequence: 1,
    board: makeBoard(),
    cards: [card],
    tasksByCardId: {
      [card.id]: [task],
    },
    runsByCardId: {},
    reviewsByCardId: {},
    ...overrides,
  };
}

function makeEvent<TType extends KanbanEvent["type"]>(
  type: TType,
  payload: Extract<KanbanEvent, { type: TType }>["payload"],
  sequence = 2,
): Extract<KanbanEvent, { type: TType }> {
  return {
    type,
    payload,
    sequence,
    eventId: `event-${sequence}` as EventId,
    aggregateKind: type === "kanban.board.created" ? "board" : "card",
    aggregateId: type === "kanban.board.created" ? boardId : cardId,
    occurredAt: now,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
  } as Extract<KanbanEvent, { type: TType }>;
}

describe("kanbanStore selectors", () => {
  it("selects cards by status from a snapshot", () => {
    const draftCard = makeCard({ id: "card-draft" as KanbanCardId, status: "draft" });
    const readyCard = makeCard({ id: "card-ready" as KanbanCardId, status: "ready" });
    const snapshot = makeSnapshot({
      cards: [draftCard, readyCard],
      tasksByCardId: {},
    });

    expect(selectCardsByStatus(snapshot, "ready")).toEqual([readyCard]);
    expect(selectCardsByStatus(snapshot, "implementing")).toEqual([]);
  });

  it("groups cards by Kanban status without mutating the snapshot", () => {
    const draftCard = makeCard({ id: "card-draft" as KanbanCardId, status: "draft" });
    const readyCard = makeCard({ id: "card-ready" as KanbanCardId, status: "ready" });
    const approvedCard = makeCard({ id: "card-approved" as KanbanCardId, status: "approved" });
    const snapshot = makeSnapshot({
      cards: [readyCard, draftCard, approvedCard],
      tasksByCardId: {},
    });

    const grouped = groupKanbanCardsByStatus(snapshot);

    expect(grouped.draft).toEqual([draftCard]);
    expect(grouped.ready).toEqual([readyCard]);
    expect(grouped.approved).toEqual([approvedCard]);
    expect(grouped.blocked).toEqual([]);
    expect(snapshot.cards).toEqual([readyCard, draftCard, approvedCard]);
  });
});

describe("kanbanStore state", () => {
  let boardEventListener: ((event: KanbanEvent) => void) | null = null;
  const unsubscribeBoardEvent = vi.fn();
  const getSnapshot = vi.fn();
  const dispatchCommand = vi.fn();
  const subscribeBoard = vi.fn();
  const unsubscribeBoard = vi.fn();

  beforeEach(() => {
    boardEventListener = null;
    unsubscribeBoardEvent.mockReset();
    getSnapshot.mockReset();
    dispatchCommand.mockReset();
    subscribeBoard.mockReset();
    unsubscribeBoard.mockReset();
    useKanbanStore.setState(createInitialKanbanStoreState());
    vi.stubGlobal("window", {
      nativeApi: {
        kanban: {
          getSnapshot,
          dispatchCommand,
          subscribeBoard,
          unsubscribeBoard,
          onBoardEvent: vi.fn((callback: (event: KanbanEvent) => void) => {
            boardEventListener = callback;
            return unsubscribeBoardEvent;
          }),
        },
      },
    });
  });

  it("loads and stores a board snapshot", async () => {
    const snapshot = makeSnapshot();
    getSnapshot.mockResolvedValue(snapshot);

    await useKanbanStore.getState().loadKanbanSnapshot(boardId);

    expect(getSnapshot).toHaveBeenCalledWith({ boardId });
    expect(useKanbanStore.getState().snapshotsByBoardId[boardId]).toEqual(snapshot);
    expect(useKanbanStore.getState().loadingBoardIds[boardId]).toBe(false);
  });

  it("does not replace a newer local snapshot with an older in-flight load", async () => {
    let resolveSnapshot: (snapshot: KanbanBoardSnapshot) => void = () => {};
    getSnapshot.mockReturnValue(
      new Promise<KanbanBoardSnapshot>((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    const loadPromise = useKanbanStore.getState().loadKanbanSnapshot(boardId);
    const freshSnapshot = makeSnapshot({
      snapshotSequence: 5,
      cards: [makeCard({ title: "Fresh event-applied title" })],
    });
    useKanbanStore.setState({
      snapshotsByBoardId: {
        [boardId]: freshSnapshot,
      },
    });
    resolveSnapshot(
      makeSnapshot({
        snapshotSequence: 4,
        cards: [makeCard({ title: "Older loaded title" })],
      }),
    );

    await loadPromise;

    expect(useKanbanStore.getState().snapshotsByBoardId[boardId]).toBe(freshSnapshot);
    expect(useKanbanStore.getState().loadingBoardIds[boardId]).toBe(false);
  });

  it("subscribes to board events and applies status updates locally", async () => {
    const snapshot = makeSnapshot();
    getSnapshot.mockResolvedValue(snapshot);
    subscribeBoard.mockResolvedValue(undefined);
    unsubscribeBoard.mockResolvedValue(undefined);

    await useKanbanStore.getState().loadKanbanSnapshot(boardId);
    const unsubscribe = await useKanbanStore.getState().subscribeKanbanBoard(boardId);
    boardEventListener?.(
      makeEvent("kanban.card.status-changed", {
        cardId,
        fromStatus: "ready",
        toStatus: "implementing",
        reason: null,
        updatedAt: "2026-05-12T01:00:00.000Z",
      }),
    );

    const card = useKanbanStore.getState().snapshotsByBoardId[boardId]?.cards[0];
    expect(subscribeBoard).toHaveBeenCalledWith({ boardId });
    expect(card?.status).toBe("implementing");
    expect(card?.updatedAt).toBe("2026-05-12T01:00:00.000Z");

    await unsubscribe();

    expect(unsubscribeBoard).toHaveBeenCalledWith({ boardId });
    expect(unsubscribeBoardEvent).toHaveBeenCalledTimes(1);
  });

  it("applies representative card and task events to snapshots", () => {
    const snapshot = makeSnapshot();
    const newTask = makeTask({
      id: "task-2" as KanbanTaskId,
      title: "Add tests",
      status: "in_progress",
      order: 1,
    });
    const afterTask = applyKanbanEventToSnapshot(
      snapshot,
      makeEvent("kanban.task.upserted", { task: newTask }),
    );
    const afterDelete = applyKanbanEventToSnapshot(
      afterTask,
      makeEvent(
        "kanban.task.deleted",
        {
          cardId,
          taskId,
          deletedAt: "2026-05-12T01:00:00.000Z",
        },
        3,
      ),
    );
    const afterBlocked = applyKanbanEventToSnapshot(
      afterDelete,
      makeEvent(
        "kanban.card.blocked",
        {
          cardId,
          reason: "Needs product decision",
          blockedAt: "2026-05-12T02:00:00.000Z",
        },
        4,
      ),
    );
    const afterAgentError = applyKanbanEventToSnapshot(
      afterBlocked,
      makeEvent(
        "kanban.card.status-changed",
        {
          cardId,
          fromStatus: "implementing",
          toStatus: "agent_error",
          reason: "Worker summary was malformed",
          updatedAt: "2026-05-12T03:00:00.000Z",
        },
        5,
      ),
    );

    expect(afterTask.tasksByCardId[cardId]?.map((task) => task.id)).toEqual([taskId, newTask.id]);
    expect(afterDelete.tasksByCardId[cardId]?.map((task) => task.id)).toEqual([newTask.id]);
    expect(afterBlocked.cards[0]?.status).toBe("blocked");
    expect(afterBlocked.cards[0]?.blockerReason).toBe("Needs product decision");
    expect(afterAgentError.cards[0]?.status).toBe("agent_error");
    expect(afterAgentError.cards[0]?.blockerReason).toBe("Worker summary was malformed");
  });

  it("strips legacy specPath from streamed card events before updating snapshots", () => {
    const snapshot = makeSnapshot();
    const next = applyKanbanEventToSnapshot(
      snapshot,
      makeEvent("kanban.card.updated", {
        card: {
          ...makeCard({ title: "Updated from legacy event" }),
          specPath: "docs/legacy-spec.md",
        },
      }),
    );

    expect(next.cards[0]?.title).toBe("Updated from legacy event");
    expect("specPath" in next.cards[0]!).toBe(false);
  });

  it("ignores card events that do not belong to the snapshot", () => {
    const snapshot = makeSnapshot();

    const next = applyKanbanEventToSnapshot(
      snapshot,
      makeEvent("kanban.card.status-changed", {
        cardId: "other-card" as KanbanCardId,
        fromStatus: "ready",
        toStatus: "implementing",
        reason: null,
        updatedAt: "2026-05-12T01:00:00.000Z",
      }),
    );

    expect(next).toBe(snapshot);
  });

  it("ignores replayed events already covered by the loaded snapshot sequence", () => {
    const freshCard = makeCard({
      title: "Fresh snapshot title",
      updatedAt: "2026-05-12T02:00:00.000Z",
    });
    const snapshot = makeSnapshot({
      snapshotSequence: 5,
      cards: [freshCard],
    });

    const next = applyKanbanEventToSnapshot(
      snapshot,
      makeEvent(
        "kanban.card.updated",
        {
          card: makeCard({
            title: "Stale replay title",
            updatedAt: "2026-05-12T01:00:00.000Z",
          }),
        },
        5,
      ),
    );

    expect(next).toBe(snapshot);
    expect(next.cards[0]?.title).toBe("Fresh snapshot title");
  });

  it("reference-counts duplicate board subscriptions", async () => {
    subscribeBoard.mockResolvedValue(undefined);
    unsubscribeBoard.mockResolvedValue(undefined);

    const unsubscribeFirst = await useKanbanStore.getState().subscribeKanbanBoard(boardId);
    const unsubscribeSecond = await useKanbanStore.getState().subscribeKanbanBoard(boardId);

    expect(subscribeBoard).toHaveBeenCalledTimes(1);
    expect(useKanbanStore.getState().subscriptionCountByBoardId[boardId]).toBe(2);

    await unsubscribeFirst();
    await unsubscribeFirst();

    expect(unsubscribeBoard).not.toHaveBeenCalled();
    expect(unsubscribeBoardEvent).not.toHaveBeenCalled();
    expect(useKanbanStore.getState().subscribedBoardIds[boardId]).toBe(true);
    expect(useKanbanStore.getState().subscriptionCountByBoardId[boardId]).toBe(1);

    await unsubscribeSecond();

    expect(unsubscribeBoard).toHaveBeenCalledTimes(1);
    expect(unsubscribeBoard).toHaveBeenCalledWith({ boardId });
    expect(unsubscribeBoardEvent).toHaveBeenCalledTimes(1);
    expect(useKanbanStore.getState().subscribedBoardIds[boardId]).toBe(false);
    expect(useKanbanStore.getState().subscriptionCountByBoardId[boardId]).toBe(0);
  });

  it("coalesces concurrent board subscriptions into one native subscription", async () => {
    let resolveSubscribe: () => void = () => {};
    subscribeBoard.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSubscribe = resolve;
      }),
    );
    unsubscribeBoard.mockResolvedValue(undefined);

    const firstSubscribe = useKanbanStore.getState().subscribeKanbanBoard(boardId);
    const secondSubscribe = useKanbanStore.getState().subscribeKanbanBoard(boardId);

    expect(subscribeBoard).toHaveBeenCalledTimes(1);
    expect(useKanbanStore.getState().subscriptionCountByBoardId[boardId]).toBe(2);

    resolveSubscribe();
    const [unsubscribeFirst, unsubscribeSecond] = await Promise.all([
      firstSubscribe,
      secondSubscribe,
    ]);

    await unsubscribeFirst();

    expect(unsubscribeBoard).not.toHaveBeenCalled();
    expect(unsubscribeBoardEvent).not.toHaveBeenCalled();
    expect(useKanbanStore.getState().subscriptionCountByBoardId[boardId]).toBe(1);

    await unsubscribeSecond();

    expect(unsubscribeBoard).toHaveBeenCalledTimes(1);
    expect(unsubscribeBoardEvent).toHaveBeenCalledTimes(1);
    expect(useKanbanStore.getState().subscriptionCountByBoardId[boardId]).toBe(0);
  });

  it("clears local subscription state before surfacing native unsubscribe failures", async () => {
    subscribeBoard.mockResolvedValue(undefined);
    unsubscribeBoard.mockRejectedValue(new Error("native unsubscribe failed"));

    const unsubscribe = await useKanbanStore.getState().subscribeKanbanBoard(boardId);

    await expect(unsubscribe()).rejects.toThrow("native unsubscribe failed");

    expect(unsubscribeBoardEvent).toHaveBeenCalledTimes(1);
    expect(useKanbanStore.getState().subscribedBoardIds[boardId]).toBe(false);
    expect(useKanbanStore.getState().subscriptionCountByBoardId[boardId]).toBe(0);
    expect(useKanbanStore.getState().removeBoardEventListenerByBoardId[boardId]).toBeUndefined();
  });

  it("dispatches create-card and card-update commands without public task or worktree inputs", async () => {
    dispatchCommand.mockResolvedValue({ sequence: 4 });

    await useKanbanStore.getState().createKanbanBoard({
      boardId,
      projectId,
      title: "Project Board",
    });
    await useKanbanStore.getState().createKanbanCard({
      boardId,
      cardId,
      projectId,
      sourceThreadId: "thread-1" as ThreadId,
      title: "Implement Kanban UI",
      modelSelection: { provider: "codex", model: "gpt-5-codex" },
      runtimeMode: "full-access",
    });
    await useKanbanStore.getState().updateKanbanCard({
      cardId,
      title: "Implement Kanban board UI",
      description: null,
      runtimeMode: "approval-required",
    });

    const commands = dispatchCommand.mock.calls.map(([command]) => command);
    expect(commands[0]).toMatchObject({
      type: "kanban.board.create",
      boardId,
      projectId,
      title: "Project Board",
    });
    expect(commands[1]).toMatchObject({
      type: "kanban.card.create",
      boardId,
      cardId,
      projectId,
      title: "Implement Kanban UI",
      sourceThreadId: "thread-1",
    });
    expect(commands[1]).not.toHaveProperty("tasks");
    expect(commands[1]).not.toHaveProperty("specPath");
    expect(commands[1]).not.toHaveProperty("branch");
    expect(commands[1]).not.toHaveProperty("worktreePath");
    expect(commands[1]).not.toHaveProperty("associatedWorktreePath");
    expect(commands[1]).not.toHaveProperty("associatedWorktreeBranch");
    expect(commands[1]).not.toHaveProperty("associatedWorktreeRef");
    expect(commands[2]).toMatchObject({
      type: "kanban.card.update",
      cardId,
      title: "Implement Kanban board UI",
      description: null,
      runtimeMode: "approval-required",
    });
    expect(commands[2]).not.toHaveProperty("specPath");
    expect(dispatchCommand).toHaveBeenCalledTimes(3);
  });

  it("does not expose public task mutation actions from the web store", () => {
    const state = useKanbanStore.getState();

    expect(state).not.toHaveProperty("upsertKanbanTask");
    expect(state).not.toHaveProperty("deleteKanbanTask");
  });
});
