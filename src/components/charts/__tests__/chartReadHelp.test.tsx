// „JAK CZYTAĆ" PER RODZINA RYSUNKU.
//
// CO SIĘ DZIAŁO. Okno pomocy mówiło przy KAŻDYM rodzaju i przy mapie to samo:
// „Oś pozioma pokazuje kategorie... Kliknij pozycję legendy, aby ukryć serię.
// Kliknij punkt, aby otworzyć definicję wskaźnika". Tarcza nie ma osi, mapa
// ciepła i panele nie mają legendy przełączanej, a punkt otwiera definicję
// tylko na liniach i słupkach - czytelnik dostawał instrukcję obsługi innego
// rysunku.
//
// CO PILNUJE TA BRAMKA:
//   1. każda rodzina (`KIND_CAPS.family` + `map`) ma jawne klucze zdań
//      (`READ_HELP_KEYS`), a każdy klucz ma treść w PL i EN, bez pauzy
//      i półpauzy, z tymi samymi wstawkami;
//   2. okno pomocy wykresu danego rodzaju pokazuje zdania SWOJEJ rodziny,
//      a kolory zależą od palety tam, gdzie paleta jest wyborem;
//   3. pasmo i cel są objaśniane tylko tam, gdzie rysunek je rysuje.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/lib/i18n";
import "@/lib/i18n-charts";
import type { Json } from "@/lib/content-model/json";
import { CHART_KINDS } from "@/lib/charts/types";
import { parseChartConfig } from "@/lib/charts/parse";
import { KIND_CAPS } from "@/lib/charts/kindCaps";
import { Chart } from "../Chart";
import type { ChartFamily } from "../ChartFrame";
import { READ_HELP_KEYS } from "../readHelp";

afterEach(cleanup);

const RODZINY = Object.keys(READ_HELP_KEYS) as ChartFamily[];
const tekst = (key: string, lng: "pl" | "en"): string => i18n.t(`charts.${key}`, { lng });
const wstawki = (s: string): string[] => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);

describe("klucze „Jak czytać” per rodzina", () => {
  it("obejmują każdą rodzinę rodzajów i mapę", () => {
    const zRodzajow = new Set(CHART_KINDS.map((k) => KIND_CAPS[k].family));
    for (const rodzina of zRodzajow) expect(RODZINY).toContain(rodzina);
    expect(RODZINY).toContain("map");
  });

  it.each(["pl", "en"] as const)(
    "każdy klucz ma treść w języku %s, bez pauzy i półpauzy",
    (lng) => {
      for (const rodzina of RODZINY) {
        for (const key of Object.values(READ_HELP_KEYS[rodzina])) {
          expect(i18n.exists(`charts.${key}`, { lng }), `${lng}: ${key}`).toBe(true);
          const t = tekst(key, lng);
          expect(t.trim().length, key).toBeGreaterThan(20);
          expect(t, key).not.toMatch(/[–—]/);
        }
      }
    },
  );

  it("PL i EN mają te same wstawki", () => {
    for (const rodzina of RODZINY) {
      for (const key of Object.values(READ_HELP_KEYS[rodzina])) {
        expect(wstawki(tekst(key, "en")), key).toEqual(wstawki(tekst(key, "pl")));
      }
    }
  });
});

const DANE: Record<string, Json> = {
  categories: ["PL", "DE", "FR", "IT", "ES", "NL", "BE", "CZ"],
  series: [
    { name: "Wynik 2025", values: [12, 31, 24, 19, 8, 27, 15, 22] },
    { name: "Wynik 2024", values: [9, 28, 21, 23, 11, 24, 13, 18] },
  ],
  animate: false,
  band: { min: 10, max: 20, sourceId: "bench" },
  target: { value: 25 },
  sources: [{ id: "bench", author: "Eurostat", title: "Benchmark", url: "https://example.org" }],
};

function oknoPomocy(kind: (typeof CHART_KINDS)[number], extra: Record<string, Json> = {}) {
  render(<Chart config={parseChartConfig({ ...DANE, kind, ...extra })} lang="pl" />);
  fireEvent.click(screen.getByRole("button", { name: "Jak czytać ten wykres" }));
  return (document.querySelector("dialog.neh-dialog[open]") as HTMLElement).textContent ?? "";
}

describe("okno pomocy mówi o rysunku, który czytelnik widzi", () => {
  for (const kind of CHART_KINDS) {
    const caps = KIND_CAPS[kind];
    it(`${kind}: zdania rodziny „${caps.family}”`, () => {
      const okno = oknoPomocy(kind);
      const klucze = READ_HELP_KEYS[caps.family];
      expect(okno).toContain(tekst(klucze.elements, "pl"));
      expect(okno).toContain(tekst(klucze.colorsFocus, "pl"));
      expect(okno).toContain(tekst(klucze.interactions, "pl"));
      // Pasmo i cel tylko tam, gdzie rysunek je rysuje.
      expect(okno.includes(tekst("read.bandText", "pl"))).toBe(caps.band || caps.target);
    });
  }

  it("paleta kategorialna podmienia zdanie o kolorach, gdy paleta jest wyborem", () => {
    const okno = oknoPomocy("pie", { palette: "categorical" });
    expect(okno).toContain(tekst(READ_HELP_KEYS.part.colorsCategorical, "pl"));
    expect(okno).not.toContain(tekst(READ_HELP_KEYS.part.colorsFocus, "pl"));
  });

  it("tarcza nie dostaje zdań o osiach ani o legendzie przełączanej", () => {
    const okno = oknoPomocy("donut");
    expect(okno).not.toContain(tekst("read.elementsText", "pl"));
    expect(okno).not.toContain(tekst("read.interactionsText", "pl"));
  });
});
