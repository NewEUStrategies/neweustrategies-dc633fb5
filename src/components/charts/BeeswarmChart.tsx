// BEESWARM (ROZRZUT ULOWY) - ROZKŁAD, W KTÓRYM WIDAĆ KAŻDĄ OBSERWACJĘ.
//
// PYTANIE ANALITYCZNE. Tabela doboru formy (sekcja 1 specyfikacji), wiersz
// "Rozkład wartości -> histogram, boxplot, beeswarm", a w kolumnie "Czego
// unikać" jedna pozycja: "średnia bez rozproszenia". Beeswarm jest tym
// miejscem tego wiersza, w którym nie ma ani zsypywania obserwacji do
// przedziałów (histogram), ani streszczania ich do pięciu liczb (skrzynka):
// każda obserwacja stoi osobno, na dokładnej pozycji swojej wartości. Za tę
// wierność płaci się miejscem, więc forma działa przy próbie kilkudziesięciu
// obserwacji - i dlatego `beeswarmFormAdvice` mówi wprost, kiedy jest złym
// wyborem.
//
// CZEGO DLA TEGO RODZAJU NIE WOLNO, i wszystkie trzy zakazy widać w kodzie:
//   * NIE WOLNO PODAĆ SAMEJ ŚREDNIEJ. Nazwa dostępna niesie CAŁY komplet
//     pozycyjny w stałej kolejności `BEESWARM_SUMMARY_COLUMNS`, a nie jedną
//     liczbę. Czytelnik ekranu jest jedynym czytelnikiem, który chmury nie
//     zobaczy, więc dla niego ten wykres MUSI być kompletem liczb - inaczej
//     rodzaj zaprojektowany przeciw "średniej bez rozproszenia" oddaje mu
//     dokładnie średnią bez rozproszenia;
//   * NIE WOLNO LOSOWAĆ PRZESUNIĘĆ. Nie ma tu `Math.random` ani własnej
//     arytmetyki rozsuwania: przesunięcie prostopadłe przychodzi z modelu
//     w polu `offset`, a komponent MNOŻY je przez promień punktu i nic więcej
//     z nim nie robi. Ten sam arkusz daje ten sam obrazek, bo inaczej zrzut
//     ekranu we wpisie nie zgadza się z wpisem;
//   * NIE WOLNO RYSOWAĆ BEZ `n`. Podpis każdej grupy niesie jej liczebność
//     obok nazwy (sekcja 8: "Podaj n") - chmura trzydziestu i trzystu punktów
//     wygląda podobnie, a znaczy co innego.
//
// ===== DECYZJE ARCHITEKTONICZNE =====
//
// 1. OŚ WARTOŚCI JEST POZIOMA, ROJE SĄ WIERSZAMI. Alternatywa (wartość w
//    pionie, grupy jako kolumny) była gorsza z dwóch powodów naraz: etykietą
//    roju jest NAZWA, a nazwy czyta się w wierszu, nie pod kolumną, więc przy
//    grupach w kolumnach silnik musiałby zjechać drabiną obrotów z sekcji 4
//    dla podpisów, które w lewym marginesie mieszczą się bez obracania; i
//    drugie, ważniejsze - rozsuwanie mieści tym więcej punktów, im DŁUŻSZA
//    jest oś wartości, a pole rysunku w tym silniku jest szersze niż wyższe
//    (około 660 na 284 px). Pozioma oś wartości daje więc mniej przepełnień
//    pasma na tych samych danych, czyli mniej sytuacji, w których forma
//    przestaje być użyteczna.
//
// 2. PROMIEŃ PUNKTU JEST JEDNOSTKĄ MODELU, WIĘC MUSI BYĆ LICZBĄ W JS.
//    Model nie zna pikseli: geometria rozsuwania jedzie w PROMIENIACH punktu
//    i wchodzi do niego przez `spanRadii` (długość osi wartości podzielona
//    przez promień) i `halfBandRadii`. Nie da się więc wziąć promienia
//    z tokena `--chart-dot`, bo tokenu nie widać z JavaScriptu bez czytania
//    arkusza - a repozytorium tego zabrania wprost (patrz `DELICACY_TOKENS`:
//    "Komponent ich NIE czyta"), bo gałąź na motyw w JS przestaje działać
//    w druku. Konsekwencja jest twarda: kropka NIE MOŻE mieć klasy
//    `.neh-dot`, bo ta klasa ustawia `r` z tokena i nadpisałaby promień, dla
//    którego policzono rozsunięcie. Kropka o innym promieniu niż jednostka
//    rozsuwania nakłada się z sąsiadami dokładnie tam, gdzie dane są
//    najgęstsze - czyli rysunek pokazywałby mniejszą gęstość w szczycie
//    rozkładu, a to jest cały defekt, przed którym ten rodzaj ma chronić.
//
// 3. DOPASOWANIE PROMIENIA JEST PĘTLĄ, NIE MNOŻENIEM. Gdy rój nie mieści się
//    w pasmie, model NIE dociska punktów (dociśnięcie dałoby nakładki, czyli
//    kłamstwo o gęstości) - zwraca `fitsInBand: false` i podpowiedź
//    `radiusScaleToFit`. Podpowiedź jest, jak mówi jej własna dokumentacja,
//    DOLNYM oszacowaniem korekty: mniejszy promień to inna jednostka, więc oś
//    ma wtedy więcej promieni długości, punkty rozjeżdżają się wzdłuż niej
//    i rój układa się płaściej niż z prostego przeskalowania. Dlatego promień
//    zmniejszamy i model PRZELICZAMY, do trzech przejść albo do podłogi
//    czytelności. Jedno mnożenie wyniku (kuszące, bo tańsze) dałoby rysunek,
//    o którym model nie zaświadczył - twierdziłby, że rozsunął punkty, których
//    nie widział.
//
// 4. PRZEPEŁNIENIA NIE PRZYCINAMY. Gdy po pętli rój nadal nie mieści się
//    w pasmie, punkty rysują się tam, gdzie wyszły, a nie na krawędzi pasma.
//    Dociśnięcie do pasma jest tym samym kłamstwem, którego odmówił model, a
//    o tym, że forma jest tu zła, mówi porada `doesNotFit` w opisie wykresu.
//
// CZEGO TEN KOMPONENT NIE LICZY: niczego. Podział arkusza na roje, kolejność,
// rozsuwanie, komplet pozycyjny, sufit punktów i wszystkie sprawdzenia
// uczciwości pochodzą z `lib/charts/kinds/beeswarm.ts`. Tu jest wyłącznie
// skalowanie na piksele, dobór promienia i rysowanie.
import {
  useCallback,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type { ChartConfig } from "@/lib/charts/types";
import { formatAxisTick, formatChartValue, type ChartLang } from "@/lib/charts/format";
import { linearScale, niceScale } from "@/lib/charts/scale";
import {
  BEESWARM_EDGE_PAD_RADII,
  BEESWARM_MAX_COMFORT,
  BEESWARM_MIN_OBSERVATIONS,
  BEESWARM_SUMMARY_COLUMNS,
  beeswarmExtent,
  beeswarmFormAdvice,
  beeswarmModelFromConfig,
  type BeeswarmFormAdvice,
  type BeeswarmModel,
  type BeeswarmSummary,
} from "@/lib/charts/kinds/beeswarm";
import {
  CATEGORY_LABEL_MAX_CHARS,
  CATEGORY_LABEL_MAX_WIDTH,
  FONT_AXIS,
  MIN_INNER_H,
  MIN_INNER_W,
  PAD_BOTTOM,
  PAD_LEFT_CATEGORY_MIN,
  PAD_SIDE,
  PAD_TOP,
  valueTickTarget,
} from "@/lib/charts/geometry";
import { nearestPointInCloud, pointerToPlot, type PlotPoint } from "@/lib/charts/plot";
import { estimateMaxLabelWidth } from "@/lib/charts/measureText";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useTapAwayDismiss } from "@/hooks/useTapAwayDismiss";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { ChartTooltip, type TooltipRow } from "./ChartTooltip";
import "@/lib/i18n-charts";

