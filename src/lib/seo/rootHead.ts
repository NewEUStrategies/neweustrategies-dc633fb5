// Deskryptory `<link>` i wartości nagłówka HTTP `Link` dla korzenia dokumentu.
//
// PO CO OSOBNY MODUŁ. Te dwa zestawy MUSZĄ mówić to samo: `<link>` w `<head>`
// i nagłówek `Link` odpowiedzi opisują ten sam plan pobierania zasobów, tylko
// dwiema drogami (nagłówek startuje pobieranie, zanim parser dojdzie do
// `<head>` - fundament pod 103 Early Hints). Rozjazd między nimi nie daje
// żadnego objawu poza cichą stratą wydajności: przeglądarka rozgrzewa
// połączenie, którego nikt nie użyje, albo płaci pełny DNS+TCP+TLS na zimno.
// Wplecione w `__root.tsx` były dwiema listami literałów w odległości
// pięćdziesięciu linii, bez żadnego testu parytetu.
//
// CO ZOSTAJE W `__root.tsx`: wstrzyknięcie URL-i assetów (importy `?url`
// rozwiązuje bundler) i wywołanie `appendLinkHeader` (zakres żądania).
// Ten moduł jest czysty i przyjmuje URL-e parametrem.
import type { AppLang } from "@/lib/i18n/localePath";
import { feedDiscoveryLinks } from "./meta";
import { fontPreloadLinkHeaderValues, fontPreloadLinks } from "./fontPreload";

/**
 * Origin Supabase używany do rozgrzania połączenia.
 *
 * JEDNO MIEJSCE zamiast czterech kopii tego samego literału (`__root.tsx`
 * miał go w liniach 221, 224, 235 i 270). Wartość jest zaszyta - tak samo jak
 * była - a nie brana z `resolveSupabasePublicConfig()`, którego używa klient
 * w runtime. Rozjazd tych dwóch źródeł jest realnym defektem i jest zgłoszony
 * w `src/lib/seo/__tests__/rootHead.test.ts` jako `it.fails`; naprawa (podanie
 * rozwiązanego originu) zmienia zachowanie produkcyjne, więc jest decyzją
 * dla człowieka, nie skutkiem ubocznym refaktoru pod testy.
 */
export const SUPABASE_PRECONNECT_ORIGIN = "https://unnltowbgszpdzwpawdu.supabase.co";

/** URL-e zasobów krytycznych - wstrzykiwane, bo rozwiązuje je bundler. */
export interface RootAssets {
  /** Arkusz stylów aplikacji (`?url`). */
  readonly appCss: string;
  /** Podzbiór fontu Latin. */
  readonly fontLatin: string;
  /** Podzbiór Latin-ext (polskie diakrytyki). */
  readonly fontLatinExt: string;
}

/** Deskryptor `<link>` w kształcie, w jakim przyjmuje go router. */
export type RootLinkDescriptor = Record<string, string>;

/**
 * Wszystkie `<link>` korzenia dokumentu.
 *
 * DWA PRECONNECTY DO JEDNEGO ORIGINU NIE SĄ DUPLIKATEM: przeglądarka kluczuje
 * połączenia parą (origin, tryb poświadczeń). Wariant `anonymous` rozgrzewa
 * pulę CORS (fetch supabase-js), a każdy `<img>` okładki idzie w trybie
 * no-cors i bez drugiego wpisu płaciłby pełny handshake na zimno.
 * Router deduplikuje `links` wyłącznie po głębokiej równości całego tagu,
 * więc oba przechodzą - i tak ma zostać.
 */
