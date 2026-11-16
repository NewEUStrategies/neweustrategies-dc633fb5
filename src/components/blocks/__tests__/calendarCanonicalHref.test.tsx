// BLOK KALENDARZA: ADRES KANONICZNY DNIA PUBLIKACJI.
//
// Dzień z publikacją linkował `/post/<slug>`, czyli adres odpowiadający 301 -
// dodatkowy dokument i dwa odczyty bazy, które `AppLink` płacił już przy
// najechaniu kursorem.
//
// CO TEN PLIK PRZYPINA - na PRAWDZIWYM zapytaniu i PRAWDZIWYM widoku naraz
// (`calendarView.test.tsx` podmienia zapytanie, a `blocksData.test.ts` nie
// renderuje nic, więc żaden z nich nie widzi szwu między nimi):
//  1. Strona-rodzic jedzie osadzeniem w TYM SAMYM odczycie wpisów (jedno
//     żądanie `posts`, zero `pages`, zero RPC ścieżek), a dzień linkuje
//     `postHref(wiersz)`.
//  2. Rodzic zagnieżdżony albo niewidoczny zostaje przy `/post/<slug>`.
//  3. Gdy odczyt z osadzeniem zawiedzie, leci ten sam odczyt bez osadzenia:
//     kalendarz ma dni z adresem zapasowym, a nie pustą siatkę.
//  4. HTML serwera i strona po hydratacji mają te same adresy: obie strony
//     liczą je z tego samego wiersza w stanie odwodnionym.
//
// Granice: klient Supabase to rejestrator łańcuchów i RPC, router to atrapa
// odnośnika. Godziny publikacji są przed południem UTC, więc dzień w strefie
// serwisu (Warszawa) jest ten sam co w UTC.
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
    useRouter: () => ({ navigate: () => undefined, preloadRoute: async () => undefined }),
  };
});

import { fail, ok } from "@/test/supabase";
import { calendarBlockQueryOptions, calendarTarget } from "@/lib/queries/blocks";
import { POST_PARENT_PAGE_EMBED } from "@/lib/routing/postHref";
import { resetPostParentPageRead } from "@/lib/routing/postParentPageRead";
import { CalendarView } from "../CalendarView";

/** `select` kalendarza Z osadzeniem strony-rodzica - dosłownie, znak po znaku. */
const SELECT_Z_RODZICEM =
  "slug, published_at, parent_page:pages!posts_parent_page_id_fkey(slug, parent_id)";
/** Ten sam `select` bez osadzenia: odczyt zapasowy i literał sprzed zmiany. */
const SELECT_ZAPASOWY = "slug, published_at";

const MONTH = "2026-07";

function db(): SupabaseFromStub {
  if (sb.from === null) throw new Error("test: atrapa `from` nie została utworzona");
  return sb.from;
}
function rpc(): SupabaseRpcStub {
  if (sb.rpc === null) throw new Error("test: atrapa `rpc` nie została utworzona");
  return sb.rpc;
}

/** Trzy dni: wpis pod `/blog`, pod stroną zagnieżdżoną i pod rodzicem niewidocznym. */
const PARENTS = [
  { slug: "blog", parent_id: null },
  { slug: "energetyka", parent_id: "pg-analizy" },
  null,
];

function posts(withParentPage: boolean): Array<Record<string, unknown>> {
  return PARENTS.map((parent, i) => ({
    slug: `wpis-${i + 1}`,
    published_at: `2026-07-0${i + 1}T10:00:00.000Z`,
    ...(withParentPage ? { parent_page: parent } : {}),
  }));
}

function selectOf(chain: RecordedChain | undefined): string {
  return String(chain?.argsOf("select")?.[0]);
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function tree(client: QueryClient): ReactElement {
  return (
    <QueryClientProvider client={client}>
      <CalendarView month={MONTH} lang="pl" />
    </QueryClientProvider>
  );
}

/** Adresy dni w kolejności DOM. */
function hrefsOf(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll("a[href]"), (a) => a.getAttribute("href") ?? "");
}

