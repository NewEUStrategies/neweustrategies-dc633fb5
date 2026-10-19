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
// Nazwane kolory CSS Color 4 (148) z wartością sRGB. Pole tekstowe pickera
// przyjmuje dowolny napis, a kolory globalne przechodzą przez ten whitelist od
// walidacji `globalColorsToCss` - bez nazw zapisany wcześniej „white” spadałby
// po cichu na wartość domyślną. Zamknięta lista słów nie wyjdzie poza
// deklarację. JEDNA tabela dla whitelisty i parsera kanałów (niżej): nazwa,
// którą przepuszczamy do `style`, musi się też dać policzyć - inaczej tusz
// podświetlenia social i odwracanie dla drugiego trybu brały ją za kolor
// nieznany. `Map`, a nie obiekt: „constructor” z prototypu nie jest kolorem.
const NAMED_COLORS: ReadonlyMap<string, string> = new Map([
  ["aliceblue", "#f0f8ff"],
  ["antiquewhite", "#faebd7"],
  ["aqua", "#00ffff"],
  ["aquamarine", "#7fffd4"],
  ["azure", "#f0ffff"],
  ["beige", "#f5f5dc"],
  ["bisque", "#ffe4c4"],
  ["black", "#000000"],
  ["blanchedalmond", "#ffebcd"],
  ["blue", "#0000ff"],
  ["blueviolet", "#8a2be2"],
  ["brown", "#a52a2a"],
  ["burlywood", "#deb887"],
  ["cadetblue", "#5f9ea0"],
  ["chartreuse", "#7fff00"],
  ["chocolate", "#d2691e"],
  ["coral", "#ff7f50"],
  ["cornflowerblue", "#6495ed"],
  ["cornsilk", "#fff8dc"],
  ["crimson", "#dc143c"],
  ["cyan", "#00ffff"],
  ["darkblue", "#00008b"],
  ["darkcyan", "#008b8b"],
  ["darkgoldenrod", "#b8860b"],
  ["darkgray", "#a9a9a9"],
  ["darkgreen", "#006400"],
  ["darkgrey", "#a9a9a9"],
  ["darkkhaki", "#bdb76b"],
  ["darkmagenta", "#8b008b"],
  ["darkolivegreen", "#556b2f"],
  ["darkorange", "#ff8c00"],
  ["darkorchid", "#9932cc"],
  ["darkred", "#8b0000"],
  ["darksalmon", "#e9967a"],
  ["darkseagreen", "#8fbc8f"],
  ["darkslateblue", "#483d8b"],
  ["darkslategray", "#2f4f4f"],
  ["darkslategrey", "#2f4f4f"],
  ["darkturquoise", "#00ced1"],
  ["darkviolet", "#9400d3"],
  ["deeppink", "#ff1493"],
  ["deepskyblue", "#00bfff"],
  ["dimgray", "#696969"],
  ["dimgrey", "#696969"],
  ["dodgerblue", "#1e90ff"],
  ["firebrick", "#b22222"],
  ["floralwhite", "#fffaf0"],
  ["forestgreen", "#228b22"],
  ["fuchsia", "#ff00ff"],
  ["gainsboro", "#dcdcdc"],
  ["ghostwhite", "#f8f8ff"],
  ["gold", "#ffd700"],
  ["goldenrod", "#daa520"],
  ["gray", "#808080"],
  ["green", "#008000"],
  ["greenyellow", "#adff2f"],
  ["grey", "#808080"],
  ["honeydew", "#f0fff0"],
  ["hotpink", "#ff69b4"],
  ["indianred", "#cd5c5c"],
  ["indigo", "#4b0082"],
  ["ivory", "#fffff0"],
  ["khaki", "#f0e68c"],
  ["lavender", "#e6e6fa"],
  ["lavenderblush", "#fff0f5"],
  ["lawngreen", "#7cfc00"],
  ["lemonchiffon", "#fffacd"],
  ["lightblue", "#add8e6"],
  ["lightcoral", "#f08080"],
  ["lightcyan", "#e0ffff"],
  ["lightgoldenrodyellow", "#fafad2"],
  ["lightgray", "#d3d3d3"],
  ["lightgreen", "#90ee90"],
  ["lightgrey", "#d3d3d3"],
  ["lightpink", "#ffb6c1"],
  ["lightsalmon", "#ffa07a"],
  ["lightseagreen", "#20b2aa"],
  ["lightskyblue", "#87cefa"],
  ["lightslategray", "#778899"],
  ["lightslategrey", "#778899"],
  ["lightsteelblue", "#b0c4de"],
  ["lightyellow", "#ffffe0"],
  ["lime", "#00ff00"],
  ["limegreen", "#32cd32"],
  ["linen", "#faf0e6"],
  ["magenta", "#ff00ff"],
  ["maroon", "#800000"],
  ["mediumaquamarine", "#66cdaa"],
  ["mediumblue", "#0000cd"],
  ["mediumorchid", "#ba55d3"],
  ["mediumpurple", "#9370db"],
  ["mediumseagreen", "#3cb371"],
  ["mediumslateblue", "#7b68ee"],
  ["mediumspringgreen", "#00fa9a"],
  ["mediumturquoise", "#48d1cc"],
  ["mediumvioletred", "#c71585"],
  ["midnightblue", "#191970"],
  ["mintcream", "#f5fffa"],
  ["mistyrose", "#ffe4e1"],
  ["moccasin", "#ffe4b5"],
  ["navajowhite", "#ffdead"],
  ["navy", "#000080"],
  ["oldlace", "#fdf5e6"],
  ["olive", "#808000"],
  ["olivedrab", "#6b8e23"],
  ["orange", "#ffa500"],
  ["orangered", "#ff4500"],
  ["orchid", "#da70d6"],
  ["palegoldenrod", "#eee8aa"],
  ["palegreen", "#98fb98"],
  ["paleturquoise", "#afeeee"],
  ["palevioletred", "#db7093"],
  ["papayawhip", "#ffefd5"],
  ["peachpuff", "#ffdab9"],
  ["peru", "#cd853f"],
  ["pink", "#ffc0cb"],
  ["plum", "#dda0dd"],
  ["powderblue", "#b0e0e6"],
  ["purple", "#800080"],
  ["rebeccapurple", "#663399"],
  ["red", "#ff0000"],
  ["rosybrown", "#bc8f8f"],
  ["royalblue", "#4169e1"],
  ["saddlebrown", "#8b4513"],
  ["salmon", "#fa8072"],
  ["sandybrown", "#f4a460"],
  ["seagreen", "#2e8b57"],
  ["seashell", "#fff5ee"],
  ["sienna", "#a0522d"],
  ["silver", "#c0c0c0"],
  ["skyblue", "#87ceeb"],
  ["slateblue", "#6a5acd"],
  ["slategray", "#708090"],
  ["slategrey", "#708090"],
  ["snow", "#fffafa"],
  ["springgreen", "#00ff7f"],
  ["steelblue", "#4682b4"],
  ["tan", "#d2b48c"],
  ["teal", "#008080"],
  ["thistle", "#d8bfd8"],
  ["tomato", "#ff6347"],
  ["turquoise", "#40e0d0"],
  ["violet", "#ee82ee"],
  ["wheat", "#f5deb3"],
  ["white", "#ffffff"],
  ["whitesmoke", "#f5f5f5"],
  ["yellow", "#ffff00"],
  ["yellowgreen", "#9acd32"],
]);
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
  if (NAMED_COLORS.has(value.toLowerCase())) return value;
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
 * Kanały koloru dla zapisów, które da się policzyć LOKALNIE: nazwy kolorów CSS
 * (ta sama tabela co whitelist), hex 3/4/6/8, `rgb()`/`rgba()` i
 * `hsl()`/`hsla()` w obu składniach (przecinkowej i ze spacją + `/`), kanały
 * i alfa jako liczby lub procenty. `null` dla wszystkiego innego (`var(--…)`,
 * `transparent`, `currentcolor`, `oklch()`, `color()`…) - ich wartość zna
 * dopiero przeglądarka.
 */
export function parseColorChannels(color: string): RgbaChannels | null {
  const value = color.trim();
  const named = NAMED_COLORS.get(value.toLowerCase());
  if (named) return parseHexChannels(named);
  return parseHexChannels(value) ?? parseRgbChannels(value) ?? parseHslChannels(value);
}
