// „Poproś o zgodę na pomiar" (I9d-Y2, I9d-Y2b) - stałe czyste i parsery
// panelu: treść domyślna PL/EN w limitach i z parytetem pól, nadpisania
// z panelu, zmienne, okno wysyłki (inna minuta niż prośby wygaszania),
// kategoria listy wyłączeń, parytet stałych z SQL (limit dzienny, ważność
// linku) oraz kontrakty RPC panelu (`rpc-shape`). Parsera stanu treści zgody
// z oznaczeniami admina nie ma od I9d-Y2b (RPC usunięte, wariant (b)).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { emailCategoryForLabel } from "@/lib/email/suppressionPolicy";
import { MEASUREMENT_CONFIRM_LINK_DAYS } from "../measurement";
import * as measurementParse from "../measurementParse";
import {
  campaignMeasuredDenominator,
  parseCampaignMeasurement,
  parseNewsletterMeasurementPreview,
  parseNewsletterMeasurementRequest,
} from "../measurementParse";
import {
  interpolateMeasurementCopy,
  isNewsletterMeasurementMailWindow,
  NEWSLETTER_MEASUREMENT_COPY_FIELDS,
  NEWSLETTER_MEASUREMENT_COPY_LIMITS,
  NEWSLETTER_MEASUREMENT_DEFAULT_COPY,
  NEWSLETTER_MEASUREMENT_EMPTY_OVERRIDES,
  NEWSLETTER_MEASUREMENT_FIXED_COPY,
  NEWSLETTER_MEASUREMENT_LINK_DAYS,
  NEWSLETTER_MEASUREMENT_MAIL_LABEL,
  resolveNewsletterMeasurementCopy,
} from "../measurementReconfirm";
import { copyLength, isNewsletterSunsetMailWindow } from "../newsletterSunset";

const RECONFIRM_SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/20261020162500_consent_measurement_reconfirm.sql"),
  "utf8",
);

describe("treść prośby", () => {
  it("treść domyślna PL i EN: każde pole niepuste i w limicie panelu", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const field of NEWSLETTER_MEASUREMENT_COPY_FIELDS) {
        const value = NEWSLETTER_MEASUREMENT_DEFAULT_COPY[lang][field];
        expect(value.trim(), `${lang}.${field}`).not.toBe("");
        expect(copyLength(value), `${lang}.${field}`).toBeLessThanOrEqual(
          NEWSLETTER_MEASUREMENT_COPY_LIMITS[field],
        );
      }
    }
    expect(Object.keys(NEWSLETTER_MEASUREMENT_FIXED_COPY.pl)).toEqual(
      Object.keys(NEWSLETTER_MEASUREMENT_FIXED_COPY.en),
    );
  });

  it("treść mówi, że brak reakcji niczego nie zmienia i że zgodę można wycofać", () => {
    expect(NEWSLETTER_MEASUREMENT_DEFAULT_COPY.pl.note).toMatch(/nic się nie zmieni/);
    expect(NEWSLETTER_MEASUREMENT_DEFAULT_COPY.en.note).toMatch(/nothing changes/);
    expect(NEWSLETTER_MEASUREMENT_DEFAULT_COPY.pl.intro).toMatch(/wycofać w każdej chwili/);
    expect(NEWSLETTER_MEASUREMENT_DEFAULT_COPY.en.intro).toMatch(/withdraw your consent/);
  });

  it("puste pole = domyślne, pole z panelu wygrywa, imię podstawione; puste po podstawieniu = domyślne", () => {
    const overrides = {
      pl: { ...NEWSLETTER_MEASUREMENT_EMPTY_OVERRIDES.pl, heading: " {firstName}, pytanie " },
      en: { ...NEWSLETTER_MEASUREMENT_EMPTY_OVERRIDES.en, subject: "{firstName}" },
    };
    const pl = resolveNewsletterMeasurementCopy(overrides, "pl", { firstName: "Anna" });
    expect(pl.heading).toBe("Anna, pytanie");
    expect(pl.cta).toBe(NEWSLETTER_MEASUREMENT_DEFAULT_COPY.pl.cta);
    const en = resolveNewsletterMeasurementCopy(overrides, "en", { firstName: "" });
    expect(en.subject).toBe(NEWSLETTER_MEASUREMENT_DEFAULT_COPY.en.subject);
  });

  it("zmienne wygaszania (`{daysLeft}`) nie istnieją w tej prośbie - znikają", () => {
    expect(interpolateMeasurementCopy("Hej {firstName} {daysLeft}!", { firstName: "Anna" })).toBe(
      "Hej Anna !",
    );
  });
});

