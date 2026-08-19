// Etykiety rodzajów wydarzeń.
//
// Moduł jest maleńki, ale ma jedną własność, która przy zmianie schematu bazy
// decyduje o tym, czy użytkownik zobaczy sensowną etykietę, czy nic: nieznany
// rodzaj wraca BEZ ZMIAN, zamiast zniknąć albo dać pusty odznaczenie.
import { describe, expect, it } from "vitest";
import { eventKindLabel } from "@/lib/events/kinds";

describe("eventKindLabel", () => {
  it.each([
    ["webinar", "Webinar", "Webinar"],
    ["briefing", "Briefing", "Briefing"],
    ["roundtable", "Okrągły stół", "Roundtable"],
    ["ama", "AMA", "AMA"],
    ["in_person", "Stacjonarne", "In person"],
    ["hybrid", "Hybrydowe", "Hybrid"],
  ])("%s ma brzmienie w obu językach", (kind, pl, en) => {
    expect(eventKindLabel(kind, "pl")).toBe(pl);
    expect(eventKindLabel(kind, "en")).toBe(en);
  });

  it("NIEZNANY rodzaj wraca bez zmian, zamiast zniknąć z karty", () => {
    // Migracja dokładająca nowy `events.kind` wyprzedza wdrożenie tłumaczeń.
    // Surowa wartość jest brzydka, ale niesie informację - pusta odznaka nie.
    expect(eventKindLabel("summit", "pl")).toBe("summit");
    expect(eventKindLabel("summit", "en")).toBe("summit");
  });

  it("pusty rodzaj nie wywraca etykiety", () => {
    expect(eventKindLabel("", "pl")).toBe("");
  });

  it("rodzaj kolidujący z prototypem obiektu NIE zwraca funkcji", () => {
    // `KIND_LABELS` to zwykły obiekt, więc `kind = "constructor"` trafiłby
    // w prototyp i `entry[lang]` dałoby `undefined` zamiast napisu.
    expect(eventKindLabel("constructor", "pl")).toBe("constructor");
    expect(eventKindLabel("toString", "en")).toBe("toString");
  });
});
