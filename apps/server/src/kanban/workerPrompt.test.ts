import {
  KanbanBoardId,
  KanbanCardId,
  KanbanTaskId,
  ProjectId,
  type KanbanCard,
  type KanbanTask,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildKanbanWorkerPrompt } from "./workerPrompt.ts";

const now = "2026-05-12T00:00:00.000Z";
const cardId = KanbanCardId.makeUnsafe("card_1");
const boardId = KanbanBoardId.makeUnsafe("board_1");
const projectId = ProjectId.makeUnsafe("project_1");

const card: KanbanCard = {
  id: cardId,
  boardId,
  projectId,
  sourceThreadId: null,
  workerThreadIds: [],
  reviewerThreadIds: [],
  title: "Implement kanban orchestration",
  description: "Use docs/specs/kanban.md as the implementation spec.",
  status: "ready",
  modelSelection: { provider: "codex", model: "gpt-5" },
  runtimeMode: "approval-required",
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
};

const task: KanbanTask = {
  id: KanbanTaskId.makeUnsafe("task_1"),
  cardId,
  title: "Wire start RPC",
  description: "Expose the worker start command to the web app.",
  status: "in_progress",
  order: 0,
  createdAt: now,
  updatedAt: now,
};

describe("buildKanbanWorkerPrompt", () => {
  it("includes card context, worktree policy, existing tasks, and final JSON instructions", () => {
    const prompt = buildKanbanWorkerPrompt({
      card,
      tasks: [task],
      worktreePath: "/repo/.worktrees/card_1",
      branch: "kanban/card_1",
    });

    expect(prompt).toContain("Implement kanban orchestration");
    expect(prompt).toContain("Use docs/specs/kanban.md as the implementation spec.");
    expect(prompt).toContain("/repo/.worktrees/card_1");
    expect(prompt).toContain("kanban/card_1");
    expect(prompt).toContain("Runtime mode: approval-required");
    expect(prompt).toContain("task_1");
    expect(prompt).toContain("Wire start RPC");
    expect(prompt).toContain("Provider execution is managed by BroCode");
    expect(prompt).toContain("Do not ask for external model credentials");
    expect(prompt).toContain("```json");
    expect(prompt).toContain('"generatedTasks"');
    expect(prompt).toContain('"taskUpdates"');
  });

  it("asks the worker to generate the initial task list when no tasks exist", () => {
    const prompt = buildKanbanWorkerPrompt({
      card: { ...card, description: undefined },
      tasks: [],
      worktreePath: "/repo/.worktrees/card_1",
      branch: null,
    });

    expect(prompt).toContain("No existing generated tasks are recorded");
    expect(prompt).toContain("generate the initial to-do list");
    expect(prompt).toContain("Branch: (current worktree branch)");
  });
});
