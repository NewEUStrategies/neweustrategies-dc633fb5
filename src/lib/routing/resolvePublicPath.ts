// Gramatyka adresów publicznych: decyzja „co znaczy ten adres" jako czysta
// funkcja, bez routera, bez Reacta i bez bazy.
//
// PO CO OSOBNY MODUŁ. `src/routes/$.tsx` rozwiązuje KAŻDY publiczny adres,
// który nie trafił w trasę statyczną - `/<slug-strony>`,
// `/<rodzic>/<dziecko>/...` i `/<ścieżka-strony>/<slug-wpisu>`. Decyzje
// (404 / przekierowanie taksonomii / 301 kanoniczny / treść) były wplecione
// w loader trasy o 1374 liniach, razem z nagłówkami cache, budżetami SSR
// i prefetchami. Nie dało się ich sprawdzić bez postawienia routera, klienta
// zapytań i bazy - więc nie były sprawdzone wcale.
//
// KSZTAŁT: DWIE FAZY, BO MIĘDZY NIMI SIEDZI I/O. Loader musi odpytać bazę
// dokładnie raz, i dopiero wynik tego zapytania rozstrzyga resztę. Dlatego
// gramatyka jest rozcięta w tym samym miejscu, w którym rozcięty jest loader:
//
//   1. `planPublicPath(splat)` - co da się rozstrzygnąć BEZ bazy: pusty adres,
//      stare kanały WordPressa (`/feed/atom`, `/category/<slug>/feed/`)
//      i zwinięcie starych hierarchicznych adresów taksonomii;
//   2. `resolveMissingContent(...)` - co robić, gdy zapytanie nie znalazło
//      treści: przekierowanie na archiwum, 301 na adres kanoniczny wpisu,
//      albo 404;
//   3. `planHomepageDuplicate(...)` / `resolveHomepageDuplicate(...)` - co
//      robić, gdy treść ZNALEZIONO, ale jest nią strona serwowana pod `/`
//      (301 na `/`, bo inaczej ta sama treść ma dwa adresy kanoniczne).
//
// Funkcje zwracają DESKRYPTOR DECYZJI, nie gotowy `redirect()`/`notFound()`.
// Rzucanie jest sprawą routera; tu ma być wartość, którą da się porównać
// w tabeli przypadków.
//
// CZEGO TEN MODUŁ NIE ROZSTRZYGA. Kolizji „slug strony równy slugowi wpisu"
// nie rozstrzyga TypeScript, tylko funkcja SQL `resolve_path(_segments)` -
// to ona zwraca `page_id`/`post_id`. Ten moduł dostaje wynik tej decyzji
// z zewnątrz i nie próbuje jej odtwarzać.
import {
  configuredHomepagePageId,
  LEGACY_HOMEPAGE_SLUG,
  type HomepageCandidatePage,
  type HomepageReadingSettings,
} from "@/lib/seo/homepagePage";
import { DEFAULT_LANG, localizedPath, stripLangPrefix } from "@/lib/i18n/localePath";
import { splatToSegments } from "./publicSegments";

/** Dwa archiwa taksonomii z własnymi trasami statycznymi. */
export type PublicTaxonomy = "category" | "tag";

/** Prefiksy starych, hierarchicznych adresów taksonomii. */
const TAXONOMY_PREFIXES: readonly PublicTaxonomy[] = ["category", "tag"];

/** Trasa archiwum dla taksonomii - dokładnie te wzorce są w drzewie tras. */
export const TAXONOMY_ROUTE: Readonly<Record<PublicTaxonomy, string>> = {
  category: "/category/$slug",
  tag: "/tag/$slug",
};

/** Przekierowanie na archiwum taksonomii. */
export interface TaxonomyRedirect {
  readonly kind: "taxonomy-redirect";
  readonly taxonomy: PublicTaxonomy;
  readonly slug: string;
  /**
   * `replace: true` - stary adres hierarchiczny nie ma zostać w historii
   * przeglądarki, bo „wstecz" wróciłoby na adres, który zaraz znów przekieruje.
   */
  readonly replace: true;
  /**
   * Stały adres archiwum - 301, nie domyślne 307 routera (przegląd 2026-10):
   * oba powody to trwała zmiana adresu, a 307 każe wyszukiwarce trzymać stary.
   */
  readonly statusCode: 301;
  readonly reason: "legacy-hierarchical-taxonomy" | "bare-slug-is-taxonomy";
}