export function rootDocumentLinks(
  lang: AppLang,
  origin: string,
  assets: RootAssets,
): RootLinkDescriptor[] {
  return [
    { rel: "stylesheet", href: assets.appCss },
    // Favicon jawnie zadeklarowany, żeby crawlery i podglądy linków pobrały
    // znak marki, a nie domyślny znak generatora.
    { rel: "icon", href: "/favicon.ico", sizes: "any" },
    { rel: "apple-touch-icon", href: "/favicon.ico" },
    ...fontPreloadLinks(lang, { latin: assets.fontLatin, latinExt: assets.fontLatinExt }),
    { rel: "dns-prefetch", href: SUPABASE_PRECONNECT_ORIGIN },
    { rel: "preconnect", href: SUPABASE_PRECONNECT_ORIGIN, crossOrigin: "anonymous" },
    { rel: "preconnect", href: SUPABASE_PRECONNECT_ORIGIN },
    ...feedDiscoveryLinks(origin),
  ];
}

/**
 * Wartość nagłówka `Link` dla chunku rdzenia słownika AKTYWNEGO języka.
 *
 * PO CO. Rdzeń słownika jest dociągany top-level awaitem w tym samym chunku,
 * w którym stoi `hydrateRoot` (`lib/i18n.ts`). Przeglądarka pobiera komplet
 * preloadów manifestu korzenia, zaczyna wykonywać chunk wejściowy, DOPIERO WTEDY
 * odkrywa `import("@/lib/locale/pl")` i płaci pełny, kolejny SZEREGOWY hop -
 * w oknie, w którym cała reszta już czeka na hydratację.
 *
 * CO TO REALNIE DAJE, ŻEBY NIE OBIECYWAĆ ZA DUŻO: treść SSR jest w tym momencie
 * JUŻ NA EKRANIE (arkusz i fonty mają własne hinty), więc zysk idzie w czas do
 * INTERAKTYWNOŚCI, nie w FCP.
 *
 * TO JEST JEDYNA ŚWIADOMA ASYMETRIA między `<link>` a nagłówkiem `Link` w tym
 * module i dlatego stoi w osobnej funkcji, a nie w liście wyżej. Nazwa pliku
 * chunku jest znana WYŁĄCZNIE w środowisku serwerowym: bundel przeglądarki
 * wczytuje moduł wirtualny, zanim chunki dostaną nazwy. Węzeł
 * `<link rel="modulepreload">` w `<head>` byłby więc obecny w SSR-owym HTML-u
 * i nieobecny w pierwszym renderze klienta - czyli ROZJAZD TOŻSAMOŚCI
 * W KORZENIU DOKUMENTU, ta sama klasa awarii, którą ten obszar naprawia.
 * Nagłówek HTTP nie jest częścią DOM-u, więc problemu nie ma z konstrukcji,
 * a przy tym działa WCZEŚNIEJ niż `<link>` (przed sparsowaniem `<head>`)
 * i jest utrwalany w NES Edge Cache na HIT/STALE.
 */
export function dictionaryPreloadLinkHeaderValue(chunkUrl: string | null): string | null {
  if (!chunkUrl) return null;
  // `modulepreload` (nie `preload as=script`): przeglądarka ma nie tylko pobrać
  // plik, ale też sparsować go i wstawić do mapy modułów - inaczej `import()`
  // w entry nadal czekałby na kompilację.
  return `<${chunkUrl}>; rel="modulepreload"`;
}

/**
 * Wartości nagłówka HTTP `Link` dla tych samych zasobów krytycznych.
 *
 * Kolejność jest kontraktem: arkusz stylów pierwszy (blokuje render),
 * potem rozgrzanie połączenia do hosta obrazów, na końcu fonty.
 */
export function rootLinkHeaderValues(lang: AppLang, assets: RootAssets): string[] {
  return [
    `<${assets.appCss}>; rel="preload"; as="style"`,
    // Tryb z poświadczeniami, tak jak `<img>` - odpowiednik trzeciego
    // `<link rel=preconnect>` wyżej.
    `<${SUPABASE_PRECONNECT_ORIGIN}>; rel="preconnect"`,
    ...fontPreloadLinkHeaderValues(lang, {
      latin: assets.fontLatin,
      latinExt: assets.fontLatinExt,
    }),
  ];
}
