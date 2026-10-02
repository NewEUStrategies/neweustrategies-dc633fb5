// Adresy „na żywo": rzeczywisty URL strony na publicznym originie serwisu oraz
// adresy trzech narzędzi, które pokazują, co na tym adresie WIDZĄ Google,
// Facebook i LinkedIn.
//
// Dlaczego to osobny moduł, a nie literały w JSX: ten sam adres liczy podgląd
// wyniku Google (linia adresu), przycisk „otwórz stronę" i każdy z trzech
// walidatorów. Trzy kopie składania ścieżki rozjechałyby się przy pierwszej
// zmianie prefiksu językowego.
//
// ORIGIN JEST OBOWIĄZKOWY. Do 2026-10 miał domyślną wartość
// `SITE_CANONICAL_ORIGIN` - i właśnie ta wygoda chowała błąd: platforma jest
// wielonajemcowa, a wywołanie bez originu po cichu kierowało walidatory
// każdego tenanta na domenę marki. Teraz każde wywołanie musi powiedzieć,
// CZYJ to serwis (w panelu: `useTenantPublicOrigin()`); zapomnienie jest
// błędem kompilacji, nie cichym linkiem do cudzej strony.

/** Segment-zaślepka, którą podgląd rysuje, gdy ścieżka nadrzędna jeszcze się nie wczytała. */
const PLACEHOLDER_SEGMENT = "…";

/**
 * Rzeczywisty, absolutny adres strony na podanym originie publicznym.
 *
 * Segmenty puste i zaślepkę pomijamy - adres z „…" w środku nie istnieje
 * i żaden walidator by go nie otworzył.
 */
export function livePageUrl(path: string, origin: string): string {
  const clean = path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "" && segment !== PLACEHOLDER_SEGMENT)
    .join("/");
  const base = origin.replace(/\/+$/, "");
  return clean === "" ? base : `${base}/${clean}`;
}

/** Wynik Google dla dokładnie tego adresu (operator `site:`). */
export function googleResultUrl(url: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`site:${url}`)}`;
}

/** Sharing Debugger Facebooka - pokazuje kartę, którą FB widzi pod adresem. */
export function facebookDebuggerUrl(url: string): string {
  return `https://developers.facebook.com/tools/debug/?q=${encodeURIComponent(url)}`;
}

/** Post Inspector LinkedIna - to samo dla LinkedIna, z możliwością odświeżenia cache. */
export function linkedinInspectorUrl(url: string): string {
  return `https://www.linkedin.com/post-inspector/inspect/${encodeURIComponent(url)}`;
}
