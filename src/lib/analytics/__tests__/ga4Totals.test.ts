// `ga4TotalsMap` z modułu izomorficznego - jedyny czytnik totali GA4.
//
// PO CO OSOBNY PLIK. Czytnik żył w `ga4.server.ts` (z `node:crypto`), więc
// panel GA4 nie mógł go zaimportować i dorobił sobie kopię, która każdy brak
// sumy zamieniała na 0: kafelki „0 / 0 / 0 / 0.0%" obok niepustego trendu,
// plakietki „-100.0%" i „+∞" liczone od zera-widma. Testy serwera ćwiczą
// czytnik przez re-eksport; TUTAJ przedmiotem dowodu jest sam moduł - że
// odróżnia brak od zera, przyjmuje każdy kształt raportu bez rzutowań i że
// zostaje izomorficzny, czyli nadaje się do paczki klienckiej.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Ga4Report } from "../ga4.server";
import { ga4TotalsMap, type Ga4TotalsSource } from "../ga4Totals";

function raport(over: Partial<Ga4Report> = {}): Ga4Report {
  return {
    configured: true,
    dimensionHeaders: ["date"],
    metricHeaders: ["sessions", "activeUsers"],
    rows: [],
    totals: [],
    ...over,
  };
}

describe("ga4TotalsMap - brak sumy to nie zero", () => {
  it("wiersze bez totali dają PUSTĄ mapę - wołający widzi brak, nie zero", () => {
    const mapa = ga4TotalsMap(
      raport({
        rows: [
          { dims: ["20260801"], metrics: ["12", "9"] },
          { dims: ["20260802"], metrics: ["5", "4"] },
        ],
        totals: [],
      }),
    );

    expect(mapa.size).toBe(0);
    // `get` oddaje `undefined`, więc panel może zamienić to na `null`
    // („Brak danych"), a nie na 0.
    expect(mapa.get("sessions")).toBeUndefined();
  });

  it("totale „0” to zmierzone zero - mapa ma zera, a nie dziury", () => {
    const mapa = ga4TotalsMap(raport({ totals: ["0", "0"] }));

    expect([...mapa.entries()]).toEqual([
      ["sessions", 0],
      ["activeUsers", 0],
    ]);
  });

  it("totale tylko dla części metryk: reszta jest NIEOBECNA, nie zerowa", () => {
    const mapa = ga4TotalsMap(
      raport({
        metricHeaders: ["sessions", "activeUsers", "screenPageViews", "engagementRate"],
        totals: ["60", "45"],
      }),
    );

    expect([...mapa.keys()]).toEqual(["sessions", "activeUsers"]);
    expect(mapa.has("screenPageViews")).toBe(false);
    expect(mapa.has("engagementRate")).toBe(false);
  });

  it("raport z błędem daje pustą mapę, choćby niósł totale", () => {
    const mapa = ga4TotalsMap(raport({ totals: ["17", "13"], error: "GA4 403: brak dostępu" }));

    expect(mapa.size).toBe(0);
  });

  it("wartość nieliczbowa i nieskończona znika z mapy; pusty napis zostaje zerem", () => {
    // `Number("")` to 0 - granica przypięta świadomie po stronie serwera
    // (pusty `value` i tak przychodzi stamtąd jako „0").
    const mapa = ga4TotalsMap(
      raport({
        metricHeaders: ["sessions", "activeUsers", "screenPageViews"],
        totals: ["", "n/a", "Infinity"],
      }),
    );

    expect([...mapa.entries()]).toEqual([["sessions", 0]]);
  });
});

describe("ga4TotalsMap - kontrakt wejścia", () => {
  it("przyjmuje tablice tylko do odczytu, także zamrożone", () => {
    // `EMPTY_GA4_REPORT` jest zamrożony głęboko - czytnik nie może niczego
    // w raporcie zmieniać, a typ `readonly` mówi to kompilatorowi.
    const zrodlo: Ga4TotalsSource = Object.freeze({
      metricHeaders: Object.freeze(["sessions"]),
      totals: Object.freeze(["42"]),
    });

    expect([...ga4TotalsMap(zrodlo).entries()]).toEqual([["sessions", 42]]);
  });

  it("`Ga4Report` jest strukturalnie przypisywalny do źródła totali - bez rzutowania", () => {
    const pelny: Ga4TotalsSource = raport({ totals: ["7", "5"] });

    expect(ga4TotalsMap(pelny).get("activeUsers")).toBe(5);
  });

  it("każde wywołanie oddaje NOWĄ mapę - wołający może ją modyfikować bez skutków ubocznych", () => {
    const zrodlo = raport({ totals: ["7", "5"] });
    const a = ga4TotalsMap(zrodlo);
    a.delete("sessions");

    expect(ga4TotalsMap(zrodlo).get("sessions")).toBe(7);
  });
});

describe("ga4Totals.ts - moduł izomorficzny", () => {
  it("nie ma ANI JEDNEGO importu, więc nie wciągnie `node:crypto` do paczki klienckiej", () => {
    // Panel GA4 importuje ten moduł statycznie. Jeden import kodu serwerowego
    // (choćby przez `ga4.server.ts`) przeniósłby do przeglądarki moduły Node
    // i wywrócił paczkę - albo, przy imporcie typu, zbudował cykl, którego ten
    // plik celowo unika strukturalnym typem parametru.
    const zrodlo = readFileSync("src/lib/analytics/ga4Totals.ts", "utf8");

    expect(zrodlo).not.toMatch(/^\s*import\s/m);
    expect(zrodlo).not.toMatch(/\brequire\(/);
    expect(zrodlo).not.toMatch(/\bimport\(/);
  });
});
