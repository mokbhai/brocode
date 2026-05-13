import { Schema } from "effect";
import {
  CommandId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { ModelSelection, RuntimeMode } from "./orchestration";

export const AUTOMATION_WS_METHODS = {
  getSnapshot: "automation.getSnapshot",
  dispatchCommand: "automation.dispatchCommand",
  subscribe: "automation.subscribe",
  unsubscribe: "automation.unsubscribe",
} as const;

export const AUTOMATION_WS_CHANNELS = {
  event: "automation.event",
} as const;

export const AutomationId = TrimmedNonEmptyString.pipe(Schema.brand("AutomationId"));
export type AutomationId = typeof AutomationId.Type;
export const AutomationRunId = TrimmedNonEmptyString.pipe(Schema.brand("AutomationRunId"));
export type AutomationRunId = typeof AutomationRunId.Type;

export const AutomationStatus = Schema.Literals(["enabled", "disabled", "deleted"]);
export type AutomationStatus = typeof AutomationStatus.Type;

export const AutomationRunStatus = Schema.Literals([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);
export type AutomationRunStatus = typeof AutomationRunStatus.Type;

export const AutomationRunTrigger = Schema.Literals(["scheduled", "startup-recovery", "manual"]);
export type AutomationRunTrigger = typeof AutomationRunTrigger.Type;

export const AutomationEnvironmentMode = Schema.Literals(["local", "worktree"]);
export type AutomationEnvironmentMode = typeof AutomationEnvironmentMode.Type;

const Hour = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).check(
  Schema.isLessThanOrEqualTo(23),
);
const Minute = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).check(
  Schema.isLessThanOrEqualTo(59),
);
const DayOfWeek = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).check(
  Schema.isLessThanOrEqualTo(6),
);
const DayOfMonth = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
  Schema.isLessThanOrEqualTo(31),
);

const NullableThreadId = Schema.optional(Schema.NullOr(ThreadId)).pipe(
  Schema.withDecodingDefault(() => null),
);
const NullableIsoDateTime = Schema.optional(Schema.NullOr(IsoDateTime)).pipe(
  Schema.withDecodingDefault(() => null),
);
const NullableTrimmedString = Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
  Schema.withDecodingDefault(() => null),
);

export const AutomationTarget = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("project"),
    projectId: ProjectId,
  }),
  Schema.Struct({
    type: Schema.Literal("thread"),
    projectId: ProjectId,
    threadId: ThreadId,
  }),
  Schema.Struct({
    type: Schema.Literal("chat"),
    projectId: Schema.optional(ProjectId),
  }),
]);
export type AutomationTarget = typeof AutomationTarget.Type;

export const AutomationSchedule = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("hourly"),
    minute: Minute,
  }),
  Schema.Struct({
    kind: Schema.Literal("daily"),
    hour: Hour,
    minute: Minute,
  }),
  Schema.Struct({
    kind: Schema.Literal("weekdays"),
    hour: Hour,
    minute: Minute,
  }),
  Schema.Struct({
    kind: Schema.Literal("weekly"),
    dayOfWeek: DayOfWeek,
    hour: Hour,
    minute: Minute,
  }),
  Schema.Struct({
    kind: Schema.Literal("monthly"),
    dayOfMonth: DayOfMonth,
    hour: Hour,
    minute: Minute,
  }),
]);
export type AutomationSchedule = typeof AutomationSchedule.Type;

export const AutomationWritePolicy = Schema.Struct({
  writesEnabled: Schema.Boolean,
  allowDirtyLocalCheckout: Schema.Boolean,
});
export type AutomationWritePolicy = typeof AutomationWritePolicy.Type;