/**
 * Promień kropki obserwacji w pikselach, punkt wyjścia dopasowania.
 *
 * Sekcja 3 daje korytarz 2,5-3 px dla kropki obserwacji. Bierzemy GÓRNY
 * koniec, bo tutaj kropka jest jedynym znacznikiem na rysunku (nie leży na
 * linii, która sama niesie kształt) i musi być policzalna wzrokiem, a nie
 * tylko widoczna. Nie schodzimy niżej także dlatego, że obwódka w kolorze
 * płyty zjada z widocznej powierzchni jeden piksel z każdej strony.
 */
const POINT_R_PX = 3;

/**
 * Podłoga dopasowania promienia.
 *
 * Poniżej 1,5 px kropka z obwódką 1 px przestaje być kropką - obwódka zjada
 * większość powierzchni i chmura zamienia się w szarą mgłę, w której nie da
 * się policzyć obserwacji. Czyli poniżej tej podłogi forma i tak nie
 * dowozi swojej obietnicy, więc dalsze zmniejszanie kupowałoby "mieści się
 * w pasmie" za cenę "nie widać obserwacji" - a to jest zła zamiana. Zamiast
 * niej zostaje porada `doesNotFit`.
 */
const POINT_R_MIN_PX = 1.5;

/**
 * Ile razy wolno przeliczyć model, szukając promienia, przy którym rój wchodzi
 * w pasmo.
 *
 * Trzy, bo każde przejście to pełne rozsunięcie wszystkich punktów, a przy
 * próbie złożonej z samych równych wartości koszt rozsuwania rośnie
 * kwadratowo - pięć przejść na dwóch tysiącach punktów blokowałoby wątek
 * renderujący. Trzy przejścia wystarczają, bo pierwsza korekta jest
 * oszacowaniem z zapasem (patrz decyzja 3 w nagłówku), a nie krokiem
 * połowienia.
 */
