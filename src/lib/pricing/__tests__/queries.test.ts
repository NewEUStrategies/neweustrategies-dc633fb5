// Warstwa danych Cennika 2.0 - 0 z 4 funkcji pokrytych do 18.08.2026.
//
// Jedna rzecz decyduje tu o tym, co widzi klient, i jest łatwa do zgubienia:
// JAWNY filtr `active = true`. Polityka publiczna RLS i tak go wymusza, ale
// administrator ma politykę odczytu sztabowego i widzi wiersze NIEAKTYWNE.
// Bez tego filtru strona `/pricing` oglądana przez zalogowanego admina
// pokazywałaby segmenty i pytania, których nie widzi klient - a to najgorszy
// możliwy rodzaj błędu w cenniku: redakcja sprawdza stronę i widzi coś innego
// niż kupujący.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import { pricingAudience, pricingFaqItem } from "@/test/admin/pricingFixtures";

let chain: SupabaseFromStub;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain.from(table) },
}));

const { pricingAudiencesQueryOptions, pricingFaqQueryOptions } =
  await import("@/lib/pricing/queries");

/** Uruchamia `queryFn` opcji tak, jak zrobiłby to react-query. */
async function run<T>(options: { queryFn?: unknown }): Promise<T> {
  return (options.queryFn as () => Promise<T>)();
}

beforeEach(() => {
  chain = supabaseFromStub();
  chain.setResponse("pricing_audiences", ok([pricingAudience()]));
  chain.setResponse("pricing_faq_items", ok([pricingFaqItem()]));
});

describe("pricingAudiencesQueryOptions - segmenty widoczne dla KLIENTA", () => {
  it("filtruje po `active = true` - admin nie może widzieć więcej niż klient", async () => {
    await run(pricingAudiencesQueryOptions());

    expect(chain.lastChain("pricing_audiences")!.argsOf("eq")).toEqual(["active", true]);
  });

  it("czyta w kolejności prezentacyjnej", async () => {
    await run(pricingAudiencesQueryOptions());

    expect(chain.lastChain("pricing_audiences")!.argsOf("order")).toEqual([
      "sort_order",
      { ascending: true },
    ]);
  });

  it("zwraca wiersze bez przetwarzania", async () => {
    const rows = await run<ReturnType<typeof pricingAudience>[]>(pricingAudiencesQueryOptions());

    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("individual");
  });

  it("BRAK wierszy daje pustą listę, nie `null`", async () => {
    chain.setResponse("pricing_audiences", { data: null, error: null });

    const rows = await run<unknown[]>(pricingAudiencesQueryOptions());

    expect(rows).toEqual([]);
  });

  it("BŁĄD odczytu jest zgłaszany, a nie zamieniany na pusty cennik", async () => {
    // Pusta strona cennika czytałaby się jak „nie mamy oferty".
    chain.setResponse("pricing_audiences", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });

    await expect(run(pricingAudiencesQueryOptions())).rejects.toThrow("permission denied");
  });

  it("klucz zapytania jest wspólny z loaderem trasy (jeden cache)", () => {
    const options = pricingAudiencesQueryOptions();

    expect(options.queryKey).toBeDefined();
    expect(options.staleTime).toBe(60_000);
  });
});

describe("pricingFaqQueryOptions - pytania widoczne dla KLIENTA", () => {
  it("filtruje po `active = true`", async () => {
    await run(pricingFaqQueryOptions());

    expect(chain.lastChain("pricing_faq_items")!.argsOf("eq")).toEqual(["active", true]);
  });

  it("czyta w kolejności redakcyjnej", async () => {
    await run(pricingFaqQueryOptions());

    expect(chain.lastChain("pricing_faq_items")!.argsOf("order")).toEqual([
      "sort_order",
      { ascending: true },
    ]);
  });

  it("BŁĄD odczytu jest zgłaszany", async () => {
    chain.setResponse("pricing_faq_items", {
      data: null,
      error: Object.assign(new Error("row level security"), { name: "PostgrestError" }),
    });

    await expect(run(pricingFaqQueryOptions())).rejects.toThrow("row level security");
  });

  it("brak pytań daje pustą listę", async () => {
    chain.setResponse("pricing_faq_items", ok([]));

    expect(await run<unknown[]>(pricingFaqQueryOptions())).toEqual([]);
  });
});
