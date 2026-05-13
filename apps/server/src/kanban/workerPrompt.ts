import type { KanbanCard, KanbanTask } from "@t3tools/contracts";

export interface BuildKanbanWorkerPromptInput {
  readonly card: KanbanCard;
  readonly tasks: readonly KanbanTask[];
  readonly worktreePath: string;
  readonly branch: string | null;
}

function formatTask(task: KanbanTask): string {
  return [
    `- ${task.id}: ${task.title}`,
    `  Status: ${task.status}`,
    task.description ? `  Notes: ${task.description}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function buildKanbanWorkerPrompt(input: BuildKanbanWorkerPromptInput): string {
  const { card, tasks } = input;
  const taskSection =
    tasks.length > 0
      ? tasks.map(formatTask).join("\n")
      : "No existing generated tasks are recorded. First, generate the initial to-do list from the card context, then complete as much of that list as you can.";

  return [
    "You are a Kanban worker running inside BroCode.",
    "",
    "Provider execution is managed by BroCode. Do not ask for external model credentials, API keys, or a separate LLM setup.",
    "",
    "Card",
    `Title: ${card.title}`,
    `Description/context: ${card.description ?? "(none provided)"}`,
    `Runtime mode: ${card.runtimeMode}`,
    "",
    "Workspace",
    `Worktree path: ${input.worktreePath}`,
    `Branch: ${input.branch ?? "(current worktree branch)"}`,
    "",
    "Tasks",
    taskSection,
    "",
    "Rules",
    "- Work only in the provided worktree.",
    "- Keep changes scoped to the card context.",
    "- If a task cannot be completed, mark it blocked and explain the reason in the summary.",
    "- Do not infer Kanban state from prose; report it in the final JSON block.",
    "",
    "Return a final fenced JSON summary as the last json code block in this exact shape:",
    "```json",
    JSON.stringify(
      {
        summary: "short human-readable result",
        generatedTasks: [
          {
            title: "Add payload tests",
            description: "Optional detail",
            status: "done",
          },
        ],
        taskUpdates: [
          {
            taskId: "task-1",
            status: "done",
          },
        ],
      },
      null,
      2,
    ),
    "```",
    "",
    "Use generatedTasks only for new tasks you derive from the card context. Use taskUpdates only for existing server-issued task IDs.",
  ].join("\n");
}
