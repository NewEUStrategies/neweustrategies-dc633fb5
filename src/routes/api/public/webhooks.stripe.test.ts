import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { __verifySignatureForTests as verify } from "./webhooks.stripe";

function sign(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const hmac = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

describe("stripe webhook signature", () => {
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

  it("accepts valid signature", () => {
    expect(verify(payload, sign(payload, secret), secret)).toBe(true);
  });

  it("rejects tampered payload", () => {
    const sig = sign(payload, secret);
    expect(verify(payload + "x", sig, secret)).toBe(false);
  });

  it("rejects wrong secret", () => {
    expect(verify(payload, sign(payload, secret), "other")).toBe(false);
  });

  it("rejects stale timestamp", () => {
    const old = Math.floor(Date.now() / 1000) - 60 * 60;
    expect(verify(payload, sign(payload, secret, old), secret)).toBe(false);
  });

  it("rejects malformed header", () => {
    expect(verify(payload, "garbage", secret)).toBe(false);
  });
});
