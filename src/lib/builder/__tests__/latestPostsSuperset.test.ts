// @vitest-environment node
//
// NADZBIÓR NAJNOWSZYCH WPISÓW (`lib/builder/latestPostsSuperset.ts`) - co
// dowodzi ten plik.
//
// 1. LICZBA ROUND-TRIPÓW. Render SSR strony głównej (dwie karty post-listy,
//    hero-slider, lista `ranked`, okładki-fallbacki, listy niżej) czyta `posts`
//    JEDEN raz i `profiles_public` JEDEN raz - zamiast odczytu na widget
//    i szeregowego odczytu profili na każdy widget z bylinem.
// 2. TEN SAM WYNIK. Dla tych samych wierszy bazy ścieżka nadzbioru oddaje
//    DOKŁADNIE to, co dotychczasowe zapytanie widgetu: te same wiersze, te same
//    kolumny w tej samej kolejności, ten sam byline (porównanie przez
//    `JSON.stringify`, więc kolejność kluczy też się liczy - stan `$tsr`
//    i HTML serwera mają być równe stronie po hydratacji).
// 3. GRANICE. Filtr, inne sortowanie, okno poza pojemnością, błąd nadzbioru
//    i przeglądarka = dotychczasowe zapytanie widgetu.
//
// ŚRODOWISKO: `node` (bez `window`), bo `edgeTtlCache` pod happy-dom jest
// przezroczysty, a ścieżka nadzbioru ma bramkę „tylko serwer". `SSR` stubowany.
// Atrapa `posts` emuluje PostgREST z RLS anona („Public reads published
// posts": opublikowane i nieusunięte), filtry, sortowanie, okno i projekcję
// kolumn - inaczej porównanie „stara vs nowa ścieżka" niczego by nie dowodziło.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabase";

const sb = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));
/** Prace oddane `runAfterResponse` (rozgrzewka nadzbioru musi się tam rejestrować). */
const afterResponse = vi.hoisted(() => ({ work: [] as Promise<unknown>[] }));

vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>) => {
    afterResponse.work.push(work);
  },
}));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve("tenant.test"),
  requestPublicHost: () => "tenant.test",
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const fromStub = supabaseFromStub();
  sb.from = fromStub;
  return { supabase: { from: fromStub.from } };
});

import { fail, ok } from "@/test/supabase";
import type { SectionNode, WidgetContent, WidgetNode } from "@/lib/builder/types";
import { clearEdgeTtlCache } from "@/lib/ssrCache";
import {
  LATEST_POSTS_SUPERSET_COLUMNS,
  LATEST_POSTS_SUPERSET_LIMIT,
  selectColumnNames,
  warmLatestPostsSuperset,
} from "@/lib/builder/latestPostsSuperset";
import {
  POST_LIST_COLUMNS,
  postListQueryOptions,
  type Lang,
  type PostRow,
} from "@/lib/builder/postListQuery";
import {
  SLIDER_POST_COLUMNS,
  sliderPostsQueryOptions,
  type SliderPostRow,
} from "@/lib/builder/sliderPostsQuery";
import { sliderFallbackImagesQueryOptions } from "@/lib/builder/sliderFallbackQuery";
import { sliderAuthorIds, sliderAuthorsQueryOptions } from "@/lib/builder/sliderAuthorsQuery";
import { prefetchSectionQueries } from "@/lib/builder/prefetch";

type Row = Record<string, unknown>;

const LATEST_POSTS_SUPERSET_COLUMN_NAMES = selectColumnNames(LATEST_POSTS_SUPERSET_COLUMNS);

function db(): SupabaseFromStub {
  if (sb.from === null) throw new Error("test: atrapa `from` nie zostala utworzona");
  return sb.from;
}

// ── Emulacja PostgREST ──────────────────────────────────────────────────────

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  // PostgreSQL: NULL jest „największy" (DESC -> NULLS FIRST).
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return String(a) < String(b) ? -1 : 1;
}

