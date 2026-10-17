// Logotyp poziomy chrome'u serwisu: pasek mobilny `Header.tsx` i pasek czytania
// `share/ReadingHeader.tsx`. JEDNO źródło prawdy dla wyboru wariantu ORAZ formy
// adresu - oba paski muszą dawać bajt w bajt ten sam `src`.
//
// DLACZEGO TO WSPÓLNY HELPER, A NIE DWIE KOPIE. React 19 (Fizz) sam wstawia do
// `<head>` `<link rel="preload" as="image">` dla każdego eager `<img>` w powłoce
// i deduplikuje je kluczem zasobu: bez `srcSet` kluczem jest SUROWY `src`. Logo
// motywu to SVG bez `srcSet`, a na wpisie renderują się oba paski naraz. Dopóki
// każdy liczył logo u siebie, pasek mobilny dawał adres względny
// (`renderedMediaUrl`, P3.2a/P4.2), a pasek czytania absolutny
// (`https://neweuropeanstrategies.com/media/...`) - dwa różne klucze, więc KAŻDY
// wpis miał w `<head>` dwa preloady tego samego pliku (na hostach najemców i
// podglądu także dwa pobrania: drugi adres to inny origin). Ten sam napis z
// jednej funkcji daje jeden klucz niezależnie od tego, który pasek Fizz
// wyemituje pierwszy (przy zdegradowanym chrome nagłówek dochodzi strumieniem
// później, a preload logo paska czytania jest już w `<head>`).
import { renderedMediaUrl } from "@/lib/cropSizes";

/** Warianty z Branding -> Logo (`theme_options.logo`), które czytają paski. */
export interface HeaderLogoVariants {
  main?: string;
  main_dark?: string;
  mobile?: string;
  mobile_dark?: string;
}

/**
 * Adres logotypu poziomego dla motywu albo `""`, gdy żaden wariant nie jest
 * ustawiony (paski pokazują wtedy wordmark tekstowy).
 *
 * Łańcuch: ciemny `mobile_dark` -> `main_dark` -> `mobile` -> `main` (na
 * telefonie i tablecie ten sam jasny napis co na desktopie, warianty jasne
 * dopiero awaryjnie), jasny `mobile` -> `main` -> `mobile_dark` -> `main_dark`.
 * Pusty napis i wartość innego typu niż napis (uszkodzony wiersz ustawień) nie
 * wygrywają - wartość niebędąca napisem wywróciłaby `renderedMediaUrl` w SSR.
 *
 * Wynik przechodzi przez `renderedMediaUrl`: plik `/media/...` kanonicznego
 * originu staje się ścieżką względną, każdy inny adres wraca bez zmian. Tylko
 * do `src` renderowanego `<img>` - nigdy do JSON-LD ani metadanych (te muszą
 * zostać absolutne, patrz `renderedMediaUrl`).
 */
export function headerLogoSrc(
  logo: HeaderLogoVariants | null | undefined,
  isDark: boolean,
): string {
  const l = logo ?? {};
  const chain = isDark
    ? [l.mobile_dark, l.main_dark, l.mobile, l.main]
    : [l.mobile, l.main, l.mobile_dark, l.main_dark];
  const picked = chain.find((url): url is string => typeof url === "string" && url.length > 0);
  return picked ? renderedMediaUrl(picked) : "";
}
