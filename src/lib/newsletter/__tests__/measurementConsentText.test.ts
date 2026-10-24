// Jedno źródło treści OSOBNEGO pola zgody na pomiar otwarć i kliknięć
// (I9d-Y2b, wariant (b) z 2026-10-23): parytet TS ⇄ SQL, parytet PL/EN,
// obowiązkowe elementy treści, rozpoznanie treści, ładunek deklaracji i notka
// maila double opt-in.
//
// Parytet czyta NAJNOWSZĄ migrację z blokami
// `email-measurement-consent-default:*` i `email-measurement-consent-version`
// (od I9d-Y2b: 20261023090000) - nowa wersja treści w nowej migracji
// przesuwa porównanie sama, bez edycji testu.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MEASUREMENT_FOOTER_COPY } from "@/lib/privacy/measurement";
import {
  NEWSLETTER_CONSENT_VERSION,
  NEWSLETTER_CONSENT_VERSION_BUNDLED,
  newsletterConsentHtml,
} from "../consentText";
import {
  EMAIL_MEASUREMENT_CONSENT_KEY,
  EMAIL_MEASUREMENT_CONSENT_VERSION,
  EMAIL_MEASUREMENT_DECLARED_KEY,
  isMeasurementConsentText,
  isReservedConsentKey,
  MEASUREMENT_CONSENT_VERSIONS,
  MEASUREMENT_DOI_MAIL_NOTE,
  measurementConsentFieldAccessibleName,
  measurementConsentHtml,
  measurementConsentLangOf,
  measurementConsentPayload,
  measurementConsentPlain,
  measurementConsentSegments,
  measurementConsentSummaryPlain,
  measurementConsentSummarySegments,
  normalizeConsentKey,
  RESERVED_CONSENT_KEYS,
} from "../measurementConsentText";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function latestMigrationWith(marker: string): { file: string; sql: string } {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{14}_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
  let found: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    if (sql.includes(marker)) found = { file, sql };
  }
  if (!found) throw new Error(`brak migracji ze znacznikiem ${marker}`);
  return found;
}

/** Literał SQL w linii po znaczniku `-- <marker>` (z odklejeniem `''`). */
function literalAfter(sql: string, marker: string): string {
  const lines = sql.split("\n");
  const at = lines.findIndex((line) => line.trim() === `-- ${marker}`);
  if (at < 0) throw new Error(`brak znacznika ${marker}`);
  const next = lines[at + 1] ?? "";
  const match = /'((?:[^']|'')*)'/.exec(next);
  if (!match) throw new Error(`brak literału po ${marker}`);
  return match[1].replace(/''/g, "'");
}

describe("treść pola pomiaru - parytet TS ⇄ SQL", () => {
  it("HTML PL i EN = literały `_email_measurement_consent_default`", () => {
    const { file, sql } = latestMigrationWith("email-measurement-consent-default:pl");
    expect(file).toMatch(/^\d{14}_/);
    expect(measurementConsentHtml("pl")).toBe(
      literalAfter(sql, "email-measurement-consent-default:pl"),
    );
    expect(measurementConsentHtml("en")).toBe(
      literalAfter(sql, "email-measurement-consent-default:en"),
    );
  });

  it("wersja = literał `_email_measurement_consent_version`", () => {
    const { sql } = latestMigrationWith("email-measurement-consent-version");
    const at = sql.indexOf("-- email-measurement-consent-version");
    const match = /SELECT\s+'([^']+)'::text/.exec(sql.slice(at));
    expect(match?.[1]).toBe(EMAIL_MEASUREMENT_CONSENT_VERSION);
  });
});

describe("wersja i rejestr wersji pomiaru", () => {
  it("mieści się w limicie ładunku (zod 32) i w CHECK wersji prośby", () => {
    expect(EMAIL_MEASUREMENT_CONSENT_VERSION.length).toBeLessThanOrEqual(32);
    expect(EMAIL_MEASUREMENT_CONSENT_VERSION).toMatch(/^[a-z0-9_.:-]{1,64}$/);
  });

  it("rejestr = wyłącznie treść osobnego pola; żadna wersja treści newslettera", () => {
    expect(MEASUREMENT_CONSENT_VERSIONS).toEqual([EMAIL_MEASUREMENT_CONSENT_VERSION]);
    expect(MEASUREMENT_CONSENT_VERSIONS).not.toContain(NEWSLETTER_CONSENT_VERSION);
    expect(MEASUREMENT_CONSENT_VERSIONS).not.toContain(NEWSLETTER_CONSENT_VERSION_BUNDLED);
  });
});

