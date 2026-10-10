// KLUCZE `mapEditor.*` WOŁANE Z KODU ISTNIEJĄ W OBU JĘZYKACH.
//
// Bramka `chartOverlayParity` pilnuje, że nakładka edytora mapy ma te same
// liście w PL i EN (i nazwy kanoniczne), ale nie wie, które klucze woła kod -
// literówka („grid.cel" zamiast „grid.cell") przeszłaby przez nią zielono,
// a panel pokazałby surową ścieżkę. Ta bramka czyta źródła edytora mapy
// (komponenty `Map*` i ich pomocniki w `src/components/admin/charts`, blok
// CMS, pole buildera i tryb mapy podglądu wklejki) i sprawdza KAŻDY pełny
// klucz `mapEditor.*` - oraz `chartEditor.*`, gdyby plik mapy po niego
// sięgnął, bo bramka `chartEditorKeys` pliki `Map*` pomija. Klucze są w kodzie
// wypisane jawnie (mapy `Record`), więc skan po tekście widzi je wszystkie.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import i18n from "@/lib/i18n";
import "@/lib/i18n-map-editor";
import "@/lib/i18n-chart-data-editor";

const KATALOG = "src/components/admin/charts";
const INNE = [
  "src/components/admin/blocks/edit/DataMapBlock.tsx",
  "src/components/admin/builder/ui/molecules/MapDataField.tsx",
  `${KATALOG}/PastePreviewDialog.tsx`,
];

function zrodla(): string[] {
  const pliki = readdirSync(KATALOG)
    .filter((f) => /\.(ts|tsx)$/.test(f) && /^(Map|map)/.test(f))
    .map((f) => `${KATALOG}/${f}`);
  return [...pliki, ...INNE];
}

function klucze(wzor: RegExp): Set<string> {
  const out = new Set<string>();
  for (const plik of zrodla()) {
    const tekst = readFileSync(plik, "utf8");
    for (const m of tekst.matchAll(wzor)) out.add(m[1]);
  }
  return out;
}

const MAP_KEY = /["'`](mapEditor\.[A-Za-z0-9_.]+)["'`]/g;
const CHART_KEY = /["'`](chartEditor\.[A-Za-z0-9_.]+)["'`]/g;

describe("mapEditor.* - klucze wołane z kodu", () => {
  it("skan znajduje klucze (bramka nie może być cicho pusta)", () => {
    expect(zrodla().length).toBeGreaterThanOrEqual(8);
    expect(klucze(MAP_KEY).size).toBeGreaterThan(40);
  });

  it.each(["pl", "en"] as const)("każdy klucz ma treść w słowniku (%s)", (jezyk) => {
    const braki = [...klucze(MAP_KEY), ...klucze(CHART_KEY)].filter(
      (k) => !i18n.exists(k, { lng: jezyk }),
    );
    expect(braki).toEqual([]);
  });

  it("każdy liść nakładki jest wołany z kodu - słownik bez martwych napisów", () => {
    const liscie = (wezel: unknown, prefiks: string): string[] =>
      wezel !== null && typeof wezel === "object"
        ? Object.entries(wezel).flatMap(([k, v]) => liscie(v, `${prefiks}.${k}`))
        : [prefiks];
    const pakiet = i18n.getResourceBundle("pl", "translation") as Record<string, unknown>;
    const uzyte = klucze(MAP_KEY);
    const martwe = liscie(pakiet.mapEditor, "mapEditor").filter((k) => !uzyte.has(k));
    expect(martwe).toEqual([]);
  });

  it("żaden klucz nie jest sklejany z wartości w czasie wykonania", () => {
    for (const plik of zrodla()) {
      const tekst = readFileSync(plik, "utf8");
      expect(tekst, plik).not.toMatch(/`mapEditor\.[^`]*\$\{/);
    }
  });

  it("każdy plik, który woła klucze `mapEditor.*`, importuje nakładkę", () => {
    for (const plik of zrodla()) {
      const tekst = readFileSync(plik, "utf8");
      if (!/["'`]mapEditor\./.test(tekst)) continue;
      expect(tekst, plik).toContain('import "@/lib/i18n-map-editor"');
    }
  });
});
