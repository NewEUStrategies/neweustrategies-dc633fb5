// Czy dokument TEJ ścieżki nie ma ŻADNEGO renderu serwerowego treści.
//
// PO CO OSOBNY MODUŁ, skoro obok stoi już `siteChrome.ts`. To są DWA RÓŻNE
// pytania i mylenie ich kosztuje sekundy TTFB:
//
//   * `showsSiteChrome(path)` pyta, czy dokument niesie nagłówek, stopkę i
//     menu - czyli czy warto grzać zapytania chrome'u (DRUGA fala korzenia);
//   * `isClientOnlyDocument(path)` pyta, czy dokument niesie W OGÓLE jakikolwiek
//     serwerowy HTML treści - czyli czy PIERWSZA fala (ustawienia, tokeny
//     designu, kolory globalne) ma cokolwiek do pomalowania przed hydratacją.
//
// Panel `/admin` odpowiada NIE na oba pytania: `routes/admin.tsx` deklaruje
// `ssr: false` (sesja Supabase żyje w `localStorage`, więc SSR szkicu jest
// gwarantowanym mismatchem hydratacji), a `showsSiteChrome` wyklucza go z
// chrome'u serwisu. Mimo to loader korzenia awaitował na tej ścieżce pełną
// falę 1 z budżetem `ROOT_WARM_BUDGET_MS` (2 500 ms) - czyli pierwszy bajt
// dokumentu, który po stronie serwera renderuje PUSTE ciało, czekał na
// round-trip do bazy, z którego nie powstawał ani jeden widoczny piksel.
// Dokumenty `/admin` są przy tym na deny-liście NES Edge Cache
// (`PUBLIC_DOCUMENT_DENY_PREFIXES`), więc ten koszt płaci KAŻDE twarde
// wejście do panelu, nigdy nie amortyzowany trafieniem w cache.
//
// CZEGO TEN MODUŁ NIE OBEJMUJE i dlaczego. Inne trasy z `ssr: false`
// (`/messages`, `/welcome`, `/scanner`, `/events/*/register`, ...) POKAZUJĄ
// chrome serwisu: nagłówek i stopka renderują się na serwerze z tych samych
// ustawień, więc ich fala 1 maluje realny HTML i musi zostać. Lista jest
// zawężona do powierzchni, która nie renderuje serwerowo ANI treści,
// ANI chrome'u - dziś dokładnie jedna.
import { stripLangPrefix } from "@/lib/i18n/localePath";

/**
 * Górna granica czekania fali 1 na dokumencie bez serwerowego renderu.
 *
 * NIE JEST TO ZERO, i to jest świadome. Gdy ustawienia siedzą już w
 * `edgeTtlCache` izolatu (60 s TTL) albo baza odpowiada zdrowo, fala 1
 * rozstrzyga się w dziesiątkach milisekund i dehydratowany stan oszczędza
 * klientowi round-trip po hydratacji - w tym `theme_options`, z których
 * `AdminShell` czyta docelową szerokość paska bocznego. Termin ma ograniczyć
 * SZKODĘ przypadku zimnego/chorego, nie zabrać korzyści przypadku zdrowego.
 *
 * 300 ms: powyżej zdrowego round-tripu do PostgREST (dziesiątki ms nawet po
 * uzgodnieniu TLS na zimnym izolacie), a jednocześnie rząd wielkości poniżej
 * 2 500 ms fali 1. Wyczerpanie terminu NIE jest awarią: zapytania zostają
 * zasiane PRZETERMINOWANYMI domyślnymi (`updatedAt: 0`), więc klient dociąga
 * wartości najemcy natychmiast po hydratacji - dokładnie tą samą ścieżką,
 * którą i tak idzie każda inna dana panelu.
 */
export const CLIENT_ONLY_WARM_BUDGET_MS = 300;

/** Powierzchnie bez serwerowego renderu treści I bez chrome'u serwisu. */
const CLIENT_ONLY_PREFIXES = ["/admin"] as const;

/**
 * Czy dokument tej ścieżki powstaje w całości po hydratacji.
 *
 * Prefiks języka jest zdejmowany, bo loader korzenia dostaje `pathname`
 * SPRZED przepisania trasy (ta sama ostrożność, co przy rozpoznaniu strony
 * głównej w `__root.tsx`, gdzie warunek wymienia `/` i `/en` osobno).
 */
export function isClientOnlyDocument(pathname: string): boolean {
  const { pathname: bare } = stripLangPrefix(pathname);
  return CLIENT_ONLY_PREFIXES.some((prefix) => bare === prefix || bare.startsWith(`${prefix}/`));
}