describe("treść pola pomiaru - kształt i obowiązkowe elementy", () => {
  it("PL i EN mają odcinki [tekst, link, tekst]", () => {
    const shape = (lang: "pl" | "en") =>
      measurementConsentSegments(lang).map((part) => (typeof part === "string" ? "t" : "a"));
    expect(shape("pl")).toEqual(["t", "a", "t"]);
    expect(shape("en")).toEqual(shape("pl"));
  });

  it("PL: dobrowolność, newsletter bez zgody, potwierdzenie, link stopki, #pomiar", () => {
    const plain = measurementConsentPlain("pl");
    expect(plain).toMatch(/^Zgadzam się na pomiar otwarć i kliknięć/);
    expect(plain).toMatch(/aby dopasować treść i częstotliwość wysyłki oraz prowadzić statystykę/);
    expect(plain).toMatch(/Zgoda jest dobrowolna/);
    expect(plain).toMatch(/newsletter otrzymam także bez niej/);
    expect(plain).toMatch(/dopiero, gdy potwierdzę tę zgodę przyciskiem/);
    expect(plain).toMatch(/wycofać w każdej chwili, bez rezygnacji z newslettera/);
    expect(plain).toContain(`„${MEASUREMENT_FOOTER_COPY.pl.link}”`);
    expect(measurementConsentHtml("pl")).toContain(
      '(<a href="/komunikacja-i-marketing#pomiar">szczegóły</a>).',
    );
  });

  it("EN: optional, newsletter without it, confirm, footer link, /en/…#pomiar", () => {
    const plain = measurementConsentPlain("en");
    expect(plain).toMatch(/^I agree to the measurement of opens and clicks/);
    expect(plain).toMatch(/tailor the content and sending frequency and keep statistics/);
    expect(plain).toMatch(/This consent is optional/);
    expect(plain).toMatch(/I will receive the newsletter without it/);
    expect(plain).toMatch(/only after I confirm this consent with the button/);
    expect(plain).toMatch(/withdraw it at any time, without unsubscribing/);
    expect(plain).toContain(`“${MEASUREMENT_FOOTER_COPY.en.link}”`);
    expect(measurementConsentHtml("en")).toContain(
      '(<a href="/en/komunikacja-i-marketing#pomiar">details</a>).',
    );
  });

  it("tekst bez znaczników nie ma HTML; HTML mieści się w limicie treści (zod 2000)", () => {
    for (const lang of ["pl", "en"] as const) {
      expect(measurementConsentPlain(lang)).not.toMatch(/[<>]/);
      expect(measurementConsentHtml(lang).length).toBeLessThanOrEqual(2000);
    }
  });
});

describe("krótka etykieta pola (prezentacja; pełna treść zostaje w rejestrze)", () => {
  it("PL i EN: dokładnie skrót, którego chciał właściciel", () => {
    expect(measurementConsentSummaryPlain("pl")).toBe(
      "Zgoda na pomiar interakcji na naszej platformie, aby poprawiać jakość spersonalizowanych usług i dopasowywać komunikację marketingową.",
    );
    expect(measurementConsentSummaryPlain("en")).toBe(
      "Consent to measuring interactions on our platform, to improve the quality of personalized services and tailor marketing communications.",
    );
  });

  it("skrót nie opisuje techniki pomiaru, jest jednym zdaniem bez linku i jest krótszy od treści dowodowej", () => {
    for (const lang of ["pl", "en"] as const) {
      const summary = measurementConsentSummaryPlain(lang);
      expect(summary.length).toBeLessThan(measurementConsentPlain(lang).length);
      expect(summary).not.toMatch(/niewidoczn|identyfikatorem|tracking image|identifier/i);
      expect(summary).not.toMatch(/\bod Was\b/i);
      // Etykieta to samo zdanie: bez linku „szczegóły" - ten niesie pełna
      // treść dowodowa na stronie potwierdzenia.
      expect(
        measurementConsentSummarySegments(lang).every((part) => typeof part === "string"),
      ).toBe(true);
    }
  });

  it("pole nadal nazywa to, czego dotyczy zgoda (nazwa dostępna czytnika ekranu)", () => {
    expect(measurementConsentFieldAccessibleName("pl")).toMatch(/pomiar otwarć i kliknięć/);
    expect(measurementConsentFieldAccessibleName("en")).toMatch(/measuring opens and clicks/);
  });
});

