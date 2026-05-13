import { buildBroCodeBranchName } from "@t3tools/shared/git";
import { getServerProviderStartOptions } from "@t3tools/shared/providerStartOptions";
import type {
  CommandId,
  KanbanCard,
  KanbanTaskId,
  KanbanRunId,
  KanbanTask,
  MessageId,
  OrchestrationCommand,
  OrchestrationProject,
  OrchestrationThread,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Queue } from "effect";

import { GitCore } from "../../git/Services/GitCore.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { KanbanEngineService } from "../Services/KanbanEngine.ts";
import {
  KanbanWorkerCoordinator,
  KanbanWorkerCoordinatorError,
} from "../Services/KanbanWorkerCoordinator.ts";
import { buildKanbanWorkerPrompt } from "../workerPrompt.ts";
import { parseKanbanWorkerSummary } from "../workerSummary.ts";

interface PreparedWorktree {
  readonly path: string;
  readonly branch: string;
  readonly associatedWorktreePath: string;
  readonly associatedWorktreeBranch: string;
  readonly associatedWorktreeRef: string;
}

function commandId(label: string): CommandId {
  return `${label}-${crypto.randomUUID()}` as CommandId;
}

function threadId(): ThreadId {
  return crypto.randomUUID() as ThreadId;
}

function runId(): KanbanRunId {
  return crypto.randomUUID() as KanbanRunId;
}

function messageId(): MessageId {
  return crypto.randomUUID() as MessageId;
}

function generatedTaskId(runId: KanbanRunId, index: number): KanbanTaskId {
  return `kanban-worker-${runId}-${index}` as KanbanTaskId;
}

function coordinatorError(input: {
  readonly reason: KanbanWorkerCoordinatorError["reason"];
  readonly detail: string;
  readonly cause?: unknown;
}): KanbanWorkerCoordinatorError {
  return new KanbanWorkerCoordinatorError({
    reason: input.reason,
    detail: input.detail,
    ...(input.cause !== undefined ? { cause: input.cause } : {}),
  });
}

function findCardTasks(tasks: readonly KanbanTask[], card: KanbanCard): KanbanTask[] {
  return tasks
    .filter((task) => task.cardId === card.id)
    .sort((left, right) => left.order - right.order);
}

function findProject(
  projects: readonly OrchestrationProject[],
  card: KanbanCard,
): OrchestrationProject | undefined {
  return projects.find((project) => project.id === card.projectId && project.deletedAt === null);
}

type WorkerObservationState =
  | { readonly _tag: "missing-thread" }
  | { readonly _tag: "pending" }
  | { readonly _tag: "completed"; readonly text: string }
  | {
      readonly _tag: "terminal-error";
      readonly status: "failed" | "interrupted";
      readonly message: string;
    };

interface WorkerObservationJob {
  readonly card: KanbanCard;
  readonly tasks: readonly KanbanTask[];
  readonly runId: KanbanRunId;
  readonly threadId: ThreadId;
}

function latestCompletedAssistantText(thread: OrchestrationThread): string | null {
  const message = [...thread.messages]
    .reverse()
    .find((entry) => entry.role === "assistant" && !entry.streaming && entry.text.trim());
  return message?.text ?? null;
}

function inspectWorkerThread(thread: OrchestrationThread): WorkerObservationState {
  const failedActivity = [...thread.activities]
    .reverse()
    .find((activity) => activity.kind === "provider.turn.start.failed");
  if (failedActivity) {
    return { _tag: "terminal-error", status: "failed", message: failedActivity.summary };
  }
  if (thread.session?.status === "error") {
    return {
      _tag: "terminal-error",
      status: "failed",
      message: thread.session.lastError ?? "Provider session failed",
    };
  }
  if (thread.latestTurn?.state === "interrupted") {
    return { _tag: "terminal-error", status: "interrupted", message: "Worker run interrupted" };
  }
  if (thread.latestTurn?.state === "error") {
    return { _tag: "terminal-error", status: "failed", message: "Worker turn failed" };
  }
  if (thread.latestTurn?.state === "completed") {
    const text = latestCompletedAssistantText(thread);
    if (text) {
      return { _tag: "completed", text };
    }
    return {
      _tag: "terminal-error",
      status: "failed",
      message: "Worker completed without assistant output",
    };
  }
  return { _tag: "pending" };
}

function isThreadWaitingForFirstWorkerTurn(thread: OrchestrationThread): boolean {
  return thread.latestTurn === null && thread.messages.length === 0;
}

