// Tokeny linków pomiaru (I9d-Y2): „Nie mierz moich otwarć i kliknięć" (`mw:`,
// subskrybent albo kontakt CRM, bez terminu) i „Zgadzam się na pomiar" (`mc:`,
// subskrybent + nonce prośby + termin). Rozłączność domen HMAC z tokenami
// trackingu, wypisu i „Chcę dalej otrzymywać"; adres strony i stopki.
// Jednorazowość zgody daje nonce prośby w bazie (`newsletter_measurement_confirm`
// - pgTAP hub_i9d_y2_reconfirm_test.sql).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MEASUREMENT_CONFIRM_TOKEN_TTL_DAYS,
  measurementOptOutUrl,
  signMeasurementConfirmToken,
  signMeasurementWithdrawToken,
  verifyMeasurementToken,
} from "../measurementToken.server";
import {
  MEASUREMENT_FOOTER_COPY,
  NEWSLETTER_MEASUREMENT_API_PATH,
  measurementPromptStateOf,
  measurementResultStateOf,
  newsletterMeasurementUrl,
} from "../measurement";
import { signNewsletterKeepToken } from "../newsletterKeepToken.server";
import {
  signJourneyMessageToken,
  signJourneyUnsubscribeToken,
  signTrackingToken,
} from "@/lib/newsletter/trackingToken.server";

const SUBSCRIBER = "6f9e6f6e-0000-4000-8000-0000000000b1";
const LEAD = "7b0c4f2e-1d3a-4c5b-9e8f-0a1b2c3d4e5f";
const NONCE = "1b2c3d4e-0000-4000-8000-00000000c0de";
const NOW = new Date("2026-10-22T08:03:00Z");
const EXPIRES = new Date("2026-12-21T08:03:00Z");

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "sekret-testowy");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Podmiana jednego znaku hex na pozycji. */
function flip(value: string, index: number): string {
  const c = value[index];
  return `${value.slice(0, index)}${c === "0" ? "1" : "0"}${value.slice(index + 1)}`;
}

