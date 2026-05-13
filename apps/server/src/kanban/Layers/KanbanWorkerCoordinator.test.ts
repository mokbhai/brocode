import type {
  KanbanCommand,
  KanbanReadModel,
  OrchestrationCommand,
  OrchestrationReadModel,
  OrchestrationThread,
} from "@t3tools/contracts";
import {
  CommandId,
  KanbanBoardId,
  KanbanCardId,
  KanbanTaskId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime, Option, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { GitCore, type GitCoreShape } from "../../git/Services/GitCore.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { KanbanEngineService } from "../Services/KanbanEngine.ts";
import { KanbanSnapshotQuery } from "../Services/KanbanSnapshotQuery.ts";
import { KanbanWorkerCoordinator } from "../Services/KanbanWorkerCoordinator.ts";
import { KanbanWorkerCoordinatorLive } from "./KanbanWorkerCoordinator.ts";

const now = "2026-05-12T00:00:00.000Z";
const boardId = KanbanBoardId.makeUnsafe("board-worker");
const cardId = KanbanCardId.makeUnsafe("card-worker");
const projectId = ProjectId.makeUnsafe("project-worker");

function makeKanbanReadModel(status: KanbanReadModel["cards"][number]["status"] = "ready"): KanbanReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: now,
    boards: [{ id: boardId, projectId, title: "Worker board", createdAt: now, updatedAt: now }],
    cards: [
      {
        id: cardId,
        boardId,
        projectId,
        sourceThreadId: ThreadId.makeUnsafe("thread-source"),
        workerThreadIds: [],
        reviewerThreadIds: [],
        title: "Implement worker run",
        description: "Use docs/spec.md",
        status,
        modelSelection: { provider: "codex", model: "gpt-5" },
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        associatedWorktreePath: null,
        associatedWorktreeBranch: null,
        associatedWorktreeRef: null,
        blockerReason: null,
        loopCount: 0,
        maxLoopCount: 3,
        createdAt: now,
        updatedAt: now,
      },
    ],
    tasks: [],
    runs: [],
    reviews: [],
  };
}

function makeExistingRunReadModel(): KanbanReadModel {
  return {
    ...makeKanbanReadModel("implementing"),
    cards: [
      {
        ...makeKanbanReadModel().cards[0]!,
        status: "implementing",
        workerThreadIds: [ThreadId.makeUnsafe("thread-existing-worker")],
      },
    ],
    runs: [
      {
        id: "run-existing-worker" as any,
        cardId,
        role: "worker",
        status: "running",
        threadId: ThreadId.makeUnsafe("thread-existing-worker"),
        startedAt: now,
      },
    ],
  };
}

function makeExistingRunWithWorktreeReadModel(): KanbanReadModel {
  return {
    ...makeExistingRunReadModel(),
    cards: [
      {
        ...makeExistingRunReadModel().cards[0]!,
        branch: "brocode/kanban-card-worker",
        worktreePath: "/repo/.worktrees/card-worker",
        associatedWorktreePath: "/repo/.worktrees/card-worker",
        associatedWorktreeBranch: "brocode/kanban-card-worker",
        associatedWorktreeRef: "brocode/kanban-card-worker",
      },
    ],
  };
}

