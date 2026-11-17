// BLOKI Z LISTĄ WPISÓW: ADRES KANONICZNY KARTY.
//
// Cztery bloki edytora treści (latest-posts, query-loop, related-posts,
// more-posts) linkowały `/post/<slug>`, czyli adres odpowiadający 301 -
// dodatkowy dokument i dwa odczyty bazy, które `AppLink` płacił już przy
// najechaniu kursorem.
//
// CO TEN PLIK PRZYPINA - na PRAWDZIWYM zapytaniu i PRAWDZIWYM widoku naraz
// (testy widoków obok podmieniają cały moduł zapytań, a testy zapytań nie
// renderują nic, więc żaden z nich nie widzi szwu między nimi):
//  1. Strona-rodzic jedzie osadzeniem w TYM SAMYM odczycie wpisów (jedno
//     żądanie `posts`, zero `pages`, zero RPC ścieżek), a widok linkuje
//     `postHref(wiersz)`.
//  2. Rodzic zagnieżdżony albo niewidoczny zostaje przy `/post/<slug>`.
//  3. Gdy odczyt z osadzeniem zawiedzie, leci ten sam odczyt bez osadzenia:
//     blok ma karty z adresem zapasowym, a nie znika ze strony.
//  4. Tryb `trending` bloku more-posts (funkcja SQL bez sluga strony) zostaje
//     przy adresie zapasowym.
//  5. HTML serwera i strona po hydratacji mają te same adresy: obie strony
//     liczą je z tego samego wiersza w stanie odwodnionym.
//
// Granice: klient Supabase to rejestrator łańcuchów i RPC, router to atrapa
// odnośnika, `useAuth` (jedyny AuthProvider żyje w `__root`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider, dehydrate, hydrate } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { RecordedChain, SupabaseFromStub, SupabaseRpcStub } from "@/test/supabase";

const sb = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, supabaseRpcStub } = await import("@/test/supabase");
  const fromStub = supabaseFromStub();
  const rpcStub = supabaseRpcStub();
  sb.from = fromStub;
  sb.rpc = rpcStub;
  return { supabase: { from: fromStub.from, rpc: rpcStub.rpc } };
});
vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    Link: RouterLinkStub,
    useNavigate: () => () => undefined,
    useRouter: () => ({ navigate: () => undefined, preloadRoute: async () => undefined }),
    useSearch: () => ({}),
    useParams: () => ({}),
  };
});
vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import { fail, ok } from "@/test/supabase";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";
import {
  latestPostsBlockQueryOptions,
  morePostsBlockQueryOptions,
  queryLoopBlockQueryOptions,
  relatedPostsBlockQueryOptions,
} from "@/lib/queries/blocks";
import { resetPostParentPageRead } from "@/lib/routing/postParentPageRead";
import { LatestPostsView } from "../LatestPostsView";
import { QueryLoopView } from "../NavLoopViews";
import { RelatedPostsView } from "../PostContextViews";
import { MorePostsView } from "../FoxizExtraViews";

/** `select` listy wpisów bloku Z osadzeniem strony-rodzica - dosłownie, znak po znaku. */
const SELECT_Z_RODZICEM =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id, is_sponsored, sponsored_kind, sponsored_affiliate, parent_page:pages!posts_parent_page_id_fkey(slug, parent_id)";
/** Ten sam `select` bez osadzenia: odczyt zapasowy i kształt sprzed zmiany. */
const SELECT_ZAPASOWY =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id, is_sponsored, sponsored_kind, sponsored_affiliate";

function db(): SupabaseFromStub {
  if (sb.from === null) throw new Error("test: atrapa `from` nie została utworzona");
  return sb.from;
}
function rpc(): SupabaseRpcStub {
  if (sb.rpc === null) throw new Error("test: atrapa `rpc` nie została utworzona");
  return sb.rpc;
}

