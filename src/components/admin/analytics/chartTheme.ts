/**
 * BI chart theme wired to the project's semantic CSS tokens (--chart-1..5,
 * --primary, --muted-foreground, --border). ECharts is themed at runtime rather
 * than statically so it follows theme-mode changes without a rebuild.
 *
 * Guiding principles:
 * - Never hardcode colours in individual charts; consume `getChartPalette()`.
 * - Tooltip/axis/legend copy comes from the caller's option; this file only
 *   sets primitives (colours, grid, animation, font).
 * - SSR-safe: `getComputedStyle` is guarded and falls back to a light-mode set.
 */
import type { EChartsCoreOption } from "echarts/core";
import {
  CATEGORICAL_SAFE_MAX,
  CHART_SEMANTIC,
  seriesColors,
  seriesTextColors,
} from "@/lib/charts/palette";

/**
 * Paleta zapasowa dla SSR i dla braku tokenów. Pochodzi z `lib/charts/palette`,
 * czyli z TEGO SAMEGO źródła, które pilnuje kontrastu i rozdzielności dla
 * daltonizmu - wcześniej stała tu druga, niezwalidowana lista pięciu hexów,
 * która rozjechała się z arkuszem i nikt tego nie widział, bo fallback
 * odpala się tylko na serwerze.
 *
 * SZEŚĆ, nie osiem: powyżej sześciu odcieni paleta przestaje być rozdzielna
 * dla któregoś rodzaju widzenia barw, a panel BI nie ma mechanizmu drugiego
 * nośnika różnicy (kreskowania), którym silnik SVG ratuje sloty 7-8.
 */
const FALLBACK_PALETTE = seriesColors("light", CATEGORICAL_SAFE_MAX);
const FALLBACK_PALETTE_TEXT = seriesTextColors("light", CATEGORICAL_SAFE_MAX);
const FALLBACK_MUTED = "#6b7482";
const FALLBACK_BORDER = "#d9dbd4";
const FALLBACK_FOREGROUND = "#12161c";
const FALLBACK_BG = "#ffffff";
const FALLBACK_GRID = "#ecede8";
const FALLBACK_AXIS = "#d9dbd4";
const FALLBACK_TIP_BG = "#1a1f27";
const FALLBACK_TIP_INK = "#ffffff";

/**
 * Rodzina czcionki dla KANWY. Kanwa nie dziedziczy czcionki dokumentu i nie
 * rozumie `var()`, więc tu MUSI stać rozwiązany napis - inaczej wykres
 * eksportowany do PNG ma inny krój niż ten na ekranie. Wartość idzie z tokena
 * `--chart-font`, czyli z ustawienia panelu admina; poniżej stoi wyłącznie
 * stos zapasowy dla SSR i dla tenanta, który nic nie wybrał.
 */
const FALLBACK_FONT =
  '"Red Hat Display", "Red Hat Display Fallback", system-ui, -apple-system, "Segoe UI", sans-serif';

