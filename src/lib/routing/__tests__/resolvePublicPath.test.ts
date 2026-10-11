// Gramatyka adresów publicznych - tabela przypadków.
//
// CO TO DOWODZI. `src/routes/$.tsx` rozwiązuje KAŻDY publiczny adres, który nie
// trafił w trasę statyczną. Jego loader miał 0% pokrycia i zero wykonanych
// funkcji, a decyzje (404 / archiwum taksonomii / 301 kanoniczny / treść) były
// wplecione między nagłówki cache, budżety SSR i prefetche. Ten plik sprawdza
// te decyzje jako czyste funkcje: KAŻDA gałąź gramatyki dostaje przypadek,
// razem z tymi, których w produkcji nikt nie wywoła ręcznie - pętla
// przekierowań i adres jednoznakowy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * `splatToSegments` i `metaDescription` mają własny plik
//     (`src/lib/routing/publicSegments.test.ts`) - tu sprawdzamy tylko to, co
//     gramatyka Z NICH ROBI, a nie ich samych;
//   * kolizji „slug strony równy slugowi wpisu" NIE rozstrzyga TypeScript,
//     tylko funkcja SQL `resolve_path(_segments)` (zwraca `page_id`/`post_id`).
//     Dowód należy do pgTAP-a; ten moduł dostaje wynik z zewnątrz i nie próbuje
//     go odtwarzać - stąd brak przypadku „kolizja" w tabelach niżej;
//   * sklejenia trasy (czy loader FAKTYCZNIE woła te funkcje i czy zamienia
//     deskryptor na `notFound()`/`redirect()`) dowodzi
//     `src/routes/__tests__/publicResolverRoute.test.tsx` - render, nie tabela.
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { configuredHomepagePageId, type HomepageCandidatePage } from "@/lib/seo/homepagePage";

import {
  FEED_ROUTE,
  homepageCandidate,
  legacyLookupSlug,
  needsTaxonomyLookup,
  planHomepageDuplicate,
  planPublicPath,
  readingSettingsFrom,
  resolveHomepageDuplicate,
  resolveMissingContent,
  resolveTaxonomyFallback,
  segmentsToPath,
  TAXONOMY_ROUTE,
  wordpressFeedLocation,
  type FeedRedirect,
  type MissingContentDecision,
  type PublicPathPlan,
} from "../resolvePublicPath";

