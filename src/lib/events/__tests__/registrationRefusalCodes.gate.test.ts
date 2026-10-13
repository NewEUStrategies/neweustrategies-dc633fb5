// BRAMKA: każdy kod odmowy publicznego zapisu i dopisania gości ma zdanie
// w PL i EN (przegląd R38, uwaga do REG-04).
//
// DLACZEGO TO BRAMKA, A NIE ZWYKŁY TEST. Przeglądarka nie widzi już komunikatów
// plpgsql - `event_register_for_client` (wołana kluczem serwisowym z
// `eventRegistration.server.ts`) przepuszcza do niej WYŁĄCZNIE kody z własnej
// listy `c_codes`, a resztę zamienia na `unknown`. `eventErrorMapsI18n.gate`
// skanuje tylko RPC wołane z modułów `*Api`, więc tej listy nie widział: nowy
// kod dopisany do `c_codes` bez zdania w słowniku trafiałby do uczestnika jako
// ogólne „Nie udało się zapisać" - po cichu. To samo dla funkcji gości
// (`_event_register_group_guests` i wejście `event_register_group_guests_for_client`):
// ich kody tłumaczy `eventRegistration.group.errors`.
//
// ŹRÓDŁEM PRAWDY JEST NAJNOWSZA MIGRACJA, która definiuje funkcję - tak samo
// jak liczy to `extractLatestDefinitions` (ostatni CREATE wygrywa). Klucz
// czytamy z bundla SWOJEGO języka (`readKey`), nie przez `i18n.exists`:
// `fallbackLng: "pl"` przepuszczałby brak angielskiego zdania.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { readKey, type ResourceTree } from "@/lib/ci/i18nParity";
import { eventRegistrationEn, eventRegistrationPl } from "@/lib/i18n-event-registration";
import { groupGuestsFailure, registrationFailure } from "@/lib/events/publicRegistrationErrors";

const MIGRATIONS_DIR = "supabase/migrations";
const DICTIONARIES: Record<"pl" | "en", ResourceTree> = {
  pl: eventRegistrationPl,
  en: eventRegistrationEn,
};

function camel(code: string): string {
  return code.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}

/** Ciało funkcji z NAJNOWSZEJ migracji, która ją definiuje (bez komentarzy SQL). */
function latestBody(name: string): { file: string; body: string } {
  const marker = `FUNCTION public.${name}(`;
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .filter((file) => readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8").includes(marker));
  const file = files.at(-1);
  if (file === undefined) throw new Error(`brak migracji z ${marker}`);
  const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8");
  const start = sql.lastIndexOf(`CREATE OR REPLACE ${marker}`);
  const end = sql.indexOf("\n$$;", start);
  if (start === -1 || end === -1) throw new Error(`nie znaleziono ciała ${name} w ${file}`);
  const body = sql
    .slice(start, end)
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  return { file, body };
}

/** Kody z deklaracji `c_codes CONSTANT text[] := ARRAY[...]`. */
function constantCodes(body: string): string[] {
  const match = /c_codes\s+CONSTANT\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/.exec(body);
  if (match === null) throw new Error("brak listy c_codes");
  return [...(match[1] ?? "").matchAll(/'([a-z][a-z0-9_]*)'/g)].map((code) => code[1] ?? "");
}

/** Kody oddawane wprost wartością `'error', 'kod'` (brak konta, kubełki). */
function returnedCodes(body: string): string[] {
  return [...body.matchAll(/'error', '([a-z][a-z0-9_]*)'/g)].map((code) => code[1] ?? "");
}

function ownText(lang: "pl" | "en", key: string): string | null {
  const value = readKey(DICTIONARIES[lang], key);
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

describe("bramka: kody odmów event_register_for_client mają zdania PL/EN", () => {
  const { file, body } = latestBody("event_register_for_client");
  const codes = constantCodes(body);

  it(`lista c_codes istnieje i zawiera kod awaryjny (${file})`, () => {
    expect(codes.length).toBeGreaterThan(20);
    expect(codes).toContain("unknown");
    expect(new Set(codes).size).toBe(codes.length);
  });

  for (const code of codes) {
    it(`„${code}” -> eventRegistration.errors.${camel(code)} (PL i EN)`, () => {
      const key = `eventRegistration.errors.${camel(code)}`;
      expect(ownText("pl", key), `pl:${key}`).not.toBeNull();
      expect(ownText("en", key), `en:${key}`).not.toBeNull();
      // Mapa przeglądarki trafia w TEN klucz, a nie w `unknown`.
      expect(registrationFailure(new Error(code)).key).toBe(key);
    });
  }

  it("kody z ogonem (`detail`) są podzbiorem c_codes", () => {
    const match = /c_detail_codes\s+CONSTANT\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/.exec(body);
    expect(match).not.toBeNull();
    const detail = [...(match?.[1] ?? "").matchAll(/'([a-z][a-z0-9_]*)'/g)].map(
      (code) => code[1] ?? "",
    );
    expect(detail.length).toBeGreaterThan(0);
    for (const code of detail) expect(codes, code).toContain(code);
  });
});

describe("bramka: kody odmów dopisania gości mają zdania PL/EN", () => {
  const core = latestBody("_event_register_group_guests");
  const entry = latestBody("event_register_group_guests_for_client");
  const codes = [
    ...new Set([
      ...constantCodes(core.body),
      ...returnedCodes(core.body),
      ...returnedCodes(entry.body),
    ]),
  ];

  it(`rdzeń (${core.file}) i wejście (${entry.file}) oddają znane kody`, () => {
    expect(codes).toContain("duplicate_guest");
    expect(codes).toContain("rate_limited");
    // Gość z zapisem jest pomijany - ten kod nie może wrócić (R38).
    expect(codes).not.toContain("already_registered");
  });

  for (const code of codes) {
    it(`„${code}” -> eventRegistration.group.errors.* (PL i EN)`, () => {
      const failure = groupGuestsFailure(new Error(code));
      expect(failure.key.startsWith("eventRegistration.group.errors."), failure.key).toBe(true);
      expect(ownText("pl", failure.key), `pl:${failure.key}`).not.toBeNull();
      expect(ownText("en", failure.key), `en:${failure.key}`).not.toBeNull();
    });
  }
});
