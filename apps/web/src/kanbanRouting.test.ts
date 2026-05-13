import type { KanbanBoardId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { getProjectKanbanBoardId } from "./kanbanRouting";

describe("getProjectKanbanBoardId", () => {
  it("derives a stable project-scoped board id", () => {
    const projectId = "project-1" as ProjectId;

    const boardId: KanbanBoardId = getProjectKanbanBoardId(projectId);

    expect(boardId).toBe("project-kanban-board:project-1");
    expect(boardId).toBe(getProjectKanbanBoardId(projectId));
  });

  it("keeps different projects on different boards", () => {
    const firstBoardId = getProjectKanbanBoardId("project-1" as ProjectId);
    const secondBoardId = getProjectKanbanBoardId("project-2" as ProjectId);

    expect(firstBoardId).not.toBe(secondBoardId);
  });
});
