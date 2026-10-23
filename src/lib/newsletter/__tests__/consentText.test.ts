// Jedno źródło treści zgody na newsletter (I9d-Y2, I9d-Y2b): parytet TS ⇄ SQL,
// parytet PL/EN, dawne treści domyślne (także pakietowa (a)), normalizacja
// wersji i sanitizer ładunku zgód z deklaracją osobnego pola pomiaru.
//
// Parytet czyta NAJNOWSZĄ migrację z blokami `newsletter-consent-default:*`
// i `newsletter-consent-version` (od I9d-Y2b: 20261023090000) - nowa wersja
// treści w nowej migracji przesuwa porównanie sama, bez edycji testu.
// Treść (a) porównujemy z WYDANĄ migracją 20261020162300 (wydanych migracji
// się nie edytuje, więc to stały punkt odniesienia).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { segmentsHtml, segmentsPlain } from "../consentSegments";
import { CONSENT_ENTRIES_MAX } from "../consentLimits";
import {
  hasMeasurementDeclaration,
  isNewsletterConsentDefault,
  LEGACY_NEWSLETTER_CONSENT_DEFAULTS,
  NEWSLETTER_CONSENT_SEGMENTS_BY_VERSION,
  NEWSLETTER_CONSENT_VERSION,
  NEWSLETTER_CONSENT_VERSION_BUNDLED,
  newsletterConsentHtml,
  newsletterConsentPayload,
  newsletterConsentPlain,
  newsletterConsentSegments,
  normalizeConsentVersion,
  privacyAcceptanceHtml,
  resolveNewsletterConsent,
  sanitizeConsentEntries,
  signupNewsletterSubscription,
  upgradeLegacyConsentHtml,
} from "../consentText";
import {
  EMAIL_MEASUREMENT_CONSENT_VERSION,
  EMAIL_MEASUREMENT_DECLARED_KEY,
  MEASUREMENT_CONSENT_VERSIONS,
  measurementConsentHtml,
  measurementConsentPayload,
  measurementConsentPlain,
} from "../measurementConsentText";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
/** Wydana migracja treści pakietowej (a) - stały punkt odniesienia. */
const BUNDLED_MIGRATION = "20261020162300_consent_measurement_core.sql";

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

const bundled = NEWSLETTER_CONSENT_SEGMENTS_BY_VERSION[NEWSLETTER_CONSENT_VERSION_BUNDLED];
const bundledHtml = (lang: "pl" | "en") => segmentsHtml(bundled[lang]);
const bundledPlain = (lang: "pl" | "en") => segmentsPlain(bundled[lang]);

describe("treść zgody na newsletter - parytet TS ⇄ SQL", () => {
  const { file, sql } = latestMigrationWith("newsletter-consent-default:pl");

  it("HTML treści domyślnej PL i EN = literały `_newsletter_consent_default`", () => {
    expect(file).toMatch(/^\d{14}_/);
    expect(newsletterConsentHtml("pl")).toBe(literalAfter(sql, "newsletter-consent-default:pl"));
    expect(newsletterConsentHtml("en")).toBe(literalAfter(sql, "newsletter-consent-default:en"));
  });

  it("wersja = literał `_newsletter_consent_version`; nie jest wersją treści pomiaru", () => {
    const { sql: versionSql } = latestMigrationWith("newsletter-consent-version");
    const at = versionSql.indexOf("-- newsletter-consent-version");
    const match = /SELECT\s+'([^']+)'::text/.exec(versionSql.slice(at));
    expect(match?.[1]).toBe(NEWSLETTER_CONSENT_VERSION);
    // Wariant (b): rejestr wersji pomiaru to WYŁĄCZNIE treść osobnego pola.
    expect(MEASUREMENT_CONSENT_VERSIONS).not.toContain(NEWSLETTER_CONSENT_VERSION);
    expect(MEASUREMENT_CONSENT_VERSIONS).not.toContain(NEWSLETTER_CONSENT_VERSION_BUNDLED);
    expect(MEASUREMENT_CONSENT_VERSIONS).toEqual([EMAIL_MEASUREMENT_CONSENT_VERSION]);
    // Limit ładunku `ConsentEntry.version` (zod max 32).
    expect(NEWSLETTER_CONSENT_VERSION.length).toBeLessThanOrEqual(32);
  });

  it("dawne domyślne i treść (a) z aktualizacji SQL są na liście dawnych treści TS", () => {
    for (const name of ["c_old_pl", "c_old_en", "c_a_pl", "c_a_en"]) {
      const match = new RegExp(`${name} constant text := '((?:[^']|'')*)'`).exec(sql);
      expect(match, name).not.toBeNull();
      expect(LEGACY_NEWSLETTER_CONSENT_DEFAULTS).toContain(match![1].replace(/''/g, "'"));
    }
  });

  it("treść (a) = literały wydanej migracji 20261020162300", () => {
    const bundledSql = readFileSync(join(MIGRATIONS_DIR, BUNDLED_MIGRATION), "utf8");
    expect(bundledHtml("pl")).toBe(literalAfter(bundledSql, "newsletter-consent-default:pl"));
    expect(bundledHtml("en")).toBe(literalAfter(bundledSql, "newsletter-consent-default:en"));
    expect(bundledSql).toContain(`SELECT '${NEWSLETTER_CONSENT_VERSION_BUNDLED}'::text`);
  });
});

