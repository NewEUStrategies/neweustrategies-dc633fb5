// Token linku „Chcę dalej otrzymywać" (I9d-Y1): podpis HMAC z własną domeną
// `nk:`, termin ważności w podpisie, kształt jednego napisu. Jednorazowość
// daje nonce cyklu w bazie (`newsletter_sunset_keep` - pgTAP
// hub_i9d_newsletter_sunset_test.sql) i trasa publiczna
// (`-api.public.newsletter.keep.test.ts`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isNewsletterKeepToken,
  signNewsletterKeepToken,
  verifyNewsletterKeepToken,
} from "../newsletterKeepToken.server";
import {
  signJourneyMessageToken,
  signJourneyUnsubscribeToken,
  signTrackingToken,
  verifyJourneyUnsubscribeToken,
} from "@/lib/newsletter/trackingToken.server";

const SUBSCRIBER = "6f9e6f6e-0000-4000-8000-0000000000b1";
const NONCE = "1b2c3d4e-0000-4000-8000-00000000c0de";
const NOW = new Date("2026-10-22T08:03:00Z");
const EXPIRES = new Date("2027-02-19T08:03:00Z");

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "sekret-testowy");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function token(overrides: Partial<{ subscriberId: string; nonce: string; expiresAt: Date }> = {}) {
  return signNewsletterKeepToken({
    subscriberId: SUBSCRIBER,
    nonce: NONCE,
    expiresAt: EXPIRES,
    ...overrides,
  });
}

/** Podmiana jednego znaku hex na pozycji (poza literą `k`). */
function flip(value: string, index: number): string {
  const c = value[index];
  return `${value.slice(0, index)}${c === "0" ? "1" : "0"}${value.slice(index + 1)}`;
}

describe("podpis", () => {
  it("ważny token zwraca subskrybenta, nonce i termin; kształt 105 znaków hex", () => {
    const value = token();
    expect(value).toMatch(/^k[0-9a-f]{104}$/);
    expect(isNewsletterKeepToken(value)).toBe(true);
    expect(verifyNewsletterKeepToken(value, NOW)).toEqual({
      ok: true,
      subscriberId: SUBSCRIBER,
      nonce: NONCE,
      expiresAt: EXPIRES,
    });
    // Wielkość liter bez znaczenia (klient pocztowy potrafi zmienić).
    expect(verifyNewsletterKeepToken(value.toUpperCase().replace(/^K/, "k"), NOW).ok).toBe(true);
  });

  it("zmiana subskrybenta, nonce, terminu albo podpisu = nieważny", () => {
    const value = token();
    for (const index of [1, 40, 70, 100]) {
      expect(verifyNewsletterKeepToken(flip(value, index), NOW), `pozycja ${index}`).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
  });

  it("inny sekret serwera = nieważny (podpis nie da się odtworzyć poza serwerem)", () => {
    const value = token();
    vi.stubEnv("SESSION_SECRET", "inny-sekret");
    expect(verifyNewsletterKeepToken(value, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("domena `nk:`: token trackingu, wypisu ani kampanii nie przechodzi - i odwrotnie", () => {
    for (const foreign of [
      signJourneyMessageToken(SUBSCRIBER),
      signJourneyUnsubscribeToken(SUBSCRIBER),
      signTrackingToken(NONCE, SUBSCRIBER),
      "0123456789abcdef0123456789abcdef",
    ]) {
      expect(verifyNewsletterKeepToken(foreign, NOW)).toEqual({ ok: false, reason: "invalid" });
    }
    // Token linku nie wypisze odbiorcy (inny kształt i inna domena HMAC).
    expect(verifyJourneyUnsubscribeToken(token())).toBeNull();
  });

  it("zły kształt: puste, za krótkie, znaki spoza hex", () => {
    for (const bad of [null, undefined, "", "k", `${token()}0`, `${token().slice(0, -1)}z`]) {
      expect(verifyNewsletterKeepToken(bad, NOW)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(() => token({ subscriberId: "nie-uuid" })).toThrow();
    expect(() => token({ expiresAt: new Date(Number.NaN) })).toThrow();
  });
});

describe("wygaśnięcie", () => {
  it("po terminie `expired`, tuż przed - ważny", () => {
    const value = token();
    expect(verifyNewsletterKeepToken(value, new Date(EXPIRES.getTime() - 1000)).ok).toBe(true);
    expect(verifyNewsletterKeepToken(value, EXPIRES)).toEqual({ ok: false, reason: "expired" });
    expect(verifyNewsletterKeepToken(value, new Date("2030-01-01T00:00:00Z"))).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("podrobiony termin z przeszłości to `invalid`, nie wskazówka o formacie", () => {
    const value = token();
    const past = Math.floor(new Date("2020-01-01T00:00:00Z").getTime() / 1000)
      .toString(16)
      .padStart(8, "0");
    const forged = `${value.slice(0, 65)}${past}${value.slice(73)}`;
    expect(verifyNewsletterKeepToken(forged, NOW)).toEqual({ ok: false, reason: "invalid" });
  });
});
