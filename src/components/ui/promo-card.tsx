// Molekuła UI: karta promocyjna - okładka na całym tle, gradientowa nakładka,
// tytuł, podtytuł i przycisk CTA przy dolnej krawędzi.
//
// Renderuje ją widget `promo-card` buildera (Elementor-like). Komponent jest
// CZYSTO prezentacyjny: nie zna i18n, nie chodzi do sieci i nie czyta treści
// widgetu - wszystkie napisy dostaje przez propsy, dzięki czemu ta sama
// molekuła obsługuje PL i EN bez gałęzi językowych w środku.
//
// Świadome odstępstwa od wklejonego wzorca (21st.dev `AnimatedPromoCard`):
//   * `framer-motion` + `useMotionValue/useSpring/useTransform` -> USUNIĘTE.
//     Wzorzec przeliczał pozycję kursora na `rotateX/rotateY` całej karty i
//     wypychał treść na `translateZ(50px)`. Efekt był niedostępny z klawiatury
//     i dotyku, nie istniał przy renderze serwerowym (więc pierwszy render
//     klienta musiałby się od SSR różnić) i - jako `transform` na kontenerze -
//     tworzył nowy containing block, przez co karta potrafiła nachodzić na
//     sąsiadów w kolumnie.
//   * Animacja została, ale BEZ GEOMETRII KARTY: przenikanie (krycie) oraz
//     delikatny zoom samej okładki wewnątrz kadru `overflow: hidden`. Liczy je
//     arkusz (`.pcx-*` w styles.css), więc nie wchodzi tu żadna biblioteka
//     animacji, a całość respektuje `prefers-reduced-motion`.
//   * sztywne `h-72` -> proporcje kadru z panelu (`aspectRatio`) albo stała
//     wysokość; redakcja skaluje kadr, kod nie zgaduje breakpointów.
//   * `rounded-xl` -> platformowe **6 px** jako domyślne zaokrąglenie, ale
//     wystawione jako ustawienie panelu (`radius`).
//   * `from-black/70 via-black/30` -> kolor nakładki + dwa krycia z panelu;
//     gradient liczy arkusz (`.pcx-overlay`), bo `color-mix()` wpisany wprost
//     w atrybut `style` przepada w silnikach DOM bez wsparcia tej funkcji.
//   * `<a target="_blank">` na sztywno -> przełącznik `newTab`; link wewnętrzny
//     idzie routerem (patrz organizm), a nie przeładowaniem dokumentu.
import type { CSSProperties, ReactNode } from "react";
import {
  PROMO_CARD_DEFAULTS,
  PROMO_CARD_DEFAULT_OVERLAY,
  PROMO_CARD_ZOOM_SCALE,
  promoCardAspect,
  type PromoCardAlign,
  type PromoCardEntrance,
  type PromoCardFit,
  type PromoCardHover,
  type PromoCardPosition,
  type PromoCardRatio,
} from "@/lib/builder/promoCard";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { cn } from "@/lib/utils";

export interface PromoCardProps {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  imageAlt?: string;
  /** Atrybut `sizes` okładki - liczony jednym źródłem prawdy (widgetImageSizes). */
  imageSizes?: string;
  /** Wiersz meta nad tytułem (data i miejsce wydarzenia). Pusty = brak wiersza. */
  meta?: string;
  /** Gotowy przycisk CTA. Puste = karta bez przycisku. */
  cta?: ReactNode;
  ratio?: PromoCardRatio;
  /** Wysokość kadru w px - używana wyłącznie przy `ratio: "auto"`. */
  heightPx?: number;
  /** Maksymalna szerokość karty w px. 0 = pełna szerokość kolumny. */
  maxWidth?: number;
  fit?: PromoCardFit;
  imagePosition?: PromoCardPosition;
  overlayColor?: string;
  overlayAlphaTop?: number;
  overlayAlphaBottom?: number;
  radius?: number;
  align?: PromoCardAlign;
  hover?: PromoCardHover;
  entrance?: PromoCardEntrance;
  /** Kolor tytułu/podtytułu. Puste = biel nad nakładką. */
  textColor?: string;
  className?: string;
}