describe("planPublicPath - co wynika z samego adresu", () => {
  const cases: ReadonlyArray<{
    nazwa: string;
    splat: string | null | undefined;
    oczekiwane: PublicPathPlan;
  }> = [
    // ── ADRESY BEZ TREŚCI ────────────────────────────────────────────────
    {
      nazwa: "adres pusty",
      splat: "",
      oczekiwane: { kind: "not-found", reason: "empty-path" },
    },
    {
      nazwa: "brak splatu (parametr nieustawiony)",
      splat: undefined,
      oczekiwane: { kind: "not-found", reason: "empty-path" },
    },
    {
      nazwa: "splat null",
      splat: null,
      oczekiwane: { kind: "not-found", reason: "empty-path" },
    },
    {
      nazwa: "sam ukośnik",
      splat: "/",
      oczekiwane: { kind: "not-found", reason: "empty-path" },
    },
    {
      nazwa: "same ukośniki",
      splat: "///",
      oczekiwane: { kind: "not-found", reason: "empty-path" },
    },
    // ── STRONY ───────────────────────────────────────────────────────────
    {
      nazwa: "strona jednopoziomowa",
      splat: "o-nas",
      oczekiwane: { kind: "lookup", segments: ["o-nas"] },
    },
    {
      nazwa: "ścieżka o jednym znaku",
      splat: "a",
      oczekiwane: { kind: "lookup", segments: ["a"] },
    },
    {
      nazwa: "ścieżka dwupoziomowa",
      splat: "analizy/energetyka",
      oczekiwane: { kind: "lookup", segments: ["analizy", "energetyka"] },
    },
    {
      nazwa: "ścieżka trzypoziomowa",
      splat: "analizy/energetyka/atom",
      oczekiwane: { kind: "lookup", segments: ["analizy", "energetyka", "atom"] },
    },
    {
      nazwa: "ukośnik na końcu nie tworzy pustego segmentu",
      splat: "analizy/energetyka/",
      oczekiwane: { kind: "lookup", segments: ["analizy", "energetyka"] },
    },
    {
      nazwa: "podwójny ukośnik w środku",
      splat: "analizy//energetyka",
      oczekiwane: { kind: "lookup", segments: ["analizy", "energetyka"] },
    },
    {
      nazwa: "ukośnik na początku",
      splat: "/analizy",
      oczekiwane: { kind: "lookup", segments: ["analizy"] },
    },
    {
      nazwa: "wielkie litery zachowane - kanonizacją zajmuje się baza, nie gramatyka",
      splat: "Analizy/Energetyka",
      oczekiwane: { kind: "lookup", segments: ["Analizy", "Energetyka"] },
    },
    {
      nazwa: "polskie diakrytyki przechodzą bez zmian",
      splat: "śledztwa/wyzwania-gospodarcze",
      oczekiwane: { kind: "lookup", segments: ["śledztwa", "wyzwania-gospodarcze"] },
    },
    {
      nazwa: "znaki procentowo kodowane NIE są dekodowane na tym poziomie",
      // Dekodowanie robi router przed wejściem w loader; gramatyka nie może
      // dekodować drugi raz, bo `%2F` zamieniłoby się w separator segmentów
      // i jeden segment rozpadłby się na dwa.
      splat: "%C5%9Bledztwa/atom",
      oczekiwane: { kind: "lookup", segments: ["%C5%9Bledztwa", "atom"] },
    },
    // ── STARE HIERARCHICZNE ADRESY TAKSONOMII ────────────────────────────
    {
      nazwa: "hierarchiczny adres kategorii zwija się do formy płaskiej",
      splat: "category/region/afryka",
      oczekiwane: {
        kind: "taxonomy-redirect",
        taxonomy: "category",
        slug: "afryka",
        replace: true,
        statusCode: 301,
        reason: "legacy-hierarchical-taxonomy",
      },
    },
    {
      nazwa: "hierarchiczny adres tagu zwija się do formy płaskiej",
      splat: "tag/foo/bar",
      oczekiwane: {
        kind: "taxonomy-redirect",
        taxonomy: "tag",
        slug: "bar",
        replace: true,
        statusCode: 301,
        reason: "legacy-hierarchical-taxonomy",
      },
    },
    {
      nazwa: "dwa segmenty to już wystarczający powód do zwinięcia",
      splat: "category/afryka",
      oczekiwane: {
        kind: "taxonomy-redirect",
        taxonomy: "category",
        slug: "afryka",
        replace: true,
        statusCode: 301,
        reason: "legacy-hierarchical-taxonomy",
      },
    },
    {
      nazwa: "GOŁE `category` bez slugu NIE jest przekierowaniem - idzie do rezolucji treści",
      // Bez tego wyjątku strona o slugu `category` byłaby nieosiągalna, a
      // przekierowanie leciałoby na `/category/category`.
      splat: "category",
      oczekiwane: { kind: "lookup", segments: ["category"] },
    },
    {
      nazwa: "GOŁE `tag` bez slugu NIE jest przekierowaniem",
      splat: "tag",
      oczekiwane: { kind: "lookup", segments: ["tag"] },
    },
    {
      nazwa: "prefiks taksonomii liczy się tylko na PIERWSZEJ pozycji",
      splat: "analizy/category/afryka",
      oczekiwane: { kind: "lookup", segments: ["analizy", "category", "afryka"] },
    },
    {
      nazwa: "prefiks musi być dokładny - `categories` to nie `category`",
      splat: "categories/afryka",
      oczekiwane: { kind: "lookup", segments: ["categories", "afryka"] },
    },
    {
      nazwa: "ukośniki nie omijają reguły taksonomii",
      splat: "/category//region/afryka/",
      oczekiwane: {
        kind: "taxonomy-redirect",
        taxonomy: "category",
        slug: "afryka",
        replace: true,
        statusCode: 301,
        reason: "legacy-hierarchical-taxonomy",
      },
    },
  ];

  it.each(cases)("$nazwa", ({ splat, oczekiwane }) => {
    expect(planPublicPath(splat)).toEqual(oczekiwane);
  });

  it("trasy archiwów są dokładnie tymi wzorcami, co w drzewie tras", () => {
    // Literał ścieżki musi się zgadzać z `routeTree.gen.ts`, inaczej redirect
    // leci na trasę, która nie istnieje - i użytkownik dostaje 404 zamiast
    // archiwum.
    expect(TAXONOMY_ROUTE).toEqual({ category: "/category/$slug", tag: "/tag/$slug" });
  });
});

