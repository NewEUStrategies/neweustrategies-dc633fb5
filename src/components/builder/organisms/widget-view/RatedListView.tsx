// Organism: rated/ranked post list with manual/dynamic sourcing and rich styling.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import * as LucideIcons from "@/lib/lucide-shim";
import type { WidgetContent } from "@/lib/builder/types";
import {
  asBool,
  asNum,
  asNumInRange,
  asOneOf,
  asStr,
  pickI18n,
  type ContentBag,
} from "@/lib/content-model/contentValue";
// Klucz, swiezosc i cale `queryFn` listy dynamicznej mieszkaja we WSPOLNYM
// module - tym samym, po ktory siega rejestr prefetchu SSR
// (`lib/builder/prefetch.widgetQueryOptionsList`). Wczesniej stalo to wprost
// tutaj, wiec rejestr tego typu nie widzial: sekcja z sama lista ocenianna
// wychodzila z serwera bez wierszy i liczyla sie jako statyczna.
import {
  ratedListQueryOptions,
  ratedListUsesDynamicSource,
  type RatedListItem,
} from "@/lib/builder/ratedListQuery";
import { autoInvertColor } from "@/lib/builder/autoInvertColor";
import { AppLink } from "@/components/atoms/AppLink";
import { hardenStyleCss } from "@/lib/sanitize";
import { AuthorByline } from "@/components/molecules/AuthorByline";
import { resolveAuthorDisplay } from "@/lib/builder/authorDisplay";
import { uiLocale } from "@/lib/i18n/format";

// Auto-derive a dark-mode color from the light value when the user hasn't
// explicitly set one. Empty string === inherit/default.
const autoDark = (light: string, dark: string): string =>
  dark || (light ? autoInvertColor(light, "dark") : "");

/**
 * Breakpointy siatki. Zgodne z reszta widget-view (SimpleWidgets: spacer) i ze
 * skala Tailwinda: mobile < 641px, tablet 641-1023px, desktop >= 1024px.
 * Reguly sa pisane mobile-first, zeby kolejne media query tylko nadpisywaly
 * poprzednie - bez `!important` i bez zaleznosci od kolejnosci wstrzykniecia.
 */
const RL_TABLET_MIN_PX = 641;
const RL_DESKTOP_MIN_PX = 1024;

/** Sentinel: "uzytkownik nie ustawil liczby" (odrozniane od zera). */
const UNSET_NUMBER = Number.NaN;

type Lang = "pl" | "en";

const FONT_FAMILIES = ["display", "sans", "serif", "mono"] as const;
const NUMBER_POSITIONS = ["behind", "left", "top"] as const;
const SCROLLING_MODES = ["none", "scroll", "loadmore", "carousel"] as const;
const GRID_BORDERS = ["none", "between", "full"] as const;
const COLOR_SCHEMES = ["auto", "light", "dark"] as const;

