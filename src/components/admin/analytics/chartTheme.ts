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
  // Support both raw colours ("#123abc") and hsl-triplet tokens ("221 83% 53%").
  if (raw.startsWith("#") || raw.startsWith("rgb") || raw.startsWith("hsl")) return raw;
  return `hsl(${raw})`;
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
// Migawka jest porzucana, gdy znika OSTATNI subskrybent: bez wykresu na ekranie
// nie ma czego trzymać ciepłego, a przy okazji nie ma stanu przeciekającego
// między trasami panelu.
type ChartThemeListener = () => void;

const listeners = new Set<ChartThemeListener>();
let snapshot: ResolvedTheme | null = null;
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
 * Bieżący motyw - identyczna REFERENCJA, dopóki tokeny się nie zmieniły.
 * `useSyncExternalStore` wymaga stabilnej migawki: nowy obiekt przy każdym
 * odczycie zapętliłby render.
 */
export function chartThemeSnapshot(): ResolvedTheme {
  if (!snapshot) snapshot = resolveChartTheme();
  return snapshot;
}

/** Subskrypcja zmian motywu. Zwraca funkcję odpinającą (kontrakt Reacta). */
export function subscribeChartTheme(listener: ChartThemeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) snapshot = null;
  };
}

/**
 * Przelicz tokeny i rozgłoś TYLKO gdy się zmieniły. Woła to każdy wykres po
 * zamontowaniu (przez `scheduleChartThemeRefresh`) oraz zmiana `themeVersion`.
 */
export function notifyChartThemeChanged(): void {
  const next = resolveChartTheme();
  if (snapshot && sameTheme(snapshot, next)) return;
  snapshot = next;
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

/** Baseline option every chart merges over — dark-mode aware axes + tooltip. */
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

export type { ResolvedTheme };
