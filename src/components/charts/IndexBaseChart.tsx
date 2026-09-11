// LINIOWY NA INDEKSIE (BAZA = 100) - KILKA SZEREGÓW O RÓŻNEJ SKALI NA JEDNEJ
// OSI WARTOŚCI.
//
// PYTANIE ANALITYCZNE. Wiersz tabeli doboru formy z sekcji 1: „Kilka szeregów
// o różnej skali? -> liniowy na indeksie (baza = 100) lub small multiples",
// a w kolumnie „Czego unikać" jedno hasło: DWIE OSIE Y. Ten rodzaj istnieje po
// to, żeby drugiej osi nie było - przy dwóch osiach relacja wizualna między
// szeregami zależy od dobranych zakresów, czyli od autora, a nie od danych.
// Indeks daje jedną skalę, której nikt nie dobiera, bo wynika z arytmetyki.
//
// CZEMU TO NIE JEST WARIANT `CartesianChart`, i to jest tu jedyna decyzja
// architektoniczna warta uzasadnienia.
//
// Oś wartości wykresu kartezjańskiego niesie JEDNOSTKĘ AUTORA i bierze zakres
// z `seriesExtent` policzonego na wartościach surowych, czyli na POZIOMIE.
// Oś indeksu nie ma jednostki (iloraz dwóch liczb w mld EUR nie jest w mld
// EUR), a jej zakres liczy `indexBaseExtent`, które zawsze obejmuje sto i nie
// domyka zera. Gdyby to był wariant, różnica między nimi musiałaby być
// PRZEŁĄCZNIKIEM, a wtedy trzy rzeczy, które tutaj są bezwarunkowe, dałoby się
// wyłączyć jedną opcją: linia odniesienia na stu, zdanie o bezjednostkowej osi
// i NAZWANE odrzucenie serii, której nie da się zaindeksować. Każda z nich
// wyłączona po cichu daje rysunek, który wygląda poprawnie i kłamie - linia
// bez setki pokazuje odchylenia bez punktu odniesienia, oś bez zastrzeżenia
// czyta się jako wartości, a seria zniknięta bez słowa kłamie o LICZBIE
// porównywanych podmiotów. Osobny render znaczy, że tych trzech rzeczy nie ma
// jak nie narysować.
//
// Z tej samej decyzji wynika drobiazg, który wygląda na kosmetykę, a nią nie
// jest: TU NIE MA WYGŁADZANIA. `config.smoothing` jest tu ignorowane, bo cały
// odczyt tego rodzaju sprowadza się do pytania, po której stronie stu leży
// linia - a krzywa monotoniczna potrafi zejść pod setkę między dwoma punktami,
// które oba są nad nią. Łamana takiego zdania nie postawi: każdy jej
// wierzchołek jest pomiarem.
//
// CZEGO TEN KOMPONENT NIE LICZY: niczego. Indeksy, odrzucenia, ogrodzenie
// bazy, zakres osi i wszystkie sprawdzenia uczciwości pochodzą
// z `lib/charts/kinds/indexBase.ts`. Tu jest wyłącznie skalowanie na piksele,
// rysowanie i tłumaczenie kluczy.
import {
  useCallback,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { CATEGORICAL_SAFE_SERIES, type ChartConfig } from "@/lib/charts/types";
import { formatAxisTick, formatChartValue, type ChartLang } from "@/lib/charts/format";
import { linearScale, niceScale } from "@/lib/charts/scale";
import { finite, orNull } from "@/lib/charts/num";
import {
  INDEX_BASE_COMPARABLE_RATIO,
  indexBaseExtent,
  indexBaseFormAdvice,
  indexBaseModelFromConfig,
  type IndexBaseFormAdvice,
  type IndexBaseRejection,
  type IndexBaseSeriesModel,
  type IndexBaseSource,
} from "@/lib/charts/kinds/indexBase";
import {
  CATEGORY_LABEL_MAX_CHARS,
  CATEGORY_LABEL_MAX_WIDTH,
  FONT_AXIS,
  MIN_INNER_H,
  MIN_INNER_W,
  PAD_BOTTOM,
  PAD_LEFT_MIN,
  PAD_SIDE,
  PAD_TOP,
  cascadeStepMs,
  shouldShowDots,
  valueTickTarget,
} from "@/lib/charts/geometry";
import { nearestPointIndex, pointerToPlot } from "@/lib/charts/plot";
import { estimateLabelWidth, estimateMaxLabelWidth } from "@/lib/charts/measureText";
import { pathFromPoints, type Point } from "@/lib/charts/smooth";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useTapAwayDismiss } from "@/hooks/useTapAwayDismiss";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { ChartTooltip, type TooltipRow } from "./ChartTooltip";
import { ChartNotes, type ChartNote } from "./ChartFrame";
import "@/lib/i18n-charts";

/**
 * OBSERWACJE DLA CZYTELNIKA, wypisane jawnie. Sklejenie
 * (`indexBase.reading.${porada}`) jest niewidoczne dla trzech bramek i18n,
 * więc unia modelu mapuje się na klucze MAPĄ - ten sam wzorzec co
 * `TORNADO_NOTE_KEYS` w `Chart.tsx` i `READING_KEYS` w `HistogramChart.tsx`.
 *
 * `scaleComparable` MA TU `null` I TO NIE JEST PRZEOCZENIE. Model zwraca tę
 * poradę (szeregi tego samego rzędu wielkości, czyli przesłanki z tabeli
 * doboru form nie ma), a słownik `indexBase.reading` nie ma dla niej treści
 * ani po polsku, ani po angielsku. `t()` na nieistniejącym kluczu zwraca sam
 * klucz, więc pod opublikowanym wpisem stanąłby napis
 * „indexBase.reading.scaleComparable" - dokładnie ten defekt, którym tornado
 * wypisywało „tornado.note.oneLegged". Do czasu dopisania treści render
 * MILCZY, bo milczenie jest jedyną alternatywą dla surowego klucza. Brak
 * klucza zgłaszam osobno - dopisanie go jest poza zakresem tego pliku.
 */
