// Logotyp poziomy chrome'u (pasek mobilny `Header.tsx`, pasek czytania
// `share/ReadingHeader.tsx`) - wariant motywu wybiera CSS, nie stan Reacta.
//
// DLACZEGO NIE `useTheme`. Serwer nie zna motywu odwiedzającego, więc HTML
// niósł zawsze logo jasne, a lustro motywu (`useIslandMirror`) przechodzi na
// ciemne dopiero po hydratacji nagłówka. Klasę `.dark` na `<html>` ustawia
// jednak skrypt anty-FOUC z `<head>` przed pierwszym malowaniem: ciemne tło
// było od razu, ciemne logo dopiero po bootcie JS. Pomiar na produkcji
// (2026-11-20, iPhone 14, motyw ciemny, CPU x4, 1,6 Mb/s, RTT 150 ms, 4 serie):
// jasne logo na ciemnym pasku przez 4,5-5,0 s, właściwe po 6,0-6,5 s - zaraz
// po hydratacji nagłówka, nie po przejściu motywu.
//
// JAK. Gdy motywy rozstrzygają się do różnych plików, w HTML stoją oba
// `<img>`, a przełącza je wariant `dark:` (`.dark` na `<html>`) - ten sam
// wzorzec co znak powłoki zgód (`consent/ConsentShell.tsx`).
//  - Wariant JASNY dostaje `loading` wywołującego, czyli dokładnie dzisiejszy
//    znacznik motywu serwera: eager w pasku mobilnym, z preloadem Reacta.
//    Odwiedzający z jasnym motywem nie zyskuje ani nie traci niczego.
//  - Wariant CIEMNY jest zawsze leniwy. Leniwy obraz z `display: none` nie
//    jest pobierany (Chrome, Safari, Firefox), więc przy jasnym motywie i na
//    desktopie (pasek `lg:hidden`) nie kosztuje ani bajtu, a przy ciemnym
//    ładuje się zaraz po pierwszym układzie. Eager pobierałby go każdemu i
//    dokładał drugi preload do `<head>`; wariant „oba eager" opóźniał w
//    pomiarze logo jasne (mediana 1,46 s wobec 1,21 s), „oba leniwe" - jeszcze
//    bardziej (1,69 s). Ten układ: jasne bez zmian, ciemne 1,7-2,4 s, zero
//    klatek ze złym logo.
//
// Jeden plik dla obu motywów (albo brak wariantu ciemnego) = jeden `<img>`
// z `loading` wywołującego - znacznik bajt w bajt jak dotąd. Rozmiar naturalny
// idzie za plikiem każdego wariantu (`headerLogoSize`), więc `width`/`height`
// zawsze opisują swój `src`.
import type { ReactNode } from "react";

import { headerLogoSize, headerLogoSrc, type HeaderLogoConfig } from "@/lib/brand/headerLogo";

interface HeaderLogoImageProps {
  /** `theme_options.logo` (warianty i lista naturalnych rozmiarów). */
  logo: HeaderLogoConfig | null | undefined;
  alt: string;
  /** Klasy rozmiaru obrazu; warianty dostają do nich `dark:hidden` / `hidden dark:block`. */
  className: string;
  /** `loading` pliku jasnego (motyw serwera). Wariant ciemny jest zawsze leniwy. */
  loading: "eager" | "lazy";
  /** Treść bez żadnego wariantu logo (wordmark tekstowy). */
  fallback: ReactNode;
}

export function HeaderLogoImage({ logo, alt, className, loading, fallback }: HeaderLogoImageProps) {
  // Oba łańcuchy obejmują wszystkie cztery warianty, więc są puste tylko razem.
  const light = headerLogoSrc(logo, false);
  const dark = headerLogoSrc(logo, true);
  if (!light || !dark) return <>{fallback}</>;

  const lightSize = headerLogoSize(logo, false);
  if (light === dark) {
    return (
      <img
        src={light}
        alt={alt}
        width={lightSize?.width}
        height={lightSize?.height}
        className={className}
        loading={loading}
        decoding="async"
      />
    );
  }

  const darkSize = headerLogoSize(logo, true);
  return (
    <>
      <img
        src={light}
        alt={alt}
        width={lightSize?.width}
        height={lightSize?.height}
        className={`${className} dark:hidden`}
        loading={loading}
        decoding="async"
        data-logo-theme="light"
      />
      <img
        src={dark}
        alt={alt}
        width={darkSize?.width}
        height={darkSize?.height}
        className={`${className} hidden dark:block`}
        loading="lazy"
        decoding="async"
        data-logo-theme="dark"
      />
    </>
  );
}
