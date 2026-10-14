// BRAMKA: tekst zgody w bazie = napis, który formularz zapisu pokazał.
//
// PO CO TEN PLIK ISTNIEJE. Wpis księgi zgód (`event_consent_records`) wskazuje
// wersję i język tekstu z `event_consent_texts`, a do CRM trafia treść tej
// wersji jako dowód zgody (art. 7 ust. 1 RODO). Formularz renderuje jednak
// napis z i18n (`eventRegistration.consents.*`), nie z bazy. Nic poza tym
// plikiem nie spina tych dwóch miejsc: poprawka literówki w i18n przechodzi
// tsc, lint i parytet PL/EN, a od tej chwili księga twierdziłaby, że osoba
// zgodziła się na tekst, którego nie widziała.
//
// CO WYMUSZA:
//   * ziarno BIEŻĄCEJ wersji (`EVENT_CONSENT_TEXT_VERSION`) w migracjach jest
//     znak w znak równe napisom i18n PL i EN - zmiana napisu wymaga nowej
//     wersji (migracja + podbicie stałej);
//   * stała wskazuje najwyższą zasianą wersję (nie da się jej podbić bez
//     wierszy w bazie ani zasiać wersji i zapomnieć o stałej);
//   * opublikowana wersja nigdy nie dostaje drugiej treści w późniejszej
//     migracji (baza i tak odrzuci UPDATE, ale ON CONFLICT DO NOTHING
//     przemilczałby rozjazd);
//   * formularz renderuje dokładnie te klucze, które wersjonujemy;
//   * listy celów, statusów, kanałów i języków w TS = CHECK-i księgi.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  EVENT_CONSENT_EVIDENCES,
  EVENT_CONSENT_LANGS,
  EVENT_CONSENT_PURPOSES,
  EVENT_CONSENT_STATUSES,
  EVENT_CONSENT_TEXT_VERSION,
  eventConsentTextKey,
  type EventConsentLang,
  type EventConsentPurpose,
} from "@/lib/events/consentTexts";
import { eventRegistrationEn, eventRegistrationPl } from "@/lib/i18n-event-registration";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const FORM_FILE = join(
  process.cwd(),
  "src",
  "components",
  "events",
  "registration",
  "PublicRegistrationForm.tsx",
);

interface SeedRow {
  purpose: string;
  version: number;
  lang: string;
  body: string;
  file: string;
}

function stripSqlLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/** Wszystkie wiersze ziarna `event_consent_texts` z całego łańcucha migracji. */
function seededTexts(): SeedRow[] {
  const rows: SeedRow[] = [];
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const insertRe = /INSERT\s+INTO\s+public\.event_consent_texts\s*\([^)]*\)\s*VALUES([\s\S]*?);/gi;
  const tupleRe = /\(\s*'([a-z_]+)'\s*,\s*(\d+)\s*,\s*'([a-z]+)'\s*,\s*'((?:[^']|'')*)'/g;
  for (const file of files) {
    const sql = stripSqlLineComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    for (const insert of sql.matchAll(insertRe)) {
      for (const tuple of insert[1].matchAll(tupleRe)) {
        rows.push({
          purpose: tuple[1],
          version: Number(tuple[2]),
          lang: tuple[3],
          body: tuple[4].replace(/''/g, "'"),
          file,
        });
      }
    }
  }
  return rows;
}

const BUNDLES: Record<EventConsentLang, unknown> = {
  pl: eventRegistrationPl,
  en: eventRegistrationEn,
};

function i18nText(lang: EventConsentLang, key: string): string | undefined {
  let node: unknown = BUNDLES[lang];
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Wartości `CHECK (kolumna IN (...))` nazwanego ograniczenia (ostatnia definicja). */
function checkValues(constraint: string): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const re = new RegExp(
    `CONSTRAINT\\s+${constraint}\\s+CHECK\\s*\\(\\s*(?:[a-z_]+\\s+IS\\s+NULL\\s+OR\\s+)?[a-z_]+\\s+IN\\s*\\(([^)]*)\\)\\s*\\)`,
    "i",
  );
  let last: string[] = [];
  for (const file of files) {
    const sql = stripSqlLineComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    const match = re.exec(sql);
    if (match) last = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }
  return last;
}

