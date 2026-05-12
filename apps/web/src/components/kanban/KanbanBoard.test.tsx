import { describe, expect, it } from "vitest";

import { KanbanBoard } from "./KanbanBoard";
import { KanbanCard } from "./KanbanCard";
import { KanbanCardDetailPanel } from "./KanbanCardDetailPanel";

describe("Kanban board components", () => {
  it("exports the board component surface", () => {
    expect(KanbanBoard).toBeTypeOf("function");
    expect(KanbanCard).toBeTypeOf("function");
    expect(KanbanCardDetailPanel).toBeTypeOf("function");
  });
});
