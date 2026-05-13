import {
  AutomationId,
  CommandId,
  EventId,
  ProjectId,
  type AutomationEvent,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime, Option, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { AutomationEventStore } from "../Services/AutomationEventStore.ts";
import { AutomationEventStoreLive } from "./AutomationEventStore.ts";

const automationId = AutomationId.makeUnsafe("automation-event-store-1");
const projectId = ProjectId.makeUnsafe("project-automation-event-store");
const occurredAt = "2026-05-13T00:00:00.000Z";

async function createEventStoreSystem() {
  const runtime = ManagedRuntime.make(AutomationEventStoreLive.pipe(Layer.provide(SqlitePersistenceMemory)));
  const eventStore = await runtime.runPromise(Effect.service(AutomationEventStore));
  return {
    eventStore,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

function automationCreatedEvent(commandId: string): Omit<AutomationEvent, "sequence"> {
  return {
    eventId: EventId.makeUnsafe(`event-${commandId}`),
    aggregateKind: "automation",
    aggregateId: automationId,
    type: "automation.created",
    occurredAt,
    commandId: CommandId.makeUnsafe(commandId),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe(commandId),
    metadata: {},
    payload: {
      automation: {
        id: automationId,
        title: "Daily standup",
        prompt: "Summarize yesterday and today.",
        target: { type: "project", projectId },
        schedule: { kind: "daily", hour: 9, minute: 0 },
        timezone: "Asia/Kolkata",
        status: "enabled",
        environmentMode: "local",
        writePolicy: { writesEnabled: true, allowDirtyLocalCheckout: false },
        modelSelection: { provider: "codex", model: "gpt-5.2" },
        runtimeMode: "full-access",
        resultThreadId: null,
        nextRunAt: occurredAt,
        lastRunAt: null,
        deletedAt: null,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
    },
  };
}

describe("AutomationEventStore", () => {
  it("appends and reads automation events with SQLite-assigned sequences", async () => {
    const system = await createEventStoreSystem();

    const saved = await system.run(
      system.eventStore.append(automationCreatedEvent("cmd-automation-event-store-append")),
    );
    const all = await system.run(
      Stream.runCollect(system.eventStore.readAll()).pipe(
        Effect.map((chunk): AutomationEvent[] => Array.from(chunk)),
      ),
    );

    expect(saved.sequence).toBe(1);
    expect(all).toEqual([saved]);
    await system.dispose();
  });

  it("upserts and reads accepted and rejected command receipts", async () => {
    const system = await createEventStoreSystem();
    const commandId = CommandId.makeUnsafe("cmd-automation-receipt");

    await system.run(
      system.eventStore.upsertCommandReceipt({
        commandId,
        aggregateKind: "automation",
        aggregateId: automationId,
        acceptedAt: occurredAt,
        resultSequence: 1,
        status: "accepted",
        error: null,
      }),
    );
    await system.run(
      system.eventStore.upsertCommandReceipt({
        commandId,
        aggregateKind: "automation",
        aggregateId: automationId,
        acceptedAt: occurredAt,
        resultSequence: 0,
        status: "rejected",
        error: "already exists",
      }),
    );

    const receipt = await system.run(system.eventStore.getCommandReceipt(commandId));
    expect(Option.isSome(receipt)).toBe(true);
    expect(Option.getOrThrow(receipt)).toMatchObject({
      commandId,
      resultSequence: 0,
      status: "rejected",
      error: "already exists",
    });
    await system.dispose();
  });

  it("reads from a sequence in ascending order with a limit", async () => {
    const system = await createEventStoreSystem();

    const first = await system.run(
      system.eventStore.append(automationCreatedEvent("cmd-automation-read-from-1")),
    );
    const second = await system.run(
      system.eventStore.append(automationCreatedEvent("cmd-automation-read-from-2")),
    );
    const third = await system.run(
      system.eventStore.append(automationCreatedEvent("cmd-automation-read-from-3")),
    );

    const events = await system.run(
      Stream.runCollect(system.eventStore.readFromSequence(first.sequence, 2)).pipe(
        Effect.map((chunk): AutomationEvent[] => Array.from(chunk)),
      ),
    );

    expect(events.map((event) => event.sequence)).toEqual([second.sequence, third.sequence]);
    await system.dispose();
  });

  it("returns none for missing command receipts", async () => {
    const system = await createEventStoreSystem();

    const receipt = await system.run(
      system.eventStore.getCommandReceipt(CommandId.makeUnsafe("cmd-automation-missing")),
    );

    expect(Option.isNone(receipt)).toBe(true);
    await system.dispose();
  });
});
