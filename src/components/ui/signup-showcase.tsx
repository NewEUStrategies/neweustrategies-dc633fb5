// Lewa kolumna popupu REJESTRACJI - galeria "showcase" odwzorowana 1:1 z
// projektem referencyjnym (auth-section-2): logo poziome + nazwa marki, mozaika
// kafli z narożnikami "celownika" na aktywnym kadrze, miękkie wygaszenia u góry
// i u dołu, karta podpisu z wyróżnionym prefiksem i strzałką, hasło oraz kropki
// nawigacyjne. Każdy element jest opcjonalny i przestawialny (PopupDesign),
// więc cała kompozycja jest edytowalna z panelu admina.
//
// 6px rounding, zero zależności animacyjnych (czysty CSS + interval), kolory z
// tokenów popupu (--nl-*). Atrament galerii wyliczamy z luminancji gradientu,
// żeby jasny gradient nie dawał białego tekstu na białym tle.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import {
  galleryBackground,
  isDarkSurface,
  type GalleryBlock,
  type PopupGalleryDesign,
  type PopupPalette,
} from "@/lib/newsletter/popupDesign";

export interface ShowcaseImage {
  url: string;
  /** Opis kadru (renderowany nad tytułem). */
  caption?: string;
  /** Tytuł kadru (renderowany pod opisem). */
  title?: string;
}

interface Props {
  images: ShowcaseImage[];
  design: PopupGalleryDesign;
  palette: PopupPalette;
  brand: string;
  logoUrl: string | null;
  tagline?: string;
  /** Wyróżniony prefiks podpisu, np. "/imagine" w projekcie referencyjnym. */
  captionPrefix?: string;
  radiusPx: number;
  rotateMs: number;
  showBrand: boolean;
  showCaption: boolean;
  showDots: boolean;
  dotLabel: string;
  nextLabel: string;
  /** Podgląd w adminie wyłącza auto-rotację, żeby edycja podpisów nie skakała. */
  autoRotate?: boolean;
}

/** Rozmieszczenie kafli w siatce referencyjnej zależnie od liczby zdjęć. */
function referencePlacement(count: number, index: number): CSSProperties {
  if (count <= 1) return { gridColumn: "1 / span 2", gridRow: "1 / span 3" };
  if (count === 2) {
    return index === 0
      ? { gridColumn: "1", gridRow: "1 / span 3" }
      : { gridColumn: "2", gridRow: "1 / span 3" };
  }
  if (count === 3) {
    if (index === 0) return { gridColumn: "1", gridRow: "1 / span 2" };
    if (index === 1) return { gridColumn: "2", gridRow: "1 / span 2" };
    return { gridColumn: "1 / span 2", gridRow: "3" };
  }
  if (index === 0) return { gridColumn: "1", gridRow: "1 / span 2" };
  if (index === 1) return { gridColumn: "2", gridRow: "1" };
  if (index === 2) return { gridColumn: "2", gridRow: "2" };
  return { gridColumn: "1 / span 2", gridRow: "3" };
}

/** Mozaika 3x3 - układ z pierwszego wdrożenia, zachowany jako wariant. */
const MOSAIC_PLACEMENT: CSSProperties[] = [
  { gridColumn: "span 2", gridRow: "span 2" },
  { gridColumn: "span 1", gridRow: "span 1" },
  { gridColumn: "span 1", gridRow: "span 1" },
  { gridColumn: "span 3", gridRow: "span 1" },
];

