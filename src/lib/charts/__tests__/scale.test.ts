import { describe, expect, it } from "vitest";
import {
  forecastBandExtent,
  linearScale,
  niceScale,
  niceStep,
  seriesExtent,
  stackSeries,
} from "../scale";
import type { ChartSeries } from "../types";

const s = (values: (number | null)[], slot = 1): ChartSeries => ({
  name: `s${slot}`,
  values,
  colorSlot: slot,
});

describe("niceStep", () => {
  it("snaps to the 1-2-5 progression", () => {
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.7)).toBe(2);
    expect(niceStep(3.2)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.03)).toBe(0.05);
    expect(niceStep(230)).toBe(500);
  });

  it("krok nie zależy od ULP-a `Math.pow` - ten sam wynik na każdym silniku", () => {
    // `Math.pow` jest w ECMA-262 zależne od implementacji: `Math.pow(10, -17)`
    // daje 9.999999999999999e-18 na Node 22 i 1e-17 na Node 24. Ten jeden bit
    // zmieniał rozstaw siatki, przez co `niceScale(1, 1 + 1 ULP, 3)` zwracało
    // pięć podziałek o trzech różnych wartościach - i to TYLKO na runnerze CI.
    // Asercja MUSI być na literale dziesiętnym, nie na wyniku `Math.pow` -
    // porównanie z `Math.pow` byłoby tak samo zależne od silnika jak defekt,
    // który ten test przypina.
    expect(niceStep(1e-17)).toBe(1e-17);
    for (const p of [-300, -17, -3, 0, 3, 17, 300]) {
      expect(niceStep(Number(`1e${p}`)), `1e${p}`).toBe(Number(`1e${p}`));
    }
    // Zakres SUBNORMALNY jest osobny: tam sam literał dziesiętny nie ma
    // dokładnej reprezentacji (`1e-320` to w praktyce 9.98e-321), więc
    // kontraktem jest krok dodatni i skończony, a nie równość co do bitu.
    for (const maly of [Number.MIN_VALUE, 1e-320, 1e-310]) {
      const krok = niceStep(maly);
      expect(krok, String(maly)).toBeGreaterThan(0);
      expect(Number.isFinite(krok), String(maly)).toBe(true);
    }
  });

  it("survives zero and non-finite input", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });

  it("nie zwraca kroku ZEROWEGO dla argumentu subnormalnego", () => {
    // REGRESJA. Dla 5e-324 `Math.pow(10, -324)` PODPŁYWA DO ZERA, więc
    // `mult * base` dawało 0. Zerowy krok szedł dalej jako `Math.floor(min / 0)`,
    // czyli NaN w obu krańcach domeny i cicho pusty wykres.
    expect(niceStep(Number.MIN_VALUE)).toBe(1);
    expect(niceStep(5e-324)).toBe(1);
  });

  it("nie zwraca kroku NIESKOŃCZONEGO przy magnitudzie rzędu 1e308", () => {
    // REGRESJA. `base` wychodziło 1e308, a `mult` 2 - iloczyn wypadał poza
    // zakres liczb. Z nieskończonym krokiem nie da się policzyć ani jednej
    // podziałki, więc krok o rząd za mały jest mniejszym złem.
    expect(Number.isFinite(niceStep(1.25e308))).toBe(true);
  });
});

describe("niceScale", () => {
  it("expands the domain to nice bounds and returns even ticks", () => {
    const sc = niceScale(3, 97, 5);
    expect(sc.min).toBeLessThanOrEqual(3);
    expect(sc.max).toBeGreaterThanOrEqual(97);
    expect(sc.ticks[0]).toBe(sc.min);
    expect(sc.ticks[sc.ticks.length - 1]).toBe(sc.max);
    const step = sc.ticks[1] - sc.ticks[0];
    for (let i = 1; i < sc.ticks.length; i++) {
      expect(sc.ticks[i] - sc.ticks[i - 1]).toBeCloseTo(step, 8);
    }
  });

  it("handles a flat series without collapsing", () => {
    const sc = niceScale(50, 50);
    expect(sc.max).toBeGreaterThan(sc.min);
  });

  it("handles negative domains", () => {
    const sc = niceScale(-80, -20);
    expect(sc.min).toBeLessThanOrEqual(-80);
    expect(sc.max).toBeGreaterThanOrEqual(-20);
  });
});

describe("linearScale", () => {
  it("maps domain to range linearly (and inverted ranges)", () => {
    const y = linearScale(0, 100, 200, 0);
    expect(y(0)).toBe(200);
    expect(y(100)).toBe(0);
    expect(y(50)).toBe(100);
  });
});

