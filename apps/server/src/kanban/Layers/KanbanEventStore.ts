import {
  CommandId,
  EventId,
  IsoDateTime,
  KanbanBoardId,
  KanbanCardId,
  KanbanEvent,
  NonNegativeInt,
} from "@t3tools/contracts";
import { Effect, Layer, Schema, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type OrchestrationEventStoreError,
} from "../../persistence/Errors.ts";
import {
  KanbanCommandReceipt,
  KanbanEventStore,
  type KanbanEventStoreShape,
} from "../Services/KanbanEventStore.ts";

const decodeEvent = Schema.decodeUnknownEffect(KanbanEvent);
const UnknownFromJsonString = Schema.fromJsonString(Schema.Unknown);
const KanbanEventMetadataFromJsonString = Schema.fromJsonString(Schema.Struct({}));

const AppendEventRequestSchema = Schema.Struct({
  eventId: EventId,
  aggregateKind: Schema.Literals(["board", "card"]),
  streamId: Schema.Union([KanbanBoardId, KanbanCardId]),
  type: Schema.String,
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  actorKind: Schema.String,
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  payloadJson: UnknownFromJsonString,
  metadataJson: KanbanEventMetadataFromJsonString,
});

const KanbanEventPersistedRowSchema = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  type: Schema.String,
  aggregateKind: Schema.Literals(["board", "card"]),
  aggregateId: Schema.Union([KanbanBoardId, KanbanCardId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  payload: UnknownFromJsonString,
  metadata: KanbanEventMetadataFromJsonString,
});

const ReadFromSequenceRequestSchema = Schema.Struct({
  sequenceExclusive: NonNegativeInt,
  limit: Schema.Number,
});

const GetCommandReceiptRequestSchema = Schema.Struct({
  commandId: CommandId,
});