describe("rozpoznanie treści pola pomiaru", () => {
  it("HTML albo tekst, PL albo EN, po obcięciu brzegów", () => {
    expect(measurementConsentLangOf(measurementConsentHtml("pl"))).toBe("pl");
    expect(measurementConsentLangOf(` ${measurementConsentPlain("en")}\n`)).toBe("en");
    expect(isMeasurementConsentText(measurementConsentPlain("pl"))).toBe(true);
    expect(isMeasurementConsentText(`\t${measurementConsentHtml("en")}`)).toBe(true);
  });

  it("obca treść, treść zgody na newsletter i pusty tekst - nie", () => {
    for (const text of ["", "   ", "Zgadzam się na pomiar.", newsletterConsentHtml("pl")]) {
      expect(isMeasurementConsentText(text)).toBe(false);
    }
    expect(measurementConsentLangOf(null)).toBeNull();
    expect(measurementConsentLangOf(undefined)).toBeNull();
    // Fragment treści to nie treść.
    expect(isMeasurementConsentText(measurementConsentPlain("pl").slice(0, 120))).toBe(false);
  });
});

describe("ładunek deklaracji i klucze zastrzeżone", () => {
  it("deklaracja: osobny klucz, treść HTML i wersja z rejestru, given:true, język", () => {
    expect(measurementConsentPayload("pl")).toEqual({
      key: "email_measurement_declared",
      text: measurementConsentHtml("pl"),
      version: "email-measurement-2026-10-23",
      given: true,
      lang: "pl",
    });
    expect(measurementConsentPayload("en").key).toBe(EMAIL_MEASUREMENT_DECLARED_KEY);
    // Mieści się w limitach `ConsentEntry` (klucz 64).
    expect(EMAIL_MEASUREMENT_DECLARED_KEY.length).toBeLessThanOrEqual(64);
  });

  it("klucz zgody i klucz deklaracji są zastrzeżone (bez względu na wielkość liter)", () => {
    expect(RESERVED_CONSENT_KEYS).toEqual([
      EMAIL_MEASUREMENT_CONSENT_KEY,
      EMAIL_MEASUREMENT_DECLARED_KEY,
    ]);
    expect(isReservedConsentKey(" Email_Measurement ")).toBe(true);
    expect(isReservedConsentKey("EMAIL_MEASUREMENT_DECLARED")).toBe(true);
    expect(isReservedConsentKey("newsletter")).toBe(false);
    expect(isReservedConsentKey("email_measurement_x")).toBe(false);
    expect(normalizeConsentKey("  News_Letter ")).toBe("news_letter");
  });
});

describe("notka maila double opt-in", () => {
  it("PL i EN: pole pomiaru, decyzja na stronie potwierdzenia, newsletter bez zgody", () => {
    expect(MEASUREMENT_DOI_MAIL_NOTE.pl).toMatch(/pole zgody na pomiar otwarć i kliknięć/);
    expect(MEASUREMENT_DOI_MAIL_NOTE.pl).toMatch(/na stronie potwierdzenia/);
    expect(MEASUREMENT_DOI_MAIL_NOTE.pl).toMatch(/dopiero po Twoim kliknięciu/);
    expect(MEASUREMENT_DOI_MAIL_NOTE.pl).toMatch(/newsletter przychodzi tak samo/);
    expect(MEASUREMENT_DOI_MAIL_NOTE.en).toMatch(/consent to measuring opens and clicks/);
    expect(MEASUREMENT_DOI_MAIL_NOTE.en).toMatch(/on the confirmation page/);
    expect(MEASUREMENT_DOI_MAIL_NOTE.en).toMatch(/only after you click/);
    expect(MEASUREMENT_DOI_MAIL_NOTE.en).toMatch(/newsletter arrives the same without it/);
    for (const lang of ["pl", "en"] as const) {
      expect(MEASUREMENT_DOI_MAIL_NOTE[lang]).not.toMatch(/[<>]/);
    }
  });
});
