// Renderuje pojedynczy wpis zgodnie z wybranym presetem layoutu.
// Owija stronę "single post" w odpowiedni układ (cover, nagłówek, content area).
//
// Presety NIE są kosmetyką - `preset.header` decyduje o strukturze strony:
//   above-cover  -> nagłówek, pod nim cover, pod nim treść (Layout 1/1a/2/3/6/10/11)
//   below-cover  -> cover, pod nim nagłówek, pod nim treść (Layout 8 - magazine)
//   overlay      -> tytuł/zajawka/meta NA okładce (Layout 4/5/12)
//   side-by-side -> cover obok nagłówka, treść pod spodem (Layout 7 - split)
//   no-cover     -> sam nagłówek, okładka pomijana nawet gdy wpis ją ma (Layout 9)
// Sidebar (gdy włączony) jest prawą szyną na całą wysokość artykułu - nagłówek,
// cover i treść siedzą w lewej kolumnie, dokładnie jak na kaflach w
// /admin/post-layouts i w podglądzie edytora (LayoutScaffold).
import type { CSSProperties, ReactNode } from "react";
import {
  findLayout,
  coverImageSizes,
  coverAspectRatio,
  effectiveHasSidebar,
  layoutContentMaxWidth,
  overlayTypographyStyle,
  headerTypographyStyle,
  rendersCover,
  BOXED_COVER_MAX_WIDTH,
  type LayoutHeaderMode,
  type PostFormat,
  type PostLayoutSettings,
} from "@/lib/postLayouts";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { ReadingHeader } from "@/components/share/ReadingHeader";
import { cleanExcerpt } from "@/lib/text/cleanExcerpt";

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
  /**
   * Per-wpis nadpisanie sidebara (`layout_overrides.has_sidebar`). Wygrywa nad
   * globalnym `layout_sidebar_overrides` i domyślną wartością presetu.
   */
  sidebarOverride?: boolean | null;
}

/**
 * Portretowe ratio (np. Layout 6 - 150%) na szerokiej kolumnie dałoby hero
 * wyższe niż ekran. Ramka zostaje w proporcji, dopóki mieści się w kadrze;
 * powyżej - przycina się do 80% wysokości okna.
 */
const RATIO_COVER_MAX_HEIGHT = "80vh";

