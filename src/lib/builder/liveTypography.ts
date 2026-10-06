// TYPOGRAFIA WIDGETU W RAMCE: szablon HW-2 (lekki, w chunku wejściowym) i
// podgląd na żywo z edytora.
//
// DWA MODUŁY, CELOWO (Wydajność PSI 85/95, fala 2, P2.4 - HW-2).
//  * TEN moduł jest lekki i ramka widgetu (`ChromeWidgetView`) importuje go
//    statycznie: rozstrzyga typografię (`resolveWidgetTypography`), liczy
//    tokeny `data-wt` i zmienne `--wt-*` szablonu oraz trzyma subskrypcję
//    podglądu na żywo.
//  * `typographyCss.ts` to GENERATOR reguł per widget (długie listy
//    selektorów). Do przeglądarki trafia wyłącznie przez `import()` - serwer
//    ma go statycznie w gałęzi `.server()`. Strażnik `check:entry-purity`
//    pilnuje, żeby generator nie wrócił do chunku wejściowego.
//
// SZABLON (HW-2). Rozmiary czcionek i odstęp tytuł-opis NIE są już osobnym
// blokiem `<style>` z ~1,5 KB reguł na widget. Reguły są raz, na końcu
// publicznego `styles.css` (niewarstwowo, ta sama specyficzność 0,3,0 i to
// samo `!important` co reguły generatora), a ramka niesie tylko dane:
//   <div data-w-id="…" data-wt="tfs dfs"
//        style="--wt-tfs-d:16px;--wt-tfs-t:16px;--wt-tfs-m:14px;…">
// Urządzenie wybiera CSS po `[data-builder-renderer][data-device=…]`
// (dokładnie to, czym renderer przełącza resztę układu), a nie po `@media`:
// przełączenie urządzenia po hydratacji nie przepisuje już żadnego `<style>`
// (zadanie K15 księgi P0.5: 50 x `ParseHTML` w commicie) i nie mutuje stylu
// ramki - tekst stylu ramki od urządzenia nie zależy.
//
// KONTRAKTY SZABLONU (werdykt html-weight:HW-2):
//  * bramka `data-wt~=` jest obowiązkowa - niezdefiniowana zmienna w
//    deklaracji `!important` dałaby `unset` i nadpisała wszystko;
//  * nazwy zmiennych per token szablonu (`fs`, `tfs`, `dfs`), nie per
//    właściwość: zmienna rozwiązuje się po najbliższym przodku, który ją
//    ustawia, czyli tak, jak dziś wygrywa reguła widgetu zagnieżdżonego
//    (późniejsza w źródle). Token `fs` (rozmiar ogólny) zawsze idzie z `tfs`
//    o tej samej wartości - reguły tytułu żyją wyłącznie w szablonie `tfs`;
//  * KAŻDY token emituje wszystkie trzy wartości urządzeń (`-d`, `-t`, `-m`),
//    więc zagnieżdżony widget nigdy nie dziedziczy wartości urządzenia od
//    przodka;
//  * wartości tylko z białej listy (liczba + jednostka, jak `cssLen` slidera).
//    Wartość spoza listy (np. `clamp()`, `var()`, liczba bez jednostki)
//    kieruje CAŁĄ grupę rozmiarów widgetu do generatora: przeglądarka odrzuca
//    błędną deklarację przy parsowaniu i kaskada idzie dalej, a ta sama
//    wartość przez `var()` dałaby `unset` (dziedziczenie). Biała lista nie
//    zmienia więc żadnego wyniku, tylko wybiera drogę.
// Właściwości poza rozmiarem i odstępem (krój, grubość, interlinia,
// światło, transformacja, dekoracja, wyrównanie) zostają w generatorze - na
// produkcji to 6 deklaracji na 31 bloków (pomiar HTML-a z 2026-10-03), a
// szablon ze 140 regułami `:is()` na każdą z nich nie zmieściłby się w
// budżecie CSS (`check:bundle`, zapas ok. 0,6 KB gzip).
import type { Device, Mode, Themed, WidgetTypography } from "./types";
import { pickShared } from "./themed";

const CHANNEL_NAME = "builder-widget-typography";
const EVENT_NAME = "builder:widget-typography";
const STORAGE_PREFIX = "builder:widget-typography:";
const STYLE_ID_PREFIX = "builder-live-typography-style-";

// ---------- wspólne pomocniki (ramka + generator) ----------

/** Najmniejszy rozmiar, jaki ma sens dla realnego tekstu (px). */
const MIN_READABLE_FONT_PX = 6;

