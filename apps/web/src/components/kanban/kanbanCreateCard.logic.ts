import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_RUNTIME_MODE,
  type KanbanBoardId,
  type KanbanTaskStatus,
  type ModelSelection,
  type ProjectId,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";

import type { CreateKanbanCardInput, CreateKanbanCardTaskInput } from "../../kanbanStore";

export type KanbanCreateCardMode = "thread" | "specPath" | "manual";

export interface KanbanCreateCardTaskDraft {
  readonly title: string;
  readonly description?: string;
  readonly status?: KanbanTaskStatus;
}

export interface BuildCreateKanbanCardInputOptions {
  readonly boardId: KanbanBoardId;
  readonly projectId: ProjectId;
  readonly mode: KanbanCreateCardMode;
  readonly title: string;
  readonly description?: string;
  readonly specPath?: string;
  readonly inlineSpec?: string;
  readonly sourceThreadId?: ThreadId | null;
  readonly modelSelection?: ModelSelection | null;
  readonly runtimeMode?: RuntimeMode | null;
  readonly tasks?: readonly KanbanCreateCardTaskDraft[];
  readonly tasksText?: string;
}

function trimRequired(value: string | null | undefined, fieldName: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

function optionalTrimmed(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed || undefined;
}

export function createDefaultKanbanModelSelection(): ModelSelection {
  return {
    provider: "codex",
    model: DEFAULT_MODEL_BY_PROVIDER.codex,
  };
}

export function parseKanbanInitialTasks(text: string): CreateKanbanCardTaskInput[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean)
    .map((title, order) => ({
      title,
      status: "todo" as const,
      order,
    }));
}

function normalizeTasks(
  tasks: readonly KanbanCreateCardTaskDraft[] | undefined,
  tasksText: string | undefined,
): CreateKanbanCardTaskInput[] {
  if (tasks) {
    return tasks
      .map((task, order) => {
        const title = optionalTrimmed(task.title);
        if (!title) {
          return null;
        }
        return {
          title,
          ...(optionalTrimmed(task.description)
            ? { description: optionalTrimmed(task.description) }
            : {}),
          status: task.status ?? "todo",
          order,
        } satisfies CreateKanbanCardTaskInput;
      })
      .filter((task): task is CreateKanbanCardTaskInput => task !== null);
  }

  return parseKanbanInitialTasks(tasksText ?? "");
}

export function buildCreateKanbanCardInput(
  options: BuildCreateKanbanCardInputOptions,
): CreateKanbanCardInput {
  const title = trimRequired(options.title, "Title");
  const modelSelection = options.modelSelection ?? createDefaultKanbanModelSelection();
  const runtimeMode = options.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const tasks = normalizeTasks(options.tasks, options.tasksText);
  const description = optionalTrimmed(options.description);

  if (options.mode === "manual") {
    const specPath = trimRequired(options.specPath, "Spec path");
    const inlineSpec = optionalTrimmed(options.inlineSpec);
    const manualDescription = inlineSpec
      ? description
        ? `${description}\n\nInline spec:\n\n${inlineSpec}`
        : `Inline spec:\n\n${inlineSpec}`
      : description;
    return {
      boardId: options.boardId,
      projectId: options.projectId,
      sourceThreadId: null,
      title,
      ...(manualDescription ? { description: manualDescription } : {}),
      specPath,
      tasks,
      modelSelection,
      runtimeMode,
    };
  }

  const specPath = trimRequired(options.specPath, "Spec path");
  return {
    boardId: options.boardId,
    projectId: options.projectId,
    sourceThreadId:
      options.mode === "thread"
        ? (trimRequired(options.sourceThreadId, "Source thread") as ThreadId)
        : null,
    title,
    ...(description ? { description } : {}),
    specPath,
    tasks,
    modelSelection,
    runtimeMode,
  };
}
