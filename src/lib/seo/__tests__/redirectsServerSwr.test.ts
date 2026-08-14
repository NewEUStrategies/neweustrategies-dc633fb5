// SWR indeksu przekierowań: middleware 301-ek stoi PRZED cache dokumentów,
// więc blokujące odświeżanie indeksu (co 30 s per izolat) dokładało pełny
// round-trip do TTFB, zanim NES Edge Cache mógł odpowiedzieć. Kontrakt:
// nieświeży indeks serwuje natychmiast, odświeżenie biegnie w tle,
// zimny izolat blokuje jednorazowo (301-ki pozostają poprawne od pierwszego
// żądania).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRedirectIndexForTenant, invalidateRedirectCache } from "@/lib/seo/redirects.server";

const state = vi.hoisted(() => ({
  rows: [] as Array<{
    id: string;
    source_path: string;
    target_path: string;
    status_code: number;
  }>,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: () => Promise.resolve({ data: state.rows, error: null }),
          }),
        }),
      }),
    }),
  },
}));

const RULE_A = { id: "r1", source_path: "/stary", target_path: "/nowy", status_code: 301 };
const RULE_B = { id: "r2", source_path: "/inny", target_path: "/cel", status_code: 301 };

beforeEach(() => {
  invalidateRedirectCache();
  state.rows = [RULE_A];
});

describe("getRedirectIndexForTenant - stale-while-revalidate", () => {
  it("zimny izolat blokuje jednorazowo i widzi reguły od pierwszego żądania", async () => {
    const index = await getRedirectIndexForTenant("t-1");
    expect(index.exact.has("/stary")).toBe(true);
  });

  it("po TTL serwuje nieświeży indeks NATYCHMIAST, a odświeżenie biegnie w tle", async () => {
    vi.useFakeTimers();
    try {
      const fresh = await getRedirectIndexForTenant("t-1");
      expect(fresh.exact.has("/inny")).toBe(false);

      // Nowa reguła w bazie + wyjście poza TTL (30 s).
      state.rows = [RULE_A, RULE_B];
      vi.advanceTimersByTime(31_000);

      // SWR: stary indeks od ręki - żadnego round-tripu na ścieżce żądania.
      const stale = await getRedirectIndexForTenant("t-1");
      expect(stale.exact.has("/inny")).toBe(false);

      // Tło domyka odświeżenie; kolejny odczyt widzi nową regułę.
      await vi.advanceTimersByTimeAsync(0);
      const refreshed = await getRedirectIndexForTenant("t-1");
      expect(refreshed.exact.has("/inny")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("indeksy tenantów są rozdzielne (izolacja najemcy w cache)", async () => {
    const a = await getRedirectIndexForTenant("t-1");
    state.rows = [RULE_B];
    const b = await getRedirectIndexForTenant("t-2");
    expect(a.exact.has("/stary")).toBe(true);
    expect(b.exact.has("/stary")).toBe(false);
    expect(b.exact.has("/inny")).toBe(true);
  });
});