/**
 * Trasy kanałów RSS - dokładnie te wzorce są w drzewie tras (`rss[.]xml.ts`,
 * `category.$slug.rss[.]xml.ts`, `tag.$slug.rss[.]xml.ts`).
 */
export const FEED_ROUTE = {
  site: "/rss.xml",
  category: "/category/$slug/rss.xml",
  tag: "/tag/$slug/rss.xml",
} as const;

/**
 * 301 ze starego adresu kanału WordPressa na kanał tej aplikacji.
 *
 * `scope: "site"` - kanał całego serwisu (`/rss.xml`); taksonomia - kanał
 * archiwum (`/category/<slug>/rss.xml`, `/tag/<slug>/rss.xml`). Prefiks języka
 * dokłada rewrite `output` routera (`src/router.tsx`), więc deskryptor go nie
 * niesie: `/en/category/x/feed` ląduje na `/en/category/x/rss.xml`.
 */
export type FeedRedirect =
  | {
      readonly kind: "feed-redirect";
      readonly scope: "site";
      readonly statusCode: 301;
      readonly reason: "legacy-wordpress-feed";
    }
  | {
      readonly kind: "feed-redirect";
      readonly scope: PublicTaxonomy;
      readonly slug: string;
      readonly statusCode: 301;
      readonly reason: "legacy-wordpress-feed";
    };

/** Segment, którym WordPress otwierał adres kanału (`.../feed/`). */
const WORDPRESS_FEED_SEGMENT = "feed";

/**
 * Formaty, które WordPress przyjmował PO `/feed/` (`feed/(feed|rdf|rss|rss2|atom)`
 * w jego regułach przepisywania). Wszystkie prowadzą u nas do jednego kanału
 * RSS 2.0 - innych formatów aplikacja nie wystawia.
 */
const WORDPRESS_FEED_FORMATS: ReadonlySet<string> = new Set(["feed", "rdf", "rss", "rss2", "atom"]);

/**
 * Długości sufiksu kanału WordPressa na KOŃCU adresu, do sprawdzenia w tej
 * kolejności: `feed/<format>` (2), potem goły `feed` (1); pusta lista - adres
 * nie jest kanałem.
 *
 * DWIE KANDYDATURY, NIE JEDNA (recenzja 2026-10). `feed` jest też FORMATEM
 * (`feed/feed`), więc adres kończący się na `feed` bywa obu kształtów naraz.
 * Pierwsza wersja brała zawsze krótszy sufiks: `/category/afryka/feed/feed`
 * dawało kanał kategorii `feed` (zamiast `afryka`), a `/feed/feed` nie było
 * kanałem wcale. WordPress próbował najpierw reguły `.../feed/<format>`
 * i dopiero gdy przed nią nie zostawał slug, czytał `feed` jako sam format
 * (`/category/feed/feed` = kanał kategorii `feed`) - ta sama kolejność tutaj.
 *
 * Goły format bez `feed/` (`/category/energetyka/atom`) świadomie NIE jest
 * kanałem, choć WordPress go tak czytał: slug `atom` jest w tym serwisie
 * prawdziwym tematem (energetyka jądrowa), a hierarchiczny adres podkategorii
 * `/category/energetyka/atom` ma dalej zwijać się do archiwum `atom`.
 */
function wordpressFeedSuffixLengths(segments: readonly string[]): readonly number[] {
  const last = segments.length - 1;
  const lengths: number[] = [];
  if (
    last >= 1 &&
    segments[last - 1] === WORDPRESS_FEED_SEGMENT &&
    WORDPRESS_FEED_FORMATS.has(segments[last])
  ) {
    lengths.push(2);
  }
  if (last >= 0 && segments[last] === WORDPRESS_FEED_SEGMENT) lengths.push(1);
  return lengths;
}

/**
 * Stary kanał WordPressa albo `null`. Wydzielone z `planPublicPath`, bo musi
 * biec PRZED zwinięciem hierarchicznych taksonomii - inaczej
 * `/category/afryka/feed/` zwijało się (OSTATNI segment) do `/category/feed`,
 * czyli do 404, a czytniki subskrybujące kanały kategorii z czasów WordPressa
 * (audyt 2026-10: wszystkie kanały kategorii) dostawały błąd zamiast kanału.
 */
function planWordpressFeed(segments: readonly string[]): FeedRedirect | null {
  for (const suffix of wordpressFeedSuffixLengths(segments)) {
    const feed = feedRedirectFor(segments.slice(0, segments.length - suffix));
    if (feed) return feed;
  }
  return null;
}