const DEFAULT_READ_FROM_SEQUENCE_LIMIT = 1_000;
const READ_PAGE_SIZE = 500;

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): OrchestrationEventStoreError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeKanbanEventStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const appendEventRow = SqlSchema.findOne({
    Request: AppendEventRequestSchema,
    Result: KanbanEventPersistedRowSchema,
    execute: (request) =>
      sql`
        INSERT INTO kanban_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          ${request.eventId},
          ${request.aggregateKind},
          ${request.streamId},
          COALESCE(
            (
              SELECT stream_version + 1
              FROM kanban_events
              WHERE aggregate_kind = ${request.aggregateKind}
                AND stream_id = ${request.streamId}
              ORDER BY stream_version DESC
              LIMIT 1
            ),
            0
          ),
          ${request.type},
          ${request.occurredAt},
          ${request.commandId},
          ${request.causationEventId},
          ${request.correlationId},
          ${request.actorKind},
          ${request.payloadJson},
          ${request.metadataJson}
        )
        RETURNING
          sequence,
          event_id AS "eventId",
          event_type AS "type",
          aggregate_kind AS "aggregateKind",
          stream_id AS "aggregateId",
          occurred_at AS "occurredAt",
          command_id AS "commandId",
          causation_event_id AS "causationEventId",
          correlation_id AS "correlationId",
          payload_json AS "payload",
          metadata_json AS "metadata"
      `,
  });

  const readEventRowsFromSequence = SqlSchema.findAll({
    Request: ReadFromSequenceRequestSchema,
    Result: KanbanEventPersistedRowSchema,
    execute: (request) =>
      sql`
        SELECT
          sequence,
          event_id AS "eventId",
          event_type AS "type",
          aggregate_kind AS "aggregateKind",
          stream_id AS "aggregateId",
          occurred_at AS "occurredAt",
          command_id AS "commandId",
          causation_event_id AS "causationEventId",
          correlation_id AS "correlationId",
          payload_json AS "payload",
          metadata_json AS "metadata"
        FROM kanban_events
        WHERE sequence > ${request.sequenceExclusive}
          AND aggregate_kind IN ('board', 'card')
        ORDER BY sequence ASC
        LIMIT ${request.limit}
      `,
  });

  const upsertCommandReceiptRow = SqlSchema.void({
    Request: KanbanCommandReceipt,
    execute: (receipt) =>
      sql`
        INSERT INTO kanban_command_receipts (
          command_id,
          aggregate_kind,
          aggregate_id,
          accepted_at,
          result_sequence,
          status,
          error
        )
        VALUES (
          ${receipt.commandId},
          ${receipt.aggregateKind},
          ${receipt.aggregateId},
          ${receipt.acceptedAt},
          ${receipt.resultSequence},
          ${receipt.status},
          ${receipt.error}
        )
        ON CONFLICT (command_id)
        DO UPDATE SET
          aggregate_kind = excluded.aggregate_kind,
          aggregate_id = excluded.aggregate_id,
          accepted_at = excluded.accepted_at,
          result_sequence = excluded.result_sequence,
          status = excluded.status,
          error = excluded.error
      `,
  });

  const findCommandReceiptRow = SqlSchema.findOneOption({
    Request: GetCommandReceiptRequestSchema,
    Result: KanbanCommandReceipt,
    execute: ({ commandId }) =>
      sql`
        SELECT
          command_id AS "commandId",
          aggregate_kind AS "aggregateKind",
          aggregate_id AS "aggregateId",
          accepted_at AS "acceptedAt",
          result_sequence AS "resultSequence",
          status,
          error
        FROM kanban_command_receipts
        WHERE command_id = ${commandId}
          AND aggregate_kind IN ('board', 'card')
      `,
  });

  const append: KanbanEventStoreShape["append"] = (event) =>
    appendEventRow({
      eventId: event.eventId,
      aggregateKind: event.aggregateKind,
      streamId: event.aggregateId,
      type: event.type,
      causationEventId: event.causationEventId,
      correlationId: event.correlationId,
      actorKind: event.commandId?.startsWith("server:") === true ? "server" : "client",
      occurredAt: event.occurredAt,
      commandId: event.commandId,
      payloadJson: event.payload,
      metadataJson: event.metadata,
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "KanbanEventStore.append:insert",
          "KanbanEventStore.append:decodeRow",
        ),
      ),
      Effect.flatMap((row) =>
        decodeEvent(row).pipe(
          Effect.mapError(toPersistenceDecodeError("KanbanEventStore.append:rowToEvent")),
        ),
      ),
    );

  const readFromSequence: KanbanEventStoreShape["readFromSequence"] = (
    sequenceExclusive,
    limit = DEFAULT_READ_FROM_SEQUENCE_LIMIT,
  ) => {
    const normalizedLimit = Math.max(0, Math.floor(limit));
    if (normalizedLimit === 0) {
      return Stream.empty;
    }

    const readPage = (
      cursor: number,
      remaining: number,
    ): Stream.Stream<KanbanEvent, OrchestrationEventStoreError> =>
      Stream.fromEffect(
        readEventRowsFromSequence({
          sequenceExclusive: cursor,
          limit: Math.min(remaining, READ_PAGE_SIZE),
        }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "KanbanEventStore.readFromSequence:query",
              "KanbanEventStore.readFromSequence:decodeRows",
            ),
          ),
          Effect.flatMap((rows) =>
            Effect.forEach(rows, (row) =>
              decodeEvent(row).pipe(
                Effect.mapError(
                  toPersistenceDecodeError(
                    `KanbanEventStore.readFromSequence:rowToEvent(sequence=${row.sequence}, type=${row.type})`,
                  ),
                ),
              ),
            ),
          ),
        ),
      ).pipe(
        Stream.flatMap((events) => {
          if (events.length === 0) {
            return Stream.empty;
          }
          const nextRemaining = remaining - events.length;
          if (nextRemaining <= 0) {
            return Stream.fromIterable(events);
          }
          return Stream.concat(
            Stream.fromIterable(events),
            readPage(events[events.length - 1]!.sequence, nextRemaining),
          );
        }),
      );

    return readPage(sequenceExclusive, normalizedLimit);
  };

  const readAll: KanbanEventStoreShape["readAll"] = () =>
    readFromSequence(0, Number.MAX_SAFE_INTEGER);

  const getCommandReceipt: KanbanEventStoreShape["getCommandReceipt"] = (commandId) =>
    findCommandReceiptRow({ commandId }).pipe(
      Effect.mapError(toPersistenceSqlError("KanbanEventStore.getCommandReceipt:query")),
    );

  const upsertCommandReceipt: KanbanEventStoreShape["upsertCommandReceipt"] = (receipt) =>
    upsertCommandReceiptRow(receipt).pipe(
      Effect.mapError(toPersistenceSqlError("KanbanEventStore.upsertCommandReceipt:query")),
    );

  return {
    append,
    readFromSequence,
    readAll,
    getCommandReceipt,
    upsertCommandReceipt,
  } satisfies KanbanEventStoreShape;
});

export const KanbanEventStoreLive = Layer.effect(KanbanEventStore, makeKanbanEventStore);
