// Czyste reguły plakietki stanu zgłoszenia (`participantSurface.ts`).
//
// CO TEN PLIK DOWODZI:
//  1. Każdy status z CHECK `event_registrations.status` ma ton, `approved`
//     i `attended` są AKTYWNE (D0-5), a status nieznany (także nazwy
//     z prototypu obiektu) nie ma tonu.
//  2. Mapa etykiet ma PEŁNE literały kluczy (bramka `eventsI18nKeys` widzi
//     każdy liść; prawdziwe zdania sprawdza `participantEnumMapsI18n.test.tsx`).
//  3. PARYTET Z BAZĄ (R-SQL): klucze mapy tonów to DOKŁADNIE wartości
//     nazwanego CHECK-u `event_registrations_status_values` w stanie po całym
//     łańcuchu migracji (ostatnia definicja wygrywa). Nowy status w bazie bez
//     tonu znaczyłby plakietkę, która po cichu znika.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  REGISTRATION_STATUS_TONE,
  REGISTRATION_STATUS_TONE_LABEL_KEYS,
  registrationStatusTone,
} from "@/lib/events/participantSurface";

describe("registrationStatusTone", () => {
  it.each([
    ["approved", "active"],
    ["attended", "active"],
    ["pending", "pending"],
    ["draft", "pending"],
    ["waitlist", "waitlist"],
    ["cancelled", "closed"],
    ["rejected", "closed"],
    ["no_show", "closed"],
  ] as const)("%s -> %s", (status, tone) => {
    expect(registrationStatusTone(status)).toBe(tone);
  });

  it("mapa obejmuje dokładnie osiem statusów tabeli", () => {
    expect(Object.keys(REGISTRATION_STATUS_TONE)).toHaveLength(8);
  });

  it("status nieznany, dawne `confirmed`/`paid` i nazwy z prototypu nie mają tonu", () => {
    for (const status of [
      "confirmed",
      "registered",
      "paid",
      "unknown",
      "constructor",
      "toString",
      "",
    ]) {
      expect(registrationStatusTone(status)).toBeNull();
    }
  });

  it("każdy ton ma pełny literał klucza pod `eventParticipant.status`", () => {
    expect(REGISTRATION_STATUS_TONE_LABEL_KEYS).toEqual({
      active: "eventParticipant.status.active",
      pending: "eventParticipant.status.pending",
      waitlist: "eventParticipant.status.waitlist",
      closed: "eventParticipant.status.closed",
    });
  });
});

/** Wartości ostatniej definicji nazwanego CHECK-u `event_registrations_status_values`. */
function registrationStatusCheckValues(): string[] {
  const dir = join(process.cwd(), "supabase", "migrations");
  const re =
    /CONSTRAINT\s+event_registrations_status_values\s+CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/gi;
  let last: string[] = [];
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    for (const match of readFileSync(join(dir, file), "utf8").matchAll(re)) {
      last = match[1]
        .split(",")
        .map((value) => value.trim().replace(/^'|'$/g, ""))
        .filter((value) => value.length > 0);
    }
  }
  return last;
}

describe("parytet mapy tonów z CHECK-iem bazy", () => {
  it("klucze `REGISTRATION_STATUS_TONE` = wartości `event_registrations_status_values`", () => {
    const db = registrationStatusCheckValues();
    // Skan musi coś znaleźć - pusta lista dałaby zieloną, pustą równość.
    expect(db.length).toBeGreaterThan(0);
    expect(Object.keys(REGISTRATION_STATUS_TONE).sort()).toEqual([...db].sort());
  });
});
