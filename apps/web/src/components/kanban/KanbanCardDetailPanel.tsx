import type {
  KanbanCard,
  KanbanReview,
  KanbanRun,
  KanbanTask,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

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
  PlayIcon,
  RefreshCwIcon,
  SquarePenIcon,
} from "~/lib/icons";

import { getKanbanCardStatusTitle } from "../../kanbanStatus";
import type { UpdateKanbanCardInput } from "../../kanbanStore";
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
  readonly onUpdateCard?: (input: UpdateKanbanCardInput) => Promise<void> | void;
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

const RUNTIME_MODE_LABELS: Record<RuntimeMode, string> = {
  "full-access": "Full access",
  "approval-required": "Approval required",
};

function isRuntimeMode(value: string): value is RuntimeMode {
  return value === "full-access" || value === "approval-required";
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
  onUpdateCard,
}: KanbanCardDetailPanelProps) {
  const viewModel = card ? createKanbanCardViewModel(card, tasks) : null;
  const [editingCard, setEditingCard] = useState(false);
  const [cardTitle, setCardTitle] = useState("");
  const [cardDescription, setCardDescription] = useState("");
  const [cardRuntimeMode, setCardRuntimeMode] = useState<RuntimeMode>("full-access");
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardSubmitting, setCardSubmitting] = useState(false);
  const cardTitleInputId = "kanban-card-title-input";
  const cardDescriptionInputId = "kanban-card-description-input";
  const cardErrorId = "kanban-card-form-error";

  useEffect(() => {
    setEditingCard(false);
    setCardTitle(card?.title ?? "");
    setCardDescription(card?.description ?? "");
    setCardRuntimeMode(card?.runtimeMode ?? "full-access");
    setCardError(null);
    setCardSubmitting(false);
  }, [card?.id, open]);

  const resetCardForm = () => {
    setEditingCard(false);
    setCardTitle(card?.title ?? "");
    setCardDescription(card?.description ?? "");
    setCardRuntimeMode(card?.runtimeMode ?? "full-access");
    setCardError(null);
  };

  const startEditingCard = () => {
    setEditingCard(true);
    setCardTitle(card?.title ?? "");
    setCardDescription(card?.description ?? "");
    setCardRuntimeMode(card?.runtimeMode ?? "full-access");
    setCardError(null);
  };

  const submitCard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!card || !onUpdateCard || cardSubmitting) {
      return;
    }
    const title = cardTitle.trim();
    if (!title) {
      setCardError("Card title is required");
      return;
    }
    setCardSubmitting(true);
    setCardError(null);
    try {
      await onUpdateCard({
        cardId: card.id,
        title,
        description: cardDescription.trim() || null,
        runtimeMode: cardRuntimeMode,
      });
      setEditingCard(false);
    } catch (error) {
      setCardError(error instanceof Error ? error.message : String(error));
    } finally {
      setCardSubmitting(false);
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
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-foreground">Card details</h3>
                  {onUpdateCard && !editingCard ? (
                    <Button size="sm" variant="outline" onClick={startEditingCard}>
                      <SquarePenIcon />
                      Edit
                    </Button>
                  ) : null}
                </div>
                {editingCard ? (
                  <form
                    className="space-y-2 rounded-md border border-[color:var(--color-border-light)] bg-muted/16 p-3"
                    onSubmit={submitCard}
                  >
                    <label
                      className="block text-xs font-medium text-foreground"
                      htmlFor={cardTitleInputId}
                    >
                      Card title
                    </label>
                    <Input
                      id={cardTitleInputId}
                      value={cardTitle}
                      onChange={(event) => setCardTitle(event.currentTarget.value)}
                      placeholder="Card title"
                      nativeInput
                      aria-invalid={cardError ? true : undefined}
                      aria-describedby={cardError ? cardErrorId : undefined}
                    />
                    <label
                      className="block text-xs font-medium text-foreground"
                      htmlFor={cardDescriptionInputId}
                    >
                      Description
                    </label>
                    <Textarea
                      id={cardDescriptionInputId}
                      value={cardDescription}
                      onChange={(event) => setCardDescription(event.currentTarget.value)}
                      placeholder="Optional context"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Select
                        value={cardRuntimeMode}
                        onValueChange={(value) => {
                          if (isRuntimeMode(value)) {
                            setCardRuntimeMode(value);
                          }
                        }}
                      >
                        <SelectTrigger className="w-44" aria-label="Card runtime mode">
                          <SelectValue>{RUNTIME_MODE_LABELS[cardRuntimeMode]}</SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {Object.entries(RUNTIME_MODE_LABELS).map(([runtimeMode, label]) => (
                            <SelectItem hideIndicator key={runtimeMode} value={runtimeMode}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                      <div className="flex items-center gap-2">
                        <Button type="button" size="sm" variant="ghost" onClick={resetCardForm}>
                          Cancel
                        </Button>
                        <Button type="submit" size="sm" disabled={cardSubmitting}>
                          Save card
                        </Button>
                      </div>
                    </div>
                    {cardError ? (
                      <div
                        id={cardErrorId}
                        role="alert"
                        aria-live="polite"
                        className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground"
                      >
                        {cardError}
                      </div>
                    ) : null}
                  </form>
                ) : (
                  <dl className="space-y-2 rounded-md border border-[color:var(--color-border-light)] p-3">
                    <DetailRow label="Status" value={getKanbanCardStatusTitle(card.status)} />
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
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-foreground">Tasks</h3>
                </div>
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