interface ResolvedTheme {
  /** Wypełnienia serii - sześć slotów rozdzielnych dla daltonizmu. */
  palette: string[];
  /**
   * Warianty TEKSTOWE tych samych slotów. Osobne pole, bo próg kontrastu dla
   * tekstu to 4,5:1, a dla linii 3,0:1: etykieta pisana kolorem linii wygląda
   * spójnie i nie przechodzi audytu dostępności.
   */
  paletteText: string[];
  muted: string;
  border: string;
  /** Siatka - kontrast poniżej 1,3:1 do płyty, czyli wyczuwalna, nie widoczna. */
  grid: string;
  /** Oś bazowa - MOCNIEJSZA od siatki (1,40:1), bo zero jest informacją. */
  axis: string;
  foreground: string;
  background: string;
  primary: string;
  /** Rodzina czcionki, rozwiązana dla kanwy (patrz FALLBACK_FONT). */
  font: string;
  /**
   * Semantyka znaku. Dodatni jest niebieskim tealem, nie zielenią: para
   * czerwień/zieleń daje przy protanopii odległość 8,5, czyli zysk i strata
   * w jednym kolorze.
   */
  positive: string;
  negative: string;
  /**
   * Trzystopniowa skala porządkowa dobrze/średnio/źle (progi Web Vitals).
   *
   * WYPROWADZONA Z SEMANTYKI, NIE Z SYGNALIZACJI ŚWIETLNEJ. Klasyczne
   * zielony/amber/czerwony ma dwa mierzalne defekty: podłoga odległości po
   * symulacji wynosi 14,4 i wiąże ją para ZIELONY-CZERWONY przy deuteranopii
   * (czyli dokładnie "dobrze" i "źle" w jednym kolorze), a amber #f59e0b ma
   * na białej płycie 2,15:1, więc nie przechodzi nawet progu grafiki.
   * Teal/ochra/czerwień daje podłogę 25,5 na jasnym i 35,4 na ciemnym, a każdy
   * z trzech odcieni przechodzi 3:1 (5,68 / 3,05 / 3,46).
   */
  success: string;
  warning: string;
  danger: string;
  /**
   * Dymek. W trybie jasnym ODWRÓCONY wobec płyty (ciemny prostokąt na białym
   * tle jest czytelny), w ciemnym PODNIESIONY - lustrzane odwrócenie dałoby
   * jasny prostokąt, który świeci jak latarka i rozbija wykres.
   */
  tipBg: string;
  tipBorder: string;
  tipInk: string;
}

/**
 * Goła TRÓJKA HSL - JEDYNA postać tokenu, która wymaga opakowania w `hsl(...)`.
 *
 * Kierunek rozpoznawania jest tu ODWROTNY do listy dozwolonych prefiksów
 * (`#`, `rgb`, `hsl`), na której ten plik stał wcześniej. Składni koloru w CSS
 * jest dużo i wciąż ich przybywa (`oklch`, `lab`, `lch`, `color-mix`, `var`),
 * więc lista prefiksów z natury zostaje o krok z tyłu, a każdy napis, którego
 * nie znała, wychodził stąd jako `hsl(<napis>)` - wartość, której żadna
 * przeglądarka nie sparsuje. Ten projekt wdepnął w to od pierwszego dnia:
 * `src/styles.css` trzyma `--foreground`, `--muted-foreground`, `--border` i
 * `--background` w `oklch(...)`, więc cztery z pięciu niepaletowych pól motywu
 * jechały do ECharts jako `hsl(oklch(0.18 0 0))` - kolor tekstu, etykiet osi,
 * siatki i tła dymka na KAŻDYM wykresie panelu /admin/analytics. ECharts koloru
 * nie waliduje, tylko podaje go kanwie, a kanwa przy nieparsowalnym napisie
 * zostaje przy poprzedniej wartości `fillStyle` - awaria wygląda jak „etykiety
 * są jakoś ciemne", nie jak błąd.
 *
 * Dlatego opakowujemy WYŁĄCZNIE to, co samo w sobie kolorem nie jest: kąt,
 * procent i procent (zapis shadcn, np. `221 83% 53%` - także z przecinkami i z
 * kanałem alfa po ukośniku). Każdy inny NIEPUSTY token idzie dalej dosłownie:
 * jeśli jest poprawnym kolorem CSS, przeglądarka go zrozumie, a jeśli nie jest,
 * to opakowanie w `hsl()` i tak by go nie uratowało.
 */
const BARE_HSL_TRIPLE =
  /^-?\d*\.?\d+(?:deg|grad|rad|turn)?[\s,]+-?\d*\.?\d+%[\s,]+-?\d*\.?\d+%(?:\s*\/\s*-?\d*\.?\d+%?)?$/;

/**
 * Odczyt JEDNEGO tokenu z JUŻ POBRANEJ migawki stylu.
 *
 * Migawka jest PARAMETREM, a nie pobierana tutaj, i to jest cała treść tej
 * zmiany. Wcześniej każde wywołanie robiło własne `getComputedStyle(root)` -
 * dziesięć tokenów to dziesięć wymuszeń przeliczenia stylu na jedno rozwiązanie
 * motywu, a panel BI z dziesięcioma wykresami płacił to dwadzieścia razy
 * (ZMIERZONE: 200 wywołań, patrz `__tests__/EChartClient.test.tsx`).
 * `getComputedStyle` zwraca żywy obiekt `CSSStyleDeclaration`, więc jedna
 * migawka obsługuje wszystkie tokeny bez utraty świeżości.
 */
function readVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const raw = style.getPropertyValue(name).trim();
  if (!raw) return fallback;
  return BARE_HSL_TRIPLE.test(raw) ? `hsl(${raw})` : raw;
}

/** Numery slotów, które panel BI wolno użyć jako kategorii. */
const SLOTS = Array.from({ length: CATEGORICAL_SAFE_MAX }, (_, i) => i + 1);

export function resolveChartTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      palette: [...FALLBACK_PALETTE],
      paletteText: [...FALLBACK_PALETTE_TEXT],
      muted: FALLBACK_MUTED,
      border: FALLBACK_BORDER,
      grid: FALLBACK_GRID,
      axis: FALLBACK_AXIS,
      foreground: FALLBACK_FOREGROUND,
      background: FALLBACK_BG,
      primary: FALLBACK_PALETTE[0],
      font: FALLBACK_FONT,
      positive: CHART_SEMANTIC.positiveLight,
      negative: CHART_SEMANTIC.negativeLight,
      success: CHART_SEMANTIC.positiveLight,
      warning: FALLBACK_PALETTE[1],
      danger: CHART_SEMANTIC.negativeLight,
      tipBg: FALLBACK_TIP_BG,
      tipBorder: "transparent",
      tipInk: FALLBACK_TIP_INK,
    };
  }
  const style = getComputedStyle(document.documentElement);
  const palette = SLOTS.map((i) =>
    readVar(style, `--chart-${i}`, FALLBACK_PALETTE[(i - 1) % FALLBACK_PALETTE.length]),
  );
  const paletteText = SLOTS.map((i) =>
    readVar(style, `--chart-${i}t`, FALLBACK_PALETTE_TEXT[(i - 1) % FALLBACK_PALETTE_TEXT.length]),
  );
  const positive = readVar(style, "--chart-positive", CHART_SEMANTIC.positiveLight);
  const negative = readVar(style, "--chart-negative", CHART_SEMANTIC.negativeLight);
  return {
    palette,
    paletteText,
    muted: readVar(style, "--muted-foreground", FALLBACK_MUTED),
    border: readVar(style, "--border", FALLBACK_BORDER),
    grid: readVar(style, "--chart-grid", FALLBACK_GRID),
    axis: readVar(style, "--chart-axis", FALLBACK_AXIS),
    foreground: readVar(style, "--foreground", FALLBACK_FOREGROUND),
    background: readVar(style, "--background", FALLBACK_BG),
    primary: readVar(style, "--primary", palette[0]),
    // Czcionka wykresu schodzi z panelu admina; `--chart-font` jest aliasem
    // `--font-sans`, a ten - ustawienia `fonts.body` tenanta.
    font: readVar(style, "--chart-font", FALLBACK_FONT),
    positive,
    negative,
    success: positive,
    warning: palette[1],
    danger: negative,
    tipBg: readVar(style, "--chart-tip-bg", FALLBACK_TIP_BG),
    tipBorder: readVar(style, "--chart-tip-border", "transparent"),
    tipInk: readVar(style, "--chart-tip-ink", FALLBACK_TIP_INK),
  };
}

