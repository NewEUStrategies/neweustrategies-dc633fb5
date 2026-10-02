// ODCZYT TREŚCI KOKPITU SEO - wspólny dla `/admin/seo/` i `/admin/seo/content`.
//
// PRZEDMIOT DOWODU:
//   1. KOMPLETNOŚĆ LISTY. `.limit()` bez liczności sprawiał, że kafelki serwisu
//      z 1200 wpisami liczyły się z 1000 bez słowa o reszcie. `seoContentCoverage`
//      rozróżnia teraz trzy stany - i „nie wiem" NIE jest „komplet".
//   2. JEDNO ŻĄDANIE NA TABELĘ z licznością (`count: "exact"` w tym samym
//      zapytaniu, nie osobne `head: true`), zawężone do tenanta, z kolejnością
//      tabeli - bo przy przycięciu to kolejność decyduje, które wiersze się
//      zmieściły.
//   3. KLUCZE CACHE zgodne z `invalidate.ts` - zapis wpisu odświeża oba ekrany.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SEO_CONTENT_LIMITS,
  fetchSeoContentPage,
  seoContentCoverage,
  seoContentQueryKey,
  seoContentQueryOptions,
  type SeoContentPage,
  type SeoContentRow,
} from "@/lib/seo/seoContentQuery";

const h = vi.hoisted(() => ({
  /** Każde wywołanie metody łańcucha, w kolejności. */
  calls: [] as Array<[string, ...unknown[]]>,
  response: { data: [] as unknown[] | null, error: null as Error | null, count: 0 as unknown },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      h.calls.push(["from", table]);
      const link: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "order", "limit"]) {
        link[method] = (...args: unknown[]) => {
          h.calls.push([method, ...args]);
          return link;
        };
      }
      link.then = (resolve: (value: unknown) => unknown) => resolve(h.response);
      return link;
    },
  },
}));

beforeEach(() => {
  h.calls = [];
  h.response = { data: [], error: null, count: 0 };
});

function row(id: string): SeoContentRow {
  return {
    id,
    slug: id,
    status: "published",
    title_pl: id,
    title_en: id,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
  };
}

function page(rows: number, total: number | null): SeoContentPage {
  return { rows: Array.from({ length: rows }, (_, i) => row(`r-${i}`)), total };
}

describe("seoContentCoverage", () => {
  it("total > pobrane -> `truncated` z łączną liczbą z bazy", () => {
    expect(seoContentCoverage([page(1000, 1200), page(3, 3)])).toEqual({
      state: "truncated",
      shown: 1003,
      total: 1203,
    });
  });

  it("total == pobrane (także dokładnie na limicie) -> `complete`, bez flagi", () => {
    expect(seoContentCoverage([page(SEO_CONTENT_LIMITS.posts, SEO_CONTENT_LIMITS.posts)])).toEqual({
      state: "complete",
      shown: 1000,
      total: 1000,
    });
    expect(seoContentCoverage([page(2, 2), page(0, 0)])).toEqual({
      state: "complete",
      shown: 2,
      total: 2,
    });
  });

  it("pusty serwis to komplet zerowy, nie „nieznane”", () => {
    expect(seoContentCoverage([page(0, 0), page(0, 0)])).toEqual({
      state: "complete",
      shown: 0,
      total: 0,
    });
  });

  it("liczność `null` w JEDNEJ tabeli -> `unknown`, nie komplet", () => {
    // Brak liczności to brak wiedzy. Uznanie go za komplet przywracałoby
    // dokładnie ten błąd, który ten moduł usuwa - tylko w innym przebraniu.
    expect(seoContentCoverage([page(10, null), page(3, 3)])).toEqual({
      state: "unknown",
      shown: 13,
      total: null,
    });
  });

  it("tabela, która nie dojechała (undefined) -> `unknown`", () => {
    expect(seoContentCoverage([page(3, 3), undefined])).toEqual({
      state: "unknown",
      shown: 3,
      total: null,
    });
  });

  it("liczność mniejsza od pobranych (wyścig) nie daje ujemnej reszty", () => {
    expect(seoContentCoverage([page(5, 4)])).toEqual({ state: "complete", shown: 5, total: 5 });
  });
});

describe("fetchSeoContentPage", () => {
  it("wpisy: jedno zapytanie z `count: exact`, tenant, bez kosza, od najświeższych, limit", async () => {
    h.response = { data: [row("a")], error: null, count: 1500 };
    const result = await fetchSeoContentPage("posts", "t-1");
    expect(result).toEqual({ rows: [row("a")], total: 1500 });
    expect(h.calls[0]).toEqual(["from", "posts"]);
    expect(h.calls[1]?.[0]).toBe("select");
    expect(h.calls[1]?.[2]).toEqual({ count: "exact" });
    expect(h.calls.slice(2)).toEqual([
      ["eq", "tenant_id", "t-1"],
      ["is", "deleted_at", null],
      ["order", "published_at", { ascending: false, nullsFirst: false }],
      ["limit", SEO_CONTENT_LIMITS.posts],
    ]);
    // Liczność jedzie w tym samym żądaniu - bez osobnego `head: true`.
    expect(h.calls.filter(([method]) => method === "from")).toHaveLength(1);
  });

  it("strony: kolejność menu i własny limit", async () => {
    await fetchSeoContentPage("pages", "t-1");
    expect(h.calls[0]).toEqual(["from", "pages"]);
    expect(h.calls.slice(2)).toEqual([
      ["eq", "tenant_id", "t-1"],
      ["is", "deleted_at", null],
      ["order", "menu_order"],
      ["limit", SEO_CONTENT_LIMITS.pages],
    ]);
  });

  it("brak liczności w odpowiedzi -> `total: null` (nieznane), nie liczba pobranych", async () => {
    h.response = { data: [row("a")], error: null, count: null };
    expect(await fetchSeoContentPage("posts", "t-1")).toEqual({ rows: [row("a")], total: null });
    h.response = { data: [row("a")], error: null, count: undefined };
    expect((await fetchSeoContentPage("pages", "t-1")).total).toBeNull();
  });

  it("`data: null` bez błędu schodzi na pustą listę", async () => {
    h.response = { data: null, error: null, count: 0 };
    expect(await fetchSeoContentPage("pages", "t-1")).toEqual({ rows: [], total: 0 });
  });

  it("błąd odczytu jest RZUCANY - ekran ma go pokazać, a nie policzyć zer", async () => {
    h.response = { data: null, error: new Error("PostgREST padł"), count: null };
    await expect(fetchSeoContentPage("posts", "t-1")).rejects.toThrow("PostgREST padł");
  });
});

describe("seoContentQueryKey / seoContentQueryOptions", () => {
  it("klucze mają prefiksy, które unieważnia `invalidate.ts`", () => {
    expect(seoContentQueryKey("posts", "t-1")).toEqual(["admin-seo-posts", "t-1"]);
    expect(seoContentQueryKey("pages", "t-1")).toEqual(["admin-seo-pages", "t-1"]);
  });

  it("opcje nie ruszają bez tenanta", () => {
    expect(seoContentQueryOptions("posts", "").enabled).toBe(false);
    expect(seoContentQueryOptions("posts", "t-1").enabled).toBe(true);
  });
});
