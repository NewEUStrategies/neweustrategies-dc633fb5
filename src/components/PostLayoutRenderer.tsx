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

  const coverBlock = (() => {
    if (!coverImageUrl || preset.cover === "none") return null;
    if (preset.cover === "full-bleed") {
      return (
        <div className="-mx-4 lg:-mx-8 mb-0">
          <OptimizedImage
            src={coverImageUrl}
            alt={title}
            className="w-full h-[60vh] object-cover"
            priority
            responsive
            sizes={coverImageSizes(preset)}
          />
        </div>
      );
    }
    if (preset.cover === "ratio" && ratioPct) {
      return (
        <div className="mb-8" style={{ aspectRatio: `100 / ${ratioPct}` }}>
          <OptimizedImage
            src={coverImageUrl}
            alt={title}
            className="w-full h-full rounded-lg object-cover"
            priority
            responsive
            sizes={coverImageSizes(preset)}
          />
        </div>
      );
    }
    if (preset.cover === "boxed") {
      return (
        <div className="mb-8 max-w-2xl mx-auto">
          <OptimizedImage
            src={coverImageUrl}
            alt={title}
            className="w-full rounded-lg max-h-[420px] object-cover"
            priority
            responsive
            sizes={coverImageSizes(preset)}
          />
        </div>
      );
    }
    if (preset.cover === "side") return null; // side rendered separately
    return (
      <OptimizedImage
        src={coverImageUrl}
        alt={title}
        className="w-full rounded-lg mb-8 max-h-[480px] object-cover"
        priority
        responsive
        sizes={coverImageSizes(preset)}
      />
    );
  })();

  // Overlay = cover + header nałożony
  if (preset.header === "overlay" && coverImageUrl && preset.cover !== "none") {
    return (
      <>
        <ReadingHeader title={title} />
        <div className={`relative ${preset.cover === "full-bleed" ? "-mx-4 lg:-mx-8" : ""}`}>
          <div className="relative rounded-lg overflow-hidden mb-8">
            {/* Cover image */}
            <div className="relative h-[52vh] min-h-[360px]">
              <OptimizedImage
                src={coverImageUrl}
                alt={title}
                className="absolute inset-0 w-full h-full object-cover"
                priority
                responsive
                sizes={coverImageSizes(preset)}
              />
              {/* Delikatny gradient dla czytelności krawędzi obrazu */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70" />
            </div>

            {/* Solidne, ciemne tło pod meta-blokiem (jak w referencji Foxiz).
                Kategorie "wystają" ponad krawędź, dając charakterystyczny akcent. */}
            <div className={`relative bg-[#0b0b0d] text-white ${center ? "text-center" : ""}`}>
              {categoryBadges && (
                <div
                  className={`absolute -top-4 left-0 right-0 px-6 lg:px-10 flex flex-wrap gap-2 ${
                    center ? "justify-center" : ""
                  }`}
                >
                  {categoryBadges}
                </div>
              )}
              <div className="px-6 lg:px-10 pt-10 pb-8 lg:pt-12 lg:pb-10">
                <h1 className="font-display text-3xl lg:text-5xl leading-tight mb-3">{title}</h1>
                {excerpt && (
                  <p className="text-base lg:text-lg text-white/85 mb-4 max-w-3xl mx-auto">
                    {excerpt}
                  </p>
                )}
                {meta && (
                  <div
                    className={`text-sm flex flex-wrap items-center gap-x-4 gap-y-1 text-white/75 pt-4 border-t border-white/10 ${
                      center ? "justify-center" : ""
                    }`}
                  >
                    {meta}
                  </div>
                )}
              </div>
            </div>
          </div>



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

  // Side-by-side (Layout 7)
  if (preset.header === "side-by-side" && coverImageUrl) {
    return (
      <>
        <ReadingHeader title={title} />
        <div>
          <div className="grid lg:grid-cols-2 gap-8 items-center mb-10">
            <OptimizedImage
              src={coverImageUrl}
              alt={title}
              className="w-full rounded-lg max-h-[420px] object-cover"
              priority
              responsive
              sizes={coverImageSizes(preset)}
            />
            <div className={center ? "text-center" : ""}>
              {categoryBadges && (
                <div className={`mb-4 flex flex-wrap gap-2 ${center ? "justify-center" : ""}`}>
                  {categoryBadges}
                </div>
              )}
              <h1 className="font-display text-3xl lg:text-5xl mb-4">{title}</h1>
              {excerpt && <p className="text-lg text-muted-foreground mb-4">{excerpt}</p>}
              {meta && (
                <div className="text-sm text-muted-foreground flex flex-wrap gap-3">{meta}</div>
              )}
            </div>
          </div>
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

  // Below-cover (Layout 8 magazine)
  if (preset.header === "below-cover" && coverImageUrl) {
    return (
      <>
        <ReadingHeader title={title} />
        <div>
          {coverBlock}
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

  // Default: above-cover
  return (
    <>
      <ReadingHeader title={title} />
      <div>
        {header}
        {coverBlock}
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