function makeExistingGeneratedTaskReadModel(): KanbanReadModel {
  return {
    ...makeExistingRunReadModel(),
    tasks: [
      {
        id: KanbanTaskId.makeUnsafe("kanban-worker-run-existing-worker-0"),
        cardId,
        title: "Add payload tests",
        status: "done",
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

function makeExistingWorktreeReadModel(): KanbanReadModel {
  return {
    ...makeKanbanReadModel(),
    cards: [
      {
        ...makeKanbanReadModel().cards[0]!,
        branch: "brocode/existing-card-worker",
        worktreePath: "/repo/.worktrees/existing-card-worker",
        associatedWorktreePath: null,
        associatedWorktreeBranch: null,
        associatedWorktreeRef: null,
      },
    ],
  };
}

function makeOrchestrationReadModel(): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: now,
    projects: [
      {
        id: projectId,
        kind: "project",
        title: "Worker project",
        workspaceRoot: "/repo",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [],
  } as OrchestrationReadModel;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for expectation.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function makeCompletedWorkerThread(threadId: ThreadId, assistantText?: string): OrchestrationThread {
  return {
    id: threadId,
    projectId,
    kind: "thread",
    title: "Worker: Implement worker run",
    modelSelection: { provider: "codex", model: "gpt-5" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    envMode: "worktree",
    branch: "brocode/kanban-card-worker",
    worktreePath: "/repo/.worktrees/card-worker",
    associatedWorktreePath: "/repo/.worktrees/card-worker",
    associatedWorktreeBranch: "brocode/kanban-card-worker",
    associatedWorktreeRef: "brocode/kanban-card-worker",
    createBranchFlowCompleted: true,
    parentThreadId: ThreadId.makeUnsafe("thread-source"),
    subagentAgentId: null,
    subagentNickname: null,
    subagentRole: "kanban-worker",
    forkSourceThreadId: null,
    sidechatSourceThreadId: null,
    lastKnownPr: null,
    latestTurn: {
      turnId: "turn-worker" as any,
      state: "completed",
      requestedAt: now,
      startedAt: now,
      completedAt: now,
      assistantMessageId: "assistant-worker" as any,
    },
    latestUserMessageAt: now,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    handoff: null,
    messages: [
      {
        id: "assistant-worker" as any,
        role: "assistant",
        text:
          assistantText ??
          [
            "Done.",
            "```json",
            JSON.stringify({
              summary: "Generated the checklist.",
              generatedTasks: [{ title: "Add payload tests", status: "done" }],
              taskUpdates: [],
            }),
            "```",
          ].join("\n"),
        attachments: [],
        turnId: "turn-worker" as any,
        streaming: false,
        source: "native",
        createdAt: now,
        updatedAt: now,
      },
    ],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  } as OrchestrationThread;
}

function makeFailedWorkerThread(threadId: ThreadId): OrchestrationThread {
  return {
    ...makeCompletedWorkerThread(threadId),
    latestTurn: {
      turnId: "turn-worker" as any,
      state: "running",
      requestedAt: now,
      startedAt: now,
      completedAt: null,
      assistantMessageId: null,
    },
    messages: [],
    activities: [
      {
        id: "event-provider-failed" as any,
        tone: "error",
        kind: "provider.turn.start.failed",
        summary: "Provider turn start failed",
        payload: {},
        turnId: null,
        sequence: 1,
        createdAt: now,
      },
    ],
  } as OrchestrationThread;
}

function makeWaitingWorkerThread(threadId: ThreadId): OrchestrationThread {
  return {
    ...makeCompletedWorkerThread(threadId),
    latestTurn: null,
    latestUserMessageAt: null,
    messages: [],
  } as OrchestrationThread;
}

function makeHarness(input: {
  readonly kanbanReadModel?: KanbanReadModel;
  readonly orchestrationReadModel?: OrchestrationReadModel;
  readonly workerThread?: OrchestrationThread;
  readonly kanbanDispatchOverride?: (
    command: KanbanCommand,
    commands: KanbanCommand[],
  ) => Effect.Effect<{ sequence: number }, unknown>;
  readonly orchestrationDispatchOverride?: (
    command: OrchestrationCommand,
    commands: OrchestrationCommand[],
  ) => Effect.Effect<{ sequence: number }, unknown>;
}) {
  const kanbanCommands: KanbanCommand[] = [];
  const orchestrationCommands: OrchestrationCommand[] = [];
  const createWorktree = vi.fn<GitCoreShape["createWorktree"]>(() =>
    Effect.succeed({ worktree: { path: "/repo/.worktrees/card-worker", branch: "brocode/kanban-card-worker" } }),
  );
  const statusDetails = vi.fn<GitCoreShape["statusDetails"]>((cwd) =>
    Effect.succeed({
      branch: cwd === "/repo" ? "main" : "brocode/kanban-card-worker",
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: false,
      aheadCount: 0,
      behindCount: 0,
      upstreamRef: null,
    }),
  );

  const kanbanEngine = {
    getReadModel: () => Effect.succeed(input.kanbanReadModel ?? makeKanbanReadModel()),
    readEvents: () => Stream.empty,
    dispatch: (command: KanbanCommand) =>
      input.kanbanDispatchOverride?.(command, kanbanCommands) ??
      Effect.sync(() => {
        kanbanCommands.push(command);
        return { sequence: kanbanCommands.length };
      }),
    streamDomainEvents: Stream.empty,
  };
  const orchestrationEngine = {
    getReadModel: () => Effect.succeed(input.orchestrationReadModel ?? makeOrchestrationReadModel()),
    readEvents: () => Stream.empty,
    dispatch: (command: OrchestrationCommand) =>
      input.orchestrationDispatchOverride?.(command, orchestrationCommands) ??
      Effect.sync(() => {
        orchestrationCommands.push(command);
        return { sequence: orchestrationCommands.length };
      }),
    repairState: () => Effect.succeed(input.orchestrationReadModel ?? makeOrchestrationReadModel()),
    streamDomainEvents: Stream.empty,
  };
  const orchestrationSnapshotQuery = {
    getSnapshot: () => Effect.succeed(input.orchestrationReadModel ?? makeOrchestrationReadModel()),
    getCounts: () => Effect.succeed({ projectCount: 1, threadCount: 0 }),
    getShellSnapshot: () => Effect.die("unused"),
    getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
    getProjectShellById: () => Effect.die("unused"),
    getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
    getThreadCheckpointContext: () => Effect.die("unused"),
    getThreadShellById: () => Effect.die("unused"),
    getThreadDetailById: () =>
      Effect.succeed(
        input.workerThread === undefined ? Option.none() : Option.some(input.workerThread),
      ),
    getThreadDetailSnapshotById: () => Effect.die("unused"),
  };
  const gitCore: Partial<GitCoreShape> = {
    statusDetails,
    createWorktree,
  };

  const layer = KanbanWorkerCoordinatorLive.pipe(
    Layer.provideMerge(Layer.succeed(KanbanEngineService, kanbanEngine)),
    Layer.provideMerge(Layer.succeed(KanbanSnapshotQuery, {
      getReadModel: () => Effect.succeed(input.kanbanReadModel ?? makeKanbanReadModel()),
      getSnapshot: () => Effect.die("unused"),
    })),
    Layer.provideMerge(Layer.succeed(OrchestrationEngineService, orchestrationEngine)),
    Layer.provideMerge(Layer.succeed(ProjectionSnapshotQuery, orchestrationSnapshotQuery)),
    Layer.provideMerge(Layer.succeed(GitCore, gitCore as GitCoreShape)),
    Layer.provideMerge(
      ServerSettingsService.layerTest({
        enableCodexBrowserTool: true,
        providers: { codex: { binaryPath: "codex-dev", homePath: "/tmp/codex-home" } },
      }),
    ),
  );
  const runtime = ManagedRuntime.make(layer);

  return {
    runtime,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    kanbanCommands,
    orchestrationCommands,
    createWorktree,
    statusDetails,
  };
}

describe("KanbanWorkerCoordinator", () => {
  it("rejects cards that are not ready", async () => {
    const harness = makeHarness({ kanbanReadModel: makeKanbanReadModel("draft") });
    const coordinator = await harness.run(Effect.service(KanbanWorkerCoordinator));

    const exit = await harness.run(Effect.exit(coordinator.startWorkerRun({ cardId })));

    expect(exit._tag).toBe("Failure");
    expect(harness.kanbanCommands).toEqual([]);
    expect(harness.orchestrationCommands).toEqual([]);
    await harness.runtime.dispose();
  });

  it("creates a card worktree and starts a BroCode worker thread through orchestration", async () => {
    const harness = makeHarness({});
    const coordinator = await harness.run(Effect.service(KanbanWorkerCoordinator));

    const result = await harness.run(coordinator.startWorkerRun({ cardId }));

    expect(result.runId).toBeTruthy();
    expect(result.threadId).toBeTruthy();
    expect(harness.createWorktree).toHaveBeenCalledWith({
      cwd: "/repo",
      branch: "main",
      newBranch: "brocode/kanban-card-worker",
      path: null,
    });
    expect(harness.kanbanCommands.map((command) => command.type)).toEqual([
      "kanban.card.worktree.set",
      "kanban.run.start",
    ]);
    expect(harness.kanbanCommands[0]).toMatchObject({
      type: "kanban.card.worktree.set",
      cardId,
      branch: "brocode/kanban-card-worker",
      worktreePath: "/repo/.worktrees/card-worker",
    });
    expect(harness.orchestrationCommands.map((command) => command.type)).toEqual([
      "thread.create",
      "thread.turn.start",
    ]);
    expect(harness.orchestrationCommands[0]).toMatchObject({
      type: "thread.create",
      projectId,
      title: "Worker: Implement worker run",
      modelSelection: { provider: "codex", model: "gpt-5" },
      runtimeMode: "approval-required",
      interactionMode: "default",
      envMode: "worktree",
      branch: "brocode/kanban-card-worker",
      worktreePath: "/repo/.worktrees/card-worker",
      parentThreadId: "thread-source",
      subagentRole: "kanban-worker",
      createBranchFlowCompleted: true,
    });
    expect(harness.orchestrationCommands[1]).toMatchObject({
      type: "thread.turn.start",
      threadId: result.threadId,
      runtimeMode: "approval-required",
      interactionMode: "default",
      modelSelection: { provider: "codex", model: "gpt-5" },
      providerOptions: {
        codex: {
          binaryPath: "codex-dev",
          homePath: "/tmp/codex-home",
          enableBrowserTool: true,
        },
      },
      message: {
        role: "user",
        attachments: [],
      },
    });
    expect((harness.orchestrationCommands[1] as any).message.text).toContain(
      "Implement worker run",
    );
    await harness.runtime.dispose();
  });

  it("reuses a clean existing card worktree and persists normalized metadata", async () => {
    const harness = makeHarness({ kanbanReadModel: makeExistingWorktreeReadModel() });
    const coordinator = await harness.run(Effect.service(KanbanWorkerCoordinator));

    await harness.run(coordinator.startWorkerRun({ cardId }));

    expect(harness.createWorktree).not.toHaveBeenCalled();
    expect(harness.statusDetails).toHaveBeenCalledWith("/repo/.worktrees/existing-card-worker");
    expect(harness.kanbanCommands[0]).toMatchObject({
      type: "kanban.card.worktree.set",
      cardId,
      branch: "brocode/existing-card-worker",
      worktreePath: "/repo/.worktrees/existing-card-worker",
      associatedWorktreePath: "/repo/.worktrees/existing-card-worker",
      associatedWorktreeBranch: "brocode/existing-card-worker",
      associatedWorktreeRef: "brocode/existing-card-worker",
    });
    expect(harness.orchestrationCommands[0]).toMatchObject({
      type: "thread.create",
      branch: "brocode/existing-card-worker",
      worktreePath: "/repo/.worktrees/existing-card-worker",
    });
    await harness.runtime.dispose();
  });

  it("parses a completed worker summary into generated tasks before completing the run", async () => {
    let createdThreadId: ThreadId | null = null;
    const harness = makeHarness({
      get workerThread() {
        return createdThreadId ? makeCompletedWorkerThread(createdThreadId) : undefined;
      },
    } as any);
    const coordinator = await harness.run(Effect.service(KanbanWorkerCoordinator));

    const result = await harness.run(coordinator.startWorkerRun({ cardId }));
    createdThreadId = result.threadId;
    await waitFor(() =>
      harness.kanbanCommands.some((command) => command.type === "kanban.run.complete"),
    );

    expect(harness.kanbanCommands.map((command) => command.type)).toEqual([
      "kanban.card.worktree.set",
      "kanban.run.start",
      "kanban.task.upsert",
      "kanban.run.complete",
    ]);
    expect(harness.kanbanCommands[2]).toMatchObject({
      type: "kanban.task.upsert",
      cardId,
      task: {
        taskId: `kanban-worker-${result.runId}-0`,
        title: "Add payload tests",
        status: "done",
        order: 0,
      },
    });
    expect(harness.kanbanCommands[3]).toMatchObject({
      type: "kanban.run.complete",
      cardId,
      runId: result.runId,
      status: "completed",
    });
    await harness.runtime.dispose();
  });

  it("fails the run without task changes when the worker summary is malformed", async () => {
    let createdThreadId: ThreadId | null = null;
    const malformedSummary = ["```json", JSON.stringify({ summary: "Missing arrays" }), "```"].join(
      "\n",
    );
    const harness = makeHarness({
      get workerThread() {
        return createdThreadId
          ? makeCompletedWorkerThread(createdThreadId, malformedSummary)
          : undefined;
      },
    } as any);
    const coordinator = await harness.run(Effect.service(KanbanWorkerCoordinator));

    const result = await harness.run(coordinator.startWorkerRun({ cardId }));
    createdThreadId = result.threadId;
    await waitFor(() =>
      harness.kanbanCommands.some((command) => command.type === "kanban.run.complete"),
    );

    expect(harness.kanbanCommands.map((command) => command.type)).toEqual([
      "kanban.card.worktree.set",
      "kanban.run.start",
      "kanban.run.complete",
    ]);
    expect(harness.kanbanCommands[2]).toMatchObject({
      type: "kanban.run.complete",
      cardId,
      runId: result.runId,
      status: "failed",
      errorMessage: expect.stringMatching(/generatedTasks/i),
    });
    await harness.runtime.dispose();
  });

  it("fails the run when provider turn start failure is projected", async () => {
    let createdThreadId: ThreadId | null = null;
    const harness = makeHarness({
      get workerThread() {
        return createdThreadId ? makeFailedWorkerThread(createdThreadId) : undefined;
      },
    } as any);
    const coordinator = await harness.run(Effect.service(KanbanWorkerCoordinator));

    const result = await harness.run(coordinator.startWorkerRun({ cardId }));
    createdThreadId = result.threadId;
    await waitFor(() =>
      harness.kanbanCommands.some((command) => command.type === "kanban.run.complete"),
    );

    expect(harness.kanbanCommands.map((command) => command.type)).toEqual([
      "kanban.card.worktree.set",
      "kanban.run.start",
      "kanban.run.complete",
    ]);
    expect(harness.kanbanCommands[2]).toMatchObject({
      type: "kanban.run.complete",
      cardId,
      runId: result.runId,
      status: "failed",
      errorMessage: "Provider turn start failed",
    });
    await harness.runtime.dispose();
  });

  it("marks the run failed when turn start dispatch fails after run start", async () => {
    const failingHarness = makeHarness({
      orchestrationDispatchOverride: (command, commands) => {
        commands.push(command);
        return command.type === "thread.turn.start"
          ? Effect.fail(new Error("turn start exploded"))
          : Effect.succeed({ sequence: commands.length });
      },
    });
    const failingCoordinator = await failingHarness.run(Effect.service(KanbanWorkerCoordinator));
    const exit = await failingHarness.run(Effect.exit(failingCoordinator.startWorkerRun({ cardId })));

    expect(exit._tag).toBe("Failure");
    expect(failingHarness.kanbanCommands.map((command) => command.type)).toEqual([
      "kanban.card.worktree.set",
      "kanban.run.start",
      "kanban.run.complete",
    ]);
    expect(failingHarness.kanbanCommands[2]).toMatchObject({
      type: "kanban.run.complete",
      status: "failed",
      errorMessage: expect.stringContaining("Failed to start worker turn"),
    });
    await failingHarness.runtime.dispose();
  });

  it("does not create a worker thread when another request already started the run", async () => {
    const harness = makeHarness({
      kanbanDispatchOverride: (command, commands) => {
        commands.push(command);
        return command.type === "kanban.run.start"
          ? Effect.fail(new Error("card is already implementing"))
          : Effect.succeed({ sequence: commands.length });
      },
    });
    const coordinator = await harness.run(Effect.service(KanbanWorkerCoordinator));

    const exit = await harness.run(Effect.exit(coordinator.startWorkerRun({ cardId })));

    expect(exit._tag).toBe("Failure");
    expect(harness.kanbanCommands.map((command) => command.type)).toEqual([
      "kanban.card.worktree.set",
      "kanban.run.start",
    ]);
    expect(harness.orchestrationCommands).toEqual([]);
    await harness.runtime.dispose();
  });

  it("reattaches observation for running worker runs on layer startup", async () => {
    const harness = makeHarness({
      kanbanReadModel: makeExistingRunReadModel(),
      workerThread: makeCompletedWorkerThread(ThreadId.makeUnsafe("thread-existing-worker")),
    });
    const coordinator = await harness.run(Effect.service(KanbanWorkerCoordinator));
    await harness.run(coordinator.start());
    await waitFor(() =>
      harness.kanbanCommands.some((command) => command.type === "kanban.run.complete"),
    );

    expect(harness.kanbanCommands.map((command) => command.type)).toEqual([
      "kanban.task.upsert",
      "kanban.run.complete",
    ]);
    expect(harness.kanbanCommands[1]).toMatchObject({
      type: "kanban.run.complete",
      runId: "run-existing-worker",
      status: "completed",
    });
    await harness.runtime.dispose();
  });

  it("restarts the worker turn on startup when a running thread has no turn yet", async () => {
    const threadId = ThreadId.makeUnsafe("thread-existing-worker");
    const harness = makeHarness({
      kanbanReadModel: makeExistingRunWithWorktreeReadModel(),
      workerThread: makeWaitingWorkerThread(threadId),
    });

    const coordinator = await harness.run(Effect.service(KanbanWorkerCoordinator));
    await harness.run(coordinator.start());
    await waitFor(() =>
      harness.orchestrationCommands.some((command) => command.type === "thread.turn.start"),
    );

    expect(harness.orchestrationCommands).toHaveLength(1);
    expect(harness.orchestrationCommands[0]).toMatchObject({
      type: "thread.turn.start",
      threadId,
      runtimeMode: "approval-required",
      modelSelection: { provider: "codex", model: "gpt-5" },
    });
    expect((harness.orchestrationCommands[0] as any).message.text).toContain(
      "Implement worker run",
    );
    expect(harness.kanbanCommands).toEqual([]);
    await harness.runtime.dispose();
  });

  it("replays generated worker tasks idempotently after a partial summary application", async () => {
    const harness = makeHarness({
      kanbanReadModel: makeExistingGeneratedTaskReadModel(),
      workerThread: makeCompletedWorkerThread(ThreadId.makeUnsafe("thread-existing-worker")),
    });

    const coordinator = await harness.run(Effect.service(KanbanWorkerCoordinator));
    await harness.run(coordinator.start());
    await waitFor(() =>
      harness.kanbanCommands.some((command) => command.type === "kanban.run.complete"),
    );

    expect(harness.kanbanCommands.map((command) => command.type)).toEqual([
      "kanban.task.upsert",
      "kanban.run.complete",
    ]);
    expect(harness.kanbanCommands[0]).toMatchObject({
      type: "kanban.task.upsert",
      task: {
        taskId: "kanban-worker-run-existing-worker-0",
        title: "Add payload tests",
        status: "done",
        order: 0,
      },
    });
    expect(harness.kanbanCommands[1]).toMatchObject({
      type: "kanban.run.complete",
      runId: "run-existing-worker",
      status: "completed",
    });
    await harness.runtime.dispose();
  });
});