const FIT_PASSES = 3;

/**
 * Obwódka kropki, w pikselach. NIE token `--chart-dot-ring` (1,4-1,6 px):
 * ten jest wymierzony dla kropki ODWRÓCONEJ z sekcji 3 - wypełnienie w kolorze
 * płyty, obwódka w kolorze serii - gdzie obwódka niesie tożsamość serii.
 * Tutaj role są odwrotne: wypełnienie niesie kolor grupy, a obwódka jest
 * WYŁĄCZNIE separatorem stykających się punktów, więc 1,6 px zjadłoby ponad
 * połowę powierzchni kropki o promieniu 3 px i osłabiło jedyny nośnik
 * tożsamości grupy.
 */
const RING_PX = 1;

/**
 * Prześwit między pasmami sąsiednich rojów, w pikselach (pierwszy szczebel
 * skali odstępów z `geometry.ts`).
 *
 * Bez niego skrajne punkty dwóch sąsiednich rojów stykają się i czytają jako
 * jedna chmura - a wtedy podpis grupy mówi o granicy, której na obrazku nie
 * ma. Odejmujemy go od dostępnej połowy pasma PRZED przeliczeniem na
 * promienie, więc model widzi miejsce, które faktycznie jest, a nie miejsce
 * z prześwitem włącznie.
 */
const BAND_GAP_PX = 4;

/**
 * Powiększenie kropki pod wskaźnikiem. Jeden piksel i tylko promień - sekcja 6
 * dopuszcza JEDNĄ zmianę geometrii na hover, bo promień markera nie koduje
 * wartości (koduje ją pozycja). Wszystko inne musi zostać nieruchome.
 */
const HOVER_R_PX = 1;

/**
 * Najniższe pasmo, w którym podpis grupy zmieści się w dwóch wierszach (nazwa
 * plus liczebność). Dwa wiersze pisma 11 px z odstępem to około 24 px, więc
 * przy 26 px jest jeszcze powietrze; niżej podpis schodzi do jednego wiersza
 * z liczebnością w nawiasie, bo dwa wiersze zaczęłyby wchodzić w pasmo
 * sąsiada i podpis wskazywałby nie na swój rój.
 */
const CAPTION_TWO_LINE_MIN_PX = 26;

/** Odstęp podpisów od pola rysunku - ten sam co w kartezjańskim. */
const LABEL_GAP_PX = 8;

/** Jedna obserwacja gotowa do narysowania. */
interface BeeDot {
  /** Pozycja w płaskiej liście - adres stanu czynnego i wynik trafienia. */
  i: number;
  /** Klucz Reacta stabilny wobec zmiany kolejności rysowania. */
  key: string;
  /** Indeks roju - nośnik przynależności do grupy także po zmianie kolejności. */
  swarm: number;
  swarmLabel: string;
  colorSlot: number;
  label: string;
  value: number;
  cx: number;
  cy: number;
  /** Ta sama pozycja w układzie POLA RYSUNKU - dla strefy trafienia. */
  plot: PlotPoint;
}

interface BeeswarmChartProps {
  config: ChartConfig;
  lang: ChartLang;
}

