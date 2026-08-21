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

import {
  legacyLookupSlug,
  needsTaxonomyLookup,
  planPublicPath,
  resolveMissingContent,
  resolveTaxonomyFallback,
  segmentsToPath,
  TAXONOMY_ROUTE,
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
