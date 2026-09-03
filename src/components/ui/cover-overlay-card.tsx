// Molekuła UI: karta z okładką na całym tle i gradientową nakładką, a pod nią
// data, tytuł-link i skrócona zajawka.
//
// Renderuje ją widget `cover-overlay-card` buildera (Elementor-like). Komponent
// jest CZYSTO prezentacyjny: nie zna i18n, nie chodzi do sieci i nie czyta
// treści widgetu - wszystkie napisy dostaje przez propsy, dzięki czemu ta sama
// molekuła obsługuje PL i EN bez gałęzi językowych w środku.
//
// Świadome odstępstwa od wklejonego wzorca:
//   * `rounded-lg` -> platformowe **6 px** jako DOMYŚLNE zaokrąglenie, ale
//     wystawione jako ustawienie panelu (`radius`),
//   * `pt-32 sm:pt-48 lg:pt-64` (trzy sztywne progi) -> jedna sterowalna
//     `mediaMinHeight`; redakcja skaluje kadr, kod nie zgaduje breakpointów,
//   * `from-gray-900/50 to-gray-900/25` -> kolor nakładki + dwa krycia z panelu;
//     gradient liczy arkusz (`.coc-overlay`), bo `color-mix()` wpisany wprost
//     w atrybut `style` przepada w silnikach DOM bez wsparcia tej funkcji,
//   * `text-white/90` itd. -> ten sam biały tekst, ale tytuł i zajawka niosą
//     platformowe haki typografii (`cms-post-title`, `cms-post-excerpt`), więc
//     kontrolki „Rozmiar tytułu / opisu" działają tu tak samo jak w listach,
//   * `line-clamp-3` -> `clampLines` z panelu (1-6).
import type { CSSProperties } from "react";
import {
  COVER_OVERLAY_CARD_DEFAULTS,
  COVER_OVERLAY_DEFAULT_COLOR,
} from "@/lib/builder/coverOverlayCard";
import { cn } from "@/lib/utils";

export interface CoverOverlayCardProps {
  /** Napis daty dla człowieka. Puste = wiersz daty nie powstaje. */
  dateLabel?: string;
  /** Wartość atrybutu `datetime`. Puste = zwykły tekst zamiast `<time>`. */
  dateTime?: string;
  title: string;
  excerpt?: string;
  imageUrl?: string;
  imageAlt?: string;
  /** Adres tytułu. Puste = karta nie jest linkiem. */
  href?: string;
  overlayColor?: string;
  overlayAlphaTop?: number;
  overlayAlphaBottom?: number;
  mediaMinHeight?: number;
  radius?: number;
  /** Maksymalna szerokość karty w px. 0 = pełna szerokość kolumny. */
  maxWidth?: number;
  clampLines?: number;
  hoverLift?: boolean;
  className?: string;
}

const pct = (value: number): string => `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;

export function CoverOverlayCard({
  dateLabel = "",
  dateTime = "",
  title,
  excerpt = "",
  imageUrl = "",
  imageAlt = "",
  href = "",
  overlayColor = "",
  overlayAlphaTop = COVER_OVERLAY_CARD_DEFAULTS.overlayAlphaTop,
  overlayAlphaBottom = COVER_OVERLAY_CARD_DEFAULTS.overlayAlphaBottom,
  mediaMinHeight = COVER_OVERLAY_CARD_DEFAULTS.mediaMinHeight,
  radius = COVER_OVERLAY_CARD_DEFAULTS.radius,
  maxWidth = COVER_OVERLAY_CARD_DEFAULTS.maxWidth,
  clampLines = COVER_OVERLAY_CARD_DEFAULTS.clampLines,
  hoverLift = true,
  className,
}: CoverOverlayCardProps) {
  const frameStyle: CSSProperties = {
    borderRadius: `${Math.max(0, radius)}px`,
    ...(maxWidth > 0 ? { maxWidth: `${maxWidth}px` } : null),
  };
  const lines = Math.min(6, Math.max(1, Math.round(clampLines)));

  return (
    <article
      data-cover-overlay-card=""
      style={frameStyle}
      className={cn(
        "relative w-full overflow-hidden shadow-sm",
        hoverLift && "coc-lift",
        className,
      )}
    >
      {/* Bez tekstu alternatywnego okładka jest DEKORACJĄ - informację niesie
          tytuł - więc znika z drzewa dostępności zamiast dyktować czytnikowi
          nazwę pliku. */}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={imageAlt}
          aria-hidden={imageAlt ? undefined : true}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-muted" aria-hidden="true" />
      )}

      <div
        className="coc-overlay relative"
        style={
          {
            "--coc-overlay-color": overlayColor || COVER_OVERLAY_DEFAULT_COLOR,
            "--coc-overlay-top": pct(overlayAlphaTop),
            "--coc-overlay-bottom": pct(overlayAlphaBottom),
            paddingTop: `${Math.max(0, mediaMinHeight)}px`,
          } as CSSProperties
        }
      >
        <div className="p-4 sm:p-6">
          {dateLabel ? (
            dateTime ? (
              <time dateTime={dateTime} className="block text-xs text-white/90">
                {dateLabel}
              </time>
            ) : (
              <span className="block text-xs text-white/90">{dateLabel}</span>
            )
          ) : null}

          {href ? (
            <a href={href} className="coc-title-link">
              <h3 className="cms-post-title mt-0.5 text-lg text-white">{title}</h3>
            </a>
          ) : (
            <h3 className="cms-post-title mt-0.5 text-lg text-white">{title}</h3>
          )}

          {excerpt ? (
            <p
              className="cms-post-excerpt coc-clamp mt-2 text-sm leading-relaxed text-white/95"
              style={{ "--coc-clamp-lines": lines } as CSSProperties}
            >
              {excerpt}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
