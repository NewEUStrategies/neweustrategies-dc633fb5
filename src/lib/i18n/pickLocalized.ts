// Canonical picker for localized "twin column" data (e.g. title_pl / title_en).
//
// Historically the codebase had 3 divergent `pickLang` helpers with subtly
// different fallback rules (megaMenu.ts, MegaMenu.tsx, AuthFormBlocks.tsx) plus
// ~380 inline `lang === "en" ? x_en : x_pl` ternaries. This module is the ONE
// place that owns the policy.
//
// ── POLICY (single source of truth) ────────────────────────────────────────
// A localized value is considered PRESENT only when it is a string containing
// at least one non-whitespace character. Anything else — undefined, null, a
// non-string, an empty string, or a whitespace-only string — counts as EMPTY.
//
// Resolution order, first PRESENT value wins:
//   1. the requested language  (row[`${baseKey}_${lang}`])
//   2. the OTHER language       (row[`${baseKey}_${otherLang}`])
//   3. the caller's `fallback`
//   4. "" (empty string)
//
// Consequence: the returned string is never empty while EITHER language has
// real content, so the UI never shows a blank where a translation exists. The
// value is returned verbatim (NOT trimmed) — trimming is only used to decide
// emptiness.

export type LocaleCode = "pl" | "en";

const OTHER_LOCALE: Readonly<Record<LocaleCode, LocaleCode>> = { pl: "en", en: "pl" };

/**
 * True when `value` is a string with at least one non-whitespace character.
 * This is the ONLY definition of "present" used by the pickers.
 */
function isFilledString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Pick a localized value from a row that stores twin columns keyed
 * `${baseKey}_pl` / `${baseKey}_en`.
 *
 * Follows the module POLICY: requested language → other language → `fallback`
 * → "". Whitespace-only counts as empty; the chosen value is returned verbatim.
 *
 * @example
 * pickLocalized(post, "title", "en");            // title_en, else title_pl, else ""
 * pickLocalized(post, "title", "pl", t("...")); // title_pl, else title_en, else t("...")
 *
 * @param row      Object holding `${baseKey}_pl` / `${baseKey}_en`. `null` /
 *                 `undefined` are safe and resolve to `fallback ?? ""`.
 * @param baseKey  Column base name (without the `_pl` / `_en` suffix).
 * @param lang     Requested language.
 * @param fallback Returned when neither language has content. Defaults to "".
 */
export function pickLocalized<Base extends string>(
  row: Partial<Record<`${Base}_${LocaleCode}`, unknown>> | null | undefined,
  baseKey: Base,
  lang: LocaleCode,
  fallback?: string,
): string {
  if (row != null) {
    const primary = row[`${baseKey}_${lang}`];
    if (isFilledString(primary)) return primary;
    const secondary = row[`${baseKey}_${OTHER_LOCALE[lang]}`];
    if (isFilledString(secondary)) return secondary;
  }
  return fallback ?? "";
}

/**
 * Split-args variant of {@link pickLocalized} for call sites that already hold
 * the two candidate values (not a row object). Same POLICY: `primary` →
 * `secondary` → `fallback` → "". Whitespace-only counts as empty; the chosen
 * value is returned verbatim. Non-string inputs are treated as empty.
 *
 * @example
 * pickPair(opt.labelPl, opt.labelEn);          // camelCase twins, no `_pl`/`_en`
 * pickPair(lang === "en" ? a_en : a_pl, a_pl); // preserve a legacy pairing exactly
 */
export function pickPair(primary: unknown, secondary: unknown, fallback?: string): string {
  if (isFilledString(primary)) return primary;
  if (isFilledString(secondary)) return secondary;
  return fallback ?? "";
}
