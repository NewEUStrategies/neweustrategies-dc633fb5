// ZAPIS UPRAWNIENIA ZE STANU OPERATORA (`syncEntitlementState`) - jedyny most
// między `subscriptions` (webhook) a `user_subscriptions`, które czyta
// `has_content_access()`. Mapowanie statusów przybija osobno
// `entitlementSync.server.test.ts`; ten plik przybija ZAPIS.
//
// JAKIE RYZYKA:
//   * DUPLIKAT UPRAWNIENIA. Kolejne zdarzenie tej samej subskrypcji ma
//     zaktualizować JEDEN wiersz po `external_ref`, a nie dopisać drugi.
//   * WSKRZESZENIE PO ZWROCIE. Uprawnienie odebrane po zwrocie jest
//     ostateczne - spóźnione zdarzenie nie przywraca płatnego dostępu.
//   * POZORNY SUKCES. Błąd odczytu albo zapisu MUSI polecieć wyjątkiem
//     (webhook zapisze `failed`, operator ponowi), zamiast udawać, że dostęp
//     został nadany lub odebrany.
//
// Atrapa stoi wyłącznie na kliencie roli serwisowej. Zegar zamrożony -
// `canceled_at` stempluje „teraz".
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EntitlementSyncInput } from "@/lib/billing/entitlementSync.server";
import {
  BILLING_IDS,
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/billing/fixtures";
import { DZIEN, FIXED_NOW_ISO, freezeClock, relativeIso } from "@/test/time";

let db: SupabaseFromStub;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));

const { syncEntitlementState } = await import("@/lib/billing/entitlementSync.server");

freezeClock();

const SUB = "sub_1SyntetyczneUprawnienie";

interface Plan {
  existing: { id: string; status: string } | null;
  read?: SupabaseResult;
  update?: SupabaseResult;
  insert?: SupabaseResult;
}

function plan(p: Plan): void {
  db.setResponse("user_subscriptions", (chain: RecordedChain) => {
    if (chain.has("insert")) return p.insert ?? ok(null);
    if (chain.has("update")) return p.update ?? ok(null);
    return p.read ?? ok(p.existing);
  });
}

function input(overrides: Partial<EntitlementSyncInput> = {}): EntitlementSyncInput {
  return {
    userId: BILLING_IDS.me,
    tenantId: BILLING_IDS.tenant,
    planId: "plan-member-monthly",
    externalRef: SUB,
    status: "active",
    periodEnd: relativeIso(30 * DZIEN),
    ...overrides,
  };
}

function writeOf(method: "insert" | "update") {
  const chain = db.chainsFor("user_subscriptions").find((c) => c.has(method));
  return { chain, row: chain?.argsOf(method)?.[0] as Record<string, unknown> | undefined };
}

beforeEach(() => {
  db = supabaseFromStub();
});

describe("syncEntitlementState - zapis uprawnienia", () => {
  it("pierwsze zdarzenie subskrypcji zakłada wiersz z kluczem `external_ref`", async () => {
    plan({ existing: null });
    const periodEnd = relativeIso(30 * DZIEN);

    await syncEntitlementState(input({ periodEnd }));

    const read = db.chainsFor("user_subscriptions")[0];
    expect(read?.argsOf("eq")).toEqual(["external_ref", SUB]);
    // Deterministyczny odczyt najstarszego wiersza - duplikat nie wywraca
    // odczytu (PGRST116) i nie zapętla ponowień webhooka.
    expect(read?.argsOf("order")).toEqual(["created_at", { ascending: true }]);
    expect(read?.argsOf("limit")).toEqual([1]);

    expect(writeOf("insert").row).toEqual({
      user_id: BILLING_IDS.me,
      tenant_id: BILLING_IDS.tenant,
      plan_id: "plan-member-monthly",
      status: "active",
      external_ref: SUB,
      current_period_end: periodEnd,
      canceled_at: null,
    });
    expect(writeOf("update").chain).toBeUndefined();
  });

  it("kolejne zdarzenie aktualizuje TEN SAM wiersz, a pauza odbiera dostęp od razu", async () => {
    plan({ existing: { id: "us-1", status: "active" } });

    await syncEntitlementState(input({ status: "paused", planId: "plan-pro-monthly" }));

    const { chain, row } = writeOf("update");
    expect(chain?.argsOf("eq")).toEqual(["id", "us-1"]);
    expect(row).toEqual({
      plan_id: "plan-pro-monthly",
      status: "canceled",
      current_period_end: input().periodEnd,
      canceled_at: FIXED_NOW_ISO,
    });
    expect(writeOf("insert").chain).toBeUndefined();
  });

  it("uprawnienie odebrane po zwrocie jest ostateczne - spóźnione zdarzenie go nie wskrzesza", async () => {
    plan({ existing: { id: "us-1", status: "refunded" } });

    await syncEntitlementState(input({ status: "active" }));

    expect(writeOf("update").chain).toBeUndefined();
    expect(writeOf("insert").chain).toBeUndefined();
  });

  it.each([
    {
      krok: "odczyt",
      scena: { existing: null, read: fail("statement timeout", "57014") },
      komunikat: `entitlement sync: lookup failed (${SUB}): statement timeout`,
    },
    {
      krok: "aktualizacja",
      scena: { existing: { id: "us-1", status: "active" }, update: fail("permission denied") },
      komunikat: `entitlement sync: update failed (${SUB}): permission denied`,
    },
    {
      krok: "wstawienie",
      scena: { existing: null, insert: fail("violates foreign key constraint", "23503") },
      komunikat: `entitlement sync: insert failed (${SUB}): violates foreign key constraint`,
    },
  ] satisfies { krok: string; scena: Plan; komunikat: string }[])(
    "błąd na kroku „$krok” leci wyjątkiem z identyfikatorem subskrypcji - webhook ma ponowić",
    async ({ scena, komunikat }) => {
      plan(scena);

      await expect(syncEntitlementState(input())).rejects.toThrow(komunikat);
    },
  );

  it("błąd odczytu nie prowadzi do zapisu „na ślepo”", async () => {
    plan({ existing: null, read: fail("statement timeout", "57014") });

    await expect(syncEntitlementState(input())).rejects.toThrow();

    expect(db.chainsFor("user_subscriptions")).toHaveLength(1);
  });
});
