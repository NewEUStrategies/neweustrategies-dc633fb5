// Whitelist zapisów koloru, które renderery widgetów mogą wstawić do `style`.
//
// PROBLEM, KTÓRY TEN MODUŁ LIKWIDUJE
// Renderery walidowały kolor wyrażeniem `/^#([0-9a-f]{3}|[0-9a-f]{6})$/`, a
// `AdminColorPicker` commituje znacznie więcej: przełącznik „transparent",
// pola RGB / HSL, hex z alfą oraz swobodne tokeny (`var(--brand)`,
// `oklch(...)`). Każdy taki zapis znikał bez śladu - użytkownik ustawiał kolor,
// zapisywał i nic się nie zmieniało.
//
// Odwrotna skrajność (wpuść dowolny string) jest niedopuszczalna: wartość
// trafia wprost do atrybutu `style`. Dlatego whitelist wzorców, w których
// argumenty funkcji nie mogą zawierać nawiasu, cudzysłowu ani średnika - nie da
// się więc wstrzyknąć `url(...)` / `expression(...)` ani wyjść poza deklarację.
//
// Moduł jest czysty (bez importów runtime), tak jak `contentValue.ts` - używają
// go zarówno kanwa buildera, jak i render publiczny.

const COLOR_KEYWORDS: ReadonlySet<string> = new Set(["transparent", "currentcolor"]);
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const VAR_COLOR_RE = /^var\(--[a-z0-9_-]+\)$/i;
// Nazwy funkcji wyliczamy JAWNIE, bez sprytnych klas znaków: skrót typu
// `okla[bch]` łapie `oklab`, ale już nie `oklch` - czyli dokładnie ten zapis,
// którego używa paleta motywu.
const FUNC_COLOR_RE = /^(?:rgba?|hsla?|hwb|oklab|oklch|lab|lch|color)\(\s*[0-9a-z.,%/\s+-]*\)$/i;

/**
 * Zwraca kolor tylko wtedy, gdy da się go bezpiecznie wstawić do CSS.
 * Nierozpoznany zapis daje `""` (czyli „użyj koloru motywu"), nigdy surowego
 * stringa w deklaracji.
 */
export function safeWidgetColor(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value) return "";
  if (COLOR_KEYWORDS.has(value.toLowerCase())) return value;
  if (HEX_COLOR_RE.test(value)) return value;
  if (VAR_COLOR_RE.test(value)) return value;
  if (FUNC_COLOR_RE.test(value)) return value;
  return "";
}

// ---------- kanały koloru (wspólny parser) ----------
//
// Jeden parser dla każdego miejsca, które musi POLICZYĆ kolor bez layoutu:
// luminancja podświetlenia ikon social (`widget-view/socialHover.ts`) i
// odwracanie koloru dla drugiego trybu (`autoInvertColor.ts`). Wcześniej
// każde z nich miało własny parser i odwracanie nie rozumiało procentów ani
// `hsl()`, które ta sama whitelist wyżej przepuszcza do `style`.

/** Kanały sRGB (0-255, bez przycinania) plus alfa (0-1), wyłuskane z zapisu koloru. */
export interface RgbaChannels {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const CHANNEL_HEX_RE = /^#([0-9a-f]{3,8})$/i;
const RGB_FUNC_RE = /^rgba?\(([^()]*)\)$/i;
const HSL_FUNC_RE = /^hsla?\(([^()]*)\)$/i;

/** Argumenty funkcji koloru: `a, b, c` i `a b c / d` dają tę samą listę. */
function splitColorArgs(inside: string): string[] {
  return inside
    .replace(/\//g, " ")
    .split(/[\s,]+/)
    .filter(Boolean);
}

/** Liczba albo procent skalowany do `scale`; `deg` przy odcieniu jest opcjonalny. */
function colorNumber(token: string, scale: number): number | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(%|deg)?$/.exec(token);
  if (!m) return null;
  const v = Number.parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  return m[2] === "%" ? (v / 100) * scale : v;
}

/** Nasycenie i jasność w `hsl()` są z definicji procentami - bez `%` odrzucamy. */
function colorPercent(token: string): number | null {
  return token.endsWith("%") ? colorNumber(token, 1) : null;
}

function parseHexChannels(value: string): RgbaChannels | null {
  const m = CHANNEL_HEX_RE.exec(value);
  if (!m) return null;
  const d = m[1];
  const twice = (ch: string) => Number.parseInt(ch + ch, 16);
  if (d.length === 3 || d.length === 4) {
    return {
      r: twice(d[0]),
      g: twice(d[1]),
      b: twice(d[2]),
      a: d.length === 4 ? twice(d[3]) / 255 : 1,
    };
  }
  if (d.length === 6 || d.length === 8) {
    const pair = (i: number) => Number.parseInt(d.slice(i, i + 2), 16);
    return { r: pair(0), g: pair(2), b: pair(4), a: d.length === 8 ? pair(6) / 255 : 1 };
  }
  // Zapisy 5- i 7-znakowe nie są kolorem, choć przechodzą przez wyrażenie.
  return null;
}

function parseRgbChannels(value: string): RgbaChannels | null {
  const m = RGB_FUNC_RE.exec(value);
  if (!m) return null;
  const parts = splitColorArgs(m[1]);
  if (parts.length < 3 || parts.length > 4) return null;
  const r = colorNumber(parts[0], 255);
  const g = colorNumber(parts[1], 255);
  const b = colorNumber(parts[2], 255);
  const a = parts.length === 4 ? colorNumber(parts[3], 1) : 1;
  if (r === null || g === null || b === null || a === null) return null;
  return { r, g, b, a };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(Math.max(s, 0), 1);
  const light = Math.min(Math.max(l, 0), 1);
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  const seg = Math.floor(hue / 60) % 6;
  const rgb =
    seg === 0
      ? [c, x, 0]
      : seg === 1
        ? [x, c, 0]
        : seg === 2
          ? [0, c, x]
          : seg === 3
            ? [0, x, c]
            : seg === 4
              ? [x, 0, c]
              : [c, 0, x];
  return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 };
}

function parseHslChannels(value: string): RgbaChannels | null {
  const m = HSL_FUNC_RE.exec(value);
  if (!m) return null;
  const parts = splitColorArgs(m[1]);
  if (parts.length < 3 || parts.length > 4) return null;
  const h = colorNumber(parts[0], 360);
  const s = colorPercent(parts[1]);
  const l = colorPercent(parts[2]);
  const a = parts.length === 4 ? colorNumber(parts[3], 1) : 1;
  if (h === null || s === null || l === null || a === null) return null;
  return { ...hslToRgb(h, s, l), a };
}

/**
 * Kanały koloru dla zapisów, które da się policzyć LOKALNIE: hex 3/4/6/8,
 * `rgb()`/`rgba()` i `hsl()`/`hsla()` w obu składniach (przecinkowej i ze
 * spacją + `/`), kanały i alfa jako liczby lub procenty. `null` dla wszystkiego
 * innego (`var(--…)`, słowa kluczowe, `oklch()`, `color()`…) - ich wartość zna
 * dopiero przeglądarka.
 */
export function parseColorChannels(color: string): RgbaChannels | null {
  const value = color.trim();
  return parseHexChannels(value) ?? parseRgbChannels(value) ?? parseHslChannels(value);
}
