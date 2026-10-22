// Jedno źródło treści zgody na newsletter (I9d-Y2): parytet TS ⇄ SQL,
// parytet PL/EN, dawne treści domyślne, normalizacja wersji w ładunku.
//
// Parytet czyta NAJNOWSZĄ migrację z blokami `newsletter-consent-default:*`
// i `newsletter-consent-version` (dziś 20261020162300) - nowa wersja treści
// w nowej migracji przesuwa porównanie sama, bez edycji testu.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  isNewsletterConsentDefault,
  LEGACY_NEWSLETTER_CONSENT_DEFAULTS,
  MEASUREMENT_CONSENT_VERSIONS,
  NEWSLETTER_CONSENT_VERSION,
  newsletterConsentHtml,
  newsletterConsentPayload,
  newsletterConsentPlain,
  newsletterConsentSegments,
  normalizeConsentVersion,
  privacyAcceptanceHtml,
  resolveNewsletterConsent,
} from "../consentText";

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

describe("treść zgody na newsletter - parytet TS ⇄ SQL", () => {
  const { file, sql } = latestMigrationWith("newsletter-consent-default:pl");

  it("HTML treści domyślnej PL i EN = literały `_newsletter_consent_default`", () => {
    expect(file).toMatch(/^\d{14}_/);
    expect(newsletterConsentHtml("pl")).toBe(literalAfter(sql, "newsletter-consent-default:pl"));
    expect(newsletterConsentHtml("en")).toBe(literalAfter(sql, "newsletter-consent-default:en"));
  });

  it("wersja = literał `_newsletter_consent_version` i jest w rejestrze wersji z pomiarem", () => {
    const { sql: versionSql } = latestMigrationWith("newsletter-consent-version");
    const at = versionSql.indexOf("-- newsletter-consent-version");
    const match = /SELECT\s+'([^']+)'::text/.exec(versionSql.slice(at));
    expect(match?.[1]).toBe(NEWSLETTER_CONSENT_VERSION);
    expect(MEASUREMENT_CONSENT_VERSIONS).toContain(NEWSLETTER_CONSENT_VERSION);
    // Limit ładunku `ConsentEntry.version` (zod max 32).
    expect(NEWSLETTER_CONSENT_VERSION.length).toBeLessThanOrEqual(32);
  });

  it("dawne domyślne z aktualizacji SQL są na liście dawnych treści TS", () => {
    for (const name of ["c_old_pl", "c_old_en"]) {
      const match = new RegExp(`${name} constant text := '((?:[^']|'')*)'`).exec(sql);
      expect(match, name).not.toBeNull();
      expect(LEGACY_NEWSLETTER_CONSENT_DEFAULTS).toContain(match![1].replace(/''/g, "'"));
    }
  });
});

describe("treść zgody - parytet PL/EN i treść decyzji właściciela", () => {
  it("PL i EN mają te same odcinki (tekst, link, tekst, link, tekst)", () => {
    const shape = (lang: "pl" | "en") =>
      newsletterConsentSegments(lang).map((part) => (typeof part === "string" ? "t" : "a"));
    expect(shape("pl")).toEqual(shape("en"));
    expect(shape("pl")).toEqual(["t", "a", "t", "a", "t"]);
  });

  it("linki wskazują istniejące trasy (EN z prefiksem /en, bez /privacy-policy)", () => {
    for (const lang of ["pl", "en"] as const) {
      const html = newsletterConsentHtml(lang);
      const prefix = lang === "en" ? "/en" : "";
      expect(html).toContain(`href="${prefix}/polityka-prywatnosci"`);
      expect(html).toContain(`href="${prefix}/komunikacja-i-marketing#rezygnacja"`);
      expect(html).not.toContain("/privacy-policy");
    }
  });

  it("treść mówi o pomiarze, celu, osobnym wyłączeniu i wycofaniu", () => {
    const pl = newsletterConsentPlain("pl");
    expect(pl).toMatch(/mierzące otwarcia i kliknięcia/);
    expect(pl).toMatch(/dopasowujemy treść i częstotliwość/);
    expect(pl).toMatch(/statystykę/);
    expect(pl).toMatch(/wyłączyć osobno, bez rezygnacji z newslettera/);
    expect(pl).toMatch(/wycofać w każdej chwili/);
    const en = newsletterConsentPlain("en");
    expect(en).toMatch(/measure opens and clicks/);
    expect(en).toMatch(/content and sending frequency/);
    expect(en).toMatch(/statistics/);
    expect(en).toMatch(/separately, without unsubscribing/);
    expect(en).toMatch(/withdraw your consent at any time/);
  });

  it("tekst bez znaczników nie ma HTML", () => {
    expect(newsletterConsentPlain("pl")).not.toMatch(/[<>]/);
    expect(newsletterConsentPlain("en")).not.toMatch(/[<>]/);
  });
});