function emulate(table: readonly Row[], chain: RecordedChain): SupabaseResult {
  let rows = [...table];
  for (const { method, args } of chain.calls) {
    const [col, a1, a2] = args as [string, unknown, unknown];
    if (method === "eq") rows = rows.filter((r) => r[col] === a1);
    if (method === "is") rows = rows.filter((r) => (r[col] ?? null) === a1);
    if (method === "in") rows = rows.filter((r) => (a1 as unknown[]).includes(r[col]));
    if (method === "not" && a1 === "is") rows = rows.filter((r) => (r[col] ?? null) !== a2);
    if (method === "not" && a1 === "in") {
      const excluded = String(a2).slice(1, -1).split(",");
      rows = rows.filter((r) => !excluded.includes(String(r[col])));
    }
    if (method === "order") {
      const sign = (a1 as { ascending: boolean }).ascending ? 1 : -1;
      rows = [...rows].sort((x, y) => sign * compare(x[col], y[col]));
    }
  }
  const range = chain.argsOf("range") as [number, number] | undefined;
  if (range) rows = rows.slice(range[0], range[1] + 1);
  const limit = chain.argsOf("limit") as [number] | undefined;
  if (limit) rows = rows.slice(0, limit[0]);
  const columns = selectColumnNames(String(chain.argsOf("select")?.[0] ?? "")).filter(
    (c) => !c.includes("("),
  );
  return ok(rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null]))));
}

/** RLS anona na `posts` (20260625160054): opublikowane i nieusunięte. */
function anonVisible(rows: readonly Row[]): Row[] {
  return rows.filter((r) => r.status === "published" && r.deleted_at === null);
}

function post(n: number, patch: Row = {}): Row {
  const day = String(28 - n).padStart(2, "0");
  return {
    id: `p${n}`,
    slug: `wpis-${n}`,
    title_pl: `Tytuł ${n}`,
    title_en: n % 3 === 0 ? "" : `Title ${n}`,
    excerpt_pl: n % 2 === 0 ? `Zajawka ${n}` : null,
    excerpt_en: `Excerpt ${n}`,
    cover_image_url: n % 4 === 1 ? null : `https://cdn.test/${n}.jpg`,
    published_at: `2026-10-${day}T08:00:00Z`,
    post_format: n % 5 === 0 ? "video" : "standard",
    author_id: n % 4 === 3 ? null : `u${n % 3}`,
    is_sponsored: n === 2,
    sponsored_kind: n === 2 ? "partner" : null,
    sponsored_affiliate: false,
    status: "published",
    deleted_at: null,
    // Kolumna spoza obu literałów - nie może wyciec do żadnego wiersza widgetu.
    body_html: `<p>${n}</p>`,
    ...patch,
  };
}

const PROFILES: Row[] = [
  {
    id: "u0",
    display_name: "Anna Nowak",
    first_name: "Anna",
    last_name: "Nowak",
    avatar_url: "https://cdn.test/a0.png",
    slug: "anna-nowak",
    bio: "prywatne",
  },
  {
    id: "u1",
    display_name: "  ",
    first_name: "Jan",
    last_name: "Kowal",
    avatar_url: null,
    slug: null,
    bio: "prywatne",
  },
  // `u2` nie ma profilu publicznego (usunięty / odcięty) - byline nie znika.
];

let postsTable: Row[] = [];

function seed(rows: Row[]): void {
  postsTable = rows;
  db().setResponse("posts", (chain) => emulate(anonVisible(postsTable), chain));
  db().setResponse("profiles_public", (chain) => emulate(PROFILES, chain));
  db().setResponse("categories", (chain) => emulate([{ id: "c1", slug: "analizy" }], chain));
  db().setResponse("tags", (chain) => emulate([{ id: "t1", slug: "ue" }], chain));
}

