// Regresje RatedListView przypiete na stale.
//
// 1. KLUCZ ZAPYTANIA BEZ JEZYKA. `queryFn` sortuje po `title_${lang}` i WPIEKA
//    zlokalizowany tytul/zajawke w cache'owane wiersze, a klucz jezyka nie
//    zawieral - po przelaczeniu PL/EN widget oddawal poprzedni jezyk az do
//    wygasniecia swiezosci. Klucz ma tez uzywac kanonicznego korzenia
//    (`WIDGET_QUERY_ROOTS.ratedList`), inaczej inwalidacja realtime nie trafia.
// 2. MARTWE columnsTablet/columnsMobile. Edytor je oferowal, a siatka rysowala
//    `columnsDesktop` na kazdym breakpoincie.
// 3. MARTWY showReadMore w trybie recznym. Mapowanie pozycji gubilo `href`,
//    a przycisk jest bramkowany wlasnie na `href`.
// 4. MARTWY showRating w trybie dynamicznym (wiersze nie maja skad wziac oceny).
// 5. FILTR AUTORA PO STRONIE KLIENTA, po `.range()` - widget oddawal mniej
//    wierszy niz `numberOfPosts`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { WIDGET_QUERY_ROOTS, WIDGET_LIVE_QUERY_PREFIXES } from "@/lib/builder/queryKeys";
import { toJson } from "@/lib/builder/types";

type Op = [string, unknown[]];

const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  calls: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const record: { table: string; ops: Array<[string, unknown[]]> } = { table, ops: [] };
    db.calls.push(record);
    const b: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "neq",
      "is",
      "in",
      "not",
      "gte",
      "lte",
      "order",
      "range",
      "limit",
      "ilike",
    ]) {
      b[m] = (...args: unknown[]) => {
        record.ops.push([m, args]);
        return b;
      };
    }
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: db.tables[table] ?? [], error: null });
    return b;
  };
  return {
    supabase: { from: (t: string) => makeBuilder(t), rpc: async () => ({ data: [], error: null }) },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
}));