/**
 * Rozmiar czcionki bywa zapisany per urządzenie z czasów, gdy panel pozwalał
 * ustawiać każdy breakpoint osobno - w danych zostały wartości typu `1px`
 * (przypadkowy klik w stepper), przez które etykieta sekcji na mobile była
 * praktycznie niewidoczna. Traktujemy taką wartość jak brak i schodzimy po
 * łańcuchu urządzeń do pierwszej czytelnej.
 */
function isUnreadableFontSize(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = value.trim().match(/^(-?[\d.]+)\s*px$/i);
  if (!match) return false;
  const px = Number(match[1]);
  return Number.isFinite(px) && px < MIN_READABLE_FONT_PX;
}

export function pickFontSize(
  value: { desktop?: string; tablet?: string; mobile?: string } | undefined,
  device: Device,
): string | undefined {
  if (!value) return undefined;
  const chain = [value[device], value.desktop, value.tablet, value.mobile];
  return chain.find((candidate) => candidate && !isUnreadableFontSize(candidate));
}

export function cleanCssValue(value: string | undefined): string | undefined {
  const next = value?.trim();
  if (!next) return undefined;
  // Keep authored CSS values usable (font stacks, calc(), var(), etc.) while
  // preventing accidental rule breaks from panel text inputs. `{};` guard against
  // declaration/rule breakout; `<>` guard against `</style>`-based HTML breakout
  // (defence in depth - the `<style>` sink also runs hardenStyleCss). None of
  // these characters are legitimate in a font/size/weight/line-height value.
  return next.replace(/[{};<>]/g, "");
}

export function hasTypographyKeys(value: WidgetTypography | undefined): value is WidgetTypography {
  return !!value && Object.values(value).some((v) => v !== undefined && v !== "");
}

export function normalizeTypographyGapPx(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(200, value));
  if (typeof value === "string") {
    const n = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n)) return Math.max(0, Math.min(200, n));
  }
  return undefined;
}

export function resolveWidgetTypography(
  stored: Themed<WidgetTypography> | undefined,
  _mode: Mode,
  live?: WidgetTypography,
): WidgetTypography | undefined {
  if (hasTypographyKeys(live)) return live;
  return pickShared<WidgetTypography>(stored);
}

/**
 * Czy typografia ma właściwości, które obsługuje WYŁĄCZNIE generator
 * (`typographyCss.ts`). Ta sama prawdziwość co w generatorze: krój, grubość,
 * interlinia i światło po `cleanCssValue`, reszta wprost.
 */
export function hasCommonTypography(typography: WidgetTypography): boolean {
  return Boolean(
    cleanCssValue(typography.fontFamily) ||
    cleanCssValue(typography.fontWeight) ||
    typography.fontStyle ||
    cleanCssValue(typography.lineHeight) ||
    cleanCssValue(typography.letterSpacing) ||
    typography.textTransform ||
    typography.textDecoration ||
    typography.textAlign,
  );
}

// ---------- szablon HW-2 ----------

/** Urządzenia w kolejności sufiksów zmiennych szablonu. */
const TEMPLATE_DEVICES = [
  ["desktop", "d"],
  ["tablet", "t"],
  ["mobile", "m"],
] as const satisfies readonly (readonly [Device, string])[];

/**
 * Biała lista wartości rozmiaru w szablonie: liczba i jednostka, którą
 * przeglądarka przyjmuje bez zmian (kontrakt `cssLen` slidera, ale BEZ
 * dopisywania `px` - liczba bez jednostki jest dla `font-size` błędna i ma
 * zostać błędna, tak jak dziś).
 */
const TEMPLATE_FONT_SIZE = /^(?:\d+|\d*\.\d+)(?:px|rem|em|%|pt|vw|vh)$/;

type DeviceSizes = readonly [string, string, string];

/** `null` = brak wartości na każdym urządzeniu, `"legacy"` = generator. */
function templateSizes(
  value: { desktop?: string; tablet?: string; mobile?: string } | undefined,
): DeviceSizes | null | "legacy" {
  const sizes = TEMPLATE_DEVICES.map(([device]) => cleanCssValue(pickFontSize(value, device)));
  if (sizes.every((size) => size === undefined)) return null;
  if (sizes.every((size) => size !== undefined && TEMPLATE_FONT_SIZE.test(size))) {
    return sizes as unknown as DeviceSizes;
  }
  return "legacy";
}

export interface WidgetTypographyTemplate {
  /** Wartość `data-wt` (tokeny szablonu, rozdzielone spacją) albo brak. */
  readonly tokens: string | undefined;
  /** Zmienne `--wt-*` do stylu ramki albo brak. */
  readonly vars: Readonly<Record<string, string>> | undefined;
  /** Rozmiary idą przez generator (wartość spoza białej listy). */
  readonly legacyFontSize: boolean;
  /** Ramka potrzebuje bloku generatora (rozmiary spoza listy albo krój i reszta). */
  readonly legacy: boolean;
}