const READING_KEYS: Record<IndexBaseFormAdvice, string | null> = {
  baseUnusable: "indexBase.reading.baseUnusable",
  seriesDropped: "indexBase.reading.seriesDropped",
  singleSeries: "indexBase.reading.singleSeries",
  shortSeries: "indexBase.reading.shortSeries",
  extremeBase: "indexBase.reading.extremeBase",
  mixedSign: "indexBase.reading.mixedSign",
  noSpread: "indexBase.reading.noSpread",
  scaleComparable: null,
  tooManySeries: "indexBase.reading.tooManySeries",
};

/**
 * DLACZEGO SERIA WYPADŁA Z RYSUNKU - trzy powody, trzy różne zdania. Mapa
 * jest wyczerpująca, więc nowa wartość unii nie skompiluje się bez klucza.
 */
const REJECTION_KEYS: Record<IndexBaseRejection, string> = {
  missingBase: "indexBase.rejection.missingBase",
  zeroBase: "indexBase.rejection.zeroBase",
  negativeBase: "indexBase.rejection.negativeBase",
};

/** Skąd wziął się okres bazowy. Każdy wybór ma być nazwany, także domyślny. */
const BASE_SOURCE_KEYS: Record<IndexBaseSource, string> = {
  explicit: "indexBase.base.source.explicit",
  first: "indexBase.base.source.first",
  none: "indexBase.base.source.none",
};

/**
 * Powyżej tylu linii etykieta bezpośrednia przy końcu ustępuje legendzie.
 *
 * CZTERY, za sekcją 4 specyfikacji („przy nie więcej niż czterech szeregach
 * etykietuj końce linii zamiast legendy"). Powód jest geometryczny, nie
 * estetyczny: etykiety końców leżą na wysokościach WARTOŚCI, więc przy piątej
 * linii prawdopodobieństwo, że dwie wypadną bliżej niż wysokość wiersza,
 * przestaje być marginalne, a rozsuwanie ich odrywa etykietę od linii, którą
 * nazywa. Legenda w ramie karty nie ma tego problemu, bo nie udaje, że stoi
 * przy danych.
 */
const DIRECT_LABEL_MAX_SERIES = 4;

/** Minimalny prześwit między etykietami końców linii, w pikselach. */
const END_LABEL_MIN_GAP = 13;

/** Minimalny prześwit między etykietami okresów, w pikselach. */
const PERIOD_LABEL_GAP = 8;

/**
 * Promień markera obserwacji i grubości kresek jako WARTOŚCI AWARYJNE -
 * właściwe niosą tokeny `--chart-dot`, `--chart-dot-ring` i `--chart-stroke`
 * przez klasy `.neh-dot` i `.neh-line` (arkusz wygrywa z atrybutem
 * prezentacyjnym SVG, więc korekta irradiacji w trybie ciemnym dzieje się bez
 * ani jednej gałęzi tutaj).
 *
 * PO CO WIĘC ATRYBUTY. Bo `r` NIE MA WARTOŚCI DOMYŚLNEJ RÓŻNEJ OD ZERA:
 * `<circle>` bez `r` jest okręgiem o promieniu zero, czyli NICZYM. Dopóki
 * arkusz nie dojedzie - pierwsza klatka odpowiedzi z brzegu, wydruk ze
 * zablokowanym CSS, zrzut z narzędzia czytającego sam kod HTML - marker
 * obserwacji nie istnieje, a razem z nim nie istnieje cały ciąg
 * jednopunktowy, bo jego jedynym nośnikiem jest właśnie marker. Ta sama
 * konwencja stoi w `CartesianChart`, `BoxplotChart`, `FanChart`
 * i `SmallMultiplesChart`; ten render był jedynym, który jej nie miał.
 */
const DOT_R_PX = 2.8;
const DOT_RING_PX = 1.6;
const LINE_PX = 2;

/**
 * Nazwa serii przy końcu linii, ucięta do szerokości, która MIEŚCI SIĘ
 * w marginesie prawym; pełną treść niesie `<title>`, bo sekcja 4 zabrania
 * wielokropka bez podpowiedzi.
 *
 * DLACZEGO UCIĘCIE, A NIE SZERSZY MARGINES. Margines prawy ma sufit
 * (`CATEGORY_LABEL_MAX_WIDTH`), bo bez niego jedna długa nazwa serii zjadałaby
 * pole rysunku - a pole rysunku jest tym, co niesie dane. Przy nazwie
 * szerszej od sufitu margines przestaje rosnąć, więc nazwa MIERZONA W CAŁOŚCI
 * wychodzi za płytę: zmierzone na nazwie z pięćdziesięciu znaków przy
 * szerokości 720 px prawa krawędź napisu wypadała na 894 px, czyli 174 px za
 * krawędzią rysunku, i to bez żadnego znaku, że coś ucięto. Ucięcie
 * z wielokropkiem jest widoczne, a `<title>` oddaje pełną nazwę - ten sam
 * układ co przy nazwach rojów w `BeeswarmChart`. Liczby są dobrane parą:
 * dwadzieścia cztery znaki przy `FONT_AXIS` to ~164 px, czyli mniej niż sufit
 * marginesu.
 */
function skrocNazwe(name: string): string {
  return name.length > CATEGORY_LABEL_MAX_CHARS
    ? `${name.slice(0, CATEGORY_LABEL_MAX_CHARS - 1)}…`
    : name;
}

interface IndexBaseChartProps {
  config: ChartConfig;
  lang: ChartLang;
  /**
   * WSPÓLNY okres bazowy. Jedna liczba dla wszystkich serii - baza liczona per
   * seria byłaby tym samym kłamstwem co dwie osie Y, tylko trudniejszym do
   * zauważenia (patrz nagłówek modelu). `undefined` znaczy „nie wskazano",
   * a wtedy model bierze pierwszy okres i sam to nazywa.
   */
  baseAt?: number | null;
}