describe("seriesExtent", () => {
  it("computes min/max across series, skipping nulls", () => {
    const e = seriesExtent([s([1, null, 9]), s([-3, 4, null], 2)], 3, {
      stacked: false,
      includeZero: false,
    });
    expect(e).toEqual({ min: -3, max: 9 });
  });

  it("includes zero when requested (bars must grow from zero)", () => {
    const e = seriesExtent([s([5, 9])], 2, { stacked: false, includeZero: true });
    expect(e.min).toBe(0);
  });

  it("uses per-category sums when stacked", () => {
    const e = seriesExtent([s([5, 5]), s([7, 1], 2)], 2, { stacked: true, includeZero: true });
    expect(e.max).toBe(12);
  });

  it("stos zawsze obejmuje ZERO, także dla serii wyłącznie ujemnej", () => {
    // Stos rośnie OD ZERA, więc zero zostaje w domenie nawet bez `includeZero`
    // - sumy ujemne sprowadzają `min` w dół, a górny kraniec zostaje na zerze.
    // To pinuje zachowanie po usunięciu martwego `if (pos < min) ...`.
    const e = seriesExtent([s([-5, -3]), s([-2, -8], 2)], 2, {
      stacked: true,
      includeZero: false,
    });
    expect(e).toEqual({ min: -11, max: 0 });
  });

  it("stos mieszany bierze sumy dodatnie i ujemne osobno", () => {
    const e = seriesExtent([s([5, -3]), s([-2, 8], 2)], 2, {
      stacked: true,
      includeZero: false,
    });
    expect(e).toEqual({ min: -3, max: 8 });
  });

  it("poza stosem seria ujemna NIE dostaje fałszywego zera", () => {
    const e = seriesExtent([s([-5, -3])], 2, { stacked: false, includeZero: false });
    expect(e).toEqual({ min: -5, max: -3 });
  });
});

describe("stackSeries", () => {
  it("accumulates positive values upward per category", () => {
    const stacks = stackSeries([s([2, 3]), s([5, 1], 2)], 2);
    expect(stacks[0][0]).toEqual({ from: 0, to: 2, value: 2 });
    expect(stacks[1][0]).toEqual({ from: 2, to: 7, value: 5 });
    expect(stacks[1][1]).toEqual({ from: 3, to: 4, value: 1 });
  });

  it("stacks negatives downward independently", () => {
    const stacks = stackSeries([s([-2]), s([-3], 2), s([4], 3)], 1);
    expect(stacks[0][0]).toEqual({ from: 0, to: -2, value: -2 });
    expect(stacks[1][0]).toEqual({ from: -2, to: -5, value: -3 });
    expect(stacks[2][0]).toEqual({ from: 0, to: 4, value: 4 });
  });

  it("treats nulls as gaps that do not move the cursor", () => {
    const stacks = stackSeries([s([null, 2]), s([3, 3], 2)], 2);
    expect(stacks[0][0].value).toBeNull();
    expect(stacks[1][0]).toEqual({ from: 0, to: 3, value: 3 });
  });
});

describe("forecastBandExtent", () => {
  it("rozszerza zakres o obwiednię prognozy, żeby pasma nie ucięła krawędź", () => {
    // REGRESJA. Skala liczona z samych wartości pozwalała obwiedni wyjść ponad
    // najwyższą podziałkę - a ucięte pasmo niepewności sugeruje, że niepewność
    // KOŃCZY SIĘ tam, gdzie kończy się obszar kreślenia.
    const band = forecastBandExtent([s([10, 12, 13, 100])], 3, 20);
    expect(band).not.toBeNull();
    expect(band?.max).toBeCloseTo(120, 6);
    expect(band?.min).toBeCloseTo(80, 6);
  });

  it("punkt GRANICY jest pomijany - tam pasmo ma szerokość zero", () => {
    // Ostatnia obserwacja jest pomiarem, nie prognozą, więc nie ma wokół niej
    // niepewności prognozy i nie ma czym rozszerzać zakresu.
    const band = forecastBandExtent([s([1000, 10])], 1, 50);
    expect(band?.max).toBeCloseTo(15, 6);
    expect(band?.min).toBeCloseTo(5, 6);
  });

  it("milczy, gdy nie ma czego rozszerzać", () => {
    expect(forecastBandExtent([s([10, 12])], null, 12)).toBeNull();
    expect(forecastBandExtent([s([10, 12])], 1, 0)).toBeNull();
    expect(forecastBandExtent([s([10, null])], 1, 12)).toBeNull();
    expect(forecastBandExtent([], 1, 12)).toBeNull();
  });

  it("bierze skrajne wartości ze WSZYSTKICH serii, nie z pierwszej", () => {
    const band = forecastBandExtent([s([1, 2]), s([1, 50], 2)], 1, 10);
    expect(band?.max).toBeCloseTo(55, 6);
  });

  it("wartości ujemne rozszerzają zakres W DÓŁ", () => {
    const band = forecastBandExtent([s([0, -40])], 1, 25);
    expect(band?.min).toBeCloseTo(-50, 6);
    expect(band?.max).toBeCloseTo(-30, 6);
  });
});