describe("planPublicPath - stare kanały WordPressa (audyt 2026-10)", () => {
  // Do 2026-10 `/category/<slug>/feed/` szło regułą hierarchiczną: OSTATNI
  // segment (`feed`) był brany za slug, więc czytnik subskrybujący kanał
  // kategorii z czasów WordPressa lądował na `/category/feed` - czyli na 404.
  const site: FeedRedirect = {
    kind: "feed-redirect",
    scope: "site",
    statusCode: 301,
    reason: "legacy-wordpress-feed",
  };
  const kanalKategorii = (slug: string): FeedRedirect => ({
    kind: "feed-redirect",
    scope: "category",
    slug,
    statusCode: 301,
    reason: "legacy-wordpress-feed",
  });
  const kanalTagu = (slug: string): FeedRedirect => ({
    kind: "feed-redirect",
    scope: "tag",
    slug,
    statusCode: 301,
    reason: "legacy-wordpress-feed",
  });

  const cases: ReadonlyArray<{ nazwa: string; splat: string; oczekiwane: PublicPathPlan }> = [
    {
      nazwa:
        "kanał kategorii `/category/<slug>/feed/` -> kanał tej kategorii, nie `/category/feed`",
      splat: "category/afryka/feed/",
      oczekiwane: kanalKategorii("afryka"),
    },
    {
      nazwa: "kanał kategorii w formacie rss2",
      splat: "category/afryka/feed/rss2",
      oczekiwane: kanalKategorii("afryka"),
    },
    {
      nazwa: "kanał kategorii w formacie atom - jedyny kanał aplikacji to RSS 2.0",
      splat: "category/afryka/feed/atom/",
      oczekiwane: kanalKategorii("afryka"),
    },
    {
      nazwa: "kanał podkategorii z hierarchicznego adresu bierze slug sprzed sufiksu",
      splat: "category/region/afryka/feed",
      oczekiwane: kanalKategorii("afryka"),
    },
    {
      nazwa: "kanał tagu `/tag/<slug>/feed/`",
      splat: "tag/nato/feed/",
      oczekiwane: kanalTagu("nato"),
    },
    {
      nazwa: "kanał tagu w formacie rss",
      splat: "tag/nato/feed/rss",
      oczekiwane: kanalTagu("nato"),
    },
    {
      nazwa: "kanał serwisu `/feed/rss2` (trasa `feed.ts` łapie tylko goły `/feed`)",
      splat: "feed/rss2",
      oczekiwane: site,
    },
    {
      nazwa: "kanał serwisu `/feed/atom/`",
      splat: "feed/atom/",
      oczekiwane: site,
    },
    {
      nazwa: "kanał serwisu `/feed/rdf`",
      splat: "feed/rdf",
      oczekiwane: site,
    },
    {
      nazwa: "goły `/feed`, gdyby ominął trasę statyczną, to też kanał serwisu",
      splat: "feed",
      oczekiwane: site,
    },
    // ── `feed` JAKO FORMAT (`feed/feed`) - recenzja 2026-10 ─────────────
    // Pierwsza wersja brała zawsze krótszy sufiks, więc `feed/feed` zjadało
    // tylko ostatni segment, a drugi `feed` stawał się slugiem.
    {
      nazwa: "kanał serwisu `/feed/feed/` (format `feed`), nie zwykła rezolucja",
      splat: "feed/feed/",
      oczekiwane: site,
    },
    {
      nazwa: "kanał kategorii `/category/<slug>/feed/feed` bierze slug sprzed `feed/feed`",
      splat: "category/afryka/feed/feed",
      oczekiwane: kanalKategorii("afryka"),
    },
    {
      nazwa: "kanał podkategorii `/category/region/afryka/feed/feed/`",
      splat: "category/region/afryka/feed/feed/",
      oczekiwane: kanalKategorii("afryka"),
    },
    {
      nazwa: "`/category/feed/feed` to kanał kategorii `feed` - jak w regułach WordPressa",
      // Przed `feed/feed` nie zostaje slug, więc ostatni `feed` jest goły
      // sufiksem, a slugiem - środkowy `feed`.
      splat: "category/feed/feed",
      oczekiwane: kanalKategorii("feed"),
    },
    {
      nazwa: "kanał tagu o slugu `feed` w formacie atom",
      splat: "tag/feed/feed/atom",
      oczekiwane: kanalTagu("feed"),
    },
    // ── TO, CO KANAŁEM NIE JEST ─────────────────────────────────────────
    {
      nazwa: "`/category/feed` to archiwum o slugu `feed`, nie kanał - jak dotąd",
      splat: "category/feed",
      oczekiwane: {
        kind: "taxonomy-redirect",
        taxonomy: "category",
        slug: "feed",
        replace: true,
        statusCode: 301,
        reason: "legacy-hierarchical-taxonomy",
      },
    },
    {
      nazwa: "goły format bez `feed/` NIE jest kanałem - `atom` to tu prawdziwy temat",
      // WordPress czytał `/category/energetyka/atom` jako kanał Atom kategorii
      // `energetyka`. Tu to hierarchiczny adres podkategorii `atom`
      // (energetyka jądrowa) i ma dalej prowadzić do jej archiwum.
      splat: "category/energetyka/atom",
      oczekiwane: {
        kind: "taxonomy-redirect",
        taxonomy: "category",
        slug: "atom",
        replace: true,
        statusCode: 301,
        reason: "legacy-hierarchical-taxonomy",
      },
    },
    {
      nazwa: "nieznany format po `feed/` zostaje regule hierarchicznej",
      splat: "category/afryka/feed/json",
      oczekiwane: {
        kind: "taxonomy-redirect",
        taxonomy: "category",
        slug: "json",
        replace: true,
        statusCode: 301,
        reason: "legacy-hierarchical-taxonomy",
      },
    },
    {
      nazwa: "`/<wpis>/feed/` (kanał komentarzy WordPressa) idzie do zwykłej rezolucji",
      splat: "analizy/slug-wpisu/feed",
      oczekiwane: { kind: "lookup", segments: ["analizy", "slug-wpisu", "feed"] },
    },
    {
      nazwa: "segment `feed` w środku ścieżki nie jest sufiksem kanału",
      splat: "feed/analizy/atom",
      oczekiwane: { kind: "lookup", segments: ["feed", "analizy", "atom"] },
    },
  ];

  it.each(cases)("$nazwa", ({ splat, oczekiwane }) => {
    expect(planPublicPath(splat)).toEqual(oczekiwane);
  });

  it("trasy kanałów istnieją w drzewie tras", () => {
    // Redirect na wzorzec, którego nie ma w `routeTree.gen.ts`, kończyłby się
    // 404 - czyli dokładnie tym, co ta reguła naprawia.
    expect(FEED_ROUTE).toEqual({
      site: "/rss.xml",
      category: "/category/$slug/rss.xml",
      tag: "/tag/$slug/rss.xml",
    });
    const routeTree = readFileSync(resolve(__dirname, "../../../routeTree.gen.ts"), "utf8");
    for (const path of Object.values(FEED_ROUTE)) {
      expect(routeTree).toContain(`'${path}': typeof`);
    }
  });
});

