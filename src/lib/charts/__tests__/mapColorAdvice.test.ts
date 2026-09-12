// Bramka ostrzeżeń o kolorze mapy.
//
// Te funkcje istnieją, bo poprzednia wersja panelu LICZYŁA BARWY, a w tekście
// ostrzeżenia powoływała się na ich rozróżnialność. To dwie różne rzeczy:
// liczba 8 pochodzi z palety wyszukanej i zwalidowanej, a autor mapy wybiera
// dowolnie. Testy niżej pilnują, żeby kod sprawdzał to, o czym mówi.
import { describe, it, expect } from "vitest";
import {
  manualColorAdvice,
  mixOklab,
  rampColorClashesWithNoData,
  NO_DATA_MIN_DELTA,
} from "../mapColorAdvice";
import { MAP_MANUAL_COLOR_WARN_AT } from "../types";
import { CHART_PLATE, deltaE76 } from "../palette";
import type { MapDatum } from "../types";

const kraje = (pary: Array<[string, string | undefined]>): MapDatum[] =>
  pary.map(([id, color], i) => (color === undefined ? { id, value: i } : { id, value: i, color }));

describe("rampColorClashesWithNoData", () => {
  it("pusta barwa bazowa nie ma czego zderzyć - to ścieżka tokenowa", () => {
    expect(rampColorClashesWithNoData("")).toEqual([]);
  });

  it("barwa bliska neutralnej zlewa się z brakiem danych w OBU motywach", () => {
    // #d4bdac to beż z palety serii; zmierzone ΔE do --secondary po
    // rozcieńczeniu podłogą: 1,7 (jasny) i 3,5 (ciemny).
    expect(rampColorClashesWithNoData("#d4bdac")).toEqual(["light", "dark"]);
  });

  it("barwy nasycone przechodzą - także ciepłe i jasne", () => {
    for (const c of ["#3366cc", "#00375f", "#fa9346", "#63b2f2", "#81d365"]) {
      expect(rampColorClashesWithNoData(c)).toEqual([]);
    }
  });

  it("próg mierzy ODLEGŁOŚĆ BARWY, nie sam kontrast jasności", () => {
    // Pomarańcz rozcieńczony bielą ma wobec --secondary niemal identyczną
    // jasność (kontrast ~1,005), ale wyraźnie inny odcień. Gdyby ostrzeżenie
    // szło po kontraście, wywalałoby barwy, które na dużej plamie widać
    // doskonale - i autor nauczyłby się je ignorować.
    const podloga = mixOklab("#fa9346", CHART_PLATE.light, 0.15);
    expect(deltaE76(podloga, "#f3f1ee")).toBeGreaterThan(NO_DATA_MIN_DELTA);
  });
});

describe("manualColorAdvice", () => {
  it("dwie barwy nierozróżnialne przy deuteranopii są zgłaszane MIMO że są dwie", () => {
    const rada = manualColorAdvice(
      kraje([
        ["PL", "#3366cc"],
        ["DE", "#9933cc"],
      ]),
    );
    expect(rada.tooMany).toBeNull();
    expect(rada.cvdPairs).toHaveLength(1);
    expect(rada.cvdPairs[0].kind).toBe("deutan");
    expect(rada.cvdPairs[0].distance).toBeLessThan(10);
  });

  it("barwy oddalone nie są zgłaszane", () => {
    expect(
      manualColorAdvice(
        kraje([
          ["PL", "#3366cc"],
          ["DE", "#fa9346"],
        ]),
      ).cvdPairs,
    ).toEqual([]);
  });

  it("licznik zapala się DOKŁADNIE na progu, nie powyżej", () => {
    const osiem = kraje(
      ["#1b4fd8", "#e0451c", "#0f8b3d", "#ffd400", "#7a2ea8", "#00a7b5", "#c4006b", "#5a4632"].map(
        (c, i) => [`C${i}`, c] as [string, string],
      ),
    );
    expect(manualColorAdvice(osiem).tooMany).toBe(MAP_MANUAL_COLOR_WARN_AT);
    expect(manualColorAdvice(osiem.slice(0, 7)).tooMany).toBeNull();
  });

  it("ta sama barwa u wielu krajów to JEDNA barwa", () => {
    const rada = manualColorAdvice(
      kraje([
        ["PL", "#3366cc"],
        ["ES", "#3366cc"],
        ["FR", "#3366cc"],
      ]),
    );
    expect(rada.tooMany).toBeNull();
    expect(rada.cvdPairs).toEqual([]);
  });

  it("kraje bez barwy nie wchodzą do rachunku", () => {
    expect(
      manualColorAdvice(
        kraje([
          ["PL", undefined],
          ["DE", undefined],
        ]),
      ),
    ).toEqual({
      tooMany: null,
      cvdPairs: [],
    });
  });
});
