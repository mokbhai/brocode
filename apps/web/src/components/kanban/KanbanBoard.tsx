import type {
  KanbanBoardSnapshot,
  KanbanCard as KanbanCardRecord,
  KanbanCardId,
  ModelSelection,
  ThreadId,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { PlusIcon, PlayIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { KanbanCard } from "./KanbanCard";
import { KanbanCreateCardDialog } from "./KanbanCreateCardDialog";
import { KanbanCardDetailPanel } from "./KanbanCardDetailPanel";
import { groupKanbanCardsByColumn } from "./kanbanBoard.logic";
import type { CreateKanbanCardInput, UpdateKanbanCardInput } from "../../kanbanStore";

export interface KanbanBoardProps {
  readonly snapshot: KanbanBoardSnapshot;
  readonly selectedCardId?: KanbanCardId | null;
  readonly onSelectCard?: (cardId: KanbanCardId | null, card?: KanbanCardRecord) => void;
  readonly onCreateCard?: (input: CreateKanbanCardInput) => Promise<void> | void;
  readonly onOpenSourceThread?: (threadId: ThreadId, card: KanbanCardRecord) => void;
  readonly onOpenWorkerThread?: (threadId: ThreadId, card: KanbanCardRecord) => void;
  readonly onOpenReviewerThread?: (threadId: ThreadId, card: KanbanCardRecord) => void;
  readonly onStartRun?: (card: KanbanCardRecord) => void;
  readonly onUpdateCard?: (input: UpdateKanbanCardInput) => Promise<void> | void;
  readonly initialCreateCardOpen?: boolean;
  readonly initialCreateCardSourceThreadId?: ThreadId | null;
  readonly initialCreateCardTitle?: string;
  readonly initialCreateCardModelSelection?: ModelSelection | null;
  readonly className?: string;
}

export function KanbanBoard({
  snapshot,
  selectedCardId = null,
  onSelectCard,
  onCreateCard,
  onOpenSourceThread,
  onOpenWorkerThread,
  onOpenReviewerThread,
  onStartRun,
  onUpdateCard,
  initialCreateCardOpen = false,
  initialCreateCardSourceThreadId = null,
  initialCreateCardTitle,
  initialCreateCardModelSelection = null,
  className,
}: KanbanBoardProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const initialCreateDialogOpenedRef = useRef(false);
  const columns = groupKanbanCardsByColumn(snapshot.cards, snapshot.tasksByCardId);
  const selectedCard = selectedCardId
    ? snapshot.cards.find((card) => card.id === selectedCardId) ?? null
    : null;

  useEffect(() => {
    if (!initialCreateCardOpen || initialCreateDialogOpenedRef.current) {
      return;
    }
    initialCreateDialogOpenedRef.current = true;
    setCreateDialogOpen(true);
  }, [initialCreateCardOpen]);

  return (
    <div className={cn("flex size-full min-h-0 flex-col bg-background", className)}>
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-[color:var(--color-border-light)] px-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{snapshot.board.title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {snapshot.cards.length} card{snapshot.cards.length === 1 ? "" : "s"} across{" "}
            {columns.length} columns
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {selectedCard && onStartRun ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Start selected card run"
              title="Start selected card run"
              onClick={() => onStartRun(selectedCard)}
            >
              <PlayIcon />
            </Button>
          ) : null}
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Create Kanban card"
            title="Create Kanban card"
            disabled={!onCreateCard}
            onClick={() => setCreateDialogOpen(true)}
          >
            <PlusIcon />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
        <div className="flex h-full min-h-[520px] gap-3 p-3">
          {columns.map((column) => (
            <section
              key={column.id}
              className="flex h-full w-[280px] shrink-0 flex-col rounded-md border border-[color:var(--color-border-light)] bg-muted/24"
            >
              <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[color:var(--color-border-light)] px-3">
                <h2 className="min-w-0 truncate text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                  {column.title}
                </h2>
                <Badge size="sm" variant="outline">
                  {column.cardCount}
                </Badge>
              </div>

              <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
                <div className="space-y-2 p-2">
                  {column.cards.length > 0 ? (
                    column.cards.map((viewModel) => (
                      <KanbanCard
                        key={viewModel.card.id}
                        viewModel={viewModel}
                        selected={viewModel.card.id === selectedCardId}
                        onSelect={
                          onSelectCard
                            ? () => onSelectCard(viewModel.card.id, viewModel.card)
                            : undefined
                        }
                      />
                    ))
                  ) : (
                    <div className="flex min-h-[96px] items-center justify-center rounded-md border border-dashed border-[color:var(--color-border)] px-3 text-center text-xs leading-5 text-muted-foreground">
                      No cards
                    </div>
                  )}
                </div>
              </ScrollArea>
            </section>
          ))}
        </div>
      </ScrollArea>

      <KanbanCardDetailPanel
        card={selectedCard}
        tasks={selectedCard ? snapshot.tasksByCardId[selectedCard.id] ?? [] : []}
        runs={selectedCard ? snapshot.runsByCardId[selectedCard.id] ?? [] : []}
        reviews={selectedCard ? snapshot.reviewsByCardId[selectedCard.id] ?? [] : []}
        open={selectedCard !== null}
        onOpenChange={(open) => {
          if (!open) {
            onSelectCard?.(null);
          }
        }}
        onOpenSourceThread={onOpenSourceThread}
        onOpenWorkerThread={onOpenWorkerThread}
        onOpenReviewerThread={onOpenReviewerThread}
        onStartRun={onStartRun}
        onUpdateCard={onUpdateCard}
      />

      {onCreateCard ? (
        <KanbanCreateCardDialog
          snapshot={snapshot}
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onCreateCard={onCreateCard}
          initialSourceThreadId={initialCreateCardSourceThreadId}
          initialTitle={initialCreateCardTitle}
          initialModelSelection={initialCreateCardModelSelection}
        />
      ) : null}
    </div>
  );
}