/** Kanał dla adresu BEZ sufiksu kanału (`rest`) albo `null`, gdy to nie kanał. */
function feedRedirectFor(rest: readonly string[]): FeedRedirect | null {
  if (rest.length === 0) {
    // `/feed/rss2`, `/feed/atom` (i goły `/feed`, gdyby ominął trasę `feed.ts`).
    return {
      kind: "feed-redirect",
      scope: "site",
      statusCode: 301,
      reason: "legacy-wordpress-feed",
    };
  }
  const [first] = rest;
  // Sam prefiks bez slugu (`/category/feed`) to NIE kanał, tylko archiwum
  // o slugu `feed` - zostaje regule hierarchicznej niżej, jak dotąd.
  if (rest.length >= 2 && isTaxonomyPrefix(first)) {
    return {
      kind: "feed-redirect",
      scope: first,
      // Ta sama reguła co przy zwijaniu: slugi taksonomii są globalnie
      // unikalne, więc OSTATNI segment przed sufiksem wskazuje archiwum.
      slug: rest[rest.length - 1],
      statusCode: 301,
      reason: "legacy-wordpress-feed",
    };
  }
  // `/<wpis>/feed/` (kanał komentarzy WordPressa) nie ma tu odpowiednika -
  // idzie do zwykłej rezolucji, jak każdy inny adres.
  return null;
}

/** Adres nie do rozwiązania - 404. */
/** Szybki filtr: adres kończy się sufiksem kanału WordPressa (`/feed`, `/feed/rss2`, z `/` lub bez). */
const WORDPRESS_FEED_SUFFIX = /\/feed(?:\/(?:feed|rdf|rss|rss2|atom))?\/?$/;

/**
 * Bezpieczny segment adresu docelowego: zdekodowany i zakodowany od nowa, bez
 * znaków, które przeglądarka mogłaby wziąć za separator (`\`).
 */
function feedSlugSegment(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!decoded || /[\\/]/.test(decoded)) return null;
  return encodeURIComponent(decoded);
}

/**
 * Adres docelowy 301 dla starego kanału WordPressa, liczony z SAMEJ ścieżki
 * żądania (bez bazy) - dla middleware PRZED routerem.
 *
 * PO CO (przegląd 2026-10). Adresy kanałów WordPressa kończą się ukośnikiem
 * (`/category/geopolityka/feed/`), a router normalizuje go odpowiedzią 307
 * ZANIM dojdzie do `$.tsx` - czytnik i crawler szły więc 307 -> 301, a 307
 * każe im trzymać stary adres. Middleware odpowiada jednym 301 na oba warianty.
 * Ta sama decyzja co `planPublicPath` (bez drugiej kopii reguł).
 */
export function wordpressFeedLocation(pathname: string): string | null {
  if (!WORDPRESS_FEED_SUFFIX.test(pathname)) return null;
  const { lang, pathname: bare } = stripLangPrefix(pathname);
  const plan = planPublicPath(bare);
  if (plan.kind !== "feed-redirect") return null;
  let target: string;
  if (plan.scope === "site") {
    target = FEED_ROUTE.site;
  } else {
    const slug = feedSlugSegment(plan.slug);
    if (!slug) return null;
    target = FEED_ROUTE[plan.scope].replace("$slug", slug);
  }
  return localizedPath(target, lang ?? DEFAULT_LANG);
}

export interface NotFoundDecision {
  readonly kind: "not-found";
  readonly reason: "empty-path" | "unresolvable" | "self-redirect";
}

/** Faza 1 nie rozstrzyga - trzeba odpytać bazę o treść dla tych segmentów. */
export interface LookupContent {
  readonly kind: "lookup";
  readonly segments: readonly string[];
}

export type PublicPathPlan = NotFoundDecision | FeedRedirect | TaxonomyRedirect | LookupContent;

/**
 * FAZA 1: co wynika z samego adresu.
 *
 * Kolejność reguł jest częścią kontraktu: adres pusty odpada przed
 * taksonomiami, bo `segments[0]` na pustej tablicy jest `undefined`; kanał
 * WordPressa przed zwinięciem taksonomii, bo zwinięcie bierze ostatni
 * segment, a w adresie kanału ostatnim segmentem jest `feed`.
 */
