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
import { finite } from "@/lib/charts/num";
import {
  indexBaseExtent,
  indexBaseFormAdvice,
  indexBaseModelFromConfig,
  type IndexBaseFormAdvice,
  type IndexBaseRejection,
  type IndexBaseSeriesModel,
  type IndexBaseSource,
} from "@/lib/charts/kinds/indexBase";
import {
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
    const nazwyKoncow = bezposrednie ? naRysunku.map((s) => s.name) : [];
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

  // Co która etykieta okresu, żeby napisy się nie stykały bokami. Pierwsza,
  // ostatnia i BAZOWA są podpisane zawsze: bez pierwszej i ostatniej nie
  // wiadomo, jaki odcinek czasu pokazuje rysunek, a bez bazowej nie wiadomo,
  // wobec czego liczona jest każda wartość.
  const krokEtykiet = useMemo(() => {
    const n = model.periodCount;
    if (n <= 1) return 1;
    const najszersza = Math.max(estimateMaxLabelWidth(model.periods, FONT_AXIS), FONT_AXIS);
    const naOkres = Math.max(1, innerW / (n - 1));
    return Math.max(1, Math.ceil((najszersza + PERIOD_LABEL_GAP) / naOkres));
  }, [model.periods, model.periodCount, innerW]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (model.periodCount === 0) return;
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
    notes.push({
      key: `base.source.${model.baseSource}`,
      text: t(BASE_SOURCE_KEYS[model.baseSource]),
      defect: false,
    });
    if (model.axisTruncatedFromZero) {
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
  if (honesty.declaredSampleOk === false) {
    notes.push({
      key: "honesty.declaredSampleOk",
      text: t("indexBase.honesty.declaredSampleOk", {
        declared: config.sampleSize ?? 0,
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

  /** Ciągi punktów rozdzielone lukami - luka MUSI przerwać linię. */
  const ciagi = (s: IndexBaseSeriesModel): Point[][] => {
    const out: Point[][] = [];
    let biezacy: Point[] = [];
    s.indexed.forEach((v, i) => {
      if (v === null) {
        if (biezacy.length > 0) out.push(biezacy);
        biezacy = [];
        return;
      }
      biezacy.push([okres(i), value(finite(v))]);
    });
    if (biezacy.length > 0) out.push(biezacy);
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
    for (let i = 0; i < surowe.length; i++) {
      const y =
        i > 0 &&
        surowe[i].y < (yEtykiet.get(surowe[i - 1].index) ?? surowe[i - 1].y) + END_LABEL_MIN_GAP
          ? (yEtykiet.get(surowe[i - 1].index) ?? surowe[i - 1].y) + END_LABEL_MIN_GAP
          : surowe[i].y;
      yEtykiet.set(surowe[i].index, y);
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

          {model.periods.map((label, i) => {
            const bazowy = i === model.baseAt;
            const ostatni = i === model.periodCount - 1;
            if (!bazowy && !ostatni && i !== 0 && i % krokEtykiet !== 0) return null;
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
                {label}
              </text>
            );
          })}

          {/* ===== LINIE SERII =====
              Wyłącznie serie INDEKSOWALNE. Reszta nie jest tu rysowana zerem
              ani jedynką w mianowniku - jest wymieniona w przypisie z powodem
              i zostaje w tabeli danych z wartościami źródłowymi. */}
          {naRysunku.map((s) => {
            const d = ciagi(s)
              .map((ciag) => pathFromPoints(ciag, 0))
              .filter(Boolean)
              .join(" ");
            const kreskowana = s.colorSlot > CATEGORICAL_SAFE_SERIES;
            return (
              <g key={`s${s.index}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={`var(--chart-${s.colorSlot})`}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  className={kreskowana ? "neh-line neh-line-pattern" : "neh-line"}
                  data-role="series-line"
                  data-series={s.index}
                />
                {pokazKropki &&
                  s.indexed.map((v, i) =>
                    v === null ? null : (
                      <circle
                        key={i}
                        cx={okres(i)}
                        cy={value(finite(v))}
                        // Kropka w kolorze PŁYTY z obwódką w kolorze serii:
                        // widać sam pierścień, a on czyta się jako „tu jest
                        // pomiar", nie jako kolejny znacznik danych.
                        fill="var(--card)"
                        stroke={`var(--chart-${s.colorSlot})`}
                        className="neh-dot neh-fade"
                        data-role="series-point"
                        data-series={s.index}
                        data-active={czynny === i ? "true" : undefined}
                      />
                    ),
                  )}
                {/* ETYKIETA BEZPOŚREDNIA przy końcu linii - w WARIANCIE
                    TEKSTOWYM slotu, bo identyfikuje serię: próg kontrastu dla
                    tekstu to 4,5:1, dla linii 3,0:1. Pozycja pionowa idzie
                    z `lastIndex` modelu, żeby render nie szukał ostatniego
                    pomiaru po tablicy z lukami drugi raz. */}
                {bezposrednie && s.lastIndex !== null && (
                  <text
                    data-role="series-end-label"
                    data-series={s.index}
                    x={padLeft + innerW + 6}
                    y={(yEtykiet.get(s.index) ?? value(finite(s.lastIndex))) + 3.5}
                    fontSize={FONT_AXIS}
                    fill={`var(--chart-${s.colorSlot}t)`}
                    className="neh-fade neh-value-label"
                  >
                    {s.name}
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
          title={czynny === null ? "" : (model.periods[czynny] ?? "")}
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
