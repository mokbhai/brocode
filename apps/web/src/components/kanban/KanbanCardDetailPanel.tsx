import type {
  KanbanCard,
  KanbanReview,
  KanbanRun,
  KanbanTask,
  KanbanTaskStatus,
  ThreadId,
} from "@t3tools/contracts";
import { type FormEvent, type ReactNode, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";
import {
  BotIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
  GitForkIcon,
  ListChecksIcon,
  MessageCircleIcon,
  PlusIcon,
  PlayIcon,
  RefreshCwIcon,
  SquarePenIcon,
} from "~/lib/icons";

import { getKanbanCardStatusTitle } from "../../kanbanStatus";
import type { UpsertKanbanTaskInput } from "../../kanbanStore";
import { createKanbanCardViewModel } from "./kanbanBoard.logic";

export interface KanbanCardDetailPanelProps {
  readonly card: KanbanCard | null;
  readonly tasks: readonly KanbanTask[];
  readonly runs?: readonly KanbanRun[];
  readonly reviews?: readonly KanbanReview[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenSourceThread?: (threadId: ThreadId, card: KanbanCard) => void;
  readonly onOpenWorkerThread?: (threadId: ThreadId, card: KanbanCard) => void;
  readonly onOpenReviewerThread?: (threadId: ThreadId, card: KanbanCard) => void;
  readonly onStartRun?: (card: KanbanCard) => void;
  readonly onUpsertTask?: (input: UpsertKanbanTaskInput) => Promise<void> | void;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function runBadgeVariant(status: KanbanRun["status"]) {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "interrupted":
      return "warning";
    case "running":
      return "info";
  }
}

function reviewBadgeVariant(outcome: KanbanReview["outcome"]) {
  switch (outcome) {
    case "approved":
      return "success";
    case "blocked":
      return "error";
    case "inconclusive":
      return "warning";
    case "needs_work":
      return "info";
  }
}

const TASK_STATUS_LABELS: Record<KanbanTaskStatus, string> = {
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
};

function isKanbanTaskStatus(value: string): value is KanbanTaskStatus {
  return value === "todo" || value === "in_progress" || value === "done" || value === "blocked";
}

function DetailRow(props: { readonly label: string; readonly value: string | null | undefined }) {
  if (!props.value) {
    return null;
  }
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 text-xs leading-5">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 break-words text-foreground">{props.value}</dd>
    </div>
  );
}

function EmptyDetailState({ children }: { readonly children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-[color:var(--color-border)] px-3 py-4 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

export function KanbanCardDetailPanel({
  card,
  tasks,
  runs = [],
  reviews = [],
  open,
  onOpenChange,
  onOpenSourceThread,
  onOpenWorkerThread,
  onOpenReviewerThread,
  onStartRun,
  onUpsertTask,
}: KanbanCardDetailPanelProps) {
  const viewModel = card ? createKanbanCardViewModel(card, tasks) : null;
  const [editingTaskId, setEditingTaskId] = useState<KanbanTask["id"] | "new" | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskStatus, setTaskStatus] = useState<KanbanTaskStatus>("todo");
  const [taskError, setTaskError] = useState<string | null>(null);
  const [taskSubmitting, setTaskSubmitting] = useState(false);

  const resetTaskForm = () => {
    setEditingTaskId(null);
    setTaskTitle("");
    setTaskDescription("");
    setTaskStatus("todo");
    setTaskError(null);
  };

  const startAddingTask = () => {
    setEditingTaskId("new");
    setTaskTitle("");
    setTaskDescription("");
    setTaskStatus("todo");
    setTaskError(null);
  };

  const startEditingTask = (task: KanbanTask) => {
    setEditingTaskId(task.id);
    setTaskTitle(task.title);
    setTaskDescription(task.description ?? "");
    setTaskStatus(task.status);
    setTaskError(null);
  };

  const submitTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!card || !onUpsertTask || taskSubmitting) {
      return;
    }
    const title = taskTitle.trim();
    if (!title) {
      setTaskError("Task title is required");
      return;
    }
    const existingTask =
      editingTaskId && editingTaskId !== "new"
        ? tasks.find((task) => task.id === editingTaskId)
        : null;
    setTaskSubmitting(true);
    setTaskError(null);
    try {
      await onUpsertTask({
        cardId: card.id,
        ...(existingTask ? { taskId: existingTask.id } : {}),
        title,
        ...(taskDescription.trim() ? { description: taskDescription.trim() } : {}),
        status: taskStatus,
        order: existingTask?.order ?? tasks.length,
      });
      resetTaskForm();
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : String(error));
    } finally {
      setTaskSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup side="right" className="w-[min(94vw,520px)] max-w-[520px]" keepMounted>
        <SheetHeader className="gap-3">
          <div className="min-w-0 space-y-2 pr-8">
            <SheetTitle className="line-clamp-2 break-words text-lg leading-6">
              {card?.title ?? "Kanban card"}
            </SheetTitle>
            <SheetDescription className="line-clamp-3 break-words">
              {card?.description ?? "No card selected."}
            </SheetDescription>
          </div>

          {card && viewModel ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{viewModel.progressText}</Badge>
              {viewModel.retryText ? <Badge variant="outline">{viewModel.retryText}</Badge> : null}
              {viewModel.badges.map((badge) => (
                <Badge
                  key={`${badge.tone}:${badge.label}`}
                  title={badge.title}
                  variant={badge.tone === "warning" ? "warning" : "error"}
                >
                  {badge.label}
                </Badge>
              ))}
            </div>
          ) : null}
        </SheetHeader>

        <SheetPanel className="space-y-6">
          {card ? (
            <>
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-foreground">Actions</h3>
                  {onStartRun ? (
                    <Button size="sm" onClick={() => onStartRun(card)}>
                      <PlayIcon />
                      Start run
                    </Button>
                  ) : null}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {card.sourceThreadId ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!onOpenSourceThread}
                      onClick={() => onOpenSourceThread?.(card.sourceThreadId as ThreadId, card)}
                    >
                      <MessageCircleIcon />
                      Source thread
                      <ExternalLinkIcon className="ms-auto" />
                    </Button>
                  ) : null}
                  {card.workerThreadIds.length > 0 ? (
                    card.workerThreadIds.map((threadId, index) => (
                      <Button
                        key={threadId}
                        variant="outline"
                        size="sm"
                        disabled={!onOpenWorkerThread}
                        onClick={() => onOpenWorkerThread?.(threadId, card)}
                      >
                        <BotIcon />
                        Worker {index + 1}
                        <ExternalLinkIcon className="ms-auto" />
                      </Button>
                    ))
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      <BotIcon />
                      No worker thread
                    </Button>
                  )}
                  {card.reviewerThreadIds.length > 0 ? (
                    card.reviewerThreadIds.map((threadId, index) => (
                      <Button
                        key={threadId}
                        variant="outline"
                        size="sm"
                        disabled={!onOpenReviewerThread}
                        onClick={() => onOpenReviewerThread?.(threadId, card)}
                      >
                        <RefreshCwIcon />
                        Reviewer {index + 1}
                        <ExternalLinkIcon className="ms-auto" />
                      </Button>
                    ))
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      <RefreshCwIcon />
                      No reviewer thread
                    </Button>
                  )}
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-medium text-foreground">Card details</h3>
                <dl className="space-y-2 rounded-md border border-[color:var(--color-border-light)] p-3">
                  <DetailRow label="Status" value={getKanbanCardStatusTitle(card.status)} />
                  <DetailRow label="Spec" value={card.specPath} />
                  <DetailRow
                    label="Model"
                    value={`${card.modelSelection.provider} / ${card.modelSelection.model}`}
                  />
                  <DetailRow label="Runtime" value={card.runtimeMode} />
                  <DetailRow label="Branch" value={card.branch} />
                  <DetailRow label="Worktree" value={card.worktreePath} />
                  <DetailRow label="Linked branch" value={card.associatedWorktreeBranch} />
                  <DetailRow label="Linked ref" value={card.associatedWorktreeRef} />
                  <DetailRow label="Blocked by" value={card.blockerReason} />
                  <DetailRow label="Updated" value={formatDateTime(card.updatedAt)} />
                </dl>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-foreground">Tasks</h3>
                  {onUpsertTask ? (
                    <Button size="sm" variant="outline" onClick={startAddingTask}>
                      <PlusIcon />
                      Add task
                    </Button>
                  ) : null}
                </div>
                {editingTaskId ? (
                  <form
                    className="space-y-2 rounded-md border border-[color:var(--color-border-light)] bg-muted/16 p-3"
                    onSubmit={submitTask}
                  >
                    <Input
                      value={taskTitle}
                      onChange={(event) => setTaskTitle(event.currentTarget.value)}
                      placeholder="Task title"
                      nativeInput
                    />
                    <Textarea
                      value={taskDescription}
                      onChange={(event) => setTaskDescription(event.currentTarget.value)}
                      placeholder="Optional task notes"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Select
                        value={taskStatus}
                        onValueChange={(value) => {
                          if (isKanbanTaskStatus(value)) {
                            setTaskStatus(value);
                          }
                        }}
                      >
                        <SelectTrigger className="w-40" aria-label="Task status">
                          <SelectValue>{TASK_STATUS_LABELS[taskStatus]}</SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {Object.entries(TASK_STATUS_LABELS).map(([status, label]) => (
                            <SelectItem hideIndicator key={status} value={status}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                      <div className="flex items-center gap-2">
                        <Button type="button" size="sm" variant="ghost" onClick={resetTaskForm}>
                          Cancel
                        </Button>
                        <Button type="submit" size="sm" disabled={taskSubmitting}>
                          Save task
                        </Button>
                      </div>
                    </div>
                    {taskError ? (
                      <div className="text-xs text-destructive-foreground">{taskError}</div>
                    ) : null}
                  </form>
                ) : null}
                {tasks.length > 0 ? (
                  <div className="space-y-2">
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex min-w-0 items-start gap-2 rounded-md border border-[color:var(--color-border-light)] px-3 py-2"
                      >
                        {task.status === "done" ? (
                          <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success-foreground" />
                        ) : task.status === "blocked" ? (
                          <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive-foreground" />
                        ) : (
                          <ListChecksIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="break-words text-sm leading-5 text-foreground">
                            {task.title}
                          </div>
                          {task.description ? (
                            <div className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                              {task.description}
                            </div>
                          ) : null}
                        </div>
                        <Badge size="sm" variant={task.status === "blocked" ? "error" : "outline"}>
                          {task.status.replaceAll("_", " ")}
                        </Badge>
                        {onUpsertTask ? (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Edit ${task.title}`}
                            title="Edit task"
                            onClick={() => startEditingTask(task)}
                          >
                            <SquarePenIcon />
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyDetailState>No tasks have been added yet.</EmptyDetailState>
                )}
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-medium text-foreground">Runs</h3>
                {runs.length > 0 ? (
                  <div className="space-y-2">
                    {runs.map((run) => (
                      <div
                        key={run.id}
                        className="rounded-md border border-[color:var(--color-border-light)] px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <GitForkIcon className="size-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1 truncate text-sm text-foreground">
                            {run.role}
                          </div>
                          <Badge size="sm" variant={runBadgeVariant(run.status)}>
                            {run.status}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          Started {formatDateTime(run.startedAt)}
                          {run.completedAt ? `, completed ${formatDateTime(run.completedAt)}` : ""}
                        </div>
                        {run.errorMessage ? (
                          <div className="mt-1 break-words text-xs leading-5 text-destructive-foreground">
                            {run.errorMessage}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyDetailState>No agent runs recorded yet.</EmptyDetailState>
                )}
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-medium text-foreground">Reviews</h3>
                {reviews.length > 0 ? (
                  <div className="space-y-2">
                    {reviews.map((review) => (
                      <div
                        key={review.id}
                        className="rounded-md border border-[color:var(--color-border-light)] px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0 flex-1 truncate text-sm text-foreground">
                            {review.summary}
                          </div>
                          <Badge size="sm" variant={reviewBadgeVariant(review.outcome)}>
                            {review.outcome.replaceAll("_", " ")}
                          </Badge>
                        </div>
                        {review.findings.length > 0 ? (
                          <ul className="mt-2 space-y-1">
                            {review.findings.map((finding, index) => (
                              <li
                                key={`${review.id}:${index}`}
                                className="break-words text-xs leading-5 text-muted-foreground"
                              >
                                {finding}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <div className="mt-2 text-xs text-muted-foreground">
                          Completed {formatDateTime(review.completedAt)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyDetailState>No reviewer decisions recorded yet.</EmptyDetailState>
                )}
              </section>
            </>
          ) : (
            <EmptyDetailState>Select a card to inspect its tasks, runs, and reviews.</EmptyDetailState>
          )}
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}
