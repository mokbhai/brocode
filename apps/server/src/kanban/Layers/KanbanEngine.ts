import type {
  KanbanBoardId,
  KanbanCardId,
  KanbanCommand,
  KanbanEvent,
  KanbanReadModel,
} from "@t3tools/contracts";
import { Cause, Deferred, Effect, Layer, Option, PubSub, Queue, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import { decideKanbanCommand, KanbanCommandInvariantError } from "../decider.ts";
import { createEmptyKanbanReadModel, projectKanbanEvent } from "../projector.ts";
import { KanbanEventStore } from "../Services/KanbanEventStore.ts";
import {
  KanbanCommandInternalError,
  KanbanCommandPreviouslyRejectedError,
  KanbanEngineService,
  type KanbanDispatchError,
  type KanbanEngineShape,
} from "../Services/KanbanEngine.ts";
import { KanbanProjectionPipeline } from "../Services/KanbanProjectionPipeline.ts";

interface CommandEnvelope {
  readonly command: KanbanCommand;
  readonly result: Deferred.Deferred<{ sequence: number }, KanbanDispatchError>;
}

type CommittedCommandResult = {
  readonly committedEvents: KanbanEvent[];
  readonly lastSequence: number;
  readonly nextReadModel: KanbanReadModel;
};

function commandToAggregateRef(command: KanbanCommand): {
  readonly aggregateKind: "board" | "card";
  readonly aggregateId: KanbanBoardId | KanbanCardId;
} {
  switch (command.type) {
    case "kanban.board.create":
      return { aggregateKind: "board", aggregateId: command.boardId };
    case "kanban.card.create":
      return { aggregateKind: "card", aggregateId: command.cardId };
    case "kanban.review.complete":
      return { aggregateKind: "card", aggregateId: command.review.cardId };
    default:
      return { aggregateKind: "card", aggregateId: command.cardId };
  }
}

const makeKanbanEngine = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventStore = yield* KanbanEventStore;
  const projectionPipeline = yield* KanbanProjectionPipeline;

  let readModel = createEmptyKanbanReadModel(new Date().toISOString());
  const commandQueue = yield* Queue.unbounded<CommandEnvelope>();
  const eventPubSub = yield* PubSub.unbounded<KanbanEvent>();

  const previouslyRejected = (command: KanbanCommand, detail: string) =>
    new KanbanCommandPreviouslyRejectedError({
      commandId: command.commandId,
      detail,
    });

  const internalError = (command: KanbanCommand, detail: string) =>
    new KanbanCommandInternalError({
      commandId: command.commandId,
      commandType: command.type,
      detail,
    });

  const recordRejectedReceipt = (command: KanbanCommand, error: KanbanCommandInvariantError) => {
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

      const eventBase = yield* decideKanbanCommand({
        command: envelope.command,
        readModel,
      });
      const eventBases = Array.isArray(eventBase) ? eventBase : [eventBase];

      const committedCommand = yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const committedEvents: KanbanEvent[] = [];
            let nextReadModel = readModel;

            for (const nextEvent of eventBases) {
              const savedEvent = yield* eventStore.append(nextEvent);
              nextReadModel = yield* projectKanbanEvent(nextReadModel, savedEvent);
              committedEvents.push(savedEvent);
            }

            const lastSavedEvent = committedEvents.at(-1) ?? null;
            if (lastSavedEvent === null) {
              return yield* new KanbanCommandInvariantError({
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
              toPersistenceSqlError("KanbanEngine.processEnvelope:transaction")(sqlError),
            ),
          ),
        );

      readModel = committedCommand.nextReadModel;
      yield* Effect.forEach(committedCommand.committedEvents, projectionPipeline.projectEvent, {
        concurrency: 1,
      });
      for (const event of committedCommand.committedEvents) {
        yield* PubSub.publish(eventPubSub, event);
      }
      yield* Deferred.succeed(envelope.result, { sequence: committedCommand.lastSequence });
    }).pipe(
      Effect.catch((error: KanbanDispatchError) =>
        Effect.gen(function* () {
          if (error instanceof KanbanCommandInvariantError) {
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
            "The Kanban command worker crashed before the command could finish.",
          ),
        );
      }),
    );

  yield* projectionPipeline.bootstrap;

  yield* Stream.runForEach(eventStore.readAll(), (event) =>
    Effect.gen(function* () {
      readModel = yield* projectKanbanEvent(readModel, event);
    }),
  );

  yield* Effect.forkScoped(
    Effect.forever(Queue.take(commandQueue).pipe(Effect.flatMap(processEnvelope))),
  );

  const getReadModel: KanbanEngineShape["getReadModel"] = () =>
    Effect.sync((): KanbanReadModel => readModel);

  const readEvents: KanbanEngineShape["readEvents"] = (fromSequenceExclusive) =>
    eventStore.readFromSequence(fromSequenceExclusive);

  const dispatch: KanbanEngineShape["dispatch"] = (command) =>
    Effect.gen(function* () {
      const result = yield* Deferred.make<{ sequence: number }, KanbanDispatchError>();
      yield* Queue.offer(commandQueue, { command, result });
      return yield* Deferred.await(result);
    });

  return {
    getReadModel,
    readEvents,
    dispatch,
    get streamDomainEvents(): KanbanEngineShape["streamDomainEvents"] {
      return Stream.fromPubSub(eventPubSub);
    },
  } satisfies KanbanEngineShape;
});

export const KanbanEngineLive = Layer.effect(KanbanEngineService, makeKanbanEngine);
