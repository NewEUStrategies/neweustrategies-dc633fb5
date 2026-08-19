// Renumeracja kolejności w listach redakcyjnych - 0 z 1 funkcji pokrytej
// do 18.08.2026 (reguła mieszkała w pliku trasy `/admin/pricing`, 1821 linii).
//
// Kolejność decyduje o tym, co klient widzi PIERWSZE: który segment otwiera
// cennik, które pytanie FAQ stoi na górze, który powód rezygnacji jest pierwszy
// pod ręką. Te testy pilnują dwóch rzeczy naraz: że przesunięcie faktycznie
// zmienia kolejność w bazie ORAZ że nie kosztuje więcej zapytań, niż trzeba.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";

let chain: SupabaseFromStub;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => chain.from(table) },
}));

const { persistOrder } = await import("@/lib/admin/sortOrder");

/** Wiersze o kolejności 0, 10, 20, ... - tak numeruje je `persistOrder`. */
function rows(count: number): { id: string; sort_order: number }[] {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, sort_order: i * 10 }));
}

/** Pary [id, docelowy sort_order] w kolejności wykonanych UPDATE-ów. */
function updates(): [string, number][] {
  return chain.chainsFor("pricing_audiences").map((call) => {
    const patch = call.argsOf("update")?.[0] as { sort_order: number };
    const id = call.argsOf("eq")?.[1] as string;
    return [id, patch.sort_order];
  });
}

beforeEach(() => {
  chain = supabaseFromStub();
  chain.setResponse("pricing_audiences", ok([]));
  chain.setResponse("pricing_faq_items", ok([]));
  chain.setResponse("retention_reasons", ok([]));
});

describe("persistOrder - skutek przesunięcia", () => {
  it("przesunięcie w górę zamienia miejscami DWA sąsiednie wiersze", async () => {
    await persistOrder("pricing_audiences", rows(4), { fromIndex: 2, toIndex: 1 });

    expect(updates()).toEqual([
      ["row-2", 10],
      ["row-1", 20],
    ]);
  });

  it("przesunięcie w dół zamienia te same dwa wiersze w drugą stronę", async () => {
    await persistOrder("pricing_audiences", rows(4), { fromIndex: 1, toIndex: 2 });

    expect(updates()).toEqual([
      ["row-2", 10],
      ["row-1", 20],
    ]);
  });

  it("przeniesienie z końca na początek przenumerowuje WSZYSTKIE wiersze", async () => {
    await persistOrder("pricing_audiences", rows(3), { fromIndex: 2, toIndex: 0 });

    expect(updates()).toEqual([
      ["row-2", 0],
      ["row-0", 10],
      ["row-1", 20],
    ]);
  });

  it("przesunięcie na własne miejsce NIE generuje ani jednego zapytania", async () => {
    await persistOrder("pricing_audiences", rows(5), { fromIndex: 3, toIndex: 3 });

    expect(chain.chainsFor("pricing_audiences")).toHaveLength(0);
    expect(updates()).toEqual([]);
  });
});

describe("persistOrder - koszt zapisu", () => {
  it("przy dziesięciu wierszach przesunięcie sąsiada to DWA zapytania, nie dziesięć", async () => {
    await persistOrder("pricing_audiences", rows(10), { fromIndex: 8, toIndex: 9 });

    expect(chain.chainsFor("pricing_audiences")).toHaveLength(2);
    expect(updates().map(([id]) => id)).toEqual(["row-9", "row-8"]);
  });

  it("wiersze o kolejności rozjechanej z siatką co 10 są naprawiane przy okazji", async () => {
    // Kolejność 0, 5, 7 (np. po ręcznym SQL-u) - po przesunięciu wszystkie
    // wracają na siatkę 0/10/20, więc następne przesunięcie znów jest tanie.
    const messy = [
      { id: "a", sort_order: 0 },
      { id: "b", sort_order: 5 },
      { id: "c", sort_order: 7 },
    ];

    await persistOrder("pricing_audiences", messy, { fromIndex: 0, toIndex: 1 });

    expect(updates()).toEqual([
      ["b", 0],
      ["a", 10],
      ["c", 20],
    ]);
  });
});

describe("persistOrder - tabela i błędy", () => {
  it("zapisuje do TEJ tabeli, którą wskazano (pytania FAQ, nie segmenty)", async () => {
    await persistOrder("pricing_faq_items", rows(2), { fromIndex: 0, toIndex: 1 });

    expect(chain.chainsFor("pricing_faq_items")).toHaveLength(2);
    expect(chain.chainsFor("pricing_audiences")).toHaveLength(0);
  });

  it("obsługuje też powody rezygnacji", async () => {
    await persistOrder("retention_reasons", rows(2), { fromIndex: 1, toIndex: 0 });

    expect(chain.chainsFor("retention_reasons")).toHaveLength(2);
    expect(chain.lastChain("retention_reasons")!.has("update")).toBe(true);
  });

  it("BŁĄD ZAPISU przerywa renumerację, zamiast ją cicho dokończyć", async () => {
    // Gdyby błąd był pomijany, część wierszy dostałaby nową kolejność, a część
    // starą - lista w panelu i lista u klienta rozjechałyby się bez śladu.
    chain.setResponse("pricing_audiences", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });

    await expect(
      persistOrder("pricing_audiences", rows(4), { fromIndex: 3, toIndex: 0 }),
    ).rejects.toThrow("permission denied");
    expect(chain.chainsFor("pricing_audiences")).toHaveLength(1);
  });
});
