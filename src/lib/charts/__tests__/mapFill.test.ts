// Bramka arytmetyki koloru mapy.
//
// Testujemy tu WYBÓR I MIESZANIE, a nie render: komponent tylko wypisuje to,
// co ten moduł zwróci, więc błąd w regule daje się złapać bez montowania SVG.
// Dwie rzeczy pilnujemy szczególnie, bo obie potrafią przejść niezauważone:
// zgodność ścieżki awaryjnej (atrybut `fill`) z docelową (`style`), której
// nowa przeglądarka NIGDY nie pokaże, oraz rozłączność trybów.
import { describe, it, expect } from "vitest";
import {
  countryFill,
  hexLerp,
  manualColorCount,
  manualFill,
  manualLegend,
  rampFill,
  rampShare,
  RAMP_FLOOR,
} from "../mapFill";
import { CHART_PLATE, SEQ_RAMP, deltaE76 } from "../palette";
import { mixOklab } from "../mapColorAdvice";
import type { MapDatum } from "../types";

describe("rampShare", () => {
  it("najmniejsza wartość siada na kotwicy, nie na zerze", () => {
    // Zero udziału zrównałoby kraj z najniższą wartością z krajem BEZ danych.
    expect(rampShare(10, 10, 90)).toBe(RAMP_FLOOR);
  });

  it("największa wartość to barwa pełna", () => {
    expect(rampShare(100, 10, 90)).toBe(1);
  });

  it("zdegenerowana domena daje samą kotwicę zamiast dzielenia przez zero", () => {
    expect(rampShare(42, 42, 0)).toBe(RAMP_FLOOR);
    expect(Number.isFinite(rampShare(42, 42, 0))).toBe(true);
  });

  it("wartość spoza domeny nie wychodzi poza zakres", () => {
    // Domena liczy się z danych, więc normalnie nie ma czego przycinać - ale
    // legenda i mapa muszą znieść wpis dołożony po policzeniu domeny.
    expect(rampShare(-5, 10, 90)).toBe(RAMP_FLOOR);
    expect(rampShare(1000, 10, 90)).toBe(1);
  });
});

describe("rampFill", () => {
  it("bez barwy bazowej jedzie tokenami motywu - jak przed wyborem barwy", () => {
    const f = rampFill(1, "", "light");
    expect(f.style).toBe("color-mix(in oklab, var(--chart-seq-max) 100%, var(--chart-seq-min))");
    expect(f.attr).toBe(SEQ_RAMP.light.max);
  });

  it("kotwica tokenowa zgadza się ze ścieżką awaryjną", () => {
    const f = rampFill(0, "", "dark");
    expect(f.attr).toBe(SEQ_RAMP.dark.min);
  });

  it("z barwą bazową miesza ją z powierzchnią, nie z bielą", () => {
    // W ciemnym motywie mieszanie z bielą dałoby przy małych wartościach plamy
    // JAŚNIEJSZE od tła, czyli odwróciłoby kierunek odczytu.
    const f = rampFill(0, "#3366cc", "dark");
    expect(f.attr).toBe(CHART_PLATE.dark);
    expect(f.style).toBe("color-mix(in oklab, #3366cc 0%, var(--card))");
  });

  it("pełna wartość to dokładnie barwa autora, w obu motywach", () => {
    expect(rampFill(1, "#3366cc", "light").attr).toBe("#3366cc");
    expect(rampFill(1, "#3366cc", "dark").attr).toBe("#3366cc");
  });

  it("procent w color-mix jest całkowity - CSS nie dostaje 33.33333%", () => {
    expect(rampFill(1 / 3, "#3366cc", "light").style).toBe(
      "color-mix(in oklab, #3366cc 33%, var(--card))",
    );
  });
});

describe("manualFill", () => {
  it("barwa autora idzie i w atrybut, i w styl", () => {
    expect(manualFill("#ff8800", "light")).toEqual({ attr: "#ff8800", style: "#ff8800" });
  });

  it("kraj z danymi bez barwy NIE wygląda jak kraj bez danych", () => {
    // --secondary maluje kraje bez danych; tu musi wyjść co innego, bo to inna
    // wiadomość: „mam liczbę, nie należę do grupy".
    const f = manualFill(undefined, "light");
    expect(f.style).toBe("var(--chart-seq-min)");
    expect(f.style).not.toContain("secondary");
    expect(f.attr).toBe(SEQ_RAMP.light.min);
  });
});

