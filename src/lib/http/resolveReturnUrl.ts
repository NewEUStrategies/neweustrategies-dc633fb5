// Bezwzględny adres powrotu dla Stripe Embedded Checkout (plan, kwota ad-hoc,
// darowizna) ze ŚCIEŻKI albo z PEŁNEGO URL-a podanego przez klienta.
//
// ORIGIN NIE POCHODZI JUŻ Z NAGŁÓWKA. Do 13.09.2026 ten moduł sklejał adres
// wprost z `origin` / `x-forwarded-proto` / `x-forwarded-host` / `host`, czyli
// z wartości, które klient podaje dowolnie (server fn nie musi być wołana
// z przeglądarki, a `x-forwarded-*` bywa doklejany przez warstwę pośrednią).
// Docstring obiecywał przy tym ochronę, której nie było: host był odcinany od
// ARGUMENTU, a zaraz potem wczytywany z NAGŁÓWKA, który klient kontroluje
// równie łatwo. Wynik szedł do operatora płatności jako `return_url` - czyli
// przekierowanie po ZAKOŃCZONEJ, prawdziwej transakcji, w momencie najwyższego
// zaufania użytkownika do tego, co zobaczy.
//
// Ten sam defekt został zamknięty 31.08.2026 dla portalu klienta
// (`lib/billing/returnUrl.server.ts`) - drugi silnik checkoutu po prostu nigdy
// przez tamtą bramkę nie przechodził. Bramka zostaje JEDNA i mieszka tam.
//
// DRUGA POŁOWA ADRESU TEŻ JEST OD KLIENTA - I TO JEST DRUGI, OSOBNY OTWÓR.
// Zamknięcie originu nie wystarcza: `pathname` potrafi zaczynać się od `//`,
// a `//host` jest adresem PROTOKOŁO-WZGLĘDNYM, który NADPISUJE autorytet bazy.
// ZMIERZONE na wersji z samą bramką originu:
//
//   resolveReturnUrl("https://neweuropeanstrategies.com//evil.example.org/x")
//     -> "https://evil.example.org/x"
//
// czyli bramka originu przepuszczała dokładnie to, przed czym miała bronić.
// Portal klienta jest na to odporny, bo jego połowa ścieżki idzie przez
// `safeReturnPath` (`returnPath.ts` odrzuca `//` i `/\`). Tutaj nie wolno użyć
// tamtej funkcji wprost - dwa silniki checkoutu przyjmują w schemacie zod PEŁNY
// URL (`z.string().url()`), który `safeReturnPath` odrzuca w całości, więc
// każdy kupujący lądowałby na `/profile/plan`. Zamiast listy zakazanych
// prefiksów sprawdzamy więc niezmiennik SKUTKU: adres wyjściowy MUSI mieć nasz
// origin. Taki warunek łapie każdy sposób nadpisania autorytetu, nie tylko dwa
// znane zapisy.
//
// FUNKCJA POZOSTAJE SYNCHRONICZNA i to jest decyzja, nie zaniedbanie. Kuszący
// „zaufany rozstrzygacz hosta" (`trustedPublicHost` -> `pickTrustedHost`) przy
// PUSTYM albo nieosiągalnym katalogu domen oddaje `forwarded[0] ?? host`, czyli
// surowy nagłówek atakującego (`lib/server/tenant.server.ts`, ostatnia reguła
// `pickTrustedHost`) - a pod vitestem `import.meta.env.SSR` jest fałszem, więc
// czyta surowy nagłówek ZAWSZE. Naprawa oparta o tamtą ścieżkę wyglądałaby na
// zieloną i nie byłaby naprawą; kontrapunkt stoi jako nazwany przypadek
// w `lib/server/__tests__/trustedHost.test.ts`.
import { DEFAULT_RETURN_PATH } from "@/lib/billing/returnPath";
import { trustedReturnOrigin } from "@/lib/billing/returnUrl.server";
import { CANONICAL_SITE_ORIGIN } from "@/lib/http/host";

/**
 * Buduje bezwzględny adres powrotu ze ścieżki względnej albo z pełnego URL-a
 * podanego przez klienta.
 *
 * Gwarancja jest jedna i sprawdzalna: WYNIK ZAWSZE MA NASZ ORIGIN. Host
 * z argumentu jest odrzucany, origin pochodzi z bramki dozwolonych hostów,
 * a gdyby ścieżka mimo to przeniosła autorytet gdzie indziej, wołający dostaje
 * domyślny ekran na naszym originie. Nigdy nie rzuca: wyjątek na tej ścieżce
 * zamieniłby open redirect w odmowę usługi (dokładnie ten defekt opisuje
 * nagłówek `returnUrl.server.ts`).
 */
export function resolveReturnUrl(pathOrUrl: string): string {
  const origin = trustedReturnOrigin();

  let path = pathOrUrl;
  try {
    const parsed = new URL(pathOrUrl, "http://localhost");
    path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    // Pozostawiamy oryginalną wartość; niezmiennik originu niżej i tak
    // zdecyduje, czy da się z niej zrobić nasz adres.
  }

  try {
    const candidate = new URL(path, origin);
    if (candidate.origin === new URL(origin).origin) return candidate.toString();
    // Ścieżka nadpisała autorytet (`//host`, `/\host`, cokolwiek innego).
    // Podmiana na ekran domyślny, a nie wyjątek - patrz nagłówek modułu.
    return new URL(DEFAULT_RETURN_PATH, origin).toString();
  } catch {
    return `${CANONICAL_SITE_ORIGIN}${DEFAULT_RETURN_PATH}`;
  }
}
