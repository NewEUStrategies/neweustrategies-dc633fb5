import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  readWebhookHeaders,
  verifyWebhookSignature,
  WEBHOOK_TOLERANCE_SECONDS,
} from "../webhookSignature.server";

const SECRET_RAW = Buffer.from("super-secret-webhook-key-0123456789").toString("base64");
const SECRET = `whsec_${SECRET_RAW}`;
const NOW_MS = 1_780_000_000_000;
const TS = String(Math.floor(NOW_MS / 1000));
const ID = "msg_2abcDEF";
const BODY = JSON.stringify({ type: "email.bounced", data: { email_id: "x" } });

function sign(payload: string, id = ID, ts = TS, secret = SECRET_RAW): string {
  return createHmac("sha256", Buffer.from(secret, "base64"))
    .update(`${id}.${ts}.${payload}`)
    .digest("base64");
}

describe("readWebhookHeaders", () => {
  it("accepts both the svix- and the standard webhook- prefixes", () => {
    const svix = new Headers({ "svix-id": ID, "svix-timestamp": TS, "svix-signature": "v1,x" });
    expect(readWebhookHeaders(svix)).toEqual({ id: ID, timestamp: TS, signature: "v1,x" });

    const std = new Headers({
      "webhook-id": ID,
      "webhook-timestamp": TS,
      "webhook-signature": "v1,x",
    });
    expect(readWebhookHeaders(std)).toEqual({ id: ID, timestamp: TS, signature: "v1,x" });
  });
});

describe("verifyWebhookSignature", () => {
  const headers = (signature: string, id = ID, timestamp = TS) => ({ id, timestamp, signature });

  it("accepts a correctly signed delivery and returns its id", () => {
    const res = verifyWebhookSignature(BODY, headers(`v1,${sign(BODY)}`), SECRET, NOW_MS);
    expect(res).toEqual({ ok: true, id: ID });
  });

  it("accepts a secret given without the whsec_ prefix", () => {
    const res = verifyWebhookSignature(BODY, headers(`v1,${sign(BODY)}`), SECRET_RAW, NOW_MS);
    expect(res.ok).toBe(true);
  });

  it("accepts one valid signature among several (secret rotation)", () => {
    const rotated = `v1,${sign(BODY, ID, TS, Buffer.from("old-key").toString("base64"))} v1,${sign(BODY)}`;
    expect(verifyWebhookSignature(BODY, headers(rotated), SECRET, NOW_MS).ok).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const signature = `v1,${sign(BODY)}`;
    const tampered = JSON.stringify({ type: "email.bounced", data: { email_id: "y" } });
    expect(verifyWebhookSignature(tampered, headers(signature), SECRET, NOW_MS)).toEqual({
      ok: false,
      error: "invalid_signature",
    });
  });

  it("rejects a signature computed for a different delivery id (replay across events)", () => {
    const signature = `v1,${sign(BODY, "msg_other")}`;
    expect(verifyWebhookSignature(BODY, headers(signature), SECRET, NOW_MS).ok).toBe(false);
  });

  it("rejects a delivery outside the tolerance window", () => {
    const oldTs = String(Math.floor(NOW_MS / 1000) - WEBHOOK_TOLERANCE_SECONDS - 1);
    const signature = `v1,${sign(BODY, ID, oldTs)}`;
    expect(verifyWebhookSignature(BODY, headers(signature, ID, oldTs), SECRET, NOW_MS)).toEqual({
      ok: false,
      error: "expired",
    });
  });

  it("rejects missing headers and malformed timestamps", () => {
    expect(
      verifyWebhookSignature(BODY, { id: null, timestamp: TS, signature: "v1,x" }, SECRET, NOW_MS),
    ).toEqual({ ok: false, error: "missing_headers" });
    expect(
      verifyWebhookSignature(BODY, headers("v1,x", ID, "not-a-number"), SECRET, NOW_MS),
    ).toEqual({ ok: false, error: "bad_timestamp" });
  });

  it("rejects an empty secret", () => {
    expect(verifyWebhookSignature(BODY, headers(`v1,${sign(BODY)}`), "whsec_", NOW_MS)).toEqual({
      ok: false,
      error: "bad_secret",
    });
  });

  it("rejects a signature list with no v1 entries", () => {
    expect(verifyWebhookSignature(BODY, headers("v2,abc"), SECRET, NOW_MS)).toEqual({
      ok: false,
      error: "invalid_signature",
    });
  });
});
