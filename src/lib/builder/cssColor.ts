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
