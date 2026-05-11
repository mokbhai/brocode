import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import OS from "node:os";
import Path from "node:path";

import {
  CommandId,
  MessageId,
  ProjectId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { planLegacyProjectThreadImport } from "./legacyDataImport";

const now = "2026-05-11T00:00:00.000Z";

function emptyReadModel(): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [],
    updatedAt: now,
  };
}

function createLegacyDb() {
  const dir = mkdtempSync(Path.join(OS.tmpdir(), "brocode-legacy-import-"));
  const dbPath = Path.join(dir, "state.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE projection_projects (
      project_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'project',
      title TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      default_model_selection_json TEXT,
      scripts_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      model_selection_json TEXT,
      runtime_mode TEXT NOT NULL,
      interaction_mode TEXT NOT NULL,
      env_mode TEXT NOT NULL DEFAULT 'local',
      branch TEXT,
      worktree_path TEXT,
      associated_worktree_path TEXT,
      associated_worktree_branch TEXT,
      associated_worktree_ref TEXT,
      create_branch_flow_completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE projection_thread_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      is_streaming INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const insertProject = db.prepare(`
    INSERT INTO projection_projects (
      project_id,
      title,
      workspace_root,
      default_model_selection_json,
      scripts_json,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (?, ?, ?, ?, '[]', ?, ?, ?)
  `);
  insertProject.run(
    "legacy-project",
    "Legacy Project",
    "/workspace/legacy",
    '{"provider":"codex","model":"gpt-5.5"}',
    "2026-01-01T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
    null,
  );
  insertProject.run(
    "deleted-project",
    "Deleted Project",
    "/workspace/deleted",
    '{"provider":"codex","model":"gpt-5.5"}',
    "2026-01-01T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
    "2026-01-03T00:00:00.000Z",
  );

  db.prepare(`
    INSERT INTO projection_threads (
      thread_id,
      project_id,
      title,
      model_selection_json,
      runtime_mode,
      interaction_mode,
      env_mode,
      branch,
      worktree_path,
      associated_worktree_path,
      associated_worktree_branch,
      associated_worktree_ref,
      create_branch_flow_completed,
      created_at,
      updated_at,
      archived_at,
      deleted_at
    )
    VALUES (?, ?, ?, ?, 'full-access', 'default', 'worktree', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(
    "legacy-thread",
    "legacy-project",
    "Legacy Thread",
    '{"provider":"codex","model":"gpt-5.5"}',
    "feature/import",
    "/workspace/legacy-worktree",
    "/workspace/legacy-worktree",
    "feature/import",
    "feature/import",
    "2026-01-01T00:10:00.000Z",
    "2026-01-02T00:10:00.000Z",
    null,
    null,
  );
  db.prepare(`
    INSERT INTO projection_thread_messages (
      message_id,
      thread_id,
      role,
      text,
      is_streaming,
      created_at,
      updated_at
    )
    VALUES ('legacy-message', 'legacy-thread', 'user', 'old chat text', 0, ?, ?)
  `).run("2026-01-01T00:11:00.000Z", "2026-01-01T00:11:00.000Z");

  db.close();
  return {
    dbPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("planLegacyProjectThreadImport", () => {
  it("plans active project, thread, and message imports", () => {
    const legacy = createLegacyDb();
    try {
      const result = planLegacyProjectThreadImport({
        sourceDbPath: legacy.dbPath,
        targetReadModel: emptyReadModel(),
        importedAt: "2026-05-11T01:00:00.000Z",
      });

      expect(result.summary).toEqual({
        sourceProjectCount: 1,
        sourceThreadCount: 1,
        sourceMessageCount: 1,
        projectsCreated: 1,
        projectsReused: 0,
        threadsCreated: 1,
        threadsSkipped: 0,
        messagesImported: 1,
        messagesSkipped: 0,
      });
      expect(result.commands.map((command) => command.type)).toEqual([
        "project.create",
        "thread.create",
        "thread.messages.import",
      ]);
      expect(result.commands[0]).toMatchObject({
        projectId: "legacy-project",
        title: "Legacy Project",
        workspaceRoot: "/workspace/legacy",
      });
      expect(result.commands[1]).toMatchObject({
        threadId: "legacy-thread",
        projectId: "legacy-project",
        title: "Legacy Thread",
        branch: "feature/import",
        worktreePath: "/workspace/legacy-worktree",
      });
      expect(result.commands[2]).toMatchObject({
        threadId: "legacy-thread",
        messages: [
          {
            messageId: "legacy-message",
            role: "user",
            text: "old chat text",
            createdAt: "2026-01-01T00:11:00.000Z",
            updatedAt: "2026-01-01T00:11:00.000Z",
          },
        ],
      });
    } finally {
      legacy.cleanup();
    }
  });

  it("reuses existing project and thread shells while importing missing messages", () => {
    const legacy = createLegacyDb();
    try {
      const targetReadModel = emptyReadModel();
      targetReadModel.projects.push({
        id: ProjectId.makeUnsafe("current-project"),
        kind: "project",
        title: "Current Project",
        workspaceRoot: "/workspace/legacy",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      targetReadModel.threads.push({
        id: ThreadId.makeUnsafe("legacy-thread"),
        projectId: ProjectId.makeUnsafe("current-project"),
        title: "Already Here",
        modelSelection: { provider: "codex", model: "gpt-5.5" },
        runtimeMode: "full-access",
        interactionMode: "default",
        envMode: "local",
        branch: null,
        worktreePath: null,
        associatedWorktreePath: null,
        associatedWorktreeBranch: null,
        associatedWorktreeRef: null,
        createBranchFlowCompleted: false,
        parentThreadId: null,
        subagentAgentId: null,
        subagentNickname: null,
        subagentRole: null,
        forkSourceThreadId: null,
        sidechatSourceThreadId: null,
        lastKnownPr: null,
        latestTurn: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        deletedAt: null,
        handoff: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      });

      const result = planLegacyProjectThreadImport({
        sourceDbPath: legacy.dbPath,
        targetReadModel,
        importedAt: "2026-05-11T01:00:00.000Z",
      });

      expect(result.summary).toMatchObject({
        projectsCreated: 0,
        projectsReused: 1,
        threadsCreated: 0,
        threadsSkipped: 1,
        messagesImported: 1,
        messagesSkipped: 0,
      });
      expect(result.commands).toEqual<OrchestrationCommand[]>([
        {
          type: "thread.messages.import",
          commandId: CommandId.makeUnsafe("legacy-import-thread-messages-legacy-thread"),
          threadId: ThreadId.makeUnsafe("legacy-thread"),
          messages: [
            {
              messageId: MessageId.makeUnsafe("legacy-message"),
              role: "user",
              text: "old chat text",
              createdAt: "2026-01-01T00:11:00.000Z",
              updatedAt: "2026-01-01T00:11:00.000Z",
            },
          ],
          createdAt: "2026-05-11T01:00:00.000Z",
        },
      ]);
    } finally {
      legacy.cleanup();
    }
  });

  it("skips messages that already exist in target threads", () => {
    const legacy = createLegacyDb();
    try {
      const targetReadModel = emptyReadModel();
      targetReadModel.projects.push({
        id: ProjectId.makeUnsafe("current-project"),
        kind: "project",
        title: "Current Project",
        workspaceRoot: "/workspace/legacy",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      targetReadModel.threads.push({
        id: ThreadId.makeUnsafe("legacy-thread"),
        projectId: ProjectId.makeUnsafe("current-project"),
        title: "Already Here",
        modelSelection: { provider: "codex", model: "gpt-5.5" },
        runtimeMode: "full-access",
        interactionMode: "default",
        envMode: "local",
        branch: null,
        worktreePath: null,
        associatedWorktreePath: null,
        associatedWorktreeBranch: null,
        associatedWorktreeRef: null,
        createBranchFlowCompleted: false,
        parentThreadId: null,
        subagentAgentId: null,
        subagentNickname: null,
        subagentRole: null,
        forkSourceThreadId: null,
        sidechatSourceThreadId: null,
        lastKnownPr: null,
        latestTurn: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        deletedAt: null,
        handoff: null,
        messages: [
          {
            id: MessageId.makeUnsafe("legacy-message"),
            role: "user",
            text: "old chat text",
            turnId: null,
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
      });

      const result = planLegacyProjectThreadImport({
        sourceDbPath: legacy.dbPath,
        targetReadModel,
        importedAt: "2026-05-11T01:00:00.000Z",
      });

      expect(result.summary).toMatchObject({
        projectsCreated: 0,
        projectsReused: 1,
        threadsCreated: 0,
        threadsSkipped: 1,
        messagesImported: 0,
        messagesSkipped: 1,
      });
      expect(result.commands).toEqual<OrchestrationCommand[]>([]);
    } finally {
      legacy.cleanup();
    }
  });
});