export const KanbanWorkerCoordinatorLive = Layer.effect(
  KanbanWorkerCoordinator,
  Effect.gen(function* () {
    const kanbanEngine = yield* KanbanEngineService;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const orchestrationSnapshotQuery = yield* ProjectionSnapshotQuery;
    const gitCore = yield* GitCore;
    const serverSettings = yield* ServerSettingsService;
    const observationQueue = yield* Queue.unbounded<WorkerObservationJob>();

    const completeRun = (input: {
      readonly cardId: KanbanCard["id"];
      readonly runId: KanbanRunId;
      readonly status: "completed" | "failed" | "interrupted";
      readonly errorMessage?: string;
    }) =>
      kanbanEngine
        .dispatch({
          type: "kanban.run.complete",
          commandId: commandId("kanban-worker-run-complete"),
          runId: input.runId,
          cardId: input.cardId,
          status: input.status,
          ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
          completedAt: new Date().toISOString(),
        })
        .pipe(Effect.asVoid);

    const getProviderOptions = () =>
      serverSettings.getSettings.pipe(
        Effect.mapError((cause) =>
          coordinatorError({
            reason: "provider-dispatch",
            detail: "Failed to read provider settings.",
            cause,
          }),
        ),
        Effect.map(getServerProviderStartOptions),
      );

    const startWorkerTurn = (input: {
      readonly card: KanbanCard;
      readonly tasks: readonly KanbanTask[];
      readonly threadId: ThreadId;
      readonly worktree: PreparedWorktree;
      readonly createdAt: string;
    }) =>
      Effect.gen(function* () {
        const prompt = buildKanbanWorkerPrompt({
          card: input.card,
          tasks: input.tasks,
          worktreePath: input.worktree.path,
          branch: input.worktree.branch,
        });
        const providerOptions = yield* getProviderOptions();
        yield* orchestrationEngine
          .dispatch({
            type: "thread.turn.start",
            commandId: commandId("kanban-worker-turn-start"),
            threadId: input.threadId,
            message: {
              messageId: messageId(),
              role: "user",
              text: prompt,
              attachments: [],
            },
            modelSelection: input.card.modelSelection,
            providerOptions,
            assistantDeliveryMode: "buffered",
            runtimeMode: input.card.runtimeMode,
            interactionMode: "default",
            createdAt: input.createdAt,
          })
          .pipe(
            Effect.mapError((cause) =>
              coordinatorError({
                reason: "provider-dispatch",
                detail: `Failed to start worker turn for card '${input.card.id}'.`,
                cause,
              }),
            ),
          );
      });

    const worktreeFromCard = (card: KanbanCard): PreparedWorktree | null => {
      if (!card.worktreePath || !card.branch) {
        return null;
      }
      return {
        path: card.worktreePath,
        branch: card.branch,
        associatedWorktreePath: card.associatedWorktreePath ?? card.worktreePath,
        associatedWorktreeBranch: card.associatedWorktreeBranch ?? card.branch,
        associatedWorktreeRef: card.associatedWorktreeRef ?? card.branch,
      };
    };

    const prepareWorktree = (input: {
      readonly card: KanbanCard;
      readonly project: OrchestrationProject;
      readonly updatedAt: string;
    }): Effect.Effect<PreparedWorktree, KanbanWorkerCoordinatorError> =>
      Effect.gen(function* () {
        if (input.card.worktreePath) {
          const details = yield* gitCore.statusDetails(input.card.worktreePath).pipe(
            Effect.mapError((cause) =>
              coordinatorError({
                reason: "worktree",
                detail: `Failed to inspect card worktree '${input.card.worktreePath}'.`,
                cause,
              }),
            ),
          );
          if (details.hasWorkingTreeChanges) {
            return yield* Effect.fail(
              coordinatorError({
                reason: "worktree",
                detail: `Card worktree '${input.card.worktreePath}' has uncommitted changes.`,
              }),
            );
          }
          const branch = input.card.branch ?? details.branch;
          if (!branch) {
            return yield* Effect.fail(
              coordinatorError({
                reason: "worktree",
                detail: `Card worktree '${input.card.worktreePath}' is detached.`,
              }),
            );
          }
          const prepared = {
            path: input.card.worktreePath,
            branch,
            associatedWorktreePath: input.card.associatedWorktreePath ?? input.card.worktreePath,
            associatedWorktreeBranch: input.card.associatedWorktreeBranch ?? branch,
            associatedWorktreeRef: input.card.associatedWorktreeRef ?? branch,
          } satisfies PreparedWorktree;
          yield* kanbanEngine
            .dispatch({
              type: "kanban.card.worktree.set",
              commandId: commandId("kanban-worktree-set"),
              cardId: input.card.id,
              branch: prepared.branch,
              worktreePath: prepared.path,
              associatedWorktreePath: prepared.associatedWorktreePath,
              associatedWorktreeBranch: prepared.associatedWorktreeBranch,
              associatedWorktreeRef: prepared.associatedWorktreeRef,
              updatedAt: input.updatedAt,
            })
            .pipe(
              Effect.mapError((cause) =>
                coordinatorError({
                  reason: "worktree",
                  detail: `Failed to persist card worktree metadata for '${input.card.id}'.`,
                  cause,
                }),
              ),
            );
          return prepared;
        }

        const baseDetails = yield* gitCore.statusDetails(input.project.workspaceRoot).pipe(
          Effect.mapError((cause) =>
            coordinatorError({
              reason: "worktree",
              detail: `Failed to inspect project workspace '${input.project.workspaceRoot}'.`,
              cause,
            }),
          ),
        );
        const baseBranch = input.card.branch ?? baseDetails.branch;
        if (!baseBranch) {
          return yield* Effect.fail(
            coordinatorError({
              reason: "worktree",
              detail: `Project workspace '${input.project.workspaceRoot}' is detached.`,
            }),
          );
        }

        const newBranch = buildBroCodeBranchName(`kanban-${input.card.id}`);
        const worktree = yield* gitCore
          .createWorktree({
            cwd: input.project.workspaceRoot,
            branch: baseBranch,
            newBranch,
            path: null,
          })
          .pipe(
            Effect.mapError((cause) =>
              coordinatorError({
                reason: "worktree",
                detail: `Failed to create card worktree for '${input.card.id}'.`,
                cause,
              }),
            ),
          );

        const prepared = {
          path: worktree.worktree.path,
          branch: worktree.worktree.branch,
          associatedWorktreePath: worktree.worktree.path,
          associatedWorktreeBranch: worktree.worktree.branch,
          associatedWorktreeRef: worktree.worktree.branch,
        } satisfies PreparedWorktree;

        yield* kanbanEngine
          .dispatch({
            type: "kanban.card.worktree.set",
            commandId: commandId("kanban-worktree-set"),
            cardId: input.card.id,
            branch: prepared.branch,
            worktreePath: prepared.path,
            associatedWorktreePath: prepared.associatedWorktreePath,
            associatedWorktreeBranch: prepared.associatedWorktreeBranch,
            associatedWorktreeRef: prepared.associatedWorktreeRef,
            updatedAt: input.updatedAt,
          })
          .pipe(
            Effect.mapError((cause) =>
              coordinatorError({
                reason: "worktree",
                detail: `Failed to persist card worktree metadata for '${input.card.id}'.`,
                cause,
              }),
            ),
          );

        return prepared;
      });

    const observeWorkerRun = (input: WorkerObservationJob): Effect.Effect<void> => {
      const missingThreadGraceAttempts = 300;
      const poll = (missingAttempts: number): Effect.Effect<WorkerObservationState> =>
        orchestrationSnapshotQuery.getThreadDetailById(input.threadId).pipe(
          Effect.catch(() => Effect.succeed(Option.none())),
          Effect.map((thread) =>
            Option.match(thread, {
              onNone: (): WorkerObservationState => ({ _tag: "missing-thread" }),
              onSome: inspectWorkerThread,
            }),
          ),
          Effect.flatMap((state) => {
            if (state._tag === "missing-thread") {
              if (missingAttempts >= missingThreadGraceAttempts) {
                return Effect.succeed({
                  _tag: "terminal-error" as const,
                  status: "failed" as const,
                  message: "Worker thread was not found",
                });
              }
              return Effect.sleep("100 millis").pipe(
                Effect.flatMap(() => poll(missingAttempts + 1)),
              );
            }
            if (state._tag !== "pending") {
              return Effect.succeed(state);
            }
            return Effect.sleep("100 millis").pipe(
              Effect.flatMap(() => poll(missingAttempts)),
            );
          }),
        );

      return Effect.gen(function* () {
        const state = yield* poll(0);
        if (state._tag === "terminal-error") {
          yield* completeRun({
            cardId: input.card.id,
            runId: input.runId,
            status: state.status,
            errorMessage: state.message,
          });
          return;
        }
        if (state._tag !== "completed") {
          yield* completeRun({
            cardId: input.card.id,
            runId: input.runId,
            status: "failed",
            errorMessage: "Worker observation ended without a terminal result",
          });
          return;
        }

        const parsed = yield* Effect.try({
          try: () => parseKanbanWorkerSummary(state.text, input.tasks),
          catch: (cause) =>
            coordinatorError({
              reason: "summary-parse",
              detail: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }).pipe(
          Effect.catch((error) =>
            completeRun({
              cardId: input.card.id,
              runId: input.runId,
              status: "failed",
              errorMessage: error.detail,
            }).pipe(
              Effect.flatMap(() => Effect.fail(error)),
            ),
          ),
        );

        const applySummary = Effect.gen(function* () {
          const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
          const generatedTaskPrefix = `kanban-worker-${input.runId}-`;
          const baseTaskCount = input.tasks.filter(
            (task) => !task.id.startsWith(generatedTaskPrefix),
          ).length;
          for (const [index, generatedTask] of parsed.generatedTasks.entries()) {
            const id = generatedTaskId(input.runId, index);
            const existingTask = tasksById.get(id);
            yield* kanbanEngine
              .dispatch({
                type: "kanban.task.upsert",
                commandId: commandId("kanban-worker-generated-task"),
                cardId: input.card.id,
                task: {
                  taskId: id,
                  title: generatedTask.title,
                  ...(generatedTask.description !== undefined
                    ? { description: generatedTask.description }
                    : {}),
                  status: generatedTask.status,
                  order: existingTask?.order ?? baseTaskCount + index,
                },
                updatedAt: new Date().toISOString(),
              })
              .pipe(Effect.asVoid);
          }

          for (const update of parsed.taskUpdates) {
            const existingTask = tasksById.get(update.taskId);
            if (!existingTask) {
              continue;
            }
            yield* kanbanEngine
              .dispatch({
                type: "kanban.task.upsert",
                commandId: commandId("kanban-worker-task-update"),
                cardId: input.card.id,
                task: {
                  taskId: existingTask.id,
                  title: existingTask.title,
                  ...(existingTask.description !== undefined
                    ? { description: existingTask.description }
                    : {}),
                  status: update.status,
                  order: existingTask.order,
                },
                updatedAt: new Date().toISOString(),
              })
              .pipe(Effect.asVoid);
          }
        });

        const applied = yield* Effect.exit(applySummary);
        if (applied._tag === "Failure") {
          yield* completeRun({
            cardId: input.card.id,
            runId: input.runId,
            status: "failed",
            errorMessage: "Failed to apply worker summary updates",
          });
          return;
        }

        yield* completeRun({ cardId: input.card.id, runId: input.runId, status: "completed" });
      }).pipe(Effect.catch((error) => Effect.logWarning(error.message)));
    };

    yield* Effect.forkScoped(
      Effect.forever(
        Queue.take(observationQueue).pipe(
          Effect.flatMap((job) => Effect.forkScoped(observeWorkerRun(job)).pipe(Effect.asVoid)),
          Effect.catch((error) =>
            Effect.logWarning(error instanceof Error ? error.message : String(error)),
          ),
        ),
      ),
    );

    const reattachRunningWorkerRuns = Effect.gen(function* () {
      const readModel = yield* kanbanEngine.getReadModel();
      for (const run of readModel.runs) {
        if (run.role !== "worker" || run.status !== "running" || !run.threadId) {
          continue;
        }
        const card = readModel.cards.find((entry) => entry.id === run.cardId);
        if (!card) {
          continue;
        }
        const tasks = findCardTasks(readModel.tasks, card);
        const thread = yield* orchestrationSnapshotQuery.getThreadDetailById(run.threadId).pipe(
          Effect.catch(() => Effect.succeed(Option.none())),
        );
        if (Option.isSome(thread) && isThreadWaitingForFirstWorkerTurn(thread.value)) {
          const worktree = worktreeFromCard(card);
          if (!worktree) {
            yield* completeRun({
              cardId: card.id,
              runId: run.id,
              status: "failed",
              errorMessage: "Worker run is missing worktree metadata after restart",
            });
            continue;
          }
          const repaired = yield* Effect.exit(
            startWorkerTurn({
              card,
              tasks,
              threadId: run.threadId,
              worktree,
              createdAt: new Date().toISOString(),
            }),
          );
          if (repaired._tag === "Failure") {
            yield* completeRun({
              cardId: card.id,
              runId: run.id,
              status: "failed",
              errorMessage: "Failed to restart worker turn after restart",
            });
            continue;
          }
        }
        yield* Queue.offer(observationQueue, {
          card,
          tasks,
          runId: run.id,
          threadId: run.threadId,
        });
      }
    });

    return KanbanWorkerCoordinator.of({
      start: () => reattachRunningWorkerRuns.pipe(Effect.catch(() => Effect.void)),
      startWorkerRun: (input) =>
        Effect.gen(function* () {
          const startedAt = new Date().toISOString();
          const kanbanReadModel = yield* kanbanEngine.getReadModel();
          const card = kanbanReadModel.cards.find((entry) => entry.id === input.cardId);
          if (!card) {
            return yield* Effect.fail(
              coordinatorError({
                reason: "not-found",
                detail: `Kanban card '${input.cardId}' was not found.`,
              }),
            );
          }
          if (card.status !== "ready") {
            return yield* Effect.fail(
              coordinatorError({
                reason: "invalid-state",
                detail: `Kanban card '${input.cardId}' must be ready before starting a worker run.`,
              }),
            );
          }

          const orchestrationReadModel = yield* orchestrationSnapshotQuery.getSnapshot().pipe(
            Effect.mapError((cause) =>
              coordinatorError({
                reason: "not-found",
                detail: "Failed to load orchestration project snapshot.",
                cause,
              }),
            ),
          );
          const project = findProject(orchestrationReadModel.projects, card);
          if (!project?.workspaceRoot) {
            return yield* Effect.fail(
              coordinatorError({
                reason: "not-found",
                detail: `Project '${card.projectId}' was not found for Kanban card '${card.id}'.`,
              }),
            );
          }

          const tasks = findCardTasks(kanbanReadModel.tasks, card);
          const worktree = yield* prepareWorktree({ card, project, updatedAt: startedAt });
          const workerThreadId = threadId();
          const workerRunId = runId();

          const createThreadCommand: OrchestrationCommand = {
            type: "thread.create",
            commandId: commandId("kanban-worker-thread-create"),
            threadId: workerThreadId,
            projectId: card.projectId,
            title: `Worker: ${card.title}`,
            modelSelection: card.modelSelection,
            runtimeMode: card.runtimeMode,
            interactionMode: "default",
            envMode: "worktree",
            branch: worktree.branch,
            worktreePath: worktree.path,
            associatedWorktreePath: worktree.associatedWorktreePath,
            associatedWorktreeBranch: worktree.associatedWorktreeBranch,
            associatedWorktreeRef: worktree.associatedWorktreeRef,
            parentThreadId: card.sourceThreadId ?? null,
            subagentRole: "kanban-worker",
            createBranchFlowCompleted: true,
            createdAt: startedAt,
          };

          yield* kanbanEngine
            .dispatch({
              type: "kanban.run.start",
              commandId: commandId("kanban-worker-run-start"),
              runId: workerRunId,
              cardId: card.id,
              role: "worker",
              threadId: workerThreadId,
              startedAt,
            })
            .pipe(
              Effect.mapError((cause) =>
                coordinatorError({
                  reason: "provider-dispatch",
                  detail: `Failed to record worker run start for card '${card.id}'.`,
                  cause,
                }),
              ),
            );

          yield* orchestrationEngine.dispatch(createThreadCommand).pipe(
            Effect.mapError((cause) =>
              coordinatorError({
                reason: "provider-dispatch",
                detail: `Failed to create worker thread for card '${card.id}'.`,
                cause,
              }),
            ),
            Effect.catch((error) =>
              completeRun({
                cardId: card.id,
                runId: workerRunId,
                status: "failed",
                errorMessage: error.detail,
              }).pipe(Effect.flatMap(() => Effect.fail(error))),
            ),
          );

          yield* startWorkerTurn({
            card,
            tasks,
            threadId: workerThreadId,
            worktree,
            createdAt: startedAt,
          }).pipe(
            Effect.catch((error) =>
              completeRun({
                cardId: card.id,
                runId: workerRunId,
                status: "failed",
                errorMessage: error.detail,
              }).pipe(Effect.flatMap(() => Effect.fail(error))),
            ),
          );

          yield* Queue.offer(
            observationQueue,
            {
              card,
              tasks,
              runId: workerRunId,
              threadId: workerThreadId,
            },
          ).pipe(Effect.asVoid);

          return {
            runId: workerRunId,
            threadId: workerThreadId,
          };
        }),
    });
  }),
);
