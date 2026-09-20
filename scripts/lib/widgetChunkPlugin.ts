import type { Plugin } from "vite";

const WIDGET_DIR = "/src/components/builder/organisms/widget-view/";

/**
 * Typ widgetu -> moduły, których chunk ma dostać hint `modulepreload`.
 *
 * CO TU WOLNO WPISAĆ. Wyłącznie typ, który renderuje się przez LENIWY chunk
 * (`lazy(() => import(...))` w `lazyWidgets.tsx`). Wpis dla typu rysowanego
 * inline w `SimpleWidgets`/`WidgetView` byłby hintem do chunku WEJŚCIOWEGO -
 * czyli do kodu, który przeglądarka i tak już pobiera - więc kosztowałby
 * nagłówek i nie dawałby nic. Dlatego świadomie NIE MA tu `heading`, `image`,
 * `cta`, `video`, `map` ani `dark-featured-card`: wszystkie sześć zostaje eager
 * (kontrakt „co zostaje EAGER" z nagłówka `lazyWidgets.tsx`), a `map` dokłada
 * do tego `DeferredFrame`, który montuje ramkę dopiero przy viewporcie.
 * `heading` ma leniwy wariant wyłącznie jako osobny typ `animated-heading`
 * i to on jest tu wpisany.
 *
 * KLUCZ MUSI BYĆ TYPEM Z `WidgetType`. Nazwy widgetów bywają mylące: lista
 * wydarzeń to `event-list` (nie `events`/`events-list`), a mapa świata to
 * `world-map` (typ `map` to osadzona ramka Google). Rozjazd nie wywala builda -
 * `discovered[type]` byłoby tylko martwym kluczem, a hint zniknąłby po cichu -
 * więc pilnuje tego test wtyczki.
 *
 * 2026-09-20 (F21): było tu 8 typów wobec 62 wywołań `lazy()`, więc strony
 * publiczne z tickerem, listą wydarzeń, prelegentami, zakładkami czy rankingiem
 * nad zgięciem czekały na chunk dopiero po hydratacji. Dołożone są typy realnie
 * występujące nad zgięciem tras publicznych - bez typów panelu admina.
 */
const TARGETS: Record<string, string[]> = {
  "account-link": [`${WIDGET_DIR}AccountMenuWidget.tsx`],
  "search-button": [`${WIDGET_DIR}SearchButtonWidget.tsx`],
  "post-list": [`${WIDGET_DIR}PostListView.tsx`, "/src/components/archive/ArchivePostList.tsx"],
  // `carousel` renderuje TEN SAM moduł co `post-list` (WidgetView przekazuje
  // tylko `carousel`), więc dzieli z nim chunk i hint.
  carousel: [`${WIDGET_DIR}PostListView.tsx`, "/src/components/archive/ArchivePostList.tsx"],
  slider: [`${WIDGET_DIR}PostsSliderWidget.tsx`, "/src/lib/builder/sliderVariants.tsx"],
  "image-slider": ["/src/lib/builder/sliderVariants.tsx"],
  text: [`${WIDGET_DIR}RichHtmlView.tsx`],
  "rich-text": [`${WIDGET_DIR}RichTextView.tsx`, `${WIDGET_DIR}RichHtmlView.tsx`],
  "section-label": ["/src/lib/builder/sectionLabelVariants.tsx"],
  // --- 2026-09-20: typy nad zgięciem stron publicznych -----------------------
  // Pasek newsów i „na czasie": chrome strony głównej, oba nad zgięciem.
  "news-ticker": [`${WIDGET_DIR}NewsTickerView.tsx`],
  "trending-now": [`${WIDGET_DIR}TrendingNowView.tsx`],
  // Strony wydarzeń: lista i prelegenci to ich pierwszy ekran.
  "event-list": [`${WIDGET_DIR}EventsListView.tsx`],
  speakers: [`${WIDGET_DIR}SpeakersWidget.tsx`],
  // Licznik: animacja startuje przy wejściu w viewport, więc chunk musi być
  // na miejscu, zanim czytelnik do niego dojedzie.
  counter: [`${WIDGET_DIR}CounterWidget.tsx`],
  tabs: [`${WIDGET_DIR}TabsBlock.tsx`],
  // `pricing` ciągnie ten moduł tylko w trybie `source: "plans"`; wariant
  // z ręcznymi kartami rysuje się inline. Hint jest więc czasem nadmiarowy -
  // tak samo jak `slider` bez źródła z wpisów, który ma już swój wyjątek
  // w `widgetPreloadHeaders`.
  pricing: [`${WIDGET_DIR}PricingPlansView.tsx`],
  "rated-list": [`${WIDGET_DIR}RatedListView.tsx`],
  "world-map": [`${WIDGET_DIR}WorldMapWidget.tsx`],
  // Jedyny leniwy wariant nagłówka (typ `heading` zostaje eager - patrz wyżej).
  "animated-heading": ["/src/lib/builder/animatedHeadingVariants.tsx"],
};

/** Wyłącznie dla testu wtyczki: kontrakt typ -> moduły bez uruchamiania builda. */
export const WIDGET_CHUNK_TARGETS: Readonly<Record<string, readonly string[]>> = TARGETS;

/** Discover the exact assets of this deployment, including nested lazy renderers. */
export function widgetChunkPlugin(): Plugin {
  const discovered: Record<string, string[]> = {};
  return {
    name: "nes:widget-chunks",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith("/src/lib/seo/widgetPreloads.ts")) return null;
      if (!Object.keys(discovered).length) return null;
      const placeholder = /(WIDGET_CHUNK_URLS\s*:[^=]+?=\s*)\{\}/;
      if (!placeholder.test(code)) this.error("Missing WIDGET_CHUNK_URLS placeholder");
      return {
        code: code.replace(
          placeholder,
          (_, declaration) => declaration + JSON.stringify(discovered),
        ),
        map: null,
      };
    },
    generateBundle(options, bundle) {
      if (!/client|public/.test(options.dir ?? "")) return;
      for (const [type, suffixes] of Object.entries(TARGETS)) {
        const urls = new Set<string>();
        for (const suffix of suffixes) {
          for (const output of Object.values(bundle)) {
            if (output.type !== "chunk" || output.isEntry) continue;
            if (
              Object.keys(output.modules).some((id) => id.replaceAll("\\", "/").endsWith(suffix))
            ) {
              urls.add(`/${output.fileName}`);
            }
          }
        }
        discovered[type] = [...urls];
      }
    },
  };
}