describe("okno, kanał i stałe wspólne z SQL", () => {
  it("08:04-17:54 czasu polskiego, minuta 4 - nigdy w tym samym ticku co prośby wygaszania", () => {
    expect(isNewsletterMeasurementMailWindow(new Date("2026-12-01T07:04:00Z"))).toBe(true);
    expect(isNewsletterMeasurementMailWindow(new Date("2026-12-01T06:54:00Z"))).toBe(false);
    expect(isNewsletterMeasurementMailWindow(new Date("2026-12-01T16:54:00Z"))).toBe(true);
    expect(isNewsletterMeasurementMailWindow(new Date("2026-12-01T17:04:00Z"))).toBe(false);
    for (let minute = 0; minute < 60; minute += 1) {
      const at = new Date(Date.UTC(2026, 11, 1, 10, minute));
      expect(
        isNewsletterMeasurementMailWindow(at) && isNewsletterSunsetMailWindow(at),
        `minuta ${minute}`,
      ).toBe(false);
    }
  });

  it("etykieta wysyłki to poczta masowa (lista wyłączeń blokuje każdy powód)", () => {
    expect(emailCategoryForLabel(NEWSLETTER_MEASUREMENT_MAIL_LABEL)).toBe("bulk");
  });

  it("ważność linku: jedno źródło; dzienny limit w podglądzie = limit zajęcia (SQL)", () => {
    expect(NEWSLETTER_MEASUREMENT_LINK_DAYS).toBe(MEASUREMENT_CONFIRM_LINK_DAYS);
    const caps = [...RECONFIRM_SQL.matchAll(/c_daily_cap constant integer := (\d+);/g)].map(
      (m) => m[1],
    );
    expect(caps.length).toBeGreaterThanOrEqual(2);
    expect(new Set(caps).size).toBe(1);
  });
});

describe("kontrakty RPC panelu", () => {
  const PREVIEW = {
    version: "email-measurement-2026-10-23",
    enabled: true,
    subscribers: "120",
    with_consent: 20,
    candidates: 90,
    suppressed: 10,
    requested: 0,
    pending: 0,
    mailed: 0,
    blocked: 0,
    skipped: 0,
    failed: 0,
    confirmed: 0,
    daily_cap: 200,
    last_requested_at: null,
  };

  it("podgląd prośby: liczniki `bigint` jako liczby, brak pola = błąd kontraktu", () => {
    expect(parseNewsletterMeasurementPreview(PREVIEW)).toMatchObject({
      subscribers: 120,
      withConsent: 20,
      candidates: 90,
      suppressed: 10,
      dailyCap: 200,
      lastRequestedAt: null,
    });
    const { candidates: _omit, ...broken } = PREVIEW;
    expect(() => parseNewsletterMeasurementPreview(broken)).toThrow(/candidates/);
    expect(parseNewsletterMeasurementRequest({ requested: 3, version: "v" })).toEqual({
      requested: 3,
      version: "v",
    });
  });

  it("bez parsera stanu treści zgody i oznaczeń admina (I9d-Y2b)", () => {
    const names = Object.keys(measurementParse);
    expect(names).not.toContain("parseConsentMeasurement");
    expect(names).not.toContain("consentFieldNeedsWarning");
    expect(names).not.toContain("CONSENT_MEASUREMENT_FIELDS");
  });

  it("mianownik kampanii: mierzeni po Y2, wszyscy wysłani dla kampanii sprzed Y2", () => {
    const after = parseCampaignMeasurement({
      campaign_id: "c1",
      sent: 100,
      measured: 30,
      unmeasured: 70,
      unknown: 0,
    });
    expect(campaignMeasuredDenominator(after)).toBe(30);
    const before = parseCampaignMeasurement({
      campaign_id: "c1",
      sent: 100,
      measured: 0,
      unmeasured: 0,
      unknown: 100,
    });
    expect(campaignMeasuredDenominator(before)).toBe(100);
  });
});
