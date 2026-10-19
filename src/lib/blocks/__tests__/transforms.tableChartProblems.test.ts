import { describe, expect, it } from "vitest";
import type { Block } from "@/lib/blocks/types";
import { tableToChartProblems, transformBlock } from "@/lib/blocks/transforms";

// Po „Przekształć w wykres" kanwa (`BlockCanvas`) pokazuje redakcji uwagi
// odczytu tabeli - tymi samymi kodami co import pliku. Kontrakt: uwagi są
// tylko dla TABELI (inny blok nie ma czego raportować), a komórka nieliczbowa
// jest zgłaszana, zamiast cicho zniknąć z wykresu. Moduł czysty, bez atrap.

const tabela = (rows: string[][], header = true): Block =>
  ({ id: "t1", type: "table", data: { rows, header } }) as Block;

describe("tableToChartProblems", () => {
  it("blok inny niż tabela nie ma uwag", () => {
    const akapit = { id: "p1", type: "paragraph", data: { html: "1, 2, 3" } } as Block;
    expect(tableToChartProblems(akapit)).toEqual([]);
  });

  it("komórka nieliczbowa jest zgłaszana redakcji z liczbą komórek", () => {
    const t = tabela([
      ["", "Eksport"],
      ["2023", "12"],
      ["2024", "brak danych"],
    ]);
    expect(tableToChartProblems(t)).toContainEqual({ code: "nonNumericCells", count: 1 });
    // ...a sam wykres i tak powstaje z tego, co liczbowe.
    expect(transformBlock(t, "chart")?.[0].type).toBe("chart");
  });

  it("tabela bez żadnej liczby nie daje wykresu (przekształcenie niedostępne)", () => {
    expect(
      transformBlock(
        tabela([
          ["a", "b"],
          ["c", "d"],
        ]),
        "chart",
      ),
    ).toBeNull();
  });
});
