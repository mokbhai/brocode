import type {
  AutomationCommand,
  AutomationEvent,
  AutomationId,
  AutomationReadModel,
  AutomationRunId,
} from "@t3tools/contracts";
import { Cause, Deferred, Effect, Layer, Option, PubSub, Queue, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import { decideAutomationCommand, AutomationCommandInvariantError } from "../decider.ts";
import { createEmptyAutomationReadModel, projectAutomationEvent } from "../projector.ts";
import { AutomationEventStore } from "../Services/AutomationEventStore.ts";
import {
  AutomationCommandInternalError,
  AutomationCommandPreviouslyRejectedError,
  AutomationEngineService,
  type AutomationDispatchError,
  type AutomationEngineShape,
} from "../Services/AutomationEngine.ts";
import { AutomationProjectionPipeline } from "../Services/AutomationProjectionPipeline.ts";

interface CommandEnvelope {
  readonly command: AutomationCommand;
  readonly result: Deferred.Deferred<{ sequence: number }, AutomationDispatchError>;
}

type CommittedCommandResult = {
  readonly committedEvents: AutomationEvent[];
  readonly lastSequence: number;
  readonly nextReadModel: AutomationReadModel;
};

function commandToAggregateRef(command: AutomationCommand): {
  readonly aggregateKind: "automation" | "automationRun";
  readonly aggregateId: AutomationId | AutomationRunId;
} {
  switch (command.type) {
    case "automation.create":
    case "automation.update":
    case "automation.status.set":
    case "automation.delete":
      return { aggregateKind: "automation", aggregateId: command.automationId };
    case "automation.run.request":
      return { aggregateKind: "automationRun", aggregateId: command.runId };
    case "automation.run.create":
      return { aggregateKind: "automationRun", aggregateId: command.run.id };
    case "automation.run.start":
    case "automation.run.complete":
      return { aggregateKind: "automationRun", aggregateId: command.runId };
  }
}

const makeAutomationEngine = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventStore = yield* AutomationEventStore;
  const projectionPipeline = yield* AutomationProjectionPipeline;

  let readModel = createEmptyAutomationReadModel(new Date().toISOString());
  const commandQueue = yield* Queue.unbounded<CommandEnvelope>();
  const eventPubSub = yield* PubSub.unbounded<AutomationEvent>();

  const previouslyRejected = (command: AutomationCommand, detail: string) =>
    new AutomationCommandPreviouslyRejectedError({
      commandId: command.commandId,
      detail,
    });

  const internalError = (command: AutomationCommand, detail: string) =>
    new AutomationCommandInternalError({
      commandId: command.commandId,
      commandType: command.type,
      detail,
    });

  const recordRejectedReceipt = (
    command: AutomationCommand,
    error: AutomationCommandInvariantError,
  ) => {
    const aggregateRef = commandToAggregateRef(command);
    return eventStore
      .upsertCommandReceipt({
        commandId: command.commandId,
        aggregateKind: aggregateRef.aggregateKind,
        aggregateId: aggregateRef.aggregateId,
        acceptedAt: new Date().toISOString(),
        resultSequence: readModel.snapshotSequence,
        status: "rejected",
        error: error.message,
      })
      .pipe(Effect.catch(() => Effect.void));
  };

  const processEnvelope = (envelope: CommandEnvelope) =>
    Effect.gen(function* () {
      const existingReceipt = yield* eventStore.getCommandReceipt(envelope.command.commandId);
      if (Option.isSome(existingReceipt)) {
        if (existingReceipt.value.status === "accepted") {
          yield* projectionPipeline.bootstrap;
          yield* Deferred.succeed(envelope.result, {
            sequence: existingReceipt.value.resultSequence,
          });
          return;
        }
        yield* Deferred.fail(
          envelope.result,
          previouslyRejected(
            envelope.command,
            existingReceipt.value.error ?? "Previously rejected.",
          ),
        );
        return;
      }

      const eventBase = yield* decideAutomationCommand({
        command: envelope.command,
        readModel,
      });
      const eventBases = Array.isArray(eventBase) ? eventBase : [eventBase];

      const committedCommand = yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const committedEvents: AutomationEvent[] = [];
            let nextReadModel = readModel;

            for (const nextEvent of eventBases) {
              const savedEvent = yield* eventStore.append(nextEvent);
              nextReadModel = yield* projectAutomationEvent(nextReadModel, savedEvent);
              committedEvents.push(savedEvent);
            }

            const lastSavedEvent = committedEvents.at(-1) ?? null;
            if (lastSavedEvent === null) {
              return yield* new AutomationCommandInvariantError({
                commandType: envelope.command.type,
                detail: "Command produced no events.",
              });
            }

            yield* eventStore.upsertCommandReceipt({
              commandId: envelope.command.commandId,
              aggregateKind: lastSavedEvent.aggregateKind,
              aggregateId: lastSavedEvent.aggregateId,
              acceptedAt: lastSavedEvent.occurredAt,
              resultSequence: lastSavedEvent.sequence,
              status: "accepted",
              error: null,
            });

            return {
              committedEvents,
              lastSequence: lastSavedEvent.sequence,
              nextReadModel,
            } satisfies CommittedCommandResult;
          }),
        )
        .pipe(
          Effect.catchTag("SqlError", (sqlError) =>
            Effect.fail(
              toPersistenceSqlError("AutomationEngine.processEnvelope:transaction")(sqlError),
            ),
          ),
        );

      for (const event of committedCommand.committedEvents) {
        yield* projectionPipeline.projectEvent(event);
      }
      readModel = committedCommand.nextReadModel;
      for (const event of committedCommand.committedEvents) {
        yield* PubSub.publish(eventPubSub, event);
      }
      yield* Deferred.succeed(envelope.result, { sequence: committedCommand.lastSequence });
    }).pipe(
      Effect.catch((error: AutomationDispatchError) =>
        Effect.gen(function* () {
          if (error instanceof AutomationCommandInvariantError) {
            yield* recordRejectedReceipt(envelope.command, error);
          }
          yield* Deferred.fail(envelope.result, error);
        }),
      ),
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Deferred.fail(
          envelope.result,
          internalError(
            envelope.command,
            "The Automation command worker crashed before the command could finish.",
          ),
        );
      }),
    );

  yield* projectionPipeline.bootstrap;

  yield* Stream.runForEach(eventStore.readAll(), (event) =>
    Effect.gen(function* () {
      readModel = yield* projectAutomationEvent(readModel, event);
    }),
  );

  yield* Effect.forkScoped(
    Effect.forever(Queue.take(commandQueue).pipe(Effect.flatMap(processEnvelope))),
  );

  const getReadModel: AutomationEngineShape["getReadModel"] = () =>
    Effect.sync((): AutomationReadModel => readModel);

  const readEvents: AutomationEngineShape["readEvents"] = (fromSequenceExclusive) =>
    eventStore.readFromSequence(fromSequenceExclusive);

  const dispatch: AutomationEngineShape["dispatch"] = (command) =>
    Effect.gen(function* () {
      const result = yield* Deferred.make<{ sequence: number }, AutomationDispatchError>();
      yield* Queue.offer(commandQueue, { command, result });
      return yield* Deferred.await(result);
    });

  return {
    getReadModel,
    readEvents,
    dispatch,
    get streamDomainEvents(): AutomationEngineShape["streamDomainEvents"] {
      return Stream.fromPubSub(eventPubSub);
    },
  } satisfies AutomationEngineShape;
});

export const AutomationEngineLive = Layer.effect(AutomationEngineService, makeAutomationEngine);