// ---------------------------------------------------------------------------
// WSPÓLNA SUBSKRYPCJA MOTYWU - jedna na dokument, nie jedna na wykres.
//
// CO ZASTĘPUJE. W `EChartClient` stał `useEffect(() => setTick(v => v + 1), [])`:
// bezwarunkowy efekt odpalany RAZ NA WYKRES, żeby ponownie odczytać tokeny,
// gdyby nie były gotowe przy pierwszym malowaniu. Powód był PRAWDZIWY -
// `DesignTokensStyle` wstrzykuje paletę tenanta z bazy przez zapytanie
// react-query, więc `--primary` czy `--foreground` potrafią dojechać po
// zamontowaniu wykresu - ale narzędzie było tępe: dziesięć wykresów płaciło
// dziesięć dodatkowych renderów i dwadzieścia rozwiązań motywu, NIEZALEŻNIE od
// tego, czy cokolwiek się zmieniło.
//
// ZASADA TUTAJ: motyw rozwiązywany jest raz, porównywany z poprzednim i
// rozgłaszany WYŁĄCZNIE gdy naprawdę się różni. Gdy tokeny były gotowe od
// pierwszego malowania (przypadek typowy) - zero dodatkowych renderów. Gdy
// dojechały później - dokładnie jedna runda odświeżenia dla całego panelu.
//
// ZMIERZONE (panel dziesięciu wykresów, `__tests__/EChartClient.test.tsx`):
//   przed:  20 renderów · 20 rozwiązań motywu · 200 wywołań getComputedStyle
//   po:     10 renderów ·  2 rozwiązania motywu ·   2 wywołania getComputedStyle
//
// Gdy znika OSTATNI subskrybent, migawka jest OZNACZANA JAKO PODEJRZANA, a nie
// wyrzucana: pierwszy odczyt po powrocie wykresów przelicza tokeny, ale zwraca
// STARĄ referencję, jeśli kolory wyszły identyczne (patrz `adoptTheme`). Dzięki
// temu nic nie przecieka między trasami panelu, a jednocześnie wymiana zakładki
// nie funduje wykresom wymuszonego drugiego renderu.
type ChartThemeListener = () => void;

const listeners = new Set<ChartThemeListener>();
let snapshot: ResolvedTheme | null = null;
let snapshotStale = false;
let refreshScheduled = false;

/**
 * Porównanie migawek. KAŻDE pole `ResolvedTheme` musi być tu wymienione -
 * pole pominięte znaczy, że jego zmiana nie rozgłosi się do wykresów i panel
 * zostanie z poprzednim kolorem po zmianie motywu. Dlatego zamiast listy
 * warunków iterujemy po kluczach: nowe pole jest objęte automatycznie.
 */
function sameTheme(a: ResolvedTheme, b: ResolvedTheme): boolean {
  const keys = Object.keys(a) as Array<keyof ResolvedTheme>;
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) return false;
      if (left.some((value, i) => value !== right[i])) return false;
      continue;
    }
    if (left !== right) return false;
  }
  return true;
}

/**
 * Przyjmij świeży odczyt, ZACHOWUJĄC starą referencję, gdy kolory wyszły
 * identyczne. To jedno miejsce decyduje o tożsamości migawki, bo od niej -
 * a nie od treści - zależy, czy React przerenderuje wykresy.
 */
function adoptTheme(next: ResolvedTheme): ResolvedTheme {
  snapshotStale = false;
  if (snapshot && sameTheme(snapshot, next)) return snapshot;
  snapshot = next;
  return next;
}

/**
 * Bieżący motyw - identyczna REFERENCJA, dopóki tokeny się nie zmieniły.
 * `useSyncExternalStore` wymaga stabilnej migawki: nowy obiekt przy każdym
 * odczycie zapętliłby render.
 */
export function chartThemeSnapshot(): ResolvedTheme {
  if (!snapshot || snapshotStale) return adoptTheme(resolveChartTheme());
  return snapshot;
}

/** Subskrypcja zmian motywu. Zwraca funkcję odpinającą (kontrakt Reacta). */
export function subscribeChartTheme(listener: ChartThemeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    // Ostatni wykres schodzi z ekranu: migawka jest ODTĄD PODEJRZANA, ale NIE
    // wyrzucona. Wyrzucona (`snapshot = null`) rodziła przy następnym odczycie
    // NOWY obiekt nawet dla identycznych kolorów, a `useSyncExternalStore`
    // porównuje migawki przez `Object.is` - czyli każdy wykres, który
    // zamontował się w TYM SAMYM commicie, w którym odmontował się poprzedni
    // panel (przełączenie zakładki /admin/analytics na już wczytane dane),
    // dostawał wymuszony drugi render i drugie `setOption(notMerge)`. Dokładnie
    // ten koszt, który ta subskrypcja miała usunąć, tylko innym wejściem.
    // ZMIERZONE na wymianie panelu 10 -> 10 wykresów: 20 renderów -> 10.
    if (listeners.size === 0) snapshotStale = true;
  };
}

