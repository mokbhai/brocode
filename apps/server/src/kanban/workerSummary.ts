import { KanbanTaskStatus, type KanbanTask, type KanbanTaskId } from "@t3tools/contracts";
import { Schema } from "effect";

export type ParsedKanbanWorkerSummary = {
  readonly summary: string;
  readonly generatedTasks: ReadonlyArray<{
    readonly title: string;
    readonly description?: string;
    readonly status: KanbanTaskStatus;
  }>;
  readonly taskUpdates: ReadonlyArray<{
    readonly taskId: KanbanTaskId;
    readonly status: KanbanTaskStatus;
  }>;
};

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseStatus(value: unknown, label: string): KanbanTaskStatus {
  const decoded = Schema.decodeUnknownOption(KanbanTaskStatus)(value);
  if (decoded._tag === "None") {
    throw new Error(`${label} has invalid status`);
  }
  return decoded.value;
}

function optionalTrimmed(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function requiredTrimmed(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function extractJsonBlocks(text: string): string[] {
  return [...text.matchAll(/```json\s*([\s\S]*?)```/gi)].map((match) => match[1] ?? "");
}

function parseSummaryBlock(blocks: readonly string[]): Record<string, unknown> {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(blocks[index]!);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && "summary" in parsed) {
        return parsed as Record<string, unknown>;
      }
    } catch (error) {
      throw new Error(
        `Worker summary JSON is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  throw new Error("Worker summary must include an object with summary");
}

export function parseKanbanWorkerSummary(
  text: string,
  tasks: readonly KanbanTask[],
): ParsedKanbanWorkerSummary {
  const blocks = extractJsonBlocks(text);
  if (blocks.length === 0) {
    throw new Error("Worker summary must include a fenced json summary block");
  }

  const record = assertRecord(parseSummaryBlock(blocks), "Worker summary");
  const summary = requiredTrimmed(record.summary, "summary");
  const existingTaskIds = new Set(tasks.map((task) => task.id));

  const generatedTasksInput = record.generatedTasks;
  if (!Array.isArray(generatedTasksInput)) {
    throw new Error("generatedTasks must be an array");
  }
  const generatedTasks = generatedTasksInput.map((value, index) => {
    const task = assertRecord(value, `generatedTasks[${index}]`);
    const description = optionalTrimmed(task.description, `generatedTasks[${index}].description`);
    return {
      title: requiredTrimmed(task.title, `generatedTasks[${index}].title`),
      ...(description ? { description } : {}),
      status: parseStatus(task.status, `generatedTasks[${index}].status`),
    };
  });

  const taskUpdatesInput = record.taskUpdates;
  if (!Array.isArray(taskUpdatesInput)) {
    throw new Error("taskUpdates must be an array");
  }
  const taskUpdates = taskUpdatesInput.map((value, index) => {
    const taskUpdate = assertRecord(value, `taskUpdates[${index}]`);
    const taskId = requiredTrimmed(taskUpdate.taskId, `taskUpdates[${index}].taskId`);
    if (!existingTaskIds.has(taskId as KanbanTaskId)) {
      throw new Error(`taskUpdates[${index}] references unknown task ${taskId}`);
    }
    return {
      taskId: taskId as KanbanTaskId,
      status: parseStatus(taskUpdate.status, `taskUpdates[${index}].status`),
    };
  });

  return {
    summary,
    generatedTasks,
    taskUpdates,
  };
}