import { RatedListView } from "../RatedListView";

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrap(ui: ReactElement, qc: QueryClient = makeClient()) {
  return { qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

const opsFor = (table: string): Op[] =>
  db.calls.filter((c) => c.table === table).flatMap((c) => c.ops);
const callsFor = (table: string) => db.calls.filter((c) => c.table === table);

const DYN_POSTS = [
  {
    id: "p1",
    slug: "pierwszy",
    title_pl: "Tytul PL 1",
    title_en: "Title EN 1",
    excerpt_pl: "Zajawka PL 1",
    excerpt_en: "Excerpt EN 1",
    published_at: "2026-03-01T00:00:00Z",
    post_format: "standard",
    author_id: "au1",
  },
  {
    id: "p2",
    slug: "drugi",
    title_pl: "Tytul PL 2",
    title_en: "Title EN 2",
    excerpt_pl: "Zajawka PL 2",
    excerpt_en: "Excerpt EN 2",
    published_at: "2026-02-01T00:00:00Z",
    post_format: "standard",
    author_id: "au2",
  },
];

beforeEach(() => {
  db.tables = {};
  db.calls = [];
});
afterEach(cleanup);

describe("RatedListView - klucz zapytania niesie jezyk", () => {
  it("uses the canonical root that realtime invalidation knows about", async () => {
    db.tables.posts = DYN_POSTS;
    const { qc } = wrap(<RatedListView c={{ source: "dynamic", numberOfPosts: 2 }} lang="pl" />);
    await screen.findByText("Tytul PL 1");

    const keys = qc
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);
    expect(keys).toHaveLength(1);
    expect(keys[0][0]).toBe(WIDGET_QUERY_ROOTS.ratedList);
    expect(WIDGET_LIVE_QUERY_PREFIXES.has(String(keys[0][0]))).toBe(true);
  });

  it("keys PL and EN separately instead of reusing the cached other language", async () => {
    db.tables.posts = DYN_POSTS;
    const qc = makeClient();
    const c = { source: "dynamic", numberOfPosts: 2, orderBy: "title_asc" };

    const pl = wrap(<RatedListView c={c} lang="pl" />, qc);
    await screen.findByText("Tytul PL 1");
    pl.unmount();

    // Ten sam klient, ten sam content - zmienia sie WYLACZNIE jezyk.
    wrap(<RatedListView c={c} lang="en" />, qc);
    await screen.findByText("Title EN 1");
    // Stary klucz nie niosl jezyka, wiec tu renderowalby sie polski tytul.
    expect(screen.queryByText("Tytul PL 1")).toBeNull();

    const langs = qc
      .getQueryCache()
      .getAll()
      .map((q) => (q.queryKey[1] as { lang?: string }).lang);
    expect(langs.sort()).toEqual(["en", "pl"]);
  });

  it("declares an explicit staleTime instead of inheriting the client default", async () => {
    db.tables.posts = DYN_POSTS;
    const { qc } = wrap(<RatedListView c={{ source: "dynamic" }} lang="pl" />);
    await screen.findByText("Tytul PL 1");
    const [query] = qc.getQueryCache().getAll();
    // Swiezosc czyta obserwator (widget), nie sam wpis cache.
    expect(query.observers[0]?.options.staleTime).toBe(2 * 60_000);
  });
});

describe("RatedListView - siatka jest naprawde responsywna", () => {
  const styleCss = () =>
    Array.from(document.querySelectorAll("style"))
      .map((s) => s.innerHTML)
      .join("");

  it("drives each breakpoint from its own column count", () => {
    const { container } = wrap(
      <RatedListView
        c={{
          source: "manual",
          items: [{ title_pl: "A" }, { title_pl: "B" }],
          columnsDesktop: 4,
          columnsTablet: 2,
          columnsMobile: 1,
        }}
        lang="pl"
      />,
    );
    const list = container.querySelector("ol");
    expect(list?.className).toContain("rl-grid");

    // Liczby kolumn ida przez zmienne CSS - inline `grid-template-columns`
    // wygralby z media queries i zabetonowal desktop na kazdej szerokosci.
    const inline = list?.getAttribute("style") ?? "";
    expect(inline).not.toContain("grid-template-columns");
    expect(inline).toContain("--rl-cols-d: 4");
    expect(inline).toContain("--rl-cols-t: 2");
    expect(inline).toContain("--rl-cols-m: 1");

    const css = styleCss();
    expect(css).toContain(".rl-wrap.rl-grid{grid-template-columns:repeat(var(--rl-cols-m,1)");
    expect(css).toMatch(
      /@media \(min-width:641px\)\{\.rl-wrap\.rl-grid\{grid-template-columns:repeat\(var\(--rl-cols-t,1\)/,
    );
    expect(css).toMatch(
      /@media \(min-width:1024px\)\{\.rl-wrap\.rl-grid\{grid-template-columns:repeat\(var\(--rl-cols-d,1\)/,
    );
  });

  it("turns the grid on when only a narrow breakpoint asks for columns", () => {
    const { container } = wrap(
      <RatedListView
        c={{ source: "manual", items: [{ title_pl: "A" }], columnsDesktop: 1, columnsMobile: 2 }}
        lang="pl"
      />,
    );
    const list = container.querySelector("ol");
    expect(list?.className).toContain("rl-grid");
    expect(list?.getAttribute("style")).toContain("--rl-cols-m: 2");
  });

  it("defaults tablet to min(desktop, 2) and stays a plain list for a single column", () => {
    const { container } = wrap(
      <RatedListView
        c={{ source: "manual", items: [{ title_pl: "A" }], columnsDesktop: 3 }}
        lang="pl"
      />,
    );
    expect(container.querySelector("ol")?.getAttribute("style")).toContain("--rl-cols-t: 2");

    cleanup();
    const single = wrap(
      <RatedListView c={{ source: "manual", items: [{ title_pl: "A" }] }} lang="pl" />,
    );
    const list = single.container.querySelector("ol");
    expect(list?.className).not.toContain("rl-grid");
    expect(styleCss()).not.toContain("--rl-cols-m");
  });

  it("reads column counts stored as strings by older documents", () => {
    const { container } = wrap(
      <RatedListView
        c={{
          source: "manual",
          items: [{ title_pl: "A" }],
          columnsDesktop: "3",
          columnsTablet: "2",
          columnsMobile: "1",
        }}
        lang="pl"
      />,
    );
    expect(container.querySelector("ol")?.getAttribute("style")).toContain("--rl-cols-d: 3");
  });
});

describe("RatedListView - reczne pozycje niosa href", () => {
  // Druga pozycja CELOWO nie ma klucza `href` - tak wygladaja dokumenty
  // zapisane, zanim pole pojawilo sie w edytorze.
  const items = toJson([
    { title_pl: "Z linkiem", href: "/post/z-linkiem", rating: 0 },
    { title_pl: "Bez linku", rating: 0 },
  ]);

  it("links the title and renders read-more for items that have a href", () => {
    const { container } = wrap(
      <RatedListView c={{ source: "manual", items, showReadMore: true }} lang="pl" />,
    );
    const links = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links.filter((h) => h === "/post/z-linkiem")).toHaveLength(2); // tytul + read more
    expect(container.querySelectorAll(".rl-more")).toHaveLength(1);
  });

  it("keeps the item unlinked when no href was authored", () => {
    const { container } = wrap(
      <RatedListView
        c={{ source: "manual", items: [{ title_pl: "Bez linku" }], showReadMore: true }}
        lang="pl"
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector(".rl-more")).toBeNull();
  });
});

describe("RatedListView - ocena tylko dla listy recznej", () => {
  it("renders the rating bar for a manual item", () => {
    const { container } = wrap(
      <RatedListView
        c={{ source: "manual", items: [{ title_pl: "A", rating: 8 }], showRating: true }}
        lang="pl"
      />,
    );
    expect(container.textContent).toContain("na 10");
  });

  it("never renders a rating for dynamic rows, even with the flag on", async () => {
    db.tables.posts = DYN_POSTS;
    const { container } = wrap(
      <RatedListView c={{ source: "dynamic", showRating: true }} lang="pl" />,
    );
    await screen.findByText("Tytul PL 1");
    expect(container.textContent).not.toContain("na 10");
  });
});

describe("RatedListView - filtr autora jest czescia zapytania", () => {
  it("resolves author names to ids and narrows the posts query", async () => {
    db.tables.posts = DYN_POSTS;
    db.tables.profiles_public = [
      { id: "au1", display_name: "Redakcja" },
      { id: "au2", display_name: "Ktos Inny" },
    ];
    wrap(
      <RatedListView
        c={{ source: "dynamic", authorFilter: "Redakcja", numberOfPosts: 2, showAuthor: true }}
        lang="pl"
      />,
    );
    await screen.findByText("Tytul PL 1");

    // Nazwy -> identyfikatory ida osobnym zapytaniem...
    expect(
      opsFor("profiles_public").some(
        ([op, args]) => op === "in" && args[0] === "display_name" && Array.isArray(args[1]),
      ),
    ).toBe(true);
    // ...a wynik ladnie zawezajaco do zapytania o wpisy.
    expect(opsFor("posts").some(([op, args]) => op === "in" && args[0] === "author_id")).toBe(true);

    // Nic nie jest odsiewane PO `.range()`: wiersze, ktore baza zwrocila,
    // renderuja sie w calosci (stara wersja gubila tu drugi wiersz).
    expect(screen.getByText("Tytul PL 2")).toBeTruthy();
  });

  it("short-circuits when no profile matches the filter", async () => {
    db.tables.posts = DYN_POSTS;
    db.tables.profiles_public = [];
    const { container } = wrap(
      <RatedListView c={{ source: "dynamic", authorFilter: "Nikt Taki" }} lang="pl" />,
    );
    await waitFor(() => expect(callsFor("profiles_public").length).toBeGreaterThan(0));
    await waitFor(() => expect(container.querySelectorAll("li")).toHaveLength(0));
    expect(callsFor("posts")).toHaveLength(0);
  });

  it("skips the resolution round-trip when no author filter is set", async () => {
    db.tables.posts = DYN_POSTS;
    db.tables.profiles_public = [{ id: "au1", display_name: "Redakcja" }];
    wrap(<RatedListView c={{ source: "dynamic", showAuthor: true }} lang="pl" />);
    await screen.findByText("Tytul PL 1");
    // Jedyne trafienie w `profiles_public` to dociagniecie nazwisk dla zwroconych wierszy.
    expect(
      opsFor("profiles_public").some(([op, args]) => op === "in" && args[0] === "display_name"),
    ).toBe(false);
    expect(screen.getByText(/Redakcja/)).toBeTruthy();
  });
});

describe("RatedListView - ustawienia czytane przez contentValue", () => {
  it('treats the string "0" as off', () => {
    const { container } = wrap(
      <RatedListView
        c={{
          source: "manual",
          items: [{ title_pl: "A", excerpt_pl: "Zajawka", author: "Autor" }],
          showExcerpt: "0",
          showAuthor: "0",
        }}
        lang="pl"
      />,
    );
    expect(container.textContent).not.toContain("Zajawka");
    expect(container.textContent).not.toContain("Autor");
  });

  it("falls back through lang -> pl -> en for manual item copy", () => {
    const { container } = wrap(
      <RatedListView
        c={{ source: "manual", items: [{ title_en: "Only EN" }], showExcerpt: true }}
        lang="pl"
      />,
    );
    expect(container.textContent).toContain("Only EN");
  });
});
