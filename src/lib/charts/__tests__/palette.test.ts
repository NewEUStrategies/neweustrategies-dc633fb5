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
import { mapScale } from "@/lib/charts/kinds/mapScale";
import {
  CATEGORICAL_SAFE_SERIES,
  MAP_CLASSES_MAX,
  MAP_CLASSES_MIN,
  MAP_SCHEMES,
  MAP_SEQUENTIAL_SCHEMES,
  MAX_COLOR_SLOT,
  MAX_SERIES,
  type MapScheme,
} from "@/lib/charts/types";
import {
  BRAND_ORANGE_HUE,
  colorMixOklab,
  MAP_ACCENT_HUE,
  MAP_ADJACENT_CLASS_DL_MIN,
  MAP_DIV_MID_NODATA_DL_MIN,
  MAP_DIVERGING_CVD_MIN,
  MAP_HUE_CHROMA_FLOOR,
  MAP_HUE_EXCLUDED,
  MAP_NEUTRALS,
  MAP_NODATA_CONTRAST_MIN,
  MAP_NON_ACCENT_HUE_EXCLUDED,
  MAP_PLATE_CONTRAST_MIN,
  MAP_RAMPS,
  oklabOf,
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
  CATEGORICAL_EXTENDED_MAX,
  HUE_PARITY_EXCEPTIONS,
  SLOTS_NEEDING_EDGE_FOR_SHAPE,
  SLOTS_WITH_COMPRESSED_RAMP,
  SLOT_SEQUENCE,
} from "@/lib/charts/palette";