export const Automation = Schema.Struct({
  id: AutomationId,
  title: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  target: AutomationTarget,
  schedule: AutomationSchedule,
  timezone: TrimmedNonEmptyString,
  status: AutomationStatus,
  environmentMode: AutomationEnvironmentMode,
  writePolicy: AutomationWritePolicy,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  resultThreadId: NullableThreadId,
  nextRunAt: NullableIsoDateTime,
  lastRunAt: NullableIsoDateTime,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Automation = typeof Automation.Type;

export const AutomationRun = Schema.Struct({
  id: AutomationRunId,
  automationId: AutomationId,
  status: AutomationRunStatus,
  trigger: AutomationRunTrigger,
  resultThreadId: NullableThreadId,
  orchestrationCommandIds: Schema.optional(Schema.Array(CommandId)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  startedAt: NullableIsoDateTime,
  completedAt: NullableIsoDateTime,
  errorMessage: NullableTrimmedString,
  skippedReason: NullableTrimmedString,
  changedFiles: Schema.optional(Schema.Array(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AutomationRun = typeof AutomationRun.Type;

export const AutomationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  updatedAt: IsoDateTime,
  automations: Schema.Array(Automation),
  runs: Schema.Array(AutomationRun),
});
export type AutomationReadModel = typeof AutomationReadModel.Type;

export const AutomationSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  automations: Schema.Array(Automation),
  runsByAutomationId: Schema.Record(AutomationId, Schema.Array(AutomationRun)),
});
export type AutomationSnapshot = typeof AutomationSnapshot.Type;

export const AutomationGetSnapshotInput = Schema.Struct({});
export type AutomationGetSnapshotInput = typeof AutomationGetSnapshotInput.Type;

export const AutomationDispatchCommandResult = Schema.Struct({
  sequence: NonNegativeInt,
});
export type AutomationDispatchCommandResult = typeof AutomationDispatchCommandResult.Type;

export const AutomationSubscribeInput = Schema.Struct({});
export type AutomationSubscribeInput = typeof AutomationSubscribeInput.Type;
export const AutomationUnsubscribeInput = AutomationSubscribeInput;
export type AutomationUnsubscribeInput = typeof AutomationUnsubscribeInput.Type;

const DefaultAutomationEnvironmentMode = Schema.optional(AutomationEnvironmentMode).pipe(
  Schema.withDecodingDefault(() => "local" as const),
);
const DefaultAllowDirtyLocalCheckout = Schema.optional(Schema.Boolean).pipe(
  Schema.withDecodingDefault(() => false),
);

export const AutomationClientCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("automation.create"),
    commandId: CommandId,
    automationId: AutomationId,
    title: TrimmedNonEmptyString,
    prompt: TrimmedNonEmptyString,
    target: AutomationTarget,
    schedule: AutomationSchedule,
    timezone: TrimmedNonEmptyString,
    environmentMode: DefaultAutomationEnvironmentMode,
    modelSelection: ModelSelection,
    runtimeMode: RuntimeMode,
    writesEnabled: Schema.Boolean,
    allowDirtyLocalCheckout: DefaultAllowDirtyLocalCheckout,
    nextRunAt: NullableIsoDateTime,
    createdAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("automation.update"),
    commandId: CommandId,
    automationId: AutomationId,
    title: Schema.optional(TrimmedNonEmptyString),
    prompt: Schema.optional(TrimmedNonEmptyString),
    target: Schema.optional(AutomationTarget),
    schedule: Schema.optional(AutomationSchedule),
    timezone: Schema.optional(TrimmedNonEmptyString),
    environmentMode: Schema.optional(AutomationEnvironmentMode),
    modelSelection: Schema.optional(ModelSelection),
    runtimeMode: Schema.optional(RuntimeMode),
    writesEnabled: Schema.optional(Schema.Boolean),
    allowDirtyLocalCheckout: Schema.optional(Schema.Boolean),
    nextRunAt: NullableIsoDateTime,
    updatedAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("automation.status.set"),
    commandId: CommandId,
    automationId: AutomationId,
    status: AutomationStatus,
    updatedAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("automation.delete"),
    commandId: CommandId,
    automationId: AutomationId,
    deletedAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("automation.run.request"),
    commandId: CommandId,
    automationId: AutomationId,
    runId: AutomationRunId,
    trigger: AutomationRunTrigger,
    requestedAt: IsoDateTime,
  }),
]);
export type AutomationClientCommand = typeof AutomationClientCommand.Type;

export const AutomationInternalCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("automation.run.create"),
    commandId: CommandId,
    run: AutomationRun,
  }),
  Schema.Struct({
    type: Schema.Literal("automation.run.start"),
    commandId: CommandId,
    runId: AutomationRunId,
    automationId: AutomationId,
    resultThreadId: ThreadId,
    orchestrationCommandIds: Schema.Array(CommandId),
    startedAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("automation.run.complete"),
    commandId: CommandId,
    runId: AutomationRunId,
    automationId: AutomationId,
    status: AutomationRunStatus,
    errorMessage: NullableTrimmedString,
    skippedReason: NullableTrimmedString,
    changedFiles: Schema.Array(TrimmedNonEmptyString),
    completedAt: IsoDateTime,
  }),
]);
export type AutomationInternalCommand = typeof AutomationInternalCommand.Type;

export const AutomationCommand = Schema.Union([AutomationClientCommand, AutomationInternalCommand]);
export type AutomationCommand = typeof AutomationCommand.Type;

export const AutomationEventMetadata = Schema.Struct({});
export type AutomationEventMetadata = typeof AutomationEventMetadata.Type;

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literals(["automation", "automationRun"]),
  aggregateId: Schema.Union([AutomationId, AutomationRunId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: AutomationEventMetadata,
} as const;

export const AutomationEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("automation.created"),
    payload: Schema.Struct({
      automation: Automation,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("automation.updated"),
    payload: Schema.Struct({
      automation: Automation,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("automation.status-changed"),
    payload: Schema.Struct({
      automationId: AutomationId,
      fromStatus: AutomationStatus,
      toStatus: AutomationStatus,
      updatedAt: IsoDateTime,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("automation.deleted"),
    payload: Schema.Struct({
      automationId: AutomationId,
      deletedAt: IsoDateTime,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("automation.run-created"),
    payload: Schema.Struct({
      run: AutomationRun,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("automation.run-started"),
    payload: Schema.Struct({
      run: AutomationRun,
    }),
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("automation.run-completed"),
    payload: Schema.Struct({
      run: AutomationRun,
    }),
  }),
]);
export type AutomationEvent = typeof AutomationEvent.Type;

export const AutomationRpcSchemas = {
  getSnapshot: {
    input: AutomationGetSnapshotInput,
    output: AutomationSnapshot,
  },
  dispatchCommand: {
    input: AutomationClientCommand,
    output: AutomationDispatchCommandResult,
  },
  subscribe: {
    input: AutomationSubscribeInput,
    output: Schema.Void,
  },
  unsubscribe: {
    input: AutomationUnsubscribeInput,
    output: Schema.Void,
  },
} as const;