const NO_TEMPLATE: WidgetTypographyTemplate = {
  tokens: undefined,
  vars: undefined,
  legacyFontSize: false,
  legacy: false,
};

/**
 * Tokeny i zmienne szablonu typografii dla rozstrzygniętej typografii widgetu.
 * Czysta funkcja danych - ten sam wynik na serwerze i w przeglądarce, bez
 * zależności od urządzenia (wszystkie trzy urządzenia naraz).
 */
export function widgetTypographyTemplate(
  typography: WidgetTypography | undefined,
): WidgetTypographyTemplate {
  if (!hasTypographyKeys(typography)) return NO_TEMPLATE;
  const title = templateSizes(typography.fontSize);
  const description = templateSizes(typography.descriptionFontSize);
  const legacyFontSize = title === "legacy" || description === "legacy";
  const tokens: string[] = [];
  const vars: Record<string, string> = {};
  const put = (token: string, sizes: DeviceSizes) => {
    tokens.push(token);
    TEMPLATE_DEVICES.forEach(([, suffix], i) => {
      vars[`--wt-${token}-${suffix}`] = sizes[i];
    });
  };
  if (!legacyFontSize) {
    // Ta sama logika obecności co w generatorze: rozmiar ogólny (z regułami
    // dla wszystkich tekstów i placeholderów) tylko wtedy, gdy nie ma
    // osobnego rozmiaru opisu.
    if (title && !description) put("fs", title);
    if (title) put("tfs", title);
    if (description) put("dfs", description);
  }
  const gap = normalizeTypographyGapPx(typography.titleDescriptionGapPx);
  // Wartość odstępu jedzie w `--cms-title-description-gap`, które ramka i
  // tak ustawia w stylu inline, gdy odstęp jest liczbą.
  if (typeof gap === "number") tokens.push("g");
  const legacy = legacyFontSize || hasCommonTypography(typography);
  if (!tokens.length && !legacy) return NO_TEMPLATE;
  return {
    tokens: tokens.length ? tokens.join(" ") : undefined,
    vars: Object.keys(vars).length ? vars : undefined,
    legacyFontSize,
    legacy,
  };
}

// The id is interpolated into a quoted attribute value, where a leading digit
// is already valid CSS and must not be escaped. Escape only characters that can
// terminate that quoted value. Keeping this implementation independent from the
// browser-only `CSS.escape` guarantees byte-identical SSR and hydration output.
export function cssAttributeValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\n\r\f]/g, "\\a ");
}

// ---------- podgląd na żywo ----------

