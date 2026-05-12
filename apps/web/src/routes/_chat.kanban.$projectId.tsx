import {
  KanbanBoardId,
  ProjectId,
  ThreadId,
  type KanbanCard,
} from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { KanbanBoard } from "~/components/kanban/KanbanBoard";
import { Button } from "~/components/ui/button";
import { SidebarInset } from "~/components/ui/sidebar";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import { getProjectKanbanBoardId } from "~/kanbanRouting";
import { selectKanbanSnapshot, useKanbanStore } from "~/kanbanStore";
import { cn } from "~/lib/utils";
import { useStore } from "~/store";
import { createProjectSelector } from "~/storeSelectors";

interface KanbanRouteSearch {
  readonly sourceThreadId?: string;
  readonly title?: string;
}

function kanbanRouteMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingBoardError(error: unknown, boardId: KanbanBoardId): boolean {
  const message = kanbanRouteMessage(error);
  return message.includes(`Kanban board '${boardId}'`) && message.includes("was not found");
}

function isExistingBoardError(error: unknown, boardId: KanbanBoardId): boolean {
  const message = kanbanRouteMessage(error);
  return message.includes(`Board '${boardId}' already exists`);
}

function KanbanProjectRouteView() {
  const navigate = useNavigate();
  const params = Route.useParams();
  const search = Route.useSearch() as KanbanRouteSearch;
  const projectId = useMemo(() => ProjectId.makeUnsafe(params.projectId), [params.projectId]);
  const boardId = useMemo(() => getProjectKanbanBoardId(projectId), [projectId]);
  const project = useStore(useMemo(() => createProjectSelector(projectId), [projectId]));
  const snapshot = useKanbanStore((state) => selectKanbanSnapshot(state, boardId));
  const loading = useKanbanStore((state) => state.loadingBoardIds[boardId] ?? false);
  const storeError = useKanbanStore((state) => state.errorByBoardId[boardId] ?? null);
  const loadKanbanSnapshot = useKanbanStore((state) => state.loadKanbanSnapshot);
  const subscribeKanbanBoard = useKanbanStore((state) => state.subscribeKanbanBoard);
  const createKanbanBoard = useKanbanStore((state) => state.createKanbanBoard);
  const createKanbanCard = useKanbanStore((state) => state.createKanbanCard);
  const updateKanbanCard = useKanbanStore((state) => state.updateKanbanCard);
  const upsertKanbanTask = useKanbanStore((state) => state.upsertKanbanTask);
  const deleteKanbanTask = useKanbanStore((state) => state.deleteKanbanTask);
  const [selectedCardId, setSelectedCardId] = useState<KanbanCard["id"] | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!project) {
      return;
    }

    let disposed = false;
    let unsubscribe: (() => Promise<void>) | null = null;

    const ensureBoardAndSubscribe = async () => {
      setRouteError(null);
      setSubscriptionError(null);
      try {
        await loadKanbanSnapshot(boardId);
      } catch (error) {
        if (!isMissingBoardError(error, boardId)) {
          throw error;
        }
        try {
          await createKanbanBoard({
            boardId,
            projectId,
            title: `${project.name} Kanban`,
          });
        } catch (createError) {
          if (!isExistingBoardError(createError, boardId)) {
            throw createError;
          }
        }
        await loadKanbanSnapshot(boardId);
      }

      if (disposed) {
        return;
      }
      let releaseSubscription: () => Promise<void>;
      try {
        releaseSubscription = await subscribeKanbanBoard(boardId);
      } catch (error) {
        if (!disposed) {
          setSubscriptionError(kanbanRouteMessage(error));
        }
        return;
      }
      if (disposed) {
        void releaseSubscription();
        return;
      }
      unsubscribe = releaseSubscription;
    };

    void ensureBoardAndSubscribe().catch((error) => {
      if (!disposed) {
        setRouteError(kanbanRouteMessage(error));
      }
    });

    return () => {
      disposed = true;
      if (unsubscribe) {
        void unsubscribe();
      }
    };
  }, [
    boardId,
    createKanbanBoard,
    loadKanbanSnapshot,
    project?.id,
    project?.name,
    projectId,
    retryNonce,
    subscribeKanbanBoard,
  ]);

  const openThread = useCallback(
    (threadId: ThreadId) => {
      void navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [navigate],
  );

  const sourceThreadId =
    typeof search.sourceThreadId === "string" && search.sourceThreadId.trim()
      ? ThreadId.makeUnsafe(search.sourceThreadId.trim())
      : null;
  const initialTitle =
    typeof search.title === "string" && search.title.trim() ? search.title.trim() : undefined;
  const initialModelSelection = project?.defaultModelSelection ?? null;

  if (!project) {
    return (
      <KanbanRouteShell>
        <KanbanRouteState
          title="Project not found"
          description="Open a project thread before using its Kanban board."
          action={
            <Button size="sm" variant="outline" onClick={() => void navigate({ to: "/" })}>
              Back to threads
            </Button>
          }
        />
      </KanbanRouteShell>
    );
  }

  return (
    <KanbanRouteShell>
      {snapshot && !subscriptionError ? (
        <KanbanBoard
          snapshot={snapshot}
          selectedCardId={selectedCardId}
          onSelectCard={(cardId) => setSelectedCardId(cardId)}
          onCreateCard={createKanbanCard}
          onUpdateCard={updateKanbanCard}
          onUpsertTask={upsertKanbanTask}
          onDeleteTask={deleteKanbanTask}
          onOpenSourceThread={(threadId) => openThread(threadId)}
          onOpenWorkerThread={(threadId) => openThread(threadId)}
          onOpenReviewerThread={(threadId) => openThread(threadId)}
          initialCreateCardOpen={sourceThreadId !== null}
          initialCreateCardMode={sourceThreadId ? "thread" : undefined}
          initialCreateCardSourceThreadId={sourceThreadId}
          initialCreateCardTitle={initialTitle}
          initialCreateCardModelSelection={initialModelSelection}
        />
      ) : (
        <KanbanRouteState
          title={loading ? "Loading Kanban board" : "Preparing Kanban board"}
          description={
            routeError ??
            subscriptionError ??
            storeError ??
            "Creating or loading the event-backed project board."
          }
          tone={routeError || subscriptionError || storeError ? "error" : "default"}
          action={
            subscriptionError ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setRouteError(null);
                  setSubscriptionError(null);
                  setRetryNonce((value) => value + 1);
                }}
              >
                Retry
              </Button>
            ) : null
          }
        />
      )}
    </KanbanRouteShell>
  );
}

function KanbanRouteShell({ children }: { readonly children: ReactNode }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <header className="border-b border-border px-3 sm:px-5">
          <div className="flex h-[52px] items-center gap-2 sm:gap-3">
            <SidebarHeaderNavigationControls />
            <h1 className="min-w-0 truncate text-sm font-medium text-foreground">Kanban</h1>
          </div>
        </header>
        <div className="min-h-0 min-w-0 flex-1">{children}</div>
      </div>
    </SidebarInset>
  );
}

function KanbanRouteState({
  title,
  description,
  tone = "default",
  action,
}: {
  readonly title: string;
  readonly description: string;
  readonly tone?: "default" | "error";
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div
          className={cn(
            "text-sm font-medium",
            tone === "error" ? "text-destructive-foreground" : "text-foreground/85",
          )}
        >
          {title}
        </div>
        <div className="mt-1 text-sm leading-6 text-muted-foreground">{description}</div>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat/kanban/$projectId")({
  component: KanbanProjectRouteView,
});
