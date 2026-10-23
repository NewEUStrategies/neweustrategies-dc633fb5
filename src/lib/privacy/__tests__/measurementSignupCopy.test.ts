// Prośba o potwierdzenie zgody na pomiar PO ZAPISIE (I9d-Y2b, `origin =
// 'signup'`): stała treść maila, harmonogram bez okna dziennego i własny
// dzienny limit.
//
// Co tu ma się nie zepsuć (a czego nie widać w UI):
//   1. TREŚĆ: PL i EN mają te same pola, każde niepuste i w limicie edytora
//      (wspólny kształt z prośbą z panelu), bez HTML i bez zmiennych - mail
//      jest stały, bo osoba sama zaznaczyła pole; mówi, że pomiar włączy
//      dopiero jej kliknięcie, a zignorowanie niczego nie zmienia;
//   2. LINK STOPKI: treść cytuje etykietę linku „Nie mierz moich otwarć
//      i kliknięć" DOKŁADNIE tak, jak stoi w stopce maili;
//   3. HARMONOGRAM: prośby po zapisie co 10 minut przez całą dobę (minuta 4),
//      w oknie dziennym razem z prośbami z panelu; nigdy w ticku próśb
//      wygaszania (minuta 9);
//   4. LIMIT: własny, niezależny od wspólnego limitu panelu i Y1 - lustro
//      stałej SQL (parytet aktywny, gdy najnowsza definicja
//      `newsletter_measurement_claim` ma filtr pochodzenia `p_origin`).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MEASUREMENT_FOOTER_COPY } from "../measurement";
import {
  NEWSLETTER_MEASUREMENT_COPY_FIELDS,
  NEWSLETTER_MEASUREMENT_COPY_LIMITS,
  NEWSLETTER_MEASUREMENT_DEFAULT_COPY,
  NEWSLETTER_MEASUREMENT_EMPTY_OVERRIDES,
  NEWSLETTER_MEASUREMENT_ORIGINS,
  NEWSLETTER_MEASUREMENT_SIGNUP_COPY,
  NEWSLETTER_MEASUREMENT_SIGNUP_DAILY_CAP,
  isNewsletterMeasurementMailWindow,
  newsletterMeasurementMailScope,
  newsletterMeasurementOriginOf,
  resolveNewsletterMeasurementMailCopy,
} from "../measurementReconfirm";
import { DATA_RETENTION_RULES } from "../dataRetention";
import { copyLength, isNewsletterSunsetMailWindow } from "../newsletterSunset";

const LANGS = ["pl", "en"] as const;

