// Tło strony /quiz — warianty light/dark z srcSet + media queries wg
// `docs/WYTYCZNE_TLO_QUIZ.md`. Renderujemy <picture> pod całą zawartością
// (absolute inset-0 -z-20) + overlay gradientowy, który utrzymuje czytelność
// headera i iframe'u quizu w OBU trybach (nie polegamy już na `dark:invert`).
//
// Dopóki dedykowane pliki nie trafią do `public/quiz/`, <img> fallback
// pokazuje aktualną grafikę (`src/assets/quiz-fans-bg.png`). Kiedy nowe
// warianty się pojawią, <source> je automatycznie przejmie.

import quizFansBg from "@/assets/quiz-fans-bg.png.asset.json";

// Ścieżki nowych wariantów (public/quiz/*). Zgodne z sekcją 8.1 wytycznych.
const LIGHT = {
  mobile: "/quiz/quiz-bg-light-mobile-640x1200.webp",
  mobile2x: "/quiz/quiz-bg-light-mobile-640x1200@2x.webp",
  tablet: "/quiz/quiz-bg-light-tablet-1024x1400.webp",
  tablet2x: "/quiz/quiz-bg-light-tablet-1024x1400@2x.webp",
  desktop: "/quiz/quiz-bg-light-desktop-1920x1600.webp",
  desktop2x: "/quiz/quiz-bg-light-desktop-1920x1600@2x.webp",
  wide: "/quiz/quiz-bg-light-wide-2560x1800.webp",
};
const DARK = {
  mobile: "/quiz/quiz-bg-dark-mobile-640x1200.webp",
  mobile2x: "/quiz/quiz-bg-dark-mobile-640x1200@2x.webp",
  tablet: "/quiz/quiz-bg-dark-tablet-1024x1400.webp",
  tablet2x: "/quiz/quiz-bg-dark-tablet-1024x1400@2x.webp",
  desktop: "/quiz/quiz-bg-dark-desktop-1920x1600.webp",
  desktop2x: "/quiz/quiz-bg-dark-desktop-1920x1600@2x.webp",
  wide: "/quiz/quiz-bg-dark-wide-2560x1800.webp",
};

export function QuizBackground() {
  return (
    <>
      <picture
        className="pointer-events-none absolute inset-0 -z-20 block"
        aria-hidden="true"
      >
        {/* Dark mode — reagujemy na klasę `.dark` (theme provider) ORAZ
            preferencję systemową. Kolejność <source> ma znaczenie: pierwszy
            pasujący wygrywa, więc dark leci przed light. */}
        <source
          media="(prefers-color-scheme: dark) and (max-width: 639px)"
          srcSet={`${DARK.mobile} 1x, ${DARK.mobile2x} 2x`}
          type="image/webp"
        />
        <source
          media="(prefers-color-scheme: dark) and (max-width: 1023px)"
          srcSet={`${DARK.tablet} 1x, ${DARK.tablet2x} 2x`}
          type="image/webp"
        />
        <source
          media="(prefers-color-scheme: dark) and (min-width: 1920px)"
          srcSet={`${DARK.wide} 1x`}
          type="image/webp"
        />
        <source
          media="(prefers-color-scheme: dark)"
          srcSet={`${DARK.desktop} 1x, ${DARK.desktop2x} 2x`}
          type="image/webp"
        />

        {/* Light mode */}
        <source
          media="(max-width: 639px)"
          srcSet={`${LIGHT.mobile} 1x, ${LIGHT.mobile2x} 2x`}
          type="image/webp"
        />
        <source
          media="(max-width: 1023px)"
          srcSet={`${LIGHT.tablet} 1x, ${LIGHT.tablet2x} 2x`}
          type="image/webp"
        />
        <source
          media="(min-width: 1920px)"
          srcSet={`${LIGHT.wide} 1x`}
          type="image/webp"
        />
        <source
          media="(min-width: 1024px)"
          srcSet={`${LIGHT.desktop} 1x, ${LIGHT.desktop2x} 2x`}
          type="image/webp"
        />

        {/* Fallback — aktualny plik PNG (dopóki nie ma nowych wariantów).
            object-position: bottom = odpowiednik `bg-bottom`. */}
        <img
          src={quizFansBg.url}
          alt=""
          decoding="async"
          fetchPriority="high"
          className="h-full w-full object-cover object-bottom"
        />
      </picture>

      {/* Overlay gradientowy — silniejszy u góry (czytelny header) i u dołu
          (kontrast dla iframe'u). Osobne tokeny dla light i dark, żeby nie
          polegać na `dark:invert`, które psuło kolory sylwetek. */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_top,hsl(var(--background)/0.72),hsl(var(--background)/0.88)_40%,hsl(var(--background)/0.96))] dark:bg-[linear-gradient(to_top,hsl(var(--background)/0.78),hsl(var(--background)/0.9)_40%,hsl(var(--background)/0.97))]"
        aria-hidden="true"
      />
    </>
  );
}

/** Preload dla LCP tła. Wpinane w head() trasy /quiz. */
export const QUIZ_BG_PRELOAD_LINKS = [
  // Mobile — light
  {
    rel: "preload",
    as: "image",
    href: LIGHT.mobile,
    imagesrcset: `${LIGHT.mobile} 1x, ${LIGHT.mobile2x} 2x`,
    media: "(prefers-color-scheme: light) and (max-width: 639px)",
    fetchpriority: "high",
    type: "image/webp",
  },
  // Mobile — dark
  {
    rel: "preload",
    as: "image",
    href: DARK.mobile,
    imagesrcset: `${DARK.mobile} 1x, ${DARK.mobile2x} 2x`,
    media: "(prefers-color-scheme: dark) and (max-width: 639px)",
    fetchpriority: "high",
    type: "image/webp",
  },
  // Desktop — light
  {
    rel: "preload",
    as: "image",
    href: LIGHT.desktop,
    imagesrcset: `${LIGHT.desktop} 1x, ${LIGHT.desktop2x} 2x`,
    media: "(prefers-color-scheme: light) and (min-width: 1024px)",
    fetchpriority: "high",
    type: "image/webp",
  },
  // Desktop — dark
  {
    rel: "preload",
    as: "image",
    href: DARK.desktop,
    imagesrcset: `${DARK.desktop} 1x, ${DARK.desktop2x} 2x`,
    media: "(prefers-color-scheme: dark) and (min-width: 1024px)",
    fetchpriority: "high",
    type: "image/webp",
  },
] as const;
