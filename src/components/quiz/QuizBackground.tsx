// Tło strony /quiz — warianty light/dark reagujące na motyw PLATFORMY
// (klasa `.dark` na <html>), nie na `prefers-color-scheme` OS.
// Dwie warstwy <img> nakładane na siebie, przełączane opacity przez wariant
// `dark:`. Delikatny parallax na scroll: sylwety przesuwają się wolniej,
// overlay gradientowy jeszcze wolniej — buduje głębię bez rozpraszania.
// Respektuje `prefers-reduced-motion`.

import { useEffect, useRef } from "react";

import lightMobileAsset from "@/assets/quiz/quiz-bg-light-mobile.jpg.asset.json";
import lightDesktopAsset from "@/assets/quiz/quiz-bg-light-desktop.jpg.asset.json";
import darkMobileAsset from "@/assets/quiz/quiz-bg-dark-mobile.jpg.asset.json";
import darkDesktopAsset from "@/assets/quiz/quiz-bg-dark-desktop.jpg.asset.json";

const LIGHT_MOBILE = lightMobileAsset.url;
const LIGHT_DESKTOP = lightDesktopAsset.url;
const DARK_MOBILE = darkMobileAsset.url;
const DARK_DESKTOP = darkDesktopAsset.url;

// Współczynniki parallax (im mniejszy, tym warstwa "dalej"):
//  - crowd: 0.18 → sylwety zsuwają się delikatnie w dół razem ze scrollem
//  - overlay: 0.08 → gradient prawie stoi, wzmacnia efekt głębi
const CROWD_FACTOR = 0.18;
const OVERLAY_FACTOR = 0.08;

export function QuizBackground() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // Reduced motion → wyłącz parallax całkowicie.
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mql.matches) return;

    let rafId = 0;
    let ticking = false;

    const update = () => {
      ticking = false;
      const y = window.scrollY || window.pageYOffset || 0;
      root.style.setProperty("--quiz-parallax-crowd", `${y * CROWD_FACTOR}px`);
      root.style.setProperty(
        "--quiz-parallax-overlay",
        `${y * OVERLAY_FACTOR}px`,
      );
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      rafId = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      {/* Warstwa LIGHT — widoczna w trybie jasnym, znika w .dark */}
      <picture
        className="absolute inset-0 -z-20 block transition-opacity duration-500 ease-out dark:opacity-0 will-change-transform"
        style={{ transform: "translate3d(0, var(--quiz-parallax-crowd, 0px), 0)" }}
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
        className="absolute inset-0 -z-20 block opacity-0 transition-opacity duration-500 ease-out dark:opacity-100 will-change-transform"
        style={{ transform: "translate3d(0, var(--quiz-parallax-crowd, 0px), 0)" }}
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

      {/* Overlay LIGHT — delikatny, ciepły; parallax jeszcze wolniejszy */}
      <div
        className="absolute inset-0 -z-10 transition-opacity duration-500 ease-out dark:opacity-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--background)/0.95)_0%,hsl(var(--background)/0.75)_35%,hsl(var(--background)/0.55)_65%,hsl(var(--background)/0.72)_100%)] will-change-transform"
        style={{ transform: "translate3d(0, var(--quiz-parallax-overlay, 0px), 0)" }}
      />
      {/* Overlay DARK — głębszy, chłodny; utrzymuje kontrast headera i quizu */}
      <div
        className="absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 ease-out dark:opacity-100 bg-[radial-gradient(ellipse_at_top,hsl(var(--background)/0.96)_0%,hsl(var(--background)/0.82)_35%,hsl(var(--background)/0.68)_65%,hsl(var(--background)/0.85)_100%)] will-change-transform"
        style={{ transform: "translate3d(0, var(--quiz-parallax-overlay, 0px), 0)" }}
      />
    </div>
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
