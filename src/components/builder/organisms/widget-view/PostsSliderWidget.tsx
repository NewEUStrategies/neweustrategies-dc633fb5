// Slider zasilany wpisami (source=posts), wydzielony z mediaWidgets.tsx do
// osobnego modułu, żeby mógł żyć we własnym leniwym chunku: ImageWidget
// (logo/hero, kandydat LCP) musi zostać eager w chrome, a warstwa zapytań
// slidera (posty + profile autorów) nie ma powodu jechać w chunku wejściowym
// stron bez tego widgetu. Ładowany przez rejestr lazyWidgets.
import { useQuery } from "@tanstack/react-query";
import type { WidgetNode, WidgetTypography } from "@/lib/builder/types";
import { getStr, type Lang } from "./frame";
// UWAGA: importujemy z `sliderOptions` (czyste dane), NIE z `sliderVariants` -
// renderer slidera ma zostać w leniwym chunku (lazyWidgets), a nie wpaść tu
// przez import stałych.
import {
  NAV_ARROW_VARIANT_VALUES,
  NAV_BG_STYLES,
  NAV_POSITIONS,
  SLIDER_RATIOS,
  SLIDER_ROUNDED_VALUES,
  SLIDER_VARIANT_VALUES,
} from "@/lib/builder/sliderOptions";
import { asBool, asNum, asNumInRange, asOneOf, asStr } from "@/lib/content-model/contentValue";
import { resolveAuthorDisplay } from "@/lib/builder/authorDisplay";
// Import z `lazySliderRender`, NIE z `lazyWidgets`: ten plik jest sam ładowany
// leniwie z tamtego rejestru, więc import całego rejestru zamykał cykl (w
// testach podmieniających rejestr fabryka `vi.mock` czekała na samą siebie).
import { SliderRender } from "./lazySliderRender";
import { sliderPostsQueryOptions } from "@/lib/builder/sliderPostsQuery";
import { sliderAuthorIds, sliderAuthorsQueryOptions } from "@/lib/builder/sliderAuthorsQuery";

/** Czy redakcja w ogóle ustawiła to pole. Puste/`null` traktujemy jak brak,
 *  żeby "nie ustawiono" (globalny default) nie zlało się z "ustawiono na 0". */
