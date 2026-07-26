// Tło strony /quiz — warianty light/dark z srcSet + media queries wg
// `docs/WYTYCZNE_TLO_QUIZ.md`. Renderujemy <picture> pod całą zawartością
// (absolute inset-0 -z-20) + overlay gradientowy, który utrzymuje czytelność
// headera i iframe'u quizu w OBU trybach (nie polegamy już na `dark:invert`).

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
      <picture
        className="pointer-events-none absolute inset-0 -z-20 block"
        aria-hidden="true"
      >
        {/* Dark — pierwsze wygrywa, więc dark leci przed light */}
        <source
          media="(prefers-color-scheme: dark) and (max-width: 767px)"
          srcSet={DARK_MOBILE}
        />
        <source
          media="(prefers-color-scheme: dark)"
          srcSet={DARK_DESKTOP}
        />
        {/* Light */}
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

      {/* Overlay gradientowy — osobne krzywe dla light i dark, żeby header
          i iframe pozostały czytelne bez `dark:invert`. */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_top,hsl(var(--background)/0.62),hsl(var(--background)/0.82)_45%,hsl(var(--background)/0.94))] dark:bg-[linear-gradient(to_top,hsl(var(--background)/0.68),hsl(var(--background)/0.86)_45%,hsl(var(--background)/0.96))]"
        aria-hidden="true"
      />
    </>
  );
}

/** Preload dla LCP tła. Wpinane w head() trasy /quiz. */
export const QUIZ_BG_PRELOAD_LINKS = [
  {
    rel: "preload",
    as: "image",
    href: LIGHT_MOBILE,
    media: "(prefers-color-scheme: light) and (max-width: 767px)",
    fetchpriority: "high",
  },
  {
    rel: "preload",
    as: "image",
    href: DARK_MOBILE,
    media: "(prefers-color-scheme: dark) and (max-width: 767px)",
    fetchpriority: "high",
  },
  {
    rel: "preload",
    as: "image",
    href: LIGHT_DESKTOP,
    media: "(prefers-color-scheme: light) and (min-width: 768px)",
    fetchpriority: "high",
  },
  {
    rel: "preload",
    as: "image",
    href: DARK_DESKTOP,
    media: "(prefers-color-scheme: dark) and (min-width: 768px)",
    fetchpriority: "high",
  },
] as const;