// Inwarianty, których oś musi dotrzymać NIEZALEŻNIE od danych. Krańce
// sprawdzamy z tolerancją pół kroku, bo `roundToStep` zaokrągla PODZIAŁKI,
// a `min`/`max` wracają surowe - i tak było zawsze.
function sprawdzOs(sc: { min: number; max: number; ticks: number[] }): void {
  expect(sc.ticks.length).toBeGreaterThan(0);
  expect(sc.ticks.length).toBeLessThanOrEqual(1001);
  expect(sc.ticks.every(Number.isFinite)).toBe(true);
  expect(Number.isFinite(sc.min) && Number.isFinite(sc.max)).toBe(true);
  expect(sc.max).toBeGreaterThan(sc.min);
  expect(new Set(sc.ticks).size).toBe(sc.ticks.length);
  for (let i = 1; i < sc.ticks.length; i++) expect(sc.ticks[i]).toBeGreaterThan(sc.ticks[i - 1]);
  const krok = (sc.max - sc.min) / Math.max(1, sc.ticks.length - 1);
  expect(Math.abs(sc.ticks[0] - sc.min)).toBeLessThanOrEqual(krok / 2);
  expect(Math.abs(sc.ticks[sc.ticks.length - 1] - sc.max)).toBeLessThanOrEqual(krok / 2);
}

describe("niceScale - pętla podziałek kończy się ZAWSZE", () => {
  // REGRESJA. Pętla akumulowała `v += step`. Gdy krok schodził poniżej odstępu
  // między sąsiednimi liczbami double przy danej magnitudzie, `v` przestawało
  // rosnąć i render - także SSR, czyli SYNCHRONICZNIE na serwerze - kręcił się
  // w nieskończoność, poza zasięgiem strażników timerowych.
  //
  // Asercje stoją na DŁUGOŚCI tablicy podziałek, a nie na timeoutcie vitesta:
  // przy zablokowanej pętli zdarzeń timer nigdy nie wystrzeli.
  const wejscia: [string, number, number][] = [
    ["1 ULP przy jedynce", 1, 1.0000000000000002],
    ["1 ULP przy tysiącu (dryf analityki)", 1000, 1000.0000000000001],
    ["1 ULP przy 1e16", 1e16, 1e16 + 2],
    ["2 ULP przy 1e16", 1e16, 1e16 + 4],
    ["rozstęp 16 przy 1e17", 1e17, 1e17 + 16],
    ["rozstęp 0,25 przy 1e15", 1e15, 1e15 + 0.25],
    ["1 ULP na ułamku", 0.1, 0.10000000000000002],
    ["znacznik czasu w nanosekundach", 1700000000000000000, 1700000000000000256],
    ["rozstęp NIESKOŃCZONY", -1e308, 1e308],
    ["dociągnięcie krańca poza zakres liczb", 0, Number.MAX_VALUE],
  ];

  // targetTicks = 3 to produkcyjna ścieżka małych wielokrotności
  // (`SMALL_MULTIPLES_TARGET_TICKS`) - i właśnie przy niej najłatwiej o kolizję
  // siatki, więc każde wejście jedzie po wszystkich czterech celach.
  for (const cel of [2, 3, 5, 9]) {
    for (const [opis, a, b] of wejscia) {
      it(`kończy się i daje sensowną oś: ${opis} (targetTicks=${cel})`, () => {
        sprawdzOs(niceScale(a, b, cel));
      });
    }
  }

  it("liczy krok Z DANYCH także przy rozstępie nieskończonym", () => {
    // Najlepszy dowód, że osłona dotyczy PĘTLI, a nie danych: oś symetryczna
    // wychodzi z prawdziwego kroku 5e307, a nie z awaryjnej jedynki.
    expect(niceScale(-1e308, 1e308, 5).ticks).toEqual([-1e308, -5e307, 0, 5e307, 1e308]);
  });
});