describe("needsTaxonomyLookup - kiedy warto zapłacić dwa zapytania", () => {
  it.each([
    { segments: [], oczekiwane: false },
    { segments: ["slug"], oczekiwane: true },
    { segments: ["a", "b"], oczekiwane: false },
    { segments: ["a", "b", "c"], oczekiwane: false },
  ])("$segments -> $oczekiwane", ({ segments, oczekiwane }) => {
    // Adres wielosegmentowy nie jest gołym slugiem archiwum, więc pytanie
    // o kategorię i tag byłoby kosztem bez zysku na KAŻDYM nietrafionym adresie.
    expect(needsTaxonomyLookup(segments)).toBe(oczekiwane);
  });
});

describe("legacyLookupSlug i segmentsToPath", () => {
  it.each([
    { segments: [], slug: "", path: "" },
    { segments: ["slug-wpisu"], slug: "slug-wpisu", path: "slug-wpisu" },
    {
      segments: ["stara-sekcja", "slug-wpisu"],
      slug: "slug-wpisu",
      path: "stara-sekcja/slug-wpisu",
    },
    { segments: ["a", "b", "c"], slug: "c", path: "a/b/c" },
  ])("$segments -> slug $slug, ścieżka $path", ({ segments, slug, path }) => {
    // Slug wpisu jest globalnie unikalny, więc OSTATNI segment wskazuje wpis
    // także wtedy, gdy rodzic w adresie jest nieaktualny.
    expect(legacyLookupSlug(segments)).toBe(slug);
    expect(segmentsToPath(segments)).toBe(path);
  });
});

