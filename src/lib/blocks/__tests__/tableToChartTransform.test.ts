// „Przekształć w wykres" na bloku TABELI (PR2).
//
// Zakres z Excela wklejony na kanwę bez zaznaczonego wykresu staje się
// blokiem tabeli; transformacja robi z niego wykres tą samą drogą co import
// pliku (`tableToChartData`). Tabela -> mapa danych świadomie nie istnieje
// (skorowidz krajów jest asynchroniczny), a tekstowe transformacje zostają
// takie, jakie były.
import { describe, expect, it } from "vitest";
import type { Block } from "@/lib/blocks/types";
import { getTransformTargets, transformBlock } from "@/lib/blocks/transforms";
import { parseChartConfig } from "@/lib/charts/parse";

function tabela(rows: string[][], header = false): Block {
  return { id: "t1", type: "table", data: { rows, header } };
}

describe("tabela -> wykres", () => {
  it("tabela oferuje WYŁĄCZNIE wykres - bez mapy danych", () => {
    expect(getTransformTargets(tabela([["a"]]))).toEqual(["chart"]);
    expect(transformBlock(tabela([["a"]]), "data-map")).toBeNull();
    expect(transformBlock(tabela([["a"]]), "paragraph")).toBeNull();
  });

  it("nagłówek i polskie liczby rozpoznane jak przy imporcie pliku", () => {
    const out = transformBlock(
      tabela([
        ["", "Eksport", "Import"],
        ["2023", "12,5", "8"],
        ["2024", "14", "9,5"],
      ]),
      "chart",
    );
    expect(out).toHaveLength(1);
    const blok = out?.[0];
    expect(blok?.type).toBe("chart");
    expect(blok?.id).not.toBe("t1");
    const config = parseChartConfig(blok?.data ?? {});
    expect(config.categories).toEqual(["2023", "2024"]);
    expect(config.series.map((s) => s.name)).toEqual(["Eksport", "Import"]);
    expect(config.series[0].values).toEqual([12.5, 14]);
    expect(config.series[1].values).toEqual([8, 9.5]);
  });

  it("flaga nagłówka tabeli rozstrzyga, nawet gdy pierwszy wiersz to liczby", () => {
    const out = transformBlock(
      tabela(
        [
          ["Rok", "2023", "2024"],
          ["PL", "1", "2"],
        ],
        true,
      ),
      "chart",
    );
    const config = parseChartConfig(out?.[0]?.data ?? {});
    // Okresy w nagłówku i kraje w wierszach - układ Eurostatu, obrócony.
    expect(config.categories).toEqual(["2023", "2024"]);
    expect(config.series.map((s) => s.name)).toEqual(["PL"]);
  });

  it("wykres z tabeli dostaje ustawienia domyślne bloku wykresu", () => {
    const out = transformBlock(
      tabela([
        ["", "A"],
        ["x", "1"],
      ]),
      "chart",
    );
    expect(out?.[0]?.data.kind).toBe("bar");
    expect(out?.[0]?.data.height).toBe(320);
  });
});
