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
// To ten sam wzorzec bramki, co `src/lib/events/__tests__/dbEnumParity.test.ts`
// (parytet stalych klienckich z ograniczeniami CHECK w bazie), przeniesiony na
// parytet rejestr <-> dyspozytor edytorow.
//
// NAPRAWIONE 2026-10-18 (byl `it.fails`): `link-preview`. Typ byl w
// `IMPLEMENTED_BLOCKS`, w `schema.ts` i w `types.ts`, mial dzialajacy renderer
// publiczny (`components/blocks/LinkPreviewBlockView.tsx`) i gotowy edytor
// (`admin/blocks/edit/LinkPreviewBlock.tsx`) - ale dyspozytor nie mial dla
// niego `case`, wiec redaktor dostawal atrape `[link-preview]` zamiast pol.
// Dyspozytor ma teraz `case "link-preview"` montujacy istniejacy edytor.
//
// SPOSOB DOWODZENIA. Kierunek „rejestr -> edytor" jest sprawdzany ZACHOWANIEM:
// kazdy typ z rejestru przechodzi przez PRAWDZIWY dyspozytor na danych z
// `spec.create()` (dokladnie to, co wstawia paleta) i nie moze dac atrapy.
// Kierunek odwrotny („`case` bez wpisu w rejestrze") da sie wylapac tylko ze
// zrodla - `case` bez bloku w rejestrze nie ma czego wyrenderowac - i tylko
// ta jedna asercja czyta etykiety `case`.
//
// GRANICE. Fabryki `vi.mock` (sonner, Radix Select/Switch, `<Link>` routera,
// klient Supabase, kontekst najemcy, `fetch`) niesie modul wspolny tabeli
// edytorow - dlatego jego import jest PIERWSZY. Plik jest `.ts`, wiec drzewo
// buduje `createElement`, nie JSX.
import "../edit/__tests__/blockEditMatrix.shared";

import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { screen } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { BLOCK_SPECS, IMPLEMENTED_BLOCKS } from "@/lib/blocks/registry";
import type { Block } from "@/lib/blocks/types";
import { BlockEditRenderer } from "../BlockEditRenderer";

const RENDERER_PATH = "src/components/admin/blocks/BlockEditRenderer.tsx";

/** Etykiety `case "..."` ze switcha dyspozytora - czytane ze ZRODLA, nie z typu. */
function editorCases(): Set<string> {
  const src = readFileSync(RENDERER_PATH, "utf8");
  const found = src.matchAll(/case "([a-z0-9-]+)":/g);
  return new Set(Array.from(found, (m) => m[1]));
}

const NIC = () => undefined;
const FALSZ = () => false;

/** Montuje blok przez dyspozytor tak, jak robi to kanwa, i oddaje kontener. */
function przezDyspozytor(block: Block): HTMLElement {
  return renderWithQueryClient(
    createElement(BlockEditRenderer, {
      block,
      isActive: true,
      onChange: NIC,
      onTransform: NIC,
      onInsertAfter: NIC,
      onDeleteEmpty: NIC,
      onMergeWithPrevious: FALSZ,
      onFocusPrevious: FALSZ,
      onFocusNext: FALSZ,
      onSelectAllBlocks: NIC,
      onExtendBlockSelection: FALSZ,
    }),
  ).container;
}

beforeEach(() => {
  // Edytory z podgladem na zywo (wykres, mapa) loguja ostrzezenia Reacta na
  // pustych danych z palety - to nie jest przedmiotem tej bramki.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("parytet rejestru blokow z dyspozytorem edytorow", () => {
  it("switch nie oferuje edytora dla typu, ktorego rejestr nie zna", () => {
    // Kierunek odwrotny niz defekt: `case` bez wpisu w rejestrze byloby
    // edytorem nieosiagalnym z drugiej strony (brak bloku do edycji).
    const implemented = new Set<string>(IMPLEMENTED_BLOCKS);
    const extra = [...editorCases()].filter((type) => !implemented.has(type)).sort();
    expect(extra).toEqual([]);
  });

  it.each(IMPLEMENTED_BLOCKS)(
    "%s: blok wstawiony z palety dostaje edytor, a nie atrape [typ]",
    (type) => {
      const container = przezDyspozytor(BLOCK_SPECS[type].create());
      expect(container.textContent ?? "").not.toContain(`[${type}]`);
    },
  );

  it("typ spoza rejestru konczy sie WIDOCZNA atrapa z nazwa typu", () => {
    // Nie jest to pocieszenie, tylko opis skutku: redaktor dostaje szary
    // placeholder z nazwa typu zamiast pola edycji - widac, CO nie dziala.
    przezDyspozytor({ id: "x1", type: "typ-z-przyszlosci", data: {} } as unknown as Block);
    expect(screen.getByText("[typ-z-przyszlosci]")).toBeInTheDocument();
  });
});