/** Domyślnie: 24 opublikowane + szkic + usunięty (nadzbiór pełny, 20 wierszy). */
function seedDefault(): void {
  seed([
    ...Array.from({ length: 24 }, (_, i) => post(i + 1)),
    post(90, { status: "draft", published_at: "2026-10-30T00:00:00Z" }),
    post(91, { deleted_at: "2026-10-01T00:00:00Z", published_at: "2026-10-30T00:00:00Z" }),
  ]);
}

function supersetChains(): RecordedChain[] {
  return db()
    .chainsFor("posts")
    .filter((c) => c.argsOf("limit")?.[0] === LATEST_POSTS_SUPERSET_LIMIT);
}

function run<T>(options: { queryFn?: unknown }): Promise<T> {
  return (options.queryFn as () => Promise<T>)();
}

const postList = (c: WidgetContent, lang: Lang = "pl") =>
  run<PostRow[]>(postListQueryOptions(c, lang, "post-list"));
const slider = (c: WidgetContent, lang: Lang = "pl") =>
  run<SliderPostRow[]>(sliderPostsQueryOptions(c, lang));
const fallback = (count: number) => run<string[]>(sliderFallbackImagesQueryOptions(count));
const authors = (ids: string[]) => run<Record<string, unknown>>(sliderAuthorsQueryOptions(ids));

/** Ścieżka DOTYCHCZASOWA pod tym samym `SSR`: `window` wyłącza bramkę nadzbioru i L1. */
async function legacy<T>(fn: () => Promise<T>): Promise<T> {
  vi.stubGlobal("window", {});
  try {
    return await fn();
  } finally {
    vi.unstubAllGlobals();
  }
}

