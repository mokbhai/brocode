import {
  AutomationId,
  CommandId,
  ProjectId,
  type AutomationCommand,
  type AutomationEvent,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime, Queue, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { AutomationEngineService } from "../Services/AutomationEngine.ts";
import { AutomationEngineLive } from "./AutomationEngine.ts";
import { AutomationEventStoreLive } from "./AutomationEventStore.ts";
import { AUTOMATION_PROJECTOR_NAME, AutomationProjectionPipelineLive } from "./AutomationProjectionPipeline.ts";

const automationId = AutomationId.makeUnsafe("automation-engine-1");
const projectId = ProjectId.makeUnsafe("project-automation-engine");

async function createAutomationSystem() {
  const projectionPipelineLayer = AutomationProjectionPipelineLive.pipe(
    Layer.provide(AutomationEventStoreLive),
  );
  const infrastructureLayer = Layer.mergeAll(AutomationEventStoreLive, projectionPipelineLayer);
  const layer = AutomationEngineLive.pipe(
    Layer.provide(infrastructureLayer),
    Layer.provideMerge(SqlitePersistenceMemory),
  );
  const runtime = ManagedRuntime.make(layer);
  const engine = await runtime.runPromise(Effect.service(AutomationEngineService));
  const sql = await runtime.runPromise(Effect.service(SqlClient.SqlClient));
  return {
    engine,
    sql,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

function createCommand(commandId: string, createdAt: string): AutomationCommand {
  return {
    type: "automation.create",
    commandId: CommandId.makeUnsafe(commandId),
    automationId,
    title: "Daily standup",
    prompt: "Summarize yesterday and today.",
    target: { type: "project", projectId },
    schedule: { kind: "daily", hour: 9, minute: 0 },
    timezone: "Asia/Kolkata",
    environmentMode: "local",
    modelSelection: { provider: "codex", model: "gpt-5.2" },
    runtimeMode: "full-access",
    writesEnabled: true,
    allowDirtyLocalCheckout: false,
    nextRunAt: createdAt,
    createdAt,
  };
}

describe("AutomationEngine", () => {
  it("dispatches create commands, persists events, updates memory, and publishes stream events", async () => {
    const system = await createAutomationSystem();
    const createdAt = "2026-05-13T00:00:00.000Z";
    const published: AutomationEvent[] = [];

    const result = await system.run(
      Effect.gen(function* () {
        const eventQueue = yield* Queue.unbounded<AutomationEvent>();
        yield* Effect.forkScoped(
          Stream.take(system.engine.streamDomainEvents, 1).pipe(
            Stream.runForEach((event) => Queue.offer(eventQueue, event).pipe(Effect.asVoid)),
          ),
        );
        yield* Effect.sleep("10 millis");

        const dispatchResult = yield* system.engine.dispatch(
          createCommand("cmd-automation-engine-create", createdAt),
        );
        published.push(yield* Queue.take(eventQueue));
        return dispatchResult;
      }).pipe(Effect.scoped),
    );

    expect(result.sequence).toBe(1);
    expect(published.map((event) => event.type)).toEqual(["automation.created"]);

    const model = await system.run(system.engine.getReadModel());
    expect(model.snapshotSequence).toBe(1);
    expect(model.automations.map((automation) => automation.id)).toEqual([automationId]);

    const rows = await system.run(
      system.sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM automation_events`,
    );
    expect(rows).toEqual([{ count: 1 }]);

    const projectionRows = await system.run(
      system.sql<{ readonly automationId: string; readonly lastAppliedSequence: number }>`
        SELECT
          a.automation_id AS "automationId",
          s.last_applied_sequence AS "lastAppliedSequence"
        FROM projection_automations a
        CROSS JOIN projection_automation_state s
        WHERE s.projector = ${AUTOMATION_PROJECTOR_NAME}
      `,
    );
    expect(projectionRows).toEqual([
      { automationId, lastAppliedSequence: result.sequence },
    ]);

    await system.dispose();
  });

  it("returns the accepted sequence for repeated command ids", async () => {
    const system = await createAutomationSystem();
    const createdAt = "2026-05-13T00:01:00.000Z";
    const command = createCommand("cmd-automation-engine-accepted-duplicate", createdAt);

    const accepted = await system.run(system.engine.dispatch(command));
    const duplicate = await system.run(system.engine.dispatch(command));

    expect(duplicate).toEqual(accepted);
    await system.dispose();
  });

  it("fails previously rejected command ids consistently", async () => {
    const system = await createAutomationSystem();
    const createdAt = "2026-05-13T00:02:00.000Z";
    const missingUpdate: AutomationCommand = {
      type: "automation.update",
      commandId: CommandId.makeUnsafe("cmd-automation-engine-rejected"),
      automationId,
      title: "Updated title",
      updatedAt: createdAt,
    };

    const first = await system.run(Effect.exit(system.engine.dispatch(missingUpdate)));
    const second = await system.run(
      Effect.exit(system.engine.dispatch(createCommand("cmd-automation-engine-rejected", createdAt))),
    );

    expect(first._tag).toBe("Failure");
    expect(second._tag).toBe("Failure");
    expect(String(second.cause)).toContain("PreviouslyRejected");
    await system.dispose();
  });

  it("continues processing later commands after an invariant failure", async () => {
    const system = await createAutomationSystem();
    const createdAt = "2026-05-13T00:03:00.000Z";

    const failed = await system.run(
      Effect.exit(
        system.engine.dispatch({
          type: "automation.update",
          commandId: CommandId.makeUnsafe("cmd-automation-engine-failed-first"),
          automationId,
          title: "Missing automation update",
          updatedAt: createdAt,
        }),
      ),
    );
    const next = await system.run(
      system.engine.dispatch(createCommand("cmd-automation-engine-continues", createdAt)),
    );

    expect(failed._tag).toBe("Failure");
    expect(next.sequence).toBe(1);
    const model = await system.run(system.engine.getReadModel());
    expect(model.automations.map((automation) => automation.id)).toEqual([automationId]);
    await system.dispose();
  });
});
