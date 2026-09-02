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

const FALLBACK_PALETTE = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7"] as const;
const FALLBACK_MUTED = "#6b7280";
const FALLBACK_BORDER = "#e5e7eb";
const FALLBACK_FOREGROUND = "#111827";
const FALLBACK_BG = "#ffffff";

interface ResolvedTheme {
  palette: string[];
  muted: string;
  border: string;
  foreground: string;
  background: string;
  primary: string;
  success: string;
  warning: string;
  danger: string;
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

export function resolveChartTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      palette: [...FALLBACK_PALETTE],
      muted: FALLBACK_MUTED,
      border: FALLBACK_BORDER,
      foreground: FALLBACK_FOREGROUND,
      background: FALLBACK_BG,
      primary: FALLBACK_PALETTE[0],
      success: "#16a34a",
      warning: "#f59e0b",
      danger: "#dc2626",
    };
  }
  const style = getComputedStyle(document.documentElement);
  const palette = [1, 2, 3, 4, 5].map((i) =>
    readVar(style, `--chart-${i}`, FALLBACK_PALETTE[(i - 1) % FALLBACK_PALETTE.length]),
  );
  return {
    palette,
    muted: readVar(style, "--muted-foreground", FALLBACK_MUTED),
    border: readVar(style, "--border", FALLBACK_BORDER),
    foreground: readVar(style, "--foreground", FALLBACK_FOREGROUND),
    background: readVar(style, "--background", FALLBACK_BG),
    primary: readVar(style, "--primary", palette[0]),
    success: "#16a34a",
    warning: "#f59e0b",
    danger: "#dc2626",
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

function sameTheme(a: ResolvedTheme, b: ResolvedTheme): boolean {
  return (
    a.muted === b.muted &&
    a.border === b.border &&
    a.foreground === b.foreground &&
    a.background === b.background &&
    a.primary === b.primary &&
    a.palette.length === b.palette.length &&
    a.palette.every((colour, i) => colour === b.palette[i])
  );
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
export function baseOption(theme: ResolvedTheme): EChartsCoreOption {
  return {
    color: theme.palette,
    backgroundColor: "transparent",
    textStyle: {
      color: theme.foreground,
      fontFamily:
        '"Red Hat Display", "Red Hat Display Fallback", system-ui, -apple-system, "Segoe UI", sans-serif',
    },
    animationDuration: 400,
    animationEasing: "cubicOut",
    grid: { left: 44, right: 20, top: 32, bottom: 32, containLabel: true },
    legend: {
      textStyle: { color: theme.muted, fontSize: 11 },
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 6,
      top: 4,
      right: 4,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: theme.background,
      borderColor: theme.border,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: theme.foreground, fontSize: 12 },
      extraCssText: "box-shadow: 0 6px 20px -6px rgba(0,0,0,0.18); border-radius: 8px;",
    },
    xAxis: {
      axisLine: { lineStyle: { color: theme.border } },
      axisTick: { lineStyle: { color: theme.border } },
      splitLine: { show: false },
      axisLabel: { color: theme.muted, fontSize: 11 },
    },
    yAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: theme.border, type: "dashed" } },
      axisLabel: { color: theme.muted, fontSize: 11 },
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