function isSet(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

export function PostsSliderWidget({
  c,
  lang,
  typography,
}: {
  c: WidgetNode["content"];
  lang: Lang;
  typography?: WidgetTypography;
}) {
  const variant = asOneOf(c.variant, SLIDER_VARIANT_VALUES, "editorial-hero");
  const ratio = asOneOf(c.ratio, SLIDER_RATIOS, "16/9");
  // Jawna wartość z inspektora wygrywa; brak = globalny default karuzeli
  // (Motyw -> Karuzele), rozstrzygany w SliderRender. `isSet` odróżnia "nie
  // ustawiono" od "ustawiono na fałsz/zero" - inaczej wyłączony autoplay
  // wracałby do globalnego domyślnego włączenia.
  const autoplay = isSet(c.autoplay) ? asBool(c.autoplay, true) : undefined;
  const intervalMs = isSet(c.intervalMs) ? asNum(c.intervalMs, 4500) : undefined;
  const rounded = asOneOf(c.rounded, SLIDER_ROUNDED_VALUES, "md");
  const overlayOpacity = asNumInRange(c.overlayOpacity, 0.45, 0, 1);
  // Sekcja "Wyświetlanie" panelu: te ustawienia muszą dojechać do SliderRender,
  // inaczej przełączniki w edytorze są martwe (renderer domyślnie pokazuje wszystko).
  const showExcerpt = asBool(c.showExcerpt, true);
  const showCover = asBool(c.showCover, true);
  const showTitle = asBool(c.showTitle, true);
  // Prezentacja autora rozstrzygana wspólnym rezolwerem (`authorDisplay`),
  // ten sam kontrakt co w post-liście, liście z oceną i metadanych wpisu.
  const author = resolveAuthorDisplay(c, lang);
  const showAuthor = author.visible;
  const ctaLabel = getStr(c, `cta_${lang}`) || getStr(c, "cta_pl") || "";

  // Shared with the SSR prefetch registry (lib/builder/prefetch), so the
  // streaming gate warms this exact cache entry and the slider ships as
  // complete server HTML instead of an empty state that pops in later.
  const { data: items = [], isPending } = useQuery(sliderPostsQueryOptions(c, lang));

  // Batch-fetch author profiles for the resolved slider posts so name+avatar
  // propagate live to the byline without one query per slide. Opcje zapytania
  // (klucz + queryFn + izolacja najemcy przez `profiles_public`) mieszkają we
  // współdzielonym `sliderAuthorsQuery`, tym samym, który rozgrzewa prefetch
  // SSR - hero wychodzi z serwera Z byline zamiast doklejać ją po hydratacji.
  const authorIds = sliderAuthorIds(items);
  const { data: authorMap = {} } = useQuery({
    ...sliderAuthorsQueryOptions(authorIds),
    enabled: authorIds.length > 0,
  });

  const columns = Math.round(asNumInRange(c.columns, 3, 1, 4)) as 1 | 2 | 3 | 4;

  // While the initial fetch is in flight, hold layout with a quiet shimmer
  // instead of flashing the "Dodaj obrazki do slidera" empty state - that
  // message is only true once the query has settled with no posts.
  if (isPending) {
    return (
      <div
        aria-busy="true"
        className="w-full skeleton-shimmer"
        style={{
          aspectRatio: ratio.replace("/", " / "),
          borderRadius: {
            none: "0px",
            sm: "4px",
            md: "8px",
            lg: "16px",
            xl: "24px",
            full: "9999px",
          }[rounded],
        }}
      />
    );
  }

  const cfg = {
    variant,
    ratio,
    autoplay,
    intervalMs,
    rounded,
    overlayOpacity,
    columns,
    titleSizePx: isSet(c.titleSizePx) ? asNum(c.titleSizePx, 0) : undefined,
    titleWeight: isSet(c.titleWeight) ? asNum(c.titleWeight, 0) : undefined,
    subtitleSizePx: isSet(c.subtitleSizePx) ? asNum(c.subtitleSizePx, 0) : undefined,
    subtitleWeight: isSet(c.subtitleWeight) ? asNum(c.subtitleWeight, 0) : undefined,
    navSizePx: isSet(c.navSizePx) ? asNumInRange(c.navSizePx, 52, 28, 96) : undefined,
    navRoundedPx: isSet(c.navRoundedPx) ? asNum(c.navRoundedPx, 999) : undefined,
    navBgColor: asStr(c.navBgColor) || undefined,
    navArrowColor: asStr(c.navArrowColor) || undefined,
    navBgStyle: asOneOf(c.navBgStyle, NAV_BG_STYLES, "glass"),
    navPosition: asOneOf(c.navPosition, NAV_POSITIONS, "mid"),
    navArrowVariant: asOneOf(c.navArrowVariant, NAV_ARROW_VARIANT_VALUES, "chevron"),
    navArrowStroke: isSet(c.navArrowStroke)
      ? asNumInRange(c.navArrowStroke, 2.25, 0.5, 4)
      : undefined,
    typography,
    showExcerpt,
    showAuthor,
    showTitle,
    showCover,
    // Obie osie widoczności i oba rozmiary jadą do renderera JUŻ rozstrzygnięte
    // - `SliderRender` nie może dojść do innego wyniku niż kanwa i panel.
    showAuthorName: author.showName,
    showAuthorAvatar: author.showAvatar,
    authorLabel_pl: asStr(c.authorLabel_pl),
    authorLabel_en: asStr(c.authorLabel_en),
    authorSizePx: author.nameSizePx,
    authorAvatarSizePx: author.avatarSizePx,
    // Nie odfiltrowujemy slajdów po braku cover_image_url - inaczej wyłączenie
    // "Pokaż cover" (lub post bez okładki) trwale usuwałoby slajd z karuzeli
    // i nie dałoby się go przywrócić bez ponownego dodania okładki do wpisu.
    items: items.map((p) => {
      const author = p.author_id ? authorMap[p.author_id] : undefined;
      return {
        image: p.cover_image_url ?? "",
        title_pl: p.title_pl ?? "",
        title_en: p.title_en ?? p.title_pl ?? "",
        subtitle_pl: showExcerpt ? (p.excerpt_pl ?? "") : "",
        subtitle_en: showExcerpt ? (p.excerpt_en ?? p.excerpt_pl ?? "") : "",
        href: `/post/${p.slug}`,
        cta_pl: ctaLabel,
        cta_en: ctaLabel,
        author: author?.name ?? "",
        authorAvatar: author?.avatar ?? "",
        authorSlug: author?.slug ?? "",
      };
    }),
  };
  return <SliderRender config={cfg} lang={lang} />;
}