const pct = (value: number): string => `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;

export function PromoCard({
  title,
  subtitle = "",
  imageUrl = "",
  imageAlt = "",
  imageSizes = "",
  meta = "",
  cta = null,
  ratio = PROMO_CARD_DEFAULTS.ratio,
  heightPx = PROMO_CARD_DEFAULTS.heightPx,
  maxWidth = PROMO_CARD_DEFAULTS.maxWidth,
  fit = PROMO_CARD_DEFAULTS.fit,
  imagePosition = PROMO_CARD_DEFAULTS.imagePosition,
  overlayColor = "",
  overlayAlphaTop = PROMO_CARD_DEFAULTS.overlayAlphaTop,
  overlayAlphaBottom = PROMO_CARD_DEFAULTS.overlayAlphaBottom,
  radius = PROMO_CARD_DEFAULTS.radius,
  align = PROMO_CARD_DEFAULTS.align,
  hover = PROMO_CARD_DEFAULTS.hover,
  entrance = PROMO_CARD_DEFAULTS.entrance,
  textColor = "",
  className,
}: PromoCardProps) {
  const aspect = promoCardAspect(ratio);
  const frameStyle: CSSProperties = {
    borderRadius: `${Math.max(0, radius)}px`,
    ...(maxWidth > 0 ? { maxWidth: `${maxWidth}px` } : null),
    ["--pcx-overlay-color" as string]: overlayColor || PROMO_CARD_DEFAULT_OVERLAY,
    ["--pcx-overlay-top" as string]: pct(overlayAlphaTop),
    ["--pcx-overlay-bottom" as string]: pct(overlayAlphaBottom),
    ["--pcx-zoom" as string]: String(PROMO_CARD_ZOOM_SCALE),
  };
  // Wysokość kadru NIE siedzi na ramce, tylko na osobnym rozpieraczu w tej
  // samej komórce siatki (`.pcx-card` to jednokomórkowy grid, wszystkie dzieci
  // leżą na sobie). Powód jest praktyczny: `aspect-ratio` postawione wprost na
  // ramce wyznacza wysokość SZTYWNO, więc dłuższy tytuł w wąskiej kolumnie
  // zostałby po cichu przycięty przez `overflow: hidden`. Przy rozpieraczu
  // wiersz siatki ma wysokość MAKSIMUM z dwóch: kadru i treści - miejsce jest
  // zarezerwowane zanim okładka się pobierze (CLS = 0), a tekst nigdy nie ginie.
  const ratioStyle: CSSProperties = aspect
    ? { aspectRatio: aspect }
    : { height: `${Math.max(1, heightPx)}px` };
  // Kolor tekstu z panelu wygrywa z bielą wzorca. Nie mieszamy obu dróg:
  // przy własnym kolorze klasy `text-white/…` w ogóle nie wchodzą, bo Tailwind
  // ustawia wtedy `color` z wyższą specyficznością niż dziedziczenie i panel
  // przestawałby działać dla podtytułu.
  const contentStyle: CSSProperties | undefined = textColor ? { color: textColor } : undefined;

  return (
    <article
      data-promo-card=""
      data-hover={hover}
      data-entrance={entrance}
      style={frameStyle}
      className={cn(
        // `relative` + `overflow-hidden`: zoom okładki dzieje się WEWNĄTRZ
        // kadru, więc karta nie rośnie i nie rusza sąsiadami w kolumnie.
        "pcx-card relative w-full overflow-hidden shadow-sm",
        className,
      )}
    >
      {/* Rozpieracz kadru: nic nie rysuje, tylko rezerwuje wysokość. */}
      <div className="pcx-ratio" style={ratioStyle} aria-hidden="true" />

      {/* Bez tekstu alternatywnego okładka jest DEKORACJĄ - informację niesie
          tytuł - więc znika z drzewa dostępności zamiast dyktować czytnikowi
          nazwę pliku. */}
      {imageUrl ? (
        <OptimizedImage
          src={imageUrl}
          alt={imageAlt}
          aria-hidden={imageAlt ? undefined : true}
          // `responsive` + `sizes`: przeglądarka dobiera najmniejszego
          // wystarczającego kandydata zamiast pobierać oryginał na kartę
          // o szerokości 512 px. `fadeIn` atomu jest czystym CSS-em, więc
          // pojawienie się okładki nie czeka na hydratację.
          responsive
          sizes={imageSizes || undefined}
          className={cn(
            "pcx-image h-full w-full",
            fit === "contain" ? "object-contain" : "object-cover",
          )}
          style={{ objectPosition: imagePosition }}
        />
      ) : (
        <div className="pcx-plane bg-muted" aria-hidden="true" />
      )}

      <div className="pcx-overlay" aria-hidden="true" />

      <div
        style={contentStyle}
        className={cn(
          "pcx-content z-10 flex flex-col justify-end gap-1 p-5 sm:p-6",
          align === "center" ? "items-center text-center" : "items-start text-left",
        )}
      >
        {meta ? (
          <p
            className={cn(
              "text-xs font-medium uppercase tracking-wider",
              textColor ? "opacity-85" : "text-white/85",
            )}
          >
            {meta}
          </p>
        ) : null}

        {/* Tytuł i podtytuł niosą platformowe haki typografii, więc kontrolki
            „Rozmiar tytułu / opisu" działają tu tak samo jak w listach wpisów. */}
        <h3
          className={cn(
            "cms-post-title text-2xl font-bold leading-tight drop-shadow-sm",
            textColor ? null : "text-white",
          )}
        >
          {title}
        </h3>
        {subtitle ? (
          <p
            className={cn(
              "cms-post-excerpt text-sm leading-relaxed",
              textColor ? "opacity-90" : "text-white/90",
            )}
          >
            {subtitle}
          </p>
        ) : null}

        {cta ? <div className="mt-4">{cta}</div> : null}
      </div>
    </article>
  );
}
