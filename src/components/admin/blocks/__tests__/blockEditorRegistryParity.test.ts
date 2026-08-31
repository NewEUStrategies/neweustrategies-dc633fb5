// BRAMKA: kazdy zaimplementowany typ bloku ma OSIAGALNY edytor w panelu.
//
// PO CO TEN PLIK ISTNIEJE. `BlockEditRenderer` wybiera edytor `switch`-em po
// `block.type`, a lista zaimplementowanych typow zyje osobno, w
// `IMPLEMENTED_BLOCKS` (src/lib/blocks/registry.tsx). Te dwa miejsca nie sa
// niczym powiazane: dopisanie typu do rejestru NIE wymusza dopisania `case`,
// a `default` switcha renderuje szara atrape `[typ]` - czyli redaktor widzi
// blok, ktorego NIE MOZE edytowac, i nie dostaje o tym zadnego komunikatu.
// TypeScript tego nie zlapie, bo `switch` bez wyczerpania po prostu wpada
// w `default`.
//
// To ten sam mechanizm i ten sam wzorzec bramki, co
// `src/lib/events/__tests__/dbEnumParity.test.ts` (parytet stalych klienckich
// z ograniczeniami CHECK w bazie), przeniesiony na parytet
// rejestr <-> dyspozytor edytorow. Tam wzorzec wylapal trzy realne rozjazdy;
// tutaj wylapuje jeden.
//
// ZNALEZIONY ROZJAZD: `link-preview`. Typ jest w `IMPLEMENTED_BLOCKS`
// (registry.tsx:1577), w `schema.ts:130` i w `types.ts:130`, ma dzialajacy
// i PRZETESTOWANY renderer publiczny (`components/blocks/LinkPreviewBlockView.tsx`,
// pokryty w `components/blocks/__tests__/viewInteractions.test.tsx`), ma tez
// gotowy komponent edytora (`admin/blocks/edit/LinkPreviewBlock.tsx`, 146 linii)
// - ale `BlockEditRenderer` NIE MA dla niego `case`, wiec ten edytor nie jest
// importowany przez nikogo i jest nieosiagalny z panelu.
//
// DLACZEGO NIE USUWAM TEGO PLIKU EDYTORA, choc `knip` raportuje go jako nieuzywany:
// typ bloku JEST zywy - renderuje sie czytelnikowi. Usuniecie edytora
// utrwaliloby defekt (blok, ktorego nie da sie edytowac), zamiast go pokazac.
// To NIE jest martwy kod, to BRAKUJACE PODLACZENIE.
//
// Naprawa jest jednolinijkowa (dopisac `case "link-preview"` renderujacy
// istniejacy komponent), ale jest ZMIANA ZACHOWANIA PRODUKCYJNEGO, a tej
// galezi tego nie wolno - stad `it.fails` ponizej, zgodnie z regula repozytorium.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { IMPLEMENTED_BLOCKS } from "@/lib/blocks/registry";

const RENDERER_PATH = "src/components/admin/blocks/BlockEditRenderer.tsx";

/** Etykiety `case "..."` ze switcha dyspozytora - czytane ze ZRODLA, nie z typu. */
function editorCases(): Set<string> {
  const src = readFileSync(RENDERER_PATH, "utf8");
  const found = src.matchAll(/case "([a-z0-9-]+)":/g);
  return new Set(Array.from(found, (m) => m[1]));
}

describe("parytet rejestru blokow z dyspozytorem edytorow", () => {
  it("switch nie oferuje edytora dla typu, ktorego rejestr nie zna", () => {
    // Kierunek odwrotny niz defekt: `case` bez wpisu w rejestrze byloby
    // edytorem nieosiagalnym z drugiej strony (brak bloku do edycji).
    const implemented = new Set<string>(IMPLEMENTED_BLOCKS);
    const extra = [...editorCases()].filter((type) => !implemented.has(type)).sort();
    expect(extra).toEqual([]);
  });

  it("dyspozytor pokrywa niemal cala liste - rozjazd jest DOKLADNIE jeden", () => {
    // Dokumentacja STANU FAKTYCZNEGO, zeby regresja w druga strone (drugi
    // niepodlaczony typ) tez byla widoczna, a nie schowala sie za `it.fails`.
    const cases = editorCases();
    const missing = IMPLEMENTED_BLOCKS.filter((type) => !cases.has(type));
    expect(missing).toEqual(["link-preview"]);
  });

  it.fails(
    "POWINIEN miec osiagalny edytor KAZDY typ z IMPLEMENTED_BLOCKS (dzis brak dla link-preview)",
    () => {
      const cases = editorCases();
      const missing = IMPLEMENTED_BLOCKS.filter((type) => !cases.has(type));
      expect(missing).toEqual([]);
    },
  );

  it("atrapa `default` renderuje nazwe typu, wiec defekt jest widoczny w UI jako [typ]", () => {
    // Nie jest to pocieszenie, tylko opis skutku: redaktor dostaje szary
    // placeholder z nazwa typu zamiast pola edycji.
    const src = readFileSync(RENDERER_PATH, "utf8");
    expect(src).toContain("default:");
    expect(src).toMatch(/\[\{block\.type\}\]/);
  });
});