/** Liczba skończona albo wartość zastępcza - patrz "ZERO NaN NA EKRANIE". */
function px(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Klucze NOT DLA CZYTELNIKA, wypisane jawnie, a nie sklejone z wartości
 * modelu - i to jest zmiana wobec pierwszej wersji tego pliku, w której klucz
 * powstawał interpolacją `t(\`beeswarm.advice.${a}\`)`. Bramka rozjazdu
 * kod-słownik i kontrola parytetu PL/EN widzą wyłącznie pełne ścieżki, więc
 * klucz sklejony jest dla nich niewidoczny: literówka w nazwie porady
 * przechodziła obie bramki i objawiała się dopiero surowym kluczem na ekranie.
 *
 * `null` ZNACZY „ten komunikat nie ma nic dla czytelnika". Porada formy
 * rozpada się na OBSERWACJĘ o tym rysunku i ZALECENIE zmiany formy albo
 * danych; pod rysunkiem stoi tylko obserwacja, zalecenie widzi autor
 * w edytorze bloku.
 */
const READING_KEYS: Record<BeeswarmFormAdvice, string | null> = {
  // „Beeswarm jest formą NAJUCZCIWSZĄ, nie zamieniaj go na boxplot" mówi
  // wyłącznie do autora i jest pochwałą jego wyboru - pod rysunkiem byłaby
  // zdaniem, które chwali samo siebie i nic nie mówi o danych.
  tooFew: null,
  tooMany: "beeswarm.reading.tooMany",
  noSpread: "beeswarm.reading.noSpread",
  doesNotFit: "beeswarm.reading.doesNotFit",
  truncated: "beeswarm.reading.truncated",
};

/** Ucięcie etykiety grupy; pełną treść niesie `<title>`, bo sekcja 4 zabrania
 *  wielokropka bez podpowiedzi. */
function clipLabel(label: string): string {
  return label.length > CATEGORY_LABEL_MAX_CHARS
    ? `${label.slice(0, CATEGORY_LABEL_MAX_CHARS - 1)}…`
    : label;
}

export function BeeswarmChart({ config, lang }: BeeswarmChartProps) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = useCallback(
    (key: string, values?: Record<string, string | number>): string =>
      scoped(key, { lng: lang, ...values }),
    [scoped, lang],
  );
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>();
  const { ref: revealRef, state: revealState } = useRevealOnScroll<HTMLDivElement>(config.animate);
  const [active, setActive] = useState<number | null>(null);
  const baseId = useId();
  const hintId = `${baseId}-hint`;
  const noteId = `${baseId}-note`;
  const height = config.height;

  const geometry = useMemo(() => {
    // PRZEJŚCIE ZERO: model policzony BEZ znajomości pikseli, wyłącznie po
    // zakres danych i po etykiety rojów. Marginesy zależą od etykiet, pasmo
    // od liczby rojów, a jedno i drugie od podziału arkusza - czyli od
    // roboty, którą umie tylko model. Alternatywa (przeczytanie
    // `config.series` tutaj) byłaby DRUGĄ implementacją odczytu arkusza:
    // luk, krótszych tablic i trybu grupowania. Dwie implementacje tego
    // samego odczytu rozjeżdżają się cicho, a rozjazd między osią i chmurą
    // punktów wygląda jak inne dane, nie jak błąd.
    const probe = beeswarmModelFromConfig(config);
    const extent = beeswarmExtent(probe);
    // OŚ BEZ WYMUSZONEGO ZERA - beeswarm koduje wartość POZYCJĄ, nie
    // długością (sekcja 8: "Dla liniowego zero nie jest wymagane"). Ucięcie
    // trzeba NAZWAĆ w podpisie i to jest zadanie ramy wykresu; dociąganie osi
    // płac od zera zepchnęłoby cały rozkład w jeden pasek u prawej krawędzi.
    const scale = niceScale(extent.min, extent.max, valueTickTarget(height, true));

    const labelW = estimateMaxLabelWidth(
      probe.swarms.map((s) => clipLabel(s.label)),
      FONT_AXIS,
    );
    // MIERZ, POTEM UKŁADAJ (sekcja 4): margines lewy wychodzi z szerokości
    // podpisów, nie odwrotnie - inaczej nazwa grupy zostaje ucięta krawędzią
    // płyty, a ucięta etykieta to wymaganie bezwzględne złamane.
    const padLeft = Math.min(
      CATEGORY_LABEL_MAX_WIDTH,
      Math.max(PAD_LEFT_CATEGORY_MIN, labelW + PAD_SIDE),
    );
    const innerW = Math.max(MIN_INNER_W, width - padLeft - PAD_SIDE);
    const innerH = Math.max(MIN_INNER_H, height - PAD_TOP - PAD_BOTTOM);
    const bandH = probe.swarms.length > 0 ? innerH / probe.swarms.length : innerH;

    const przelicz = (r: number): BeeswarmModel =>
      beeswarmModelFromConfig(config, {
        // TA SAMA DOMENA, KTÓRĄ RYSUJEMY. Model liczy odległości w
        // promieniach, czyli PRZEZ skalę: policzone dla innej domeny niż
        // narysowana dałyby punkty nakładające się na obrazku, choć model
        // twierdzi, że je rozsunął.
        domain: { min: scale.min, max: scale.max },
        // Zapas na krawędziach: obserwacja o wartości równej krańcowi domeny
        // jest kołem, nie kreską, więc bez zapasu wystaje za pole rysunku
        // dokładnie o promień i zostaje ucięta. Ucięty punkt skrajny to
        // najczęściej najważniejsza liczba na wykresie.
        spanRadii: Math.max(1, innerW / r - 2 * BEESWARM_EDGE_PAD_RADII),
        // Podłoga na jednym promieniu jest OBOWIĄZKOWA: dla pasma niższego
        // niż prześwit wyszłaby liczba niedodatnia, a model podmienia takie
        // wejście na swoją wartość domyślną (osiem promieni) - czyli
        // zaświadczyłby "mieści się" o pasmie, którego nie ma.
        halfBandRadii: Math.max(1, (bandH - BAND_GAP_PX) / 2 / r),
      });

    let radius = POINT_R_PX;
    let model = przelicz(radius);
    for (let pass = 0; pass < FIT_PASSES; pass += 1) {
      // `!== false` a nie `=== true`: `null` znaczy "nie ma czego sprawdzać"
      // (próba pusta), a wtedy zmniejszanie promienia byłoby reakcją na brak
      // danych.
      if (model.honesty.fitsInBand !== false) break;
      if (radius <= POINT_R_MIN_PX) break;
      const next = Math.max(POINT_R_MIN_PX, radius * model.radiusScaleToFit);
      // Brak postępu przerywa pętlę zamiast kręcić nią do limitu: gdy
      // podpowiedź modelu jest jedynką (rój nie mieści się z innego powodu
      // niż promień), kolejne przejścia policzyłyby dokładnie ten sam wynik.
      if (!(next < radius)) break;
      radius = next;
      model = przelicz(radius);
    }

    const pad = radius * BEESWARM_EDGE_PAD_RADII;
    const along = linearScale(
      model.domain.min,
      model.domain.max,
      padLeft + pad,
      padLeft + innerW - pad,
    );

    const dots: BeeDot[] = [];
    for (const s of model.swarms) {
      const cy0 = px(PAD_TOP + s.center * innerH, PAD_TOP + innerH / 2);
      for (const p of s.points) {
        const cx = px(along(p.value), padLeft + innerW / 2);
        // PRZESUNIĘCIE PROSTOPADŁE = `offset` RAZY PROMIEŃ. Cała rola
        // komponentu w rozsuwaniu mieści się w tym mnożeniu; gdyby dołożył
        // choćby "trochę rozrzutu dla urody", pozycja przestałaby być
        // funkcją danych.
        const cy = px(cy0 + p.offset * radius, cy0);
        dots.push({
          i: dots.length,
          key: `${s.index}:${p.sourceIndex}`,
          swarm: s.index,
          swarmLabel: s.label,
          colorSlot: s.colorSlot,
          label: p.label,
          value: p.value,
          cx,
          cy,
          plot: { x: cx - padLeft, y: cy - PAD_TOP },
        });
      }
    }

    return {
      model,
      scale,
      radius,
      padLeft,
      innerW,
      innerH,
      bandH,
      along,
      dots,
      plotPoints: dots.map((d) => d.plot),
    };
  }, [config, height, width]);

  const { model, scale, radius, padLeft, innerW, innerH, bandH, along, dots, plotPoints } =
    geometry;

  // `useTapAwayDismiss` MUSI stać przed jakimkolwiek wczesnym wyjściem - hooki
  // nie mogą się warunkowo pomijać, a wyjście "brak obserwacji" jest niżej.
  const clearActive = useCallback(() => setActive(null), []);
  useTapAwayDismiss(active !== null, widthRef, clearActive);

  const czynny: BeeDot | null = active === null ? null : (dots[active] ?? null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (dots.length === 0) return;
    if (e.key === "Escape") {
      setActive(null);
      return;
    }
    // WZDŁUŻ OSI WARTOŚCI, W OBRĘBIE SWOJEGO ROJU. Płaska lista jest
    // posortowana rosnąco po wartości wewnątrz roju, więc strzałka czyta
    // rozkład w kolejności, w jakiej się go opowiada. Przeskok na koniec roju
    // do MINIMUM roju sąsiedniego byłby skokiem przez cały rysunek - dlatego
    // między grupami chodzi się strzałkami pionowymi.
    const wzdluz = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (wzdluz !== 0) {
      e.preventDefault();
      setActive((prev) => {
        if (prev === null) return wzdluz > 0 ? 0 : dots.length - 1;
        const teraz = dots[prev];
        const kandydat = dots[prev + wzdluz];
        if (teraz === undefined || kandydat === undefined) return prev;
        return kandydat.swarm === teraz.swarm ? prev + wzdluz : prev;
      });
      return;
    }
    // MIĘDZY ROJAMI, PRZY NAJBLIŻSZEJ WARTOŚCI. Nie "ten sam numer
    // obserwacji", bo numer w roju o innej liczebności wskazuje inne miejsce
    // rozkładu - a pytanie, które zadaje się pionem na tym wykresie, brzmi
    // "co ma druga grupa w tym samym miejscu osi".
    const wpoprzek = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (wpoprzek === 0) return;
    e.preventDefault();
    setActive((prev) => {
      const teraz = prev === null ? null : (dots[prev] ?? null);
      if (teraz === null) return wpoprzek > 0 ? 0 : dots.length - 1;
      const cel = teraz.swarm + wpoprzek;
      let best: number | null = null;
      let bestOdleglosc = Number.POSITIVE_INFINITY;
      for (const d of dots) {
        if (d.swarm !== cel) continue;
        const odleglosc = Math.abs(d.value - teraz.value);
        // Ostro mniejsze, więc przy remisie wygrywa punkt o niższym indeksie -
        // ta sama reguła co w `nearestPointInCloud`, żeby klawiatura i
        // wskaźnik nie wskazywały różnych obserwacji w tym samym miejscu.
        if (odleglosc < bestOdleglosc) {
          bestOdleglosc = odleglosc;
          best = d.i;
        }
      }
      return best ?? prev;
    });
  };

  if (dots.length === 0) return null;

  const indexFromPointer = (e: PointerEvent<SVGRectElement>): number | null => {
    const point = pointerToPlot(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
      innerW,
      innerH,
    );
    if (point === null) return null;
    // NAJBLIŻSZY PUNKT CHMURY, nie pasmo i nie jedna współrzędna: na jednej
    // pozycji osi wartości leży wiele obserwacji rozsuniętych prostopadle,
    // więc sama współrzędna pozioma nie wskazuje żadnej z nich. Próg
    // `HIT_RADIUS_PX` zostaje domyślny - `null` znaczy "pod wskaźnikiem nie ma
    // obserwacji" i jest uczciwszą odpowiedzią niż dymek nad punktem, którego
    // tam nie ma.
    return nearestPointInCloud(point, plotPoints);
  };

  // Kolejność rysowania: punkt czynny NA KOŃCU, czyli na wierzchu. Powiększony
  // o piksel promień inaczej chowałby się pod sąsiadami narysowanymi później,
  // a wtedy podświetlenie wskazywałoby nie ten punkt, o którym mówi dymek.
  const doRysunku = czynny === null ? dots : [...dots.filter((d) => d.i !== czynny.i), czynny];

  // DYMEK JAKO WIERSZ TABELI DANYCH: trzy pola rekordu obserwacji, nazwane
  // nagłówkami tej tabeli, więc czytelnik uczy się jednego porządku (sekcja
  // 5). Osobnego tytułu nad tymi wierszami nie ma celowo - powtarzałby jedno
  // z nich i dodawał czwarty wiersz bez informacji.
  const tooltipRows: TooltipRow[] = czynny
    ? [
        {
          name: t("beeswarm.table.value"),
          value: formatChartValue(czynny.value, lang, config.unit),
          colorSlot: czynny.colorSlot,
          emphasised: true,
        },
        ...(czynny.label
          ? [
              {
                name: t("beeswarm.table.label"),
                value: czynny.label,
                colorSlot: null,
              },
            ]
          : []),
        {
          name: t("beeswarm.table.group"),
          value: czynny.swarmLabel,
          colorSlot: null,
        },
      ]
    : [];

  const opisRoju = (label: string, summary: BeeswarmSummary | null): string => {
    if (summary === null) return `${label}: ${t("beeswarm.summary.n")} 0`;
    // KOLEJNOŚĆ Z MODELU (`BEESWARM_SUMMARY_COLUMNS`), nie własna: tabela
    // danych pod wykresem czyta z tej samej listy, więc czytelnik ekranu
    // i czytelnik tabeli dostają liczby w tym samym porządku.
    const czesci = BEESWARM_SUMMARY_COLUMNS.map(
      (col) =>
        // `n` jest LICZNIKIEM obserwacji, nie wartością - jednostka przy nim
        // ("12 mld EUR" zamiast "12 obserwacji") byłaby fałszem.
        `${t(`beeswarm.summary.${col}`)} ${formatChartValue(
          summary[col],
          lang,
          col === "n" ? "" : config.unit,
        )}`,
    );
    return `${label}: ${czesci.join(", ")}`;
  };

  const ariaLabel = [
    config.title,
    `${t("beeswarm.axis.value")}: ${formatAxisTick(scale.min, lang)} - ${formatAxisTick(
      scale.max,
      lang,
    )}`,
    ...model.swarms.map((s) => opisRoju(s.label, s.summary)),
  ]
    .filter(Boolean)
    .join(". ");

  // UWAGI: porada formy i defekty danych. Idą do OPISU wykresu, a nie na
  // płytę, i to jest wybór, nie brak miejsca: porada formy jest zdaniem
  // o wyborze rysunku, więc postawiona obok danych konkurowałaby z tym, co
  // krytykuje, a rama wykresu (`ChartFrame`) ma na podpis własne pola
  // i własną tabelę. Liczb do wstawienia podajemy komplet, bo treść
  // komunikatów pisze słownik - i18next zignoruje te, których nie użyje.
  const truncated = model.swarms.reduce((a, s) => a + s.truncated, 0);
  const zadeklarowane = config.sampleSize ?? 0;
  const uwagi: string[] = [
    ...beeswarmFormAdvice(model)
      .map((a) => READING_KEYS[a])
      .filter((k): k is string => k !== null)
      .map((k) =>
        t(k, {
          count: model.observations,
          min: BEESWARM_MIN_OBSERVATIONS,
          max: BEESWARM_MAX_COMFORT,
          truncated,
          // `shown`/`total` NIE SĄ powtórzeniem `drawn`/`count` z komunikatów
          // uczciwości, tylko nazwami, których używa treść porady
          // `truncated` - i brak tych dwóch liczb w tym worku był defektem
          // WIDOCZNYM: i18next nie podstawia nieznanej zmiennej i zostawia
          // w zdaniu surowe `{{shown}}`, czyli czytelnik dostawał pod
          // rysunkiem klamry zamiast liczby obserwacji. Bramka
          // `chartAdviceAudience.test.ts` liczy teraz miejsca wstawienia
          // każdego komunikatu, żeby to samo nie wróciło przy nowej treści.
          shown: model.drawn,
          total: model.observations,
        }),
      ),
    ...(model.honesty.pointCountOk === false
      ? [
          t("beeswarm.honesty.pointCountOk", {
            drawn: model.drawn,
            count: model.observations,
          }),
        ]
      : []),
    ...(model.honesty.spreadOk === false ? [t("beeswarm.honesty.spreadOk")] : []),
    ...(model.honesty.declaredSampleSizeOk === false
      ? [
          t("beeswarm.honesty.declaredSampleSizeOk", {
            declared: zadeklarowane,
            actual: model.swarms.find((s) => s.n > 0)?.n ?? 0,
          }),
        ]
      : []),
  ];

  return (
    <div ref={revealRef} className={revealClassName(revealState)}>
      <div
        ref={widthRef}
        className="neh-canvas relative w-full select-none"
        style={{ height, borderRadius: "var(--chart-radius)" }}
        tabIndex={0}
        role="img"
        aria-label={ariaLabel}
        aria-describedby={uwagi.length > 0 ? `${hintId} ${noteId}` : hintId}
        onKeyDown={onKeyDown}
        onBlur={clearActive}
      >
        <span id={hintId} className="sr-only">
          {t("a11y.keyboardHint")}
        </span>
        {uwagi.length > 0 && (
          <span id={noteId} className="sr-only">
            {uwagi.join(" ")}
          </span>
        )}
        <svg width={width} height={height} className="block overflow-visible">
          {/* Siatka PIONOWA, bo pionowa jest tu podziałka osi wartości.
              Rusztowanie zostaje cienkie i recesywne (sekcja 3). */}
          {config.showGrid &&
            scale.ticks.map((tick) => (
              <line
                key={tick}
                x1={along(tick)}
                x2={along(tick)}
                y1={PAD_TOP}
                y2={PAD_TOP + innerH}
                stroke="var(--chart-grid)"
                strokeWidth={1}
              />
            ))}

          {/* Oś wartości: linia pod polem rysunku. Nie ma osi kategorii, bo
              kategoria nie jest tu skalą - jest podpisem pasma. */}
          <line
            x1={padLeft}
            x2={padLeft + innerW}
            y1={PAD_TOP + innerH}
            y2={PAD_TOP + innerH}
            stroke="var(--chart-axis)"
            strokeWidth={1}
          />

          {scale.ticks.map((tick) => (
            <text
              key={tick}
              x={along(tick)}
              y={PAD_TOP + innerH + 16}
              textAnchor="middle"
              fontSize={FONT_AXIS}
              fill="var(--muted-foreground)"
              className="neh-bee-tick tabular-nums"
            >
              {formatAxisTick(tick, lang)}
            </text>
          ))}

          {/* PODPIS OSI WARTOŚCI w wolnym narożniku lewego marginesu, na linii
              bazowej podziałki. Oś, na której leży cała treść tego wykresu,
              musi być nazwana na rysunku - inaczej czytelnik zrzutu ekranu
              wie tylko, że coś rośnie w prawo. */}
          <text
            x={padLeft - LABEL_GAP_PX}
            y={PAD_TOP + innerH + 16}
            textAnchor="end"
            fontSize={FONT_AXIS}
            fill="var(--muted-foreground)"
            className="neh-bee-axis"
          >
            {clipLabel(t("beeswarm.axis.value"))}
            <title>{t("beeswarm.axis.value")}</title>
          </text>

          {/* PODPIS ROJU: nazwa i JEGO `n`. Liczebność jest obowiązkowa
              (sekcja 8) i musi stać przy grupie, a nie tylko w podpisie pod
              całym wykresem: przy dwóch rojach o różnej liczebności jedno
              wspólne `n` mówiłoby o próbie, której nie ma. */}
          {model.swarms.map((s) => {
            const cy = px(PAD_TOP + s.center * innerH, PAD_TOP + innerH / 2);
            const dwuwiersz = bandH >= CAPTION_TWO_LINE_MIN_PX;
            const licznosc = formatChartValue(s.n, lang, "");
            const nazwa = clipLabel(s.label);
            return (
              <g key={s.index}>
                <text
                  x={padLeft - LABEL_GAP_PX}
                  y={dwuwiersz ? cy - 2 : cy + 3.5}
                  textAnchor="end"
                  fontSize={FONT_AXIS}
                  fill="var(--foreground)"
                  className={dwuwiersz ? "neh-bee-label" : "neh-bee-label neh-bee-n tabular-nums"}
                >
                  {dwuwiersz ? nazwa : `${nazwa} (${licznosc})`}
                  <title>{`${s.label}. ${t("beeswarm.summary.n")} ${licznosc}`}</title>
                </text>
                {dwuwiersz && (
                  <text
                    x={padLeft - LABEL_GAP_PX}
                    y={cy + 11}
                    textAnchor="end"
                    fontSize={FONT_AXIS}
                    fill="var(--muted-foreground)"
                    className="neh-bee-n tabular-nums"
                  >
                    {`${t("beeswarm.summary.n")} ${licznosc}`}
                  </text>
                )}
              </g>
            );
          })}

          {/* ===== OBSERWACJE =====
              WYPEŁNIENIE W KOLORZE GRUPY, OBWÓDKA W KOLORZE PŁYTY - odwrotnie
              niż kropka na linii z sekcji 3, i to jest świadome odwrócenie.
              Na linii kropka nie może zasłonić linii, więc dostaje wypełnienie
              płyty; tutaj kropka JEST daną, a punktów stykających się jest
              wiele, więc wypełnienie musi nieść tożsamość grupy, a obwódka
              rozdzielać sąsiadów BEZ wprowadzania drugiego koloru. Blade
              wnętrze (wariant domyślny słupka) jest tu wykluczone: 1,20-1,28:1
              do płyty wystarcza dla powierzchni słupka, ale kropka o promieniu
              3 px w takim wypełnieniu jest niewidoczna, a chmura z niej
              zbudowana nie pokazuje gęstości. */}
          {doRysunku.map((d) => (
            <circle
              key={d.key}
              className="neh-bee-dot neh-fade"
              cx={d.cx}
              cy={d.cy}
              r={active === d.i ? radius + HOVER_R_PX : radius}
              fill={`var(--chart-${d.colorSlot})`}
              stroke="var(--card)"
              data-swarm={d.swarm}
              data-active={active === d.i ? "true" : undefined}
              // Grubość obwódki przez `style`, nie atrybutem prezentacyjnym:
              // atrybut przegrywa z każdą regułą arkusza, a `var()` w atrybucie
              // SVG nie jest wspierany wszędzie.
              style={{ strokeWidth: `${RING_PX}px` }}
            />
          ))}

          {/* Warstwa trafień na CAŁE pole rysunku - strefa trafienia nigdy nie
              jest kształtem elementu (sekcja 6), a kropka o promieniu 3 px jest
              nietrafialna palcem. */}
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
              // z ekranu po każdym stuknięciu, więc dymek zniknąłby zawsze
              // natychmiast po pokazaniu. Gasi go stuknięcie poza wykresem
              // (`useTapAwayDismiss`).
              if (e.pointerType !== "touch") setActive(null);
            }}
          />
        </svg>

        <ChartTooltip
          visible={czynny !== null}
          x={czynny ? czynny.cx : 0}
          y={czynny ? czynny.cy : 0}
          containerWidth={width}
          title=""
          rows={tooltipRows}
        />
      </div>
    </div>
  );
}
