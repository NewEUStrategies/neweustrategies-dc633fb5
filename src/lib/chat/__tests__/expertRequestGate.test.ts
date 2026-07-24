import { describe, it, expect } from "vitest";
import { expertRequestGateOpen } from "@/lib/chat/expertRequestGate";

describe("expertRequestGateOpen", () => {
  it("open only when global is on and recipient is not explicitly off", () => {
    expect(expertRequestGateOpen({ globalEnabled: true, recipientEnabled: true })).toBe(true);
    // undefined recipient = unknown -> treat as enabled (column default true)
    expect(expertRequestGateOpen({ globalEnabled: true, recipientEnabled: undefined })).toBe(true);
  });

  it("closed when the global tenant switch is off (even if recipient opted in)", () => {
    expect(expertRequestGateOpen({ globalEnabled: false, recipientEnabled: true })).toBe(false);
    expect(expertRequestGateOpen({ globalEnabled: false, recipientEnabled: undefined })).toBe(
      false,
    );
  });

  it("closed when the recipient opted out (even if global is on)", () => {
    expect(expertRequestGateOpen({ globalEnabled: true, recipientEnabled: false })).toBe(false);
  });
});
