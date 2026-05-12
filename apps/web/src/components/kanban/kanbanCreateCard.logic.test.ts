import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_RUNTIME_MODE,
  type KanbanBoardId,
  type ModelSelection,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildCreateKanbanCardInput } from "./kanbanCreateCard.logic";

const boardId = "board-1" as KanbanBoardId;
const projectId = "project-1" as ProjectId;

describe("buildCreateKanbanCardInput", () => {
  it("builds a create-from-thread payload and preserves model/runtime contract fields", () => {
    const modelSelection = {
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
    } satisfies ModelSelection;

    const input = buildCreateKanbanCardInput({
      boardId,
      projectId,
      mode: "thread",
      title: "Implement review loop",
      sourceThreadId: "thread-1" as ThreadId,
      specPath: "docs/review-loop.md",
      modelSelection,
      runtimeMode: "approval-required",
      tasks: [
        {
          title: "Add task list",
          description: "Render persisted tasks",
          status: "in_progress",
        },
      ],
    });

    expect(input).toMatchObject({
      boardId,
      projectId,
      sourceThreadId: "thread-1",
      title: "Implement review loop",
      specPath: "docs/review-loop.md",
      modelSelection,
      runtimeMode: "approval-required",
      tasks: [
        {
          title: "Add task list",
          description: "Render persisted tasks",
          status: "in_progress",
          order: 0,
        },
      ],
    });
  });

  it("builds a create-from-spec-path payload with default codex model and runtime", () => {
    const input = buildCreateKanbanCardInput({
      boardId,
      projectId,
      mode: "specPath",
      title: "Build card creation",
      specPath: "docs/kanban-card-creation.md",
      tasksText: "Create dialog\n\nShape payloads",
    });

    expect(input).toMatchObject({
      boardId,
      projectId,
      sourceThreadId: null,
      title: "Build card creation",
      specPath: "docs/kanban-card-creation.md",
      modelSelection: {
        provider: "codex",
        model: DEFAULT_MODEL_BY_PROVIDER.codex,
      },
      runtimeMode: DEFAULT_RUNTIME_MODE,
      tasks: [
        { title: "Create dialog", status: "todo", order: 0 },
        { title: "Shape payloads", status: "todo", order: 1 },
      ],
    });
  });

  it("builds a manual inline spec payload with deterministic placeholder path", () => {
    const input = buildCreateKanbanCardInput({
      boardId,
      projectId,
      mode: "manual",
      title: "Polish empty state",
      inlineSpec: "Make the no-card column easier to scan.",
      tasksText: "- Tighten copy\n- Keep layout stable",
    });

    expect(input.specPath).toBe("inline-spec.md");
    expect(input.description).toBe("Inline spec:\n\nMake the no-card column easier to scan.");
    expect(input.tasks).toEqual([
      { title: "Tighten copy", status: "todo", order: 0 },
      { title: "Keep layout stable", status: "todo", order: 1 },
    ]);
  });

  it("rejects empty required fields before dispatch", () => {
    expect(() =>
      buildCreateKanbanCardInput({
        boardId,
        projectId,
        mode: "specPath",
        title: " ",
        specPath: "docs/spec.md",
      }),
    ).toThrow("Title is required");

    expect(() =>
      buildCreateKanbanCardInput({
        boardId,
        projectId,
        mode: "manual",
        title: "Manual card",
        inlineSpec: " ",
      }),
    ).toThrow("Inline spec is required");
  });
});