/** Adresy odnośników z napisu HTML (render serwera nie ma drzewa DOM). */
function hrefsInHtml(html: string): string[] {
  return Array.from(html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g), (m) => m[1] ?? "");
}

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

describe("blok kalendarza: adres kanoniczny dnia", () => {
  it("literał z osadzeniem różni się od zapasowego wyłącznie osadzeniem rodzica", () => {
    expect(SELECT_Z_RODZICEM).toBe(`${SELECT_ZAPASOWY}, ${POST_PARENT_PAGE_EMBED}`);
  });

  it("jedno żądanie o wpisy z osadzeniem rodzica, zero żądań o strony i zero RPC", async () => {
    const { container } = render(tree(freshClient()));
    await waitFor(() => expect(hrefsOf(container).length).toBeGreaterThan(0));

    expect(db().chainsFor("posts")).toHaveLength(1);
    expect(selectOf(db().lastChain("posts"))).toBe(SELECT_Z_RODZICEM);
    expect(db().chainsFor("pages")).toHaveLength(0);
    expect(rpc().names()).toEqual([]);
  });

  it("dzień linkuje adresem kanonicznym; rodzic zagnieżdżony i niewidoczny zostają przy /post/", async () => {
    const { container } = render(tree(freshClient()));
    await waitFor(() => expect(hrefsOf(container).length).toBeGreaterThan(0));

    expect(hrefsOf(container)).toEqual(["/blog/wpis-1", "/post/wpis-2", "/post/wpis-3"]);
  });

  it("odczyt z osadzeniem zawodzi: te same dni z adresem zapasowym, nie pusta siatka", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    db().setResponse("posts", (chain) =>
      selectOf(chain).includes("parent_page:")
        ? fail("permission denied for table pages", "42501")
        : ok(posts(false)),
    );

    const { container } = render(tree(freshClient()));
    await waitFor(() => expect(hrefsOf(container).length).toBeGreaterThan(0));

    expect(hrefsOf(container)).toEqual(["/post/wpis-1", "/post/wpis-2", "/post/wpis-3"]);
    const [embedded, plain, ...rest] = db().chainsFor("posts");
    expect(rest).toHaveLength(0);
    expect(selectOf(embedded)).toBe(SELECT_Z_RODZICEM);
    expect(selectOf(plain)).toBe(SELECT_ZAPASOWY);
    // Poza `select` zapas to TO SAMO zapytanie: okno miesiąca, sortowanie, sufit.
    expect(plain?.calls.slice(1)).toEqual(embedded?.calls.slice(1));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("HTML serwera i strona po hydratacji mają te same adresy - z tego samego wiersza", async () => {
    // Serwer: prefetch pod kluczem bloku (jak `prefetchBlockQueries`), render do napisu.
    const serverClient = freshClient();
    await serverClient.prefetchQuery(calendarBlockQueryOptions(calendarTarget(MONTH)));
    const serverHtml = renderToString(tree(serverClient));
    expect(hrefsInHtml(serverHtml)).toEqual(["/blog/wpis-1", "/post/wpis-2", "/post/wpis-3"]);

    // Przeglądarka: stan odwodniony przechodzi przez serializację, a baza od
    // tej chwili ODMAWIA - odczyt po hydratacji zmieniłby adresy albo opróżnił
    // siatkę, więc równość HTML dowodzi też braku drugiego odczytu.
    const dehydrated = JSON.parse(JSON.stringify(dehydrate(serverClient)));
    const before = db().chainsFor("posts").length;
    db().setResponse("posts", fail("po hydratacji kalendarz nie czyta bazy", "57014"));
    const browserClient = freshClient();
    hydrate(browserClient, dehydrated);

    expect(renderToString(tree(browserClient))).toBe(serverHtml);
    const { container } = render(tree(browserClient));
    expect(hrefsOf(container)).toEqual(hrefsInHtml(serverHtml));
    expect(db().chainsFor("posts")).toHaveLength(before);
  });
});
