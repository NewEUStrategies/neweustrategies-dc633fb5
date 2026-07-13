import { describe, it, expect, vi } from "vitest";

// Klient Supabase jest tworzony eagernie przy imporcie modułu i bez zmiennych
// środowiskowych rzuca - mockujemy go, żeby przetestować, że moduły warstwy
// danych ładują się bez błędu i że fabryki query options budują poprawny
// kształt (queryKey + funkcje), bez sięgania do sieci.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({}) }),
    }),
    rpc: () => ({}),
  },
}));

describe("experts data-layer factories (smoke)", () => {
  it("expertHubQueryOptions builds a stable, slug-scoped query key", async () => {
    const { expertHubQueryOptions } = await import("@/lib/experts/queries");
    const opts = expertHubQueryOptions("emily-harding");
    expect(opts.queryKey).toEqual(["public", "expert", "emily-harding"]);
    expect(typeof opts.queryFn).toBe("function");
  });

  it("expertsDirectoryQueryOptions builds a directory query key", async () => {
    const { expertsDirectoryQueryOptions } = await import("@/lib/experts/directory");
    const opts = expertsDirectoryQueryOptions();
    expect(opts.queryKey).toEqual(["public", "experts-directory"]);
    expect(typeof opts.queryFn).toBe("function");
  });
});