describe("resolveMissingContent - decyzja, gdy treści nie ma", () => {
  const cases: ReadonlyArray<{
    nazwa: string;
    wejscie: Parameters<typeof resolveMissingContent>[0];
    oczekiwane: MissingContentDecision;
  }> = [
    // ── ARCHIWUM TAKSONOMII ──────────────────────────────────────────────
    {
      nazwa: "goły slug trafia w archiwum kategorii",
      wejscie: { segments: ["afryka"], categorySlug: "afryka" },
      oczekiwane: {
        kind: "taxonomy-redirect",
        taxonomy: "category",
        slug: "afryka",
        replace: true,
        statusCode: 301,
        reason: "bare-slug-is-taxonomy",
      },
    },
    {
      nazwa: "goły slug trafia w archiwum tagu",
      wejscie: { segments: ["atom"], tagSlug: "atom" },
      oczekiwane: {
        kind: "taxonomy-redirect",
        taxonomy: "tag",
        slug: "atom",
        replace: true,
        statusCode: 301,
        reason: "bare-slug-is-taxonomy",
      },
    },
    {
      nazwa: "slug istnieje i jako kategoria, i jako tag - wygrywa kategoria",
      wejscie: { segments: ["energia"], categorySlug: "energia", tagSlug: "energia" },
      oczekiwane: {
        kind: "taxonomy-redirect",
        taxonomy: "category",
        slug: "energia",
        replace: true,
        statusCode: 301,
        reason: "bare-slug-is-taxonomy",
      },
    },
    {
      nazwa: "taksonomia ma pierwszeństwo nad starym adresem wpisu",
      wejscie: { segments: ["afryka"], categorySlug: "afryka", legacyPostPath: "analizy/afryka" },
      oczekiwane: {
        kind: "taxonomy-redirect",
        taxonomy: "category",
        slug: "afryka",
        replace: true,
        statusCode: 301,
        reason: "bare-slug-is-taxonomy",
      },
    },
    {
      nazwa: "taksonomia NIE jest brana pod uwagę dla adresu wielosegmentowego",
      // Nawet gdyby wołający podał slugi, `/a/afryka` nie jest gołym slugiem.
      wejscie: { segments: ["a", "afryka"], categorySlug: "afryka", tagSlug: "afryka" },
      oczekiwane: { kind: "not-found", reason: "unresolvable" },
    },
    // ── 301 NA ADRES KANONICZNY WPISU ────────────────────────────────────
    {
      nazwa: "płaski adres poWordPressowy dostaje 301 na ścieżkę kanoniczną",
      wejscie: { segments: ["slug-wpisu"], legacyPostPath: "analizy/slug-wpisu" },
      oczekiwane: {
        kind: "canonical-redirect",
        splat: "analizy/slug-wpisu",
        statusCode: 301,
        reason: "legacy-post-path",
      },
    },
    {
      nazwa: "adres z NIEAKTUALNYM rodzicem dostaje 301 na aktualnego rodzica",
      wejscie: {
        segments: ["stara-sekcja", "slug-wpisu"],
        legacyPostPath: "analizy/slug-wpisu",
      },
      oczekiwane: {
        kind: "canonical-redirect",
        splat: "analizy/slug-wpisu",
        statusCode: 301,
        reason: "legacy-post-path",
      },
    },
    {
      nazwa: "slug wpisu istniejący pod INNYM rodzicem daje przekierowanie kanoniczne, nie 404",
      // To jest przypadek z zadania: `<ścieżka-strony>/<slug-wpisu>`, gdzie wpis
      // wisi pod innym rodzicem. Stan faktyczny kodu: 301 na adres kanoniczny.
      wejscie: {
        segments: ["inny-rodzic", "slug-wpisu"],
        legacyPostPath: "prawdziwy-rodzic/slug-wpisu",
      },
      oczekiwane: {
        kind: "canonical-redirect",
        splat: "prawdziwy-rodzic/slug-wpisu",
        statusCode: 301,
        reason: "legacy-post-path",
      },
    },
    // ── PĘTLE ODRZUCONE ──────────────────────────────────────────────────
    {
      nazwa: "ścieżka kanoniczna RÓWNA żądanej daje 404, nie pętlę przekierowań",
      // Wpis jest już pod właściwym adresem, a treści nie ma z innego powodu
      // (wersja robocza, usunięcie, brak dostępu). Przekierowanie tu byłoby
      // przekierowaniem na siebie samego.
      wejscie: { segments: ["analizy", "atom"], legacyPostPath: "analizy/atom" },
      oczekiwane: { kind: "not-found", reason: "self-redirect" },
    },
    {
      nazwa: "pętla na adresie jednosegmentowym też jest odrzucona",
      wejscie: { segments: ["atom"], legacyPostPath: "atom" },
      oczekiwane: { kind: "not-found", reason: "self-redirect" },
    },
    // ── 404 ──────────────────────────────────────────────────────────────
    {
      nazwa: "nic nie znalezione - 404",
      wejscie: { segments: ["nie-ma-takiej-strony"] },
      oczekiwane: { kind: "not-found", reason: "unresolvable" },
    },
    {
      nazwa: "wpis nieopublikowany: rezolucja zwraca null, stary adres też - 404",
      // Wersja robocza i wpis nieopublikowany nie mogą się rozwiązać dla gościa:
      // `resolveLegacyPostPath` filtruje `status = 'published'`, więc dla gościa
      // wraca `null` i decyzja jest ta sama co dla adresu nieistniejącego.
      wejscie: { segments: ["wersja-robocza"], legacyPostPath: null },
      oczekiwane: { kind: "not-found", reason: "unresolvable" },
    },
    {
      nazwa: "puste slugi taksonomii traktowane jak brak trafienia",
      wejscie: { segments: ["cos"], categorySlug: "", tagSlug: "" },
      oczekiwane: { kind: "not-found", reason: "unresolvable" },
    },
    {
      nazwa: "pusta ścieżka kanoniczna traktowana jak brak trafienia",
      wejscie: { segments: ["cos"], legacyPostPath: "" },
      oczekiwane: { kind: "not-found", reason: "unresolvable" },
    },
    {
      nazwa: "ścieżka trzypoziomowa: rodzic istnieje, dziecko nie",
      wejscie: { segments: ["analizy", "energetyka", "nie-ma"] },
      oczekiwane: { kind: "not-found", reason: "unresolvable" },
    },
  ];

  it.each(cases)("$nazwa", ({ wejscie, oczekiwane }) => {
    expect(resolveMissingContent(wejscie)).toEqual(oczekiwane);
  });
});