export function IndexBaseChart({ config, lang, baseAt }: IndexBaseChartProps) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = useCallback(
    (key: string, values?: Record<string, string | number>): string =>
      scoped(key, { lng: lang, ...values }),
    [scoped, lang],
  );
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>();
  const { ref: revealRef, state: revealState } = useRevealOnScroll<HTMLDivElement>(config.animate);
  const [active, setActive] = useState<number | null>(null);
  const hintId = useId();

  const model = useMemo(
    () => indexBaseModelFromConfig(config, { baseAt: baseAt ?? null }),
    [config, baseAt],
  );
  const height = config.height;

  // `useTapAwayDismiss` MUSI stać przed wczesnym wyjściem - hooki nie mogą się
  // warunkowo pomijać, a wyjście „nie ma czego rysować" jest niżej.
  const clearActive = useCallback(() => setActive(null), []);
  useTapAwayDismiss(active !== null, widthRef, clearActive);

  const naRysunku = useMemo(() => model.series.filter((s) => s.indexable), [model]);
  const bezposrednie = naRysunku.length > 0 && naRysunku.length <= DIRECT_LABEL_MAX_SERIES;

  const geometry = useMemo(() => {
    // ZAKRES OSI PRZYCHODZI Z MODELU I NIE JEST TU POPRAWIANY. `indexBaseExtent`
    // zawsze obejmuje setkę i świadomie NIE domyka zera: indeksy mieszkają
    // wokół stu, więc wymuszenie zera zepchnęłoby całą zmienność w górne
    // dziesięć procent osi i dało rysunek mówiący „nic się nie działo".
    // Ucięcie jest dopuszczone przez sekcję 8 dla znaczników kodujących
    // POŁOŻENIE i jest niżej NAZWANE przypisem.
    const extent = indexBaseExtent(model);
    const scale = niceScale(extent.min, extent.max, valueTickTarget(height, false));
    const tickW = Math.max(
      ...scale.ticks.map((tk) => estimateLabelWidth(formatAxisTick(tk, lang), FONT_AXIS)),
      0,
    );
    const padLeft = Math.max(PAD_LEFT_MIN, Math.ceil(tickW) + PAD_SIDE);
    // Etykiety końców linii potrzebują miejsca PO PRAWEJ, inaczej nazwa serii
    // wychodzi za płytę i zostaje ucięta (sekcja 1 nie dopuszcza ucięcia
    // niczego). Bez etykiet bezpośrednich margines zostaje zwykły.
    // MIERZONE NA NAZWACH UCIĘTYCH, nie na pełnych: sufit marginesu i tak nie
    // przepuści nazwy szerszej, a pomiar pełnej nazwy dawał margines mniejszy
    // od napisu, który w nim stoi (patrz `skrocNazwe`).
    const nazwyKoncow = bezposrednie ? naRysunku.map((s) => skrocNazwe(s.name)) : [];
    const padRight =
      nazwyKoncow.length > 0
        ? Math.max(
            PAD_SIDE,
            Math.min(
              CATEGORY_LABEL_MAX_WIDTH,
              Math.ceil(estimateMaxLabelWidth(nazwyKoncow, FONT_AXIS)) + PAD_SIDE,
            ),
          )
        : PAD_SIDE;
    const innerW = Math.max(MIN_INNER_W, width - padLeft - padRight);
    const innerH = Math.max(MIN_INNER_H, height - PAD_TOP - PAD_BOTTOM);
    const value = linearScale(scale.min, scale.max, PAD_TOP + innerH, PAD_TOP);
    // OKRESY NA KRAWĘDZIACH POLA, nie w środkach pasm - to jest wykres
    // liniowy, więc pierwszy pomiar leży na lewej krawędzi, ostatni na prawej
    // i odstępów jest `n - 1`. Ta sama arytmetyka co w `CartesianChart`, żeby
    // `nearestPointIndex` trafiał w to samo, co widać.
    const n = model.periodCount;
    const okres = (i: number): number =>
      n > 1 ? padLeft + (innerW * i) / (n - 1) : padLeft + innerW / 2;
    return { scale, padLeft, padRight, innerW, innerH, value, okres };
  }, [model, height, width, lang, bezposrednie, naRysunku]);

  const { scale, padLeft, innerW, innerH, value, okres } = geometry;

  // Co która etykieta okresu, licząc z szerokości najszerszego napisu. To jest
  // WSTĘPNE przerzedzenie, a nie rozstrzygnięcie: pierwsza, ostatnia i bazowa
  // stoją poza krokiem (bez pierwszej i ostatniej nie wiadomo, jaki odcinek
  // czasu pokazuje rysunek, a bez bazowej - wobec czego liczona jest każda
  // wartość), więc o kolizjach rozstrzyga niżej `podpisaneOkresy`.
  const krokEtykiet = useMemo(() => {
    const n = model.periodCount;
    if (n <= 1) return 1;
    const najszersza = Math.max(estimateMaxLabelWidth(model.periods, FONT_AXIS), FONT_AXIS);
    const naOkres = Math.max(1, innerW / (n - 1));
    return Math.max(1, Math.ceil((najszersza + PERIOD_LABEL_GAP) / naOkres));
  }, [model.periods, model.periodCount, innerW]);

  /**
   * KTÓRE OKRESY SĄ PODPISANE - lista indeksów, po sprawdzeniu KOLIZJI.
   *
   * Sam krok przerzedzania nie wystarcza, bo trzy etykiety są podpisywane
   * POZA krokiem (pierwsza, ostatnia i bazowa) i każda z nich może wypaść
   * tuż obok etykiety przerzedzonej albo obok siebie. ZMIERZONE NA WERSJI
   * BEZ TEGO PLANU, przy szerokości 720 px:
   *
   *   * trzydzieści okresów „R0"..„R29", krok 2 - „R28" (przerzedzona)
   *     i „R29" (ostatnia) nachodziły na siebie o 7,7 px;
   *   * dwanaście okresów „Kwartał 1 roku 2020"..., baza na drugim - napisy
   *     „Kwartał 1 roku 2020" i „Kwartał 2 roku 2021" stały jeden na drugim
   *     z przesunięciem czterech pikseli, czyli NIE DAŁO SIĘ PRZECZYTAĆ
   *     ŻADNEGO.
   *
   * Reguła „ostatnia rysowana i koniec osi muszą być od siebie oddalone"
   * stoi w silniku od dawna (`visibleIndices` w `labels.ts` odejmuje przed
   * ostatnią etykietę pośrednią dokładnie z tego powodu). Tutaj jest
   * przepisana, a nie zaimportowana, bo tamten plan zna DWIE etykiety
   * obowiązkowe, a ten rodzaj wykresu ma TRZECIĄ - bazową, która stoi
   * w środku osi i o której `labels.ts` nie ma jak wiedzieć.
   *
   * PIERWSZEŃSTWO: pierwsza, potem ostatnia, potem bazowa, na końcu
   * przerzedzone. Bazowa ustępuje dwóm skrajnym, i to nie jest cofnięcie
   * decyzji „baza jest podpisana zawsze": etykieta podpisana, ale leżąca na
   * cudzym napisie, nie jest podpisana - jest plamą, która zabiera też tę
   * drugą. Baza zostaje przy tym NAZWANA (podpis linii odniesienia
   * „Baza: 2020 = 100") i POKAZANA (pionowa kreska przez pole), więc
   * czytelnik nadal wie, który to okres; pierwszy i ostatni okres nie mają
   * takiego drugiego nośnika nigdzie.
   */
  const podpisaneOkresy = useMemo(() => {
    const n = model.periodCount;
    if (n <= 1) return n === 1 ? [0] : [];
    const waga = (i: number): number =>
      i === 0 ? 3 : i === n - 1 ? 2 : i === model.baseAt ? 1 : 0;
    // Zajęte miejsce liczone Z KOTWICĄ, bo etykieta skrajna nie jest
    // wyśrodkowana na swoim okresie: pierwsza idzie w prawo od niego, ostatnia
    // w lewo (inaczej obie wychodziłyby za płytę).
    const przedzial = (i: number): { od: number; do: number } => {
      const w = estimateLabelWidth(model.periods[i], FONT_AXIS);
      const x = okres(i);
      if (i === 0) return { od: x, do: x + w };
      if (i === n - 1) return { od: x - w, do: x };
      return { od: x - w / 2, do: x + w / 2 };
    };
    const wybrane: number[] = [];
    for (let i = 0; i < n; i++) {
      if (waga(i) === 0 && i % krokEtykiet !== 0) continue;
      const p = przedzial(i);
      let stoi = true;
      while (wybrane.length > 0) {
        const ostatnia = wybrane[wybrane.length - 1];
        if (p.od >= przedzial(ostatnia).do + PERIOD_LABEL_GAP) break;
        // Kolizja: schodzi ta o niższym pierwszeństwie. Pętla, a nie jedno
        // sprawdzenie, bo długa etykieta obowiązkowa potrafi zająć miejsce
        // więcej niż jednej przerzedzonej.
        if (waga(i) > waga(ostatnia)) {
          wybrane.pop();
          continue;
        }
        stoi = false;
        break;
      }
      if (stoi) wybrane.push(i);
    }
    return wybrane;
  }, [model.periods, model.periodCount, model.baseAt, krokEtykiet, okres]);

  // BEZ BRAMKI NA PUSTĄ OŚ. Ten uchwyt wisi wyłącznie na kontenerze rysunku,
  // a rysunku nie ma wcale, gdy okresów jest zero (wyjście niżej) - warunek
  // `periodCount === 0` byłby tu kodem, którego nie da się wykonać, czyli
  // martwym zabezpieczeniem udającym ostrożność. Przycięcie do zakresu robi
  // `Math.min`/`Math.max` niżej i ono jest osłoną realną.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const delta = e.key === "ArrowRight" ? 1 : -1;
      setActive((prev) => {
        const next = prev === null ? (delta > 0 ? 0 : model.periodCount - 1) : prev + delta;
        return Math.max(0, Math.min(model.periodCount - 1, next));
      });
      return;
    }
    if (e.key === "Escape") setActive(null);
  };

  /* ---------------------------------------------------------------------- */
  /*  PRZYPISY POD RYSUNKIEM                                                 */
  /* ---------------------------------------------------------------------- */

  // KOLEJNOŚĆ JEST TREŚCIĄ, nie kosmetyką - czytelnik czyta listę od góry
  // i pierwsze zdanie ustawia mu resztę:
  //   1. czym są liczby na osi (bez tego indeks czyta się jako wartość),
  //   2. skąd wzięła się baza i czy oś jest ucięta,
  //   3. obserwacje o formie (zmieniają sposób czytania całego rysunku),
  //   4. defekty danych (dotyczą pojedynczych liczb),
  //   5. serie, których na rysunku NIE MA, z powodem przy nazwie.
  const notes: ChartNote[] = [];

  // Ten sam próg, którym model odmawia doradzania formy: pusty blok w edytorze
  // nie jest błędem, a lista zdań pod pustym wykresem uczy ignorowania
  // wszystkich zdań.
  const maDane = model.series.some((s) => s.n > 0);

  if (maDane) {
    // ZDANIE OBOWIĄZKOWE. Oś indeksu jest bezwymiarowa; czytelnik, któremu
    // tego nie powiedziano, odczyta „112" jako wartość, a nie jako „o 12%
    // więcej niż w bazie".
    notes.push({
      key: "axis.unitless",
      text: t("indexBase.axis.unitless"),
      defect: false,
    });
    // RÓŻNICA POZIOMÓW, POWIEDZIANA LICZBĄ. Model liczy ją od początku
    // (`levelRatio`) i jego własny opis mówi, że jedzie do podpisu - a nie
    // jechała nigdzie: jedynym odbiorcą była porada `scaleComparable` dla
    // AUTORA, i to w przypadku ODWROTNYM (poziomy podobne, więc indeks był
    // zbędny). Czytelnik nie dowiadywał się, że linie ruszające z jednego
    // punktu opisują wielkości różniące się o rzędy wielkości - czyli o tym,
    // co ten rodzaj mu zabiera.
    //
    // Próg ten sam, co u porady, tylko z drugiej strony: poniżej krotności
    // porównywalnej mówi się AUTOROWI („indeks był tu zbędny"), powyżej -
    // CZYTELNIKOWI („poziomy są różne, a rysunek tego nie pokazuje").
    if (model.levelRatio !== null && model.levelRatio >= INDEX_BASE_COMPARABLE_RATIO) {
      notes.push({
        key: "scale.levelRatio",
        text: t("indexBase.scale.levelRatio", {
          ratio: formatChartValue(model.levelRatio, lang, ""),
        }),
        defect: false,
      });
    }
    notes.push({
      key: `base.source.${model.baseSource}`,
      text: t(BASE_SOURCE_KEYS[model.baseSource]),
      defect: false,
    });
    // ZDANIE O UCIĘTEJ OSI ORZEKA O OSI, KTÓRA NAPRAWDĘ STOI NA RYSUNKU,
    // a nie o zakresie danych. To nie jest to samo pytanie i rozjazd między
    // nimi jest osiągalny: `model.axisTruncatedFromZero` mówi „najniższy
    // indeks jest dodatni", ale podziałki liczy `niceScale`, które DOCIĄGA
    // krańce do wielokrotności kroku - dla serii 1, 2, 5, 10 (indeksy
    // 100..1000) krok wychodzi 200, a dolny kraniec osi zaokrągla się
    // w DÓŁ do zera. Zmierzone przed poprawką: podziałki „0, 200, 400, 600,
    // 800, 1000" i pod nimi zdanie „Oś nie zaczyna się od zera", czyli
    // przypis kłamiący o rysunku, nad którym stoi. Przypis, który przeczy
    // temu, co widać, jest gorszy od braku przypisu: podważa wszystkie
    // pozostałe zdania na liście.
    if (scale.min > 0) {
      notes.push({
        key: "axisTruncated",
        text: t("indexBase.axisTruncated"),
        defect: false,
      });
    }
  }

  // Worek liczb podajemy KOMPLETEM dla wszystkich obserwacji: treść pisze
  // słownik, i18next zignoruje wstawki, których dane zdanie nie używa,
  // a POMINIĘTA wstawka nie jest ignorowana - zostaje w zdaniu jako surowe
  // `{{count}}` na opublikowanej stronie i żadna bramka tego nie widzi.
  for (const porada of indexBaseFormAdvice(model)) {
    const klucz = READING_KEYS[porada];
    if (klucz === null) continue;
    notes.push({
      key: `reading.${porada}`,
      text: t(klucz, { count: model.droppedCount, max: CATEGORICAL_SAFE_SERIES }),
      defect: false,
    });
  }

  const honesty = model.honesty;
  // Liczba okresów, w których cokolwiek zmierzono - do wstawki {{actual}}.
  // POLICZONA TU, BO MODEL JEJ NIE ODDAJE: `declaredSampleOk` porównuje ją
  // z `sampleSize` u siebie, ale zwraca sam werdykt, więc zdanie „w podpisie
  // stoi n = X, a okresów z pomiarem jest Y" nie ma skąd wziąć Y. To drugi
  // zapis tej samej decyzji i zgłaszam go jako defekt modelu, a nie jako
  // wzorzec do naśladowania.
  const okresyZPomiarem = model.periods.reduce(
    (a, _label, i) => a + (model.series.some((s) => s.source[i] !== null) ? 1 : 0),
    0,
  );

  if (honesty.baseInRangeOk === false) {
    notes.push({
      key: "honesty.baseInRangeOk",
      text: t("indexBase.honesty.baseInRangeOk", { period: model.baseLabel }),
      defect: true,
    });
  }
  if (honesty.baseNamedOk === false) {
    notes.push({
      key: "honesty.baseNamedOk",
      text: t("indexBase.honesty.baseNamedOk"),
      defect: true,
    });
  }
  if (honesty.baseUsableOk === false) {
    notes.push({
      key: "honesty.baseUsableOk",
      text: t("indexBase.honesty.baseUsableOk", { names: honesty.noBaseSeries.join(", ") }),
      defect: true,
    });
  }
  if (honesty.baseTypicalOk === false) {
    notes.push({
      key: "honesty.baseTypicalOk",
      text: t("indexBase.honesty.baseTypicalOk", { names: honesty.extremeBaseSeries.join(", ") }),
      defect: true,
    });
  }
  if (honesty.indexRepresentableOk === false) {
    notes.push({
      key: "honesty.indexRepresentableOk",
      text: t("indexBase.honesty.indexRepresentableOk", {
        names: honesty.unrepresentableSeries.join(", "),
      }),
      defect: true,
    });
  }
  if (honesty.signStableOk === false) {
    notes.push({
      key: "honesty.signStableOk",
      text: t("indexBase.honesty.signStableOk", { names: honesty.mixedSignSeries.join(", ") }),
      defect: true,
    });
  }
  if (honesty.spreadOk === false) {
    notes.push({
      key: "honesty.spreadOk",
      text: t("indexBase.honesty.spreadOk"),
      defect: true,
    });
  }
  if (honesty.pointsInPeriodsOk === false) {
    notes.push({
      key: "honesty.pointsInPeriodsOk",
      text: t("indexBase.honesty.pointsInPeriodsOk", { count: honesty.droppedValueCount }),
      defect: true,
    });
  }
  // LICZBA Z PODPISU CYTOWANA, A NIE PODSTAWIANA. `declaredSampleOk` jest
  // `false` wyłącznie wtedy, gdy autor podał `n` (bez `n` model milczy
  // `null`-em), więc drugi warunek nigdy nie odrzuca zdania - stoi tu po to,
  // żeby pod wstawkę `{{declared}}` nie dało się wpuścić zera zastępczego.
  // Zero w zdaniu „w podpisie stoi n = 0" jest zdaniem o podpisie, którego
  // nikt nie napisał, a wygląda dokładnie tak wiarygodnie jak liczba
  // przeczytana z konfiguracji.
  const podpisaneN = orNull(config.sampleSize);
  if (honesty.declaredSampleOk === false && podpisaneN !== null) {
    notes.push({
      key: "honesty.declaredSampleOk",
      text: t("indexBase.honesty.declaredSampleOk", {
        declared: podpisaneN,
        actual: okresyZPomiarem,
      }),
      defect: true,
    });
  }

  // SERIA ODRZUCONA NIE ZNIKA PO CICHU. Nazwa plus POWÓD, bo szereg nieobecny
  // wśród obecnych czyta się jako „nie było takiego szeregu", a nie jako „nie
  // dało się go zaindeksować" - i to jest kłamstwo o liczbie porównywanych
  // podmiotów. Agregat `baseUsableOk` wymienia nazwy, ale nie rozróżnia trzech
  // przyczyn, a każda z nich jest dla autora inną poprawką.
  for (const s of model.series) {
    if (s.rejection === null) continue;
    notes.push({
      key: `rejection.${s.rejection}.${s.index}`,
      text: `${s.name}: ${t(REJECTION_KEYS[s.rejection])}`,
      defect: true,
    });
  }

  // SERIA PŁASKA jest jedynym przypisem serii, którego nie powtarza żaden
  // agregat uczciwości (odstającą bazę, zmienny znak i wypadnięte punkty
  // wymieniają z nazwy `baseTypicalOk`, `signStableOk` i
  // `indexRepresentableOk`). Bez niego linia leżąca dokładnie na linii
  // odniesienia jest na rysunku NIEWIDOCZNA i nie da się jej odróżnić od
  // serii, której nie narysowano.
  for (const s of model.series) {
    if (!s.notes.includes("flat")) continue;
    notes.push({
      key: `note.flat.${s.index}`,
      text: `${s.name}: ${t("indexBase.note.flat")}`,
      defect: false,
    });
  }

  // BRAK OSI OKRESÓW ALBO BRAK DANYCH NIE MOŻE ZNACZYĆ „PUSTE MIEJSCE", ale
  // nie może też znaczyć „wysyp ostrzeżeń": przypisy, jeśli jakieś są, idą
  // dalej, a rysunku nie ma czego narysować. Wyjście MUSI stać po wszystkich
  // hakach (patrz `useTapAwayDismiss` wyżej) i przed geometrią.
  if (model.periodCount === 0 || !maDane) {
    return notes.length === 0 ? null : (
      <div ref={revealRef} className={revealClassName(revealState)}>
        <ChartNotes notes={notes} />
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  RYSUNEK                                                                */
  /* ---------------------------------------------------------------------- */

  const yBazy = value(finite(model.baseline));
  const pokazKropki = shouldShowDots(model.periodCount, 0);
  const cascade = cascadeStepMs(model.periodCount);

  /**
   * Ciągi punktów rozdzielone lukami - luka MUSI przerwać linię.
   *
   * INDEKS OKRESU JEDZIE RAZEM Z PIKSELEM, bo ciąg JEDNOPUNKTOWY nie ma
   * odcinka: `pathFromPoints` zwraca dla niego samo `M`, a ścieżka z samym
   * `M` NIE RYSUJE NICZEGO. Bez tej informacji pomiar otoczony z obu stron
   * lukami znikał z rysunku bez śladu wszędzie tam, gdzie kropki są
   * wyłączone (powyżej `DOTS_MAX_POINTS` okresów) - zmierzone: trzydzieści
   * okresów, dwa pomiary w środku szeregu, na rysunku zero znaczników i
   * ścieżka „M33.0 296.0 M360.9 12.0". Czytelnik widział wtedy pusty wykres
   * przy danych, które są, a to jest to samo kłamstwo co seria zniknięta bez
   * słowa, tylko o pojedynczej obserwacji.
   */
  const pociagniecia = (s: IndexBaseSeriesModel): { punkty: Point[]; indeksy: number[] }[] => {
    const out: { punkty: Point[]; indeksy: number[] }[] = [];
    let biezacy: { punkty: Point[]; indeksy: number[] } = { punkty: [], indeksy: [] };
    s.indexed.forEach((v, i) => {
      if (v === null) {
        if (biezacy.punkty.length > 0) out.push(biezacy);
        biezacy = { punkty: [], indeksy: [] };
        return;
      }
      biezacy.punkty.push([okres(i), value(finite(v))]);
      biezacy.indeksy.push(i);
    });
    if (biezacy.punkty.length > 0) out.push(biezacy);
    return out;
  };

  // ETYKIETY KOŃCÓW ROZSUNIĘTE W PIONIE. Wysokość etykiety niesie wartość
  // tylko z dokładnością do przylegania do linii, więc rozsunięcie o wiersz
  // jest tańsze niż dwa napisy jeden na drugim - ale robi się je wyłącznie
  // przy kolizji, a nie profilaktycznie.
  const yEtykiet = new Map<number, number>();
  if (bezposrednie) {
    const surowe = naRysunku
      .filter((s) => s.lastIndex !== null)
      .map((s) => ({ index: s.index, y: value(finite(s.lastIndex as number)) }))
      .sort((a, b) => a.y - b.y);
    // Wysokość poprzedniej etykiety trzymana W ZMIENNEJ, a nie odczytywana
    // z mapy z awaryjnym `?? surowe[i-1].y`: mapa ma tę pozycję ZAWSZE (właśnie
    // ją wpisaliśmy w poprzednim obrocie), więc odczyt awaryjny był gałęzią,
    // której nie da się wykonać - a gałąź niewykonalna wygląda w przeglądzie
    // jak obsłużony przypadek.
    let poprzednia: number | null = null;
    for (const s of surowe) {
      // Typ wpisany JAWNIE: bez niego `tsc` widzi `y` i `poprzednia` jako parę
      // definicji odwołujących się do siebie (TS7022) i porzuca wnioskowanie.
      const y: number =
        poprzednia !== null && s.y < poprzednia + END_LABEL_MIN_GAP
          ? poprzednia + END_LABEL_MIN_GAP
          : s.y;
      yEtykiet.set(s.index, y);
      poprzednia = y;
    }
    // BLOK ETYKIET WRACA DO POLA RYSUNKU. Rozsuwanie idzie w dół, więc przy
    // czterech liniach kończących się obok siebie u dna osi najniższa etykieta
    // wypadała POD płótnem: zmierzone na seriach kończących się na
    // 100,1..100,4 przy wysokości 200 px - ostatnia etykieta na 218 px, czyli
    // 18 px poniżej rysunku, wprost na liście przypisów pod nim. Przesunięcie
    // jest WSPÓLNE dla całego bloku, bo tylko wtedy zostaje zachowana
    // kolejność serii i prześwit między napisami; pojedyncze przycięcie
    // najniższej etykiety postawiłoby ją na sąsiedniej.
    // Skrajne wysokości czytane Z MAPY, a nie ze zmiennej pętli z awaryjnym
    // `?? PAD_TOP`: pusta mapa daje tu `-Infinity` i `+Infinity`, z których
    // wychodzi przesunięcie zero, więc przypadek „nie ma czego przesuwać"
    // obsługuje arytmetyka, a nie gałąź, której nie da się wykonać.
    const nadmiar = Math.max(...yEtykiet.values()) - (PAD_TOP + innerH);
    const najwyzsza = Math.min(...yEtykiet.values(), PAD_TOP + innerH);
    const przesuniecie = Math.max(0, Math.min(nadmiar, najwyzsza - PAD_TOP));
    if (przesuniecie > 0) {
      for (const [seria, y] of yEtykiet) yEtykiet.set(seria, y - przesuniecie);
    }
  }

  const indexFromPointer = (e: PointerEvent<SVGRectElement>): number => {
    const point = pointerToPlot(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
      innerW,
      innerH,
    );
    if (point === null) return 0;
    return nearestPointIndex(point.x, innerW, model.periodCount);
  };

  /** Liczba albo KRESKA. `null` znaczy milczenie, nie zero. */
  const liczba = (v: number | null): string => (v === null ? "-" : formatChartValue(v, lang, ""));

  const czynny = active !== null && active >= 0 && active < model.periodCount ? active : null;

  // DYMEK POKAZUJE TAKŻE SERIE ODRZUCONE, z kreską zamiast liczby. Seria
  // pominięta w dymku znikałaby czytelnikowi drugi raz - a kreska mówi
  // „ten szereg istnieje i nie ma tu indeksu", czyli dokładnie to, co jest
  // prawdą.
  const tooltipRows: TooltipRow[] =
    czynny === null
      ? []
      : model.series
          .filter((s) => s.n > 0)
          .map((s) => ({
            name: s.name,
            value: liczba(s.indexed[czynny]),
            colorSlot: s.indexable ? s.colorSlot : null,
          }));

  const ariaLabel = [
    config.title ? t("a11y.chart", { title: config.title }) : t("a11y.chartUntitled"),
    t("indexBase.base.label", { period: model.baseLabel }),
    t("indexBase.axis.unitless"),
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <div ref={revealRef} className={revealClassName(revealState)}>
      <div
        ref={widthRef}
        className="neh-canvas relative w-full select-none"
        style={{
          height,
          borderRadius: "var(--chart-radius)",
          ["--neh-step" as string]: `${cascade}ms`,
        }}
        tabIndex={0}
        role="img"
        aria-label={ariaLabel}
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        onBlur={clearActive}
      >
        <span id={hintId} className="sr-only">
          {t("a11y.keyboardHint")}
        </span>
        <svg width={width} height={height} className="block overflow-visible">
          {config.showGrid &&
            scale.ticks.map((tick) => (
              <line
                key={tick}
                x1={padLeft}
                x2={padLeft + innerW}
                y1={value(tick)}
                y2={value(tick)}
                stroke="var(--chart-grid)"
                strokeWidth={1}
              />
            ))}

          {/* Podziałki osi wartości. BEZ JEDNOSTKI - to punkty indeksu, a nie
              mld EUR; zdanie o tym stoi przypisem pod rysunkiem. */}
          {scale.ticks.map((tick) => (
            <text
              key={tick}
              x={padLeft - 8}
              y={value(tick) + 3.5}
              textAnchor="end"
              fontSize={FONT_AXIS}
              fill="var(--muted-foreground)"
              className="tabular-nums"
            >
              {formatAxisTick(tick, lang)}
            </text>
          ))}

          {/* ===== LINIA ODNIESIENIA NA STU =====
              Bez niej indeks nie ma znaczenia: „112" jest liczbą dopiero
              wtedy, gdy widać, skąd się liczy. Rysowana z `model.baseline`,
              czyli z tej samej stałej, którą model mnoży iloraz - podpis
              „= 100" i mnożnik nie mogą się rozjechać, bo są jedną liczbą.
              Kreskowana, żeby nie czytała się jako szósta seria. */}
          <line
            data-role="index-baseline"
            x1={padLeft}
            x2={padLeft + innerW}
            y1={yBazy}
            y2={yBazy}
            stroke="var(--chart-axis)"
            strokeWidth={1.5}
            strokeDasharray="5 3"
          />
          <text
            data-role="index-baseline-label"
            x={padLeft + innerW}
            y={yBazy - 6}
            textAnchor="end"
            fontSize={FONT_AXIS}
            fill="var(--foreground)"
            className="tabular-nums"
          >
            {t("indexBase.base.label", { period: model.baseLabel })}
          </text>

          {/* OKRES BAZOWY OZNACZONY NA OSI. Pionowa kreska plus wyróżniona
              etykieta - dwa nośniki, bo sam pogrubiony napis ginie w rzędzie
              podziałek, a sama kreska nie mówi, który to okres. */}
          {model.baseAt !== null && (
            <line
              data-role="base-period-marker"
              x1={okres(model.baseAt)}
              x2={okres(model.baseAt)}
              y1={PAD_TOP}
              y2={PAD_TOP + innerH}
              stroke="var(--chart-axis)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          )}

          {/* Oś okresów. */}
          <line
            x1={padLeft}
            x2={padLeft + innerW}
            y1={PAD_TOP + innerH}
            y2={PAD_TOP + innerH}
            stroke="var(--chart-axis)"
            strokeWidth={1}
          />

          {podpisaneOkresy.map((i) => {
            const bazowy = i === model.baseAt;
            const ostatni = i === model.periodCount - 1;
            return (
              <text
                key={`p${i}`}
                data-role={bazowy ? "base-period" : "period"}
                x={okres(i)}
                y={PAD_TOP + innerH + 16}
                textAnchor={i === 0 ? "start" : ostatni ? "end" : "middle"}
                fontSize={FONT_AXIS}
                fontWeight={bazowy ? 600 : undefined}
                fill={bazowy ? "var(--foreground)" : "var(--muted-foreground)"}
                className="tabular-nums"
              >
                {model.periods[i]}
              </text>
            );
          })}

          {/* ===== LINIE SERII =====
              Wyłącznie serie INDEKSOWALNE. Reszta nie jest tu rysowana zerem
              ani jedynką w mianowniku - jest wymieniona w przypisie z powodem
              i zostaje w tabeli danych z wartościami źródłowymi. */}
          {naRysunku.map((s) => {
            const biegi = pociagniecia(s);
            const d = biegi
              .map((bieg) => pathFromPoints(bieg.punkty, 0))
              .filter(Boolean)
              .join(" ");
            // Okresy, których NIE NIESIE żadne pociągnięcie - patrz
            // `pociagniecia`. Ich marker rysuje się niezależnie od progu
            // kropek, bo jest dla nich jedynym nośnikiem pomiaru.
            const samotne = new Set(
              biegi.filter((bieg) => bieg.punkty.length === 1).map((bieg) => bieg.indeksy[0]),
            );
            const kreskowana = s.colorSlot > CATEGORICAL_SAFE_SERIES;
            const podpis = skrocNazwe(s.name);
            const yPodpisu = yEtykiet.get(s.index);
            return (
              <g key={`s${s.index}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={`var(--chart-${s.colorSlot})`}
                  strokeWidth={LINE_PX}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  className={kreskowana ? "neh-line neh-line-pattern" : "neh-line"}
                  data-role="series-line"
                  data-series={s.index}
                />
                {s.indexed.map((v, i) =>
                  v === null || !(pokazKropki || samotne.has(i)) ? null : (
                    <circle
                      key={i}
                      cx={okres(i)}
                      cy={value(finite(v))}
                      r={DOT_R_PX}
                      // Kropka w kolorze PŁYTY z obwódką w kolorze serii:
                      // widać sam pierścień, a on czyta się jako „tu jest
                      // pomiar", nie jako kolejny znacznik danych.
                      fill="var(--card)"
                      stroke={`var(--chart-${s.colorSlot})`}
                      strokeWidth={DOT_RING_PX}
                      className="neh-dot neh-fade"
                      data-role="series-point"
                      data-series={s.index}
                      data-lone={samotne.has(i) ? "true" : undefined}
                      data-active={czynny === i ? "true" : undefined}
                    />
                  ),
                )}
                {/* ETYKIETA BEZPOŚREDNIA przy końcu linii - w WARIANCIE
                    TEKSTOWYM slotu, bo identyfikuje serię: próg kontrastu dla
                    tekstu to 4,5:1, dla linii 3,0:1. Wysokość idzie z planu
                    antykolizyjnego wyżej; seria bez pozycji w planie nie
                    dostaje etykiety, bo etykieta bez policzonej wysokości
                    stanęłaby na cudzej. */}
                {bezposrednie && yPodpisu !== undefined && (
                  <text
                    data-role="series-end-label"
                    data-series={s.index}
                    x={padLeft + innerW + 6}
                    y={yPodpisu + 3.5}
                    fontSize={FONT_AXIS}
                    fill={`var(--chart-${s.colorSlot}t)`}
                    className="neh-fade neh-value-label"
                  >
                    {podpis}
                    {/* Wielokropek BEZ podpowiedzi jest zakazany (sekcja 4),
                        więc `<title>` stoi dokładnie wtedy, gdy coś ucięto -
                        przy nazwie mieszczącej się w marginesie powtarzałby
                        napis, który czytelnik i tak widzi. */}
                    {podpis !== s.name && <title>{s.name}</title>}
                  </text>
                )}
              </g>
            );
          })}

          {/* Prowadnica czynnego okresu. Rysowana TYLKO przy wskazaniu, więc
              Escape przywraca rysunek dokładnie do stanu sprzed strzałki. */}
          {czynny !== null && (
            <line
              className="neh-crosshair"
              data-role="active-period"
              x1={okres(czynny)}
              x2={okres(czynny)}
              y1={PAD_TOP}
              y2={PAD_TOP + innerH}
            />
          )}

          <rect
            className="neh-hit"
            x={padLeft}
            y={PAD_TOP}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerDown={(e) => setActive(indexFromPointer(e))}
            onPointerMove={(e) => setActive(indexFromPointer(e))}
            onPointerLeave={(e) => {
              // Dotyk NIE gasi dymka przy opuszczeniu warstwy: palec schodzi
              // z ekranu po każdym stuknięciu. Gasi go stuknięcie poza
              // wykresem (`useTapAwayDismiss`).
              if (e.pointerType !== "touch") setActive(null);
            }}
          />
        </svg>

        <ChartTooltip
          visible={czynny !== null}
          x={czynny === null ? 0 : okres(czynny)}
          y={yBazy}
          containerWidth={width}
          title={czynny === null ? "" : model.periods[czynny]}
          note={
            czynny !== null && czynny === model.baseAt ? t("indexBase.table.baseRow") : undefined
          }
          rows={tooltipRows}
        />
      </div>

      <ChartNotes notes={notes} />
    </div>
  );
}