describe("niceScale - walidacja targetTicks", () => {
  // REGRESJA. `targetTicks` przychodzi od wywołującego i nie jest pilnowany
  // przez typ: nieliczba dawała krok NaN, a wielka liczba - krok mikroskopijny
  // i miliardy obrotów pętli.
  it("wielki targetTicks nie rozsypuje osi na miliardy podziałek", () => {
    const sc = niceScale(0, 1, 1e7);
    sprawdzOs(sc);
    expect(sc.ticks.length).toBeLessThanOrEqual(1001);
  });

  it("NaN degraduje do domyślnych pięciu podziałek", () => {
    expect(niceScale(0, 1, Number.NaN).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it("zero i liczba ujemna wpadają w dolną klamrę na dwóch", () => {
    sprawdzOs(niceScale(0, 1, 0));
    sprawdzOs(niceScale(0, 1, -3));
  });
});

describe("niceScale - podziałki drobne nie sklejają się", () => {
  // REGRESJA. `roundToStep` ucinał do 10 miejsc po przecinku NIEZALEŻNIE od
  // kroku, więc dla kroków poniżej 1e-10 wszystkie podziałki wychodziły równe:
  // linie siatki lądowały jedna na drugiej, a pierwsza i ostatnia podziałka
  // przestawały odpowiadać krańcom domeny.
  it("krok 1e-12 daje pięć RÓŻNYCH podziałek, a nie pięć zer", () => {
    const sc = niceScale(1e-12, 5e-12, 5);
    sprawdzOs(sc);
    expect(sc.ticks).toEqual([1e-12, 2e-12, 3e-12, 4e-12, 5e-12]);
  });

  it("skala nanoskalowa nie zwija się do jednej wartości", () => {
    const sc = niceScale(6.611e-9, 6.647e-9, 5);
    sprawdzOs(sc);
    expect(sc.ticks).toEqual([6.61e-9, 6.62e-9, 6.63e-9, 6.64e-9, 6.65e-9]);
  });

  it("domena od zera do 1e-10 nie dubluje krańców", () => {
    const sc = niceScale(0, 1e-10, 5);
    sprawdzOs(sc);
    expect(sc.ticks).toEqual([0, 5e-11, 1e-10, 1.5e-10]);
  });

  it("przy trzech podziałkach nie zostaje DUPLIKAT w środku osi", () => {
    const sc = niceScale(1.342e-7, 1.343e-7, 3);
    sprawdzOs(sc);
    expect(sc.ticks).toEqual([1.342e-7, 1.3425e-7, 1.343e-7, 1.3435e-7]);
  });
});

describe("niceScale - domena zdegenerowana traktowana jak seria płaska", () => {
  // Oś, która nie odróżnia własnych krańców, NIE MA PRAWA udawać, że je
  // odróżnia. Rozsunięcie jest tym samym zabiegiem co dla serii płaskiej.
  it("rozstęp poniżej rozdzielczości przy 1e16 rozsuwa domenę", () => {
    expect(niceScale(1e16, 1e16 + 2, 5).ticks).toEqual([8e15, 9e15, 1e16, 1.1e16, 1.2e16, 1.3e16]);
  });

  it("rozstęp 1 ULP przy tysiącu rozsuwa domenę", () => {
    expect(niceScale(1000, 1000.0000000000001, 5).ticks).toEqual([800, 900, 1000, 1100, 1200]);
  });

  it("seria PŁASKA zachowuje się dokładnie jak dotąd", () => {
    expect(niceScale(50, 50, 5).ticks).toEqual([40, 45, 50, 55, 60]);
    expect(niceScale(0, 0, 5).ticks).toEqual([-1, -0.5, 0, 0.5, 1]);
  });
});

describe("niceScale - wielkie magnitudy zostają NIETKNIĘTE", () => {
  it("wartości rzędu 1e308 dalej mieszczą się w domenie", () => {
    // Pinezka anty-regresyjna: osłona ma dotyczyć PĘTLI, nie danych. Klamra
    // magnitudy zepchnęłaby te punkty daleko ponad ramkę rysunku, a żaden
    // istniejący test by tego nie zauważył (sprawdzają tylko brak "NaN"/"∞").
    expect(niceScale(0, 1e308, 3)).toEqual({ min: 0, max: 1e308, ticks: [0, 5e307, 1e308] });
    expect(niceScale(5e307, 1e308, 3).max).toBe(1e308);
  });
});

describe("niceScale - kontrole niezmienności", () => {
  it("skale typowych wykresów nie drgnęły", () => {
    // Przepisanie pętli miało zmienić TERMINACJĘ, a nie skale - te cztery
    // wejścia to kontrolki, po których regresja skali jest widoczna od razu.
    expect(niceScale(3, 97, 5).ticks).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceScale(0, 1, 5).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceScale(-80, -20, 5).ticks).toEqual([-80, -60, -40, -20]);
    expect(niceScale(2, 24, 5).ticks).toEqual([0, 5, 10, 15, 20, 25]);
  });
});

describe("niceScale - domena NIELICZBOWA nie propaguje się na oś", () => {
  it("`NaN` i nieskończoności dają domyślną domenę 0-1, a nie oś z `NaN`", () => {
    // Wartości krańcowe przychodzą z danych, nie z kodu: pusty CSV, dzielenie
    // przez zero w wyliczanej serii, `parseFloat("")`. Bez sprowadzenia do
    // domyślnej domeny `NaN` przeciekał do atrybutów SVG i przeglądarka
    // przestawała rysować CAŁY wykres - bez komunikatu, bez śladu w konsoli.
    for (const [min, max] of [
      [NaN, NaN],
      [NaN, 10],
      [0, Infinity],
      [-Infinity, Infinity],
    ] as const) {
      const oś = niceScale(min, max);
      expect(Number.isFinite(oś.min)).toBe(true);
      expect(Number.isFinite(oś.max)).toBe(true);
      expect(oś.ticks.every((t) => Number.isFinite(t))).toBe(true);
      expect(oś.max).toBeGreaterThan(oś.min);
    }
  });
});

describe("niceScale - dociąganie krawędzi PRZEPEŁNIAJĄCE zakres double", () => {
  it("domena od -MAX do +MAX zostaje SKOŃCZONA, choć ładna krawędź wychodzi poza zakres", () => {
    // `Math.floor(min / step) * step` potrafi wyjść poza `Number.MAX_VALUE`
    // i dać `-Infinity` przy SKOŃCZONYM wejściu. Oś sięgająca nieskończoności
    // rozjeżdża całą skalę: każdy punkt danych ląduje wtedy w tym samym
    // pikselu. Dlatego zawracamy o jeden krok bliżej zera - lepiej przyciąć
    // skrajny punkt o ułamek kroku niż oddać oś, której nie da się narysować.
    const M = Number.MAX_VALUE;
    const oś = niceScale(-M, M, 3);

    expect(Number.isFinite(oś.min)).toBe(true);
    expect(Number.isFinite(oś.max)).toBe(true);
    expect(oś.ticks.every((t) => Number.isFinite(t))).toBe(true);
    expect(oś.min).toBeLessThan(oś.max);
  });

  it("domena ZDEGENEROWANA przy krańcu zakresu spada na oś zastępczą -1..1", () => {
    // Tu nie da się rozsunąć domeny: `min - |min| * 0,2` przepełnia się
    // w drugą stronę. Oś zastępcza jest wtedy jedynym wyjściem, które da się
    // narysować - i to jest świadomy wybór, a nie awaria.
    const M = Number.MAX_VALUE;
    const oś = niceScale(-M, -M, 5);

    expect(oś).toEqual({ min: -1, max: 1, ticks: [-1, -0.5, 0, 0.5, 1] });
    expect(oś.ticks.every((t) => Number.isFinite(t))).toBe(true);
  });
});

describe("seriesExtent - stos BEZ ANI JEDNEJ kategorii", () => {
  it("zwraca zakres 0-0, a nie wartości nieskończone z inicjalizacji", () => {
    // Wykres skumulowany o zerowej liczbie kategorii powstaje przy pustym
    // filtrze i przy danych, z których wszystko odpadło. Akumulatory startują
    // z `Infinity`/`-Infinity`, więc bez tego domknięcia oddawałyby je wprost -
    // a `linearScale` na takim zakresie liczy dalej i wypuszcza `NaN` do
    // atrybutów SVG.
    const e = seriesExtent([s([1, 2]), s([3, 4], 2)], 0, { stacked: true, includeZero: true });

    expect(e).toEqual({ min: 0, max: 0 });
    expect(Number.isFinite(e.min)).toBe(true);
    expect(Number.isFinite(e.max)).toBe(true);
  });
});