describe("treść prośby po zapisie", () => {
  it("PL i EN: te same pola co prośba z panelu, każde niepuste i w limicie edytora", () => {
    for (const lang of LANGS) {
      expect(Object.keys(NEWSLETTER_MEASUREMENT_SIGNUP_COPY[lang]).sort()).toEqual(
        [...NEWSLETTER_MEASUREMENT_COPY_FIELDS].sort(),
      );
      for (const field of NEWSLETTER_MEASUREMENT_COPY_FIELDS) {
        const value = NEWSLETTER_MEASUREMENT_SIGNUP_COPY[lang][field];
        expect(value.trim(), `${lang}.${field}`).not.toBe("");
        expect(copyLength(value), `${lang}.${field}`).toBeLessThanOrEqual(
          NEWSLETTER_MEASUREMENT_COPY_LIMITS[field],
        );
      }
    }
  });

  it("bez HTML i bez zmiennych - treść stała (szablon eskapuje tekst)", () => {
    for (const lang of LANGS) {
      for (const field of NEWSLETTER_MEASUREMENT_COPY_FIELDS) {
        const value = NEWSLETTER_MEASUREMENT_SIGNUP_COPY[lang][field];
        expect(value, `${lang}.${field}`).not.toMatch(/[<>]/);
        expect(value, `${lang}.${field}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("to INNA treść niż prośba z panelu (osoba sama zaznaczyła pole)", () => {
    for (const lang of LANGS) {
      expect(NEWSLETTER_MEASUREMENT_SIGNUP_COPY[lang].subject).not.toBe(
        NEWSLETTER_MEASUREMENT_DEFAULT_COPY[lang].subject,
      );
    }
  });

  it("mówi, że pomiar włączy dopiero kliknięcie, a zignorowanie niczego nie zmienia", () => {
    const pl = NEWSLETTER_MEASUREMENT_SIGNUP_COPY.pl;
    expect(pl.intro).toMatch(/dopiero wtedy, gdy potwierdzisz/);
    expect(pl.note).toMatch(/zignoruj tę wiadomość/);
    expect(pl.note).toMatch(/pomiar nie zostanie włączony/);
    const en = NEWSLETTER_MEASUREMENT_SIGNUP_COPY.en;
    expect(en.intro).toMatch(/only once you confirm/);
    expect(en.note).toMatch(/ignore this email/);
    expect(en.note).toMatch(/measurement stays off/);
  });

  it("wycofanie bez rezygnacji z newslettera - etykieta linku = stopka maili", () => {
    for (const lang of LANGS) {
      expect(NEWSLETTER_MEASUREMENT_SIGNUP_COPY[lang].intro).toContain(
        MEASUREMENT_FOOTER_COPY[lang].link,
      );
    }
    expect(NEWSLETTER_MEASUREMENT_SIGNUP_COPY.pl.intro).toMatch(/bez rezygnacji z newslettera/);
    expect(NEWSLETTER_MEASUREMENT_SIGNUP_COPY.en.intro).toMatch(/without unsubscribing/);
  });

  it("wstęp ma dwa akapity (pusta linia - jak treść z panelu)", () => {
    for (const lang of LANGS) {
      expect(NEWSLETTER_MEASUREMENT_SIGNUP_COPY[lang].intro.split(/\n\s*\n/)).toHaveLength(2);
    }
  });

  it("wybór treści: po zapisie STAŁA (nadpisania ignorowane), z panelu - nadpisania", () => {
    const overrides = {
      pl: { ...NEWSLETTER_MEASUREMENT_EMPTY_OVERRIDES.pl, subject: "Z panelu, {firstName}" },
      en: { ...NEWSLETTER_MEASUREMENT_EMPTY_OVERRIDES.en, subject: "From the panel" },
    };
    const values = { firstName: "Anna" };
    expect(resolveNewsletterMeasurementMailCopy("signup", overrides, "pl", values)).toEqual(
      NEWSLETTER_MEASUREMENT_SIGNUP_COPY.pl,
    );
    expect(resolveNewsletterMeasurementMailCopy("panel", overrides, "pl", values).subject).toBe(
      "Z panelu, Anna",
    );
    expect(resolveNewsletterMeasurementMailCopy("panel", overrides, "en", values).subject).toBe(
      "From the panel",
    );
  });

  it("pochodzenie z wiersza: wyłącznie `signup` rozpoznany, reszta = `panel`", () => {
    expect(NEWSLETTER_MEASUREMENT_ORIGINS).toEqual(["panel", "signup"]);
    expect(newsletterMeasurementOriginOf("signup")).toBe("signup");
    for (const raw of ["panel", undefined, null, "", "Signup", 1]) {
      expect(newsletterMeasurementOriginOf(raw)).toBe("panel");
    }
  });
});

describe("harmonogram próśb", () => {
  it("okno dzienne (12:04 w Polsce): prośby obu pochodzeń", () => {
    expect(newsletterMeasurementMailScope(new Date("2026-12-01T11:04:00Z"))).toBe("all");
  });

  it("noc i wieczór (minuta 4 poza oknem): WYŁĄCZNIE prośby po zapisie", () => {
    for (const at of ["2026-12-01T22:04:00Z", "2026-12-01T03:14:00Z", "2026-12-01T17:04:00Z"]) {
      const now = new Date(at);
      expect(isNewsletterMeasurementMailWindow(now), at).toBe(false);
      expect(newsletterMeasurementMailScope(now), at).toBe("signup");
    }
  });

  it("co 10 minut przez całą dobę - nigdy w ticku próśb wygaszania", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      for (let minute = 0; minute < 60; minute += 1) {
        const at = new Date(Date.UTC(2026, 11, 1, hour, minute));
        const scope = newsletterMeasurementMailScope(at);
        expect(scope !== null, `${hour}:${minute}`).toBe(minute % 10 === 4);
        if (scope !== null) expect(isNewsletterSunsetMailWindow(at)).toBe(false);
        expect(scope === "all").toBe(isNewsletterMeasurementMailWindow(at));
      }
    }
  });
});

describe("limit próśb po zapisie", () => {
  it("własny limit dzienny, liczba całkowita, nie mniejszy niż wspólny limit panelu i Y1", () => {
    expect(Number.isInteger(NEWSLETTER_MEASUREMENT_SIGNUP_DAILY_CAP)).toBe(true);
    expect(NEWSLETTER_MEASUREMENT_SIGNUP_DAILY_CAP).toBeGreaterThanOrEqual(
      DATA_RETENTION_RULES.newsletterDailyCap,
    );
  });

  // Parytet z SQL: najnowsza definicja `newsletter_measurement_claim`.
  // Aktywny, gdy ta definicja ma filtr pochodzenia (`p_origin`, I9d-Y2b) -
  // wtedy liczy też własny limit próśb po zapisie i musi go mieć równego TS.
  const MIGRATIONS = join(process.cwd(), "supabase/migrations");
  const latestClaim = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS, name), "utf8"))
    .filter((sql) => /FUNCTION\s+public\.newsletter_measurement_claim\s*\(/.test(sql))
    .at(-1);
  const hasOrigin = latestClaim !== undefined && /\bp_origin\b/.test(latestClaim);

  it.runIf(hasOrigin)("limit = `c_signup_daily_cap` najnowszej definicji zajęcia (SQL)", () => {
    const caps = [
      ...(latestClaim ?? "").matchAll(/c_signup_daily_cap\s+constant\s+integer\s*:=\s*(\d+)\s*;/g),
    ].map((m) => Number(m[1]));
    expect(caps.length).toBeGreaterThanOrEqual(1);
    expect(new Set(caps)).toEqual(new Set([NEWSLETTER_MEASUREMENT_SIGNUP_DAILY_CAP]));
  });
});
