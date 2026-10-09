// ŹRÓDŁA MAPY DANYCH W SEKWENCJI PRZYPISÓW ARTYKUŁU.
//
// Wykres (`chart`) od specyfikacji 2026-10 numeruje swoje źródła z TEJ SAMEJ
// sekwencji co przypisy tekstu, a ich opisy trafiają do jednej bibliografii
// na dole wpisu. Mapa danych (`data-map`) dostała w PR2 listę źródeł, ale
// pre-pass przypisów jej nie znał, a `renderDataMap` nie przekazywał numerów -
// więc pod mapą stało „[1]", choć w artykule numer 1 miał już akapit, a jej
// źródła nie trafiały do bibliografii strony. Pilnujemy trzech ogniw:
//   1. `precomputeFootnotes` - gałąź `data-map` (także w kontenerach) bierze
//      numery z sekwencji artykułu i dopisuje opisy do kolektora;
//   2. `renderDataMap` - czyta numery kluczem `${id}:source:${sourceId}`
//      i oddaje je widokowi bloku;
//   3. `DataMapBlockView` - przekazuje je mapie, a pusta mapa numerów znaczy
//      „blok poza artykułem": mapa numeruje źródła sama.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import type { Block, Json } from "@/lib/blocks/types";
import { createCounter } from "@/lib/footnotes";
import { precomputeFootnotes } from "../footnotes";
import type { BlockRenderContext } from "../context";

const h = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));

// Widok bloku jest leniwy (`lazyBlockViews`) - tu podmieniamy go rejestratorem
// propsów, bo pytamy o to, CO renderer bloku mu podaje.
vi.mock("../lazyBlockViews", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lazyBlockViews")>();
  return {
    ...real,
    DataMapBlockView: (props: Record<string, unknown>) => {
      h.props.push(props);
      return null;
    },
  };
});

// Zasób geometrii nie schodzi z sieci - test pyta o ramę, nie o rysunek.
vi.mock("@/lib/charts/geoQuery", () => ({
  geoAssetQueryOptions: (region: string) => ({
    queryKey: ["geo", region],
    queryFn: () => new Promise(() => {}),
  }),
}));

const { renderDataMap } = await import("../molecules");
const { DataMapBlockView } = await import("../../DataVizViews");

afterEach(() => {
  cleanup();
  h.props = [];
});

const ZRODLA_MAPY: Json = [
  { id: "es", title: "GDP per capita", author: "Eurostat" },
  { id: "wb", title: "World Development Indicators", author: "World Bank" },
];

function mapaBlok(id: string, sources: Json = ZRODLA_MAPY): Block {
  return {
    id,
    type: "data-map",
    data: { region: "europe", title: "Mapa", values: [{ id: "PL", value: 1 }], sources },
  };
}

describe("precomputeFootnotes - gałąź mapy danych", () => {
  it("źródła mapy biorą numery z sekwencji artykułu, po tekście i po wykresie", () => {
    const blocks: Block[] = [
      { id: "p", type: "paragraph", data: { html: "Tekst[fn]przypis akapitu[/fn]" } },
      {
        id: "c",
        type: "chart",
        data: { sources: [{ id: "s1", title: "Raport wykresu", author: "GUS" }] },
      },
      mapaBlok("m"),
      {
        id: "col",
        type: "columns",
        data: {
          // Treść bloku jest JSON-em - blok dziecka jedzie jako zwykły obiekt.
          left: [
            {
              id: "m2",
              type: "data-map",
              data: {
                region: "europe",
                values: [{ id: "PL", value: 1 }],
                sources: [{ id: "x", title: "Źródło w kolumnie" }],
              },
            },
          ],
          right: [],
        },
      },
    ];
    const fn = createCounter(1);
    const out = new Map<string, string>();
    precomputeFootnotes(blocks, fn, out);

    expect(out.get("c:source:s1")).toBe("2");
    expect(out.get("m:source:es")).toBe("3");
    expect(out.get("m:source:wb")).toBe("4");
    // Mapa w kontenerze idzie tą samą drogą co tekst w kontenerze.
    expect(out.get("m2:source:x")).toBe("5");
    // Opisy jadą do JEDNEJ bibliografii strony, z numerami sekwencji.
    expect(fn.notes.map((n) => n.id)).toEqual([1, 2, 3, 4, 5]);
    expect(fn.notes[2].html).toContain("GDP per capita");
    expect(fn.notes[4].html).toContain("Źródło w kolumnie");
  });

  it("mapa bez źródeł nie zużywa numeru", () => {
    const fn = createCounter(1);
    const out = new Map<string, string>();
    precomputeFootnotes([mapaBlok("m", [])], fn, out);
    expect(fn.notes).toEqual([]);
    expect([...out.keys()]).toEqual([]);
  });
});

describe("renderDataMap - numery z pre-passu trafiają do widoku bloku", () => {
  function ctx(block: Block, fnHtml: ReadonlyMap<string, string>): BlockRenderContext {
    return {
      block,
      cls: "",
      fnHtml,
      lang: "pl",
      allBlocks: [block],
      t: ((key: string) => key) as unknown as TFunction,
      renderChild: () => null,
    };
  }

  it("czyta klucze `${id}:source:${sourceId}` TEGO bloku", () => {
    const fnHtml = new Map([
      ["m:source:es", "3"],
      ["m:source:wb", "4"],
      // Klucz innego bloku i klucz tekstu nie mogą przeciec.
      ["inny:source:es", "9"],
      ["m:text", "<p>x</p>"],
    ]);
    render(<>{renderDataMap(ctx(mapaBlok("m"), fnHtml))}</>);
    const footnotes = h.props[0]?.footnotes as Map<string, number>;
    expect([...footnotes.entries()]).toEqual([
      ["es", 3],
      ["wb", 4],
    ]);
  });
});

describe("DataMapBlockView - numery przypisów na mapie", () => {
  function Wrap({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const data = mapaBlok("m").data as Record<string, Json>;

  it("w artykule znacznik przypisu nosi numer sekwencji strony", () => {
    render(
      <Wrap>
        <DataMapBlockView
          data={data}
          lang="pl"
          footnotes={
            new Map([
              ["es", 3],
              ["wb", 4],
            ])
          }
        />
      </Wrap>,
    );
    expect(screen.getByRole("button", { name: "Przypis 3 - pokaż źródło" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Przypis 4 - pokaż źródło" })).toBeTruthy();
  });

  it("poza artykułem (pusta mapa numerów) mapa numeruje źródła sama", () => {
    render(
      <Wrap>
        <DataMapBlockView data={data} lang="pl" footnotes={new Map()} />
      </Wrap>,
    );
    expect(screen.getByRole("button", { name: "Przypis 1 - pokaż źródło" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Przypis 2 - pokaż źródło" })).toBeTruthy();
  });
});
