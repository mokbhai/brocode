import { KanbanCardId, KanbanTaskId, type KanbanTask } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { parseKanbanWorkerSummary } from "./workerSummary.ts";

const now = "2026-05-12T00:00:00.000Z";
const cardId = KanbanCardId.makeUnsafe("card_1");

const task = (id: string): KanbanTask => ({
  id: KanbanTaskId.makeUnsafe(id),
  cardId,
  title: `Task ${id}`,
  status: "todo",
  order: 0,
  createdAt: now,
  updatedAt: now,
});

describe("parseKanbanWorkerSummary", () => {
  it("extracts the last fenced json summary and validates generated tasks and task updates", () => {
    const parsed = parseKanbanWorkerSummary(
      [
        "Intermediate notes",
        "```json",
        JSON.stringify({ summary: "ignore this", generatedTasks: [], taskUpdates: [] }),
        "```",
        "Final result",
        "```json",
        JSON.stringify({
          summary: "Implemented the worker run contract.",
          generatedTasks: [
            {
              title: "  Add payload tests  ",
              description: "  Cover the RPC schema.  ",
              status: "done",
            },
          ],
          taskUpdates: [{ taskId: "task_1", status: "in_progress" }],
        }),
        "```",
      ].join("\n"),
      [task("task_1")],
    );

    expect(parsed).toEqual({
      summary: "Implemented the worker run contract.",
      generatedTasks: [
        {
          title: "Add payload tests",
          description: "Cover the RPC schema.",
          status: "done",
        },
      ],
      taskUpdates: [{ taskId: "task_1", status: "in_progress" }],
    });
  });

  it("uses the last fenced json block that contains a summary field", () => {
    const parsed = parseKanbanWorkerSummary(
      [
        "```json",
        JSON.stringify({ summary: "Use this", generatedTasks: [], taskUpdates: [] }),
        "```",
        "```json",
        JSON.stringify({ note: "not the final summary" }),
        "```",
      ].join("\n"),
      [],
    );

    expect(parsed.summary).toBe("Use this");
  });

  it("rejects malformed json even when an earlier summary block is valid", () => {
    expect(() =>
      parseKanbanWorkerSummary(
        [
          "```json",
          JSON.stringify({ summary: "Do not use", generatedTasks: [], taskUpdates: [] }),
          "```",
          "```json",
          "not-json",
          "```",
        ].join("\n"),
        [],
      ),
    ).toThrow(/json/i);
  });

  it("rejects malformed or incomplete summaries", () => {
    expect(() => parseKanbanWorkerSummary("No json here", [])).toThrow(/summary/i);
    expect(() => parseKanbanWorkerSummary("```json\nnot-json\n```", [])).toThrow(/json/i);
    expect(() => parseKanbanWorkerSummary("```json\n[]\n```", [])).toThrow(/object/i);
    expect(() => parseKanbanWorkerSummary("```json\n{}\n```", [])).toThrow(/summary/i);
    expect(() =>
      parseKanbanWorkerSummary('```json\n{"summary":"x","taskUpdates":[]}\n```', []),
    ).toThrow(/generatedTasks/i);
    expect(() =>
      parseKanbanWorkerSummary('```json\n{"summary":"x","generatedTasks":[]}\n```', []),
    ).toThrow(/taskUpdates/i);
  });

  it("rejects invalid generated tasks and task updates", () => {
    expect(() =>
      parseKanbanWorkerSummary(
        '```json\n{"summary":"x","generatedTasks":[{"title":" ","status":"todo"}],"taskUpdates":[]}\n```',
        [],
      ),
    ).toThrow(/generatedTasks/i);

    expect(() =>
      parseKanbanWorkerSummary(
        '```json\n{"summary":"x","generatedTasks":[{"title":"Valid","status":"unknown"}],"taskUpdates":[]}\n```',
        [],
      ),
    ).toThrow(/status/i);

    expect(() =>
      parseKanbanWorkerSummary(
        '```json\n{"summary":"x","generatedTasks":[],"taskUpdates":[{"taskId":"missing","status":"done"}]}\n```',
        [task("task_1")],
      ),
    ).toThrow(/unknown task/i);

    expect(() =>
      parseKanbanWorkerSummary(
        '```json\n{"summary":"x","generatedTasks":[],"taskUpdates":[{"taskId":"task_1","status":"unknown"}]}\n```',
        [task("task_1")],
      ),
    ).toThrow(/status/i);
  });
});
