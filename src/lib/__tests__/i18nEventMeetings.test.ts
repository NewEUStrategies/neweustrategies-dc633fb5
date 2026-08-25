// Parytet PL/EN slownika gieldy spotkan 1-1 plus pokrycie kontraktu bazy.
//
// Klucze bledow i stanow spotkania sa indeksowane DYNAMICZNIE (`eventMeetings.
// errors.<klucz>`, `eventMeetings.status.<stan>`), wiec brak tlumaczenia nie
// wywala builda - uczestnik zobaczylby `participant_busy` w miejscu, w ktorym
// ma zrozumiec, dlaczego zaproszenie nie doszlo. Dlatego pilnujemy pokrycia
// KAZDEJ wartosci unii w obu jezykach.
import { describe, expect, it } from "vitest";
import { eventMeetingsEn, eventMeetingsPl } from "@/lib/i18n-event-meetings";
import { MEETING_ERROR_KEYS } from "@/lib/events/meetingsErrors";
import { MEETING_STATUSES } from "@/lib/events/meetingsApi";

function keyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...keyPaths(value as Record<string, unknown>, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function read(bundle: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined,
      bundle,
    );
}

describe("i18n eventMeetings (PL/EN)", () => {
  it("oba jezyki maja ten sam zbior kluczy", () => {
    const pl = keyPaths(eventMeetingsPl).sort();
    const en = keyPaths(eventMeetingsEn).sort();
    expect({
      onlyPl: pl.filter((k) => !en.includes(k)),
      onlyEn: en.filter((k) => !pl.includes(k)),
    }).toEqual({ onlyPl: [], onlyEn: [] });
  });

  it("zaden ciag nie jest pusty", () => {
    for (const bundle of [eventMeetingsPl, eventMeetingsEn]) {
      const empties = keyPaths(bundle).filter((path) => {
        const value = read(bundle, path);
        return typeof value !== "string" || value.trim().length === 0;
      });
      expect(empties).toEqual([]);
    }
  });

  it("kazdy klucz bledu z kontraktu bazy ma zdanie w obu jezykach", () => {
    for (const key of MEETING_ERROR_KEYS) {
      expect(read(eventMeetingsPl, `eventMeetings.errors.${key}`)).toBeTypeOf("string");
      expect(read(eventMeetingsEn, `eventMeetings.errors.${key}`)).toBeTypeOf("string");
    }
  });

  it("kazdy stan spotkania ma etykiete w obu jezykach", () => {
    for (const status of [...MEETING_STATUSES, "pending", "expired", "all"]) {
      expect(read(eventMeetingsPl, `eventMeetings.status.${status}`)).toBeTypeOf("string");
      expect(read(eventMeetingsEn, `eventMeetings.status.${status}`)).toBeTypeOf("string");
    }
  });
});