const SEED = seededTexts();

describe("teksty zgód: ziarno w bazie = napisy formularza", () => {
  it("migracje zasiewają teksty (parser nie jest ślepy)", () => {
    expect(SEED.length).toBeGreaterThanOrEqual(6);
    expect(SEED.every((row) => row.file.endsWith(".sql"))).toBe(true);
  });

  it.each(
    EVENT_CONSENT_PURPOSES.flatMap((purpose) =>
      EVENT_CONSENT_LANGS.map((lang) => [purpose, lang] as [EventConsentPurpose, EventConsentLang]),
    ),
  )("%s/%s: tekst bieżącej wersji w bazie jest znak w znak napisem i18n", (purpose, lang) => {
    const rows = SEED.filter(
      (row) =>
        row.purpose === purpose && row.lang === lang && row.version === EVENT_CONSENT_TEXT_VERSION,
    );
    expect(rows, `ziarno ${purpose} v${EVENT_CONSENT_TEXT_VERSION} ${lang}`).toHaveLength(1);
    const shown = i18nText(lang, eventConsentTextKey(purpose));
    expect(shown, `napis i18n ${eventConsentTextKey(purpose)} (${lang})`).toBeTypeOf("string");
    // Rozjazd = zmieniono napis bez nowej wersji: dodaj migrację z wersją
    // EVENT_CONSENT_TEXT_VERSION + 1 (retired_at starej, INSERT nowej) i podbij stałą.
    expect(rows[0].body).toBe(shown);
  });

  it("EVENT_CONSENT_TEXT_VERSION to najwyższa zasiana wersja", () => {
    const highest = Math.max(...SEED.map((row) => row.version));
    expect(EVENT_CONSENT_TEXT_VERSION).toBe(highest);
  });

  it("opublikowana wersja ma jedną treść w całym łańcuchu migracji", () => {
    const bodies = new Map<string, Set<string>>();
    for (const row of SEED) {
      const key = `${row.purpose}/${row.version}/${row.lang}`;
      bodies.set(key, (bodies.get(key) ?? new Set()).add(row.body));
    }
    const conflicting = [...bodies].filter(([, set]) => set.size > 1).map(([key]) => key);
    expect(conflicting).toEqual([]);
  });

  it("formularz zapisu renderuje dokładnie wersjonowane klucze", () => {
    const form = readFileSync(FORM_FILE, "utf8");
    for (const purpose of EVENT_CONSENT_PURPOSES) {
      expect(form).toContain(`t("${eventConsentTextKey(purpose)}")`);
    }
    const rendered = new Set(
      [...form.matchAll(/t\("(eventRegistration\.consents\.[A-Za-z]+)"\)/g)].map((m) => m[1]),
    );
    expect([...rendered].sort()).toEqual(EVENT_CONSENT_PURPOSES.map(eventConsentTextKey).sort());
  });
});

describe("parytet z CHECK-ami księgi zgód", () => {
  it.each([
    ["event_consent_records_purpose_values", EVENT_CONSENT_PURPOSES],
    ["event_consent_texts_purpose_values", EVENT_CONSENT_PURPOSES],
    ["event_consent_records_status_values", EVENT_CONSENT_STATUSES],
    ["event_consent_records_evidence_values", EVENT_CONSENT_EVIDENCES],
    ["event_consent_texts_lang_values", EVENT_CONSENT_LANGS],
    ["event_consent_records_text_lang_values", EVENT_CONSENT_LANGS],
  ] as const)("%s = lista TS", (constraint, values) => {
    expect(checkValues(constraint).sort()).toEqual([...values].sort());
  });
});
