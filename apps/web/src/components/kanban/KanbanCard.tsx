import type { KanbanTaskStatus } from "@t3tools/contracts";
import type { KeyboardEvent } from "react";

import { Badge } from "~/components/ui/badge";
import { CircleAlertIcon, CircleCheckIcon, ListChecksIcon, Loader2Icon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import type { KanbanCardViewModel } from "./kanbanBoard.logic";

export interface KanbanCardProps {
  readonly viewModel: KanbanCardViewModel;
  readonly selected?: boolean;
  readonly onSelect?: () => void;
}

const taskStatusIcon = {
  blocked: CircleAlertIcon,
  done: CircleCheckIcon,
  in_progress: Loader2Icon,
  todo: ListChecksIcon,
} satisfies Record<KanbanTaskStatus, typeof ListChecksIcon>;

function getBadgeVariant(tone: KanbanCardViewModel["badges"][number]["tone"]) {
  if (tone === "warning") {
    return "warning";
  }
  return "error";
}

export function KanbanCard({ viewModel, selected = false, onSelect }: KanbanCardProps) {
  const { card, tasks } = viewModel;
  const previewTasks = tasks.slice(0, 3);
  const hiddenTaskCount = Math.max(0, tasks.length - previewTasks.length);
  const interactiveProps = onSelect
    ? {
        role: "button",
        tabIndex: 0,
        onClick: onSelect,
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          onSelect();
        },
      }
    : {};

  return (
    <article
      className={cn(
        "group flex min-h-[132px] w-full flex-col gap-3 rounded-md border bg-[var(--color-background-elevated-primary-opaque)] p-3 text-left shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70",
        selected
          ? "border-primary/70 bg-primary/5"
          : "border-[color:var(--color-border-light)]",
        onSelect &&
          "cursor-pointer hover:border-[color:var(--color-border)] hover:bg-[var(--color-background-elevated-secondary)]",
      )}
      aria-pressed={onSelect ? selected : undefined}
      {...interactiveProps}
    >
      <div className="min-w-0 space-y-1.5">
        <div className="line-clamp-2 break-words text-sm font-medium leading-5 text-foreground">
          {card.title}
        </div>
        {card.description ? (
          <div className="line-clamp-2 break-words text-xs leading-5 text-muted-foreground">
            {card.description}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {viewModel.badges.map((badge) => (
          <Badge
            key={`${badge.tone}:${badge.label}`}
            size="sm"
            title={badge.title}
            variant={getBadgeVariant(badge.tone)}
            className="max-w-full"
          >
            <span className="truncate">{badge.label}</span>
          </Badge>
        ))}
        {viewModel.retryText ? (
          <Badge size="sm" variant="outline" className="max-w-full">
            <span className="truncate">{viewModel.retryText}</span>
          </Badge>
        ) : null}
      </div>

      <div className="mt-auto space-y-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <ListChecksIcon className="size-3.5 shrink-0" />
          <span className="truncate">{viewModel.progressText}</span>
        </div>

        {previewTasks.length > 0 ? (
          <div className="space-y-1">
            {previewTasks.map((task) => {
              const TaskIcon = taskStatusIcon[task.status];
              return (
                <div
                  key={task.id}
                  className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground"
                >
                  <TaskIcon
                    className={cn(
                      "size-3 shrink-0",
                      task.status === "done" && "text-success-foreground",
                      task.status === "blocked" && "text-destructive-foreground",
                      task.status === "in_progress" && "text-info-foreground",
                    )}
                  />
                  <span className="truncate">{task.title}</span>
                </div>
              );
            })}
            {hiddenTaskCount > 0 ? (
              <div className="text-[11px] leading-4 text-muted-foreground">
                +{hiddenTaskCount} more
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