/**
 * Przelicz tokeny i rozgłoś TYLKO gdy się zmieniły. Woła to każdy wykres po
 * zamontowaniu (przez `scheduleChartThemeRefresh`) oraz zmiana `themeVersion`.
 */
export function notifyChartThemeChanged(): void {
  const previous = snapshot;
  if (adoptTheme(resolveChartTheme()) === previous) return;
  for (const listener of [...listeners]) listener();
}

/**
 * Jedno odświeżenie na turę, choćby zawołało je dziesięć wykresów naraz.
 * To jest miejsce, w którym N efektów zamienia się w jeden.
 */
export function scheduleChartThemeRefresh(): void {
  if (refreshScheduled) return;
  refreshScheduled = true;
  queueMicrotask(() => {
    refreshScheduled = false;
    notifyChartThemeChanged();
  });
}

/** Baseline option every chart merges over - dark-mode aware axes + tooltip. */
/**
 * Kreskowanie prowadnic i siatki: 2 px kreski, 4 px przerwy.
 *
 * ECharts przyjmuje tu tablicę liczb (własny `ZRLineType`), ale jej publiczny
 * typ opcji dopuszcza w tym miejscu tylko napis - stąd wcześniej stało tu
 * `[2, 4] as unknown as string`. Podwójne rzutowanie omija kontrolę typów tak
 * samo jak `as any`, tylko nie zapala reguły lintera, i repozytorium pilnuje
 * tego bramką `check:unknown-casts`. Stała opisana `readonly number[]` mówi
 * prawdę o wartości, a `EChartsCoreOption` przyjmuje ją bez rzutowania, bo
 * jego indeks jest luźny - czyli kontrakt z biblioteką nie jest niczym
 * zasłonięty, tylko wyrażony tam, gdzie naprawdę obowiązuje.
 */
const GUIDE_DASH: readonly number[] = [2, 4];