/** Trzy wpisy: pod `/blog`, pod stroną zagnieżdżoną i pod rodzicem niewidocznym dla gościa. */
const PARENTS = [
  { slug: "blog", parent_id: null },
  { slug: "energetyka", parent_id: "pg-analizy" },
  null,
];

function posts(withParentPage: boolean): Array<Record<string, unknown>> {
  return PARENTS.map((parent, i) => ({
    id: `p${i + 1}`,
    slug: `wpis-${i + 1}`,
    title_pl: `Wpis ${i + 1}`,
    title_en: null,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: `https://cdn.test/${i + 1}.jpg`,
    published_at: "2026-07-01T10:00:00.000Z",
    parent_page_id: `pg-${i + 1}`,
    is_sponsored: false,
    sponsored_kind: null,
    sponsored_affiliate: null,
    ...(withParentPage ? { parent_page: parent } : {}),
  }));
}

function selectOf(chain: RecordedChain | undefined): string {
  return String(chain?.argsOf("select")?.[0]);
}

/** Bieżący wpis bez taksonomii: bloki kontekstowe pytają o „najnowsze" bez zawężenia. */
const CTX: CurrentPostCtx = { kind: "post", id: "biezacy", slug: "biezacy" };

function tree(ui: ReactElement, client: QueryClient): ReactElement {
  return (
    <QueryClientProvider client={client}>
      <CurrentPostProvider value={CTX}>{ui}</CurrentPostProvider>
    </QueryClientProvider>
  );
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Adresy kart w kolejności DOM, bez powtórzeń (okładka i tytuł linkują to samo). */
function hrefsOf(root: ParentNode): string[] {
  return [
    ...new Set(Array.from(root.querySelectorAll("a[href]"), (a) => a.getAttribute("href") ?? "")),
  ];
}

/** Adresy odnośników z napisu HTML (render serwera nie ma drzewa DOM). */
function hrefsInHtml(html: string): string[] {
  return [...new Set(Array.from(html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g), (m) => m[1]))];
}

/**
 * Cztery bloki: widok i prefetch zapytania, o które ten widok pyta - ten sam
 * klucz, który rozgrzewa loader SSR (`prefetchBlockQueries`).
 */
const BLOCKS: ReadonlyArray<
  readonly [string, ReactElement, (client: QueryClient) => Promise<void>]
> = [
  [
    "latest-posts",
    <LatestPostsView
      key="latest"
      count={3}
      category=""
      showExcerpt={false}
      showImage
      layout="grid"
      lang="pl"
    />,
    (client) => client.prefetchQuery(latestPostsBlockQueryOptions({ count: 3, category: "" })),
  ],
  [
    "query-loop",
    <QueryLoopView
      key="loop"
      categorySlug=""
      limit={6}
      layout="grid"
      showExcerpt={false}
      showDate={false}
      showImage
      orderBy="date"
      lang="pl"
      cls=""
    />,
    (client) =>
      client.prefetchQuery(
        queryLoopBlockQueryOptions({ categorySlug: "", limit: 6, orderBy: "date", lang: "pl" }),
      ),
  ],
  [
    "related-posts",
    <RelatedPostsView key="related" strategy="latest" limit={3} layout="grid" lang="pl" />,
    (client) =>
      client.prefetchQuery(
        relatedPostsBlockQueryOptions({
          currentId: "biezacy",
          strategy: "latest",
          categorySlugs: [],
          tagSlugs: [],
          authorId: null,
          limit: 3,
        }),
      ),
  ],
  [
    "more-posts",
    <MorePostsView key="more" strategy="latest" limit={4} lang="pl" />,
    (client) =>
      client.prefetchQuery(
        morePostsBlockQueryOptions({ strategy: "latest", limit: 4, categorySlug: null }),
      ),
  ],
];