export function planPublicPath(splat: string | null | undefined): PublicPathPlan {
  const segments = splatToSegments(splat ?? "");
  if (segments.length === 0) {
    // Sam ukośnik, ukośniki i pusty splat - trasa `/` jest statyczna, więc
    // dotarcie tu z pustą ścieżką znaczy adres bez treści.
    return { kind: "not-found", reason: "empty-path" };
  }
  const feed = planWordpressFeed(segments);
  if (feed) return feed;
  // Stare adresy hierarchiczne: `/category/region/afryka`, `/tag/foo/bar`.
  // Slugi kategorii i tagów są globalnie unikalne, więc OSTATNI segment
  // zawsze wskazuje właściwe archiwum - zwijamy do formy płaskiej.
  const [first] = segments;
  if (segments.length >= 2 && isTaxonomyPrefix(first)) {
    return {
      kind: "taxonomy-redirect",
      taxonomy: first,
      slug: segments[segments.length - 1],
      replace: true,
      statusCode: 301,
      reason: "legacy-hierarchical-taxonomy",
    };
  }
  return { kind: "lookup", segments };
}

/** Strażnik zawężający segment do prefiksu taksonomii (bez rzutowania). */
function isTaxonomyPrefix(segment: string): segment is PublicTaxonomy {
  return (TAXONOMY_PREFIXES as readonly string[]).includes(segment);
}

/** 301 na adres kanoniczny wpisu (pełna ścieżka rodzica + slug). */
export interface CanonicalRedirect {
  readonly kind: "canonical-redirect";
  /** Wartość `_splat` docelowej trasy `/$`. */
  readonly splat: string;
  /** 301, nie 302 - stare adresy mają przekazać moc linków na nowy. */
  readonly statusCode: 301;
  readonly reason: "legacy-post-path";
}

export type MissingContentDecision = NotFoundDecision | TaxonomyRedirect | CanonicalRedirect;

/** Wyniki odpytań, które loader wykonuje, gdy treści nie ma. */
export interface MissingContentInput {
  readonly segments: readonly string[];
  /** Slug archiwum kategorii, jeśli goły slug w nie trafił. */
  readonly categorySlug?: string | null;
  /** Slug archiwum tagu, jeśli goły slug w nie trafił. */
  readonly tagSlug?: string | null;
  /** Kanoniczna ścieżka wpisu odnalezionego po OSTATNIM segmencie. */
  readonly legacyPostPath?: string | null;
}

/**
 * Czy warto w ogóle pytać o taksonomię. Zapytanie ma sens WYŁĄCZNIE dla adresu
 * jednosegmentowego: `/analizy/cos` nie jest gołym slugiem archiwum, a dwa
 * zapytania na każdy nietrafiony adres wielosegmentowy to koszt bez zysku.
 */
export function needsTaxonomyLookup(segments: readonly string[]): boolean {
  return segments.length === 1;
}

/**
 * Segment, po którym szukamy starego adresu wpisu. Slug wpisu jest globalnie
 * unikalny, więc OSTATNI segment wystarcza - również wtedy, gdy rodzic
 * w adresie jest nieaktualny (`/stara-sekcja/<slug>`).
 */
export function legacyLookupSlug(segments: readonly string[]): string {
  return segments.length === 0 ? "" : segments[segments.length - 1];
}

/** Ścieżka kanoniczna zapisana z segmentów - forma porównywalna z wynikiem bazy. */
export function segmentsToPath(segments: readonly string[]): string {
  return segments.join("/");
}

/**
 * FAZA 2a: goły slug wskazujący archiwum taksonomii.
 *
 * Wydzielone, bo loader MUSI móc rozstrzygnąć tę część PRZED zapłaceniem
 * round-tripu za stary adres wpisu - taksonomia ma pierwszeństwo, więc gdy
 * trafi, zapytanie o wpis jest kosztem bez zysku. Jedna implementacja: pełna
 * decyzja niżej woła tę samą funkcję.
 *
 * Kategoria przed tagiem: goły slug może istnieć w obu, a kolejność jest
 * kontraktem, nie przypadkiem.
 */
export function resolveTaxonomyFallback(
  input: Pick<MissingContentInput, "segments" | "categorySlug" | "tagSlug">,
): TaxonomyRedirect | null {
  if (!needsTaxonomyLookup(input.segments)) return null;
  if (input.categorySlug) {
    return {
      kind: "taxonomy-redirect",
      taxonomy: "category",
      slug: input.categorySlug,
      replace: true,
      statusCode: 301,
      reason: "bare-slug-is-taxonomy",
    };
  }
  if (input.tagSlug) {
    return {
      kind: "taxonomy-redirect",
      taxonomy: "tag",
      slug: input.tagSlug,
      replace: true,
      statusCode: 301,
      reason: "bare-slug-is-taxonomy",
    };
  }
  return null;
}