export function SignupShowcase({
  images,
  design,
  palette,
  brand,
  logoUrl,
  tagline,
  captionPrefix,
  radiusPx,
  rotateMs,
  showBrand,
  showCaption,
  showDots,
  dotLabel,
  nextLabel,
  autoRotate = true,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const count = images.length;

  useEffect(() => {
    if (!autoRotate || count < 2) return;
    const ms = Math.min(30000, Math.max(800, rotateMs));
    const id = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % count);
    }, ms);
    return () => window.clearInterval(id);
  }, [autoRotate, count, rotateMs]);

  useEffect(() => {
    if (activeIndex >= count) setActiveIndex(0);
  }, [activeIndex, count]);

  const active = images[Math.min(activeIndex, Math.max(0, count - 1))];
  // Atrament liczymy z bazy gradientu (gradFrom). Gdy jest to `color-mix(...)`,
  // luminancja jest nieznana - traktujemy powierzchnię jak ciemną, bo domyślna
  // baza galerii to tło panelu.
  const galleryDark = isDarkSurface(palette.gradFrom);
  const ink = galleryDark ? "#ffffff" : "#0b0b0f";
  const inkMuted = galleryDark ? "rgba(255,255,255,0.66)" : "rgba(11,11,15,0.62)";
  const radius = `${radiusPx}px`;
  const alignLeft = design.align === "left";

  // Atrament galerii nadpisuje --nl-fg/--nl-muted lokalnie: dzieci (kafle,
  // podpisy, kropki) czytają te same zmienne co formularz po prawej.
  const rootStyle = {
    background: galleryBackground(palette, design.gradientAngle),
    padding: `${design.paddingPx}px`,
    ["--nl-root-p" as string]: `${design.paddingPx}px`,
    ["--nl-fg" as string]: ink,
    ["--nl-muted" as string]: inkMuted,
  } as CSSProperties;


  const tiles = useMemo(() => images.slice(0, 4), [images]);

  const brandRow =
    showBrand && (design.showLogo || brand) ? (
      <div
        key="brand"
        className={
          "flex shrink-0 items-center gap-2.5 text-[15px] font-medium tracking-tight " +
          (alignLeft ? "self-start" : "self-center")
        }
        style={{ color: ink }}
      >
        {/* Logo można wyłączyć niezależnie od nazwy marki; bez wgranego pliku
            pokazujemy wbudowany znak, żeby nagłówek galerii nie był pusty. */}
        {design.showLogo &&
          (logoUrl ? (
            <img
              src={logoUrl}
              alt={brand || "logo"}
              data-showcase-logo=""
              className="w-auto max-w-[200px] object-contain"
              style={{ height: `${design.logoHeightPx}px` }}
            />
          ) : (
            <BrandMark className="h-5 w-5" />
          ))}

        {brand && <span className="font-display">{brand}</span>}
      </div>
    ) : null;

  const grid =
    count > 0 ? (
      <div
        key="grid"
        data-showcase-grid=""
        className="relative w-full flex-1"
        /* `--nl-grid-h` = wysokość z panelu admina. Na telefonie styles.css
           ogranicza ją do ułamka viewportu, żeby mozaika nie spychała
           formularza poza ekran. */
        style={{
          ["--nl-grid-h" as string]: `${design.gridHeightPx}px`,
          minHeight: "var(--nl-grid-h)",
        }}
      >
        {/* Wygaszenia SIEDZĄ POD zdjęciami (z-0, mozaika z-10): mają miękko
            wtapiać krawędzie panelu w tło, a nie kłaść kolorową płachtę na
            kadrach. */}
        {design.showFades && (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 -top-6 z-0 h-16"
              style={{ background: `linear-gradient(to bottom, ${palette.gradFrom}, transparent)` }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 -bottom-6 z-0 h-16"
              style={{ background: `linear-gradient(to top, ${palette.gradFrom}, transparent)` }}
            />
          </>
        )}
        {/* Mozaika jest pozycjonowana absolutnie w kontenerze o WYLICZONEJ
            wysokości. Przy `height: 100%` w kontenerze auto-wysokościowym rzędy
            brały intrinsic height zdjęć (np. 400 px) i siatka wylewała się pod
            podpis oraz hasło - dokładnie ten defekt widać było w podglądzie. */}
        {design.grid === "single" ? (
          <div className="absolute inset-0 z-10 overflow-hidden" style={{ borderRadius: radius }}>
            {tiles.map((img, index) => (
              <img
                key={`${img.url}-${index}`}
                src={img.url}
                alt=""
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
                style={{ opacity: index === activeIndex ? 1 : 0, borderRadius: radius }}
              />
            ))}
            {design.showCorners && <FocusCorners active radiusPx={radiusPx} />}
          </div>
        ) : (
          <div
            className="absolute inset-0 z-10 grid"
            style={{
              gap: `${design.gapPx}px`,
              gridTemplateColumns: design.grid === "mosaic" ? "repeat(3, 1fr)" : "1.55fr 1fr",
              gridTemplateRows: design.grid === "mosaic" ? "repeat(3, 1fr)" : "1fr 1fr 0.96fr",
            }}
          >
            {tiles.map((img, index) => (
              <ShowcaseTile
                key={`${img.url}-${index}`}
                src={img.url}
                active={index === activeIndex}
                dim={design.inactiveDim}
                showCorners={design.showCorners}
                radiusPx={radiusPx}
                placement={
                  design.grid === "mosaic"
                    ? (MOSAIC_PLACEMENT[index] ?? {})
                    : referencePlacement(Math.min(count, 4), index)
                }
              />
            ))}
          </div>
        )}
      </div>
    ) : null;

  const caption =
    showCaption && (active?.caption || active?.title || captionPrefix) ? (
      <div
        key="caption"
        className={
          "flex w-full shrink-0 items-end gap-4 px-4 py-3 backdrop-blur-sm transition-opacity duration-500 " +
          (design.captionDashed ? "border border-dashed" : "border")
        }
        style={{
          borderRadius: radius,
          borderColor: galleryDark ? "rgba(255,255,255,0.2)" : "rgba(11,11,15,0.16)",
          // Podpis może wypaść nad zdjęciem - nieprzejrzysta baza gwarantuje
          // czytelność zamiast prześwitującego kadru pod tekstem.
          backgroundColor: galleryDark ? "rgba(10,10,14,0.72)" : "rgba(255,255,255,0.82)",
        }}
      >
        <div className="min-w-0 flex-1 space-y-1">
          {(active?.caption || captionPrefix) && (
            <p className="line-clamp-4 text-xs leading-4" style={{ color: inkMuted }}>
              {captionPrefix && (
                <span className="font-semibold" style={{ color: ink }}>
                  {captionPrefix}{" "}
                </span>
              )}
              {active?.caption}
            </p>
          )}
          {active?.title && (
            <p
              className="truncate font-display text-sm font-medium leading-snug"
              style={{ color: ink }}
            >
              {active.title}
            </p>
          )}
        </div>
        {design.showArrow && count > 1 && (
          <button
            type="button"
            onClick={() => setActiveIndex((c) => (c + 1) % count)}
            aria-label={nextLabel}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full transition-transform hover:scale-105"
            style={{
              backgroundColor: galleryDark ? "rgba(255,255,255,0.2)" : "rgba(11,11,15,0.12)",
              color: ink,
            }}
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    ) : null;

  const taglineEl = tagline ? (
    <p
      key="tagline"
      className={
        "shrink-0 font-display text-[17px] font-medium leading-snug tracking-[-0.01em] sm:text-xl " +
        (alignLeft ? "max-w-[26ch] text-left" : "max-w-[24ch] text-center")
      }
      style={{ color: ink }}
    >
      {tagline}
    </p>
  ) : null;

  const dots =
    showDots && count > 1 ? (
      <div
        key="dots"
        className={
          "flex shrink-0 items-center gap-1.5 " + (alignLeft ? "self-start" : "self-center")
        }
      >
        {images.slice(0, 4).map((_, index) => (
          <button
            key={index}
            type="button"
            onClick={() => setActiveIndex(index)}
            aria-label={`${dotLabel} ${index + 1}`}
            aria-current={index === activeIndex}
            className="h-1 rounded-full transition-all duration-300"
            style={{
              width: index === activeIndex ? 40 : 16,
              backgroundColor: ink,
              opacity: index === activeIndex ? 1 : 0.35,
            }}
          />
        ))}
      </div>
    ) : null;

  const blocks: Record<GalleryBlock, React.ReactNode> = {
    brand: brandRow,
    grid,
    caption,
    tagline: taglineEl,
    dots,
  };

  return (
    <div
      data-showcase-root=""
      className={
        "relative flex h-full min-h-0 flex-col gap-3.5 sm:gap-5 " +
        (alignLeft ? "items-start" : "items-center")
      }
      style={rootStyle}
    >
      {design.order.map((block) => blocks[block])}
    </div>
  );

}

// Kafle są dekoracyjne (nawigacja idzie przez kropki i strzałkę z etykietami
// a11y), więc nie wprowadzamy kolejnych elementów do kolejności tabulacji.
function ShowcaseTile({
  src,
  active,
  dim,
  showCorners,
  radiusPx,
  placement,
}: {
  src: string;
  active: boolean;
  dim: number;
  showCorners: boolean;
  radiusPx: number;
  placement: CSSProperties;
}) {
  const inactive = Math.min(100, Math.max(0, dim)) / 100;
  return (
    <div
      className="relative overflow-visible"
      style={{ ...placement, borderRadius: `${radiusPx}px`, zIndex: active ? 10 : 0 }}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover transition-all duration-700"
        style={{
          borderRadius: `${radiusPx}px`,
          opacity: active ? 1 : 1 - inactive * 0.6,
          filter: active
            ? "none"
            : `saturate(${1 - inactive * 0.35}) brightness(${1 - inactive * 0.3})`,
        }}
      />
      {showCorners && <FocusCorners active={active} radiusPx={radiusPx} />}
    </div>
  );
}

/** Cztery narożniki "celownika" pojawiające się na aktywnym kadrze. */
function FocusCorners({ active, radiusPx }: { active: boolean; radiusPx: number }) {
  const base = `pointer-events-none absolute h-4 w-4 transition-all duration-500 ease-out ${
    active ? "opacity-100" : "opacity-0"
  }`;
  const color = "color-mix(in srgb, var(--nl-fg) 70%, transparent)";
  const r = `${Math.max(0, radiusPx - 2)}px`;
  return (
    <>
      <span
        className={`${base} -left-1.5 -top-1.5 border-l-2 border-t-2 ${active ? "" : "-translate-x-2 -translate-y-2"}`}
        style={{ borderColor: color, borderTopLeftRadius: r }}
      />
      <span
        className={`${base} -right-1.5 -top-1.5 border-r-2 border-t-2 ${active ? "" : "translate-x-2 -translate-y-2"}`}
        style={{ borderColor: color, borderTopRightRadius: r }}
      />
      <span
        className={`${base} -bottom-1.5 -left-1.5 border-b-2 border-l-2 ${active ? "" : "-translate-x-2 translate-y-2"}`}
        style={{ borderColor: color, borderBottomLeftRadius: r }}
      />
      <span
        className={`${base} -bottom-1.5 -right-1.5 border-b-2 border-r-2 ${active ? "" : "translate-x-2 translate-y-2"}`}
        style={{ borderColor: color, borderBottomRightRadius: r }}
      />
    </>
  );
}

function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M2 20L12 4l10 16H2z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 20l4.5-7 4.5 7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
