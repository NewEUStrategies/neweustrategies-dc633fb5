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

/**
 * Wszystkie sufiksy modułów z `TARGETS`, bez powtórzeń. `generateBundle`
 * normalizuje id każdego modułu RAZ i porównuje je z tą listą - wcześniej
 * pętla szła typ -> sufiks -> chunk -> moduł i powtarzała `replaceAll` dla
 * każdego id tyle razy, ile wpisów ma mapa (z powtórzeniami: `post-list`
 * i `carousel` dzielą moduły, `slider` i `image-slider` też). Kolejność
 * adresów w wyniku jest ta sama co przedtem: sufiksy w kolejności z `TARGETS`,
 * chunki w kolejności bundla.
 */
const ALL_SUFFIXES = [...new Set(Object.values(TARGETS).flat())];

const TARGET_MODULE = "/src/lib/seo/widgetPreloads.ts";

/** Kształt środowiska Vite, z którego korzysta wtyczka (reszta nas nie dotyczy). */
type BuildEnvironmentLike = { config: { consumer?: string; base?: string } };

/**
 * Środowisko builda z kontekstu hooka. W prawdziwym buildzie Vite 6+ wstrzykuje
 * `this.environment` do każdego hooka Rollupa; w teście jednostkowym hooki są
 * wołane bez niego - wtedy zwracamy `undefined` i wtyczka wraca do heurystyki
 * po katalogu wyjściowym.
 */
function environmentOf(ctx: unknown): BuildEnvironmentLike | undefined {
  const env = (ctx as { environment?: BuildEnvironmentLike } | null | undefined)?.environment;
  return env && typeof env === "object" && env.config ? env : undefined;
}

/**
 * Czy ten `generateBundle` należy do bundla PRZEGLĄDARKI. Rozstrzyga
 * `consumer` środowiska, nie nazwa katalogu: heurystyka `/client|public/`
 * na ABSOLUTNEJ ścieżce `options.dir` łapała też katalog serwera, gdy
 * w ścieżce repozytorium stało słowo `public`/`client`, i gubiła klienta,
 * gdy `outDir` nazywał się inaczej (np. `dist/browser`). Heurystyka zostaje
 * wyłącznie jako zapas dla wywołań bez środowiska.
 */
function isClientBundle(ctx: unknown, dir: string | undefined): boolean {
  const env = environmentOf(ctx);
  if (env) return env.config.consumer === "client";
  return /client|public/.test(dir ?? "");
}

/**
 * Prefiks adresu chunku. Nagłówek `Link` musi nieść adres BEZWZGLĘDNY,
 * a chunki leżą pod `base` z konfiguracji - na sztywno wpisane `/` dawało
 * martwe hinty przy `base: "/app/"`. Baza względna (`./`, `""`) nie ma sensu
 * dla odpowiedzi SSR, więc wtedy zostaje korzeń domeny.
 */
function publicBase(base: string | undefined): string {
  if (!base || !(base.startsWith("/") || /^https?:\/\//.test(base))) return "/";
  return base.endsWith("/") ? base : `${base}/`;
}

/** Discover the exact assets of this deployment, including nested lazy renderers. */
export function widgetChunkPlugin(): Plugin {
  /**
   * Nazwy zapisane przez `generateBundle` PRZEGLĄDARKI, czytane przez
   * `transform` SERWERA. Działa tylko dlatego, że oba środowiska dzielą JEDNĄ
   * instancję wtyczki (TanStack Start: `builder.sharedPlugins: true`, nitro:
   * `builder.sharedConfigBuild: true`) i klient buduje się PRZED serwerem
   * (`buildStartViteEnvironments`). Dowód na prawdziwym buildzie:
   * `widgetChunkPluginBuild.test.ts`.
   */
  const discovered: Record<string, string[]> = {};
  return {
    name: "nes:widget-chunks",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith(TARGET_MODULE)) return null;
      const env = environmentOf(this);
      const serverSide = env !== undefined && env.config.consumer !== "client";
      if (!Object.keys(discovered).length) {
        // W bundlu PRZEGLĄDARKI to stan oczekiwany: nazwy powstają dopiero
        // w jego własnym `generateBundle`, a klient tej mapy nie czyta (nagłówek
        // `Link` jest wyłącznie serwerowy). W buildzie SERWERA znaczy to, że
        // klient nie zbudował się przed nim (inna kolejność środowisk, osobne
        // instancje wtyczki) - placeholder `{}` pojedzie na produkcję i hintów
        // nie będzie. Nie blokujemy wdrożenia o hint wydajnościowy, ale mówimy
        // to GŁOŚNO, zamiast milczeć.
        if (serverSide) {
          this.warn(
            "nes:widget-chunks - brak nazw chunków przeglądarki w buildzie serwera; " +
              "WIDGET_CHUNK_URLS zostaje puste i hinty modulepreload widgetów NIE zostaną wysłane",
          );
        }
        return null;
      }
      const placeholder = /(WIDGET_CHUNK_URLS\s*:[^=]+?=\s*)\{\}/;
      if (!placeholder.test(code)) this.error("Missing WIDGET_CHUNK_URLS placeholder");
      if (serverSide && Object.values(discovered).every((urls) => urls.length === 0)) {
        // Mapa jest, ale ŻADEN typ nie trafił w żaden chunk (wszystkie widgety
        // wciągnięte do chunku wejściowego, zmiana kształtu id modułów) - ten sam
        // efekt co brak podmiany, więc ten sam głośny sygnał.
        this.warn(
          "nes:widget-chunks - żaden typ widgetu nie dostał chunku; hinty modulepreload NIE zostaną wysłane",
        );
      }
      return {
        code: code.replace(
          placeholder,
          (_, declaration) => declaration + JSON.stringify(discovered),
        ),
        map: null,
      };
    },
    generateBundle(options, bundle) {
      if (!isClientBundle(this, options.dir)) return;
      const prefix = publicBase(environmentOf(this)?.config.base);
      // Jedno przejście po bundlu: sufiks -> adresy chunków w kolejności bundla.
      const urlsBySuffix = new Map<string, string[]>(ALL_SUFFIXES.map((s) => [s, []]));
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk" || output.isEntry) continue;
        const url = `${prefix}${output.fileName}`;
        for (const moduleId of Object.keys(output.modules)) {
          const normalized = moduleId.replaceAll("\\", "/");
          for (const [suffix, urls] of urlsBySuffix) {
            if (normalized.endsWith(suffix) && !urls.includes(url)) urls.push(url);
          }
        }
      }
      for (const [type, suffixes] of Object.entries(TARGETS)) {
        discovered[type] = [
          ...new Set(suffixes.flatMap((suffix) => urlsBySuffix.get(suffix) ?? [])),
        ];
      }
    },
  };
}