export function PostLayoutRenderer({
  format,
  layoutId,
  settings,
  title,
  excerpt: rawExcerpt,
  coverImageUrl,
  meta,
  categoryBadges,
  content,
  sidebar,
  footer,
  coverViewTransitionId,
  entityId,
  entityType = "post",
  sidebarOverride,
}: Props) {
  const excerpt = cleanExcerpt(rawExcerpt);
  const preset = findLayout(format, layoutId);
  // Sidebar tylko wtedy, gdy preset/override go chce ORAZ strona ma czym go
  // wypełnić - inaczej siatka zostawiłaby po prawej pustą, 320-px kolumnę,
  // a treść trzymałaby zwężoną szerokość "z sidebarem".
  const hasSidebar = effectiveHasSidebar(preset, settings, sidebarOverride) && sidebar != null;
  const center = settings.center_header ?? preset.centerHeaderDefault ?? false;
  const ratioPct = preset.featuredRatioKey ? settings[preset.featuredRatioKey] : null;
  const contentMaxW = layoutContentMaxWidth(preset, settings, hasSidebar);
  const headerTypoStyle = headerTypographyStyle(settings);
  const overlayTypoStyle = overlayTypographyStyle(settings);

  // Okładka pojawia się tylko wtedy, gdy preset jej chce ORAZ wpis ją ma.
  // Bez zdjęcia każdy układ degraduje się do klasycznego nagłówka - inaczej
  // "below-cover" czy "overlay" renderowałyby pustą, czarną ramę.
  const showCover = rendersCover(preset) && !!coverImageUrl;
  const headerMode: LayoutHeaderMode = showCover ? preset.header : "no-cover";
  const showExcerpt = preset.showExcerpt !== false && !!excerpt;

  // Klasyczny nagłówek: kategorie -> tytuł -> zajawka -> meta.
  // `constrained` trzyma go w tej samej skrzynce co treść, więc przy
  // wyrównaniu do lewej krawędzie tytułu i akapitów są w jednej linii.
  const classicHeader = (constrained = true) => (
    <header
      className={`mb-8 min-w-0 w-full max-w-full ${constrained ? "mx-auto" : ""} ${
        center ? "text-center" : ""
      }`}
      style={constrained ? { ...headerTypoStyle, maxWidth: `${contentMaxW}px` } : headerTypoStyle}
    >
      {categoryBadges && (
        <div className={`mb-4 flex flex-wrap gap-2 ${center ? "justify-center" : ""}`}>
          {categoryBadges}
        </div>
      )}
      <h1 className="header-title-typography font-display font-bold leading-[1.1] mb-4">{title}</h1>
      {showExcerpt && (
        <p className="header-excerpt-typography text-muted-foreground mb-4">{excerpt}</p>
      )}
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
      className="absolute inset-x-0 bottom-0 p-4 sm:p-5 md:p-8 lg:p-10 text-white"
      style={overlayTypoStyle}
    >
      <div className={`w-full ${center ? "text-center" : ""} overlay-meta-card`}>
        {categoryBadges && (
          <div className={`mb-3 flex flex-wrap gap-1.5 ${center ? "justify-center" : ""}`}>
            {categoryBadges}
          </div>
        )}
        <h1 className="overlay-meta-title overlay-title-typography font-display font-bold leading-[1.15] mb-2 text-white line-clamp-3 sm:line-clamp-none [text-shadow:0_2px_12px_rgba(0,0,0,0.85)]">
          {title}
        </h1>
        {showExcerpt && (
          <p
            className={`overlay-meta-description overlay-excerpt-typography hidden sm:block text-white/80 mb-3 line-clamp-2 max-w-2xl ${center ? "mx-auto" : ""}`}
          >
            {excerpt}
          </p>
        )}
        {meta && (
          <div
            className={`text-[10px] md:text-[11px] lg:text-xs flex flex-wrap items-center gap-x-3 gap-y-1 text-white/90 sm:text-white/70 [text-shadow:0_1px_6px_rgba(0,0,0,0.8)] ${center ? "justify-center" : ""}`}
          >
            {meta}
          </div>
        )}
      </div>
    </div>
  );

  // Wspólna ramka okładki dla wszystkich wariantów. `overlay` dokłada
  // gradienty i nakładkę z tytułem, pozostałe warianty malują czyste zdjęcie.
  //
  // Okładka wchodzi PARAMETREM, nie z domknięcia: `headerMode` inne niż
  // "no-cover" już gwarantuje `coverImageUrl` (patrz `showCover` wyżej), więc
  // wewnętrzny strażnik `if (!coverImageUrl)` był kodem, którego nie dało się
  // ani wykonać, ani pokryć testem - i to on trzymał bramkę pokrycia tego pliku
  // pod progiem. Parametr przenosi tę gwarancję do systemu typów.
  const coverFrame = (coverUrl: string, { overlay = false }: { overlay?: boolean } = {}) => {
    const isFullBleed = preset.cover === "full-bleed";
    const isRatio = preset.cover === "ratio" && !!ratioPct;
    // Full-bleed wychodzi poza padding strony tylko bez sidebara - w siatce
    // z prawą szyną ujemne marginesy wjeżdżałyby pod sidebar.
    const bleed = isFullBleed && !hasSidebar;
    const frameStyle: CSSProperties = {
      aspectRatio: coverAspectRatio(preset, ratioPct),
      borderRadius: "6px",
      ...(isRatio ? { maxHeight: RATIO_COVER_MAX_HEIGHT } : null),
      ...(coverViewTransitionId
        ? { viewTransitionName: `post-cover-${coverViewTransitionId}` }
        : null),
    };
    return (
      <div className={`relative min-w-0 max-w-full ${bleed ? "sm:-mx-4 lg:-mx-8" : ""}`}>
        <div
          className={`relative mb-8 ${preset.cover === "boxed" ? "mx-auto w-full" : "w-full"}`}
          style={preset.cover === "boxed" ? { maxWidth: `${BOXED_COVER_MAX_WIDTH}px` } : undefined}
        >
          <div className="relative overflow-hidden bg-neutral-900" style={frameStyle}>
            <OptimizedImage
              src={coverUrl}
              alt={title}
              className={`absolute inset-0 w-full h-full object-cover ${overlay ? "opacity-80" : ""}`}
              priority
              responsive
              sizes={coverImageSizes(preset)}
            />
            {overlay && (
              <>
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
                {/* Mobile: dodatkowy dolny scrim - overlay ma malo miejsca, wiec
                    tytul/meta musza miec pewny kontrast niezaleznie od zdjecia. */}
                <div className="absolute inset-0 sm:hidden bg-gradient-to-t from-black/90 via-black/55 to-black/25" />
                {overlayMetaCard}
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Split (Layout 7): okładka i nagłówek w dwóch kolumnach, treść pod spodem.
  // Okładka parametrem z tego samego powodu, co w `coverFrame` wyżej.
  const sideBySideTop = (coverUrl: string) => {
    return (
      <div className="mb-8 grid min-w-0 gap-6 lg:grid-cols-2 lg:items-center">
        <div className="relative min-w-0">
          <div
            className="relative overflow-hidden bg-neutral-900"
            style={{
              aspectRatio: coverAspectRatio(preset, ratioPct),
              borderRadius: "6px",
              ...(coverViewTransitionId
                ? { viewTransitionName: `post-cover-${coverViewTransitionId}` }
                : null),
            }}
          >
            <OptimizedImage
              src={coverUrl}
              alt={title}
              className="absolute inset-0 w-full h-full object-cover"
              priority
              responsive
              sizes={coverImageSizes(preset)}
            />
          </div>
        </div>
        {/* Nagłówek jest już w połowie szerokości - bez dodatkowego limitu. */}
        <div className="min-w-0">{classicHeader(false)}</div>
      </div>
    );
  };

  const top = (() => {
    // Jedno zawężenie dla wszystkich wariantów z okładką: `showCover` (wyżej)
    // wiąże `headerMode !== "no-cover"` z istnieniem `coverImageUrl`, ale
    // TypeScript nie przeniesie tego do domknięć - stąd jawny strażnik tutaj,
    // zamiast powtarzanego (i martwego) w każdej z funkcji renderujących.
    if (headerMode === "no-cover" || !coverImageUrl) return classicHeader();
    switch (headerMode) {
      case "overlay":
        return coverFrame(coverImageUrl, { overlay: true });
      case "below-cover":
        return (
          <>
            {coverFrame(coverImageUrl)}
            {classicHeader()}
          </>
        );
      case "side-by-side":
        return sideBySideTop(coverImageUrl);
      case "above-cover":
      default:
        return (
          <>
            {classicHeader()}
            {coverFrame(coverImageUrl)}
          </>
        );
    }
  })();

  const article = (
    <div className="min-w-0 max-w-full">
      {top}
      <div style={{ maxWidth: `${contentMaxW}px` }} className="min-w-0 w-full max-w-full mx-auto">
        {content}
      </div>
      {footer}
    </div>
  );

  return (
    <div
      className="min-w-0 max-w-full"
      data-post-layout={preset.id}
      data-layout-header={headerMode}
      data-layout-cover={showCover ? preset.cover : "none"}
      data-layout-sidebar={hasSidebar ? "true" : "false"}
    >
      <ReadingHeader title={title} entityId={entityId} entityType={entityType} />
      {hasSidebar ? (
        <div className="grid min-w-0 max-w-full lg:grid-cols-[minmax(0,1fr)_320px] gap-10">
          {article}
          <aside className="min-w-0 max-w-full space-y-6 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:[scrollbar-width:thin]">
            {sidebar}
          </aside>
        </div>
      ) : (
        article
      )}
    </div>
  );
}
