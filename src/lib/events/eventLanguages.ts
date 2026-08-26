// Jezyki TRESCI wydarzenia - katalog kodow i ich nazwy.
//
// TO NIE JEST PRZELACZNIK INTERFEJSU. Panel i serwis sa dwujezyczne (PL/EN)
// i takie zostaja. `events.languages` mowi UCZESTNIKOWI, w jakich jezykach
// prowadzone sa sesje („polski i angielski, tlumaczenie symultaniczne") -
// zaznaczenie arabskiego nie obiecuje arabskiego interfejsu i UI musi to
// nazywac wprost (`adminEvents.general.languagesHint`).
//
// NAZWY JEZYKOW BIERZE `Intl`, A NIE SLOWNIK. Dwadziescia kilka nazw razy dwa
// jezyki to piecdziesiat kluczy i18n, ktore trzeba by tlumaczyc recznie i ktore
// i tak byly by gorsze od tego, co przegladarka ma w srodku: `Intl.DisplayNames`
// oddaje „arabski" po polsku i „Arabic" po angielsku, zgodnie z CLDR. Kod jezyka
// jest DANYMI, nie tekstem interfejsu, wiec nie podlega bramce i18n.
//
// GRANICA WARSTW: zero Reacta, zero i18next. Modul jest lisciem.

/**
 * Kody ISO 639-1 oferowane w panelu. Zbior jest zamkniety i celowo krotki:
 * lista wszystkich 180 jezykow CLDR jest niemozliwa do przejrzenia wzrokiem,
 * a wydarzenie w praktyce prowadzi sie w jednym z kilkunastu jezykow Europy
 * plus kilku jezykach swiatowych.
 */
export const EVENT_CONTENT_LANGUAGES = [
  "pl",
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "cs",
  "sk",
  "uk",
  "lt",
  "lv",
  "et",
  "hu",
  "ro",
  "bg",
  "hr",
  "sl",
  "el",
  "sv",
  "da",
  "fi",
  "no",
  "tr",
  "ar",
  "zh",
  "ja",
  "ko",
  "he",
] as const;

export type EventContentLanguage = (typeof EVENT_CONTENT_LANGUAGES)[number];

/** Domyslny zestaw dla nowego wydarzenia - taki sam jak DEFAULT kolumny. */
export const EVENT_DEFAULT_LANGUAGES: readonly string[] = ["pl", "en"];

const LABEL_CACHE = new Map<string, string>();

/**
 * Nazwa jezyka w jezyku interfejsu, z degradacja do samego kodu.
 *
 * `Intl.DisplayNames` nie jest darmowy, a lista rysuje sie przy kazdym
 * otwarciu ekranu - stad pamiec podreczna po parze (jezyk UI, kod).
 */
export function eventLanguageLabel(code: string, uiLanguage: string): string {
  const key = `${uiLanguage}:${code}`;
  const cached = LABEL_CACHE.get(key);
  if (cached !== undefined) return cached;
  let label = code;
  try {
    const names = new Intl.DisplayNames([uiLanguage], { type: "language" });
    const resolved = names.of(code);
    if (typeof resolved === "string" && resolved !== "") {
      label = resolved.charAt(0).toLocaleUpperCase(uiLanguage) + resolved.slice(1);
    }
  } catch {
    // Starsza przegladarka albo nieznany kod - kod jezyka jest nadal czytelny.
    label = code;
  }
  LABEL_CACHE.set(key, label);
  return label;
}

/**
 * Katalog do checklisty, posortowany nazwa w jezyku interfejsu.
 *
 * Sortowanie po NAZWIE, nie po kodzie: „Niemiecki" i „German" stoja w innych
 * miejscach alfabetu, a lista posortowana po kodzie jest nieprzeszukiwalna
 * wzrokiem w obu jezykach naraz.
 */
export function eventLanguageOptions(
  uiLanguage: string,
): readonly { code: string; label: string }[] {
  return EVENT_CONTENT_LANGUAGES.map((code) => ({
    code,
    label: eventLanguageLabel(code, uiLanguage),
  })).sort((a, b) => a.label.localeCompare(b.label, uiLanguage));
}

/** Zbior kodow do zapisu: bez duplikatow, bez pustych, w stabilnej kolejnosci. */
export function normalizeEventLanguages(values: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const code = value.trim().toLowerCase();
    if (/^[a-z]{2}(-[a-z]{2})?$/.test(code)) seen.add(code);
  }
  return [...seen].sort();
}
