// Tło strony /quiz - warianty light/dark reagujące na motyw PLATFORMY
// (klasa `.dark` na <html>).
//
// Optymalizacja ładowania:
//  - SSR renderuje tylko wariant LIGHT (odpowiada preloadowi w head()).
//  - Po hydracji odczytujemy realny motyw i zamieniamy warstwę na DARK
//    dopiero wtedy - dzięki temu użytkownik LIGHT nigdy nie pobiera DARK,
//    a DARK dociąga się jednym żądaniem tylko w razie potrzeby.
//  - Preload właściwego wariantu DARK dokłada inline-script w <head>
//    (patrz QUIZ_BG_PRELOAD_SCRIPT), więc dark-mode dostaje high-priority
//    hint jeszcze przed uruchomieniem Reacta.
//
// Delikatny parallax na scroll respektuje `prefers-reduced-motion`.

import { useEffect, useRef, useState } from "react";

import lightMobileJpg from "@/assets/quiz/quiz-bg-light-mobile.jpg.asset.json";
import lightDesktopJpg from "@/assets/quiz/quiz-bg-light-desktop.jpg.asset.json";
import darkMobileJpg from "@/assets/quiz/quiz-bg-dark-mobile.jpg.asset.json";
import darkDesktopJpg from "@/assets/quiz/quiz-bg-dark-desktop.jpg.asset.json";
import lightMobileWebp from "@/assets/quiz/quiz-bg-light-mobile.webp.asset.json";
import lightDesktopWebp from "@/assets/quiz/quiz-bg-light-desktop.webp.asset.json";
import darkMobileWebp from "@/assets/quiz/quiz-bg-dark-mobile.webp.asset.json";
import darkDesktopWebp from "@/assets/quiz/quiz-bg-dark-desktop.webp.asset.json";
import lightMobileAvif from "@/assets/quiz/quiz-bg-light-mobile.avif.asset.json";
import lightDesktopAvif from "@/assets/quiz/quiz-bg-light-desktop.avif.asset.json";
import darkMobileAvif from "@/assets/quiz/quiz-bg-dark-mobile.avif.asset.json";
import darkDesktopAvif from "@/assets/quiz/quiz-bg-dark-desktop.avif.asset.json";

// Formaty w kolejności negocjacji: AVIF > WebP > JPG (fallback dla <img src>).
const BG = {
  light: {
    mobile: { avif: lightMobileAvif.url, webp: lightMobileWebp.url, jpg: lightMobileJpg.url },
    desktop: { avif: lightDesktopAvif.url, webp: lightDesktopWebp.url, jpg: lightDesktopJpg.url },
  },
  dark: {
    mobile: { avif: darkMobileAvif.url, webp: darkMobileWebp.url, jpg: darkMobileJpg.url },
    desktop: { avif: darkDesktopAvif.url, webp: darkDesktopWebp.url, jpg: darkDesktopJpg.url },
  },
} as const;

const CROWD_FACTOR = 0.18;
const OVERLAY_FACTOR = 0.08;

type Mode = "light" | "dark";