export function RatedListView({
  c,
  lang,
  mode = "light",
}: {
  c: WidgetContent;
  lang: Lang;
  mode?: "light" | "dark";
}) {
  const bag: ContentBag = c;
  // JEDNA bramka zrodla, wspoldzielona z rejestrem prefetchu SSR: gdyby widok
  // liczyl ja wlasnym wyrazeniem, rozjazd o jedna koercje dawalby rozgrzany
  // wpis, w ktory widget nigdy nie trafia (SSR pusty, klient placi drugie
  // zapytanie, nic nie zglasza bledu).
  const dynamic = ratedListUsesDynamicSource(c);
  const numFont = asOneOf(bag.numberFont, FONT_FAMILIES, "display");
  // Weight: widget override wins; otherwise inherit Theme Design token.
  const numWeight = asStr(bag.numberWeight) || "var(--td-li-weight, 700)";
  const numSize = asNumInRange(bag.numberSizePx, 52, 12, 240);
  // Number colors: mirror PostListView (numbered / ranked) so ranked-lists,
  // rated-lists AND all fallbacks share the SAME single source of truth -
  // Theme Design → "Numeracja list" (`--td-li-*`). Only when the user sets
  // an explicit widget-level override does it win over the global token.
  // Fallback literals align with PostListView (rgb(35,31,32) / rgb(250,147,70)).
  const numColorRaw = asStr(bag.numberColor);
  const numColorDarkRaw = asStr(bag.numberColorDark);
  const numColor = numColorRaw || "var(--td-li-light, rgb(35,31,32))";
  const numColorDark = numColorDarkRaw
    ? numColorDarkRaw
    : numColorRaw
      ? autoInvertColor(numColorRaw, "dark")
      : "var(--td-li-dark, rgb(250,147,70))";
  // Brak jawnej wartosci musi zostawic token Theme Design, dlatego czytamy z
  // sentinelem zamiast podstawiac liczbe domyslna.
  const numOpacityRaw = asNum(bag.numberOpacity, UNSET_NUMBER);
  const numOpacity: number | string = Number.isNaN(numOpacityRaw)
    ? "var(--td-li-opacity, 0.18)"
    : Math.min(1, Math.max(0, numOpacityRaw));
  const numPos = asOneOf(bag.numberPosition, NUMBER_POSITIONS, "behind");
  // Ocena istnieje wylacznie w recznych pozycjach - tabela `posts` nie ma
  // kolumny z ocena, wiec w trybie dynamicznym przelacznik jest ukryty w
  // edytorze i tutaj tez nie ma czego wlaczac.
  const showRating = !dynamic && asBool(bag.showRating, true);

  const showCategory = asBool(bag.showCategory, false);
  const categoryColor = asStr(bag.categoryColor) || "#dc2626";
  const categoryColorDarkRaw = asStr(bag.categoryColorDark);
  const categoryColorDark = categoryColorDarkRaw || autoInvertColor(categoryColor, "dark");
  const categorySize = asNumInRange(bag.categorySizePx, 11, 8, 32);
  const categoryWeight = asStr(bag.categoryWeight) || "700";
  const categoryUppercase = asBool(bag.categoryUppercase, true);

  const titleColor = asStr(bag.titleColor);
  const titleColorDark = autoDark(titleColor, asStr(bag.titleColorDark));
  const titleHoverColor = asStr(bag.titleHoverColor);
  const titleHoverColorDark = titleHoverColor ? autoInvertColor(titleHoverColor, "dark") : "";
  const titleWeight = asStr(bag.titleWeight) || "700";
  const titleFont = asOneOf(bag.titleFont, FONT_FAMILIES, "display");

  // Autor: wspolny kontrakt calego buildera (nazwisko 12 px / zdjecie 20 px,
  // obie osie chowane niezaleznie). Historyczny `showAuthor` nadal gasi cala
  // sekcje - rezolwer czyta go jako wartosc domyslna.
  const authorDisplay = resolveAuthorDisplay(bag, lang);
  const showAuthor = authorDisplay.visible;
  const showDate = asBool(bag.showDate, false);
  const metaColor = asStr(bag.metaColor);
  const metaColorDark = autoDark(metaColor, asStr(bag.metaColorDark));
  const metaSize = asNumInRange(bag.metaSizePx, 12, 8, 20);

  const showExcerpt = asBool(bag.showExcerpt, true);
  const excerptColor = asStr(bag.excerptColor);
  const excerptColorDark = autoDark(excerptColor, asStr(bag.excerptColorDark));
  const excerptLines = asNumInRange(bag.excerptLines, 3, 1, 10);

  const showReadMore = asBool(bag.showReadMore, false);
  // Etykieta ma wbudowany, zlokalizowany default, wiec NIE uzywamy tu
  // fallbacku PL->EN z `pickI18n`: pusty tekst EN musi dac "Read more",
  // a nie polski napis wpisany w drugiej zakladce jezykowej.
  const readMoreText =
    asStr(bag[`readMoreText_${lang}`]) || (lang === "pl" ? "Czytaj więcej" : "Read more");
  const readMoreColor = asStr(bag.readMoreColor);
  const readMoreColorDark = autoDark(readMoreColor, asStr(bag.readMoreColorDark));

  const showBookmark = asBool(bag.showBookmark, false);
  const bookmarkColor = asStr(bag.bookmarkColor);
  const bookmarkColorDark = autoDark(bookmarkColor, asStr(bag.bookmarkColorDark));
  const bookmarkSize = asNumInRange(bag.bookmarkSizePx, 16, 10, 32);

  const showPostFormat = asBool(bag.showPostFormat, false);
  const postFormatColor = asStr(bag.postFormatColor);
  const postFormatColorDark = autoDark(postFormatColor, asStr(bag.postFormatColorDark));

  const colorScheme = asOneOf(bag.colorScheme, COLOR_SCHEMES, "auto");

  const colsD = asNumInRange(bag.columnsDesktop, 1, 1, 6);
  // Domyslny tablet = min(desktop, 2), tak samo jak w edytorze - inaczej panel
  // pokazywalby inna liczbe kolumn niz renderuje kanwa.
  const colsT = asNumInRange(bag.columnsTablet, Math.min(colsD, 2), 1, 6);
  const colsM = asNumInRange(bag.columnsMobile, 1, 1, 3);
  const colGap = asNumInRange(bag.columnGapPx, 24, 0, 120);
  const rowGap = asNumInRange(bag.rowGapPx, 28, 0, 120);
  const gridBorders = asOneOf(bag.gridBorders, GRID_BORDERS, "none");
  const gridBorderColor = asStr(bag.gridBorderColor);
  const gridBorderWidth = asNumInRange(bag.gridBorderWidthPx, 1, 0, 8);
  const itemSpacing = asNumInRange(bag.itemSpacingPx, rowGap, 0, 80);
  const itemPadding = asNumInRange(bag.itemPaddingPx, 0, 0, 40);
  const scrollingMode = asOneOf(bag.scrollingMode, SCROLLING_MODES, "none");
  const scrollMaxHeight = asNumInRange(bag.scrollMaxHeightPx, 400, 120, 1200);
  const pageSize = asNumInRange(bag.pageSize, 4, 1, 50);

  const fontCls =
    numFont === "sans"
      ? "font-sans"
      : numFont === "serif"
        ? "font-serif"
        : numFont === "mono"
          ? "font-mono"
          : "font-display";
  const titleFontCls =
    titleFont === "sans"
      ? "font-sans"
      : titleFont === "serif"
        ? "font-serif"
        : titleFont === "mono"
          ? "font-mono"
          : "font-display";
  const numStyle: CSSProperties = {
    fontSize: `clamp(${Math.round(numSize * 0.6)}px, ${Math.round(numSize * 0.08)}vw + ${Math.round(numSize * 0.5)}px, ${numSize}px)`,
    fontWeight: numWeight as CSSProperties["fontWeight"],
    opacity: numOpacity,
  };

  const manualItems: RatedListItem[] = (
    Array.isArray(c.items) ? (c.items as Array<Record<string, unknown>>) : []
  ).map((it) => ({
    title: pickI18n(it, "title", lang),
    excerpt: pickI18n(it, "excerpt", lang),
    author: asStr(it.author),
    authorAvatar: asStr(it.authorAvatar) || undefined,
    rating: asNum(it.rating, 0),
    // Link pozycji: bez niego "Czytaj wiecej" i klikalny tytul byly martwe w
    // trybie recznym (przycisk jest bramkowany na `href`).
    href: asStr(it.href) || undefined,
    category: pickI18n(it, "category", lang),
    date: asStr(it.date),
    format: asStr(it.format) || "standard",
  }));

  // Klucz, swiezosc i queryFn pochodza z JEDNEJ fabryki
  // (`lib/builder/ratedListQuery`), po ktora siega tez rejestr prefetchu SSR.
  // Rozjazd kluczy jest wiec strukturalnie niewyrazalny: nie ma drugiego
  // literalu ani drugiej koercji, ktora moglaby sie rozjechac. `lang` NALEZY do
  // klucza, bo queryFn sortuje po `title_${lang}` i wpieka zlokalizowany
  // tytul/zajawke w cache'owane wiersze.
  const { data: dynItems } = useQuery({
    ...ratedListQueryOptions(c, lang),
    enabled: dynamic,
  });

  const allItems: RatedListItem[] = dynamic ? (dynItems ?? []) : manualItems;
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const items = scrollingMode === "loadmore" ? allItems.slice(0, visibleCount) : allItems;

  const isCarousel = scrollingMode === "carousel";
  const isScroll = scrollingMode === "scroll";
  const isGrid = colsD > 1 || colsT > 1 || colsM > 1;

  const gridStyle: CSSProperties = isCarousel
    ? { display: "flex", gap: colGap, overflowX: "auto", scrollSnapType: "x mandatory" }
    : isGrid
      ? {
          display: "grid",
          // Liczba kolumn NIE moze isc inline: styl inline wygrywa z kazda
          // regula arkusza, wiec media query nigdy by nie zadzialaly. Inline
          // ida wylacznie zmienne CSS, ktore te reguly czytaja - dzieki temu
          // kilka rated-list na jednej stronie ma wlasne liczby kolumn mimo
          // wspoldzielonego selektora `.rl-wrap`.
          ["--rl-cols-d" as string]: colsD,
          ["--rl-cols-t" as string]: colsT,
          ["--rl-cols-m" as string]: colsM,
          columnGap: colGap,
          rowGap,
        }
      : { display: "block" };

  const containerStyle: CSSProperties = {
    ...(isScroll ? { maxHeight: scrollMaxHeight, overflowY: "auto", paddingRight: 8 } : {}),
    ...(gridBorders === "full"
      ? {
          border: `${gridBorderWidth}px solid ${gridBorderColor || "var(--border)"}`,
          padding: 12,
          borderRadius: 8,
        }
      : {}),
  };

  const formatIcon = (fmt?: string) => {
    const Icons = LucideIcons as Record<
      string,
      React.ComponentType<{ className?: string; style?: CSSProperties }>
    >;
    const map: Record<string, string> = {
      video: "Video",
      gallery: "Images",
      audio: "Music",
      quote: "Quote",
      link: "Link",
    };
    const key = map[fmt || ""] || "";
    return key ? Icons[key] : null;
  };
  const BookmarkIcon = (
    LucideIcons as Record<
      string,
      React.ComponentType<{ className?: string; style?: CSSProperties }>
    >
  ).Bookmark;

  const schemeCls =
    colorScheme === "dark" ? "dark" : colorScheme === "light" ? "" : mode === "dark" ? "dark" : "";

  // Realnie responsywna siatka: mobile jest baza, tablet i desktop tylko
  // nadpisuja liczbe kolumn. Wartosci ida przez zmienne ustawione inline na
  // konkretnym `<ol>`, wiec regula moze byc wspolna dla wszystkich instancji.
  const responsiveGridCss = isGrid
    ? `
        .rl-wrap.rl-grid{grid-template-columns:repeat(var(--rl-cols-m,1),minmax(0,1fr));}
        @media (min-width:${RL_TABLET_MIN_PX}px){.rl-wrap.rl-grid{grid-template-columns:repeat(var(--rl-cols-t,1),minmax(0,1fr));}}
        @media (min-width:${RL_DESKTOP_MIN_PX}px){.rl-wrap.rl-grid{grid-template-columns:repeat(var(--rl-cols-d,1),minmax(0,1fr));}}
      `
    : "";

  const ratedListColorCss = hardenStyleCss(`
        .rl-wrap .rl-num{color:${numColor};}
        .dark .rl-wrap .rl-num{color:${numColorDark};}
        .rl-wrap .rl-cat{color:${categoryColor};}
        .dark .rl-wrap .rl-cat{color:${categoryColorDark};}
        ${titleColor ? `.rl-wrap .rl-title{color:${titleColor};}` : ""}
        ${titleColorDark ? `.dark .rl-wrap .rl-title{color:${titleColorDark};}` : ""}
        ${titleHoverColor ? `.rl-wrap .rl-title:hover{color:${titleHoverColor};}` : ""}
        ${titleHoverColorDark ? `.dark .rl-wrap .rl-title:hover{color:${titleHoverColorDark};}` : ""}
        ${metaColor ? `.rl-wrap .rl-meta{color:${metaColor};}` : ""}
        ${metaColorDark ? `.dark .rl-wrap .rl-meta{color:${metaColorDark};}` : ""}
        ${excerptColor ? `.rl-wrap .rl-exc{color:${excerptColor};}` : ""}
        ${excerptColorDark ? `.dark .rl-wrap .rl-exc{color:${excerptColorDark};}` : ""}
        ${readMoreColor ? `.rl-wrap .rl-more{color:${readMoreColor};}` : ""}
        ${readMoreColorDark ? `.dark .rl-wrap .rl-more{color:${readMoreColorDark};}` : ""}
        ${bookmarkColor ? `.rl-wrap .rl-bookmark{color:${bookmarkColor};}` : ""}
        ${bookmarkColorDark ? `.dark .rl-wrap .rl-bookmark{color:${bookmarkColorDark};}` : ""}
        ${postFormatColor ? `.rl-wrap .rl-format{color:${postFormatColor};}` : ""}
        ${postFormatColorDark ? `.dark .rl-wrap .rl-format{color:${postFormatColorDark};}` : ""}
        .rl-wrap .rl-item + .rl-item{${gridBorders === "between" && !isGrid ? `border-top:${gridBorderWidth}px solid ${gridBorderColor || "var(--border)"};padding-top:${itemSpacing}px;` : ""}}
        ${responsiveGridCss}
      `);

  return (
    <div className={schemeCls}>
      <style dangerouslySetInnerHTML={{ __html: ratedListColorCss }} />
      <ol
        className={`rl-wrap${isGrid ? " rl-grid" : ""}`}
        style={{
          ...containerStyle,
          ...gridStyle,
          listStyle: "none",
          margin: 0,
          padding: gridBorders === "full" ? 12 : 0,
        }}
      >
        {items.map((it, i) => {
          const n = String(i + 1).padStart(2, "0");
          const numCls = `rl-num ${fontCls} select-none leading-none`;
          const isLeft = numPos === "left";
          const isTop = numPos === "top";
          const FmtIcon = showPostFormat ? formatIcon(it.format) : null;
          const itemStyle: CSSProperties = {
            ...(scrollingMode === "none" && i > 0 && !isGrid && gridBorders !== "between"
              ? { marginTop: itemSpacing }
              : {}),
            ...(isCarousel ? { minWidth: 280, scrollSnapAlign: "start" } : {}),
            ...(itemPadding ? { padding: itemPadding } : {}),
            ...(gridBorders === "between" && isGrid
              ? {
                  borderBottom: `${gridBorderWidth}px solid ${gridBorderColor || "var(--border)"}`,
                  paddingBottom: itemSpacing,
                }
              : {}),
          };
          const titleStyle: CSSProperties = {
            fontWeight: titleWeight as CSSProperties["fontWeight"],
            lineHeight: 1.3,
          };
          const titleEl = (
            <h3
              className={`rl-title cms-post-title ${titleFontCls} cursor-pointer ${isLeft || isTop ? "" : "pr-12"}`}
              style={titleStyle}
            >
              {it.title}
            </h3>
          );
          return (
            <li
              key={i}
              className={`rl-item relative min-w-0 ${isLeft ? "flex items-start gap-3 sm:gap-4" : ""}`}
              style={{ ...itemStyle, overflow: "visible" }}
            >
              {isLeft ? (
                <span className={`${numCls} shrink-0`} style={numStyle}>
                  {n}
                </span>
              ) : isTop ? (
                <span className={`block mb-2 ${numCls}`} style={numStyle}>
                  {n}
                </span>
              ) : (
                <span
                  className={`absolute -top-2 right-0 ${numCls} pointer-events-none`}
                  style={numStyle}
                >
                  {n}
                </span>
              )}
              <div className={isLeft ? "flex-1 min-w-0" : "min-w-0"}>
                {showBookmark && BookmarkIcon && (
                  <div className="float-right ml-2">
                    <BookmarkIcon
                      className="rl-bookmark"
                      style={{ width: bookmarkSize, height: bookmarkSize }}
                    />
                  </div>
                )}
                {showCategory && it.category && (
                  <div
                    className="rl-cat mb-1"
                    style={{
                      fontSize: `${categorySize}px`,
                      fontWeight: categoryWeight as CSSProperties["fontWeight"],
                      textTransform: categoryUppercase ? "uppercase" : "none",
                      letterSpacing: categoryUppercase ? "0.05em" : undefined,
                    }}
                  >
                    {it.category}
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  {FmtIcon && <FmtIcon className="rl-format w-3.5 h-3.5" />}
                  {it.href ? (
                    <AppLink href={it.href} className="block flex-1">
                      {titleEl}
                    </AppLink>
                  ) : (
                    <div className="flex-1">{titleEl}</div>
                  )}
                </div>
                {showExcerpt && it.excerpt && (
                  <p
                    className="rl-exc cms-post-excerpt mt-2"
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: excerptLines,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {it.excerpt}
                  </p>
                )}
                {showRating && it.rating > 0 && (
                  <div className="mt-3 flex items-center gap-3">
                    <div className="relative h-1.5 w-32 max-w-full overflow-hidden rounded-full">
                      <div
                        className="absolute inset-0"
                        style={{
                          background:
                            "linear-gradient(90deg, #ef4444 0%, #f97316 25%, #facc15 50%, #a3e635 75%, #22c55e 100%)",
                        }}
                      />
                      <div
                        className="absolute top-0 bottom-0 bg-background/40"
                        style={{ left: `${Math.min(100, Math.max(0, it.rating * 10))}%`, right: 0 }}
                      />
                    </div>
                    <span className="text-xs font-semibold whitespace-nowrap">
                      {it.rating}{" "}
                      <span className="text-muted-foreground font-normal">
                        {lang === "pl" ? "na 10" : "out of 10"}
                      </span>
                    </span>
                  </div>
                )}
                {(showAuthor && it.author) || (showDate && it.date) ? (
                  <p
                    className="rl-meta cms-meta mt-2 inline-flex flex-wrap items-center gap-x-3 gap-y-1"
                    style={{ fontSize: `${metaSize}px` }}
                  >
                    {showAuthor && it.author && (
                      <AuthorByline
                        name={it.author}
                        avatarUrl={it.authorAvatar}
                        href={it.authorHref}
                        display={authorDisplay}
                      />
                    )}
                    {showAuthor && it.author && showDate && it.date && (
                      <span aria-hidden className="opacity-60">
                        ·
                      </span>
                    )}
                    {showDate && it.date && (
                      <span>{new Date(it.date).toLocaleDateString(uiLocale(lang))}</span>
                    )}
                  </p>
                ) : null}
                {showReadMore && it.href && (
                  <AppLink
                    href={it.href}
                    className="rl-more inline-block mt-2 text-xs font-semibold hover:underline"
                  >
                    {readMoreText} →
                  </AppLink>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {scrollingMode === "loadmore" && visibleCount < allItems.length && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setVisibleCount((v) => v + pageSize)}
            className="px-4 py-2 text-xs font-semibold border border-border rounded-md hover:bg-muted"
          >
            {lang === "pl" ? "Pokaż więcej" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
