// Dwa panele programów, dwa słowniki - JEDNO drzewo i18next.
//
// DEFEKT NAPRAWIONY 2026-10. `/admin/programs` (`i18n-admin-programs.ts`)
// i `/admin/research-programs` (`i18n-programs.ts`) rejestrowały klucze pod
// TĄ SAMĄ przestrzenią `adminPrograms`, a `addResourceBundle(lng, ns, res,
// deep=true, overwrite=true)` scala nakładki w jedno drzewo: liść nadpisuje
// gałąź, gałąź - liść, a liść - liść. Po wejściu w oba panele w jednej sesji
// (leniwe chunki rejestrują słowniki po kolei):
//   * `adminPrograms.members` było napisem „Członkowie", więc zakładka zespołu
//     landingu pokazywała gołe klucze `adminPrograms.members.selectUser`;
//   * albo - w odwrotnej kolejności wejść - obiektem, i przycisk „Członkowie"
//     w drugim panelu mówił „returned an object instead of string";
//   * `title`, `subtitle`, `newProgram`, `empty` pokazywały tekst CUDZEGO
//     panelu („Brak programów. Utwórz pierwszy." zamiast „Dodaj pierwszy.").
// Testy tras tego nie widziały: oba atrapują `react-i18next` echem klucza.
//
// KONTRAKT. Po zarejestrowaniu OBU nakładek każdy klucz panelu landingów
// rozwiązuje się na SWÓJ tekst w obu językach, a klucze panelu programów huba
// - na swoje. Nakładka `/admin/programs` rejestruje się tu jako DRUGA, czyli
// wygrywa każdy konflikt - więc jakakolwiek wspólna ścieżka oblewa pierwszy
// test, niezależnie od tego, w którym słowniku ktoś ją kiedyś dopisze.
import { describe, expect, it } from "vitest";
import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { ensureI18n as ensureProgramsI18n, programsEn, programsPl } from "@/lib/i18n-programs";
import { ensureI18n as ensureAdminProgramsI18n } from "@/lib/i18n-admin-programs";

ensureProgramsI18n();
ensureAdminProgramsI18n();

/**
 * Gałąź słownika po nazwie - STRAŻNIK, nie rzutowanie. Wersja EN dostaje blok
 * panelu przez `Object.assign` w runtime, więc jej typ statyczny go nie zna;
 * brak gałęzi ma być twardym błędem testu, a nie pustą pętlą.
 */
function branch(root: object, key: string): object {
  const value: unknown = Object.entries(root).find(([name]) => name === key)?.[1];
  if (!value || typeof value !== "object") throw new Error(`test: słownik nie ma gałęzi ${key}`);
  return value;
}

/** Pary (ścieżka klucza, tekst) wszystkich liści drzewa słownika. */
function leaves(tree: object, prefix: string): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]): Array<[string, string]> => {
    const path = `${prefix}.${key}`;
    if (typeof value === "string") return [[path, value]];
    return value && typeof value === "object" ? leaves(value, path) : [];
  });
}

describe("słowniki paneli programów nie nadpisują się nawzajem", () => {
  it.each([
    ["pl", branch(programsPl, "adminResearchPrograms")],
    ["en", branch(programsEn, "adminResearchPrograms")],
  ] as const)("[%s] każdy klucz panelu landingów rozwiązuje się na SWÓJ tekst", (lng, tree) => {
    const pairs = leaves(tree, "adminResearchPrograms");
    // Kanarek: drzewo ma realne gałęzie (`members`, `projects`, ...), a nie
    // pustkę, na której pętla niżej przeszłaby bez jednej asercji.
    expect(pairs.length).toBeGreaterThan(40);
    const drifted = pairs.filter(([key, text]) => i18n.t(key, { lng }) !== text);
    expect(drifted).toEqual([]);
  });

  it.each([
    ["pl", { title: "Programy", members: "Członkowie", empty: "Brak programów. Dodaj pierwszy." }],
    ["en", { title: "Programs", members: "Members", empty: "No programs yet. Add the first one." }],
  ] as const)("[%s] panel /admin/programs widzi WŁASNE napisy", (lng, expected) => {
    expect({
      title: i18n.t("adminPrograms.title", { lng }),
      members: i18n.t("adminPrograms.members", { lng }),
      empty: i18n.t("adminPrograms.empty", { lng }),
    }).toEqual(expected);
  });
});
