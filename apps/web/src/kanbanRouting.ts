import type { KanbanBoardId, ProjectId } from "@t3tools/contracts";

export function getProjectKanbanBoardId(projectId: ProjectId): KanbanBoardId {
  return `project-kanban-board:${projectId}` as KanbanBoardId;
}
