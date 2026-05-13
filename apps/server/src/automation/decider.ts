import type {
  Automation,
  AutomationClientSettableStatus,
  AutomationCommand,
  AutomationEvent,
  AutomationId,
  AutomationReadModel,
  AutomationRun,
  AutomationRunId,
  AutomationRunStatus,
  CommandId,
} from "@t3tools/contracts";
import { Effect, Schema } from "effect";

type AutomationDecision =
  | Omit<AutomationEvent, "sequence">
  | ReadonlyArray<Omit<AutomationEvent, "sequence">>;
type ActiveAutomation = Automation & { readonly status: AutomationClientSettableStatus };

const terminalRunStatuses = new Set<AutomationRunStatus>([
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);

export class AutomationCommandInvariantError extends Schema.TaggedErrorClass<AutomationCommandInvariantError>()(
  "AutomationCommandInvariantError",
  {
    commandType: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Automation command invariant failed (${this.commandType}): ${this.detail}`;
  }
}

function eventBase(input: {
  readonly aggregateKind: "automation" | "automationRun";
  readonly aggregateId: AutomationId | AutomationRunId;
  readonly occurredAt: string;
  readonly commandId: CommandId;
}): Omit<AutomationEvent, "sequence" | "type" | "payload"> {
  return {
    eventId: crypto.randomUUID() as AutomationEvent["eventId"],
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
  command: AutomationCommand,
  detail: string,
): Effect.Effect<never, AutomationCommandInvariantError> {
  return Effect.fail(
    new AutomationCommandInvariantError({
      commandType: command.type,
      detail,
    }),
  );
}

function findAutomation(
  readModel: AutomationReadModel,
  automationId: AutomationId,
): Automation | undefined {
  return readModel.automations.find((automation) => automation.id === automationId);
}

function findRun(readModel: AutomationReadModel, runId: AutomationRunId): AutomationRun | undefined {
  return readModel.runs.find((run) => run.id === runId);
}

function requireAutomation(
  command: AutomationCommand,
  readModel: AutomationReadModel,
  automationId: AutomationId,
): Effect.Effect<ActiveAutomation, AutomationCommandInvariantError> {
  const automation = findAutomation(readModel, automationId);
  if (automation === undefined) {
    return fail(command, `Automation '${automationId}' does not exist.`);
  }
  if (automation.status === "deleted") {
    return fail(command, `Automation '${automationId}' is deleted.`);
  }
  return Effect.succeed(automation as ActiveAutomation);
}

function requireRun(
  command: AutomationCommand,
  readModel: AutomationReadModel,
  input: { readonly automationId: AutomationId; readonly runId: AutomationRunId },
): Effect.Effect<AutomationRun, AutomationCommandInvariantError> {
  const run = findRun(readModel, input.runId);
  if (run === undefined || run.automationId !== input.automationId) {
    return fail(
      command,
      `Run '${input.runId}' does not exist for automation '${input.automationId}'.`,
    );
  }
  return Effect.succeed(run);
}

function isTerminalStatus(status: AutomationRunStatus): boolean {
  return terminalRunStatuses.has(status);
}

function requireRunTimestamps(
  command: AutomationCommand,
  run: AutomationRun,
): Effect.Effect<void, AutomationCommandInvariantError> {
  if (isTerminalStatus(run.status) && run.completedAt === null) {
    return fail(command, `Terminal run '${run.id}' must have a completed timestamp.`);
  }
  if (!isTerminalStatus(run.status) && run.completedAt !== null) {
    return fail(command, `Non-terminal run '${run.id}' must not have a completed timestamp.`);
  }
  return Effect.void;
}

function buildAutomation(
  command: Extract<AutomationCommand, { readonly type: "automation.create" }>,
): Automation {
  return {
    id: command.automationId,
    title: command.title,
    prompt: command.prompt,
    target: command.target,
    schedule: command.schedule,
    timezone: command.timezone,
    status: "enabled",
    environmentMode: command.environmentMode,
    writePolicy: {
      writesEnabled: command.writesEnabled,
      allowDirtyLocalCheckout: command.allowDirtyLocalCheckout,
    },
    modelSelection: command.modelSelection,
    runtimeMode: command.runtimeMode,
    resultThreadId: null,
    nextRunAt: command.nextRunAt,
    lastRunAt: null,
    createdAt: command.createdAt,
    updatedAt: command.createdAt,
  };
}

function buildUpdatedAutomation(
  automation: Automation,
  command: Extract<AutomationCommand, { readonly type: "automation.update" }>,
): Automation {
  const next: Automation = {
    ...automation,
    updatedAt: command.updatedAt,
  };
  if (command.title !== undefined) next.title = command.title;
  if (command.prompt !== undefined) next.prompt = command.prompt;
  if (command.target !== undefined) next.target = command.target;
  if (command.schedule !== undefined) next.schedule = command.schedule;
  if (command.timezone !== undefined) next.timezone = command.timezone;
  if (command.environmentMode !== undefined) next.environmentMode = command.environmentMode;
  if (command.modelSelection !== undefined) next.modelSelection = command.modelSelection;
  if (command.runtimeMode !== undefined) next.runtimeMode = command.runtimeMode;
  if (command.writesEnabled !== undefined) {
    next.writePolicy = {
      ...next.writePolicy,
      writesEnabled: command.writesEnabled,
    };
  }
  if (command.allowDirtyLocalCheckout !== undefined) {
    next.writePolicy = {
      ...next.writePolicy,
      allowDirtyLocalCheckout: command.allowDirtyLocalCheckout,
    };
  }
  if (Object.hasOwn(command, "nextRunAt")) next.nextRunAt = command.nextRunAt ?? null;
  return next;
}

function buildRequestedRun(
  command: Extract<AutomationCommand, { readonly type: "automation.run.request" }>,
): AutomationRun {
  return {
    id: command.runId,
    automationId: command.automationId,
    status: "pending",
    trigger: command.trigger,
    resultThreadId: null,
    orchestrationCommandIds: [],
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    skippedReason: null,
    changedFiles: [],
    createdAt: command.requestedAt,
    updatedAt: command.requestedAt,
  };
}

function statusChangedEvent(input: {
  readonly command: AutomationCommand;
  readonly automation: ActiveAutomation;
  readonly toStatus: AutomationClientSettableStatus;
  readonly updatedAt: string;
}): Omit<AutomationEvent, "sequence"> {
  return {
    ...eventBase({
      aggregateKind: "automation",
      aggregateId: input.automation.id,
      occurredAt: input.updatedAt,
      commandId: input.command.commandId,
    }),
    type: "automation.status-changed",
    payload: {
      automationId: input.automation.id,
      fromStatus: input.automation.status,
      toStatus: input.toStatus,
      updatedAt: input.updatedAt,
    },
  };
}

export const decideAutomationCommand = Effect.fn("decideAutomationCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: AutomationCommand;
  readonly readModel: AutomationReadModel;
}): Effect.fn.Return<AutomationDecision, AutomationCommandInvariantError> {
  switch (command.type) {
    case "automation.create": {
      const existing = findAutomation(readModel, command.automationId);
      if (existing !== undefined && existing.status !== "deleted") {
        return yield* fail(command, `Automation '${command.automationId}' already exists.`);
      }
      return {
        ...eventBase({
          aggregateKind: "automation",
          aggregateId: command.automationId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "automation.created",
        payload: {
          automation: buildAutomation(command),
        },
      };
    }

    case "automation.update": {
      const automation = yield* requireAutomation(command, readModel, command.automationId);
      return {
        ...eventBase({
          aggregateKind: "automation",
          aggregateId: command.automationId,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        }),
        type: "automation.updated",
        payload: {
          automation: buildUpdatedAutomation(automation, command),
        },
      };
    }

    case "automation.status.set": {
      const automation = yield* requireAutomation(command, readModel, command.automationId);
      return statusChangedEvent({
        command,
        automation,
        toStatus: command.status,
        updatedAt: command.updatedAt,
      });
    }

    case "automation.delete": {
      yield* requireAutomation(command, readModel, command.automationId);
      return {
        ...eventBase({
          aggregateKind: "automation",
          aggregateId: command.automationId,
          occurredAt: command.deletedAt,
          commandId: command.commandId,
        }),
        type: "automation.deleted",
        payload: {
          automationId: command.automationId,
          deletedAt: command.deletedAt,
        },
      };
    }

    case "automation.run.request": {
      yield* requireAutomation(command, readModel, command.automationId);
      if (findRun(readModel, command.runId) !== undefined) {
        return yield* fail(command, `Run '${command.runId}' already exists.`);
      }
      const run = buildRequestedRun(command);
      return {
        ...eventBase({
          aggregateKind: "automationRun",
          aggregateId: command.runId,
          occurredAt: command.requestedAt,
          commandId: command.commandId,
        }),
        type: "automation.run-created",
        payload: { run },
      };
    }

    case "automation.run.create": {
      yield* requireAutomation(command, readModel, command.run.automationId);
      if (findRun(readModel, command.run.id) !== undefined) {
        return yield* fail(command, `Run '${command.run.id}' already exists.`);
      }
      yield* requireRunTimestamps(command, command.run);
      return {
        ...eventBase({
          aggregateKind: "automationRun",
          aggregateId: command.run.id,
          occurredAt: command.run.createdAt,
          commandId: command.commandId,
        }),
        type: "automation.run-created",
        payload: { run: command.run },
      };
    }

    case "automation.run.start": {
      yield* requireAutomation(command, readModel, command.automationId);
      const run = yield* requireRun(command, readModel, {
        automationId: command.automationId,
        runId: command.runId,
      });
      if (run.status !== "pending") {
        return yield* fail(command, `Run '${command.runId}' is not pending.`);
      }
      return {
        ...eventBase({
          aggregateKind: "automationRun",
          aggregateId: command.runId,
          occurredAt: command.startedAt,
          commandId: command.commandId,
        }),
        type: "automation.run-started",
        payload: {
          run: {
            ...run,
            status: "running",
            resultThreadId: command.resultThreadId,
            orchestrationCommandIds: command.orchestrationCommandIds,
            startedAt: command.startedAt,
            completedAt: null,
            updatedAt: command.startedAt,
          },
        },
      };
    }

    case "automation.run.complete": {
      yield* requireAutomation(command, readModel, command.automationId);
      const run = yield* requireRun(command, readModel, {
        automationId: command.automationId,
        runId: command.runId,
      });
      if (run.status !== "running") {
        return yield* fail(command, `Run '${command.runId}' is not running.`);
      }
      return {
        ...eventBase({
          aggregateKind: "automationRun",
          aggregateId: command.runId,
          occurredAt: command.completedAt,
          commandId: command.commandId,
        }),
        type: "automation.run-completed",
        payload: {
          run: {
            ...run,
            status: command.status,
            errorMessage: command.errorMessage,
            skippedReason: command.skippedReason,
            changedFiles: command.changedFiles,
            completedAt: command.completedAt,
            updatedAt: command.completedAt,
          },
        },
      };
    }
  }
});
