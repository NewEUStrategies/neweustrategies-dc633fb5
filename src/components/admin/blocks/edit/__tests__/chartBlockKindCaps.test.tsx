// EDYTOR BLOKU WYKRESU - CEL, PASMO I PALETA TYLKO TAM, GDZIE RODZAJ JE RYSUJE.
//
// PO CO. Forma bloku pokazywała cel, krawędzie pasma optimum, wybór źródła
// pasma i flagę „pasmo demonstracyjne” przy każdym rodzaju, a rysuje je tylko
// rysownik kartezjański (`KIND_CAPS.band`/`.target`). Autor tarczy albo
// histogramu wpisywał cel i pasmo, podgląd nie rysował niczego, a ostrzeżenie
// „pasmo bez źródła” prosiło o źródło pasma, którego i tak nie będzie.
//
// Bramka `src/lib/charts/__tests__/kindCaps.test.tsx` dowodzi renderem, że
// flagi mówią prawdę o rysunku; ten plik - że forma czyta TE flagi, w obie
// strony. Ukrycie pola NIE kasuje zapisu: wartość wraca w formie, gdy autor
// wróci do rodzaju, który ją rysuje.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Block } from "@/lib/blocks/types";
import { CHART_KINDS, type ChartKind } from "@/lib/charts/types";
import { KIND_CAPS } from "@/lib/charts/kindCaps";
import { BlockEditorProvider } from "../../BlockEditorContext";
import { ChartBlock } from "../DataVizBlocks";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

vi.mock("@/components/charts/Chart", () => ({
  Chart: () => <div data-testid="podglad" />,
}));

const CEL = "Linia celu - wartość (puste = brak)";
const PASMO_OD = "Pasmo optimum - od";
const PASMO_DO = "Pasmo optimum - do";
const ZRODLO_PASMA = "Źródło pasma optimum";
const PASMO_DEMO = "Pasmo demonstracyjne";
const PALETA = "Paleta kolorów";
const PASMO_BEZ_ZRODLA = "Pasmo bez źródła nie zostanie narysowane";

/** Blok z celem i pasmem BEZ źródła - stan, w którym forma ostrzega. */
function blok(kind: ChartKind): Block {
  return {
    id: "blk-wykres-caps",
    type: "chart",
    data: {
      kind,
      animate: false,
      categories: ["2023", "2024", "2025"],
      series: [
        { name: "Eksport", values: [10, 12, 14] },
        { name: "Import", values: [5, 8, 9] },
      ],
      target: { value: 25 },
      band: { min: 10, max: 20, sourceId: "", demo: false },
    },
  };
}

function zamontuj(b: Block) {
  const changes: Block[] = [];
  const view = render(
    <BlockEditorProvider lang="pl">
      <ChartBlock block={b} onChange={(next) => changes.push(next)} />
    </BlockEditorProvider>,
  );
  return { changes, ...view };
}

const obecne = (role: "textbox" | "combobox" | "checkbox", name: string): boolean =>
  screen.queryByRole(role, { name }) !== null;

describe("edytor bloku wykresu - pola odniesień idą za KIND_CAPS", () => {
  for (const kind of CHART_KINDS) {
    const caps = KIND_CAPS[kind];

    it(`${kind}: cel ${caps.target ? "JEST" : "NIE jest"}, pasmo ${caps.band ? "JEST" : "NIE jest"}, paleta ${caps.palette ? "JEST" : "NIE jest"} w formie`, () => {
      const { container } = zamontuj(blok(kind));
      expect(obecne("textbox", CEL), "cel").toBe(caps.target);
      expect(obecne("textbox", PASMO_OD), "pasmo od").toBe(caps.band);
      expect(obecne("textbox", PASMO_DO), "pasmo do").toBe(caps.band);
      expect(obecne("combobox", ZRODLO_PASMA), "źródło pasma").toBe(caps.band);
      expect(obecne("checkbox", PASMO_DEMO), "pasmo demonstracyjne").toBe(caps.band);
      // Ostrzeżenie o źródle pasma tylko tam, gdzie pasmo w ogóle powstanie.
      expect(container.textContent?.includes(PASMO_BEZ_ZRODLA), "ostrzeżenie").toBe(caps.band);
      expect(obecne("combobox", PALETA), "paleta").toBe(caps.palette);
    });
  }

  it("ukrycie pola nie kasuje zapisu - cel i pasmo wracają przy rodzaju, który je rysuje", () => {
    const { changes, rerender } = zamontuj(blok("pie"));
    expect(obecne("textbox", CEL)).toBe(false);
    // Sam render formy niczego nie zapisuje, więc treść bloku zostaje nietknięta.
    expect(changes).toEqual([]);

    rerender(
      <BlockEditorProvider lang="pl">
        <ChartBlock block={blok("bar")} onChange={(next) => changes.push(next)} />
      </BlockEditorProvider>,
    );
    expect((screen.getByRole("textbox", { name: CEL }) as HTMLInputElement).value).toBe("25");
    expect((screen.getByRole("textbox", { name: PASMO_OD }) as HTMLInputElement).value).toBe("10");
    expect((screen.getByRole("textbox", { name: PASMO_DO }) as HTMLInputElement).value).toBe("20");
  });
});