export function baseOption(theme: ResolvedTheme): EChartsCoreOption {
  return {
    color: theme.palette,
    backgroundColor: "transparent",
    textStyle: {
      color: theme.foreground,
      // Rodzina Z TOKENA, czyli z ustawienia panelu admina. Kanwa nie
      // dziedziczy czcionki dokumentu i nie rozumie `var()`, więc rozwiązany
      // napis musi tu dojechać z `resolveChartTheme` - inaczej wykres
      // eksportowany do PNG ma inny krój niż ten na ekranie.
      fontFamily: theme.font,
    },
    // Wejście 500 ms z krzywą hamującą na końcu - te same wartości co
    // w silniku SVG (`--neh-anim-ms`), żeby wykres w panelu i wykres we wpisie
    // wchodziły tym samym ruchem.
    animationDuration: 500,
    animationEasing: "cubicOut",
    // Odstępy wyłącznie ze skali 4 px (48 / 24 / 32 / 32 zamiast 44 / 20).
    grid: { left: 48, right: 24, top: 32, bottom: 32, containLabel: true },
    legend: {
      // Nazwy serii w WARIANCIE TEKSTOWYM - legenda to tekst, więc obowiązuje
      // ją próg 4,5:1, a nie 3,0:1 jak linię. Kolory próbek ECharts bierze
      // z `color`, więc próbka nadal jest w kolorze serii.
      textStyle: { color: theme.muted, fontSize: 11 },
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 6,
      top: 4,
      right: 4,
    },
    tooltip: {
      // NIE MA TU `trigger` - i to jest decyzja, nie przeoczenie.
      //
      // Stało tu `trigger: "axis"` i przechodziło niezauważone WYŁĄCZNIE dzięki
      // usterce płaskiego złączenia: panel, który podawał własny `tooltip`
      // (26 z 27 opcji w repo), wyrzucał tę wartość razem z całą sekcją.
      // Głębokie złączenie dowozi ją tam, gdzie panel jej nie podał - a to są
      // dokładnie wykresy, dla których `trigger: "axis"` jest BŁĘDEM:
      //
      //   * `VitalsBiDashboard.tsx:232` (treemap), `GscBiDashboard.tsx:410`
      //     (treemap), `GscBiDashboard.tsx:452` (kalendarz),
      //     `RelatedPostsAnalytics.tsx:197` (mapa cieplna) - formattery tych
      //     czterech dymków są napisane na KSZTAŁT ELEMENTU
      //     (`raw as { name, value, data }`), a przy wyzwalaczu osiowym ECharts
      //     podaje TABLICĘ punktów. Dymek pokazałby „undefined";
      //   * `Ga4BiDashboard.tsx:417` (radar, `tooltip: {}`) - wyzwalacz osiowy
      //     na wykresie bez osi kartezjańskiej nie pokazuje nic.
      //
      // `trigger` jest własnością TYPU WYKRESU, nie motywu, i nagłówek tego
      // pliku mówi to wprost: baza ustawia PRYMITYWY (kolory, siatka, animacja,
      // czcionka). Wykres, który chce dymka osiowego, deklaruje to u siebie -
      // tak robi dziś 21 z 27 opcji. JEDYNY wykres w repo, który miał `tooltip`
      // wyłącznie z bazy, to `ClientErrorsDashboard.tsx:91`; bez tej linii
      // dostaje domyślny dymek elementu ECharts (wartość słupka po najechaniu),
      // a wyzwalacz osiowy wraca tam jednym polem `tooltip: { trigger: "axis" }`
      // w opcji panelu.
      // Dymek jedzie WŁASNYMI tokenami, nie tłem strony: w trybie jasnym jest
      // odwrócony wobec płyty (ciemny prostokąt na białym tle czyta się
      // najlepiej), a w ciemnym PODNIESIONY o jeden stopień jasności.
      // Lustrzane odwrócenie na ciemnym dałoby jasny prostokąt, który świeci
      // jak latarka i rozbija wykres - dlatego to nie jest `theme.background`.
      backgroundColor: theme.tipBg,
      borderColor: theme.tipBorder,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: theme.tipInk, fontSize: 12, fontFamily: theme.font },
      // Promień z tego samego tokena co karty i słupki - jeden promień
      // na wszystkim.
      extraCssText:
        "box-shadow: 0 8px 24px rgb(0 0 0 / 0.24); border-radius: var(--chart-radius, 6px);",
    },
    xAxis: {
      axisLine: { lineStyle: { color: theme.axis } },
      axisTick: { lineStyle: { color: theme.axis } },
      splitLine: { show: false },
      // `hideOverlap` (ECharts 5.5+) przepuszcza przez sito etykiety, które
      // nachodziłyby na sąsiednie - przy 90 punktach osi czasu zostaje
      // czytelny podzbiór zamiast zlepków dat. `overflow: "truncate"` pilnuje
      // długich kategorii (ścieżki URL, nazwy krajów).
      axisLabel: {
        color: theme.muted,
        fontSize: 11,
        hideOverlap: true,
        overflow: "truncate",
        width: 96,
      },
      // Nazwa osi (np. „Kliknięcia") - bez koloru bierze domyślny ECharts,
      // który w trybie ciemnym jest za ciemny; jedzie tokenem tekstu osi.
      nameTextStyle: { color: theme.muted, fontSize: 10 },
    },
    yAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      // Siatka bierze token siatki, nie obramowania: obramowanie jest
      // MOCNIEJSZE od siatki (1,40:1 wobec 1,18:1 do płyty), a siatka ma być
      // wyczuwalna, nie widoczna. Kreskowanie z tokena prowadnic.
      splitLine: {
        lineStyle: { color: theme.grid, type: GUIDE_DASH },
      },
      axisLabel: { color: theme.muted, fontSize: 11, hideOverlap: true },
      nameTextStyle: { color: theme.muted, fontSize: 10 },
    },
  };
}