describe("treść zgody - parytet PL/EN i treść decyzji właściciela (wariant b)", () => {
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

  it("treść nie mówi o pomiarze ani nie dokłada akceptacji polityki; mówi o wycofaniu", () => {
    for (const lang of ["pl", "en"] as const) {
      const plain = newsletterConsentPlain(lang);
      expect(plain).not.toMatch(/mierz|pomiar|measur|akceptuj|accept/i);
    }
    expect(newsletterConsentPlain("pl")).toMatch(/zgodę na otrzymywanie newslettera/);
    expect(newsletterConsentPlain("pl")).toMatch(/wycofać w każdej chwili/);
    expect(newsletterConsentPlain("en")).toMatch(/agree to receive the newsletter/);
    expect(newsletterConsentPlain("en")).toMatch(/withdraw your consent at any time/);
  });

  it("tekst bez znaczników nie ma HTML", () => {
    expect(newsletterConsentPlain("pl")).not.toMatch(/[<>]/);
    expect(newsletterConsentPlain("en")).not.toMatch(/[<>]/);
  });

  it("rejestr wersji: (a) i bieżąca (b), bieżąca = odcinki formularza", () => {
    expect(Object.keys(NEWSLETTER_CONSENT_SEGMENTS_BY_VERSION).sort()).toEqual(
      [NEWSLETTER_CONSENT_VERSION_BUNDLED, NEWSLETTER_CONSENT_VERSION].sort(),
    );
    expect(NEWSLETTER_CONSENT_SEGMENTS_BY_VERSION[NEWSLETTER_CONSENT_VERSION].pl).toBe(
      newsletterConsentSegments("pl"),
    );
    expect(bundledPlain("pl")).toMatch(/mierzące otwarcia i kliknięcia/);
  });
});

