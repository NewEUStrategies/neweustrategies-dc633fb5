// Czysty, niezależny od frameworka budowniczy preloadu jedynego fontu ścieżki
// krytycznej (Red Hat Display z własnego serwera). Bez efektów ubocznych (bez
// importu assetów, bez DOM-u), więc w pełni testowalny jednostkowo; URL z
// odciskiem Vite wstrzykuje wywołujący (trasa korzenia importuje go przez `?url`).
//
// JEDEN PLIK DLA PL I EN (P3.2b, fala 3; decyzja właściciela 2026-10-08:
// jedynym fontem w ścieżce krytycznej jest Red Hat Display). Plik
// `red-hat-display-latin-pl.woff2` niesie latin + 18 polskich liter. Dawniej PL
// preloadował dwa pliki (latin + latin-ext, 44 732 B w dwóch żądaniach) za 18
// liter z latin-ext; teraz jedno żądanie ~24 KB dla obu języków. Latin-ext
// zostaje w `styles.css` jako twarz BEZ preloadu dla innych diakrytyków.
// Zasadę pilnują bramki: `fontPreloadCount` w `check:document-weight`
// i `e2e/single-font.boot-home.spec.ts` (jedno żądanie woff2 z buildu).

/** Deskryptor `<link>` w kształcie, w jakim przyjmuje go `head().links` routera. */
export type FontPreloadLink = Record<string, string>;

/**
 * Deskryptor `<link rel="preload" as="font">` jedynego fontu ścieżki krytycznej.
 *
 * `crossOrigin` jest obowiązkowe nawet dla fontu z tego samego originu: żądanie
 * wywołane przez CSS jest zawsze anonimowe-CORS, więc preload bez niego nie
 * zostałby użyty ponownie i przeglądarka pobrałaby font drugi raz.
 */
export function fontPreloadLinks(href: string): FontPreloadLink[] {
  return [{ rel: "preload", as: "font", type: "font/woff2", href, crossOrigin: "anonymous" }];
}

/**
 * Ten sam preload jako wartość nagłówka HTTP `Link` (RFC 8288). Emitowany obok
 * `<link>` w dokumencie: przeglądarka startuje pobieranie z nagłówków odpowiedzi
 * (przed pierwszym bajtem HTML), a Cloudflare może powtórzyć go jako 103 Early
 * Hints. `crossorigin` jest obowiązkowe z tego samego powodu co wyżej.
 */
export function fontPreloadLinkHeaderValues(href: string): string[] {
  return [`<${href}>; rel="preload"; as="font"; type="font/woff2"; crossorigin`];
}