describe("resolveTaxonomyFallback - połowa decyzji, którą loader liczy pierwszą", () => {
  it("zwraca null, gdy adres nie jest gołym slugiem", () => {
    // Loader używa tego, żeby NIE płacić round-tripu po starym adresie wpisu,
    // gdy archiwum i tak wygra.
    expect(resolveTaxonomyFallback({ segments: ["a", "b"], categorySlug: "b" })).toBeNull();
  });

  it("zwraca null, gdy goły slug nie trafia w żadne archiwum", () => {
    expect(
      resolveTaxonomyFallback({ segments: ["cos"], categorySlug: null, tagSlug: null }),
    ).toBeNull();
  });

  it("jest tą samą decyzją, co pełna rezolucja - jedna implementacja", () => {
    // Gdyby loader liczył taksonomię inaczej niż pełna gramatyka, tabela wyżej
    // przestałaby opisywać zachowanie produkcyjne.
    const wejscie = { segments: ["afryka"], categorySlug: "afryka", tagSlug: null };
    expect(resolveTaxonomyFallback(wejscie)).toEqual(resolveMissingContent(wejscie));
  });
});

describe("strona główna pod własnym slugiem (audyt 2026-10)", () => {
  // Produkcja: `{ homepage_mode: "static_page", homepage_page_slug: "main" }`.
  // Strona `main` jest renderowana pod `/`, a `resolve_path` znajdował ją też
  // pod `/main` i `/en/main` - HTTP 200 z własnym kanonicznym adresem.
  const MAIN = "11111111-1111-4111-8111-111111111111";
  const HOME = "22222222-2222-4222-8222-222222222222";
  const OTHER = "33333333-3333-4333-8333-333333333333";
  const produkcja = { homepage_mode: "static_page", homepage_page_slug: "main" };
  const main = homepageCandidate(["main"], { id: MAIN, slug: "main" });
  const redirect = {
    kind: "homepage-redirect",
    statusCode: 301,
    reason: "configured-homepage-page",
  } as const;

  describe("homepageCandidate - rodzic z kształtu adresu", () => {
    it("strona z adresu jednosegmentowego jest stroną najwyższego poziomu", () => {
      expect(main).toEqual({ id: MAIN, slug: "main", parent_id: null });
    });

    it("strona z dłuższego adresu ma rodzica, nawet o tym samym slugu", () => {
      // `/o-nas/main` NIE jest stroną główną skonfigurowaną slugiem `main`:
      // reguła slugowa dotyczy wyłącznie stron najwyższego poziomu.
      const child = homepageCandidate(["o-nas", "main"], { id: OTHER, slug: "main" });
      expect(child.parent_id).not.toBeNull();
      expect(planHomepageDuplicate(produkcja, child)).toEqual({ kind: "not-homepage" });
    });
  });

  describe("readingSettingsFrom - ustawienia czytania z mapy serwisu", () => {
    it("czyta trzy pola ustawień czytania", () => {
      expect(readingSettingsFrom({ reading: { ...produkcja, posts_per_page: 10 } })).toEqual({
        homepage_mode: "static_page",
        homepage_page_id: undefined,
        homepage_page_slug: "main",
      });
    });

    it.each([
      { nazwa: "brak mapy", mapa: undefined },
      { nazwa: "mapa bez wpisu `reading`", mapa: { seo: {} } },
      { nazwa: "uszkodzony wpis `reading`", mapa: { reading: "static_page" } },
    ])("$nazwa daje `{}` - rezolucję historyczną, jak `fetchReadingSettings`", ({ mapa }) => {
      expect(readingSettingsFrom(mapa)).toEqual({});
    });
  });

  describe("planHomepageDuplicate - decyzja bez I/O", () => {
    it("produkcja: `/main` dostaje 301 na `/` BEZ zapytania o inne strony", () => {
      // Strona `home` miałaby niższy priorytet niż slug z ustawień, więc jej
      // istnienie niczego nie zmienia - zapytanie byłoby kosztem bez zysku.
      expect(planHomepageDuplicate(produkcja, main)).toEqual(redirect);
    });

    it("inna strona najwyższego poziomu NIE jest przekierowywana", () => {
      const onas = homepageCandidate(["o-nas"], { id: OTHER, slug: "o-nas" });
      expect(planHomepageDuplicate(produkcja, onas)).toEqual({ kind: "not-homepage" });
    });

    it("tryb `latest_posts` nie ma strony głównej - nic nie jest przekierowywane", () => {
      const reading = { homepage_mode: "latest_posts", homepage_page_slug: "main" };
      expect(planHomepageDuplicate(reading, main)).toEqual({ kind: "not-homepage" });
      const home = homepageCandidate(["home"], { id: HOME, slug: "home" });
      expect(planHomepageDuplicate(reading, home)).toEqual({ kind: "not-homepage" });
    });

    it("strona wskazana przez `homepage_page_id` dostaje 301 bez zapytań - także strona potomna", () => {
      const reading = { homepage_mode: "static_page", homepage_page_id: OTHER };
      const child = homepageCandidate(["sekcja", "start"], { id: OTHER, slug: "start" });
      expect(planHomepageDuplicate(reading, child)).toEqual(redirect);
    });

    it("bez ustawień czytania strona `home` jest stroną główną (fallback historyczny)", () => {
      const home = homepageCandidate(["home"], { id: HOME, slug: "home" });
      expect(planHomepageDuplicate({}, home)).toEqual(redirect);
      expect(planHomepageDuplicate({}, main)).toEqual({ kind: "not-homepage" });
    });

    it("slug z białymi znakami NIE wskazuje `main` - `/` też go nie przycina", () => {
      // Zapytanie `/` podaje slug do `.eq()` dosłownie i spada na `home`, więc
      // `/main` zostaje zwykłą stroną; 301 kierowałby na inną treść.
      const reading = { homepage_mode: "static_page", homepage_page_slug: "  main " };
      expect(planHomepageDuplicate(reading, main)).toEqual({ kind: "not-homepage" });
    });

    it("niespójne ustawienia (id i slug na różne strony) każą zapytać o stronę z id", () => {
      // Jeśli strona z `homepage_page_id` jest opublikowana, to ONA jest pod
      // `/`, a `/main` musi zostać zwykłą stroną - nie wolno jej przekierować.
      const reading = { ...produkcja, homepage_page_id: OTHER };
      expect(planHomepageDuplicate(reading, main)).toEqual({
        kind: "check-rivals",
        id: OTHER,
        rootSlugs: [],
      });
    });

    it("strona `home` przy ustawieniach wskazujących inną stronę pyta o tamtą", () => {
      const home = homepageCandidate(["home"], { id: HOME, slug: "home" });
      expect(planHomepageDuplicate(produkcja, home)).toEqual({
        kind: "check-rivals",
        id: null,
        rootSlugs: ["main"],
      });
    });
  });

  describe("resolveHomepageDuplicate - decyzja po zapytaniu o rywali", () => {
    const reading = { ...produkcja, homepage_page_id: OTHER };

    it("rywal z id opublikowany: `/main` zostaje zwykłą stroną", () => {
      const rival: HomepageCandidatePage = { id: OTHER, slug: "start", parent_id: null };
      expect(resolveHomepageDuplicate(reading, main, [rival])).toBeNull();
    });

    it("rywala brak (nieopublikowany albo usunięty): `/main` dostaje 301", () => {
      expect(resolveHomepageDuplicate(reading, main, [])).toEqual(redirect);
    });

    it("strona `home` przegrywa z opublikowaną stroną ze slugu ustawień", () => {
      const home = homepageCandidate(["home"], { id: HOME, slug: "home" });
      expect(resolveHomepageDuplicate(produkcja, home, [main])).toBeNull();
      expect(resolveHomepageDuplicate(produkcja, home, [])).toEqual(redirect);
    });
  });

  it("decyzja jest ZAWSZE zgodna z `configuredHomepagePageId` na pełnej liście stron", () => {
    // Kolejność priorytetów żyje w jednym miejscu (helper - lustro
    // `homePageQueryOptions`). Ten przegląd sprawdza, że plan + rywale nie
    // wymyślają własnej: dla każdej kombinacji ustawień i opublikowanych stron
    // przekierowanie pada DOKŁADNIE wtedy, gdy helper wybiera tę stronę.
    const strony: HomepageCandidatePage[] = [
      { id: MAIN, slug: "main", parent_id: null },
      { id: HOME, slug: "home", parent_id: null },
      { id: OTHER, slug: "start", parent_id: MAIN },
    ];
    const ustawienia = [
      {},
      produkcja,
      { homepage_mode: "latest_posts" },
      { homepage_mode: "static_page" },
      { homepage_mode: "static_page", homepage_page_id: OTHER },
      { homepage_mode: "static_page", homepage_page_id: OTHER, homepage_page_slug: "main" },
      { homepage_mode: "static_page", homepage_page_id: "nie-ma", homepage_page_slug: "home" },
      { homepage_mode: "", homepage_page_slug: "main" },
    ];
    // Każdy podzbiór opublikowanych stron (2^3).
    const podzbiory = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) =>
      strony.filter((_, index) => (mask >> index) & 1),
    );
    for (const reading of ustawienia) {
      for (const opublikowane of podzbiory) {
        const oczekiwanaGlowna = configuredHomepagePageId(reading, opublikowane);
        for (const current of opublikowane) {
          const plan = planHomepageDuplicate(reading, current);
          let decyzja = plan.kind === "homepage-redirect" ? plan : null;
          if (plan.kind === "check-rivals") {
            // Atrapa zapytania z loadera: opublikowane strony pasujące do refów.
            const rywale = opublikowane.filter(
              (page) =>
                page.id === plan.id ||
                (page.parent_id === null && plan.rootSlugs.includes(page.slug)),
            );
            decyzja = resolveHomepageDuplicate(reading, current, rywale);
          }
          expect(
            decyzja !== null,
            `${JSON.stringify(reading)} / ${current.slug} / [${opublikowane.map((p) => p.slug)}]`,
          ).toBe(oczekiwanaGlowna === current.id);
        }
      }
    }
  });
});

