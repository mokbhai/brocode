import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_RUNTIME_MODE,
  type KanbanBoardId,
  type ModelSelection,
  type ProjectId,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";

import type { CreateKanbanCardInput } from "../../kanbanStore";

export interface BuildCreateKanbanCardInputOptions {
  readonly boardId: KanbanBoardId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly description?: string;
  readonly runtimeMode?: RuntimeMode | null;
  readonly modelSelection?: ModelSelection | null;
  readonly sourceThreadId?: ThreadId | null;
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

export function buildCreateKanbanCardInput(
  options: BuildCreateKanbanCardInputOptions,
): CreateKanbanCardInput {
  const title = trimRequired(options.title, "Title");
  const description = optionalTrimmed(options.description);

  return {
    boardId: options.boardId,
    projectId: options.projectId,
    sourceThreadId: options.sourceThreadId ?? null,
    title,
    ...(description ? { description } : {}),
    modelSelection: options.modelSelection ?? createDefaultKanbanModelSelection(),
    runtimeMode: options.runtimeMode ?? DEFAULT_RUNTIME_MODE,
  };
}
