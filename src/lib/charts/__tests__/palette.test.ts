// Bramka palety wykresów. Sprawdza TRZY rzeczy, które nie są widoczne w DOM
// i których żaden test renderujący nie zobaczy:
//
//   1. metoda pomiaru jest ta sama, którą policzono paletę (self-check
//      kolorymetrii wobec liczb ze specyfikacji),
//   2. paleta spełnia progi - kontrast na płycie, kontrast tuszu w wypełnieniu,
//      podłoga odległości barw po symulacji daltonizmu,
//   3. tokeny w `src/styles.css` MAJĄ TE SAME WARTOŚCI co ten moduł.
//
// Punkt 3 jest tu najważniejszy. Bez niego moduł byłby dokumentacją, która
// rozjeżdża się z runtime'em po pierwszej ręcznej poprawce w arkuszu: silnik
// czyta tokeny, więc to arkusz maluje piksele, a moduł tylko twierdzi. Sklejone
// razem: podmiana odcienia w CSS bez przeliczenia palety oblewa bramkę.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_SERIES } from "@/lib/charts/types";
import {
  BAND_CONTRAST_RANGE,
  CATEGORICAL_SAFE_MAX,
  CHART_PLATE,
  CHART_SEMANTIC,
  CHART_SLOTS,
  CONTRAST_MIN,
  CVD_FLOOR,
  CVD_KINDS,
  GRID_CONTRAST_MAX,
  SLOTS_CLASHING_WITH_ACCENT,
  SLOTS_CLASHING_WITH_SIGN,
  compositeOver,
  contrastRatio,
  cvdDistance,
  formatHex,
  labOf,
  minPairwiseCvdDistance,
  needsPatternDifferentiator,
  parseHex,
  relativeLuminance,
  simulateCvd,
  slotAt,
  ACCENT_AUDIT,
  BAR_FILL_PARAMS,
  CHART_SURFACES,
  SEQ_RAMP,
  SLOTS_UNSAFE_ON_SURFACE_2,
  deltaE76,
  EDGE_FACE_RANGE,
  HOVER_CONTRAST_RANGE,
  HOVER_STEP_RANGE,
  INNER_CONTRAST_RANGE,
  barFillOf,
  fromOklch,
  oklchOf,
} from "@/lib/charts/palette";

// ---------------------------------------------------------------------------
// Odczyt tokenów z arkusza - ten sam sposób cięcia bloków, co w
// `src/components/charts/__tests__/pieChart.test.tsx`, żeby oba testy patrzyły
// na dokładnie te same napisy.
// ---------------------------------------------------------------------------
const css = readFileSync("src/styles.css", "utf8");
const LIGHT_BLOCK = css.slice(css.indexOf(":root,"), css.indexOf(".dark {"));
const DARK_BLOCK = css.slice(css.indexOf(".dark {"), css.indexOf("@layer base"));
// Blok druku stoi PO `@layer base`, czyli poza cięciem powyżej - i właśnie
// dlatego potrzebuje własnego zakresu. Bez niego jedyny zestaw tokenów
// wykresu, którego nikt nie pilnuje, to ten, który idzie na papier.
const PRINT_BLOCK = css.slice(css.indexOf("@media print {"));

function token(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`brak tokenu ${name}`);
  return m[1].trim().toLowerCase();
}

function hexToken(block: string, name: string): string {
  const raw = token(block, name);
  if (!/^#[0-9a-f]{6}$/.test(raw))
    throw new Error(`token ${name} nie jest 6-cyfrowym hexem: ${raw}`);
  return raw;
}

function numberToken(block: string, name: string): number {
  const raw = token(block, name);
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) throw new Error(`token ${name} nie jest liczbą: ${raw}`);
  return value;
}

const THEMES = [
  ["jasny", LIGHT_BLOCK, CHART_PLATE.light] as const,
  ["ciemny", DARK_BLOCK, CHART_PLATE.dark] as const,
];

describe("palette - metoda pomiaru", () => {
  it("kontrast odtwarza wartości referencyjne WCAG", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // Kontrast jest symetryczny - kolejność argumentów nie może nic zmieniać.
    expect(contrastRatio("#00528f", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#00528f"),
      10,
    );
    expect(contrastRatio("#00528f", "#ffffff")).toBeCloseTo(8.07, 2);
  });

  it("luminancja rośnie monotonicznie z jasnością", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 6);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 6);
    expect(relativeLuminance("#808080")).toBeGreaterThan(relativeLuminance("#404040"));
  });

  it("parseHex przyjmuje skrót trzycyfrowy i odrzuca śmieci", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("00528F")).toEqual([0, 82, 143]);
    expect(() => parseHex("var(--chart-1)")).toThrow(/nie jest kolorem hex/);
    expect(() => parseHex("#12345")).toThrow(/nie jest kolorem hex/);
  });

  it("formatHex przycina do zakresu kanału zamiast zawijać", () => {
    expect(formatHex([300, -20, 128])).toBe("#ff0080");
  });

  it("CIELAB odtwarza punkty referencyjne", () => {
    const [lWhite] = labOf("#ffffff");
    const [lBlack] = labOf("#000000");
    expect(lWhite).toBeCloseTo(100, 1);
    expect(lBlack).toBeCloseTo(0, 1);
  });

  it("symulacja daltonizmu odtwarza zmierzone odległości palety", () => {
    // Te liczby są kotwicą całej metody: jeśli macierze albo przestrzeń barw
    // się zmienią, wszystkie pozostałe progi w tym pliku zaczną mierzyć coś
    // innego i muszą zostać przeliczone RAZEM z nimi.
    //
    // RÓŻNICA WOBEC LICZB PUBLIKOWANYCH DLA TEJ PALETY (19,9 / 23,1 / 17,0
    // i 24,6 / 26,2 / 24,4) jest ZNANA i wynosi do 0,6: `simulateCvd`
    // zaokrągla wynik symulacji do 8-bitowego sRGB PRZED przejściem do
    // CIELAB, bo ekran nie umie wyświetlić części kanału. Pomiar na liczbach
    // zmiennoprzecinkowych daje dokładnie wartości publikowane. Zostaje
    // wariant zaokrąglony, bo mierzy to, co czytelnik naprawdę widzi -
    // a spójność wewnątrz repo jest ważniejsza niż zgodność z cudzą
    // implementacją do drugiego miejsca.
    const light = CHART_SLOTS.slice(0, CATEGORICAL_SAFE_MAX).map((s) => s.light);
    expect(minPairwiseCvdDistance(light, "deutan")?.distance).toBeCloseTo(19.57, 1);
    expect(minPairwiseCvdDistance(light, "protan")?.distance).toBeCloseTo(23.01, 1);
    expect(minPairwiseCvdDistance(light, "tritan")?.distance).toBeCloseTo(20.13, 1);

    const dark = CHART_SLOTS.slice(0, CATEGORICAL_SAFE_MAX).map((s) => s.dark);
    expect(minPairwiseCvdDistance(dark, "deutan")?.distance).toBeCloseTo(20.65, 1);
    expect(minPairwiseCvdDistance(dark, "protan")?.distance).toBeCloseTo(24.75, 1);
    expect(minPairwiseCvdDistance(dark, "tritan")?.distance).toBeCloseTo(17.01, 1);
  });

  it("symulacja NIE jest wygaszeniem kanału - czerwień idzie w ochrę, nie w czerń", () => {
    const original = relativeLuminance("#ef5454");
    const seen = simulateCvd("#ef5454", "protan");
    // Gdyby macierz tylko zerowała kanał czerwony, luminancja runęłaby niemal
    // do zera. Model fizjologiczny zachowuje ponad połowę jasności (0,133
    // wobec 0,253) i przesuwa odcień - dlatego dla protanopa czerwień wygląda
    // jak ochra, a nie jak czerń, i dlatego zieleń przestaje się od niej
    // różnić. Próg jest RELATYWNY do odcienia wejściowego, bo o pomyłkę
    // "wygaszenie kanału" chodzi, nie o konkretną wartość.
    expect(relativeLuminance(seen)).toBeGreaterThan(original * 0.4);
    const [, a] = labOf(seen);
    expect(a).toBeLessThan(labOf("#ef5454")[1]);
  });

  it("compositeOver zwraca tło przy alfie 0 i kolor przy alfie 1", () => {
    expect(compositeOver("#00528f", "#ffffff", 0)).toBe("#ffffff");
    expect(compositeOver("#00528f", "#ffffff", 1)).toBe("#00528f");
  });

  it("slotAt zawija numer na paletę, tak jak `(i % 8) + 1` w kodzie widgetów", () => {
    expect(slotAt(1).key).toBe("granat");
    expect(slotAt(CHART_SLOTS.length + 1).key).toBe("granat");
    expect(slotAt(0).key).toBe(CHART_SLOTS[CHART_SLOTS.length - 1].key);
  });
});

