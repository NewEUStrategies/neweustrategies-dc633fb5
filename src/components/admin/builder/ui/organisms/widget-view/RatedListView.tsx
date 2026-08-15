// Organism: rated/ranked post list with manual/dynamic sourcing and rich styling.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
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

/**
 * Swiezosc listy dynamicznej. Ta sama wartosc co `postListQuery` - to ta sama
 * klasa danych (opublikowane wpisy), wiec rozjazd TTL-i byloby zaskoczeniem.
 * Wczesniej TTL byl niejawny (domyslny dla klienta), a klucz nie zawieral
 * jezyka, wiec przelaczenie PL/EN pokazywalo stary jezyk az do wygasniecia.
 */
const RATED_LIST_STALE_MS = 2 * 60_000;

/** Sentinel: "uzytkownik nie ustawil liczby" (odrozniane od zera). */
const UNSET_NUMBER = Number.NaN;

type Lang = "pl" | "en";

type RatedItem = {
  title: string;
  excerpt: string;
  author: string;
  authorAvatar?: string;
  authorHref?: string;
  rating: number;
  href?: string;
  category?: string;
  date?: string;
  format?: string;
};

type PostRow = {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  published_at: string | null;
  post_format: string | null;
  author_id: string | null;
};

/** Publiczna projekcja profilu (`profiles_public`) - `id` bywa nullowalne w typach widoku. */
type ProfileRow = { id: string | null; display_name: string | null; avatar_url: string | null };

