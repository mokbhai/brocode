import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_RUNTIME_MODE,
  type KanbanBoardId,
  type ModelSelection,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildCreateKanbanCardInput,
  createDefaultKanbanModelSelection,
} from "./kanbanCreateCard.logic";

const boardId = "board-1" as KanbanBoardId;
const projectId = "project-1" as ProjectId;

describe("buildCreateKanbanCardInput", () => {
  it("builds a simple create-card payload from title, description, runtime, provider, and model", () => {
    const modelSelection = {
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
    } satisfies ModelSelection;

    const input = buildCreateKanbanCardInput({
      boardId,
      projectId,
      title: "Implement review loop",
      description: "Use the existing provider runtime.",
      modelSelection,
      runtimeMode: "approval-required",
    });

    expect(input).toEqual({
      boardId,
      projectId,
      sourceThreadId: null,
      title: "Implement review loop",
      description: "Use the existing provider runtime.",
      modelSelection,
      runtimeMode: "approval-required",
    });
  });

  it("keeps sourceThreadId only as hidden metadata and omits removed fields", () => {
    const modelSelection = createDefaultKanbanModelSelection();

    const input = buildCreateKanbanCardInput({
      boardId,
      projectId,
      title: "Create from current thread",
      sourceThreadId: "thread-1" as ThreadId,
      modelSelection,
      runtimeMode: DEFAULT_RUNTIME_MODE,
    });

    expect(input).toEqual({
      boardId,
      projectId,
      sourceThreadId: "thread-1",
      title: "Create from current thread",
      modelSelection,
      runtimeMode: DEFAULT_RUNTIME_MODE,
    });
    expect(input).not.toHaveProperty("tasks");
    expect(input).not.toHaveProperty("specPath");
    expect(input).not.toHaveProperty("branch");
    expect(input).not.toHaveProperty("worktreePath");
  });

  it("does not require source mode, spec path, inline spec, or initial tasks", () => {
    const input = buildCreateKanbanCardInput({
      boardId,
      projectId,
      title: "Build card creation",
      description: "docs/kanban-card-creation.md\n\nShape payloads in the worker prompt.",
      modelSelection: null,
      runtimeMode: null,
    });

    expect(input).toEqual({
      boardId,
      projectId,
      sourceThreadId: null,
      title: "Build card creation",
      description: "docs/kanban-card-creation.md\n\nShape payloads in the worker prompt.",
      modelSelection: {
        provider: "codex",
        model: DEFAULT_MODEL_BY_PROVIDER.codex,
      },
      runtimeMode: DEFAULT_RUNTIME_MODE,
    });
  });

  it("trims optional description and omits it when empty", () => {
    const input = buildCreateKanbanCardInput({
      boardId,
      projectId,
      title: "Polish empty state",
      description: "   ",
      modelSelection: createDefaultKanbanModelSelection(),
      runtimeMode: DEFAULT_RUNTIME_MODE,
    });

    expect(input).not.toHaveProperty("description");
  });

  it("rejects empty required fields before dispatch", () => {
    expect(() =>
      buildCreateKanbanCardInput({
        boardId,
        projectId,
        title: " ",
      }),
    ).toThrow("Title is required");
  });
});