describe("palette - progi WCAG", () => {
  it("każdy slot jest widoczny na płycie swojego motywu (>= 3:1)", () => {
    for (const slot of CHART_SLOTS) {
      const light = contrastRatio(slot.light, CHART_PLATE.light);
      const dark = contrastRatio(slot.dark, CHART_PLATE.dark);
      expect(light, `jasny ${slot.key}: ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        CONTRAST_MIN.graphic,
      );
      expect(dark, `ciemny ${slot.key}: ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        CONTRAST_MIN.graphic,
      );
    }
  });

  it("wariant TEKSTOWY każdego slotu przechodzi 4,5:1 - inaczej podpisy są nieczytelne", () => {
    for (const slot of CHART_SLOTS) {
      const light = contrastRatio(slot.textLight, CHART_PLATE.light);
      const dark = contrastRatio(slot.textDark, CHART_PLATE.dark);
      expect(light, `jasny ${slot.key}t: ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        CONTRAST_MIN.text,
      );
      expect(dark, `ciemny ${slot.key}t: ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        CONTRAST_MIN.text,
      );
    }
  });

  it("wariant tekstowy nie jest JAŚNIEJSZY od serii w motywie jasnym i nie ciemniejszy w ciemnym", () => {
    // Kierunek wyprowadzania wariantu: w jasnym przyciemniamy, w ciemnym
    // rozjaśniamy. Wariant o odwrotnym kierunku przechodziłby próg tylko
    // przypadkiem i psułby spójność odcienia serii z jej podpisem.
    for (const slot of CHART_SLOTS) {
      expect(relativeLuminance(slot.textLight), `jasny ${slot.key}`).toBeLessThanOrEqual(
        relativeLuminance(slot.light) + 1e-9,
      );
      expect(relativeLuminance(slot.textDark), `ciemny ${slot.key}`).toBeGreaterThanOrEqual(
        relativeLuminance(slot.dark) - 1e-9,
      );
    }
  });

  it("tusz etykiety w wypełnieniu przechodzi 4,5:1 w każdym slocie i obu motywach", () => {
    // Etykieta udziału to 12 px / waga 600 - nie jest "dużym tekstem", więc
    // obowiązuje ją AA 4,5:1, nie 3:1.
    for (const slot of CHART_SLOTS) {
      const light = contrastRatio(slot.inkLight, slot.light);
      const dark = contrastRatio(slot.inkDark, slot.dark);
      expect(light, `jasny ${slot.key}: ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        CONTRAST_MIN.text,
      );
      expect(dark, `ciemny ${slot.key}: ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        CONTRAST_MIN.text,
      );
    }
  });

  it("semantyka znaku: grafika >= 3:1, tekst >= 4,5:1 w obu motywach", () => {
    const cases: Array<[string, string, string, number]> = [
      ["dodatni jasny", CHART_SEMANTIC.positiveLight, CHART_PLATE.light, CONTRAST_MIN.graphic],
      ["ujemny jasny", CHART_SEMANTIC.negativeLight, CHART_PLATE.light, CONTRAST_MIN.graphic],
      ["dodatni ciemny", CHART_SEMANTIC.positiveDark, CHART_PLATE.dark, CONTRAST_MIN.graphic],
      ["ujemny ciemny", CHART_SEMANTIC.negativeDark, CHART_PLATE.dark, CONTRAST_MIN.graphic],
      [
        "dodatni tekst jasny",
        CHART_SEMANTIC.positiveTextLight,
        CHART_PLATE.light,
        CONTRAST_MIN.text,
      ],
      [
        "ujemny tekst jasny",
        CHART_SEMANTIC.negativeTextLight,
        CHART_PLATE.light,
        CONTRAST_MIN.text,
      ],
      [
        "dodatni tekst ciemny",
        CHART_SEMANTIC.positiveTextDark,
        CHART_PLATE.dark,
        CONTRAST_MIN.text,
      ],
      ["ujemny tekst ciemny", CHART_SEMANTIC.negativeTextDark, CHART_PLATE.dark, CONTRAST_MIN.text],
    ];
    for (const [name, colour, plate, threshold] of cases) {
      const r = contrastRatio(colour, plate);
      expect(r, `${name}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(threshold);
    }
  });

  it("czerwień ujemna NIE przechodzi progu tekstowego na jasnym - dlatego istnieje wariant", () => {
    // Ta asercja pilnuje POWODU istnienia `negativeTextLight`. Gdyby ktoś
    // rozjaśnił płytę albo przyciemnił czerwień tak, że próg zaczyna
    // przechodzić, wariant staje się zbędny i trzeba to zauważyć świadomie.
    expect(contrastRatio(CHART_SEMANTIC.negativeLight, CHART_PLATE.light)).toBeLessThan(
      CONTRAST_MIN.text,
    );
    expect(contrastRatio(CHART_SEMANTIC.negativeLight, CHART_PLATE.light)).toBeGreaterThanOrEqual(
      CONTRAST_MIN.graphic,
    );
  });
});

describe("palette - rozdzielność dla daltonizmu", () => {
  it("zestaw BEZPIECZNY (sloty 1..6) trzyma podłogę w każdym rodzaju widzenia", () => {
    for (const theme of ["light", "dark"] as const) {
      const hexes = CHART_SLOTS.slice(0, CATEGORICAL_SAFE_MAX).map((s) =>
        theme === "dark" ? s.dark : s.light,
      );
      for (const kind of CVD_KINDS) {
        const closest = minPairwiseCvdDistance(hexes, kind);
        expect(closest).not.toBeNull();
        expect(
          closest?.distance,
          `${theme} ${kind}: ${closest?.distance.toFixed(2)} para ${closest?.pair.join("/")}`,
        ).toBeGreaterThanOrEqual(CVD_FLOOR.safe[kind]);
      }
    }
  });

  it("zestaw PEŁNY (sloty 1..10) trzyma własną, NIŻSZĄ podłogę - i to jest udokumentowane", () => {
    // Dziesięć odcieni rozdzielnych w tej rodzinie nie istnieje. Ten próg mówi
    // wprost, ile realnie zostaje, żeby nikt nie wziął slotów 7-10 za
    // bezpieczne. Sloty poza zestawem bezpiecznym dostają w silniku
    // kreskowanie jako drugi nośnik różnicy.
    for (const theme of ["light", "dark"] as const) {
      const hexes = CHART_SLOTS.map((s) => (theme === "dark" ? s.dark : s.light));
      for (const kind of CVD_KINDS) {
        const closest = minPairwiseCvdDistance(hexes, kind);
        expect(
          closest?.distance,
          `${theme} ${kind}: ${closest?.distance.toFixed(2)} para ${closest?.pair.join("/")}`,
        ).toBeGreaterThanOrEqual(CVD_FLOOR.extended[kind]);
      }
    }
  });

  it("podłoga pełnego zestawu jest NIŻSZA od bezpiecznego - próg nie jest dekoracją", () => {
    for (const kind of CVD_KINDS) {
      expect(CVD_FLOOR.extended[kind], kind).toBeLessThan(CVD_FLOOR.safe[kind]);
    }
  });

  it("dokładnie sloty poza zestawem bezpiecznym wymagają kreskowania", () => {
    for (const slot of CHART_SLOTS) {
      expect(needsPatternDifferentiator(slot.slot), slot.key).toBe(
        slot.slot > CATEGORICAL_SAFE_MAX,
      );
      expect(slot.cvdSafe, slot.key).toBe(slot.slot <= CATEGORICAL_SAFE_MAX);
    }
  });

  it("para dodatni/ujemny rozchodzi się we WSZYSTKICH rodzajach widzenia", () => {
    // To jest cała treść decyzji "dodatni jest tealem, nie zielenią".
    // Protanopia jest tu wąskim gardłem: klasyczny teal zielony #2d7a6a daje
    // wobec tej czerwieni 8,5, czyli zysk i strata w jednym kolorze.
    for (const kind of CVD_KINDS) {
      const light = cvdDistance(CHART_SEMANTIC.positiveLight, CHART_SEMANTIC.negativeLight, kind);
      const dark = cvdDistance(CHART_SEMANTIC.positiveDark, CHART_SEMANTIC.negativeDark, kind);
      expect(light, `jasny ${kind}: ${light.toFixed(2)}`).toBeGreaterThanOrEqual(
        CVD_FLOOR.safe[kind],
      );
      expect(dark, `ciemny ${kind}: ${dark.toFixed(2)}`).toBeGreaterThanOrEqual(
        CVD_FLOOR.safe[kind],
      );
    }
    expect(
      cvdDistance(CHART_SEMANTIC.positiveLight, CHART_SEMANTIC.negativeLight, "protan"),
    ).toBeGreaterThan(cvdDistance("#2d7a6a", CHART_SEMANTIC.negativeLight, "protan") * 3);
  });

  it("lista slotów kolidujących ze znakiem jest PRAWDZIWA, nie przepisana z notatki", () => {
    for (const slot of SLOTS_CLASHING_WITH_SIGN) {
      const hex = slotAt(slot).light;
      const worst = Math.min(
        ...CVD_KINDS.map((kind) => cvdDistance(hex, CHART_SEMANTIC.negativeLight, kind)),
      );
      expect(worst, `slot ${slot}: ${worst.toFixed(2)}`).toBeLessThan(CVD_FLOOR.safe.protan);
    }
    // I odwrotnie: slot, którego nie ma na liście, musi się od czerwieni
    // odróżniać. Inaczej lista jest niepełna i wykres kłamie.
    for (const slot of CHART_SLOTS.filter(
      (s) => s.cvdSafe && !SLOTS_CLASHING_WITH_SIGN.includes(s.slot),
    )) {
      const worst = Math.min(
        ...CVD_KINDS.map((kind) => cvdDistance(slot.light, CHART_SEMANTIC.negativeLight, kind)),
      );
      expect(worst, `slot ${slot.slot} (${slot.key}): ${worst.toFixed(2)}`).toBeGreaterThanOrEqual(
        CVD_FLOOR.extended.deutan,
      );
    }
  });

  it("lista slotów kolidujących z akcentem marki jest PRAWDZIWA", () => {
    const accentText = hexToken(LIGHT_BLOCK, "--chart-accent-text");
    for (const slot of SLOTS_CLASHING_WITH_ACCENT) {
      const worst = Math.min(
        ...CVD_KINDS.map((kind) => cvdDistance(slotAt(slot).light, accentText, kind)),
      );
      expect(worst, `slot ${slot}: ${worst.toFixed(2)}`).toBeLessThan(CVD_FLOOR.safe.tritan);
    }
  });
});

describe("palette - pasmo prognozy i siatka", () => {
  it("krycie pasma trafia w korytarz kontrastu do płyty w KAŻDYM slocie", () => {
    // Stała alfa nie działa: różnica jasności serii wobec płyty jest nierówna,
    // więc jedno pasmo byłoby niewidoczne, a inne konkurowałoby z linią.
    for (const slot of CHART_SLOTS) {
      const light = contrastRatio(
        compositeOver(slot.light, CHART_PLATE.light, slot.bandLight),
        CHART_PLATE.light,
      );
      const dark = contrastRatio(
        compositeOver(slot.dark, CHART_PLATE.dark, slot.bandDark),
        CHART_PLATE.dark,
      );
      expect(light, `jasny ${slot.key}: ${light.toFixed(3)}:1`).toBeGreaterThanOrEqual(
        BAND_CONTRAST_RANGE.min,
      );
      expect(light, `jasny ${slot.key}: ${light.toFixed(3)}:1`).toBeLessThanOrEqual(
        BAND_CONTRAST_RANGE.max,
      );
      expect(dark, `ciemny ${slot.key}: ${dark.toFixed(3)}:1`).toBeGreaterThanOrEqual(
        BAND_CONTRAST_RANGE.min,
      );
      expect(dark, `ciemny ${slot.key}: ${dark.toFixed(3)}:1`).toBeLessThanOrEqual(
        BAND_CONTRAST_RANGE.max,
      );
    }
  });

  it("krycie pasma semantyki też trafia w korytarz", () => {
    const cases: Array<[string, string, string, number]> = [
      [
        "dodatni jasny",
        CHART_SEMANTIC.positiveLight,
        CHART_PLATE.light,
        CHART_SEMANTIC.bandPositiveLight,
      ],
      [
        "ujemny jasny",
        CHART_SEMANTIC.negativeLight,
        CHART_PLATE.light,
        CHART_SEMANTIC.bandNegativeLight,
      ],
      [
        "dodatni ciemny",
        CHART_SEMANTIC.positiveDark,
        CHART_PLATE.dark,
        CHART_SEMANTIC.bandPositiveDark,
      ],
      [
        "ujemny ciemny",
        CHART_SEMANTIC.negativeDark,
        CHART_PLATE.dark,
        CHART_SEMANTIC.bandNegativeDark,
      ],
    ];
    for (const [name, colour, plate, alpha] of cases) {
      const r = contrastRatio(compositeOver(colour, plate, alpha), plate);
      expect(r, `${name}: ${r.toFixed(3)}:1`).toBeGreaterThanOrEqual(BAND_CONTRAST_RANGE.min);
      expect(r, `${name}: ${r.toFixed(3)}:1`).toBeLessThanOrEqual(BAND_CONTRAST_RANGE.max);
    }
  });

  it("siatka jest wyczuwalna, nie widoczna (< 1,3:1 do płyty), a oś od niej mocniejsza", () => {
    for (const [name, block, plate] of THEMES) {
      const grid = contrastRatio(hexToken(block, "--chart-grid"), plate);
      const axis = contrastRatio(hexToken(block, "--chart-axis"), plate);
      expect(grid, `${name} siatka: ${grid.toFixed(3)}:1`).toBeLessThan(GRID_CONTRAST_MAX);
      expect(grid, `${name} siatka: ${grid.toFixed(3)}:1`).toBeGreaterThan(1.05);
      expect(axis, `${name} oś: ${axis.toFixed(3)}:1`).toBeGreaterThan(grid);
      expect(axis, `${name} oś: ${axis.toFixed(3)}:1`).toBeLessThan(1.6);
    }
  });

  it("strefa prognozy jest separatorem, nie plamą (kontrast do płyty < 1,08)", () => {
    for (const [name, block, plate] of THEMES) {
      const zone = hexToken(block, "--chart-zone");
      const alpha = numberToken(block, "--chart-zone-alpha");
      const r = contrastRatio(compositeOver(zone, plate, alpha), plate);
      expect(r, `${name}: ${r.toFixed(3)}:1`).toBeGreaterThan(1.02);
      expect(r, `${name}: ${r.toFixed(3)}:1`).toBeLessThan(1.08);
    }
  });
});

describe("palette - tokeny w styles.css zgadzają się z modułem", () => {
  it("MAX_SERIES równa się liczbie slotów palety", () => {
    // Gdyby te dwie liczby się rozjechały, parser przyjąłby slot bez tokenu -
    // a brak tokenu to czarne wypełnienie albo niewidoczna kreska, po cichu.
    expect(CHART_SLOTS).toHaveLength(MAX_SERIES);
    expect(CHART_SLOTS.map((s) => s.slot)).toEqual(
      Array.from({ length: MAX_SERIES }, (_, i) => i + 1),
    );
  });

  it("wypełnienia, warianty tekstowe, tusze i krycia pasm są identyczne w CSS i w module", () => {
    for (const slot of CHART_SLOTS) {
      expect(hexToken(LIGHT_BLOCK, `--chart-${slot.slot}`), `jasny ${slot.key}`).toBe(slot.light);
      expect(hexToken(DARK_BLOCK, `--chart-${slot.slot}`), `ciemny ${slot.key}`).toBe(slot.dark);
      expect(hexToken(LIGHT_BLOCK, `--chart-${slot.slot}t`), `jasny ${slot.key}t`).toBe(
        slot.textLight,
      );
      expect(hexToken(DARK_BLOCK, `--chart-${slot.slot}t`), `ciemny ${slot.key}t`).toBe(
        slot.textDark,
      );
      expect(hexToken(LIGHT_BLOCK, `--chart-ink-${slot.slot}`), `jasny tusz ${slot.key}`).toBe(
        slot.inkLight,
      );
      expect(hexToken(DARK_BLOCK, `--chart-ink-${slot.slot}`), `ciemny tusz ${slot.key}`).toBe(
        slot.inkDark,
      );
      expect(numberToken(LIGHT_BLOCK, `--chart-band-${slot.slot}`), `jasne pasmo ${slot.key}`).toBe(
        slot.bandLight,
      );
      expect(numberToken(DARK_BLOCK, `--chart-band-${slot.slot}`), `ciemne pasmo ${slot.key}`).toBe(
        slot.bandDark,
      );
    }
  });

  it("blok DRUKU odtwarza DOKŁADNIE tokeny jasne - inaczej wydruk kłamie kolorem", () => {
    // Wydruk odtwarza jasne tokeny w zasięgu `.dark`, żeby wykres z trybu
    // ciemnego nie wyszedł na papierze czarną plamą. Skoro odtwarza, to musi
    // odtwarzać CO DO HEXA: blok przepisany ręcznie zostaje przy poprzedniej
    // palecie po każdej zmianie kolorów i nikt tego nie widzi, bo na ekranie
    // wygląda dobrze.
    for (const slot of CHART_SLOTS) {
      expect(hexToken(PRINT_BLOCK, `--chart-${slot.slot}`), `druk ${slot.key}`).toBe(slot.light);
      expect(hexToken(PRINT_BLOCK, `--chart-${slot.slot}t`), `druk ${slot.key}t`).toBe(
        slot.textLight,
      );
      expect(hexToken(PRINT_BLOCK, `--chart-ink-${slot.slot}`), `druk tusz ${slot.key}`).toBe(
        slot.inkLight,
      );
      expect(numberToken(PRINT_BLOCK, `--chart-band-${slot.slot}`), `druk pasmo ${slot.key}`).toBe(
        slot.bandLight,
      );
    }
  });

  it("semantyka znaku jest identyczna w CSS i w module", () => {
    expect(hexToken(LIGHT_BLOCK, "--chart-positive")).toBe(CHART_SEMANTIC.positiveLight);
    expect(hexToken(DARK_BLOCK, "--chart-positive")).toBe(CHART_SEMANTIC.positiveDark);
    expect(hexToken(LIGHT_BLOCK, "--chart-negative")).toBe(CHART_SEMANTIC.negativeLight);
    expect(hexToken(DARK_BLOCK, "--chart-negative")).toBe(CHART_SEMANTIC.negativeDark);
    expect(hexToken(LIGHT_BLOCK, "--chart-positive-text")).toBe(CHART_SEMANTIC.positiveTextLight);
    expect(hexToken(DARK_BLOCK, "--chart-positive-text")).toBe(CHART_SEMANTIC.positiveTextDark);
    expect(hexToken(LIGHT_BLOCK, "--chart-negative-text")).toBe(CHART_SEMANTIC.negativeTextLight);
    expect(hexToken(DARK_BLOCK, "--chart-negative-text")).toBe(CHART_SEMANTIC.negativeTextDark);
    expect(hexToken(LIGHT_BLOCK, "--chart-ink-positive")).toBe(CHART_SEMANTIC.positiveInkLight);
    expect(hexToken(DARK_BLOCK, "--chart-ink-positive")).toBe(CHART_SEMANTIC.positiveInkDark);
    expect(hexToken(LIGHT_BLOCK, "--chart-ink-negative")).toBe(CHART_SEMANTIC.negativeInkLight);
    expect(hexToken(DARK_BLOCK, "--chart-ink-negative")).toBe(CHART_SEMANTIC.negativeInkDark);
  });

  it("płyta, wobec której paleta jest mierzona, to REALNY token --card", () => {
    // Cała walidacja liczy kontrast wobec CHART_PLATE. Gdyby ktoś zmienił
    // --card, te liczby przestałyby opisywać to, co widzi czytelnik.
    //
    // Motyw jasny zapisuje biel jako `oklch(1 0 0)`, a nie `#ffffff`, więc
    // porównujemy ZNACZENIE, nie napis: obie postacie to ta sama biel
    // (bramka i tak liczy kontrast z CHART_PLATE.light). Lista dopuszczalnych
    // zapisów jest krótka i jawna, żeby podmiana --card na cokolwiek innego
    // niż biel oblała ten test.
    expect(["#ffffff", "#fff", "oklch(1 0 0)", "white"]).toContain(token(LIGHT_BLOCK, "--card"));
    expect(relativeLuminance(CHART_PLATE.light)).toBeCloseTo(1, 6);
    expect(token(DARK_BLOCK, "--card")).toBe(CHART_PLATE.dark);
  });

  it("ten sam odcień serii w obu motywach - przełączenie motywu nie zmienia wniosku", () => {
    // Warunek nadrzędny trybu ciemnego: seria zachowuje TEN SAM odcień,
    // zmienia się tylko jasność i nasycenie. Dopuszczalne odchylenie kąta
    // odcienia w CIELAB to 10 stopni.
    const hueOf = (hex: string): number => {
      const [, a, b] = labOf(hex);
      return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    };
    for (const slot of CHART_SLOTS) {
      const delta = Math.abs(hueOf(slot.light) - hueOf(slot.dark));
      const shortest = Math.min(delta, 360 - delta);
      expect(shortest, `${slot.key}: ${shortest.toFixed(1)} st.`).toBeLessThanOrEqual(10);
    }
  });

  it("motyw ciemny NIE odwraca ról znaku - dodatni zostaje dodatnim", () => {
    const hueOf = (hex: string): number => {
      const [, a, b] = labOf(hex);
      return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    };
    // Próg dla semantyki jest o stopień luźniejszy niż dla serii (11 wobec
    // 10) i to nie jest niedbałość: `--chart-positive` musi jednocześnie
    // trzymać kontrast na DWÓCH bardzo różnych płytach (#ffffff i #0f0f0f)
    // ORAZ maksymalną odległość od czerwieni przy protanopii, a te trzy
    // warunki naraz zostawiają na kąt odcienia mniej miejsca niż seria, która
    // odpowiada tylko za samą siebie. Zmierzone przesunięcie to 10,18 stopnia
    // (teal #1b6f8c -> #6fb3c9). Ujemny nie przesuwa się wcale, bo w obu
    // motywach jest tym samym #ef5454.
    for (const [name, light, dark] of [
      ["dodatni", CHART_SEMANTIC.positiveLight, CHART_SEMANTIC.positiveDark],
      ["ujemny", CHART_SEMANTIC.negativeLight, CHART_SEMANTIC.negativeDark],
    ] as const) {
      const delta = Math.abs(hueOf(light) - hueOf(dark));
      expect(Math.min(delta, 360 - delta), name).toBeLessThanOrEqual(11);
    }
  });
});

describe("palette - WYPEŁNIENIA SŁUPKÓW: arkusz zgadza się z wyprowadzeniem", () => {
  // Ta bramka jest całą treścią rozdzielenia "policzone" od "przepisane".
  // W arkuszu stoi 132 hexy odcieni pochodnych; żaden z nich nie został
  // dobrany - każdy jest krokiem jasności w OKLCh przy zachowanej chromie
  // i odcieniu. Bramka liczy je z tokena bazowego i porównuje z napisem
  // w arkuszu, więc literówka w hexie albo cicha podmiana koloru zapala test.
  // Bez niej cała maszyneria OKLCh w `palette.ts` byłaby dekoracją.
  const HUES = [
    ...CHART_SLOTS.map((s) => ({ name: String(s.slot), light: s.light, dark: s.dark })),
    { name: "positive", light: CHART_SEMANTIC.positiveLight, dark: CHART_SEMANTIC.positiveDark },
    { name: "negative", light: CHART_SEMANTIC.negativeLight, dark: CHART_SEMANTIC.negativeDark },
  ];
  const VARIANTS = ["edge", "inner", "hover", "deep", "mid", "face"] as const;

  it.each(["light", "dark"] as const)(
    "każdy odcień pochodny w motywie %s jest dokładnie tym, co daje krok w OKLCh",
    (theme) => {
      const block = theme === "light" ? LIGHT_BLOCK : DARK_BLOCK;
      for (const hue of HUES) {
        const derived = barFillOf(theme === "dark" ? hue.dark : hue.light, theme);
        for (const v of VARIANTS) {
          expect(hexToken(block, `--chart-${hue.name}-${v}`), `${theme} ${hue.name} ${v}`).toBe(
            derived[v],
          );
        }
      }
    },
  );

  it.each(["light", "dark"] as const)(
    "OBWÓDKA niesie całą granicę kształtu, więc przechodzi próg grafiki (%s)",
    (theme) => {
      // Wypełnienie o niskim kontraście nie daje ostrej pozycji końca słupka -
      // to z obwódki odczytuje się wartość. Gdyby ona nie przechodziła 3,0:1,
      // wariant blady przestawałby być czytelny jako kształt.
      for (const hue of HUES) {
        const { edge } = barFillOf(theme === "dark" ? hue.dark : hue.light, theme);
        expect(
          contrastRatio(edge, CHART_PLATE[theme]),
          `${theme} ${hue.name}`,
        ).toBeGreaterThanOrEqual(CONTRAST_MIN.graphic);
      }
    },
  );

  it.each(["light", "dark"] as const)(
    "WNĘTRZE czyta się jako powierzchnia, nie jako element (%s)",
    (theme) => {
      // Korytarz 1,20-1,28:1 to ledwo nad kontrastem siatki (1,18:1) - i to
      // jest właściwy poziom. Wyżej wnętrze zaczyna konkurować z danymi,
      // niżej znika. Korytarz jest mierzony wobec PRAWDZIWEJ płyty motywu,
      // więc zmiana `--card` zapali ten test, zamiast po cichu przesunąć
      // wszystkie wypełnienia w silniku.
      const plate = CHART_PLATE[theme];
      for (const hue of HUES) {
        const { inner } = barFillOf(theme === "dark" ? hue.dark : hue.light, theme);
        const c = contrastRatio(inner, plate);
        expect(c, `${theme} ${hue.name}`).toBeGreaterThanOrEqual(INNER_CONTRAST_RANGE.min);
        expect(c, `${theme} ${hue.name}`).toBeLessThanOrEqual(INNER_CONTRAST_RANGE.max);
      }
    },
  );

  it.each(["light", "dark"] as const)(
    "HOVER jest wyczuwalny, ale nie zmienia wagi wizualnej wykresu (%s)",
    (theme) => {
      const plate = CHART_PLATE[theme];
      for (const hue of HUES) {
        const { inner, hover } = barFillOf(theme === "dark" ? hue.dark : hue.light, theme);
        const abs = contrastRatio(hover, plate);
        const step = contrastRatio(hover, inner);
        expect(abs, `${theme} ${hue.name} bezwzgl.`).toBeGreaterThanOrEqual(
          HOVER_CONTRAST_RANGE.min,
        );
        expect(abs, `${theme} ${hue.name} bezwzgl.`).toBeLessThanOrEqual(HOVER_CONTRAST_RANGE.max);
        expect(step, `${theme} ${hue.name} skok`).toBeGreaterThanOrEqual(HOVER_STEP_RANGE.min);
        expect(step, `${theme} ${hue.name} skok`).toBeLessThanOrEqual(HOVER_STEP_RANGE.max);
      }
    },
  );

  it.each(["light", "dark"] as const)(
    "rampa gradientu NIE DOSIĘGA tokena - krawędź odcina się także na końcu danych (%s)",
    (theme) => {
      // Gdyby rampa dochodziła do tokena, obwódka w czystym tokenie zlewałaby
      // się z licem i słupek traciłby ostrą pozycję końca dokładnie tam, gdzie
      // się ją odczytuje. Krok token/lico to widoczność krawędzi w najtrudniejszym
      // miejscu; specyfikacja podaje 1,135-1,158 na jasnym i 1,126-1,152 na ciemnym.
      for (const hue of HUES) {
        const base = theme === "dark" ? hue.dark : hue.light;
        const { face, deep, mid } = barFillOf(base, theme);
        const step = contrastRatio(base, face);
        // Zakres ze specyfikacji obowiązuje jej WŁASNE odcienie: sześć serii
        // plus semantyka. Sloty rozszerzenia są udokumentowanym dodatkiem tego
        // repozytorium i przy tej samej formule lądują nieco niżej, bo ich
        // jasność bazowa jest inna. Pilnujemy więc zakresu specyfikacji tam,
        // gdzie on obowiązuje, i osobnej podłogi widoczności krawędzi dla
        // rozszerzenia - zamiast rozszerzać zakres i przestać pilnować
        // czegokolwiek. Warunek czytamy z `cvdSafe`, a nie z listy numerów,
        // żeby dopisanie slotu nie wymagało poprawki w dwóch miejscach.
        const extension = CHART_SLOTS.some((s) => String(s.slot) === hue.name && !s.cvdSafe);
        expect(step, `${theme} ${hue.name}`).toBeGreaterThanOrEqual(
          extension ? 1.11 : EDGE_FACE_RANGE.min,
        );
        expect(step, `${theme} ${hue.name}`).toBeLessThanOrEqual(EDGE_FACE_RANGE.max);
        // Rampa idzie monotonicznie OD krawędzi odniesienia DO końca danych,
        // zawsze odchodząc od tła: na jasnym ciemnieje, na ciemnym rozjaśnia.
        const l = [deep, mid, face].map((h) => oklchOf(h).l);
        if (theme === "light") {
          expect(l[0], `${theme} ${hue.name}`).toBeLessThan(l[1]);
          expect(l[1], `${theme} ${hue.name}`).toBeLessThan(l[2]);
        } else {
          expect(l[0], `${theme} ${hue.name}`).toBeGreaterThan(l[1]);
          expect(l[1], `${theme} ${hue.name}`).toBeGreaterThan(l[2]);
        }
      }
    },
  );

  it("krok jasności obwódki ODCHODZI od tła w obu motywach", () => {
    // Literalne "ciemniejsza w obu trybach" nie zadziała: na ciemnym tle
    // ciemniejsza krawędź idzie W STRONĘ tła i przestaje być krawędzią.
    expect(BAR_FILL_PARAMS.light.dlEdge).toBeLessThan(0);
    expect(BAR_FILL_PARAMS.dark.dlEdge).toBeGreaterThan(0);
    expect(BAR_FILL_PARAMS.light.dlEdge).toBe(-BAR_FILL_PARAMS.dark.dlEdge);
  });

  it("obwódka jest CIEŃSZA na ciemnym - jasna linia optycznie grubieje", () => {
    expect(BAR_FILL_PARAMS.dark.edgeWidth).toBeLessThan(BAR_FILL_PARAMS.light.edgeWidth);
    expect(numberToken(LIGHT_BLOCK, "--chart-bar-edge")).toBe(BAR_FILL_PARAMS.light.edgeWidth);
    expect(numberToken(DARK_BLOCK, "--chart-bar-edge")).toBe(BAR_FILL_PARAMS.dark.edgeWidth);
  });

  it("BLADE WNĘTRZE NIE NIESIE TOŻSAMOŚCI SERII - i to jest udokumentowane, nie przypadek", () => {
    // Ta asercja jest ostrzeżeniem zapisanym w wykonywalnej formie. Przy
    // jasności 0,93 wszystkie odcienie zbiegają się praktycznie do jednego.
    // Próg 8 nie jest okrągłą liczbą z sufitu: to dolna granica, przy której
    // para kategorialna w ogóle daje się rozróżnić, i to wyłącznie z drugim
    // nośnikiem różnicy. Blade wnętrza siedzą POD nią, więc wariant blady
    // jest doskonały przy JEDNEJ serii (tożsamość niesie obwódka), a przy
    // słupkach grupowanych wymaga etykiety bezpośredniej albo wariantu
    // solidnego.
    const inners = CHART_SLOTS.slice(0, CATEGORICAL_SAFE_MAX).map(
      (s) => barFillOf(s.light, "light").inner,
    );
    let min = Infinity;
    for (let i = 0; i < inners.length; i++)
      for (let j = i + 1; j < inners.length; j++)
        min = Math.min(min, deltaE76(inners[i], inners[j]));
    expect(min).toBeLessThan(8);
    // Dla kontrastu: same tokeny są rozdzielne z dużym zapasem. Próg 20 to
    // dwa i pół raza granica rozróżnialności pary kategorialnej - czyli ta
    // sama miara co wyżej, tylko po jej drugiej stronie. Krotność zamiast
    // wartości bezwzględnej nie zadziała: obie liczby ruszają się przy każdej
    // zmianie palety i test mówiłby wtedy o ich stosunku, a nie o tym, czy
    // kolor niesie kategorię.
    const tokens = CHART_SLOTS.slice(0, CATEGORICAL_SAFE_MAX).map((s) => s.light);
    let minTok = Infinity;
    for (let i = 0; i < tokens.length; i++)
      for (let j = i + 1; j < tokens.length; j++)
        minTok = Math.min(minTok, deltaE76(tokens[i], tokens[j]));
    expect(minTok).toBeGreaterThan(20);
  });

  it("mapowanie do gamutu obniża CHROMĘ, a nie przesuwa odcienia", () => {
    // Gdyby wychodziło przez przycięcie kanałów, seria po zmianie jasności
    // przestawałaby być tą samą serią - a reguła trybów mówi, że ten sam
    // szereg zachowuje ten sam odcień (odchylenie do 9 stopni).
    for (const s of CHART_SLOTS.slice(0, CATEGORICAL_SAFE_MAX)) {
      const { l, c, h } = oklchOf(s.light);
      const pushed = oklchOf(fromOklch(Math.min(0.99, l + 0.4), c, h));
      const delta = Math.abs(((pushed.h - h + 540) % 360) - 180);
      expect(delta, `slot ${s.slot}`).toBeLessThanOrEqual(9);
      expect(pushed.c, `slot ${s.slot}`).toBeLessThanOrEqual(c + 1e-6);
    }
  });
});

describe("palette - DRUGA POWIERZCHNIA SEKCYJNA i furtki audytowe akcentu", () => {
  // Reguła "serie nie leżą na drugim tle" nie jest przekonaniem - wynika
  // z liczb, więc liczby stoją w bramce. Gdy któryś odcień serii się zmieni,
  // ten test każe wrócić do reguły, zamiast pozwolić jej cicho skłamać.
  it("arkusz podaje drugą powierzchnię w OBU motywach, a w ciemnym równą tłu", () => {
    expect(hexToken(LIGHT_BLOCK, "--chart-surface-2")).toBe(CHART_SURFACES.secondLight);
    expect(hexToken(DARK_BLOCK, "--chart-surface-2")).toBe(CHART_SURFACES.secondDark);
    // W ciemnym drugiego tła NIE MA: token jest równy tłu strony, bo pod
    // #141313 nie ma już miejsca na ciemniejszy stopień, który nie zjadłby
    // różnicy wobec płyty #0f0f0f.
    expect(CHART_SURFACES.secondDark).toBe(CHART_SURFACES.pageDark);
    expect(contrastRatio(CHART_SURFACES.pageDark, CHART_PLATE.dark)).toBeLessThan(1.15);
  });

  it("druga powierzchnia jest o 1,14:1 ciemniejsza od tła strony", () => {
    const r = contrastRatio(CHART_SURFACES.secondLight, CHART_SURFACES.pageLight);
    expect(r).toBeGreaterThan(1.1);
    expect(r).toBeLessThan(1.2);
  });

  it("DOKŁADNIE wypisane sloty spadają pod próg grafiki na drugiej powierzchni", () => {
    // Ochra 2,48:1, szałwia 2,76:1, lazur 2,97:1 - i to jest cały powód,
    // dla którego płyta wykresu zostaje biała także w sekcji na drugim tle.
    const unsafe = CHART_SLOTS.filter(
      (slot) => contrastRatio(slot.light, CHART_SURFACES.secondLight) < CONTRAST_MIN.graphic,
    ).map((slot) => slot.slot);
    expect(unsafe).toEqual([...SLOTS_UNSAFE_ON_SURFACE_2]);
    // Reszta slotów przechodzi - reguła dotyczy trzech odcieni, nie palety.
    for (const slot of CHART_SLOTS.filter((s) => !SLOTS_UNSAFE_ON_SURFACE_2.includes(s.slot))) {
      const r = contrastRatio(slot.light, CHART_SURFACES.secondLight);
      expect(r, `slot ${slot.slot}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        CONTRAST_MIN.graphic,
      );
    }
  });

  it("czerwień UJEMNA też spada pod próg na drugiej powierzchni", () => {
    // Spec o niej nie mówi, ale to ten sam defekt: 2,81:1. Semantyka znaku nie
    // jest slotem kategorialnym, więc nie mieści się w liście slotów - i tym
    // bardziej musi być wypisana, bo wykres kodujący znak kolorem straciłby na
    // drugim tle właśnie ten kolor.
    const r = contrastRatio(CHART_SEMANTIC.negativeLight, CHART_SURFACES.secondLight);
    expect(r).toBeLessThan(CONTRAST_MIN.graphic);
    expect(r).toBeGreaterThan(2.5);
  });

  it("furtki audytowe akcentu trafiają w SWOJE progi, każda w swój", () => {
    // Dwa warianty, bo dwa różne progi. Mierzone na tle strony, czyli na
    // najgorszej jasnej powierzchni, na której akcent jako tekst wolno
    // postawić - na płycie oba mają jeszcze więcej zapasu.
    expect(ACCENT_AUDIT.graphic).toBe(hexToken(LIGHT_BLOCK, "--chart-accent-audit-graphic"));
    expect(ACCENT_AUDIT.text).toBe(hexToken(LIGHT_BLOCK, "--chart-accent-audit"));
    expect(contrastRatio(ACCENT_AUDIT.graphic, CHART_SURFACES.pageLight)).toBeGreaterThanOrEqual(
      CONTRAST_MIN.graphic,
    );
    expect(contrastRatio(ACCENT_AUDIT.text, CHART_SURFACES.pageLight)).toBeGreaterThanOrEqual(
      CONTRAST_MIN.text,
    );
    // Wariant grafiki NIE udaje, że przechodzi próg tekstowy.
    expect(contrastRatio(ACCENT_AUDIT.graphic, CHART_SURFACES.pageLight)).toBeLessThan(
      CONTRAST_MIN.text,
    );
  });

  it("OBA warianty audytowe zawodzą na drugiej powierzchni - ta sama reguła", () => {
    expect(contrastRatio(ACCENT_AUDIT.graphic, CHART_SURFACES.secondLight)).toBeLessThan(
      CONTRAST_MIN.graphic,
    );
    expect(contrastRatio(ACCENT_AUDIT.text, CHART_SURFACES.secondLight)).toBeLessThan(
      CONTRAST_MIN.text,
    );
  });

  it("w motywie CIEMNYM akcent nie potrzebuje furtki, więc jej nie udaje", () => {
    // Furtka ma tu wartość tokena właśnie dlatego, że jest niepotrzebna,
    // i to trzeba przypiąć - inaczej ktoś "poprawi" ją na wartość z motywu
    // jasnego i POGORSZY kontrast. Kierunek wyprowadzania wariantu jest
    // w ciemnym trybie odwrotny: przyciemnianie idzie w stronę tła, więc to,
    // co na jasnym tle było naprawą, tutaj jest psuciem.
    const accent = hexToken(DARK_BLOCK, "--chart-accent");
    expect(hexToken(DARK_BLOCK, "--chart-accent-audit")).toBe(accent);
    expect(hexToken(DARK_BLOCK, "--chart-accent-audit-graphic")).toBe(accent);
    expect(contrastRatio(accent, CHART_PLATE.dark)).toBeGreaterThanOrEqual(CONTRAST_MIN.text);
    // Wersja z motywu jasnego jest na ciemnej płycie ponad dwa razy słabsza -
    // i to jest liczba, dla której ten token nie jest przepisany między
    // motywami.
    expect(contrastRatio(ACCENT_AUDIT.text, CHART_PLATE.dark)).toBeLessThan(
      contrastRatio(accent, CHART_PLATE.dark) / 2,
    );
  });

  it("PODKŁAD AKCENTU nie wyznacza powierzchni na tle strony - stąd obramowanie", () => {
    // 1,003:1, czyli identyczna jasność przy różnicy samego odcienia. Granica,
    // której nie ma w skali szarości ani w druku, nie jest granicą - dlatego
    // klasa `.neh-accent-bg` wiąże podkład z obramowaniem 1 px w wariancie
    // audytowym grafiki (3,29:1 na samym podkładzie).
    const bg = hexToken(LIGHT_BLOCK, "--chart-accent-bg");
    expect(contrastRatio(bg, CHART_SURFACES.pageLight)).toBeLessThan(1.01);
    expect(contrastRatio(ACCENT_AUDIT.graphic, bg)).toBeGreaterThanOrEqual(CONTRAST_MIN.graphic);
    // Jaśniejszy token wypełnienia granicy NIE uniesie - 1,67:1.
    expect(
      contrastRatio(hexToken(LIGHT_BLOCK, "--chart-accent-fill"), CHART_SURFACES.pageLight),
    ).toBeLessThan(2);
  });
});

describe("palette - RAMP SEKWENCYJNY mapy", () => {
  // Mapa koduje wartość przez `color-mix()` na tokenach, ale w silnikach bez
  // `color-mix()` w atrybucie `fill` ląduje kolor interpolowany w JS - i te
  // dwa hexy muszą być TĄ SAMĄ parą, co w arkuszu. Trzymane w komponencie
  // rozjechały się: arkusz miał #e0eaf2/#00375f, a fallback #cde2fb/#0d366b.
  // Nikt tego nie widział, bo nowa przeglądarka nigdy tej gałęzi nie wykonuje
  // - dokładnie ten rodzaj defektu, którego nie znajdzie żaden test
  // renderujący, a znajdzie porównanie z arkuszem.
  it("kotwice rampu są TE SAME co w arkuszu, w obu motywach", () => {
    expect(SEQ_RAMP.light.min).toBe(hexToken(LIGHT_BLOCK, "--chart-seq-min"));
    expect(SEQ_RAMP.light.max).toBe(hexToken(LIGHT_BLOCK, "--chart-seq-max"));
    expect(SEQ_RAMP.dark.min).toBe(hexToken(DARK_BLOCK, "--chart-seq-min"));
    expect(SEQ_RAMP.dark.max).toBe(hexToken(DARK_BLOCK, "--chart-seq-max"));
  });

  it("ramp jest ODWRÓCONY w motywie ciemnym - jedna para nie wystarcza", () => {
    // Jasny: minimum jaśniejsze od maksimum. Ciemny: odwrotnie. Użycie pary
    // jasnej na ciemnej karcie dawałoby najniższą wartość świecącą (~11:1),
    // a najwyższą poniżej progu 3:1 dla obiektu graficznego.
    expect(relativeLuminance(SEQ_RAMP.light.min)).toBeGreaterThan(
      relativeLuminance(SEQ_RAMP.light.max),
    );
    expect(relativeLuminance(SEQ_RAMP.dark.min)).toBeLessThan(relativeLuminance(SEQ_RAMP.dark.max));
  });

  it("oba końce rampu są widoczne na płycie SWOJEGO motywu", () => {
    // Koniec maksymalny niesie wartość szczytową i musi przejść próg grafiki;
    // koniec minimalny ma tylko odróżnić się od kraju BEZ danych, więc jego
    // progu nie stawiamy - stąd kotwica 0,15 w komponencie mapy.
    expect(contrastRatio(SEQ_RAMP.light.max, CHART_PLATE.light)).toBeGreaterThanOrEqual(
      CONTRAST_MIN.graphic,
    );
    expect(contrastRatio(SEQ_RAMP.dark.max, CHART_PLATE.dark)).toBeGreaterThanOrEqual(
      CONTRAST_MIN.graphic,
    );
  });
});