describe("countryFill - rozłączność trybów", () => {
  const opts = { rampColor: "#3366cc", min: 0, span: 100, theme: "light" as const };

  it("tryb rampy IGNORUJE barwę własną kraju", () => {
    const zBarwa = countryFill({ value: 100, color: "#ff0000" }, { ...opts, mode: "ramp" });
    const bezBarwy = countryFill({ value: 100 }, { ...opts, mode: "ramp" });
    expect(zBarwa).toEqual(bezBarwy);
    expect(zBarwa.attr).toBe("#3366cc");
  });

  it("tryb ręczny IGNORUJE wartość i barwę bazową", () => {
    const duza = countryFill({ value: 100, color: "#ff0000" }, { ...opts, mode: "manual" });
    const mala = countryFill({ value: 1, color: "#ff0000" }, { ...opts, mode: "manual" });
    expect(duza).toEqual(mala);
    expect(duza.attr).toBe("#ff0000");
  });

  it("przełączenie trybu jest odwracalne - nic nie ginie po drodze", () => {
    const datum = { value: 100, color: "#ff0000" };
    const wRampie = countryFill(datum, { ...opts, mode: "ramp" });
    const wRecznym = countryFill(datum, { ...opts, mode: "manual" });
    const znowuWRampie = countryFill(datum, { ...opts, mode: "ramp" });
    expect(znowuWRampie).toEqual(wRampie);
    expect(wRecznym.attr).toBe("#ff0000");
  });
});

describe("manualLegend", () => {
  const values: MapDatum[] = [
    { id: "PL", value: 1, color: "#3366cc" },
    { id: "DE", value: 2 },
    { id: "FR", value: 3, color: "#cc3366" },
    { id: "ES", value: 4, color: "#3366cc" },
  ];

  it("grupuje po barwie w kolejności pierwszego wystąpienia", () => {
    expect(manualLegend(values)).toEqual([
      { color: "#3366cc", ids: ["PL", "ES"] },
      { color: "#cc3366", ids: ["FR"] },
    ]);
  });

  it("kraj bez barwy nie tworzy grupy", () => {
    expect(manualLegend(values).flatMap((g) => g.ids)).not.toContain("DE");
  });

  it("liczba barw to liczba grup, a nie liczba krajów", () => {
    expect(manualColorCount(values)).toBe(2);
    expect(manualColorCount([])).toBe(0);
  });
});

describe("hexLerp", () => {
  it("końce są dokładne, środek jest środkiem", () => {
    expect(hexLerp("#000000", "#ffffff", 0)).toBe("#000000");
    expect(hexLerp("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(hexLerp("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});

describe("ścieżka awaryjna kontra docelowa - ŚRODEK rampy", () => {
  // PIERWSZA WERSJA TEJ BRAMKI NIE PILNOWAŁA NICZEGO. Wszystkie asercje stały
  // na `share` 0 albo 1, czyli w punktach, w których `hexLerp(a, b, 0) === a`
  // z definicji - obie postacie były tam równe niezależnie od tego, co robi
  // kod. Rozjazd może powstać WYŁĄCZNIE w środku, bo tam jedna strona liczy
  // w oklab (przeglądarka), a druga w sRGB (nasz `hexLerp`).
  //
  // CZEGO TA BRAMKA NIE TWIERDZI: że obie postacie są równe. Nie są i nie mogą
  // być - to dwie różne przestrzenie. Twierdzi, że rozjazd jest OGRANICZONY,
  // więc przeglądarka bez `color-mix()` pokazuje ten sam kolor z dokładnością
  // do odcienia, a nie inną mapę.
  const GRANICA = 8;

  it.each([
    ["#3366cc", "light"],
    ["#3366cc", "dark"],
    ["#fa9346", "light"],
    ["#fa9346", "dark"],
    ["#01112f", "light"],
  ] as const)("%s w motywie %s trzyma się granicy na całej rampie", (kolor, theme) => {
    for (const share of [0.15, 0.3, 0.5, 0.7, 0.85]) {
      const f = rampFill(share, kolor, theme);
      const docelowy = mixOklab(kolor, CHART_PLATE[theme], share);
      expect(deltaE76(f.attr, docelowy)).toBeLessThan(GRANICA);
    }
  });

  it("ścieżka tokenowa też - i to ona jest punktem odniesienia", () => {
    for (const theme of ["light", "dark"] as const) {
      for (const share of [0.15, 0.5, 0.85]) {
        const f = rampFill(share, "", theme);
        const docelowy = mixOklab(SEQ_RAMP[theme].max, SEQ_RAMP[theme].min, share);
        expect(deltaE76(f.attr, docelowy)).toBeLessThan(GRANICA);
      }
    }
  });
});

describe("wpis bez wartości", () => {
  it("w trybie wielkości NIE udaje najmniejszej wartości", () => {
    const opts = {
      mode: "ramp" as const,
      rampColor: "#3366cc",
      min: 0,
      span: 100,
      theme: "light" as const,
    };
    const bezWartosci = countryFill({ value: null }, opts);
    const najmniejsza = countryFill({ value: 0 }, opts);
    expect(bezWartosci).not.toEqual(najmniejsza);
    expect(bezWartosci.style).toBe("var(--chart-seq-min)");
  });

  it("w trybie przynależności rysuje się swoją barwą", () => {
    const f = countryFill(
      { value: null, color: "#ff8800" },
      { mode: "manual", rampColor: "", min: 0, span: 0, theme: "light" },
    );
    expect(f.attr).toBe("#ff8800");
  });
});