const FONT_FAMILIES = ["display", "sans", "serif", "mono"] as const;
const NUMBER_POSITIONS = ["behind", "left", "top"] as const;
const SCROLLING_MODES = ["none", "scroll", "loadmore", "carousel"] as const;
const GRID_BORDERS = ["none", "between", "full"] as const;
const COLOR_SCHEMES = ["auto", "light", "dark"] as const;
const ORDER_BY = ["last_published", "title_asc", "title_desc", "random"] as const;
const SOURCES = ["manual", "dynamic"] as const;

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
  const source = asOneOf(bag.source, SOURCES, "manual");
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
  const showRating = source === "manual" && asBool(bag.showRating, true);

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

  const manualItems: RatedItem[] = (
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

  const csv = (k: string) =>
    asStr(bag[k])
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const cats = csv("categoriesFilter");
  const excludeCats = csv("excludeCategories");
  const tagSlugs = csv("tagsFilter");
  const excludeTagSlugs = csv("excludeTags");
  const postFormat = asStr(bag.postFormatFilter);
  const authors = csv("authorFilter");
  const postIds = csv("postIdsFilter");
  const excludePostIds = csv("excludePostIds");
  const orderBy = asOneOf(bag.orderBy, ORDER_BY, "last_published");
  const limit = asNumInRange(bag.numberOfPosts, 4, 1, 50);
  const offset = Math.max(0, asNum(bag.postOffset, 0));

  // `lang` NALEZY do klucza: queryFn sortuje po `title_${lang}` i wpieka
  // zlokalizowany tytul/zajawke w cache'owane wiersze. Bez jezyka w kluczu
  // przelaczenie PL/EN oddawalo poprzedni jezyk az do wygasniecia swiezosci.
  const queryKey = [
    WIDGET_QUERY_ROOTS.ratedList,
    {
      lang,
      cats,
      excludeCats,
      tagSlugs,
      excludeTagSlugs,
      postFormat,
      authors,
      postIds,
      excludePostIds,
      orderBy,
      limit,
      offset,
    },
  ];
  const { data: dynItems } = useQuery({
    queryKey,
    enabled: source === "dynamic",
    staleTime: RATED_LIST_STALE_MS,
    // Tenant scoping: wszystkie tabele ponizej (posts, post_categories,
    // post_tags, profiles) sa odcinane przez RLS po public_tenant_id() - taki
    // sam wzorzec jak w sasiednich zapytaniach widgetowych (postListQuery).
    queryFn: async (): Promise<RatedItem[]> => {
      const resolveByCategory = async (slugs: string[]) => {
        if (!slugs.length) return null;
        const { data } = await supabase
          .from("post_categories")
          .select("post_id, categories!inner(slug)")
          .in("categories.slug", slugs);
        return new Set((data ?? []).map((r: { post_id: string }) => r.post_id));
      };
      const resolveByTag = async (slugs: string[]) => {
        if (!slugs.length) return null;
        const { data } = await supabase
          .from("post_tags")
          .select("post_id, tags!inner(slug)")
          .in("tags.slug", slugs);
        return new Set((data ?? []).map((r: { post_id: string }) => r.post_id));
      };

      const [incCat, excCat, incTag, excTag] = await Promise.all([
        resolveByCategory(cats),
        resolveByCategory(excludeCats),
        resolveByTag(tagSlugs),
        resolveByTag(excludeTagSlugs),
      ]);

      // Filtr autora MUSI zawezic zapytanie, a nie jego wynik. Filtrowanie po
      // stronie klienta dzialo sie PO `.range(offset, offset+limit-1)`, wiec
      // widget oddawal mniej wierszy niz `numberOfPosts` (a przy autorze spoza
      // pierwszej strony - zero). Rozwiazujemy nazwy na identyfikatory i
      // wkladamy je do zapytania o wpisy. Trzymamy tez avatar_url, zeby
      // renderowac spojny byline (12 px / 20 px) zamiast samego tekstu.
      //
      // IZOLACJA NAJEMCY: `profiles_public` zamiast tabeli `profiles`. Widok
      // zawezony do `public_tenant_id()` wystawia wylacznie kolumny publiczne,
      // wiec filtr "autor o nazwie X" nie ma jak trafic w profil z obszaru
      // roboczego innej firmy (ani ujawnic, ze taki profil istnieje).
      const authorById = new Map<string, ProfileRow>();
      let authorIdFilter: string[] | null = null;
      if (authors.length) {
        const { data: matched } = await supabase
          .from("profiles_public")
          .select("id, display_name, avatar_url")
          .in("display_name", authors);
        // Widok publiczny typuje `id` jako nullowalne - zawezamy raz, zeby
        // dalsza czesc zapytania pracowala na pewnych identyfikatorach.
        const matchedRows = ((matched ?? []) as ProfileRow[]).filter(
          (row): row is ProfileRow & { id: string } => !!row.id,
        );
        for (const p of matchedRows) {
          if (p.display_name) authorById.set(p.id, p);
        }
        authorIdFilter = matchedRows.map((p) => p.id);
        // Zaden profil o takiej nazwie = pusty wynik. Bez tego `.in()` z pusta
        // lista i tak nie zwrocilby nic, ale oszczedzamy round-trip.
        if (authorIdFilter.length === 0) return [];
      }

      let q = supabase
        .from("posts")
        .select(
          "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, published_at, post_format, author_id",
        )
        .eq("status", "published");

      if (postFormat && postFormat !== "all") q = q.eq("post_format", postFormat);
      if (postIds.length) q = q.in("id", postIds);
      if (authorIdFilter) q = q.in("author_id", authorIdFilter);

      const includeIds = new Set<string>();
      let haveInclude = false;
      if (incCat) {
        haveInclude = true;
        incCat.forEach((id) => includeIds.add(id));
      }
      if (incTag) {
        if (haveInclude) {
          for (const id of Array.from(includeIds)) if (!incTag.has(id)) includeIds.delete(id);
        } else {
          haveInclude = true;
          incTag.forEach((id) => includeIds.add(id));
        }
      }
      if (haveInclude) {
        if (includeIds.size === 0) return [];
        q = q.in("id", Array.from(includeIds));
      }

      const excludeIds = new Set<string>([...excludePostIds]);
      excCat?.forEach((id) => excludeIds.add(id));
      excTag?.forEach((id) => excludeIds.add(id));
      if (excludeIds.size) q = q.not("id", "in", `(${Array.from(excludeIds).join(",")})`);

      if (orderBy === "title_asc")
        q = q.order(lang === "pl" ? "title_pl" : "title_en", { ascending: true });
      else if (orderBy === "title_desc")
        q = q.order(lang === "pl" ? "title_pl" : "title_en", { ascending: false });
      else q = q.order("published_at", { ascending: false });

      const from = offset;
      const to = from + limit - 1;
      q = q.range(from, to);

      const { data } = await q;
      let rows = (data ?? []) as PostRow[];

      const missingAuthorIds = Array.from(
        new Set(rows.map((r) => r.author_id).filter((x): x is string => !!x)),
      ).filter((id) => !authorById.has(id));
      if (missingAuthorIds.length) {
        const { data: profs } = await supabase
          .from("profiles_public")
          .select("id, display_name, avatar_url")
          .in("id", missingAuthorIds);
        for (const p of (profs ?? []) as ProfileRow[]) {
          if (p.id && p.display_name) authorById.set(p.id, p);
        }
      }
      if (orderBy === "random") rows = [...rows].sort(() => Math.random() - 0.5);

      return rows.map((r) => {
        const profile = r.author_id ? authorById.get(r.author_id) : undefined;
        return {
          title: (lang === "pl" ? r.title_pl : r.title_en) || r.title_pl,
          excerpt: (lang === "pl" ? r.excerpt_pl : r.excerpt_en) || r.excerpt_pl || "",
          author: profile?.display_name || "",
          authorAvatar: profile?.avatar_url || undefined,
          authorHref: `/post/${r.slug}`,
          // Wpisy nie maja oceny w bazie - patrz `showRating` wyzej.
          rating: 0,
          href: `/post/${r.slug}`,
          date: r.published_at || "",
          format: r.post_format || "standard",
        };
      });
    },
  });

  const allItems: RatedItem[] = source === "dynamic" ? (dynItems ?? []) : manualItems;
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
