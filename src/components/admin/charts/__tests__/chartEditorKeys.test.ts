// KLUCZE `chartEditor.*` WOŁANE Z KODU ISTNIEJĄ W OBU JĘZYKACH.
//
// Bramka `chartOverlayParity` pilnuje, że nakładka ma te same liście w PL
// i EN - ale nie wie, które klucze woła kod. Literówka w kluczu („grid.cel"
// zamiast „grid.cell") przeszłaby przez nią zielono, a panel pokazałby
// surową ścieżkę. Ta bramka czyta źródła edytora wykresu (komponenty
// `src/components/admin/charts` i edytory, które ich używają) i sprawdza
// KAŻDY pełny klucz `chartEditor.*` w słowniku obu języków. Klucze są w kodzie
// wypisane jawnie (mapy `Record`), więc skan po tekście widzi je wszystkie.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import i18n from "@/lib/i18n";
import "@/lib/i18n-chart-data-editor";

const KATALOG = "src/components/admin/charts";
const INNE = [
  "src/components/admin/blocks/edit/DataVizBlocks.tsx",
  "src/components/admin/builder/ui/molecules/ChartDataSpreadsheetDialog.tsx",
];

function zrodla(): string[] {
  const pliki = readdirSync(KATALOG)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("Map"))
    .map((f) => `${KATALOG}/${f}`);
  return [...pliki, ...INNE];
}

function klucze(): Set<string> {
  const out = new Set<string>();
  for (const plik of zrodla()) {
    const tekst = readFileSync(plik, "utf8");
    for (const m of tekst.matchAll(/["'`](chartEditor\.[A-Za-z0-9_.]+)["'`]/g)) out.add(m[1]);
  }
  return out;
}

describe("chartEditor.* - klucze wołane z kodu", () => {
  it("skan znajduje klucze (bramka nie może być cicho pusta)", () => {
    expect(klucze().size).toBeGreaterThan(40);
  });

  it.each(["pl", "en"] as const)("każdy klucz ma treść w słowniku (%s)", (jezyk) => {
    const braki = [...klucze()].filter((k) => !i18n.exists(k, { lng: jezyk }));
    expect(braki).toEqual([]);
  });

  it("żaden klucz nie jest sklejany z wartości w czasie wykonania", () => {
    for (const plik of zrodla()) {
      const tekst = readFileSync(plik, "utf8");
      expect(tekst, plik).not.toMatch(/`chartEditor\.[^`]*\$\{/);
    }
  });
});