interface WidgetTypographyLivePayload {
  widgetId: string;
  typography: WidgetTypography | undefined;
  updatedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePayload(value: unknown): WidgetTypographyLivePayload | null {
  if (!isRecord(value) || typeof value.widgetId !== "string") return null;
  const typography = value.typography;
  if (typography !== undefined && !isRecord(typography)) return null;
  const updatedAt = typeof value.updatedAt === "number" ? value.updatedAt : Date.now();
  return {
    widgetId: value.widgetId,
    typography: typography === undefined ? undefined : (typography as WidgetTypography),
    updatedAt,
  };
}

function storageKey(widgetId: string): string {
  return `${STORAGE_PREFIX}${widgetId}`;
}

function styleElementId(widgetId: string): string {
  return `${STYLE_ID_PREFIX}${widgetId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/**
 * Reguła per identyfikator w `<head>` na ZMIENNYCH szablonu (HW-2):
 * `[data-w-id="id"][data-w-id][data-w-id]{--wt-fs-d:…}`. Tokeny `data-wt`
 * ustawia ramka (podgląd na żywo przechodzi też przez stan Reacta), a styl
 * inline ramki ma pierwszeństwo przed tą regułą - oba niosą te same wartości.
 */
export function buildLiveTypographyVarsCss(widgetId: string, typography: WidgetTypography): string {
  const vars = widgetTypographyTemplate(typography).vars;
  if (!vars) return "";
  const id = cssAttributeValue(widgetId);
  const body = Object.entries(vars)
    .map(([name, value]) => `${name}:${value};`)
    .join("");
  return `[data-w-id="${id}"][data-w-id][data-w-id]{${body}}`;
}

// Kolejny numer zapisu per widget - spóźniony generator (leniwy `import()`)
// nie nadpisze nowszej typografii starszym CSS-em.
const liveStyleRevision = new Map<string, number>();

function writeLiveStyle(widgetId: string, css: string): void {
  const id = styleElementId(widgetId);
  const existing = document.getElementById(id);
  if (!css) {
    existing?.remove();
    return;
  }
  const style = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
  style.id = id;
  style.textContent = css;
  if (!existing) document.head.appendChild(style);
}

function applyLiveTypographyStyle(
  widgetId: string,
  typography: WidgetTypography | undefined,
): void {
  if (typeof document === "undefined") return;
  const revision = (liveStyleRevision.get(widgetId) ?? 0) + 1;
  liveStyleRevision.set(widgetId, revision);
  if (!typography) {
    writeLiveStyle(widgetId, "");
    return;
  }
  const varsCss = buildLiveTypographyVarsCss(widgetId, typography);
  writeLiveStyle(widgetId, varsCss);
  if (!widgetTypographyTemplate(typography).legacy) return;
  // Reszta (krój, grubość... albo rozmiary spoza białej listy) wymaga
  // generatora - tylko edytor i karta z podglądem płacą za jego chunk.
  void import("./typographyCss").then(
    ({ buildLiveWidgetTypographyCss }) => {
      if (liveStyleRevision.get(widgetId) !== revision) return;
      const legacyCss = buildLiveWidgetTypographyCss(widgetId, typography);
      writeLiveStyle(widgetId, [varsCss, legacyCss].filter(Boolean).join("\n"));
    },
    () => {
      // Chunk nie dojechał: zostają zmienne i stan Reacta ramki.
    },
  );
}

export function broadcastWidgetTypography(
  widgetId: string,
  typography: WidgetTypography | undefined,
): void {
  if (typeof window === "undefined") return;
  const payload: WidgetTypographyLivePayload = { widgetId, typography, updatedAt: Date.now() };

  applyLiveTypographyStyle(widgetId, typography);

  window.dispatchEvent(
    new CustomEvent<WidgetTypographyLivePayload>(EVENT_NAME, { detail: payload }),
  );

  try {
    if (typography === undefined) window.sessionStorage.removeItem(storageKey(widgetId));
    else window.sessionStorage.setItem(storageKey(widgetId), JSON.stringify(payload));
  } catch {
    // sessionStorage can be disabled - live same-document updates still work.
  }

  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(payload);
    channel.close();
  } catch {
    // BroadcastChannel is best-effort; React state update remains authoritative.
  }
}

/**
 * Drop every live typography override (same-document): removes the injected
 * <style> nodes + sessionStorage snapshots and notifies subscribers with
 * `undefined` so widgets fall back to the DOCUMENT's typography.
 *
 * Needed around undo/redo: the live broadcast otherwise shadows the restored
 * document value and the canvas visibly "ignores" the undo.
 */
export function clearAllLiveWidgetTypography(): void {
  if (typeof window === "undefined") return;
  const widgetIds = new Set<string>();
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        widgetIds.add(key.slice(STORAGE_PREFIX.length));
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // sessionStorage can be disabled — style/subscriber cleanup still runs.
  }
  if (typeof document !== "undefined") {
    document.querySelectorAll(`style[id^="${STYLE_ID_PREFIX}"]`).forEach((el) => el.remove());
  }
  // Spóźniony generator nie odtworzy usuniętego bloku.
  liveStyleRevision.clear();
  widgetIds.forEach((widgetId) => {
    window.dispatchEvent(
      new CustomEvent<WidgetTypographyLivePayload>(EVENT_NAME, {
        detail: { widgetId, typography: undefined, updatedAt: Date.now() },
      }),
    );
  });
}

export function subscribeWidgetTypography(
  widgetId: string,
  onChange: (typography: WidgetTypography | undefined) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  try {
    const raw = window.sessionStorage.getItem(storageKey(widgetId));
    const payload = raw ? normalizePayload(JSON.parse(raw) as unknown) : null;
    if (payload?.widgetId === widgetId) {
      applyLiveTypographyStyle(widgetId, payload.typography);
      onChange(payload.typography);
    }
  } catch {
    // Ignore stale or unavailable storage.
  }

  const handlePayload = (value: unknown) => {
    const payload = normalizePayload(value);
    if (payload?.widgetId === widgetId) {
      applyLiveTypographyStyle(widgetId, payload.typography);
      onChange(payload.typography);
    }
  };

  const handleEvent = (event: Event) => {
    if (event instanceof CustomEvent) handlePayload(event.detail as unknown);
  };

  window.addEventListener(EVENT_NAME, handleEvent);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent<unknown>) => handlePayload(event.data);
    } catch {
      channel = null;
    }
  }

  return () => {
    window.removeEventListener(EVENT_NAME, handleEvent);
    channel?.close();
  };
}