describe("resolveNewsletterConsent - tekst admina nie jest nadpisywany", () => {
  it("puste, dawne (także (a)) i bieżące domyślne = bieżąca treść z wersją (b)", () => {
    for (const raw of [null, undefined, "", "   ", ...LEGACY_NEWSLETTER_CONSENT_DEFAULTS]) {
      const resolved = resolveNewsletterConsent(raw, "pl");
      expect(resolved).toEqual({
        isDefault: true,
        text: newsletterConsentHtml("pl"),
        version: NEWSLETTER_CONSENT_VERSION,
      });
    }
    expect(resolveNewsletterConsent(bundledHtml("en"), "en")).toEqual({
      isDefault: true,
      text: newsletterConsentHtml("en"),
      version: NEWSLETTER_CONSENT_VERSION,
    });
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

  it("ładunek treści domyślnej niesie wersję (b)", () => {
    expect(newsletterConsentPayload(resolveNewsletterConsent("", "en"), "en")).toEqual({
      key: "newsletter",
      text: newsletterConsentHtml("en"),
      given: true,
      lang: "en",
      version: NEWSLETTER_CONSENT_VERSION,
    });
  });
});

describe("normalizeConsentVersion - wersja z rejestru tylko z treścią tej wersji", () => {
  it("treść (b) (HTML albo tekst, PL albo EN) zachowuje wersję (b)", () => {
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

  it("wersja (a) zostaje przy treści (a), przy obcej i przy treści (b) znika", () => {
    const v = NEWSLETTER_CONSENT_VERSION_BUNDLED;
    expect(
      normalizeConsentVersion({ key: "newsletter", text: bundledHtml("pl"), version: v }),
    ).toBe(v);
    expect(
      normalizeConsentVersion({ key: "newsletter", text: bundledPlain("en"), version: v }),
    ).toBe(v);
    expect(
      normalizeConsentVersion({ key: "newsletter", text: newsletterConsentHtml("pl"), version: v }),
    ).toBeUndefined();
    expect(
      normalizeConsentVersion({ key: "newsletter", text: "Chcę newsletter.", version: v }),
    ).toBeUndefined();
  });

  it("obca treść z wersją (b) traci wersję (serwer zapisze skrót)", () => {
    expect(
      normalizeConsentVersion({
        key: "newsletter",
        text: "Chcę newsletter.",
        version: NEWSLETTER_CONSENT_VERSION,
      }),
    ).toBeUndefined();
  });

  it("wersja pomiaru zostaje wyłącznie przy kluczu deklaracji z treścią pola pomiaru", () => {
    const v = EMAIL_MEASUREMENT_CONSENT_VERSION;
    expect(
      normalizeConsentVersion({
        key: EMAIL_MEASUREMENT_DECLARED_KEY,
        text: measurementConsentHtml("en"),
        version: v,
      }),
    ).toBe(v);
    for (const key of ["newsletter", "email_measurement", "privacy"]) {
      expect(
        normalizeConsentVersion({ key, text: measurementConsentHtml("pl"), version: v }),
      ).toBeUndefined();
    }
    expect(
      normalizeConsentVersion({ key: EMAIL_MEASUREMENT_DECLARED_KEY, text: "x", version: v }),
    ).toBeUndefined();
  });

  it("inne wersje (skrót popupu, premium, nazwy z prototypu) przechodzą bez zmian", () => {
    expect(normalizeConsentVersion({ key: "newsletter", text: "x", version: "sha256:abc" })).toBe(
      "sha256:abc",
    );
    expect(normalizeConsentVersion({ key: "newsletter", text: "x", version: "2026-10-12" })).toBe(
      "2026-10-12",
    );
    expect(normalizeConsentVersion({ key: "x", text: "x", version: "constructor" })).toBe(
      "constructor",
    );
    expect(normalizeConsentVersion({ key: "privacy", text: "x", version: " " })).toBeUndefined();
    expect(normalizeConsentVersion({ key: "privacy", text: "x" })).toBeUndefined();
    expect(normalizeConsentVersion({ key: "privacy", text: "x", version: null })).toBeUndefined();
  });
});

type Entry = { key: string; text: string; version?: string; given?: boolean; lang?: string };

const newsletterEntry = (): Entry => ({
  key: "newsletter",
  text: newsletterConsentHtml("pl"),
  version: NEWSLETTER_CONSENT_VERSION,
  given: true,
  lang: "pl",
});

describe("sanitizeConsentEntries - deklaracja pola pomiaru i zakaz klucza zgody", () => {
  it("dokładna deklaracja przy zgodzie na newsletter przechodzi bez zmian", () => {
    const input: Entry[] = [newsletterEntry(), { ...measurementConsentPayload("pl") }];
    expect(sanitizeConsentEntries(input)).toEqual(input);
    expect(hasMeasurementDeclaration(sanitizeConsentEntries(input))).toBe(true);
  });

  it("klucz normalizowany (wariant ` Email_Measurement_Declared `), także przy `marketing*`", () => {
    const out = sanitizeConsentEntries<Entry>([
      { key: "marketing_email", text: "Chcę wiadomości.", given: true },
      { ...measurementConsentPayload("en"), key: " Email_Measurement_Declared " },
    ]);
    expect(out[1]).toEqual(measurementConsentPayload("en"));
  });

  it("treść bez znaczników -> HTML dopasowanego języka i `lang` tego języka (postać SQL)", () => {
    const out = sanitizeConsentEntries<Entry>([
      newsletterEntry(),
      {
        key: EMAIL_MEASUREMENT_DECLARED_KEY,
        text: `  ${measurementConsentPlain("pl")} `,
        version: EMAIL_MEASUREMENT_CONSENT_VERSION,
        given: true,
        lang: "en",
      },
    ]);
    expect(out[1]).toEqual(measurementConsentPayload("pl"));
    expect(out[1].text).toBe(measurementConsentHtml("pl"));
  });

  it("klucz `email_measurement` z formularza jest ZAWSZE usuwany (każda treść i wersja)", () => {
    for (const key of ["email_measurement", " EMAIL_MEASUREMENT ", "Email_Measurement"]) {
      const out = sanitizeConsentEntries<Entry>([
        newsletterEntry(),
        { ...measurementConsentPayload("pl"), key },
        // Stara paczka JS: treść i wersja (a) pod kluczem zgody (R1.14).
        { key, text: bundledHtml("pl"), version: NEWSLETTER_CONSENT_VERSION_BUNDLED, given: true },
      ]);
      expect(out).toEqual([newsletterEntry()]);
    }
  });

  it("deklaracja odrzucona: given nie-true, zła treść, zła wersja, treść/wersja (a)", () => {
    const base = measurementConsentPayload("pl");
    const rejected: Entry[] = [
      { ...base, given: false },
      { key: base.key, text: base.text, version: base.version, lang: "pl" },
      { ...base, text: "Zgadzam się na pomiar." },
      { ...base, text: newsletterConsentHtml("pl") },
      { ...base, version: "email-measurement-2026-01-01" },
      { key: base.key, text: base.text, given: true, lang: "pl" },
      { ...base, text: bundledHtml("pl"), version: NEWSLETTER_CONSENT_VERSION_BUNDLED },
      { ...base, version: NEWSLETTER_CONSENT_VERSION_BUNDLED },
    ];
    for (const entry of rejected) {
      expect(sanitizeConsentEntries([newsletterEntry(), entry])).toEqual([newsletterEntry()]);
    }
  });

  it("deklaracja bez zgody na newsletter (brak albo given:false) jest usuwana", () => {
    expect(sanitizeConsentEntries<Entry>([measurementConsentPayload("pl")])).toEqual([]);
    const optedOut: Entry = { ...newsletterEntry(), given: false };
    expect(sanitizeConsentEntries<Entry>([optedOut, measurementConsentPayload("pl")])).toEqual([
      optedOut,
    ]);
    expect(
      sanitizeConsentEntries<Entry>([
        { key: "privacy", text: "Akceptuję.", given: true },
        measurementConsentPayload("pl"),
      ]),
    ).toEqual([{ key: "privacy", text: "Akceptuję.", given: true }]);
  });

  it("przechodzi najwyżej jedna deklaracja (pierwsza poprawna)", () => {
    const out = sanitizeConsentEntries<Entry>([
      newsletterEntry(),
      measurementConsentPayload("en"),
      measurementConsentPayload("pl"),
    ]);
    expect(out).toEqual([newsletterEntry(), measurementConsentPayload("en")]);
  });

  it("pozostałe pozycje: wersja przez normalizeConsentVersion; wejście bez mutacji", () => {
    const input: Entry[] = [
      { key: "newsletter", text: "Obca treść.", version: NEWSLETTER_CONSENT_VERSION, given: true },
      { key: "terms", text: "Regulamin.", version: "sha256:abc", given: true },
      { ...measurementConsentPayload("pl"), key: " Email_Measurement_Declared " },
    ];
    const snapshot = JSON.stringify(input);
    const out = sanitizeConsentEntries(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out[0]).toEqual({ key: "newsletter", text: "Obca treść.", given: true });
    expect(out[0]).not.toHaveProperty("version");
    expect(out[1]).toEqual(input[1]);
    expect(out[2]).toEqual(measurementConsentPayload("pl"));
    expect(out[2]).not.toBe(input[2]);
  });

  it("hasMeasurementDeclaration czyta wyłącznie klucz deklaracji", () => {
    expect(hasMeasurementDeclaration([])).toBe(false);
    expect(hasMeasurementDeclaration([{ key: "email_measurement" }])).toBe(false);
    expect(hasMeasurementDeclaration([{ key: "newsletter" }])).toBe(false);
    expect(hasMeasurementDeclaration([{ key: " Email_Measurement_Declared" }])).toBe(true);
  });

  it("limit pozycji mieści pełny dokument z newsletterem i deklaracją", () => {
    expect(CONSENT_ENTRIES_MAX).toBe(12);
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

describe("upgradeLegacyConsentHtml - kopia treści w akapicie dokumentu buildera", () => {
  it("dawna, pakietowa (a) i bieżąca treść domyślna -> bieżąca (b) w języku formularza", () => {
    expect(upgradeLegacyConsentHtml(LEGACY_NEWSLETTER_CONSENT_DEFAULTS[1], "en")).toBe(
      newsletterConsentHtml("en"),
    );
    expect(upgradeLegacyConsentHtml(` ${bundledHtml("pl")} `, "pl")).toBe(
      newsletterConsentHtml("pl"),
    );
    expect(upgradeLegacyConsentHtml(bundledHtml("en"), "pl")).toBe(newsletterConsentHtml("pl"));
    expect(upgradeLegacyConsentHtml(newsletterConsentHtml("pl"), "en")).toBe(
      newsletterConsentHtml("en"),
    );
  });

  it("pusty akapit i tekst własny zostają bez zmian", () => {
    expect(upgradeLegacyConsentHtml("", "pl")).toBe("");
    expect(upgradeLegacyConsentHtml("  ", "pl")).toBe("  ");
    expect(upgradeLegacyConsentHtml("<b>Nasz tekst</b>", "pl")).toBe("<b>Nasz tekst</b>");
    // Etykieta pola wyboru w akapicie to nagłówek redakcji, nie kopia polityki.
    expect(upgradeLegacyConsentHtml("Subscribe to newsletter", "en")).toBe(
      "Subscribe to newsletter",
    );
  });
});

describe("signupNewsletterSubscription - zgoda na newsletter i osobna deklaracja pomiaru", () => {
  const input = {
    email: "  Ola@Example.COM ",
    firstName: " Ola ",
    lastName: "",
    lang: "en" as const,
    source: "club_gate",
    consent: resolveNewsletterConsent("", "en"),
  };

  it("bez pola pomiaru: wyłącznie zgoda na newsletter (b)", () => {
    expect(signupNewsletterSubscription(input)).toEqual({
      email: "ola@example.com",
      firstName: "Ola",
      lastName: undefined,
      name: "Ola",
      language: "en",
      source: "signup_club_gate",
      consents: [newsletterConsentPayload(input.consent, "en")],
    });
    expect(signupNewsletterSubscription({ ...input, measurement: false }).consents).toHaveLength(1);
  });

  it("z zaznaczonym polem: deklaracja dołożona i przechodzi przez sanitizer serwera", () => {
    const { consents } = signupNewsletterSubscription({ ...input, measurement: true });
    expect(consents).toEqual([
      newsletterConsentPayload(input.consent, "en"),
      measurementConsentPayload("en"),
    ]);
    expect(sanitizeConsentEntries(consents)).toEqual(consents);
  });
});
