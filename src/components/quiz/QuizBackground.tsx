// Tło strony /quiz — warianty light/dark reagujące na motyw PLATFORMY
// (klasa `.dark` na <html>), nie na `prefers-color-scheme` OS.
// Wg `docs/WYTYCZNE_TLO_QUIZ.md`. Dwie warstwy <img> nakładane na siebie,
// przełączane opacity przez wariant `dark:` — dzięki temu przełącznik motywu
// w aplikacji faktycznie zmienia tło. Overlay gradientowy dostrojony osobno
// dla obu trybów.

import lightMobileAsset from "@/assets/quiz/quiz-bg-light-mobile.jpg.asset.json";
import lightDesktopAsset from "@/assets/quiz/quiz-bg-light-desktop.jpg.asset.json";
import darkMobileAsset from "@/assets/quiz/quiz-bg-dark-mobile.jpg.asset.json";
import darkDesktopAsset from "@/assets/quiz/quiz-bg-dark-desktop.jpg.asset.json";

const LIGHT_MOBILE = lightMobileAsset.url;
const LIGHT_DESKTOP = lightDesktopAsset.url;
const DARK_MOBILE = darkMobileAsset.url;
const DARK_DESKTOP = darkDesktopAsset.url;

export function QuizBackground() {
  return (
    <>
      {/* Warstwa LIGHT — widoczna w trybie jasnym, znika w .dark */}
      <picture
        className="pointer-events-none absolute inset-0 -z-20 block transition-opacity duration-500 ease-out dark:opacity-0"
        aria-hidden="true"
      >
        <source media="(max-width: 767px)" srcSet={LIGHT_MOBILE} />
        <source media="(min-width: 768px)" srcSet={LIGHT_DESKTOP} />
        <img
          src={LIGHT_DESKTOP}
          alt=""
          decoding="async"
          fetchPriority="high"
          className="h-full w-full object-cover object-bottom"
        />
      </picture>

      {/* Warstwa DARK — domyślnie ukryta, pełne opacity w .dark */}
      <picture
        className="pointer-events-none absolute inset-0 -z-20 block opacity-0 transition-opacity duration-500 ease-out dark:opacity-100"
        aria-hidden="true"
      >
        <source media="(max-width: 767px)" srcSet={DARK_MOBILE} />
        <source media="(min-width: 768px)" srcSet={DARK_DESKTOP} />
        <img
          src={DARK_DESKTOP}
          alt=""
          decoding="async"
          className="h-full w-full object-cover object-bottom"
        />
      </picture>

      {/* Overlay LIGHT — delikatny, ciepły, żeby sylwety nie dominowały nad iframe */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 transition-opacity duration-500 ease-out dark:opacity-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--background)/0.95)_0%,hsl(var(--background)/0.75)_35%,hsl(var(--background)/0.55)_65%,hsl(var(--background)/0.72)_100%)]"
        aria-hidden="true"
      />
      {/* Overlay DARK — głębszy, chłodny; utrzymuje kontrast headera i quizu */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 ease-out dark:opacity-100 bg-[radial-gradient(ellipse_at_top,hsl(var(--background)/0.96)_0%,hsl(var(--background)/0.82)_35%,hsl(var(--background)/0.68)_65%,hsl(var(--background)/0.85)_100%)]"
        aria-hidden="true"
      />
    </>
  );
}

/** Preload dla LCP tła. Wpinane w head() trasy /quiz.
 *  Motyw platformy nie jest znany na etapie SSR head, więc preloadujemy
 *  wariant LIGHT (domyślny) per breakpoint; DARK dociągnie się przy hydracji. */
export const QUIZ_BG_PRELOAD_LINKS = [
  {
    rel: "preload",
    as: "image",
    href: LIGHT_MOBILE,
    media: "(max-width: 767px)",
    fetchpriority: "high",
  },
  {
    rel: "preload",
    as: "image",
    href: LIGHT_DESKTOP,
    media: "(min-width: 768px)",
    fetchpriority: "high",
  },
  {
    rel: "prefetch",
    as: "image",
    href: DARK_MOBILE,
    media: "(max-width: 767px)",
  },
  {
    rel: "prefetch",
    as: "image",
    href: DARK_DESKTOP,
    media: "(min-width: 768px)",
  },
] as const;
