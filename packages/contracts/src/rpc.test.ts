import { describe, expect, it } from "vitest";

import { AUTOMATION_WS_METHODS, AutomationEvent } from "./automation";
import {
  WsAutomationDispatchCommandRpc,
  WsAutomationGetSnapshotRpc,
  WsAutomationSubscribeRpc,
  WsAutomationUnsubscribeRpc,
  WsRpcError,
  WsRpcGroup,
} from "./rpc";

describe("WS RPC contracts", () => {
  it("exports the additive Effect RPC group", () => {
    expect(WsRpcGroup).toBeDefined();
  });

  it("uses a schema-backed transport error", () => {
    expect(new WsRpcError({ message: "failed" }).message).toBe("failed");
  });

  it("registers automation rpcs in the shared group", () => {
    expect(WsAutomationGetSnapshotRpc).toBeDefined();
    expect(WsAutomationDispatchCommandRpc).toBeDefined();
    expect(WsAutomationSubscribeRpc).toBeDefined();
    expect(WsAutomationUnsubscribeRpc).toBeDefined();

    expect(WsRpcGroup.requests.get(AUTOMATION_WS_METHODS.getSnapshot)).toBe(
      WsAutomationGetSnapshotRpc,
    );
    expect(WsRpcGroup.requests.get(AUTOMATION_WS_METHODS.dispatchCommand)).toBe(
      WsAutomationDispatchCommandRpc,
    );
    expect(WsRpcGroup.requests.get(AUTOMATION_WS_METHODS.subscribe)).toBe(
      WsAutomationSubscribeRpc,
    );
    expect(WsRpcGroup.requests.get(AUTOMATION_WS_METHODS.unsubscribe)).toBe(
      WsAutomationUnsubscribeRpc,
    );
  });

  it("streams automation events from the subscribe rpc", () => {
    const successSchema = WsAutomationSubscribeRpc.successSchema as {
      success?: unknown;
    };

    expect(successSchema.success).toBe(AutomationEvent);
  });
});
