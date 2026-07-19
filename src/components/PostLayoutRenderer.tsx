// Renderuje pojedynczy wpis zgodnie z wybranym presetem layoutu.
// Owija stronę "single post" w odpowiedni układ (cover, nagłówek, content area).
import type { ReactNode } from "react";
import {
  findLayout,
  coverImageSizes,
  effectiveHasSidebar,
  overlayTypographyStyle,
  headerTypographyStyle,
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
  /**
   * Id wpisu dla morph-przejścia okładki (View Transitions API). Musi być tym
   * samym id, które listy przekazują do PostListCard.viewTransitionId - para
   * `post-cover-<id>` po obu stronach nawigacji tworzy płynny morph okładki.
   */
  coverViewTransitionId?: string;
  /** Identyfikator encji dla akcji "zapisz na później" w pasku czytania. */
  entityId?: string;
  /** Rodzaj encji zapisywanej do zakładek (post lub page). */
  entityType?: "post" | "page";
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
  coverViewTransitionId,
  entityId,
  entityType = "post",
}: Props) {
  const preset = findLayout(format, layoutId);
  const hasSidebar = effectiveHasSidebar(preset, settings);
  const center = settings.center_header ?? preset.centerHeaderDefault ?? false;
  const ratioPct = preset.featuredRatioKey ? settings[preset.featuredRatioKey] : null;
  const contentMaxW = hasSidebar ? settings.has_sidebar_max_width : settings.no_sidebar_max_width;
  const headerTypoStyle = headerTypographyStyle(settings);
  const overlayTypoStyle = overlayTypographyStyle(settings);

  const header = (
    <header className={`mb-8 ${center ? "text-center" : ""}`} style={headerTypoStyle}>
      {categoryBadges && (
        <div className={`mb-4 flex flex-wrap gap-2 ${center ? "justify-center" : ""}`}>
          {categoryBadges}
        </div>
      )}
      <h1 className="header-title-typography font-display font-bold leading-[1.1] mb-4">{title}</h1>
      {excerpt && <p className="header-excerpt-typography text-muted-foreground mb-4">{excerpt}</p>}
      {meta && (
        <div
          className={`cms-meta cms-meta-info ${settings.center_entry_meta ? "justify-center" : ""} flex flex-wrap gap-3 ${center ? "justify-center" : ""}`}
        >
          {meta}
        </div>
      )}
    </header>
  );

  // Overlay: tytuł, excerpt i meta renderowane bezpośrednio na cover
  // (bez czarnej karty) - zgodnie z podglądem layoutu w edytorze.
  const overlayMetaCard = (
    <div
      className="absolute inset-x-0 bottom-0 p-5 md:p-8 lg:p-10 text-white"
      style={overlayTypoStyle}
    >
      <div className={`w-full ${center ? "text-center" : ""} overlay-meta-card`}>
        {categoryBadges && (
          <div className={`mb-3 flex flex-wrap gap-1.5 ${center ? "justify-center" : ""}`}>
            {categoryBadges}
          </div>
        )}
        <h1 className="overlay-meta-title overlay-title-typography font-display font-bold leading-[1.1] mb-2 text-white">
          {title}
        </h1>
        {excerpt && (
          <p
            className={`overlay-meta-description overlay-excerpt-typography text-white/80 mb-3 line-clamp-2 max-w-2xl ${center ? "mx-auto" : ""}`}
          >
            {excerpt}
          </p>
        )}
        {meta && (
          <div
            className={`text-[10px] md:text-[11px] lg:text-xs flex flex-wrap items-center gap-x-3 gap-y-1 text-white/70 ${center ? "justify-center" : ""}`}
          >
            {meta}
          </div>
        )}
      </div>
    </div>
  );

  // Wrapper dla cover + overlay. Full-bleed używa filmowego kadru 16/8
  // (jak w podglądzie edytora) - nie 70vh, żeby cover nie zajmował całego
  // ekranu i tytuł/subtytuł/meta trafiały w wyraźny dolny pas nakładki.
  const coverWithOverlay = (extraWrapClass = "") => {
    if (!coverImageUrl) return null;
    const isFullBleed = preset.cover === "full-bleed";
    const useRatio = preset.cover === "ratio" && ratioPct;
    const aspectStyle = isFullBleed
      ? { aspectRatio: "16 / 8" as const }
      : useRatio
        ? { aspectRatio: `100 / ${ratioPct}` }
        : undefined;
    const heightClass = isFullBleed
      ? ""
      : useRatio
        ? ""
        : "h-[50vh] md:h-[55vh] lg:h-[60vh] min-h-[320px] md:min-h-[400px] lg:min-h-[460px]";
    return (
      <div className={`relative ${isFullBleed ? "-mx-4 lg:-mx-8" : ""} ${extraWrapClass}`}>
        <div className="relative mb-8">
          <div
            className={`relative ${heightClass} overflow-hidden bg-neutral-900`}
            style={{
              ...aspectStyle,
              borderRadius: "6px",
              ...(coverViewTransitionId
                ? { viewTransitionName: `post-cover-${coverViewTransitionId}` }
                : null),
            }}
          >
            <OptimizedImage
              src={coverImageUrl}
              alt={title}
              className="absolute inset-0 w-full h-full object-cover opacity-80"
              priority
              responsive
              sizes={coverImageSizes(preset)}
            />
            {/* Ciemna nakładka - taka sama recepta jak w podglądzie edytora
                (gradient + radial vignetta), żeby tytuł/excerpt były czytelne
                niezależnie od zdjęcia. */}
            <div
              className={
                isFullBleed
                  ? "absolute inset-0 bg-gradient-to-b from-black/30 via-black/25 to-black/60"
                  : "absolute inset-0 bg-gradient-to-b from-black/60 via-black/55 to-black/90"
              }
            />
            <div
              className={
                isFullBleed
                  ? "absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_0%,_rgba(0,0,0,0.28)_75%)]"
                  : "absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_0%,_rgba(0,0,0,0.55)_75%)]"
              }
            />
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
  if (sidebar) {
    return (
      <div className="grid lg:grid-cols-[1fr_320px] gap-10">
        <div>
          <div style={{ maxWidth: `${contentMaxW}px` }} className="w-full mx-auto">
            {content}
          </div>
          {footer}
        </div>
        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:[scrollbar-width:thin]">
          {sidebar}
        </aside>
      </div>
    );
  }
  return (
    <div>
      <div style={{ maxWidth: `${contentMaxW}px` }} className="w-full mx-auto">
        {content}
      </div>
      {footer}
    </div>
  );
}