describe("resolveNewsletterConsent - tekst admina nie jest nadpisywany", () => {
  it("puste, dawne i bieżące domyślne = bieżąca treść z wersją z pomiarem", () => {
    for (const raw of [null, undefined, "", "   ", ...LEGACY_NEWSLETTER_CONSENT_DEFAULTS]) {
      const resolved = resolveNewsletterConsent(raw, "pl");
      expect(resolved).toEqual({
        isDefault: true,
        text: newsletterConsentHtml("pl"),
        version: NEWSLETTER_CONSENT_VERSION,
      });
    }
    // Treść domyślna EN w formularzu PL też jest „domyślną" (język formularza wygrywa).
    expect(resolveNewsletterConsent(newsletterConsentHtml("en"), "pl").text).toBe(
      newsletterConsentHtml("pl"),
    );
    expect(isNewsletterConsentDefault(`  ${LEGACY_NEWSLETTER_CONSENT_DEFAULTS[0]}\n`)).toBe(true);
  });

  it("tekst własny zostaje (obcięty) i nie dostaje wersji", () => {
    const resolved = resolveNewsletterConsent("  Moja <b>zgoda</b> na newsletter.  ", "en");
    expect(resolved).toEqual({ isDefault: false, text: "Moja <b>zgoda</b> na newsletter." });
    expect(newsletterConsentPayload(resolved, "en")).toEqual({
      key: "newsletter",
      text: "Moja <b>zgoda</b> na newsletter.",
      given: true,
      lang: "en",
    });
  });

  it("ładunek treści domyślnej niesie wersję", () => {
    expect(newsletterConsentPayload(resolveNewsletterConsent("", "en"), "en")).toEqual({
      key: "newsletter",
      text: newsletterConsentHtml("en"),
      given: true,
      lang: "en",
      version: NEWSLETTER_CONSENT_VERSION,
    });
  });
});

describe("normalizeConsentVersion - wersja z pomiarem tylko z treścią rejestru", () => {
  it("treść rejestru (HTML albo tekst, PL albo EN) zachowuje wersję", () => {
    for (const text of [
      newsletterConsentHtml("pl"),
      newsletterConsentHtml("en"),
      newsletterConsentPlain("pl"),
      ` ${newsletterConsentPlain("en")} `,
    ]) {
      expect(
        normalizeConsentVersion({ key: "newsletter", text, version: NEWSLETTER_CONSENT_VERSION }),
      ).toBe(NEWSLETTER_CONSENT_VERSION);
    }
  });

  it("obca treść z wersją z pomiarem traci wersję (serwer zapisze skrót)", () => {
    expect(
      normalizeConsentVersion({
        key: "newsletter",
        text: "Chcę newsletter.",
        version: NEWSLETTER_CONSENT_VERSION,
      }),
    ).toBeUndefined();
  });

  it("inne wersje (skrót popupu, premium) przechodzą bez zmian", () => {
    expect(
      normalizeConsentVersion({ key: "newsletter", text: "x", version: "sha256:abc" }),
    ).toBe("sha256:abc");
    expect(normalizeConsentVersion({ key: "privacy", text: "x", version: " " })).toBeUndefined();
    expect(normalizeConsentVersion({ key: "privacy", text: "x" })).toBeUndefined();
  });
});

describe("privacyAcceptanceHtml - akceptacja polityki bez zgody marketingowej", () => {
  it("nie wspomina newslettera i wskazuje politykę w języku", () => {
    expect(privacyAcceptanceHtml("pl")).toBe(
      'Akceptuję <a href="/polityka-prywatnosci">Politykę prywatności</a>.',
    );
    expect(privacyAcceptanceHtml("en")).toBe(
      'I accept the <a href="/en/polityka-prywatnosci">Privacy Policy</a>.',
    );
    expect(privacyAcceptanceHtml("pl")).not.toMatch(/newsletter/i);
  });
});