// ---------------------------------------------------------------------------
// ZŁĄCZENIE OPCJI PANELU Z BAZĄ MOTYWU - GŁĘBOKIE dla obiektów, ATOMOWE dla
// tablic.
//
// CO BYŁO. `EChartClient` sklejał opcję panelu z bazą PŁASKO:
//
//     return { ...baseOption(theme), ...option }
//
// Rozłożenie płaskie podmienia CAŁĄ wartość pod kluczem, więc panel, który
// podawał `yAxis` choćby tylko po to, żeby ustawić `type: "value"` albo
// `axisLabel.formatter`, wyrzucał z tej osi WSZYSTKO, co baza w niej
// umotywowała: `axisLine`, `axisTick`, `splitLine` i `axisLabel`. Oś zostawała
// z domyślnymi kolorami ECharts - czarne etykiety i jasnoszara siatka, czyli
// w trybie ciemnym praktycznie niewidoczne. Nic nie rzucało, nic nie trafiało
// do konsoli: awaria wygląda jak „ten wykres jest jakoś wyblakły".
//
// ILE TEGO BYŁO (ZMIERZONE na tym HEAD-zie skanem wszystkich literałów opcji
// z kluczem `series`/`dataset` w `src/`, poza testami):
//
//   * 27 opcji wykresów w 8 plikach nadpisuje przynajmniej jedną umotywowaną
//     sekcję bazy - czyli KAŻDA opcja w repo, żadna nie brała bazy w całości;
//   * 89 wystąpień sekcji ginęło łącznie: `tooltip` 26, `yAxis` 18, `xAxis` 18,
//     `grid` 15, `legend` 12 (`textStyle` na najwyższym poziomie nadpisuje
//     dziś zero paneli). 74 z tych 89 niosły KOLORY motywu; pozostałe 15 to
//     `grid`, czyli sama geometria;
//   * na ekranie to do 37 wykresów (33 wykresy paneli BI + 4 iskrówki
//     `KpiTile`); w iskrówkach strata jest nieszkodliwa, bo tam osie mają
//     `show: false`.
//
// Stąd biorą się ręcznie dopisane kolory osi w panelach - i to w postaci
// `"hsl(var(--border))"`, której kanwa NIE POTRAFI rozwiązać (`var()` żyje
// w CSS, a nie w `fillStyle`). Panel łatał tym dziurę, której sam nie zrobił.
//
// DLACZEGO GŁĘBOKIE ZŁĄCZENIE, A NIE „niech panele dopisują kolory same".
// Druga droga (hook `useChartTheme`, patrz `./useChartTheme.ts`) daje panelowi
// WARTOŚCI motywu i jest potrzebna tam, gdzie baza nie zna pola: etykiety
// kalendarza, `itemStyle.borderColor` serii, `rich` w formatterze. Ale jako
// lekarstwo na TĘ usterkę byłaby wyłącznie mnożeniem miejsc, w których łatwo
// zapomnieć: 74 sekcje do ręcznego odtworzenia, w każdym nowym wykresie od
// nowa, bez żadnej bramki. Głębokie złączenie zamyka problem w JEDNYM
// miejscu i działa dla wykresów, których jeszcze nie ma.
//
// REGUŁY (celowo trzy, nie więcej):
//   1. Zwykłe obiekty scalane REKURENCYJNIE, wartość panelu wygrywa na
//      liściach. `undefined` podane przez panel też jest wartością i wygrywa.
//   2. Tablica jest wartością ATOMOWĄ - wchodzi cała, bez scalania po
//      indeksie (patrz `ATOMIC_OPTION_KEYS` i `legend.data`).
//   3. WYJĄTEK dla osi: baza opisuje JEDNĄ oś obiektem, a panel może podać
//      LISTĘ osi. Baza jest wtedy rozgłaszana do KAŻDEGO elementu listy
//      (patrz `AXIS_OPTION_KEYS`).
//
// KOSZT - ZMIERZONY, NIE PRZEMILCZANY. Złączenie chodzi dokładnie tyle razy,
// ile chodziło płaskie: raz na `useMemo([option, theme])` w `EChartClient`.
// Liczby renderów i wywołań `getComputedStyle` się więc NIE zmieniają
// (pilnuje ich `__tests__/EChartClient.test.tsx`, w tym przypadek na dziesięciu
// wykresach z opcją nadpisującą pięć sekcji). Zmienia się sama praca w środku
// jednego złączenia. ZMIERZONE (Node 22.22, 200 tys. przebiegów, najcięższa
// opcja w repo - trend GSC: 3 osie Y, 3 serie, 90 punktów):
//
//   płasko: 0,3 µs/złączenie ·  1 obiekt pomocniczy
//   głęboko: 7,4 µs/złączenie · 10 obiektów pomocniczych
//
// Czyli ~7 µs więcej raz na zmianę opcji albo motywu, ~60 µs na cały panel
// ośmiu wykresów - przy jednym `setOption(notMerge)`, który maluje kanwę
// w milisekundach. Głębokość dotyczy WYŁĄCZNIE zagnieżdżeń obiektowych:
// tablice (`series[].data`, `xAxis.data`) wchodzą przez referencję i nie są
// przechodzone, więc rachunek NIE rośnie z liczbą punktów na wykresie -
// 90 punktów i 9 000 punktów kosztuje tu tyle samo.