beforeEach(() => {
  db().reset();
  rpc().reset();
  resetPostParentPageRead();
  db().setResponse("posts", (chain) => ok(posts(selectOf(chain).includes("parent_page:"))));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(BLOCKS)("blok %s", (_name, view, prefetch) => {
  it("jedno żądanie o wpisy z osadzeniem rodzica, zero żądań o strony i zero RPC", async () => {
    const { container } = render(tree(view, freshClient()));
    await waitFor(() => expect(hrefsOf(container).length).toBeGreaterThan(0));

    expect(db().chainsFor("posts")).toHaveLength(1);
    expect(selectOf(db().lastChain("posts"))).toBe(SELECT_Z_RODZICEM);
    expect(db().chainsFor("pages")).toHaveLength(0);
    expect(rpc().names()).toEqual([]);
  });

  it("linkuje adresem kanonicznym; rodzic zagnieżdżony i niewidoczny zostają przy /post/", async () => {
    const { container } = render(tree(view, freshClient()));
    await waitFor(() => expect(hrefsOf(container).length).toBeGreaterThan(0));

    expect(hrefsOf(container)).toEqual(["/blog/wpis-1", "/post/wpis-2", "/post/wpis-3"]);
  });

  it("odczyt z osadzeniem zawodzi: blok ma karty z adresem zapasowym, nie znika", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    db().setResponse("posts", (chain) =>
      selectOf(chain).includes("parent_page:")
        ? fail("permission denied for table pages", "42501")
        : ok(posts(false)),
    );

    const { container } = render(tree(view, freshClient()));
    await waitFor(() => expect(hrefsOf(container).length).toBeGreaterThan(0));

    expect(hrefsOf(container)).toEqual(["/post/wpis-1", "/post/wpis-2", "/post/wpis-3"]);
    expect(db().chainsFor("posts").map(selectOf)).toEqual([SELECT_Z_RODZICEM, SELECT_ZAPASOWY]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("HTML serwera i strona po hydratacji mają te same adresy - z tego samego wiersza", async () => {
    // Serwer: prefetch pod kluczem bloku, render do napisu.
    const serverClient = freshClient();
    await prefetch(serverClient);
    const serverHtml = renderToString(tree(view, serverClient));
    expect(hrefsInHtml(serverHtml)).toEqual(["/blog/wpis-1", "/post/wpis-2", "/post/wpis-3"]);

    // Przeglądarka: stan odwodniony przechodzi przez serializację, a baza od
    // tej chwili ODMAWIA - każdy odczyt po hydratacji zmieniłby adresy albo
    // wywrócił blok, więc równość HTML dowodzi też braku drugiego odczytu.
    const dehydrated = JSON.parse(JSON.stringify(dehydrate(serverClient)));
    const before = db().chainsFor("posts").length;
    db().setResponse("posts", fail("po hydratacji blok nie czyta bazy", "57014"));
    const browserClient = freshClient();
    hydrate(browserClient, dehydrated);

    expect(renderToString(tree(view, browserClient))).toBe(serverHtml);
    const { container } = render(tree(view, browserClient));
    expect(hrefsOf(container)).toEqual(hrefsInHtml(serverHtml));
    expect(db().chainsFor("posts")).toHaveLength(before);
  });
});

describe("blok more-posts w trybie `trending`", () => {
  it("funkcja SQL nie niesie sluga strony-rodzica: karty zostają przy /post/<slug>", async () => {
    rpc().setData("trending_posts", [
      {
        id: "t1",
        slug: "goraczka",
        title_pl: "Gorączka",
        title_en: null,
        cover_image_url: null,
        published_at: "2026-07-01T10:00:00.000Z",
        parent_page_id: "pg-blog",
      },
    ]);
    const { container } = render(
      tree(<MorePostsView strategy="trending" limit={4} lang="pl" />, freshClient()),
    );
    await waitFor(() => expect(hrefsOf(container).length).toBeGreaterThan(0));

    expect(hrefsOf(container)).toEqual(["/post/goraczka"]);
    // Tryb popularności nie dotyka tabeli `posts`, więc nie ma też czego osadzać.
    expect(db().chainsFor("posts")).toHaveLength(0);
  });
});