/**
 * FAZA 2: decyzja, gdy zapytanie o treść nic nie zwróciło.
 *
 * Kolejność reguł jest kontraktem i odtwarza kolejność z loadera:
 * archiwum taksonomii, potem 301 na adres kanoniczny wpisu, na końcu 404.
 */
export function resolveMissingContent(input: MissingContentInput): MissingContentDecision {
  const { segments } = input;
  const taxonomy = resolveTaxonomyFallback(input);
  if (taxonomy) return taxonomy;
  const canonical = input.legacyPostPath ?? null;
  if (canonical) {
    // PĘTLA ODRZUCONA: ścieżka kanoniczna równa żądanej znaczy, że wpis JUŻ
    // jest pod właściwym adresem, a treści nie ma z innego powodu (wersja
    // robocza, usunięcie, brak dostępu). Przekierowanie tu byłoby
    // przekierowaniem na siebie samego - nieskończona pętla w przeglądarce
    // i u crawlera. 404 jest jedyną poprawną odpowiedzią.
    if (canonical === segmentsToPath(segments)) {
      return { kind: "not-found", reason: "self-redirect" };
    }
    return {
      kind: "canonical-redirect",
      splat: canonical,
      statusCode: 301,
      reason: "legacy-post-path",
    };
  }
  return { kind: "not-found", reason: "unresolvable" };
}

/**
 * 301 ze ścieżki strony głównej na `/` (z prefiksem języka - dokłada go rewrite
 * `output` routera, jak przy każdym przekierowaniu tej trasy).
 */
export interface HomepageRedirect {
  readonly kind: "homepage-redirect";
  /** 301 - drugi adres tej samej treści ma oddać moc linków adresowi `/`. */
  readonly statusCode: 301;
  readonly reason: "configured-homepage-page";
}

/**
 * Strona o wyższym priorytecie w ustawieniach czytania MOŻE istnieć - trzeba
 * zapytać bazę, czy jest opublikowana, zanim przekierujemy rozwiązaną stronę.
 */
export interface HomepageRivalCheck {
  readonly kind: "check-rivals";
  /** `homepage_page_id`, jeśli wskazuje inną stronę niż rozwiązana. */
  readonly id: string | null;
  /** Slugi stron NAJWYŻSZEGO poziomu, które mogłyby ją wyprzedzić. */
  readonly rootSlugs: readonly string[];
}

export type HomepageDuplicatePlan =
  { readonly kind: "not-homepage" } | HomepageRedirect | HomepageRivalCheck;

const HOMEPAGE_REDIRECT: HomepageRedirect = {
  kind: "homepage-redirect",
  statusCode: 301,
  reason: "configured-homepage-page",
};

/**
 * Ustawienia czytania z mapy `site_settings` (zapytanie
 * `siteSettingsQueryOptions`). Brak wpisu albo wpis, który nie jest obiektem,
 * daje `{}` - ta sama reguła, co `fetchReadingSettings` w
 * `lib/queries/public.ts`, czyli rezolucja historyczna z fallbackiem `home`.
 * O tym, czy mapa w ogóle jest PRAWDZIWA (a nie zasiewem po awarii), decyduje
 * wołający - pusta mapa z awarii nie może tu udawać „ustawień nie zapisano".
 */
export function readingSettingsFrom(settings: unknown): HomepageReadingSettings {
  if (typeof settings !== "object" || settings === null || !("reading" in settings)) return {};
  const { reading } = settings;
  if (typeof reading !== "object" || reading === null) return {};
  return {
    homepage_mode: "homepage_mode" in reading ? reading.homepage_mode : undefined,
    homepage_page_id: "homepage_page_id" in reading ? reading.homepage_page_id : undefined,
    homepage_page_slug: "homepage_page_slug" in reading ? reading.homepage_page_slug : undefined,
  };
}

/**
 * Rozwiązana strona w kształcie wejścia `configuredHomepagePageId`.
 *
 * `parent_id` NIE pochodzi z wiersza (rezolucja go nie wybiera): helper czyta
 * wyłącznie `parent_id === null`, a to rozstrzyga sam adres - `resolve_path`
 * idzie od korzenia, więc strona z adresu jednosegmentowego JEST stroną
 * najwyższego poziomu, a z dłuższego ma rodzica. Ścieżka rodzica w polu jest
 * tylko niepustym znacznikiem „ma rodzica".
 */
