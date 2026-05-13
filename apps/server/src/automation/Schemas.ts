import {
  Automation,
  AutomationCompletedRun,
  AutomationClientSettableStatus,
  AutomationId,
  AutomationRun,
  IsoDateTime,
} from "@t3tools/contracts";
import { Schema } from "effect";

// Server-internal alias surface, backed by contract schemas as the source of truth.
export const AutomationCreatedPayload = Schema.Struct({
  automation: Automation,
});

export const AutomationUpdatedPayload = Schema.Struct({
  automation: Automation,
});

export const AutomationStatusChangedPayload = Schema.Struct({
  automationId: AutomationId,
  fromStatus: AutomationClientSettableStatus,
  toStatus: AutomationClientSettableStatus,
  updatedAt: IsoDateTime,
});

export const AutomationDeletedPayload = Schema.Struct({
  automationId: AutomationId,
  deletedAt: IsoDateTime,
});

export const AutomationRunCreatedPayload = Schema.Struct({
  run: AutomationRun,
});

export const AutomationRunStartedPayload = Schema.Struct({
  run: AutomationRun,
});

export const AutomationRunCompletedPayload = Schema.Struct({
  run: AutomationCompletedRun,
});
