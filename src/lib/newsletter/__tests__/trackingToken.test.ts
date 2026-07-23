import { describe, it, expect, beforeAll } from "vitest";
import { signTrackingToken, verifyTrackingToken } from "../trackingToken.server";

const CID = "11111111-1111-4111-8111-111111111111";
const CID2 = "22222222-2222-4222-8222-222222222222";
const SUB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUB2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeAll(() => {
  // Deterministyczny sekret HMAC dla testu (moduł czyta go per wywołanie).
  process.env.SESSION_SECRET = "test-tracking-secret";
});

describe("newsletter tracking token (HMAC per campaign+subscriber)", () => {
  it("round-trip: podpisany token weryfikuje się do subscriberId", () => {
    const token = signTrackingToken(CID, SUB);
    expect(verifyTrackingToken(CID, token)).toBe(SUB);
  });

  it("token NIE jest surowym tokenem wypisu - to <uuid>.<sigHex>", () => {
    const token = signTrackingToken(CID, SUB);
    expect(token.startsWith(`${SUB}.`)).toBe(true);
    const [, sig] = token.split(".");
    expect(sig).toMatch(/^[a-f0-9]{32}$/i);
  });

  it("odrzuca token z INNEJ kampanii (podpis wiąże campaignId)", () => {
    const token = signTrackingToken(CID, SUB);
    expect(verifyTrackingToken(CID2, token)).toBeNull();
  });

  it("odrzuca zmanipulowany podpis", () => {
    const token = signTrackingToken(CID, SUB);
    const tampered = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(verifyTrackingToken(CID, tampered)).toBeNull();
  });

  it("odrzuca podmieniony subscriberId (podpis nie pasuje)", () => {
    const token = signTrackingToken(CID, SUB);
    const sig = token.split(".")[1];
    expect(verifyTrackingToken(CID, `${SUB2}.${sig}`)).toBeNull();
  });

  it("odrzuca wejścia malformed", () => {
    expect(verifyTrackingToken(CID, null)).toBeNull();
    expect(verifyTrackingToken(CID, "")).toBeNull();
    expect(verifyTrackingToken(CID, "brak-kropki")).toBeNull();
    expect(verifyTrackingToken(CID, `${SUB}.`)).toBeNull();
    expect(verifyTrackingToken(CID, `not-a-uuid.${"a".repeat(32)}`)).toBeNull();
    // Zły campaignId.
    expect(verifyTrackingToken("not-a-uuid", signTrackingToken(CID, SUB))).toBeNull();
  });
});
