// Stub `react-i18next` echujacy KLUCZ zamiast tlumaczenia - wspolny dla
// wszystkich powierzchni testowych.
//
// Test asertuje KLUCZ, nie polski tekst, wiec zmiana copy nie psuje testow,
// a rozjazd klucza owszem. Za parytet PL/EN odpowiadaja osobne bramki
// (`i18nParity.gate`, `clubI18nKeys.gate`), za obecnosc klucza w slowniku -
// `i18nDictionaries`. Podzial obowiazkow jest tu celowy: gdyby test reguly zalezal
// od tresci zdania, odmiana liczebnikow ("2 uczestnicy" vs "5 uczestnikow")
// stawalaby sie czescia kontraktu modulu zamiast zostac w slowniku.

/**
 * Echo klucza i18n: `t("a.b")` -> `"a.b"`, a z opcjami -> `a.b {"count":3}`.
 * Testy asertują KLUCZ, nie polski tekst, więc zmiana copy nie psuje testów,
 * a rozjazd klucza owszem (za parytet PL/EN odpowiada `i18nChat.test.ts`).
 */
export function translateKey(key: string, options?: Record<string, unknown>): string {
  if (options === undefined) return key;
  const entries = Object.entries(options);
  return entries.length === 0 ? key : `${key} ${JSON.stringify(Object.fromEntries(entries))}`;
}

/** Ten sam stub `react-i18next` dla wszystkich testów czatu. */
export function reactI18nextStub(getLanguage: () => string = () => "pl"): {
  useTranslation: () => { t: typeof translateKey; i18n: { language: string } };
  initReactI18next: { type: string; init: () => void };
  Trans: (props: { children?: unknown }) => unknown;
} {
  return {
    useTranslation: () => ({ t: translateKey, i18n: { language: getLanguage() } }),
    initReactI18next: { type: "3rdParty", init: () => {} },
    Trans: (props: { children?: unknown }) => props.children ?? null,
  };
}