// ---------------------------------------------------------------------------
// Odczyt tokenów z arkusza - ten sam sposób cięcia bloków, co w
// `src/components/charts/__tests__/pieChart.test.tsx`, żeby oba testy patrzyły
// na dokładnie te same napisy.
// ---------------------------------------------------------------------------
const css = ["src/styles.css", "src/components/charts/charts.css"]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const LIGHT_BLOCK = css.slice(css.indexOf(":root,"), css.indexOf(".dark {"));
const DARK_BLOCK = css.slice(css.indexOf(".dark {"), css.indexOf("@layer base"));
// Tokeny druku są w arkuszu wykresów dołączanym przez styles.css. W złożonym
// źródle niżej mają własny zakres, osobny od tokenów jasnych i ciemnych.
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
    // Zestaw mierzony to PIERWSZE SZEŚĆ POZYCJI SEKWENCJI, a nie sloty 1..6:
    // po podmianie kolorów te dwie rzeczy przestały być tym samym.
    const bezpieczne = SLOT_SEQUENCE.slice(0, CATEGORICAL_SAFE_MAX).map((s) => slotAt(s));
    const light = bezpieczne.map((s) => s.light);
    expect(minPairwiseCvdDistance(light, "deutan")?.distance).toBeCloseTo(21.21, 1);
    expect(minPairwiseCvdDistance(light, "protan")?.distance).toBeCloseTo(25.08, 1);
    expect(minPairwiseCvdDistance(light, "tritan")?.distance).toBeCloseTo(16.77, 1);

    const dark = bezpieczne.map((s) => s.dark);
    expect(minPairwiseCvdDistance(dark, "deutan")?.distance).toBeCloseTo(23.86, 1);
    expect(minPairwiseCvdDistance(dark, "protan")?.distance).toBeCloseTo(30.39, 1);
    expect(minPairwiseCvdDistance(dark, "tritan")?.distance).toBeCloseTo(20.85, 1);
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
  it("każdy slot NIESIE KSZTAŁT na płycie swojego motywu - sam albo obwódką", () => {
    // Reguła ma DWA wejścia, i to nie jest rozluźnienie progu, tylko opisanie
    // tego, co naprawdę niesie kształt. Wypełnienie w kolorze marki bywa pod
    // progiem (#FA9346 ma 2,25:1 na białej płycie) i nie wolno go podmienić,
    // bo po to jest kolorem marki. Kształt niesie wtedy obwódka, a `barFillOf`
    // dociąga ją do progu niezależnie od tego, ile kroków jasności to wymaga.
    // Warunek jest więc taki: ALBO wypełnienie przechodzi samo, ALBO slot jest
    // wypisany jako wymagający obwódki - i wtedy obwódka MUSI przejść.
    for (const theme of ["light", "dark"] as const) {
      const wymagaObwodki = SLOTS_NEEDING_EDGE_FOR_SHAPE[theme];
      for (const slot of CHART_SLOTS) {
        const base = theme === "dark" ? slot.dark : slot.light;
        const r = contrastRatio(base, CHART_PLATE[theme]);
        const naLiscie = wymagaObwodki.includes(slot.slot);
        // Lista jest LICZONA: slot pod progiem musi być na niej, a slot nad
        // progiem nie może - inaczej lista jest notatką, a nie faktem.
        expect(naLiscie, `${theme} ${slot.key}: ${r.toFixed(2)}:1`).toBe(r < CONTRAST_MIN.graphic);
        const obwodka = contrastRatio(barFillOf(base, theme).edge, CHART_PLATE[theme]);
        expect(
          obwodka,
          `${theme} ${slot.key} obwódka: ${obwodka.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(CONTRAST_MIN.graphic);
      }
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
  it("zestaw BEZPIECZNY (sześć pierwszych pozycji sekwencji) trzyma podłogę", () => {
    for (const theme of ["light", "dark"] as const) {
      const hexes = SLOT_SEQUENCE.slice(0, CATEGORICAL_SAFE_MAX).map((n) =>
        theme === "dark" ? slotAt(n).dark : slotAt(n).light,
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

  it("zestaw ROZSZERZONY (osiem pierwszych pozycji) trzyma własną, NIŻSZĄ podłogę", () => {
    // Ten próg mówi wprost, ile realnie zostaje po sześciu bezpiecznych, żeby
    // nikt nie wziął pozycji 7-8 za bezpieczne. Sloty poza zestawem
    // bezpiecznym dostają w silniku kreskowanie jako drugi nośnik różnicy.
    for (const theme of ["light", "dark"] as const) {
      const hexes = SLOT_SEQUENCE.slice(0, CATEGORICAL_EXTENDED_MAX).map((n) =>
        theme === "dark" ? slotAt(n).dark : slotAt(n).light,
      );
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
    const bezpieczne = new Set(SLOT_SEQUENCE.slice(0, CATEGORICAL_SAFE_MAX));
    for (const slot of CHART_SLOTS) {
      expect(slot.cvdSafe, slot.key).toBe(bezpieczne.has(slot.slot));
      expect(needsPatternDifferentiator(slot.slot), slot.key).toBe(!bezpieczne.has(slot.slot));
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

describe("palette - KOLORY MARKI są w palecie, co do hexa", () => {
  // Ta bramka nie mierzy niczego - pilnuje ZGODNOŚCI Z ZAMÓWIENIEM. Cała
  // reszta pliku sprawdza, czy paleta trzyma progi; to sprawdza, czy trzyma
  // kolory, które dostała. Bez niej zmiękczenie, przeliczenie albo poprawka
  // korytarza mogłyby po cichu przesunąć hex marki o kilka jednostek i żaden
  // inny test by tego nie zauważył, bo wszystkie progi dalej by przechodziły.
  const ZADANE_JASNE = [
    "#03346e",
    "#FA9346",
    "#8c56d4",
    "#2bbbd7",
    "#bb8760",
    "#607456",
    "#7b2525",
    "#232c31",
    "#cd393b",
    "#15334d",
    "#6929c4",
    "#f7dd14",
    "#7f2020",
    "#6d9e51",
    "#ed985f",
    "#9cc6db",
    "#c95792",
    "#e50046",
    "#ffdab3",
    "#d4bdac",
    "#dca47c",
    "#b80000",
    "#ff788d",
  ];
  const ZADANE_CIEMNE = [
    "#2196f3",
    "#fa9346",
    "#76c457",
    "#e7bcde",
    "#92eeff",
    "#ca7842",
    "#8b9a6e",
    "#ba6a4c",
    "#e1b076",
    "#b281f7",
    "#fff07d",
    "#b5e18b",
    "#f7b980",
    "#9cc6db",
    "#ffdab3",
    "#ff9a9a",
    "#e50046",
    "#d4bdac",
    "#ffd3b6",
    "#b80000",
    "#ff9d9d",
  ];

  it("każdy zadany odcień JASNY stoi w palecie jako wartość jasna", () => {
    const jasne = new Set(CHART_SLOTS.map((s) => s.light.toLowerCase()));
    for (const hex of ZADANE_JASNE) expect(jasne.has(hex.toLowerCase()), hex).toBe(true);
  });

  it("każdy zadany odcień CIEMNY stoi w palecie jako wartość ciemna", () => {
    const ciemne = new Set(CHART_SLOTS.map((s) => s.dark.toLowerCase()));
    for (const hex of ZADANE_CIEMNE) expect(ciemne.has(hex), hex).toBe(true);
  });

  it("żaden odcień PODMIENIONY nie został w palecie", () => {
    // Podmiana, po której stary odcień gdzieś jeszcze siedzi, jest podmianą
    // wykonaną w połowie - a połowa jest tu gorsza od zera, bo wykres
    // pokazywałby dwa pokolenia palety naraz.
    const wszystkie = new Set(
      CHART_SLOTS.flatMap((s) => [s.light.toLowerCase(), s.dark.toLowerCase()]),
    );
    for (const hex of [
      "#ccc69b",
      "#9ac5af",
      "#449eef",
      "#01538a",
      "#bb8b4d",
      "#e1af73",
      "#a587a4",
      "#7a5b79",
      "#11a0c4",
      "#51cef6",
      "#a8583c",
      "#b97b64",
      "#646e1c",
      "#936869",
      "#b28485",
    ])
      expect(wszystkie.has(hex), hex).toBe(false);
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
  it("MAX_COLOR_SLOT równa się liczbie slotów, a MAX_SERIES nie jest już tym samym", () => {
    // Gdyby najwyższy dopuszczalny numer slotu rozjechał się z paletą, parser
    // przyjąłby slot bez tokenu - a brak tokenu to czarne wypełnienie albo
    // niewidoczna kreska, po cichu.
    expect(CHART_SLOTS).toHaveLength(MAX_COLOR_SLOT);
    expect(CHART_SLOTS.map((s) => s.slot)).toEqual(
      Array.from({ length: MAX_COLOR_SLOT }, (_, i) => i + 1),
    );
    // A LICZBA SERII to osobna decyzja i ma być NIE WIĘKSZA: dwadzieścia siedem
    // kolorów w palecie nie znaczy, że wykres o dwudziestu siedmiu seriach da
    // się odczytać.
    expect(MAX_SERIES).toBeLessThanOrEqual(MAX_COLOR_SLOT);
    // Sekwencja przypisania musi pokrywać CAŁĄ paletę i nie powtarzać slotu,
    // inaczej któryś kolor byłby nieosiągalny albo dwie serie dostałyby ten sam.
    expect([...SLOT_SEQUENCE].sort((a, b) => a - b)).toEqual(CHART_SLOTS.map((s) => s.slot));
    // Próg porady dla autora i próg palety to DWIE KOPIE tej samej liczby
    // w dwóch modułach. Rozjazd znaczyłby, że edytor ostrzega przy innej
    // liczbie serii, niż przy której kolor faktycznie przestaje nieść kategorię.
    expect(CATEGORICAL_SAFE_SERIES).toBe(CATEGORICAL_SAFE_MAX);
    expect(CATEGORICAL_EXTENDED_MAX).toBeGreaterThan(CATEGORICAL_SAFE_MAX);
    expect(CATEGORICAL_EXTENDED_MAX).toBeLessThanOrEqual(SLOT_SEQUENCE.length);
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
    // Cztery sloty są od tej reguły ODSTĘPSTWEM WPISANYM, nie wyłączeniem:
    // obie wartości pary zostały zadane wprost jako kolory marki, więc
    // przesunięcie jest ich własnością, a nie błędem wyprowadzenia. Bramka
    // pilnuje, żeby lista odstępstw była DOKŁADNA w obie strony i żeby żadne
    // z nich nie urosło ponad zapisaną wartość.
    for (const slot of CHART_SLOTS) {
      const delta = Math.abs(hueOf(slot.light) - hueOf(slot.dark));
      const shortest = Math.min(delta, 360 - delta);
      const wyjatek = HUE_PARITY_EXCEPTIONS[slot.slot];
      if (wyjatek === undefined) {
        expect(shortest, `${slot.key}: ${shortest.toFixed(1)} st.`).toBeLessThanOrEqual(10);
      } else {
        expect(shortest, `${slot.key} (odstępstwo): ${shortest.toFixed(1)} st.`).toBeGreaterThan(
          10,
        );
        expect(shortest, `${slot.key} (odstępstwo urosło)`).toBeLessThanOrEqual(wyjatek + 0.1);
      }
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
        // Korytarz obowiązuje wszędzie POZA slotami, którym gamut ścisnął
        // rampę - tam monotoniczność zostaje, a krok jest tym, co zostało.
        const sciety = SLOTS_WITH_COMPRESSED_RAMP[theme].some((n) => String(n) === hue.name);
        expect(sciety, `${theme} ${hue.name}: krok ${step.toFixed(3)}`).toBe(
          step < EDGE_FACE_RANGE.min,
        );
        if (!sciety) {
          expect(step, `${theme} ${hue.name}`).toBeGreaterThanOrEqual(EDGE_FACE_RANGE.min);
          expect(step, `${theme} ${hue.name}`).toBeLessThanOrEqual(EDGE_FACE_RANGE.max);
        }
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
    // Token wypełnienia granicy NIE uniesie - pozostaje poniżej progu 3:1.
    expect(
      contrastRatio(hexToken(LIGHT_BLOCK, "--chart-accent-fill"), CHART_SURFACES.pageLight),
    ).toBeLessThan(CONTRAST_MIN.graphic);
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

// ---------------------------------------------------------------------------
// RAMPY MAPY DO WYBORU, KOLOR „BRAK DANYCH" i ŚRODEK RAMPU ROZBIEŻNEGO.
//
// Ta sama zasada co wyżej - arkusz i moduł co do hexa, w obu motywach
// i w druku - plus warunki, które dla mapy z wyborem rampu są nowe: żadna
// rampa nie leży w bursztynie ani żółci (także w mieszaninach między
// końcami, bo to one malują klasy), kraj bez danych nie zrównuje się
// luminancją z pierwszą klasą żadnej rampy, a końce rampu rozbieżnego są
// rozdzielne dla daltonizmu.
// ---------------------------------------------------------------------------

// Blok druku liczony tak, jak w bramce ról: od OSTATNIEGO `@media print`
// przed regułą tokenów druku wykresu, a nie od pierwszego w arkuszu.
const CHART_PRINT_BLOCK = css.slice(
  css.lastIndexOf("@media print", css.indexOf(".dark .neh-chart,")),
);

/** Próbki rampu co 5% - te same mieszaniny, które `color-mix()` daje klasom. */
function rampSamples(min: string, max: string): string[] {
  return Array.from({ length: 21 }, (_, i) => colorMixOklab(max, i * 5, min));
}

/** Czy odcień jest widzialny jako odcień i leży w paśmie zakazanym. */
function inExcludedHue(hex: string): boolean {
  const { c, h } = oklchOf(hex);
  return c >= MAP_HUE_CHROMA_FLOOR && h >= MAP_HUE_EXCLUDED.from && h <= MAP_HUE_EXCLUDED.to;
}

const MAP_THEMES = [
  ["jasny", "light", LIGHT_BLOCK] as const,
  ["ciemny", "dark", DARK_BLOCK] as const,
];

const SIGN = {
  light: { neg: CHART_SEMANTIC.negativeLight, pos: CHART_SEMANTIC.positiveLight },
  dark: { neg: CHART_SEMANTIC.negativeDark, pos: CHART_SEMANTIC.positiveDark },
} as const;

describe("palette - RAMPY MAPY: arkusz zgadza się z modułem", () => {
  it("moduł ma rampę dla KAŻDEGO schematu i żadnej więcej", () => {
    expect(Object.keys(MAP_RAMPS).sort()).toEqual([...MAP_SCHEMES].sort());
  });

  it("schematy to blue, slate, accent i diverging - bez turkusu i fioletu, także w arkuszu", () => {
    // Turkus czyta się jak --chart-positive, fiolet jak --chart-warn: rampa
    // ozdobna w tych odcieniach mówiłaby o statusie, którego mapa nie koduje.
    expect([...MAP_SCHEMES]).toEqual(["blue", "slate", "accent", "diverging"]);
    expect([...MAP_SEQUENTIAL_SCHEMES]).toEqual(["blue", "slate", "accent"]);
    expect(css).not.toMatch(/--chart-map-(teal|violet)-/);
  });

  it.each([
    ["jasny", "light", LIGHT_BLOCK] as const,
    ["ciemny", "dark", DARK_BLOCK] as const,
    ["druk", "light", CHART_PRINT_BLOCK] as const,
  ])("%s: rampa rozbieżna w module = tokeny znaku i środek z arkusza", (_n, theme, block) => {
    expect(MAP_RAMPS.diverging[theme]).toEqual({
      min: hexToken(block, "--chart-negative"),
      mid: hexToken(block, "--chart-map-div-mid"),
      max: hexToken(block, "--chart-positive"),
    });
  });

  it("`blue` jest rampą sekwencyjną SPRZED wyboru co do hexa - opublikowane mapy bez zmian", () => {
    expect(MAP_RAMPS.blue).toEqual(SEQ_RAMP);
    for (const [, theme, block] of MAP_THEMES) {
      expect(hexToken(block, "--chart-map-blue-min")).toBe(hexToken(block, "--chart-seq-min"));
      expect(hexToken(block, "--chart-map-blue-max")).toBe(hexToken(block, "--chart-seq-max"));
      expect(hexToken(block, "--chart-map-blue-max")).toBe(SEQ_RAMP[theme].max);
    }
  });

  it.each(MAP_THEMES)(
    "motyw %s: każda kotwica każdej rampy i każdy neutralny co do hexa",
    (_n, theme, block) => {
      for (const scheme of MAP_SEQUENTIAL_SCHEMES) {
        const { min, max } = MAP_RAMPS[scheme][theme];
        expect(hexToken(block, `--chart-map-${scheme}-min`), `${scheme} min`).toBe(min);
        expect(hexToken(block, `--chart-map-${scheme}-max`), `${scheme} max`).toBe(max);
      }
      const n = MAP_NEUTRALS[theme];
      expect(hexToken(block, "--chart-map-div-mid")).toBe(n.divMid);
      expect(hexToken(block, "--chart-map-nodata")).toBe(n.nodata);
      expect(hexToken(block, "--chart-map-nodata-hatch")).toBe(n.nodataHatch);
    },
  );

  it("druk odtwarza wartości JASNE rampy i neutralnych", () => {
    for (const scheme of MAP_SEQUENTIAL_SCHEMES) {
      const { min, max } = MAP_RAMPS[scheme].light;
      expect(hexToken(CHART_PRINT_BLOCK, `--chart-map-${scheme}-min`), `druk ${scheme}`).toBe(min);
      expect(hexToken(CHART_PRINT_BLOCK, `--chart-map-${scheme}-max`), `druk ${scheme}`).toBe(max);
    }
    expect(hexToken(CHART_PRINT_BLOCK, "--chart-map-div-mid")).toBe(MAP_NEUTRALS.light.divMid);
    expect(hexToken(CHART_PRINT_BLOCK, "--chart-map-nodata")).toBe(MAP_NEUTRALS.light.nodata);
    expect(hexToken(CHART_PRINT_BLOCK, "--chart-map-nodata-hatch")).toBe(
      MAP_NEUTRALS.light.nodataHatch,
    );
  });
});

describe("palette - RAMPY MAPY: progi", () => {
  it("mieszanie OKLab odtwarza końce i trzyma się między nimi", () => {
    // Bramka liczy kontrast mieszanin funkcją `colorMixOklab`, więc funkcja
    // musi zwracać końce dokładnie i nie wychodzić poza nie w jasności.
    const [a, b] = ["#00375f", "#e0eaf2"];
    expect(colorMixOklab(a, 100, b)).toBe(a);
    expect(colorMixOklab(a, 0, b)).toBe(b);
    const mid = relativeLuminance(colorMixOklab(a, 50, b));
    expect(mid).toBeGreaterThan(relativeLuminance(a));
    expect(mid).toBeLessThan(relativeLuminance(b));
  });

  it.each(MAP_THEMES)("motyw %s: koniec maksymalny KAŻDEJ rampy >= 3:1 na płycie", (_n, theme) => {
    for (const scheme of MAP_SEQUENTIAL_SCHEMES) {
      const r = contrastRatio(MAP_RAMPS[scheme][theme].max, CHART_PLATE[theme]);
      expect(r, `${scheme}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(CONTRAST_MIN.graphic);
    }
  });

  it.each(MAP_THEMES)(
    "motyw %s: rampa idzie OD płyty, monotonicznie, z rozpiętością na 7 klas",
    (_n, theme) => {
      // Rozpiętość 4:1 między końcami daje przy siedmiu klasach krok ~1,26:1
      // między sąsiednimi - poniżej tego sąsiednie klasy zlewają się w jedną.
      for (const scheme of MAP_SEQUENTIAL_SCHEMES) {
        const { min, max } = MAP_RAMPS[scheme][theme];
        expect(contrastRatio(min, max), `${scheme}: rozpiętość`).toBeGreaterThanOrEqual(4);
        const ys = rampSamples(min, max).map(relativeLuminance);
        for (let i = 1; i < ys.length; i += 1) {
          if (theme === "light") expect(ys[i], `${scheme} krok ${i}`).toBeLessThan(ys[i - 1]);
          else expect(ys[i], `${scheme} krok ${i}`).toBeGreaterThan(ys[i - 1]);
        }
      }
    },
  );

  it("pasmo zakazane jest skalibrowane: łapie bursztyn i żółć, nie łapie pomarańczu marki", () => {
    // Bez tego przypadku okno mogłoby się przesunąć tak, że nie łapie niczego,
    // a bramka niżej byłaby zielona z definicji.
    for (const hex of ["#b7791f", "#f7dd14", "#e1b076", slotAt(15).light, slotAt(27).light]) {
      expect(inExcludedHue(hex), hex).toBe(true);
    }
    for (const hex of ["#fa9346", "#ab5517", CHART_SEMANTIC.negativeLight, "#8794a4"]) {
      expect(inExcludedHue(hex), hex).toBe(false);
    }
  });

  it.each(MAP_THEMES)(
    "motyw %s: ŻADNEGO BURSZTYNU ani żółci - w kotwicach i w mieszaninach",
    (_n, theme) => {
      for (const scheme of MAP_SEQUENTIAL_SCHEMES) {
        const { min, max } = MAP_RAMPS[scheme][theme];
        for (const hex of rampSamples(min, max)) {
          const { h } = oklchOf(hex);
          expect(inExcludedHue(hex), `${scheme} ${hex} ${h.toFixed(0)}°`).toBe(false);
        }
      }
      const n = MAP_NEUTRALS[theme];
      for (const end of [SIGN[theme].neg, SIGN[theme].pos]) {
        for (const hex of rampSamples(n.divMid, end)) {
          expect(inExcludedHue(hex), `rozbieżna ${hex}`).toBe(false);
        }
      }
      for (const hex of [n.divMid, n.nodata, n.nodataHatch]) {
        expect(inExcludedHue(hex), hex).toBe(false);
      }
    },
  );

  it.each(MAP_THEMES)(
    "motyw %s: rampa `accent` leży WYŁĄCZNIE w rodzinie pomarańczu marki",
    (_n, theme) => {
      const { min, max } = MAP_RAMPS.accent[theme];
      // Koniec maksymalny to sam akcent marki albo jego wariant tekstowy.
      expect(["#fa9346", ACCENT_AUDIT.text]).toContain(max);
      for (const hex of rampSamples(min, max)) {
        const { h } = oklchOf(hex);
        expect(h, `${hex}`).toBeGreaterThanOrEqual(BRAND_ORANGE_HUE.from);
        expect(h, `${hex}`).toBeLessThanOrEqual(BRAND_ORANGE_HUE.to);
      }
    },
  );

  it.each(MAP_THEMES)(
    "motyw %s: kraj BEZ DANYCH odróżnia się od PIERWSZEJ klasy każdej rampy",
    (_n, theme) => {
      // Kreskowanie jest nośnikiem strukturalnym; ten próg jest drugim, na
      // wypadek kraju zbyt małego, żeby kreskowanie było widać. Pierwsza klasa
      // rampy sekwencyjnej to koniec minimalny, rozbieżnej - pełny ujemny.
      const { nodata, divMid } = MAP_NEUTRALS[theme];
      const pierwsze: Array<[string, string]> = [
        ...MAP_SEQUENTIAL_SCHEMES.map((s) => [s, MAP_RAMPS[s][theme].min] as [string, string]),
        ["diverging", SIGN[theme].neg],
        ["diverging (środek)", divMid],
      ];
      for (const [name, hex] of pierwsze) {
        const r = contrastRatio(hex, nodata);
        expect(r, `${name}: ${r.toFixed(3)}:1`).toBeGreaterThanOrEqual(MAP_NODATA_CONTRAST_MIN);
      }
    },
  );

  it.each(MAP_THEMES)(
    "motyw %s: brak danych leży POZA jasnością każdej rampy - nie zrówna się z żadną klasą",
    (_n, theme) => {
      // Mocniejsze niż warunek pierwszej klasy i to jest powód, dla którego
      // brak danych stoi przy płycie, a nie w środku jasności rampy: przy
      // szarości średniej zawsze któraś klasa (albo punkt skali ciągłej)
      // miałaby tę samą luminancję.
      const { nodata, divMid } = MAP_NEUTRALS[theme];
      const probki = [
        ...MAP_SEQUENTIAL_SCHEMES.flatMap((s) =>
          rampSamples(MAP_RAMPS[s][theme].min, MAP_RAMPS[s][theme].max),
        ),
        ...rampSamples(divMid, SIGN[theme].neg),
        ...rampSamples(divMid, SIGN[theme].pos),
      ];
      for (const hex of probki) {
        expect(contrastRatio(hex, nodata), hex).toBeGreaterThanOrEqual(MAP_NODATA_CONTRAST_MIN);
      }
    },
  );

  it.each(MAP_THEMES)(
    "motyw %s: kreskowanie braku danych jest widoczne na wypełnieniu i na płycie",
    (_n, theme) => {
      const { nodata, nodataHatch } = MAP_NEUTRALS[theme];
      expect(contrastRatio(nodataHatch, nodata)).toBeGreaterThanOrEqual(2);
      expect(contrastRatio(nodataHatch, CHART_PLATE[theme])).toBeGreaterThanOrEqual(2);
      // Wypełnienie jest neutralne - kolor braku danych nie może sugerować wartości.
      expect(oklchOf(nodata).c).toBeLessThan(MAP_HUE_CHROMA_FLOOR);
      expect(oklchOf(nodataHatch).c).toBeLessThan(MAP_HUE_CHROMA_FLOOR);
    },
  );

  it.each(MAP_THEMES)(
    "motyw %s: rampa rozbieżna - końce widoczne, środek neutralny, para rozdzielna dla daltonizmu",
    (_n, theme) => {
      const { neg, pos } = SIGN[theme];
      // Końce to tokeny znaku z arkusza - ta sama para, co na wykresach.
      const block = theme === "light" ? LIGHT_BLOCK : DARK_BLOCK;
      expect(hexToken(block, "--chart-negative")).toBe(neg);
      expect(hexToken(block, "--chart-positive")).toBe(pos);
      for (const end of [neg, pos]) {
        expect(contrastRatio(end, CHART_PLATE[theme])).toBeGreaterThanOrEqual(CONTRAST_MIN.graphic);
      }
      expect(oklchOf(MAP_NEUTRALS[theme].divMid).c).toBeLessThan(MAP_HUE_CHROMA_FLOOR);
      for (const kind of CVD_KINDS) {
        const d = cvdDistance(neg, pos, kind);
        expect(d, `${kind}: ${d.toFixed(1)}`).toBeGreaterThanOrEqual(MAP_DIVERGING_CVD_MIN);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// RAMPY MAPY: PROGI NA KLASACH 3..7 - jasny, ciemny i druk.
//
// Bramki wyżej patrzą na kotwice i na próbki co 5%. Te patrzą na to, co
// czytelnik dostaje naprawdę: kolory KLAS z modelu skali (`mapScale`)
// rozwiązane na tokenach arkusza danego bloku - tak, jak robi to
// przeglądarka. Rampa rozbieżna jest próbkowana w klasach symetrycznych
// wokół środka (równe przedziały), bo tylko tam położenie klasy nie zależy
// od danych.
// ---------------------------------------------------------------------------

type MapGateTheme = "light" | "dark" | "print";

const MAP_GATE_THEMES: ReadonlyArray<readonly [string, MapGateTheme]> = [
  ["jasny", "light"],
  ["ciemny", "dark"],
  ["druk", "print"],
];

function mapBlock(theme: MapGateTheme): string {
  if (theme === "dark") return DARK_BLOCK;
  return theme === "print" ? CHART_PRINT_BLOCK : LIGHT_BLOCK;
}

/** Płyta: druk to papier, czyli płyta jasna. */
function mapPlate(theme: MapGateTheme): string {
  return theme === "dark" ? CHART_PLATE.dark : CHART_PLATE.light;
}

/** Wyrażenie koloru z modelu skali rozwiązane na tokenach bloku arkusza. */
function resolveMapColor(color: string, block: string): string {
  const plain = /^var\((--[a-z0-9-]+)\)$/.exec(color);
  if (plain) return hexToken(block, plain[1]);
  const mix = /^color-mix\(in oklab, var\((--[a-z0-9-]+)\) (\d+)%, var\((--[a-z0-9-]+)\)\)$/.exec(
    color,
  );
  if (!mix) throw new Error(`nieoczekiwany kolor mapy: ${color}`);
  return colorMixOklab(hexToken(block, mix[1]), Number(mix[2]), hexToken(block, mix[3]));
}

/**
 * Kolory klas schematu przy `k` klasach, rosnąco. Sekwencyjne: k wartości
 * w równych odstępach (klasa na wartość). Rozbieżna: przedziały symetryczne
 * wokół zera, od pełnego ujemnego do pełnego dodatniego.
 */
function classHexes(scheme: MapScheme, k: number, theme: MapGateTheme): string[] {
  const s =
    scheme === "diverging"
      ? mapScale([-1, 1], scheme, k, "equal", 0)
      : mapScale(
          Array.from({ length: k }, (_, i) => i),
          scheme,
          k,
          "equal",
          null,
        );
  expect(s.classes, `${scheme} k=${k}`).toHaveLength(k);
  return s.classes.map((c) => resolveMapColor(c.color, mapBlock(theme)));
}

const CLASS_COUNTS = Array.from(
  { length: MAP_CLASSES_MAX - MAP_CLASSES_MIN + 1 },
  (_, i) => MAP_CLASSES_MIN + i,
);

describe("palette - RAMPY MAPY: progi na klasach 3..7", () => {
  it("okna odcienia są skalibrowane: bursztyn i pomarańcz marki poza rampami nieakcentowymi, czerwień znaku i lazur w nich", () => {
    const inNonAccentBand = (hex: string) => {
      const { h } = oklchOf(hex);
      return h >= MAP_NON_ACCENT_HUE_EXCLUDED.from && h <= MAP_NON_ACCENT_HUE_EXCLUDED.to;
    };
    const inAccentBand = (hex: string) =>
      Math.abs(oklchOf(hex).h - MAP_ACCENT_HUE.centre) <= MAP_ACCENT_HUE.tolerance;
    for (const hex of ["#b7791f", "#f7dd14", "#fa9346", "#ab5517"]) {
      expect(inNonAccentBand(hex), hex).toBe(true);
    }
    for (const hex of [CHART_SEMANTIC.negativeLight, CHART_SEMANTIC.positiveLight, "#00375f"]) {
      expect(inNonAccentBand(hex), hex).toBe(false);
    }
    for (const hex of ["#fa9346", "#ab5517"]) expect(inAccentBand(hex), hex).toBe(true);
    for (const hex of ["#b7791f", CHART_SEMANTIC.negativeLight]) {
      expect(inAccentBand(hex), hex).toBe(false);
    }
    // Okno wewnętrzne rodziny marki mieści się w tolerancji klas.
    expect(BRAND_ORANGE_HUE.from).toBeGreaterThanOrEqual(
      MAP_ACCENT_HUE.centre - MAP_ACCENT_HUE.tolerance,
    );
    expect(BRAND_ORANGE_HUE.to).toBeLessThanOrEqual(
      MAP_ACCENT_HUE.centre + MAP_ACCENT_HUE.tolerance,
    );
  });

  it.each(MAP_GATE_THEMES)(
    "%s: odcień klas - `accent` w 54° +/- 10°, pozostałe poza 30°-110° (tylko przy chromie >= 0,03)",
    (_n, theme) => {
      for (const scheme of MAP_SCHEMES) {
        for (const k of CLASS_COUNTS) {
          for (const hex of classHexes(scheme, k, theme)) {
            const { c, h } = oklchOf(hex);
            // Poniżej progu chromy kolor jest szarością, a jego kąt - szumem.
            if (c < MAP_HUE_CHROMA_FLOOR) continue;
            const label = `${scheme} k=${k} ${hex} ${h.toFixed(1)}°`;
            if (scheme === "accent") {
              expect(Math.abs(h - MAP_ACCENT_HUE.centre), label).toBeLessThanOrEqual(
                MAP_ACCENT_HUE.tolerance,
              );
            } else {
              const inside =
                h >= MAP_NON_ACCENT_HUE_EXCLUDED.from && h <= MAP_NON_ACCENT_HUE_EXCLUDED.to;
              expect(inside, label).toBe(false);
            }
          }
        }
      }
    },
  );

  it.each(MAP_GATE_THEMES)(
    "%s: sąsiednie klasy różnią się jasnością OKLab o >= 0,04 (także przy 7 klasach)",
    (_n, theme) => {
      for (const scheme of MAP_SCHEMES) {
        for (const k of CLASS_COUNTS) {
          const labs = classHexes(scheme, k, theme).map((hex) => oklabOf(hex));
          for (let i = 1; i < labs.length; i += 1) {
            const [p, q] = [labs[i - 1], labs[i]];
            const label = `${scheme} k=${k} klasy ${i - 1}/${i}`;
            // Przy PARZYSTEJ liczbie klas rozbieżnych dwie środkowe leżą po
            // przeciwnych stronach punktu środkowego, w tej samej odległości
            // od niego - więc z definicji mają podobną jasność, a różni je
            // ZNAK, czyli odcień (czerwień wobec lazuru). Dla tej jednej pary
            // próg dotyczy pełnej odległości OKLab, nie samej jasności.
            const straddle = scheme === "diverging" && k % 2 === 0 && i === k / 2;
            const d = straddle ? Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b) : Math.abs(p.l - q.l);
            expect(d, `${label}: ${d.toFixed(3)}`).toBeGreaterThanOrEqual(
              MAP_ADJACENT_CLASS_DL_MIN,
            );
          }
        }
      }
    },
  );

  it.each(MAP_GATE_THEMES)("%s: klasa skrajna >= 3:1 na płycie", (_n, theme) => {
    for (const scheme of MAP_SCHEMES) {
      for (const k of CLASS_COUNTS) {
        const hexes = classHexes(scheme, k, theme);
        // Rampa rozbieżna ma DWA końce pełne - oba muszą być widoczne.
        const ends =
          scheme === "diverging" ? [hexes[0], hexes[hexes.length - 1]] : [hexes[hexes.length - 1]];
        for (const hex of ends) {
          const r = contrastRatio(hex, mapPlate(theme));
          expect(r, `${scheme} k=${k} ${hex}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(
            CONTRAST_MIN.graphic,
          );
        }
      }
    }
  });

  it.each(MAP_GATE_THEMES)(
    "%s: KAŻDA klasa (więc i pierwsza) odróżnia się od płyty o >= 1,15:1 - granice krajów to płyta",
    (_n, theme) => {
      for (const scheme of MAP_SCHEMES) {
        for (const k of CLASS_COUNTS) {
          for (const hex of classHexes(scheme, k, theme)) {
            const r = contrastRatio(hex, mapPlate(theme));
            expect(r, `${scheme} k=${k} ${hex}: ${r.toFixed(3)}:1`).toBeGreaterThanOrEqual(
              MAP_PLATE_CONTRAST_MIN,
            );
          }
        }
      }
    },
  );

  it.each(MAP_GATE_THEMES)(
    "%s: środek rampy rozbieżnej różni się od braku danych jasnością OKLab o >= 0,05",
    (_n, theme) => {
      const block = mapBlock(theme);
      const dl = Math.abs(
        oklabOf(hexToken(block, "--chart-map-div-mid")).l -
          oklabOf(hexToken(block, "--chart-map-nodata")).l,
      );
      expect(dl, dl.toFixed(4)).toBeGreaterThanOrEqual(MAP_DIV_MID_NODATA_DL_MIN);
    },
  );
});
