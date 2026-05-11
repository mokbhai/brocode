// FILE: legacyDataImport.ts
// Purpose: Import project/thread/message data from older DPCode/T3Code/BroCode state databases.

import { DatabaseSync } from "node:sqlite";

import {
  CommandId,
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  MessageId,
  ProjectId,
  type ServerLegacyDataSource,
  ThreadId,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { Effect, FileSystem, Path } from "effect";

import { deriveServerPaths } from "./config";
import type { OrchestrationEngineShape } from "./orchestration/Services/OrchestrationEngine";

type DbValue = string | number | bigint | Buffer | null;
type DbRow = Record<string, DbValue | undefined>;

interface LegacyProjectRow {
  readonly projectId: string;
  readonly kind: "project" | "chat";
  readonly title: string;
  readonly workspaceRoot: string;
  readonly defaultModelSelection: ModelSelection | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface LegacyThreadRow {
  readonly threadId: string;
  readonly projectId: string;
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: "approval-required" | "full-access";
  readonly interactionMode: "default" | "plan";
  readonly envMode: "local" | "worktree";
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly associatedWorktreePath: string | null;
  readonly associatedWorktreeBranch: string | null;
  readonly associatedWorktreeRef: string | null;
  readonly createBranchFlowCompleted: boolean;
  readonly createdAt: string;
}

interface LegacyThreadMessageRow {
  readonly messageId: string;
  readonly threadId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LegacyDataImportSummary {
  readonly sourceProjectCount: number;
  readonly sourceThreadCount: number;
  readonly sourceMessageCount: number;
  readonly projectsCreated: number;
  readonly projectsReused: number;
  readonly threadsCreated: number;
  readonly threadsSkipped: number;
  readonly messagesImported: number;
  readonly messagesSkipped: number;
}

export interface LegacyDataImportPlan {
  readonly commands: OrchestrationCommand[];
  readonly summary: LegacyDataImportSummary;
}

export interface LegacyDataImportResult extends LegacyDataImportSummary {
  readonly sourceDbPath: string;
}

interface LegacySourceCandidate {
  readonly kind: "dpcode" | "t3code";
  readonly label: string;
  readonly baseDir: string;
  readonly profile: "userdata" | "dev";
  readonly stateDir: string;
  readonly dbPath: string;
}

const DEFAULT_MODEL_SELECTION: ModelSelection = {
  provider: "codex",
  model: DEFAULT_GIT_TEXT_GENERATION_MODEL,
};

function asString(value: DbValue | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asOptionalText(value: DbValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function asIsoString(value: DbValue | undefined, fallback: string): string {
  return asString(value) ?? fallback;
}

function asBoolean(value: DbValue | undefined): boolean {
  return value === 1 || value === true || value === "1" || value === "true";
}

function asProjectKind(value: DbValue | undefined): "project" | "chat" {
  return value === "chat" ? "chat" : "project";
}

function asRuntimeMode(value: DbValue | undefined): "approval-required" | "full-access" {
  return value === "approval-required" ? "approval-required" : "full-access";
}

function asInteractionMode(value: DbValue | undefined): "default" | "plan" {
  return value === "plan" ? "plan" : "default";
}

function asEnvMode(value: DbValue | undefined): "local" | "worktree" {
  return value === "worktree" ? "worktree" : "local";
}

function asMessageRole(value: DbValue | undefined): "user" | "assistant" | null {
  return value === "user" || value === "assistant" ? value : null;
}

function normalizeModelSelection(value: unknown): ModelSelection | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as { readonly provider?: unknown; readonly model?: unknown };
  const provider = candidate.provider;
  const model = candidate.model;
  if (
    (provider === "codex" ||
      provider === "claudeAgent" ||
      provider === "cursor" ||
      provider === "gemini" ||
      provider === "opencode") &&
    typeof model === "string" &&
    model.trim().length > 0
  ) {
    return { provider, model: model.trim() } as ModelSelection;
  }
  return null;
}

function parseModelSelectionJson(value: DbValue | undefined): ModelSelection | null {
  const raw = asString(value);
  if (!raw) return null;
  try {
    return normalizeModelSelection(JSON.parse(raw));
  } catch {
    return null;
  }
}

function inferModelSelection(model: string | null): ModelSelection {
  if (!model) return DEFAULT_MODEL_SELECTION;
  return {
    provider: model.toLowerCase().includes("claude") ? "claudeAgent" : "codex",
    model,
  } as ModelSelection;
}

function readRows(db: DatabaseSync, tableName: string): DbRow[] {
  const tableExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  if (!tableExists) {
    return [];
  }
  return db.prepare(`SELECT * FROM ${tableName}`).all() as DbRow[];
}

function readLegacyProjects(db: DatabaseSync, importedAt: string): LegacyProjectRow[] {
  return readRows(db, "projection_projects")
    .filter((row) => asString(row.deleted_at) === null)
    .flatMap((row) => {
      const projectId = asString(row.project_id);
      const title = asString(row.title);
      const workspaceRoot = asString(row.workspace_root);
      if (!projectId || !title || !workspaceRoot) {
        return [];
      }
      return [
        {
          projectId,
          kind: asProjectKind(row.kind),
          title,
          workspaceRoot,
          defaultModelSelection:
            parseModelSelectionJson(row.default_model_selection_json) ??
            (asString(row.default_model) ? inferModelSelection(asString(row.default_model)) : null),
          createdAt: asIsoString(row.created_at, importedAt),
          updatedAt: asIsoString(row.updated_at, importedAt),
        },
      ];
    });
}

function readLegacyThreads(db: DatabaseSync, importedAt: string): LegacyThreadRow[] {
  return readRows(db, "projection_threads")
    .filter((row) => asString(row.deleted_at) === null)
    .flatMap((row) => {
      const threadId = asString(row.thread_id);
      const projectId = asString(row.project_id);
      const title = asString(row.title);
      if (!threadId || !projectId || !title) {
        return [];
      }
      return [
        {
          threadId,
          projectId,
          title,
          modelSelection:
            parseModelSelectionJson(row.model_selection_json) ??
            inferModelSelection(asString(row.model)),
          runtimeMode: asRuntimeMode(row.runtime_mode),
          interactionMode: asInteractionMode(row.interaction_mode),
          envMode: asEnvMode(row.env_mode),
          branch: asString(row.branch),
          worktreePath: asString(row.worktree_path),
          associatedWorktreePath: asString(row.associated_worktree_path),
          associatedWorktreeBranch: asString(row.associated_worktree_branch),
          associatedWorktreeRef: asString(row.associated_worktree_ref),
          createBranchFlowCompleted: asBoolean(row.create_branch_flow_completed),
          createdAt: asIsoString(row.created_at, importedAt),
        },
      ];
    });
}

function readLegacyThreadMessages(db: DatabaseSync, importedAt: string): LegacyThreadMessageRow[] {
  return readRows(db, "projection_thread_messages").flatMap((row) => {
    const messageId = asString(row.message_id);
    const threadId = asString(row.thread_id);
    const role = asMessageRole(row.role);
    const text = asOptionalText(row.text);
    if (!messageId || !threadId || !role || text === null) {
      return [];
    }
    return [
      {
        messageId,
        threadId,
        role,
        text,
        createdAt: asIsoString(row.created_at, importedAt),
        updatedAt: asIsoString(row.updated_at, importedAt),
      },
    ];
  });
}

function inspectLegacyDataSource(input: {
  readonly kind: "dpcode" | "t3code" | "custom";
  readonly label: string;
  readonly dbPath: string;
  readonly stateDir: string;
  readonly exists: boolean;
}): ServerLegacyDataSource {
  if (!input.exists) {
    return {
      kind: input.kind,
      label: input.label,
      dbPath: input.dbPath,
      stateDir: input.stateDir,
      exists: false,
      projectCount: 0,
      threadCount: 0,
      messageCount: 0,
    };
  }

  try {
    const db = new DatabaseSync(input.dbPath, { readOnly: true });
    try {
      const importedAt = new Date().toISOString();
      return {
        kind: input.kind,
        label: input.label,
        dbPath: input.dbPath,
        stateDir: input.stateDir,
        exists: true,
        projectCount: readLegacyProjects(db, importedAt).length,
        threadCount: readLegacyThreads(db, importedAt).length,
        messageCount: readLegacyThreadMessages(db, importedAt).length,
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      kind: input.kind,
      label: input.label,
      dbPath: input.dbPath,
      stateDir: input.stateDir,
      exists: true,
      projectCount: 0,
      threadCount: 0,
      messageCount: 0,
      error: error instanceof Error ? error.message : "Unable to inspect this database.",
    };
  }
}

function workspaceRootsEqual(left: string, right: string): boolean {
  return left === right;
}

function importedProjectId(sourceProjectId: string, index: number): ProjectId {
  return ProjectId.makeUnsafe(`legacy-import-${index}-${sourceProjectId}`);
}

export function planLegacyProjectThreadImport(input: {
  readonly sourceDbPath: string;
  readonly targetReadModel: OrchestrationReadModel;
  readonly importedAt: string;
}): LegacyDataImportPlan {
  const db = new DatabaseSync(input.sourceDbPath, { readOnly: true });
  try {
    const sourceProjects = readLegacyProjects(db, input.importedAt);
    const sourceThreads = readLegacyThreads(db, input.importedAt);
    const sourceMessages = readLegacyThreadMessages(db, input.importedAt);
    const activeTargetProjects = input.targetReadModel.projects.filter(
      (project) => project.deletedAt === null,
    );
    const targetThreadIds = new Set(input.targetReadModel.threads.map((thread) => thread.id));
    const targetMessageIds = new Set(
      input.targetReadModel.threads.flatMap((thread) =>
        thread.messages.map((message) => message.id),
      ),
    );

    const commands: OrchestrationCommand[] = [];
    const sourceProjectToTargetProject = new Map<string, ProjectId>();
    const importableThreadIds = new Set<string>();
    let projectsCreated = 0;
    let projectsReused = 0;

    for (const [index, sourceProject] of sourceProjects.entries()) {
      const existingById = activeTargetProjects.find(
        (project) => project.id === sourceProject.projectId,
      );
      const existingByWorkspaceRoot = activeTargetProjects.find((project) =>
        workspaceRootsEqual(project.workspaceRoot, sourceProject.workspaceRoot),
      );
      const existing = existingById ?? existingByWorkspaceRoot;
      if (existing) {
        sourceProjectToTargetProject.set(sourceProject.projectId, existing.id);
        projectsReused += 1;
        continue;
      }

      const targetProjectId =
        input.targetReadModel.projects.some((project) => project.id === sourceProject.projectId) ||
        commands.some(
          (command) => command.type === "project.create" && command.projectId === sourceProject.projectId,
        )
          ? importedProjectId(sourceProject.projectId, index + 1)
          : ProjectId.makeUnsafe(sourceProject.projectId);
      sourceProjectToTargetProject.set(sourceProject.projectId, targetProjectId);
      projectsCreated += 1;
      commands.push({
        type: "project.create",
        commandId: CommandId.makeUnsafe(`legacy-import-project-${targetProjectId}`),
        projectId: targetProjectId,
        kind: sourceProject.kind,
        title: sourceProject.title,
        workspaceRoot: sourceProject.workspaceRoot,
        createWorkspaceRootIfMissing: false,
        defaultModelSelection: sourceProject.defaultModelSelection,
        createdAt: sourceProject.createdAt,
      });
    }

    let threadsCreated = 0;
    let threadsSkipped = 0;
    for (const sourceThread of sourceThreads) {
      if (targetThreadIds.has(ThreadId.makeUnsafe(sourceThread.threadId))) {
        importableThreadIds.add(sourceThread.threadId);
        threadsSkipped += 1;
        continue;
      }
      const projectId = sourceProjectToTargetProject.get(sourceThread.projectId);
      if (!projectId) {
        threadsSkipped += 1;
        continue;
      }
      importableThreadIds.add(sourceThread.threadId);
      threadsCreated += 1;
      commands.push({
        type: "thread.create",
        commandId: CommandId.makeUnsafe(`legacy-import-thread-${sourceThread.threadId}`),
        threadId: ThreadId.makeUnsafe(sourceThread.threadId),
        projectId,
        title: sourceThread.title,
        modelSelection: sourceThread.modelSelection,
        runtimeMode: sourceThread.runtimeMode,
        interactionMode: sourceThread.interactionMode,
        envMode: sourceThread.envMode,
        branch: sourceThread.branch,
        worktreePath: sourceThread.worktreePath,
        associatedWorktreePath: sourceThread.associatedWorktreePath,
        associatedWorktreeBranch: sourceThread.associatedWorktreeBranch,
        associatedWorktreeRef: sourceThread.associatedWorktreeRef,
        createBranchFlowCompleted: sourceThread.createBranchFlowCompleted,
        parentThreadId: null,
        subagentAgentId: null,
        subagentNickname: null,
        subagentRole: null,
        lastKnownPr: null,
        createdAt: sourceThread.createdAt,
      });
    }

    const messagesByThreadId = new Map<string, LegacyThreadMessageRow[]>();
    for (const sourceMessage of sourceMessages) {
      const messages = messagesByThreadId.get(sourceMessage.threadId) ?? [];
      messages.push(sourceMessage);
      messagesByThreadId.set(sourceMessage.threadId, messages);
    }

    let messagesImported = 0;
    let messagesSkipped = 0;
    for (const [threadId, threadMessages] of messagesByThreadId) {
      if (!importableThreadIds.has(threadId)) {
        messagesSkipped += threadMessages.length;
        continue;
      }
      const missingMessages = threadMessages.filter(
        (message) => !targetMessageIds.has(MessageId.makeUnsafe(message.messageId)),
      );
      messagesSkipped += threadMessages.length - missingMessages.length;
      if (missingMessages.length === 0) {
        continue;
      }
      messagesImported += missingMessages.length;
      commands.push({
        type: "thread.messages.import",
        commandId: CommandId.makeUnsafe(`legacy-import-thread-messages-${threadId}`),
        threadId: ThreadId.makeUnsafe(threadId),
        messages: missingMessages.map((message) => ({
          messageId: MessageId.makeUnsafe(message.messageId),
          role: message.role,
          text: message.text,
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
        })),
        createdAt: input.importedAt,
      });
    }

    return {
      commands,
      summary: {
        sourceProjectCount: sourceProjects.length,
        sourceThreadCount: sourceThreads.length,
        sourceMessageCount: sourceMessages.length,
        projectsCreated,
        projectsReused,
        threadsCreated,
        threadsSkipped,
        messagesImported,
        messagesSkipped,
      },
    };
  } finally {
    db.close();
  }
}

export const importLegacyProjectThreads = (input: {
  readonly sourceDbPath: string;
  readonly orchestrationEngine: OrchestrationEngineShape;
}) =>
  Effect.gen(function* () {
    const importedAt = new Date().toISOString();
    const targetReadModel = yield* input.orchestrationEngine.getReadModel();
    const plan = planLegacyProjectThreadImport({
      sourceDbPath: input.sourceDbPath,
      targetReadModel,
      importedAt,
    });
    for (const command of plan.commands) {
      yield* input.orchestrationEngine.dispatch(command);
    }
    return {
      sourceDbPath: input.sourceDbPath,
      ...plan.summary,
    } satisfies LegacyDataImportResult;
  });

export const listLegacyDataSources = (input: {
  readonly homeDir: string;
  readonly currentDbPath: string;
  readonly devUrl: URL | undefined;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const legacyHomes = [
      {
        kind: "dpcode" as const,
        label: "DPCode home",
        baseDir: path.join(input.homeDir, ".dpcode"),
      },
      {
        kind: "t3code" as const,
        label: "T3Code home",
        baseDir: path.join(input.homeDir, ".t3"),
      },
    ];
    const candidates: LegacySourceCandidate[] = [];
    for (const legacyHome of legacyHomes) {
      const profiles = [
        { profile: "userdata" as const, devUrl: undefined },
        { profile: "dev" as const, devUrl: input.devUrl },
      ];
      for (const { profile, devUrl } of profiles) {
        const paths = yield* deriveServerPaths(legacyHome.baseDir, devUrl);
        candidates.push({
          ...legacyHome,
          profile,
          stateDir: paths.stateDir,
          dbPath: paths.dbPath,
        });
      }
    }

    const seen = new Set<string>();
    const sources: ServerLegacyDataSource[] = [];
    for (const candidate of candidates) {
      const resolvedDbPath = path.resolve(candidate.dbPath);
      if (seen.has(resolvedDbPath) || resolvedDbPath === path.resolve(input.currentDbPath)) {
        continue;
      }
      seen.add(resolvedDbPath);
      const exists = yield* fs.exists(candidate.dbPath).pipe(Effect.catch(() => Effect.succeed(false)));
      sources.push(
        inspectLegacyDataSource({
          kind: candidate.kind,
          label: candidate.profile === "dev" ? `${candidate.label} (dev)` : candidate.label,
          dbPath: candidate.dbPath,
          stateDir: candidate.stateDir,
          exists,
        }),
      );
    }
    return { sources };
  });
