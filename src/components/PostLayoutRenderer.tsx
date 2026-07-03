// Renderuje pojedynczy wpis zgodnie z wybranym presetem layoutu.
// Owija stronę "single post" w odpowiedni układ (cover, nagłówek, content area).
import type { ReactNode } from "react";
import {
  findLayout,
  coverImageSizes,
  effectiveHasSidebar,
  type PostFormat,
  type PostLayoutSettings,
} from "@/lib/postLayouts";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { ReadingHeader } from "@/components/share/ReadingHeader";

interface Props {
  format: PostFormat;
  layoutId: string;
  settings: PostLayoutSettings;
  title: string;
  excerpt?: string | null;
  coverImageUrl?: string | null;
  meta?: ReactNode; // data, autor, czas czytania
  categoryBadges?: ReactNode; // pigułki kategorii nad tytułem
  content: ReactNode;
  sidebar?: ReactNode;
  footer?: ReactNode;
}

export function PostLayoutRenderer({
  format,
  layoutId,
  settings,
  title,
  excerpt,
  coverImageUrl,
  meta,
  categoryBadges,
  content,
  sidebar,
  footer,
}: Props) {
  const preset = findLayout(format, layoutId);
  const hasSidebar = effectiveHasSidebar(preset, settings);
  const center = settings.center_header ?? preset.centerHeaderDefault ?? false;
  const ratioPct = preset.featuredRatioKey ? settings[preset.featuredRatioKey] : null;
  const contentMaxW = hasSidebar
    ? settings.has_sidebar_max_width
    : settings.no_sidebar_max_width;

  const header = (
    <header className={`mb-8 ${center ? "text-center" : ""}`}>
      {categoryBadges && (
        <div className={`mb-4 flex flex-wrap gap-2 ${center ? "justify-center" : ""}`}>
          {categoryBadges}
        </div>
      )}
      <h1 className="font-display text-4xl lg:text-5xl mb-4">{title}</h1>
      {excerpt && <p className="text-lg text-muted-foreground mb-4">{excerpt}</p>}
      {meta && (
        <div
          className={`text-sm text-muted-foreground ${settings.center_entry_meta ? "justify-center" : ""} flex flex-wrap gap-3 ${center ? "justify-center" : ""}`}
        >
          {meta}
        </div>
      )}
    </header>
  );

  // Wspólna meta-karta w stylu overlay – używana we wszystkich wariantach layoutu z cover photo.
  const overlayMetaCard = (
    <div className="absolute inset-x-0 bottom-0 flex justify-center px-3 md:px-4 lg:px-6">
      <div className={`w-full max-w-[92vw] md:max-w-2xl lg:max-w-3xl bg-[#0b0b0d] text-white rounded-t-sm shadow-2xl ${center ? "text-center" : ""} overlay-meta-card`}>
        <div className="px-4 md:px-5 lg:px-8 pt-4 md:pt-5 pb-4 md:pb-5">
          {categoryBadges && (
            <div className={`mb-2 md:mb-3 flex flex-wrap gap-2 ${center ? "justify-center" : ""}`}>
              {categoryBadges}
            </div>
          )}
          <h1
            className="overlay-meta-title font-display font-bold text-white text-xl md:text-2xl lg:text-4xl leading-[1.15] mb-2 md:mb-3"
            style={{ fontFamily: 'var(--font-display, "Red Hat Display")' }}
          >
            {title}
          </h1>
          {excerpt && (
            <p className="overlay-meta-description text-xs md:text-sm lg:text-base text-white/85 mb-2 md:mb-3 max-w-3xl mx-auto leading-relaxed">
              {excerpt}
            </p>
          )}
          {meta && (
            <div
              className={`text-xs md:text-sm flex flex-wrap items-center gap-x-3 md:gap-x-4 gap-y-1 text-white/70 pt-2 md:pt-3 border-t border-white/10 ${center ? "justify-center" : ""}`}
            >
              {meta}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Wrapper dla cover + overlay meta-karta. Dostosowuje wysokość / aspect-ratio wg presetu.
  const coverWithOverlay = (extraWrapClass = "") => {
    if (!coverImageUrl) return null;
    const isFullBleed = preset.cover === "full-bleed";
    const useRatio = preset.cover === "ratio" && ratioPct;
    const heightClass = isFullBleed
      ? "h-[55vh] md:h-[65vh] lg:h-[70vh] min-h-[380px] md:min-h-[480px] lg:min-h-[520px]"
      : useRatio
        ? ""
        : "h-[50vh] md:h-[55vh] lg:h-[60vh] min-h-[320px] md:min-h-[400px] lg:min-h-[460px]";
    const style = useRatio ? { aspectRatio: `100 / ${ratioPct}` } : undefined;
    return (
      <div className={`relative ${isFullBleed ? "-mx-4 lg:-mx-8" : ""} ${extraWrapClass}`}>
        <div className="relative mb-8">
          <div
            className={`relative ${heightClass} ${isFullBleed ? "" : "rounded-lg"} overflow-hidden`}
            style={style}
          >
            <OptimizedImage
              src={coverImageUrl}
              alt={title}
              className="absolute inset-0 w-full h-full object-cover"
              priority
              responsive
              sizes={coverImageSizes(preset)}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/60" />
            {overlayMetaCard}
          </div>
        </div>
      </div>
    );
  };

  // Wszystkie warianty z cover photo używają nakładki (overlay meta-card).
  if (coverImageUrl && preset.cover !== "none") {
    return (
      <>
        <ReadingHeader title={title} />
        {coverWithOverlay()}
        <LayoutBody
          contentMaxW={contentMaxW}
          content={content}
          sidebar={hasSidebar ? sidebar : undefined}
          footer={footer}
        />
      </>
    );
  }

  // Brak cover photo – klasyczny nagłówek nad treścią.
  return (
    <>
      <ReadingHeader title={title} />
      <div>
        {header}
        <LayoutBody
          contentMaxW={contentMaxW}
          content={content}
          sidebar={hasSidebar ? sidebar : undefined}
          footer={footer}
        />
      </div>
    </>
  );
}

function LayoutBody({
  contentMaxW,
  content,
  sidebar,
  footer,
}: {
  contentMaxW: number;
  content: ReactNode;
  sidebar?: ReactNode;
  footer?: ReactNode;
}) {
  // Sidebar (jeśli włączony) renderujemy jako blok BEZPOŚREDNIO pod hero
  // section - nad główną treścią wpisu. Treść dalej płynie w wycentrowanej,
  // wąskiej kolumnie zgodnie z `contentMaxW` (bez podziału na dwie kolumny).
  return (
    <div>
      {sidebar && (
        <aside
          className="mb-10 w-full mx-auto post-hero-sidebar"
          style={{ maxWidth: `${contentMaxW}px` }}
          aria-label="Sidebar wpisu"
        >
          {sidebar}
        </aside>
      )}
      <div style={{ maxWidth: `${contentMaxW}px` }} className="w-full mx-auto">
        {content}
      </div>
      {footer}
    </div>
  );
}