beforeEach(() => {
  afterResponse.work.length = 0;
  db().reset();
  clearEdgeTtlCache();
  vi.stubEnv("SSR", true);
  seedDefault();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("kolumny nadzbioru", () => {
  it("to DOKŁADNIE suma kolumn post-listy i slidera", () => {
    const union = new Set([
      ...selectColumnNames(POST_LIST_COLUMNS),
      ...selectColumnNames(SLIDER_POST_COLUMNS),
    ]);
    expect(new Set(LATEST_POSTS_SUPERSET_COLUMN_NAMES)).toEqual(union);
    expect(LATEST_POSTS_SUPERSET_COLUMN_NAMES).toHaveLength(union.size);
  });

  it("jedno zapytanie: opublikowane, nieusunięte, published_at malejąco, limit pojemności", async () => {
    await postList({ variant: "card", limit: 1 });
    const [chain] = supersetChains();
    expect(chain?.argsOf("select")?.[0]).toBe(LATEST_POSTS_SUPERSET_COLUMN_NAMES.join(", "));
    expect(chain?.argsOf("eq")).toEqual(["status", "published"]);
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(chain?.argsOf("order")).toEqual(["published_at", { ascending: false }]);
    expect(chain?.has("range")).toBe(false);
  });
});

describe("strona główna: jeden odczyt wpisów i jeden odczyt profili", () => {
  function widget(type: WidgetNode["type"], content: WidgetContent, id: string): WidgetNode {
    return { kind: "widget", id, type, content, style: {}, advanced: {} } as WidgetNode;
  }
  function sectionOf(widgets: WidgetNode[], id: string): SectionNode {
    return {
      id,
      kind: "section",
      children: [{ kind: "column", id: `${id}-c`, span: { desktop: 12 }, children: widgets }],
    } as unknown as SectionNode;
  }

  // Układ produkcyjnej strony głównej (sekcja 0 nad zgięciem + sekcje 3 i 4).
  const hero = sectionOf(
    [
      widget("post-list", { variant: "card", limit: 1, authorDisplay: "none" }, "card-1"),
      widget("post-list", { limit: 1 }, "card-2"),
      widget("slider", { source: "posts", orderBy: "newest", limit: 5 }, "hero"),
      widget("post-list", { variant: "ranked", limit: 5 }, "ranked"),
    ],
    "s0",
  );
  const lower = [
    sectionOf([widget("post-list", { variant: "minimal", limit: 3 }, "min")], "s3"),
    sectionOf([widget("post-list", { variant: "list", limit: 3 }, "list")], "s4"),
  ];

  it("SSR: sekcja hero i niższe sekcje = 1x posts + 1x profiles_public", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await prefetchSectionQueries(qc, hero, "pl");
    await Promise.all(lower.map((s) => prefetchSectionQueries(qc, s, "pl")));

    expect(db().chainsFor("posts")).toHaveLength(1);
    expect(db().chainsFor("profiles_public")).toHaveLength(1);
    // Wspólny odczyt profili niesie WSZYSTKICH autorów nadzbioru, posortowanych.
    expect(db().lastChain("profiles_public")?.argsOf("in")).toEqual(["id", ["u0", "u1", "u2"]]);
    // Byline hero i listy pochodzą z tego odczytu.
    const heroRows = qc.getQueryData<SliderPostRow[]>(
      sliderPostsQueryOptions({ source: "posts", orderBy: "newest", limit: 5 }, "pl").queryKey,
    );
    expect(heroRows?.map((r) => r.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    // p1..p5 -> u1, u2, (brak), u1, u2; `u2` nie ma profilu publicznego.
    expect(sliderAuthorIds(heroRows)).toEqual(["u1", "u2"]);
    expect(qc.getQueryData(sliderAuthorsQueryOptions(sliderAuthorIds(heroRows)).queryKey)).toEqual({
      u1: { name: "Jan Kowal", avatar: "", slug: "" },
    });
  });

  it("dotychczas (przeglądarka / bez nadzbioru) te same widgety pytały 7x posts i 5x profiles_public", async () => {
    vi.stubGlobal("window", {});
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await prefetchSectionQueries(qc, hero, "pl");
    await Promise.all(lower.map((s) => prefetchSectionQueries(qc, s, "pl")));

    // card-1, card-2, slider, okładki-fallbacki, ranked, minimal, list.
    expect(db().chainsFor("posts")).toHaveLength(7);
    // card-2, ranked, autorzy slidera, minimal, list.
    expect(db().chainsFor("profiles_public")).toHaveLength(5);
  });
});

describe("ten sam wynik co dotychczasowe zapytanie widgetu", () => {
  const cases: Array<[string, WidgetContent, Lang]> = [
    ["karta z bylinem (PL)", { variant: "card", limit: 4 }, "pl"],
    ["karta z bylinem (EN)", { variant: "card", limit: 4 }, "en"],
    ["ranked z bylinem, bez zajawki", { variant: "ranked", limit: 5 }, "pl"],
    ["autor wyłączony", { variant: "card", limit: 3, authorDisplay: "none" }, "pl"],
    ["numbered (bez bylinu)", { variant: "numbered", limit: 6 }, "en"],
    ["offset w oknie", { variant: "list", limit: 5, offset: 7, showExcerpt: "0" }, "pl"],
    [
      "uniqueOnPage (zapas +18 mieści się w oknie)",
      { variant: "card", limit: 2, uniqueOnPage: true },
      "pl",
    ],
  ];

  it.each(cases)("post-lista: %s", async (_label, content, lang) => {
    const before = await legacy(() => postList(content, lang));
    db().reset();
    seedDefault();

    const after = await postList(content, lang);

    expect(supersetChains()).toHaveLength(1);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(after.length).toBeGreaterThan(0);
  });

  it("post-lista: byline 'wzbogacamy, nigdy nie kasujemy' bez zmian (autor bez profilu)", async () => {
    const before = await legacy(() => postList({ variant: "card", limit: 6 }));
    db().reset();
    seedDefault();
    const after = await postList({ variant: "card", limit: 6 });

    const byId = new Map(after.map((r) => [r.id, r]));
    // p2 -> u2 bez profilu: wiersz bez pól autora, tak jak dotąd.
    expect(byId.get("p2")).not.toHaveProperty("author_display_name");
    // p1 -> u1: pusta-spacja display_name przechodzi jak dotąd (post-lista nie trymuje).
    expect(byId.get("p1")?.author_display_name).toBe("  ");
    expect(byId.get("p6")?.author_slug).toBe("anna-nowak");
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it.each<[string, WidgetContent, Lang]>([
    ["newest PL", { source: "posts", orderBy: "newest", limit: 5 }, "pl"],
    ["newest EN bez zajawki", { source: "posts", limit: 20, showExcerpt: false }, "en"],
    [
      "nieznany orderBy (sortuje jak newest)",
      { source: "posts", orderBy: "Treść", limit: 3 },
      "pl",
    ],
  ])("slider: %s", async (_label, content, lang) => {
    const before = await legacy(() => slider(content, lang));
    db().reset();
    seedDefault();

    const after = await slider(content, lang);

    expect(supersetChains()).toHaveLength(1);
    expect(db().chainsFor("posts")).toHaveLength(1);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it("okładki-fallbacki: te same adresy co zapytanie z `cover_image_url IS NOT NULL`", async () => {
    const before = await legacy(() => fallback(5));
    db().reset();
    seedDefault();

    const after = await fallback(5);

    expect(db().chainsFor("posts")).toHaveLength(1);
    expect(supersetChains()).toHaveLength(1);
    expect(after).toEqual(before);
    expect(after).toHaveLength(5);
  });

  it("autorzy slajdów: ta sama mapa, odczyt profili wspólny z post-listą", async () => {
    const rows = await slider({ source: "posts", limit: 5 });
    const ids = sliderAuthorIds(rows);
    const before = await legacy(() => authors(ids));
    db().reset();
    clearEdgeTtlCache();
    seedDefault();
    await slider({ source: "posts", limit: 5 });
    await postList({ variant: "ranked", limit: 5 });

    const after = await authors(ids);

    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(db().chainsFor("profiles_public")).toHaveLength(1);
  });

  it("nadzbiór krótszy niż pojemność zawiera wszystko: okno za jego końcem też jest dokładne", async () => {
    seed([post(1), post(2), post(3, { cover_image_url: null }), post(4)]);
    const beforeList = await legacy(() => postList({ variant: "card", limit: 10 }));
    const beforeCovers = await legacy(() => fallback(5));
    db().reset();
    seed([post(1), post(2), post(3, { cover_image_url: null }), post(4)]);

    expect(JSON.stringify(await postList({ variant: "card", limit: 10 }))).toBe(
      JSON.stringify(beforeList),
    );
    expect(await fallback(5)).toEqual(beforeCovers);
    expect(db().chainsFor("posts")).toHaveLength(1);
  });
});

describe("widget z filtrem albo innym sortowaniem pyta WŁASNYM zapytaniem", () => {
  it.each<[string, WidgetContent]>([
    ["kategoria", { categoriesCsv: "analizy" }],
    ["wykluczona kategoria", { excludeCategoriesCsv: "analizy" }],
    ["tag", { tagsCsv: "ue" }],
    ["wykluczony tag", { excludeTagsCsv: "ue" }],
    ["jawne id", { includeIdsCsv: "p3,p4" }],
    ["wykluczone id", { excludeIdsCsv: "p1" }],
    ["format", { postFormat: "video" }],
    ["autor", { authorId: "u1" }],
    ["data od", { dateFrom: "2026-10-10" }],
    ["data do", { dateTo: "2026-10-20" }],
    ["rosnąco", { orderDir: "asc" }],
    ["po tytule", { orderBy: "title" }],
    ["po dacie utworzenia", { orderBy: "created_at" }],
  ])("post-lista: %s", async (_label, filter) => {
    await postList({ variant: "card", limit: 3, ...filter });

    expect(supersetChains()).toHaveLength(0);
    expect(db().chainsFor("posts")).toHaveLength(1);
  });

  it.each<[string, WidgetContent]>([
    ["kategoria", { categorySlugs: "analizy" }],
    ["tag", { tagSlugs: "ue" }],
    ["wykluczone id", { excludeIds: "p1" }],
    ["najstarsze", { orderBy: "oldest" }],
    ["po tytule", { orderBy: "title" }],
  ])("slider: %s", async (_label, filter) => {
    await slider({ source: "posts", limit: 5, ...filter });

    expect(supersetChains()).toHaveLength(0);
  });

  it("autorzy slidera filtrowanego NIE pobierają nadzbioru, którego nikt nie rozgrzał", async () => {
    await authors(["u0", "u1"]);

    expect(db().chainsFor("posts")).toHaveLength(0);
    expect(db().lastChain("profiles_public")?.argsOf("in")).toEqual(["id", ["u0", "u1"]]);
  });

  it("autor spoza nadzbioru: autorzy slajdów pytają o własną listę", async () => {
    await slider({ source: "posts", limit: 5 });

    await authors(["u0", "u9"]);

    expect(db().lastChain("profiles_public")?.argsOf("in")).toEqual(["id", ["u0", "u9"]]);
  });
});

describe("okno poza pojemnością nadzbioru", () => {
  it("limit 21 albo offset + limit > 20: własne zapytanie post-listy", async () => {
    await postList({ variant: "card", limit: 21 });
    await postList({ variant: "card", limit: 3, offset: 18 });
    // uniqueOnPage: limit 3 + zapas 18 = 21 (inny wariant = inny klucz L1 widgetu).
    await postList({ variant: "minimal", limit: 3, uniqueOnPage: true });

    expect(supersetChains()).toHaveLength(0);
    expect(
      db()
        .chainsFor("posts")
        .map((c) => c.argsOf("range")),
    ).toEqual([
      [0, 20],
      [18, 20],
      [0, 20],
    ]);
  });

  it("okładki-fallbacki ponad pojemność: własne zapytanie", async () => {
    await fallback(21);

    expect(supersetChains()).toHaveLength(0);
    expect(db().lastChain("posts")?.argsOf("limit")).toEqual([21]);
  });

  it("pełny nadzbiór z za małą liczbą okładek: dopytanie własnym zapytaniem", async () => {
    // 20 najnowszych bez okładki, starsze z okładką - nadzbiór ich nie widzi.
    seed([
      ...Array.from({ length: 20 }, (_, i) => post(i + 1, { cover_image_url: null })),
      post(21, { cover_image_url: "https://cdn.test/21.jpg" }),
      post(22, { cover_image_url: "https://cdn.test/22.jpg" }),
      post(23, { cover_image_url: "https://cdn.test/23.jpg" }),
    ]);

    await expect(fallback(3)).resolves.toEqual([
      "https://cdn.test/21.jpg",
      "https://cdn.test/22.jpg",
      "https://cdn.test/23.jpg",
    ]);
    expect(db().chainsFor("posts")).toHaveLength(2);
  });
});

describe("odporność i memoizacja", () => {
  it("błąd nadzbioru: każdy widget wraca do własnego zapytania (awaria jak przed zmianą)", async () => {
    db().setResponse("posts", (chain) =>
      chain.argsOf("limit")?.[0] === LATEST_POSTS_SUPERSET_LIMIT
        ? fail("statement timeout", "57014")
        : emulate(anonVisible(postsTable), chain),
    );

    const rows = await postList({ variant: "numbered", limit: 2 });
    const slides = await slider({ source: "posts", limit: 2 });

    expect(rows.map((r) => r.id)).toEqual(["p1", "p2"]);
    expect(slides.map((r) => r.id)).toEqual(["p1", "p2"]);
  });

  it("nadzbiór i profile są memoizowane per izolat (L1, 60 s)", async () => {
    await postList({ variant: "card", limit: 2 });
    await postList({ variant: "card", limit: 5 });
    await slider({ source: "posts", limit: 4 });

    expect(db().chainsFor("posts")).toHaveLength(1);
    expect(db().chainsFor("profiles_public")).toHaveLength(1);
  });

  it("autorzy slidera: L1 po uporządkowanej liście id, odmowa nie trafia do cache", async () => {
    db().setResponse("profiles_public", () => fail("permission denied", "42501"));
    await expect(authors(["u0"])).resolves.toEqual({});

    db().setResponse("profiles_public", (chain) => emulate(PROFILES, chain));
    await expect(authors(["u0"])).resolves.toEqual({
      u0: { name: "Anna Nowak", avatar: "https://cdn.test/a0.png", slug: "anna-nowak" },
    });
    await authors(["u0"]);
    await authors(["u1", "u0"]);

    // odmowa + pierwszy sukces + inna kolejność (inny klucz); powtórka z L1.
    expect(db().chainsFor("profiles_public")).toHaveLength(3);
  });
});

// ŚWIEŻOŚĆ: JEDNA WARSTWA SERVE-STALE. Klucz widgetu serwuje nieświeży wpis
// i odświeża go w tle; to odświeżenie czyta nadzbiór. Gdyby nadzbiór też oddał
// nieświeże wiersze, zapis widgetu ostemplowałby je jako świeże i nowy wpis
// docierałby na stronę cykl później (wiek danych do 2 × 5 × TTL). Nadzbiór
// po TTL czyta więc bazę (`serveStale: false`).
describe("świeżość: nieświeżość nie sumuje się z dwóch warstw cache", () => {
  const TTL = 60_000;

  function publishNewest(): void {
    seed([post(0), ...postsTable]);
  }

  async function afterBackgroundRefresh(expectedSupersetReads: number): Promise<void> {
    await vi.waitFor(() => expect(supersetChains()).toHaveLength(expectedSupersetReads));
    // Zapis odświeżonego wpisu widgetu biegnie mikrozadaniami po odczycie.
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  }

  it("post-lista: odświeżenie w tle po TTL czyta bazę, nie nieświeży nadzbiór", async () => {
    const now = vi.spyOn(Date, "now");
    const t0 = 1_800_000_000_000;
    now.mockReturnValue(t0);
    expect((await postList({ variant: "numbered", limit: 1 })).map((r) => r.id)).toEqual(["p1"]);

    publishNewest();
    now.mockReturnValue(t0 + TTL + 1_000);
    // Wpis widgetu nieświeży: serwowany od ręki, odświeżenie w tle.
    expect((await postList({ variant: "numbered", limit: 1 })).map((r) => r.id)).toEqual(["p1"]);
    await afterBackgroundRefresh(2);

    // Odświeżony wpis niesie wiersze z bazy, nie przeostemplowany nadzbiór.
    expect((await postList({ variant: "numbered", limit: 1 })).map((r) => r.id)).toEqual(["p0"]);
  });

  it("slider: widget bez wpisu w L1 przy nieświeżym nadzbiorze dostaje dane z bazy", async () => {
    const now = vi.spyOn(Date, "now");
    const t0 = 1_800_000_000_000;
    now.mockReturnValue(t0);
    await postList({ variant: "numbered", limit: 1 });

    publishNewest();
    now.mockReturnValue(t0 + 4 * TTL);
    // Klucz slidera nigdy nie był rozgrzany: blokujący odczyt (jak przed
    // nadzbiorem), a nie wiersze sprzed czterech minut.
    const slides = await slider({ source: "posts", limit: 2 });
    expect(slides.map((r) => r.id)).toEqual(["p0", "p1"]);
    expect(supersetChains()).toHaveLength(2);
  });

  it("w oknie TTL nadzbiór nadal jest jednym odczytem dla wszystkich widgetów", async () => {
    const now = vi.spyOn(Date, "now");
    const t0 = 1_800_000_000_000;
    now.mockReturnValue(t0);
    await postList({ variant: "card", limit: 2 });
    now.mockReturnValue(t0 + TTL - 1_000);
    await slider({ source: "posts", limit: 3 });
    await fallback(3);

    expect(supersetChains()).toHaveLength(1);
  });
});

// Rozgrzanie na starcie loadera strony głównej: odczyt startuje w pierwszej
// fali, a widgety (po trzech falach strony i kanwy) biorą go z L1 albo
// dołączają do lotu - bez drugiego odczytu wpisów i profili.
describe("warmLatestPostsSuperset", () => {
  it("serwer: jeden odczyt wpisów (bez profili), z którego korzystają potem widgety", async () => {
    warmLatestPostsSuperset();
    await vi.waitFor(() => expect(supersetChains()).toHaveLength(1));
    // Rozgrzewka nie czyta profili - robi to pierwszy widget z bylinem.
    expect(db().chainsFor("profiles_public")).toHaveLength(0);

    await postList({ variant: "card", limit: 3 });
    await slider({ source: "posts", limit: 4 });

    expect(supersetChains()).toHaveLength(1);
    expect(db().chainsFor("posts")).toHaveLength(1);
    expect(db().chainsFor("profiles_public")).toHaveLength(1);
  });

  it("praca rozgrzewki jest zarejestrowana za odpowiedzią (waitUntil) i nie odrzuca", async () => {
    warmLatestPostsSuperset();
    await vi.waitFor(() => expect(afterResponse.work).toHaveLength(1));
    await expect(afterResponse.work[0]).resolves.toBeUndefined();
  });

  it("widget zapytany w trakcie rozgrzewania dołącza do lotu (single-flight)", async () => {
    warmLatestPostsSuperset();
    await postList({ variant: "numbered", limit: 2 });

    expect(supersetChains()).toHaveLength(1);
  });

  it("błąd odczytu jest połykany (bez odrzuconej obietnicy), widget pyta sam", async () => {
    db().setResponse("posts", (chain) =>
      chain.argsOf("limit")?.[0] === LATEST_POSTS_SUPERSET_LIMIT
        ? fail("statement timeout", "57014")
        : emulate(anonVisible(postsTable), chain),
    );
    warmLatestPostsSuperset();
    await vi.waitFor(() => expect(afterResponse.work).toHaveLength(1));
    await expect(afterResponse.work[0]).resolves.toBeUndefined();

    const rows = await postList({ variant: "numbered", limit: 2 });
    expect(rows.map((r) => r.id)).toEqual(["p1", "p2"]);
  });

  it("przeglądarka: no-op", () => {
    vi.stubGlobal("window", {});
    warmLatestPostsSuperset();
    expect(db().chainsFor("posts")).toHaveLength(0);
    expect(afterResponse.work).toHaveLength(0);
  });
});

describe("przeglądarka: zapytania jak dotąd", () => {
  it("z `window` każdy widget pyta własnym zapytaniem, bez nadzbioru", async () => {
    vi.stubGlobal("window", {});

    await postList({ variant: "card", limit: 2 });
    await slider({ source: "posts", limit: 2 });
    await fallback(3);

    expect(supersetChains()).toHaveLength(0);
    expect(db().chainsFor("posts")).toHaveLength(3);
  });

  it("bez `import.meta.env.SSR` (bundel klienta) bramka jest zamknięta", async () => {
    vi.stubEnv("SSR", false);

    await postList({ variant: "card", limit: 2 });
    await slider({ source: "posts", limit: 2 });

    expect(supersetChains()).toHaveLength(0);
    expect(db().chainsFor("posts")).toHaveLength(2);
  });
});
