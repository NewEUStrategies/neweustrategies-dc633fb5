// ZAPISANE (ZALOGOWANY): ADRES KANONICZNY KARTY WPISU.
//
// Karta zapisanego wpisu linkowała `/post/<slug>`, czyli adres odpowiadający
// 301 - dodatkowy dokument i dwa odczyty bazy przy kliknięciu.
//
// CO TEN PLIK PRZYPINA - na PRAWDZIWYM zapytaniu sekcji i PRAWDZIWEJ karcie
// (`readingListRoute.test.tsx` montuje całą trasę i pilnuje stanów sekcji,
// ale nie adresu wpisu):
//  1. Strona-rodzic jedzie osadzeniem w TYM SAMYM odczycie zapisanych wpisów
//     (jedno żądanie `posts`, zero RPC ścieżek), a karta linkuje
//     `postHref(wiersz)`.
//  2. Rodzic zagnieżdżony albo niewidoczny zostaje przy `/post/<slug>`.
//  3. Gdy odczyt z osadzeniem zawiedzie, leci ten sam odczyt bez osadzenia:
//     sekcja ma karty z adresem zapasowym, a nie komunikat awarii.
//
// Granice: klient Supabase to rejestrator łańcuchów i RPC, zakładki to atrapa
// hooka, router to atrapa odnośnika, i18n zwraca klucze.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RecordedChain, SupabaseFromStub, SupabaseRpcStub } from "@/test/supabase";

const sb = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
  bookmarks: [] as Array<{ id: string; entity_type: "post" | "page"; entity_id: string }>,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, supabaseRpcStub } = await import("@/test/supabase");
  const fromStub = supabaseFromStub();
  const rpcStub = supabaseRpcStub();
  sb.from = fromStub;
  sb.rpc = rpcStub;
  return { supabase: { from: fromStub.from, rpc: rpcStub.rpc } };
});
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-reading-list", () => ({}));
vi.mock("@/hooks/useBookmarks", () => ({
  useBookmarks: () => ({
    data: sb.bookmarks,
    isLoading: false,
    error: null,
    refetch: () => undefined,
  }),
}));

import { fail, ok } from "@/test/supabase";
import { POST_PARENT_PAGE_EMBED } from "@/lib/routing/postHref";
import { resetPostParentPageRead } from "@/lib/routing/postParentPageRead";
import { SavedSection } from "../SavedSection";

/** `select` zapisanych wpisów Z osadzeniem strony-rodzica - dosłownie, znak po znaku. */
const SELECT_Z_RODZICEM =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id, is_sponsored, sponsored_kind, sponsored_affiliate, parent_page:pages!posts_parent_page_id_fkey(slug, parent_id)";
/** Ten sam `select` bez osadzenia: odczyt zapasowy i literał sprzed zmiany. */
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

/** Trzy zapisane wpisy: pod `/blog`, pod stroną zagnieżdżoną i pod rodzicem niewidocznym. */
const PARENTS = [
  { slug: "blog", parent_id: null },
  { slug: "energetyka", parent_id: "pg-analizy" },
  null,
];

function posts(withParentPage: boolean): Array<Record<string, unknown>> {
  return PARENTS.map((parent, i) => ({
    id: `p${i + 1}`,
    slug: `wpis-${i + 1}`,
    title_pl: `Zapisany ${i + 1}`,
    title_en: null,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    published_at: "2026-08-01T10:00:00.000Z",
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

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SavedSection columns={3} lang="pl" />
    </QueryClientProvider>,
  );
}

/** Adresy kart wpisów w kolejności DOM. */
async function cardHrefs(): Promise<string[]> {
  await screen.findByRole("link", { name: /Zapisany 1/ });
  return screen
    .getAllByRole("link")
    .map((a) => a.getAttribute("href") ?? "")
    .filter((href) => href !== "");
}

beforeEach(() => {
  db().reset();
  rpc().reset();
  resetPostParentPageRead();
  sb.bookmarks = ["p1", "p2", "p3"].map((id) => ({
    id: `b-${id}`,
    entity_type: "post" as const,
    entity_id: id,
  }));
  db().setResponse("posts", (chain) => ok(posts(selectOf(chain).includes("parent_page:"))));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("zapisane: adres kanoniczny karty wpisu", () => {
  it("literał z osadzeniem różni się od zapasowego wyłącznie osadzeniem rodzica", () => {
    expect(SELECT_Z_RODZICEM).toBe(`${SELECT_ZAPASOWY}, ${POST_PARENT_PAGE_EMBED}`);
  });

  it("jedno żądanie o wpisy z osadzeniem rodzica, zero RPC ścieżek", async () => {
    mount();
    await cardHrefs();

    expect(db().chainsFor("posts")).toHaveLength(1);
    expect(selectOf(db().lastChain("posts"))).toBe(SELECT_Z_RODZICEM);
    expect(db().lastChain("posts")?.argsOf("in")).toEqual(["id", ["p1", "p2", "p3"]]);
    expect(rpc().names()).toEqual([]);
  });

  it("karta linkuje adresem kanonicznym; rodzic zagnieżdżony i niewidoczny zostają przy /post/", async () => {
    mount();

    expect(await cardHrefs()).toEqual(["/blog/wpis-1", "/post/wpis-2", "/post/wpis-3"]);
  });

  it("odczyt z osadzeniem zawodzi: te same karty z adresem zapasowym, nie awaria", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    db().setResponse("posts", (chain) =>
      selectOf(chain).includes("parent_page:")
        ? fail("permission denied for table pages", "42501")
        : ok(posts(false)),
    );

    mount();

    expect(await cardHrefs()).toEqual(["/post/wpis-1", "/post/wpis-2", "/post/wpis-3"]);
    expect(screen.queryByRole("alert")).toBeNull();
    const [embedded, plain, ...rest] = db().chainsFor("posts");
    expect(rest).toHaveLength(0);
    expect(selectOf(embedded)).toBe(SELECT_Z_RODZICEM);
    expect(selectOf(plain)).toBe(SELECT_ZAPASOWY);
    // Poza `select` zapas to TO SAMO zapytanie: identyfikatory, status, kosz.
    expect(plain?.calls.slice(1)).toEqual(embedded?.calls.slice(1));
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
  });
});