describe("wycofanie pomiaru (`mw:`)", () => {
  it("subskrybent i kontakt CRM: kształt 66 znaków, weryfikacja zwraca podmiot", () => {
    const sub = signMeasurementWithdrawToken({ kind: "subscriber", subscriberId: SUBSCRIBER });
    expect(sub).toMatch(/^ws[0-9a-f]{64}$/);
    expect(verifyMeasurementToken(sub, NOW)).toEqual({
      ok: true,
      action: "withdraw",
      subject: { kind: "subscriber", subscriberId: SUBSCRIBER },
    });
    const lead = signMeasurementWithdrawToken({ kind: "lead", leadId: LEAD.toUpperCase() });
    expect(lead).toMatch(/^wl[0-9a-f]{64}$/);
    expect(verifyMeasurementToken(lead, NOW)).toEqual({
      ok: true,
      action: "withdraw",
      subject: { kind: "lead", leadId: LEAD },
    });
  });

  it("bez terminu: stopka starego maila działa zawsze", () => {
    const value = signMeasurementWithdrawToken({ kind: "subscriber", subscriberId: SUBSCRIBER });
    expect(verifyMeasurementToken(value, new Date("2099-01-01T00:00:00Z")).ok).toBe(true);
  });

  it("podmiana rodzaju podmiotu, identyfikatora albo podpisu = invalid", () => {
    const value = signMeasurementWithdrawToken({ kind: "subscriber", subscriberId: SUBSCRIBER });
    // Ten sam identyfikator jako kontakt CRM - inny podpis (rodzaj w HMAC).
    expect(verifyMeasurementToken(`wl${value.slice(2)}`, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(verifyMeasurementToken(flip(value, 5), NOW).ok).toBe(false);
    expect(verifyMeasurementToken(flip(value, 50), NOW).ok).toBe(false);
  });

  it("inny sekret serwera = invalid", () => {
    const value = signMeasurementWithdrawToken({ kind: "lead", leadId: LEAD });
    vi.stubEnv("SESSION_SECRET", "inny-sekret");
    expect(verifyMeasurementToken(value, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("identyfikator spoza UUID - wyjątek przy podpisie, `null` w adresie stopki", () => {
    expect(() =>
      signMeasurementWithdrawToken({ kind: "subscriber", subscriberId: "sub-1" }),
    ).toThrow();
    expect(
      measurementOptOutUrl("https://nes.example", { kind: "subscriber", subscriberId: "sub-1" }),
    ).toBeNull();
  });
});

describe("zgoda na pomiar (`mc:`)", () => {
  const confirm = (expiresAt: Date = EXPIRES) =>
    signMeasurementConfirmToken({ subscriberId: SUBSCRIBER, nonce: NONCE, expiresAt });

  it("ważny token: subskrybent, nonce, termin; 105 znaków", () => {
    const value = confirm();
    expect(value).toMatch(/^c[0-9a-f]{104}$/);
    expect(verifyMeasurementToken(value, NOW)).toEqual({
      ok: true,
      action: "confirm",
      subscriberId: SUBSCRIBER,
      nonce: NONCE,
      expiresAt: EXPIRES,
    });
  });

  it("po terminie = expired (tylko przy PRAWDZIWYM podpisie)", () => {
    const value = confirm(new Date("2026-10-01T00:00:00Z"));
    expect(verifyMeasurementToken(value, NOW)).toEqual({ ok: false, reason: "expired" });
    // Przedłużenie terminu w tokenie łamie podpis: invalid, nie expired.
    const forged = `${value.slice(0, 65)}ffffffff${value.slice(73)}`;
    expect(verifyMeasurementToken(forged, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("podmiana nonce albo subskrybenta = invalid", () => {
    const value = confirm();
    expect(verifyMeasurementToken(flip(value, 3), NOW).ok).toBe(false);
    expect(verifyMeasurementToken(flip(value, 40), NOW).ok).toBe(false);
  });

  it("zły termin albo UUID - wyjątek przy podpisie", () => {
    expect(() => confirm(new Date(Number.NaN))).toThrow();
    expect(() =>
      signMeasurementConfirmToken({ subscriberId: "x", nonce: NONCE, expiresAt: EXPIRES }),
    ).toThrow();
  });

  it("ważność linku z prośby jest skończona", () => {
    expect(MEASUREMENT_CONFIRM_TOKEN_TTL_DAYS).toBeGreaterThan(0);
    expect(MEASUREMENT_CONFIRM_TOKEN_TTL_DAYS).toBeLessThanOrEqual(90);
  });
});

describe("rozłączność domen HMAC", () => {
  it("tokeny trackingu, wypisu ścieżki i „Chcę dalej otrzymywać” nie przechodzą", () => {
    for (const foreign of [
      signTrackingToken(SUBSCRIBER, LEAD),
      signJourneyMessageToken("m1"),
      signJourneyUnsubscribeToken("m1"),
      signNewsletterKeepToken({ subscriberId: SUBSCRIBER, nonce: NONCE, expiresAt: EXPIRES }),
      "",
      null,
      undefined,
    ]) {
      expect(verifyMeasurementToken(foreign, NOW).ok, String(foreign)).toBe(false);
    }
  });

  it("token wycofania nie udziela zgody i odwrotnie (rodzaj akcji z podpisu)", () => {
    const withdraw = signMeasurementWithdrawToken({
      kind: "subscriber",
      subscriberId: SUBSCRIBER,
    });
    const check = verifyMeasurementToken(withdraw, NOW);
    expect(check.ok && check.action).toBe("withdraw");
    const grant = signMeasurementConfirmToken({
      subscriberId: SUBSCRIBER,
      nonce: NONCE,
      expiresAt: EXPIRES,
    });
    const grantCheck = verifyMeasurementToken(grant, NOW);
    expect(grantCheck.ok && grantCheck.action).toBe("confirm");
  });
});

describe("adres linku i stany strony", () => {
  it("link wskazuje ENDPOINT z tokenem i językiem; origin bez końcowego ukośnika", () => {
    expect(newsletterMeasurementUrl("https://nes.example/", "ws00", "en")).toBe(
      `https://nes.example${NEWSLETTER_MEASUREMENT_API_PATH}?token=ws00&lang=en`,
    );
    expect(newsletterMeasurementUrl("https://nes.example", "c+1")).toBe(
      `https://nes.example${NEWSLETTER_MEASUREMENT_API_PATH}?token=c%2B1`,
    );
    const url = new URL(
      measurementOptOutUrl("https://nes.example", { kind: "lead", leadId: LEAD }, "pl") as string,
    );
    expect(url.pathname).toBe(NEWSLETTER_MEASUREMENT_API_PATH);
    expect(url.searchParams.get("lang")).toBe("pl");
  });

  it("napisy stopki PL/EN mówią o pomiarze i wyłączeniu", () => {
    expect(MEASUREMENT_FOOTER_COPY.pl.link).toBe("Nie mierz moich otwarć i kliknięć");
    expect(MEASUREMENT_FOOTER_COPY.en.link).toBe("Don't measure my opens and clicks");
    expect(MEASUREMENT_FOOTER_COPY.pl.lead).toMatch(/otwarcia i kliknięcia/);
    expect(MEASUREMENT_FOOTER_COPY.en.lead).toMatch(/opens and clicks/);
  });

  it("odpowiedź GET -> ekran decyzji, POST -> ekran wyniku, kody błędów", () => {
    expect(measurementPromptStateOf(200, { ok: true, action: "withdraw" })).toBe("confirmWithdraw");
    expect(measurementPromptStateOf(200, { ok: true, action: "confirm" })).toBe("confirmGrant");
    expect(measurementResultStateOf(200, { ok: true, action: "withdraw" })).toBe("withdrawn");
    expect(measurementResultStateOf(200, { ok: true, action: "withdraw", already: true })).toBe(
      "alreadyOff",
    );
    expect(measurementResultStateOf(200, { ok: true, action: "confirm" })).toBe("granted");
    expect(measurementResultStateOf(200, { ok: true, action: "confirm", already: true })).toBe(
      "alreadyOn",
    );
    expect(measurementResultStateOf(410, { error: "expired" })).toBe("expired");
    expect(measurementResultStateOf(400, { error: "invalid_token" })).toBe("invalid");
    expect(measurementResultStateOf(409, { error: "inactive" })).toBe("inactive");
    expect(measurementResultStateOf(404, { error: "not_found" })).toBe("gone");
    expect(measurementResultStateOf(429, {})).toBe("rateLimited");
    expect(measurementPromptStateOf(500, { error: "nowy_kod" })).toBe("error");
  });
});
