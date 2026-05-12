import type {
  CommandId,
  KanbanBoard,
  KanbanBoardId,
  KanbanCard,
  KanbanCardId,
  KanbanCardStatus,
  KanbanCommand,
  KanbanEvent,
  KanbanReadModel,
  KanbanRun,
  KanbanRunId,
  KanbanTask,
} from "@t3tools/contracts";
import { Effect, Schema } from "effect";

type KanbanDecision =
  | Omit<KanbanEvent, "sequence">
  | ReadonlyArray<Omit<KanbanEvent, "sequence">>;

const DEFAULT_MAX_LOOP_COUNT = 3;

const allowedStatusTransitions: Readonly<Record<KanbanCardStatus, ReadonlySet<KanbanCardStatus>>> = {
  draft: new Set(["ready", "blocked"]),
  ready: new Set(["draft", "implementing", "blocked"]),
  implementing: new Set(["reviewing", "blocked", "agent_error", "loop_limit_reached"]),
  reviewing: new Set(["needs_work", "approved", "blocked", "review_inconclusive"]),
  needs_work: new Set(["implementing", "ready", "blocked", "loop_limit_reached"]),
  approved: new Set(["ready_to_submit"]),
  ready_to_submit: new Set(["submitted", "blocked"]),
  submitted: new Set([]),
  blocked: new Set(["ready"]),
  loop_limit_reached: new Set(["ready"]),
  agent_error: new Set(["ready"]),
  review_inconclusive: new Set(["ready", "needs_work"]),
};

