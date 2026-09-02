// Bramka bramki: markery ECharts w `check:entry-purity` muszą ISTNIEĆ w tym,
// co naprawdę trafia do przeglądarki.
//
// PO CO. `scripts/check-entry-purity.ts` rozpoznaje zakazane moduły po
// LITERAŁACH znalezionych w zminifikowanym chunku. Marker, którego w wydaniu
// produkcyjnym biblioteki nie ma, daje bramkę, która NIGDY się nie zapali -
// czyli zieloną i bezużyteczną. To nie jest hipoteza: prawie wszystkie
// czytelne komunikaty ECharts („There is a chart instance already initialized
// on the dom.", „Initialize failed: invalid dom.") siedzą w
// `if (process.env.NODE_ENV !== 'production')` i w `echarts.min.js` ich nie ma.
// Pierwszy kandydat na marker był dokładnie taki i został odrzucony właśnie
// tym pomiarem.
//
// Druga rzecz, którą ten plik pilnuje: marker musi zniknąć razem z regułą.
// Gdyby ktoś usunął wpis `echarts` z `HEAVY_MODULES`, niezmienność „ECharts
// nigdy w grafie SSR" wróciłaby do stanu sprzed naprawy - pilnowana wyłącznie
// akapitem komentarza w `EChart.tsx`, przy koszcie awarii równym wywaleniu
// builda na OOM V8.
//
// CZEGO TEN TEST NIE ROBI: nie uruchamia bramki (ta potrzebuje artefaktu po
// `bun run build`) i nie mierzy kilobajtów (od tego jest `check:bundle`).
// Sprawdza WYŁĄCZNIE, że sonda ma czego szukać.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const GATE = "scripts/check-entry-purity.ts";
/** Wydanie produkcyjne biblioteki - to, w czym bramka szuka markerów. */
const ECHARTS_MIN = join("node_modules", "echarts", "dist", "echarts.min.js");

/**
 * Markery wpisu `echarts` z katalogu `HEAVY_MODULES`.
 *
 * Czytane ze ŹRÓDŁA bramki, a nie zduplikowane tutaj: kopia rozjechałaby się
 * przy pierwszej zmianie i test asertowałby własną stałą zamiast reguły.
 */
function echartsMarkers(): string[] {
  const src = readFileSync(GATE, "utf8");
  const entry = src.slice(src.indexOf('label: "echarts'));
  const markersLine = entry.slice(
    entry.indexOf("markers: ["),
    entry.indexOf("]", entry.indexOf("markers: [")),
  );
  return [...markersLine.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
  );
}

describe("markery ECharts w check:entry-purity", () => {
  it("wpis `echarts` NADAL ISTNIEJE w katalogu ciężkich modułów", () => {
    const src = readFileSync(GATE, "utf8");

    expect(src).toContain('label: "echarts');
    // Wpis ma leżeć w HEAVY_MODULES, nie w słownikach i18n ani w SDK operatorów.
    const heavyModules = src.slice(src.indexOf("const HEAVY_MODULES"));
    expect(heavyModules).toContain('label: "echarts');
  });

  it("deklaruje CO NAJMNIEJ DWA markery z niezależnych modułów rdzenia", () => {
    // Jeden marker to jedna zmiana upstreamu od cichego rozbrojenia bramki.
    expect(echartsMarkers().length).toBeGreaterThanOrEqual(2);
  });

  const hasEcharts = existsSync(ECHARTS_MIN);

  it.runIf(hasEcharts)("KAŻDY marker występuje w PRODUKCYJNYM wydaniu echarts", () => {
    const bundle = readFileSync(ECHARTS_MIN, "utf8");

    for (const marker of echartsMarkers()) {
      // Komunikat mówi wprost, co zrobić - marker w bramce jest bezużyteczny
      // dokładnie wtedy, gdy ten test jest czerwony.
      expect(bundle.includes(marker), `marker nieobecny w ${ECHARTS_MIN}: ${marker}`).toBe(true);
    }
  });

  it.runIf(hasEcharts)("NIE używa markerów wyciętych z wydania produkcyjnego", () => {
    // Regresja, którą ten przypadek utrwala: trzy najbardziej kuszące literały
    // ECharts żyją pod `process.env.NODE_ENV !== 'production'`.
    const bundle = readFileSync(ECHARTS_MIN, "utf8");
    const strippedInProduction = [
      "There is a chart instance already initialized on the dom.",
      "Initialize failed: invalid dom.",
      "ECharts#one is deprecated.",
    ];

    for (const literal of strippedInProduction) {
      expect(bundle.includes(literal)).toBe(false);
      expect(echartsMarkers()).not.toContain(literal);
    }
  });

  it("markery nie występują we WŁASNYM kodzie aplikacji - inaczej bramka daje fałszywy alarm", async () => {
    // Marker trafiający w `src/` zapalałby bramkę na chunku, w którym ECharts
    // nie ma - i po pierwszym takim alarmie nikt by jej już nie ufał.
    const { globSync } = await import("node:fs");
    const files = globSync("src/**/*.{ts,tsx}");
    const markers = echartsMarkers();
    const hits: string[] = [];

    for (const file of files) {
      if (file.includes("__tests__") || file.endsWith(".test.ts") || file.endsWith(".test.tsx")) {
        continue;
      }
      const src = readFileSync(file, "utf8");
      for (const marker of markers) {
        if (src.includes(marker)) hits.push(`${file}: ${marker}`);
      }
    }

    expect(hits).toEqual([]);
  });
});