function readMode(): Mode {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

type BgVariant = (typeof BG)["light"];

function BgPicture({ variant }: { variant: BgVariant }) {
  return (
    <picture
      className="absolute inset-0 -z-20 block transition-opacity duration-500 ease-out will-change-transform"
      style={{ transform: "translate3d(0, var(--quiz-parallax-crowd, 0px), 0)" }}
    >
      {/* AVIF - najlżejszy, najnowsze przeglądarki. Mobile+desktop breakpointy. */}
      <source type="image/avif" media="(max-width: 767px)" srcSet={variant.mobile.avif} />
      <source type="image/avif" media="(min-width: 768px)" srcSet={variant.desktop.avif} />
      {/* WebP - szeroka kompatybilność, mniejsze niż JPG. */}
      <source type="image/webp" media="(max-width: 767px)" srcSet={variant.mobile.webp} />
      <source type="image/webp" media="(min-width: 768px)" srcSet={variant.desktop.webp} />
      {/* JPG - fallback dla najstarszych klientów. */}
      <source media="(max-width: 767px)" srcSet={variant.mobile.jpg} />
      <source media="(min-width: 768px)" srcSet={variant.desktop.jpg} />
      <img
        src={variant.desktop.jpg}
        alt=""
        decoding="async"
        fetchPriority="high"
        className="h-full w-full object-cover object-bottom"
      />
    </picture>
  );
}

export function QuizBackground() {
  const rootRef = useRef<HTMLDivElement>(null);
  // Zawsze startuj "light" po stronie klienta i serwera - zgodnie z ThemeProvider,
  // który świadomie unika mismatchu i przełącza motyw dopiero w efekcie.
  const [mode, setMode] = useState<Mode>("light");

  // Śledź realny motyw po hydracji + reaguj na przełącznik motywu.
  useEffect(() => {
    setMode(readMode());
    const html = document.documentElement;
    const observer = new MutationObserver(() => setMode(readMode()));
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Parallax
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mql.matches) return;

    let rafId = 0;
    let ticking = false;
    const update = () => {
      ticking = false;
      const y = window.scrollY || window.pageYOffset || 0;
      root.style.setProperty("--quiz-parallax-crowd", `${y * CROWD_FACTOR}px`);
      root.style.setProperty("--quiz-parallax-overlay", `${y * OVERLAY_FACTOR}px`);
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

  const isDark = mode === "dark";

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0" aria-hidden="true">
      {/* Warstwa aktywnego motywu - druga wariacja nigdy nie trafia do DOM,
          więc opposite-theme nie generuje żadnych żądań sieciowych. */}
      {isDark ? <BgPicture variant={BG.dark} /> : <BgPicture variant={BG.light} />}

      {/* Overlay LIGHT */}
      <div
        className="absolute inset-0 -z-10 transition-opacity duration-500 ease-out dark:opacity-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--background)/0.95)_0%,hsl(var(--background)/0.75)_35%,hsl(var(--background)/0.55)_65%,hsl(var(--background)/0.72)_100%)] will-change-transform"
        style={{ transform: "translate3d(0, var(--quiz-parallax-overlay, 0px), 0)" }}
      />
      {/* Overlay DARK */}
      <div
        className="absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 ease-out dark:opacity-100 bg-[radial-gradient(ellipse_at_top,hsl(var(--background)/0.96)_0%,hsl(var(--background)/0.82)_35%,hsl(var(--background)/0.68)_65%,hsl(var(--background)/0.85)_100%)] will-change-transform"
        style={{ transform: "translate3d(0, var(--quiz-parallax-overlay, 0px), 0)" }}
      />
    </div>
  );
}

/** Preload dla LCP tła - wariant LIGHT (SSR default) w formacie AVIF (najlżejszy).
 *  Przeglądarki bez wsparcia AVIF zignorują preload i pobiorą JPG przez <picture>
 *  fallback - bez blokowania renderu. DARK preloaduje inline-script tylko dla
 *  użytkowników z aktywnym trybem ciemnym. */
export const QUIZ_BG_PRELOAD_LINKS = [
  {
    rel: "preload",
    as: "image",
    href: BG.light.mobile.avif,
    type: "image/avif",
    media: "(max-width: 767px)",
    fetchpriority: "high",
  },
  {
    rel: "preload",
    as: "image",
    href: BG.light.desktop.avif,
    type: "image/avif",
    media: "(min-width: 768px)",
    fetchpriority: "high",
  },
] as const;

/** Inline-script wstawiany do <head> trasy /quiz. Uruchamia się przed
 *  hydracją, odczytuje motyw i tylko dla trybu DARK dokłada
 *  <link rel="preload"> właściwego wariantu AVIF. */
export const QUIZ_BG_PRELOAD_SCRIPT = `(function(){try{
var s=localStorage.getItem('theme');
var isDark=s==='dark'||(s!=='light'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);
if(!isDark)return;
var isMobile=window.matchMedia&&window.matchMedia('(max-width: 767px)').matches;
var href=isMobile?${JSON.stringify(BG.dark.mobile.avif)}:${JSON.stringify(BG.dark.desktop.avif)};
var l=document.createElement('link');
l.rel='preload';l.as='image';l.href=href;l.type='image/avif';l.setAttribute('fetchpriority','high');
document.head.appendChild(l);
}catch(e){}})();`;
