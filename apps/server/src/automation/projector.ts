import type {
  Automation,
  AutomationEvent,
  AutomationId,
  AutomationReadModel,
  AutomationRun,
} from "@t3tools/contracts";
import { Effect, Schema, SchemaIssue } from "effect";

import {
  AutomationCreatedPayload,
  AutomationDeletedPayload,
  AutomationRunCompletedPayload,
  AutomationRunCreatedPayload,
  AutomationRunStartedPayload,
  AutomationStatusChangedPayload,
  AutomationUpdatedPayload,
} from "./Schemas.ts";

export class AutomationProjectorDecodeError extends Schema.TaggedErrorClass<AutomationProjectorDecodeError>()(
  "AutomationProjectorDecodeError",
  {
    eventType: Schema.String,
    issue: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Automation projector decode failed for ${this.eventType}: ${this.issue}`;
  }
}

function toAutomationProjectorDecodeError(eventType: string) {
  return (error: Schema.SchemaError): AutomationProjectorDecodeError =>
    new AutomationProjectorDecodeError({
      eventType,
      issue: SchemaIssue.makeFormatterDefault()(error.issue),
      cause: error,
    });
}

function decodeForEvent<A>(
  schema: Schema.Schema<A>,
  value: unknown,
  eventType: AutomationEvent["type"],
): Effect.Effect<A, AutomationProjectorDecodeError> {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(schema as any)(value) as A,
    catch: (error) => toAutomationProjectorDecodeError(eventType)(error as Schema.SchemaError),
  });
}

function upsertById<T extends { readonly id: string }>(
  entries: ReadonlyArray<T>,
  next: T,
): ReadonlyArray<T> {
  return entries.some((entry) => entry.id === next.id)
    ? entries.map((entry) => (entry.id === next.id ? next : entry))
    : [...entries, next];
}

function updateAutomation(
  automations: ReadonlyArray<Automation>,
  automationId: AutomationId,
  patch: Partial<Omit<Automation, "id">>,
): ReadonlyArray<Automation> {
  return automations.map((automation) =>
    automation.id === automationId ? { ...automation, ...patch } : automation,
  );
}

export function createEmptyAutomationReadModel(nowIso: string): AutomationReadModel {
  return {
    snapshotSequence: 0,
    updatedAt: nowIso,
    automations: [],
    runs: [],
  };
}

export function projectAutomationEvent(
  model: AutomationReadModel,
  event: AutomationEvent,
): Effect.Effect<AutomationReadModel, AutomationProjectorDecodeError> {
  const nextBase: AutomationReadModel = {
    ...model,
    snapshotSequence: event.sequence,
    updatedAt: event.occurredAt,
  };

  switch (event.type) {
    case "automation.created":
      return decodeForEvent(AutomationCreatedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          automations: upsertById(nextBase.automations, payload.automation),
        })),
      );

    case "automation.updated":
      return decodeForEvent(AutomationUpdatedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          automations: upsertById(nextBase.automations, payload.automation),
        })),
      );

    case "automation.status-changed":
      return decodeForEvent(AutomationStatusChangedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          automations: updateAutomation(nextBase.automations, payload.automationId, {
            status: payload.toStatus,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "automation.deleted":
      return decodeForEvent(AutomationDeletedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          automations: updateAutomation(nextBase.automations, payload.automationId, {
            status: "deleted",
            updatedAt: payload.deletedAt,
          }),
        })),
      );

    case "automation.run-created":
      return decodeForEvent(AutomationRunCreatedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          runs: upsertById(nextBase.runs, payload.run),
        })),
      );

    case "automation.run-started":
      return decodeForEvent(AutomationRunStartedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          runs: upsertById(nextBase.runs, payload.run),
        })),
      );

    case "automation.run-completed":
      return decodeForEvent(AutomationRunCompletedPayload, event.payload, event.type).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          runs: upsertById(nextBase.runs, payload.run as AutomationRun),
        })),
      );
  }
}