export class KanbanCommandInvariantError extends Schema.TaggedErrorClass<KanbanCommandInvariantError>()(
  "KanbanCommandInvariantError",
  {
    commandType: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Kanban command invariant failed (${this.commandType}): ${this.detail}`;
  }
}

function eventBase(input: {
  readonly aggregateKind: "board" | "card";
  readonly aggregateId: KanbanBoardId | KanbanCardId;
  readonly occurredAt: string;
  readonly commandId: CommandId;
}): Omit<KanbanEvent, "sequence" | "type" | "payload"> {
  return {
    eventId: crypto.randomUUID() as KanbanEvent["eventId"],
    aggregateKind: input.aggregateKind,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    correlationId: input.commandId,
    causationEventId: null,
    metadata: {},
  };
}

function fail(
  command: KanbanCommand,
  detail: string,
): Effect.Effect<never, KanbanCommandInvariantError> {
  return Effect.fail(
    new KanbanCommandInvariantError({
      commandType: command.type,
      detail,
    }),
  );
}

function findBoard(readModel: KanbanReadModel, boardId: KanbanBoardId): KanbanBoard | undefined {
  return readModel.boards.find((board) => board.id === boardId);
}

function findCard(readModel: KanbanReadModel, cardId: KanbanCardId): KanbanCard | undefined {
  return readModel.cards.find((card) => card.id === cardId);
}

function findRun(readModel: KanbanReadModel, runId: KanbanRunId): KanbanRun | undefined {
  return readModel.runs.find((run) => run.id === runId);
}

function requireBoard(
  command: KanbanCommand,
  readModel: KanbanReadModel,
  boardId: KanbanBoardId,
): Effect.Effect<KanbanBoard, KanbanCommandInvariantError> {
  const board = findBoard(readModel, boardId);
  return board === undefined
    ? fail(command, `Board '${boardId}' does not exist.`)
    : Effect.succeed(board);
}

function requireCard(
  command: KanbanCommand,
  readModel: KanbanReadModel,
  cardId: KanbanCardId,
): Effect.Effect<KanbanCard, KanbanCommandInvariantError> {
  const card = findCard(readModel, cardId);
  return card === undefined
    ? fail(command, `Card '${cardId}' does not exist.`)
    : Effect.succeed(card);
}

function requireStatusTransition(
  command: KanbanCommand,
  fromStatus: KanbanCardStatus,
  toStatus: KanbanCardStatus,
): Effect.Effect<void, KanbanCommandInvariantError> {
  if (fromStatus === toStatus) return Effect.void;
  if (allowedStatusTransitions[fromStatus]?.has(toStatus) === true) return Effect.void;
  return fail(command, `Invalid card status transition from '${fromStatus}' to '${toStatus}'.`);
}

function statusChangedEvent(input: {
  readonly command: KanbanCommand;
  readonly card: KanbanCard;
  readonly toStatus: KanbanCardStatus;
  readonly reason: string | null;
  readonly updatedAt: string;
}): Omit<KanbanEvent, "sequence"> {
  return {
    ...eventBase({
      aggregateKind: "card",
      aggregateId: input.card.id,
      occurredAt: input.updatedAt,
      commandId: input.command.commandId,
    }),
    type: "kanban.card.status-changed",
    payload: {
      cardId: input.card.id,
      fromStatus: input.card.status,
      toStatus: input.toStatus,
      reason: input.reason,
      updatedAt: input.updatedAt,
    },
  };
}

function buildTask(input: {
  readonly command: Extract<KanbanCommand, { readonly type: "kanban.card.create" }>;
  readonly taskInput: Extract<
    KanbanCommand,
    { readonly type: "kanban.card.create" }
  >["tasks"][number];
}): KanbanTask {
  return {
    id: input.taskInput.taskId,
    cardId: input.command.cardId,
    title: input.taskInput.title,
    ...(input.taskInput.description !== undefined
      ? { description: input.taskInput.description }
      : {}),
    status: input.taskInput.status,
    order: input.taskInput.order,
    createdAt: input.command.createdAt,
    updatedAt: input.command.createdAt,
  };
}

function buildCard(
  command: Extract<KanbanCommand, { readonly type: "kanban.card.create" }>,
): KanbanCard {
  return {
    id: command.cardId,
    boardId: command.boardId,
    projectId: command.projectId,
    sourceThreadId: command.sourceThreadId ?? null,
    workerThreadIds: [],
    reviewerThreadIds: [],
    title: command.title,
    ...(command.description !== undefined ? { description: command.description } : {}),
    specPath: command.specPath,
    status: "draft",
    modelSelection: command.modelSelection,
    runtimeMode: command.runtimeMode,
    branch: command.branch ?? null,
    worktreePath: command.worktreePath ?? null,
    associatedWorktreePath: command.associatedWorktreePath ?? null,
    associatedWorktreeBranch: command.associatedWorktreeBranch ?? null,
    associatedWorktreeRef: command.associatedWorktreeRef ?? null,
    blockerReason: null,
    loopCount: 0,
    maxLoopCount: DEFAULT_MAX_LOOP_COUNT,
    createdAt: command.createdAt,
    updatedAt: command.createdAt,
  };
}

function buildUpdatedCard(
  card: KanbanCard,
  command: Extract<KanbanCommand, { readonly type: "kanban.card.update" }>,
): KanbanCard {
  const next: KanbanCard = {
    ...card,
    updatedAt: command.updatedAt,
  };
  if (command.title !== undefined) next.title = command.title;
  if (command.description !== undefined) {
    if (command.description === null) {
      delete next.description;
    } else {
      next.description = command.description;
    }
  }
  if (command.specPath !== undefined) {
    if (command.specPath === null) {
      delete next.specPath;
    } else {
      next.specPath = command.specPath;
    }
  }
  if (command.modelSelection !== undefined) next.modelSelection = command.modelSelection;
  if (command.runtimeMode !== undefined) next.runtimeMode = command.runtimeMode;
  return next;
}

function buildUpsertedTask(input: {
  readonly card: KanbanCard;
  readonly existingTask: KanbanTask | undefined;
  readonly command: Extract<KanbanCommand, { readonly type: "kanban.task.upsert" }>;
}): KanbanTask {
  return {
    id: input.command.task.taskId,
    cardId: input.card.id,
    title: input.command.task.title,
    ...(input.command.task.description !== undefined
      ? { description: input.command.task.description }
      : {}),
    status: input.command.task.status,
    order: input.command.task.order,
    createdAt: input.existingTask?.createdAt ?? input.command.updatedAt,
    updatedAt: input.command.updatedAt,
  };
}

function targetStatusForRunStart(
  command: Extract<KanbanCommand, { readonly type: "kanban.run.start" }>,
): KanbanCardStatus {
  return command.role === "worker" ? "implementing" : "reviewing";
}

export const decideKanbanCommand = Effect.fn("decideKanbanCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: KanbanCommand;
  readonly readModel: KanbanReadModel;
}): Effect.fn.Return<KanbanDecision, KanbanCommandInvariantError> {
  switch (command.type) {
    case "kanban.board.create": {
      if (findBoard(readModel, command.boardId) !== undefined) {
        return yield* fail(command, `Board '${command.boardId}' already exists.`);
      }
      return {
        ...eventBase({
          aggregateKind: "board",
          aggregateId: command.boardId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "kanban.board.created",
        payload: {
          board: {
            id: command.boardId,
            projectId: command.projectId,
            title: command.title,
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        },
      };
    }

    case "kanban.card.create": {
      const board = yield* requireBoard(command, readModel, command.boardId);
      if (board.projectId !== command.projectId) {
        return yield* fail(
          command,
          `Board '${command.boardId}' belongs to project '${board.projectId}', not '${command.projectId}'.`,
        );
      }
      if (findCard(readModel, command.cardId) !== undefined) {
        return yield* fail(command, `Card '${command.cardId}' already exists.`);
      }
      if (command.specPath === undefined) {
        return yield* fail(command, "Card creation requires specPath.");
      }

      const card = buildCard(command);
      return {
        ...eventBase({
          aggregateKind: "card",
          aggregateId: command.cardId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "kanban.card.created",
        payload: {
          card,
          tasks: command.tasks.map((taskInput) => buildTask({ command, taskInput })),
        },
      };
    }

    case "kanban.card.update": {
      const card = yield* requireCard(command, readModel, command.cardId);
      if (command.specPath === null) {
        return yield* fail(command, "Card update cannot clear specPath.");
      }
      return {
        ...eventBase({
          aggregateKind: "card",
          aggregateId: command.cardId,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        }),
        type: "kanban.card.updated",
        payload: {
          card: buildUpdatedCard(card, command),
        },
      };
    }

    case "kanban.card.status.set": {
      const card = yield* requireCard(command, readModel, command.cardId);
      yield* requireStatusTransition(command, card.status, command.status);
      return statusChangedEvent({
        command,
        card,
        toStatus: command.status,
        reason: command.reason ?? null,
        updatedAt: command.updatedAt,
      });
    }

    case "kanban.task.upsert": {
      const card = yield* requireCard(command, readModel, command.cardId);
      const existingTask = readModel.tasks.find(
        (task) => task.cardId === command.cardId && task.id === command.task.taskId,
      );
      return {
        ...eventBase({
          aggregateKind: "card",
          aggregateId: command.cardId,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        }),
        type: "kanban.task.upserted",
        payload: {
          task: buildUpsertedTask({ card, existingTask, command }),
        },
      };
    }

    case "kanban.task.delete": {
      yield* requireCard(command, readModel, command.cardId);
      return {
        ...eventBase({
          aggregateKind: "card",
          aggregateId: command.cardId,
          occurredAt: command.deletedAt,
          commandId: command.commandId,
        }),
        type: "kanban.task.deleted",
        payload: {
          cardId: command.cardId,
          taskId: command.taskId,
          deletedAt: command.deletedAt,
        },
      };
    }

    case "kanban.run.start": {
      const card = yield* requireCard(command, readModel, command.cardId);
      if (findRun(readModel, command.runId) !== undefined) {
        return yield* fail(command, `Run '${command.runId}' already exists.`);
      }
      const toStatus = targetStatusForRunStart(command);
      yield* requireStatusTransition(command, card.status, toStatus);
      const run: KanbanRun = {
        id: command.runId,
        cardId: command.cardId,
        role: command.role,
        status: "running",
        threadId: command.threadId,
        startedAt: command.startedAt,
      };
      return [
        statusChangedEvent({
          command,
          card,
          toStatus,
          reason: null,
          updatedAt: command.startedAt,
        }),
        {
          ...eventBase({
            aggregateKind: "card",
            aggregateId: command.cardId,
            occurredAt: command.startedAt,
            commandId: command.commandId,
          }),
          type: "kanban.run.started",
          payload: { run },
        },
      ];
    }

    case "kanban.run.complete": {
      const run = findRun(readModel, command.runId);
      if (run === undefined || run.cardId !== command.cardId) {
        return yield* fail(
          command,
          `Run '${command.runId}' does not exist for card '${command.cardId}'.`,
        );
      }
      return {
        ...eventBase({
          aggregateKind: "card",
          aggregateId: command.cardId,
          occurredAt: command.completedAt,
          commandId: command.commandId,
        }),
        type: "kanban.run.completed",
        payload: {
          run: {
            ...run,
            status: command.status,
            ...(command.errorMessage !== undefined ? { errorMessage: command.errorMessage } : {}),
            completedAt: command.completedAt,
          },
        },
      };
    }

    case "kanban.review.complete": {
      yield* requireCard(command, readModel, command.review.cardId);
      const run = findRun(readModel, command.review.runId);
      if (run === undefined) {
        return yield* fail(command, `Run '${command.review.runId}' does not exist.`);
      }
      return {
        ...eventBase({
          aggregateKind: "card",
          aggregateId: command.review.cardId,
          occurredAt: command.review.completedAt,
          commandId: command.commandId,
        }),
        type: "kanban.review.completed",
        payload: {
          review: command.review,
        },
      };
    }

    case "kanban.card.block": {
      const card = yield* requireCard(command, readModel, command.cardId);
      yield* requireStatusTransition(command, card.status, "blocked");
      return {
        ...eventBase({
          aggregateKind: "card",
          aggregateId: command.cardId,
          occurredAt: command.blockedAt,
          commandId: command.commandId,
        }),
        type: "kanban.card.blocked",
        payload: {
          cardId: command.cardId,
          reason: command.reason,
          blockedAt: command.blockedAt,
        },
      };
    }

    case "kanban.card.approve": {
      const card = yield* requireCard(command, readModel, command.cardId);
      yield* requireStatusTransition(command, card.status, "approved");
      return {
        ...eventBase({
          aggregateKind: "card",
          aggregateId: command.cardId,
          occurredAt: command.approvedAt,
          commandId: command.commandId,
        }),
        type: "kanban.card.approved",
        payload: {
          cardId: command.cardId,
          approvedAt: command.approvedAt,
        },
      };
    }

    case "kanban.card.ready-to-submit": {
      const card = yield* requireCard(command, readModel, command.cardId);
      yield* requireStatusTransition(command, card.status, "ready_to_submit");
      return {
        ...eventBase({
          aggregateKind: "card",
          aggregateId: command.cardId,
          occurredAt: command.readyAt,
          commandId: command.commandId,
        }),
        type: "kanban.card.ready-to-submit",
        payload: {
          cardId: command.cardId,
          readyAt: command.readyAt,
        },
      };
    }
  }
});