describe("wordpressFeedLocation - jeden 301 przed routerem (bez 307 za ukośnik)", () => {
  it.each([
    ["/category/geopolityka/feed/", "/category/geopolityka/rss.xml"],
    ["/category/geopolityka/feed", "/category/geopolityka/rss.xml"],
    ["/category/region/afryka/feed/rss2/", "/category/afryka/rss.xml"],
    ["/tag/nato/feed/atom", "/tag/nato/rss.xml"],
    ["/feed/rss2/", "/rss.xml"],
    ["/en/category/geopolityka/feed/", "/en/category/geopolityka/rss.xml"],
    ["/en/feed/atom/", "/en/rss.xml"],
  ])("%s -> %s", (path, target) => {
    expect(wordpressFeedLocation(path)).toBe(target);
  });

  it.each([
    "/category/feed",
    "/category/feed/",
    "/analizy/wpis/feed/",
    "/category/energetyka/atom",
    "/blog",
    "/feedback",
    "/category/geopolityka",
  ])("%s nie jest kanałem do przekierowania", (path) => {
    expect(wordpressFeedLocation(path)).toBeNull();
  });

  it("slug jest kodowany od nowa - bez wstrzyknięcia separatora do adresu docelowego", () => {
    expect(wordpressFeedLocation("/category/%C5%BCycie/feed/")).toBe(
      "/category/%C5%BCycie/rss.xml",
    );
    expect(wordpressFeedLocation("/category/a%5Cb/feed/")).toBeNull();
    expect(wordpressFeedLocation("/category/%E0%A4%A/feed/")).toBeNull();
  });
});
