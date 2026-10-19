// Strzałka sliderów bloków treści (opinie, karuzela obrazów).
//
// TEN SAM kąt (`AngleChevron`) i TA SAMA geometria (`.eh-slider-arrow` w
// `styles.css`: pole 34 px, kąt 11x10 px, kreska bez skalowania) co strzałki
// sliderów buildera - AGENTS.md: „Share eh-slider-arrow and AngleChevron
// across sliders". Wspólna reguła arkusza działa w zakresie `.eh-slider`
// (builder) albo `.eh-block-slider` - ten drugi dokłada korzeń slidera bloku.
// Wymiary idą z arkusza globalnego, więc HTML z serwera ma je od pierwszego
// malowania (bez przesunięcia układu po hydracji).
import type { CSSProperties } from "react";
import { AngleChevron } from "@/lib/builder/sectionLabelVariants";

/**
 * Powierzchnia, na której leży strzałka:
 *  - "page" - tło strony: wspólne tokeny motywu (`--slider-arrow-ink` =
 *    `--foreground`, przezroczyste pole), jak strzałki kropek buildera;
 *    tryb jasny i ciemny daje sam token,
 *  - "media" - zdjęcie DOWOLNEJ jasności: jasny kąt na półprzezroczystej
 *    czerni, bez przygaszenia. Najgorszy przypadek to białe zdjęcie: 60%
 *    czerni nad bielą daje luminancję ok. 0,13, a biały kąt ma wtedy kontrast
 *    ok. 5,7:1 (WCAG 1.4.11 wymaga 3:1); nad ciemniejszym zdjęciem jest więcej.
 *    Zdjęcie jest to samo w obu trybach motywu, więc paleta też.
 */
export type SliderArrowSurface = "page" | "media";

// Zmienne LOKALNE przycisku - globalne tokeny strzałek zostają bez zmian.
const MEDIA_SURFACE: CSSProperties = {
  ["--slider-arrow-ink" as string]: "#ffffff",
  ["--slider-arrow-bg" as string]: "rgb(0 0 0 / 0.6)",
  ["--slider-arrow-hover" as string]: "rgb(0 0 0 / 0.78)",
  ["--slider-arrow-opacity" as string]: "1",
  // Obrys fokusu przylega do ciemnego pola (bez odstępu), więc jest widoczny
  // także nad białym zdjęciem.
  ["--slider-arrow-focus" as string]: "#ffffff",
  ["--slider-arrow-focus-offset" as string]: "0px",
};

interface BlockSliderArrowProps {
  side: "left" | "right";
  /** Nazwa dostępna w języku TREŚCI bloku (strzałka niesie sam kąt). */
  label: string;
  onClick: () => void;
  surface?: SliderArrowSurface;
  /** Tylko pozycjonowanie (np. `absolute left-3`) - geometria jest wspólna. */
  className?: string;
}

export function BlockSliderArrow({
  side,
  label,
  onClick,
  surface = "page",
  className = "",
}: BlockSliderArrowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-typography-exempt
      className={`eh-slider-arrow inline-flex shrink-0 items-center justify-center motion-reduce:transition-none ${className}`}
      style={surface === "media" ? MEDIA_SURFACE : undefined}
    >
      <AngleChevron side={side} isSm={false} />
    </button>
  );
}
