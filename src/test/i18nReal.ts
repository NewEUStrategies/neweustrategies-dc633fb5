// Prawdziwy tłumacz do testów - jedno miejsce zamiast atrapy per plik.
//
// CZEGO DOWIODŁA KONWERSJA `defaultValue`. W repo żył wzorzec atrapy:
//
//   const t = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key;
//
// Taka atrapa nie zwraca tłumaczenia - zwraca KOPIĘ NAPISU WPISANĄ PRZY
// WYWOŁANIU. Test asertujący `getByRole("button", { name: "Strona 2" })`
// przechodził więc dzięki temu, że ktoś wpisał „Strona 2" w kodzie komponentu,
// a nie dzięki temu, że taki napis jest w słowniku. Po zdjęciu zapasowych
// tekstów (bramka `check:i18n-default-value`) 47 takich asercji w 9 plikach
// zgasło naraz - i to jest miara tego, ile z nich mierzyło słownik: zero.
//
// Ta atrapa dawała jeszcze dwa skutki uboczne:
//   * wymuszała rzutowanie `as unknown as TFunction`, bo jej sygnatura nie
//     pasuje do `TFunction` - czyli dokładała długu typowego, żeby ukryć dług
//     językowy;
//   * czyniła test ŚLEPYM na brak klucza: usunięcie klucza ze słownika nie
//     ruszało ani jednego testu.
//
// `realT()` bierze `t` z tej samej instancji i18next, której używa aplikacja,
// więc asercja mierzy napis, który zobaczy użytkownik, a zniknięcie klucza
// oblewa test. Zwracany typ to prawdziwy `TFunction` - żadnego rzutowania.
import i18n, { ensureCoreLanguage } from "@/lib/i18n";
import type { TFunction } from "i18next";
import type { AppLang } from "@/lib/i18n/localePath";

// OBA rdzenie, nie tylko aktywny. Na kliencie `@/lib/i18n` dociąga wyłącznie
// język bieżącej strony (perf pierwszego wczytania), a `currentLang()` bez URL-a
// daje „pl" - więc `getFixedT("en")` cicho spadało na polski fallback i test
// dwujęzyczny asertował polszczyznę pod nazwą angielskiego. Top-level await
// domyka to raz, przy imporcie tego modułu.
await Promise.all([ensureCoreLanguage("pl"), ensureCoreLanguage("en")]);

/**
 * `t` przypięty do języka - jak `useTranslation()` w komponencie, tylko bez
 * Reacta. Nakładki (`i18n-*.ts`) rejestrują się efektem ubocznym importu, więc
 * plik testu musi zaimportować tę nakładkę, której klucze asertuje (komponent
 * zwykle robi to sam - wtedy nie trzeba nic dokładać).
 */
export function realT(lang: AppLang = "pl"): TFunction {
  return i18n.getFixedT(lang);
}

/**
 * Podmiana `react-i18next` dla testów, które mockują cały moduł - z tym samym
 * kształtem, co atrapy, które zastępuje, ale z prawdziwym `t`.
 *
 * Używać WEWNĄTRZ fabryki `vi.mock` (jest hoistowana, więc nie widzi importów
 * z góry pliku):
 *
 *   vi.mock("react-i18next", async () => (await import("@/test/i18nReal")).reactI18nextMock("pl"));
 *
 * ŚWIADOMIE NIE ROZWIJA TU PRAWDZIWEGO MODUŁU (`...await import("react-i18next")`):
 * import modułu z wnętrza jego własnej fabryki `vi.mock` zapętla rozwiązywanie
 * i test wisi bez komunikatu. Zwracamy więc minimalną powierzchnię, z której
 * te testy naprawdę korzystają.
 */
export function reactI18nextMock(lang: AppLang = "pl") {
  return {
    useTranslation: () => ({ t: realT(lang), i18n, ready: true }),
    initReactI18next: { type: "3rdParty" as const, init: () => {} },
  };
}
