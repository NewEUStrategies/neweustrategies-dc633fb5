// Pełne wiersze slotów dla panelu reklam (`adminSlots.ts`).
//
// `ad_slots.notes` nie jest czytelne wprost dla `authenticated` (migracja
// 20261007120100), więc jedyna droga do notatek operatora to
// `admin_list_ad_slots()`. Stara ścieżka `select("*")` wolno użyć WYŁĄCZNIE
// przed migracją - po niej skończyłaby się odmową uprawnień.
import { beforeEach, describe, expect, it } from "vitest";

import { fetchAdminAdSlots } from "@/lib/ads/adminSlots";
import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const SLOT = {
  id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  tenant_id: "tttttttt-1111-4111-8111-tttttttttttt",
  name: "Baner glowny",
  kind: "html",
  status: "active",
  notes: "kampania Q1",
};

let from: SupabaseFromStub;
let rpc: SupabaseRpcStub;
const client = () => ({ from: from.from, rpc: rpc.rpc }) as never;

beforeEach(() => {
  from = supabaseFromStub();
  rpc = supabaseRpcStub();
});

describe("fetchAdminAdSlots", () => {
  it("czyta przez funkcję redakcji i NIE dotyka tabeli", async () => {
    rpc.setData("admin_list_ad_slots", [SLOT]);

    expect(await fetchAdminAdSlots(client())).toEqual({ slots: [SLOT], error: null });
    expect(from.chainsFor("ad_slots")).toHaveLength(0);
  });

  it("odmowa uprawnień (42501) wraca do panelu - bez cichego powrotu do tabeli", async () => {
    rpc.setError("admin_list_ad_slots", "forbidden", "42501");

    const result = await fetchAdminAdSlots(client());

    expect(result.slots).toEqual([]);
    expect(result.error?.message).toBe("forbidden");
    expect(from.chainsFor("ad_slots")).toHaveLength(0);
  });

  it("OKNO WDROŻENIA (PGRST202): tabela jak dawniej, od najnowszych", async () => {
    rpc.setError("admin_list_ad_slots", "Could not find the function", "PGRST202");
    from.setResponse("ad_slots", ok([SLOT]));

    expect(await fetchAdminAdSlots(client())).toEqual({ slots: [SLOT], error: null });
    const chain = from.lastChain("ad_slots");
    expect(chain?.argsOf("select")).toEqual(["*"]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
  });

  it("okno wdrożenia z błędem tabeli zwraca ten błąd", async () => {
    rpc.setError("admin_list_ad_slots", "Could not find the function", "PGRST202");
    from.setResponse("ad_slots", fail("timeout"));

    const result = await fetchAdminAdSlots(client());

    expect(result.slots).toEqual([]);
    expect(result.error?.message).toBe("timeout");
  });
});