/**
 * Sekcje, których NIE WOLNO scalać - wchodzą CAŁE, prosto od panelu.
 *
 * `series` i `dataset` panel nadpisuje świadomie i w całości. Scalenie po
 * indeksie dałoby HYBRYDĘ dwóch serii (słupek panelu, który odziedziczył `type`
 * albo `data` z serii bazowej), a taki wykres nie wygląda na zepsuty - tylko
 * kłamie. Dziś `baseOption` żadnej serii nie ustawia, więc reguła jest NA
 * ZAPAS: pierwszy domyślny `series`/`dataset` w bazie (choćby wspólne
 * `emphasis`) uruchomiłby ten błąd bez jednego ostrzeżenia. Reguła tablicowa
 * (2) sama by tego nie załatwiła, bo `series` bywa też pojedynczym OBIEKTEM.
 */
const ATOMIC_OPTION_KEYS = new Set(["series", "dataset"]);

/**
 * Sekcje, w których baza opisuje JEDNĄ oś, a panel może podać ICH LISTĘ.
 *
 * `baseOption` trzyma `xAxis`/`yAxis` jako obiekt - to są DOMYŚLNE ustawienia
 * osi, nie „oś numer zero". Panel z dwiema albo trzema osiami (np. klikanie /
 * wyświetlenia / CTR w `GscBiDashboard`) podaje tablicę, a reguła tablicowa (2)
 * przepuściłaby ją atomowo i cała baza znów by zginęła - dziś na 2 wykresach
 * i 5 osiach. Dlatego dla tych kluczy baza jest rozgłaszana do KAŻDEGO
 * elementu listy osobno.
 */
const AXIS_OPTION_KEYS = new Set(["xAxis", "yAxis"]);

/** Obiekt, który wolno scalać rekurencyjnie: nie `null`, nie tablica, nie funkcja. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rekurencyjne złączenie jednej sekcji. Wszystko, co nie jest parą zwykłych
 * obiektów (skalar, tablica, funkcja-formatter, `null`), rozstrzyga się na
 * rzecz panelu - bez wchodzenia w środek.
 */
function deepMergeSection(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = deepMergeSection(out[key], value);
  }
  return out;
}

/**
 * Złóż opcję panelu na bazie motywu.
 *
 * Typy są tu celowo strukturalne (`Record<string, unknown>`), nie
 * `EChartsCoreOption`: ta funkcja niczego o ECharts nie wie i da się ją
 * sprawdzić bez atrapy silnika wykresów. Rzutowania robi jedyny wywołujący
 * z kodu produkcyjnego - `EChartClient.mergeWithTheme`.
 */
export function mergeChartOption(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (ATOMIC_OPTION_KEYS.has(key)) {
      out[key] = value;
      continue;
    }
    const baseValue = out[key];
    if (AXIS_OPTION_KEYS.has(key) && Array.isArray(value) && isPlainObject(baseValue)) {
      out[key] = value.map((axis) => deepMergeSection(baseValue, axis));
      continue;
    }
    out[key] = deepMergeSection(baseValue, value);
  }
  return out;
}

export type { ResolvedTheme };
