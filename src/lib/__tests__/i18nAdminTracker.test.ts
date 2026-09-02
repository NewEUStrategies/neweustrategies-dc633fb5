// Bramka słownikowa nakładki `i18n-admin-tracker.ts` (panel trackera UE).
//
// PO CO POWSTAŁA. Nakładka nie jest objęta rdzeniową bramką parytetu
// (`i18n-key-parity.test.ts` czyta wyłącznie `locale/pl.ts` i `locale/en.ts`),
// więc do dziś jej klucze nie miały czego z czym porównać. Panel dossier
// niósł SZEŚĆ etykiet pól wpisanych na sztywno - „Tytuł PL", „Title EN",
// „Opis PL", „Summary EN", „Notatka PL", „Note EN" - i placeholder „Note EN"
// przy nocie stanowiska. Etykieta opisuje POLE, a nie język interfejsu: przy
// angielskiej wersji panelu połowa formularza mówiła po polsku, a druga połowa
// po angielsku niezależnie od wybranego języka.
//
// KONSEKWENCJA BRAKU TEJ BRAMKI: klucz dodany tylko po jednej stronie wychodzi
// w interfejsie jako goła ścieżka klucza („adminTracker.noteEn") i widać to
// dopiero na produkcji, w drugim języku.
import { describe, expect, it } from "vitest";
import { adminTrackerPl, adminTrackerEn } from "@/lib/i18n-admin-tracker";

function keyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...keyPaths(v as Record<string, unknown>, p));
    } else {
      out.push(p);
    }
  }
  return out;
}

const PL = adminTrackerPl as unknown as Record<string, unknown>;
const EN = adminTrackerEn as unknown as Record<string, unknown>;

// Ta sama reguła co w pozostałych bundlach: polski ma więcej kategorii mnogości
// (one/few/many/other) niż angielski (one/other), więc porównujemy klucz bazowy.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const baseKeys = (paths: string[]): Set<string> =>
  new Set(paths.map((k) => k.replace(PLURAL_SUFFIX, "")));

/** Wartość liścia po ścieżce - `undefined`, gdy ścieżki nie ma. */
function leaf(tree: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, seg) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[seg] : undefined,
      tree,
    );
}

describe("i18n admin tracker bundle (pl/en)", () => {
  it("PL i EN mają identyczny zbiór kluczy", () => {
    const onlyPl = [...baseKeys(keyPaths(PL))].filter((k) => !baseKeys(keyPaths(EN)).has(k)).sort();
    const onlyEn = [...baseKeys(keyPaths(EN))].filter((k) => !baseKeys(keyPaths(PL)).has(k)).sort();
    expect({ onlyPl, onlyEn }).toEqual({ onlyPl: [], onlyEn: [] });
  });

  it("nie ma pustych liści - pusty napis to niewidoczna etykieta pola", () => {
    for (const [label, tree] of [
      ["pl", PL],
      ["en", EN],
    ] as const) {
      const empties = keyPaths(tree).filter((path) => {
        const value = leaf(tree, path);
        return typeof value === "string" && value.trim() === "";
      });
      expect({ [label]: empties }).toEqual({ [label]: [] });
    }
  });

  it("polski wariant ma pełny zestaw form mnogich dla licznika powiadomień", () => {
    // Komunikat ticka niesie liczbę wysłanych powiadomień. Polski wymaga
    // `_few`/`_many`, inaczej operator czyta „Wysłano 5 powiadomienie".
    for (const suffix of ["one", "few", "many", "other"]) {
      expect(leaf(PL, `adminTracker.tickComplete_${suffix}`), suffix).toBeTruthy();
    }
    expect(leaf(EN, "adminTracker.tickComplete_one")).toBeTruthy();
    expect(leaf(EN, "adminTracker.tickComplete_other")).toBeTruthy();
  });

  it("zachowuje wstawkę {{count}} w OBU językach", () => {
    // Utrata wstawki daje komunikat bez liczby - czyli diagnostykę, z której
    // nie wynika, czy tick w ogóle coś wysłał.
    for (const [label, tree, suffix] of [
      ["pl", PL, "many"],
      ["en", EN, "other"],
    ] as const) {
      expect(String(leaf(tree, `adminTracker.tickComplete_${suffix}`)), label).toContain(
        "{{count}}",
      );
    }
  });

  it("ma OBIE strony każdej pary etykiet dwujęzycznych", () => {
    // To jest sedno naprawy: te siedem kluczy zastąpiło napisy wpisane
    // w trasie. Brak choćby jednego zwraca do stanu, w którym pole formularza
    // mówi w języku, którego użytkownik nie wybrał.
    const pairs = [
      "titlePl",
      "titleEn",
      "summaryPl",
      "summaryEn",
      "updateNotePl",
      "updateNoteEn",
      "notePl",
      "noteEn",
    ];
    for (const [label, tree] of [
      ["pl", PL],
      ["en", EN],
    ] as const) {
      for (const key of pairs) {
        expect(leaf(tree, `adminTracker.${key}`), `${label}.${key}`).toBeTruthy();
      }
    }
  });

  it("nie wprowadza pauzy - dywiz jest jedyną dozwoloną kreską", () => {
    // Nakładki mają nad sobą bramkę `i18nOverlayDashGate`; ta asercja stoi
    // tutaj, żeby porażka wskazywała KONKRETNY klucz tego słownika.
    for (const [label, tree] of [
      ["pl", PL],
      ["en", EN],
    ] as const) {
      const withDash = keyPaths(tree).filter((path) => {
        const value = leaf(tree, path);
        return typeof value === "string" && value.includes("—");
      });
      expect({ [label]: withDash }).toEqual({ [label]: [] });
    }
  });
});
