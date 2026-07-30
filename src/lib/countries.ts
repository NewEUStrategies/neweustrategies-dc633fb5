// ESM-only replacement for the CommonJS `i18n-iso-countries` package.
// The original package's `index.js` uses `require()`, which is undefined in the
// browser and breaks widgets that import it (e.g. join-us). We import the
// static JSON locale files directly and expose only the two functions the UI
// needs: `getNames` and `getAlpha2Code`.
import enLocale from "i18n-iso-countries/langs/en.json";
import plLocale from "i18n-iso-countries/langs/pl.json";

export type SupportedLang = "pl" | "en";

interface LocaleData {
  locale: string;
  countries: Record<string, string>;
}

const locales: Record<SupportedLang, LocaleData> = {
  en: enLocale as LocaleData,
  pl: plLocale as LocaleData,
};

function normalizeForMatch(s: string): string {
  return s
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** Returns the official country-name map for the given language. */
export function getNames(lang: SupportedLang): Record<string, string> {
  return locales[lang].countries;
}

/**
 * Finds the ISO-3166-1 alpha-2 code for a country name.
 * Falls back to English when the name is not found in the requested locale.
 */
export function getAlpha2Code(
  name: string,
  lang: SupportedLang
): string | undefined {
  const target = normalizeForMatch(name);
  if (!target) return undefined;

  const tryLangs: SupportedLang[] = lang === "en" ? ["en"] : [lang, "en"];

  for (const tryLang of tryLangs) {
    const entries = Object.entries(locales[tryLang].countries);

    // Exact match (after diacritics stripping).
    const exact = entries.find(([, value]) => normalizeForMatch(value) === target);
    if (exact) return exact[0];

    // Prefix match, so typing "Pol" still resolves to "PL".
    const prefix = entries.find(([, value]) =>
      normalizeForMatch(value).startsWith(target)
    );
    if (prefix) return prefix[0];
  }

  return undefined;
}