export function homepageCandidate(
  segments: readonly string[],
  page: { readonly id: string; readonly slug: string },
): HomepageCandidatePage {
  return {
    id: page.id,
    slug: page.slug,
    parent_id: segments.length <= 1 ? null : segmentsToPath(segments.slice(0, -1)),
  };
}

/** Niepusty napis z ustawień - bez przycinania, jak w `configuredHomepagePageId`. */
function settingString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Czy strona `rival` (gdyby była opublikowana) odebrałaby `current` stronę główną. */
function outranks(
  reading: HomepageReadingSettings,
  current: HomepageCandidatePage,
  rival: HomepageCandidatePage,
): boolean {
  return configuredHomepagePageId(reading, [current, rival]) !== current.id;
}

/**
 * FAZA 3a: czy rozwiązana STRONA jest stroną serwowaną pod `/`.
 *
 * PO CO. Strona wskazana w ustawieniach czytania (produkcja: `main`) jest
 * renderowana pod `/`, ale zostaje zwykłym wierszem `pages`, więc odpowiadała
 * też pod `/main` i `/en/main` - HTTP 200 z WŁASNYM kanonicznym adresem
 * (audyt 2026-10). Google dostawał dwie kopie strony głównej.
 *
 * KOLEJNOŚĆ PRIORYTETÓW NIE JEST TU PRZEPISANA. Decyduje
 * `configuredHomepagePageId` (lustro `homePageQueryOptions`), a ta funkcja
 * pyta go dwa razy: (1) czy rozwiązana strona w ogóle pasuje do którejś
 * reguły - jeśli nie, to nie jest strona główna niezależnie od reszty bazy;
 * (2) czy hipotetyczna strona z wyższej reguły (`homepage_page_id`, slug
 * z ustawień, `home`) by ją wyprzedziła. Tylko wtedy loader płaci zapytanie
 * o te strony (`check-rivals`) - przy spójnych ustawieniach produkcji
 * (`static_page` + slug `main`) decyzja zapada bez I/O.
 */
export function planHomepageDuplicate(
  reading: HomepageReadingSettings,
  current: HomepageCandidatePage,
): HomepageDuplicatePlan {
  if (configuredHomepagePageId(reading, [current]) !== current.id) {
    return { kind: "not-homepage" };
  }
  const configuredId = settingString(reading.homepage_page_id);
  // Hipotetyczna strona po id: slug pusty i niepusty rodzic, żeby nie pasowała
  // do żadnej reguły slugowej - liczy się wyłącznie jej id.
  const id =
    configuredId !== null &&
    configuredId !== current.id &&
    outranks(reading, current, { id: configuredId, slug: "", parent_id: configuredId })
      ? configuredId
      : null;
  const rootSlugs: string[] = [];
  const slugs = new Set([settingString(reading.homepage_page_slug), LEGACY_HOMEPAGE_SLUG]);
  for (const slug of slugs) {
    if (slug === null) continue;
    // Sama rozwiązana strona nie jest swoim rywalem.
    if (current.parent_id === null && current.slug === slug) continue;
    // Id spoza przestrzeni UUID - nie zderzy się z `homepage_page_id`.
    const rival: HomepageCandidatePage = { id: `\u0000slug:${slug}`, slug, parent_id: null };
    if (outranks(reading, current, rival)) rootSlugs.push(slug);
  }
  if (id === null && rootSlugs.length === 0) return HOMEPAGE_REDIRECT;
  return { kind: "check-rivals", id, rootSlugs };
}

/**
 * FAZA 3b: decyzja po zapytaniu o rywali z `HomepageRivalCheck`.
 *
 * `rivals` to strony OPUBLIKOWANE i nieusunięte (jak w zapytaniu `/`) - ta
 * sama lista, którą `configuredHomepagePageId` dostałby od mapy serwisu.
 */
export function resolveHomepageDuplicate(
  reading: HomepageReadingSettings,
  current: HomepageCandidatePage,
  rivals: readonly HomepageCandidatePage[],
): HomepageRedirect | null {
  const pages = [current, ...rivals.filter((page) => page.id !== current.id)];
  return configuredHomepagePageId(reading, pages) === current.id ? HOMEPAGE_REDIRECT : null;
}
