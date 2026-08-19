// Atrapa i18n dla testów - echo klucza z parametrami.
//
// UWAGA, TO NIE JEST PRZYPADEK, ŻE MODUŁ JEST OSOBNY I PUSTY OD ZALEŻNOŚCI.
// Fabryka `vi.mock("react-i18next", ...)` NIE MOŻE importować modułu, który
// - choćby przez kilka poziomów - dochodzi do `react-i18next`. Taki import
// domyka cykl inicjalizacji (fabryka czeka na moduł, moduł czeka na fabrykę)
// i ZAWIESZA cały plik testowy: vitest nie zgłasza błędu, tylko stoi do
// timeoutu. Zdarzyło się to naprawdę: fixture'y modułu 1 sięgały po
// `lib/toc/settings` dla wartości domyślnych, a ta warstwa dostała później
// import wspólnych toastów panelu -> `lib/i18n` -> `react-i18next`.
//
// Dlatego ten plik nie importuje NICZEGO z produkcji i taki ma zostać.
// Fabryki mocka importują właśnie jego, a nie fixture'y obszaru.

/**
 * Zwraca klucz zamiast tłumaczenia, a parametry dokleja w nawiasie - dzięki
 * temu asercja widzi także JAWNE wymuszenie języka (`lng=en`), czyli to, czego
 * sam napis nie pokazuje.
 */
export function translateKey(key: string, options?: Record<string, unknown>): string {
  if (!options) return key;
  const params = Object.entries(options)
    .filter(([name]) => name !== "defaultValue")
    .map(([name, value]) => `${name}=${String(value)}`)
    .sort();
  return params.length > 0 ? `${key}(${params.join(",")})` : key;
}

export function reactI18nextStub(getLanguage: () => string = () => "pl"): {
  useTranslation: () => {
    t: typeof translateKey;
    i18n: { language: string; t: typeof translateKey };
  };
  initReactI18next: { type: string; init: () => void };
  Trans: (props: { children?: unknown }) => unknown;
} {
  // Jeden STABILNY obiekt `i18n` (getter na `language`), jak realna instancja
  // i18next - panele wpinają go do tablic zależności efektów.
  const i18n = {
    get language() {
      return getLanguage();
    },
    t: translateKey,
  };
  return {
    useTranslation: () => ({ t: translateKey, i18n }),
    initReactI18next: { type: "3rdParty", init: () => {} },
    Trans: (props: { children?: unknown }) => props.children ?? null,
  };
}
