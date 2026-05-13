import "../../index.css";

import type {
  KanbanBoard as KanbanBoardRecord,
  KanbanBoardId,
  KanbanBoardSnapshot,
  KanbanCard,
  KanbanCardId,
  KanbanReview,
  KanbanReviewId,
  KanbanRun,
  KanbanRunId,
  KanbanTask,
  KanbanTaskId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { useState } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { KanbanBoard } from "./KanbanBoard";

const boardId = "board-1" as KanbanBoardId;
const cardId = "card-1" as KanbanCardId;
const projectId = "project-1" as ProjectId;
const sourceThreadId = "thread-source-1" as ThreadId;
const workerThreadId = "thread-worker-1" as ThreadId;
const reviewerThreadId = "thread-reviewer-1" as ThreadId;
const now = "2026-05-12T00:00:00.000Z";

function makeBoard(): KanbanBoardRecord {
  return {
    id: boardId,
    projectId,
    title: "Agent delivery board",
    createdAt: now,
    updatedAt: now,
  };
}

function makeCard(): KanbanCard {
  return {
    id: cardId,
    boardId,
    projectId,
    sourceThreadId,
    workerThreadIds: [workerThreadId],
    reviewerThreadIds: [reviewerThreadId],
    title: "Implement board components",
    description: "Render columns, cards, and details.",
    status: "ready",
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    runtimeMode: "full-access",
    branch: "feat/kanban",
    worktreePath: null,
    associatedWorktreePath: null,
    associatedWorktreeBranch: null,
    associatedWorktreeRef: null,
    blockerReason: null,
    loopCount: 1,
    maxLoopCount: 3,
    createdAt: now,
    updatedAt: now,
  };
}

function makeTask(): KanbanTask {
  return {
    id: "task-1" as KanbanTaskId,
    cardId,
    title: "Create card summary",
    status: "done",
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function makeRun(): KanbanRun {
  return {
    id: "run-1" as KanbanRunId,
    cardId,
    role: "worker",
    status: "completed",
    threadId: workerThreadId,
    startedAt: now,
    completedAt: "2026-05-12T00:05:00.000Z",
  };
}

function makeReview(): KanbanReview {
  return {
    id: "review-1" as KanbanReviewId,
    cardId,
    runId: "run-1" as KanbanRunId,
    reviewerThreadId,
    outcome: "approved",
    summary: "Looks ready",
    findings: ["Covered the requested board surface"],
    completedAt: "2026-05-12T00:10:00.000Z",
  };
}

function makeSnapshot(): KanbanBoardSnapshot {
  const card = makeCard();
  const task = makeTask();
  return {
    snapshotSequence: 1,
    board: makeBoard(),
    cards: [card],
    tasksByCardId: {
      [card.id]: [task],
    },
    runsByCardId: {
      [card.id]: [makeRun()],
    },
    reviewsByCardId: {
      [card.id]: [makeReview()],
    },
  };
}

function KanbanBoardHarness(props: {
  readonly onCreateCard: ReturnType<typeof vi.fn>;
  readonly onOpenSourceThread: ReturnType<typeof vi.fn>;
  readonly onOpenReviewerThread: ReturnType<typeof vi.fn>;
  readonly onOpenWorkerThread: ReturnType<typeof vi.fn>;
  readonly onStartRun: ReturnType<typeof vi.fn>;
}) {
  const [selectedCardId, setSelectedCardId] = useState<KanbanCardId | null>(null);
  return (
    <KanbanBoard
      snapshot={makeSnapshot()}
      selectedCardId={selectedCardId}
      onSelectCard={(nextCardId) => setSelectedCardId(nextCardId)}
      onCreateCard={props.onCreateCard}
      onOpenSourceThread={props.onOpenSourceThread}
      onOpenReviewerThread={props.onOpenReviewerThread}
      onOpenWorkerThread={props.onOpenWorkerThread}
      onStartRun={props.onStartRun}
    />
  );
}

async function mountBoard() {
  const host = document.createElement("div");
  host.style.height = "720px";
  document.body.append(host);

  const onCreateCard = vi.fn();
  const onOpenSourceThread = vi.fn();
  const onOpenReviewerThread = vi.fn();
  const onOpenWorkerThread = vi.fn();
  const onStartRun = vi.fn();
  const screen = await render(
    <KanbanBoardHarness
      onCreateCard={onCreateCard}
      onOpenSourceThread={onOpenSourceThread}
      onOpenReviewerThread={onOpenReviewerThread}
      onOpenWorkerThread={onOpenWorkerThread}
      onStartRun={onStartRun}
    />,
    { container: host },
  );

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
    onCreateCard,
    onOpenSourceThread,
    onOpenReviewerThread,
    onOpenWorkerThread,
    onStartRun,
  };
}

describe("KanbanBoard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders columns, opens details, and wires primary callbacks", async () => {
    const mounted = await mountBoard();

    try {
      await expect
        .element(page.getByRole("heading", { name: "Ready", exact: true }))
        .toBeInTheDocument();
      await expect.element(page.getByText("Implement board components")).toBeInTheDocument();

      await page.getByLabelText("Create Kanban card").click();
      await expect.element(page.getByLabelText("Card source")).not.toBeInTheDocument();
      await expect.element(page.getByLabelText("Spec path")).not.toBeInTheDocument();
      await expect.element(page.getByLabelText("Initial tasks")).not.toBeInTheDocument();
      await page.getByLabelText("Title").fill("Create from board test");
      await page.getByLabelText("Description").fill("docs/browser-created-card.md");
      document.querySelector<HTMLFormElement>("form")?.requestSubmit();

      expect(mounted.onCreateCard).toHaveBeenCalledWith(
        expect.objectContaining({
          boardId,
          projectId,
          title: "Create from board test",
          description: "docs/browser-created-card.md",
        }),
      );
      expect(mounted.onCreateCard.mock.calls[0]?.[0]).not.toHaveProperty("specPath");
      expect(mounted.onCreateCard.mock.calls[0]?.[0]).not.toHaveProperty("tasks");

      await page.getByRole("button", { name: /Implement board components/ }).click();

      await expect.element(page.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();

      await page.getByRole("button", { name: /Start run/ }).click();
      await page.getByRole("button", { name: /Source thread/ }).click();
      await page.getByRole("button", { name: /Worker 1/ }).click();
      await page.getByRole("button", { name: /Reviewer 1/ }).click();

      expect(mounted.onStartRun).toHaveBeenCalledWith(expect.objectContaining({ id: cardId }));
      expect(mounted.onOpenSourceThread).toHaveBeenCalledWith(
        sourceThreadId,
        expect.objectContaining({ id: cardId }),
      );
      expect(mounted.onOpenWorkerThread).toHaveBeenCalledWith(
        workerThreadId,
        expect.objectContaining({ id: cardId }),
      );
      expect(mounted.onOpenReviewerThread).toHaveBeenCalledWith(
        reviewerThreadId,
        expect.objectContaining({ id: cardId }),
      );
      await expect
        .element(page.getByRole("button", { name: /Delete Create card summary/ }))
        .not.toBeInTheDocument();

      await page.getByLabelText("Close").click();
      await expect.element(page.getByText("docs/spec.md")).not.toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });
});
