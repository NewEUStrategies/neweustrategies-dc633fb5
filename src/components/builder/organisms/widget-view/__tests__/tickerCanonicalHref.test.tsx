// PASKI „news-ticker" I „trending-now": ADRES KANONICZNY WPISU.
//
// Oba widgety czytają to samo zapytanie (`newsTickerQueryOptions`) i stoją
// w chrome każdej trasy. Linkowały `/post/<slug>`, czyli adres odpowiadający
// 301 - dodatkowy dokument i dwa odczyty bazy na kliknięcie.
//
// CO TEN PLIK PRZYPINA.
//  1. Strona-rodzic jedzie osadzeniem w TYM SAMYM odczycie wpisów (jedno
//     żądanie `posts`, zero `pages`), a widoki linkują `postHref(wiersz)`.
//  2. Rodzic zagnieżdżony albo niewidoczny zostaje przy `/post/<slug>`.
//  3. Gdy odczyt z osadzeniem zawiedzie, leci ten sam odczyt bez osadzenia:
//     pasek ma pozycje z adresem zapasowym, a nie znika z każdej trasy.
//
// Granice: klient Supabase to rejestrator łańcuchów (prawdziwe zapytanie
// i prawdziwe widoki), react-i18next echuje klucz.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabase";

const sb = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const fromStub = supabaseFromStub();
  sb.from = fromStub;
  return { supabase: { from: fromStub.from } };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
}));

import { fail, ok } from "@/test/supabase";
import { NewsTickerView } from "../NewsTickerView";
import { TrendingNowView } from "../TrendingNowView";
import { TICKER_POST_COLUMNS, TICKER_POST_PLAIN_COLUMNS } from "@/lib/builder/newsTickerQuery";
import { POST_PARENT_PAGE_EMBED } from "@/lib/routing/postHref";
import { resetPostParentPageRead } from "@/lib/routing/postParentPageRead";

function db(): SupabaseFromStub {
  if (sb.from === null) throw new Error("test: atrapa `from` nie zostala utworzona");
  return sb.from;
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
    author_id: null,
    ...(withParentPage ? { parent_page: parent } : {}),
  }));
}

function selectOf(chain: RecordedChain | undefined): string {
  return String(chain?.argsOf("select")?.[0]);
}

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** Adresy pozycji paska bez kopii dekoracyjnych toru (pętla marquee dubluje kafelki). */
function hrefsOf(root: ParentNode): string[] {
  return [
    ...new Set(Array.from(root.querySelectorAll("a[href]"), (a) => a.getAttribute("href") ?? "")),
  ];
}

beforeEach(() => {
  db().reset();
  resetPostParentPageRead();
  db().setResponse("posts", (chain) => ok(posts(selectOf(chain).includes("parent_page:"))));
});
afterEach(cleanup);

describe("zapytanie paska: rodzic w tym samym odczycie", () => {
  it("literał z osadzeniem różni się od zapasowego wyłącznie osadzeniem rodzica", () => {
    expect(TICKER_POST_COLUMNS).toBe(`${TICKER_POST_PLAIN_COLUMNS}, ${POST_PARENT_PAGE_EMBED}`);
    expect(TICKER_POST_PLAIN_COLUMNS).not.toContain("(");
  });

  it("jedno żądanie o wpisy, zero żądań o strony", async () => {
    const { container } = wrap(<NewsTickerView c={{ direction: "horizontal" }} lang="pl" />);
    await waitFor(() => expect(hrefsOf(container).length).toBeGreaterThan(0));

    expect(db().chainsFor("posts")).toHaveLength(1);
    expect(selectOf(db().lastChain("posts"))).toBe(TICKER_POST_COLUMNS);
    expect(db().chainsFor("pages")).toHaveLength(0);
  });
});

describe.each([
  ["news-ticker poziomy", <NewsTickerView key="h" c={{ direction: "horizontal" }} lang="pl" />],
  ["news-ticker pionowy", <NewsTickerView key="v" c={{ direction: "vertical" }} lang="pl" />],
  ["trending-now", <TrendingNowView key="t" c={{}} lang="pl" />],
])("%s", (_name, view) => {
  it("linkuje adresem kanonicznym; rodzic zagnieżdżony i niewidoczny zostają przy /post/", async () => {
    const { container } = wrap(view);
    await waitFor(() => expect(hrefsOf(container).length).toBeGreaterThan(0));

    expect(hrefsOf(container).sort()).toEqual(["/blog/wpis-1", "/post/wpis-2", "/post/wpis-3"]);
  });

  it("odczyt z osadzeniem zawodzi: pasek ma pozycje z adresem zapasowym, nie znika", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    db().setResponse("posts", (chain) =>
      selectOf(chain).includes("parent_page:")
        ? fail("permission denied for table pages", "42501")
        : ok(posts(false)),
    );

    const { container } = wrap(view);
    await waitFor(() => expect(hrefsOf(container).length).toBeGreaterThan(0));

    expect(hrefsOf(container).sort()).toEqual(["/post/wpis-1", "/post/wpis-2", "/post/wpis-3"]);
    const [embedded, plain, ...rest] = db().chainsFor("posts");
    expect(rest).toHaveLength(0);
    expect(selectOf(embedded)).toBe(TICKER_POST_COLUMNS);
    expect(selectOf(plain)).toBe(TICKER_POST_PLAIN_COLUMNS);
    // Poza `select` zapas to TO SAMO zapytanie: filtr, sortowanie, limit.
    expect(plain?.calls.slice(1)).toEqual(embedded?.calls.slice(1));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
