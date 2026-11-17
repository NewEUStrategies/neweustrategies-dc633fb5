// Pełne wiersze slotów dla panelu reklam (`adminSlots.ts`).
//
// `ad_slots.notes` nie jest czytelne wprost dla `authenticated` (migracja
// 20261007120100), więc jedyna droga do notatek operatora to
// `admin_list_ad_slots()`. Starej ścieżki `select("*")` już nie ma: po
// migracji kończyła się odmową uprawnień, a brak funkcji to dziś awaria
// wdrożenia, którą panel ma pokazać - nigdy cicho obejść.
import { beforeEach, describe, expect, it } from "vitest";

import { fetchAdminAdSlots } from "@/lib/ads/adminSlots";
import { supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
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

  it.each(["PGRST202", "42883"])(
    "brak funkcji (%s) wraca do panelu jako błąd - bez powrotu do tabeli",
    async (code) => {
      rpc.setError("admin_list_ad_slots", "Could not find the function", code);

      const result = await fetchAdminAdSlots(client());

      expect(result.slots).toEqual([]);
      expect(result.error?.message).toBe("Could not find the function");
      expect(from.chainsFor("ad_slots")).toHaveLength(0);
    },
  );
});
