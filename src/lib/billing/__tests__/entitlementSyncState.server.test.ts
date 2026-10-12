// ZAPIS UPRAWNIENIA ZE STANU OPERATORA (`syncEntitlementState`) - jedyny most
// między `subscriptions` (webhook) a `user_subscriptions`, które czyta
// `has_content_access()`. Mapowanie statusów przybija osobno
// `entitlementSync.server.test.ts`; ten plik przybija ZAPIS.
//
// JAKIE RYZYKA:
//   * DUPLIKAT UPRAWNIENIA. Kolejne zdarzenie tej samej subskrypcji ma
//     zaktualizować JEDEN wiersz po `external_ref`, a nie dopisać drugi -
//     także wtedy, gdy dwa zdarzenia ścigają się o wstawienie (indeks
//     unikalny `external_ref`, 20261012130300: przegrany dostaje 23505).
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
import { BILLING_IDS } from "@/test/billing/fixtures";
// Atrapa kanoniczna (`@/test/supabase/chain`), nie zgodnościowy re-eksport:
// testy wyścigu odpowiadają obietnicą (tabela w pamięci), a tylko ten typ
// `TableResponder` ją dopuszcza.
import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabase/chain";
import { rowStore } from "@/test/billing/rowStore";
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
    // Klucz jest unikalny w bazie - obejście `order + limit 1` (dawniej chroniło
    // przed PGRST116 na duplikacie) nie jest już potrzebne.
    expect(read?.has("order")).toBe(false);
    expect(read?.has("maybeSingle")).toBe(true);

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
    expect(chain?.argsOf("eq")).toEqual(["external_ref", SUB]);
    // „Zwrot jest ostateczny" stoi w SAMYM zapisie - trzyma także przy zwrocie,
    // który wpadnie między odczyt a aktualizację.
    expect(chain?.argsOf("neq")).toEqual(["status", "refunded"]);
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

  it("przegrany wyścig o wstawienie (23505) aktualizuje TEN SAM klucz zamiast dopisać drugi wiersz", async () => {
    // Równoległe zdarzenie wstawiło uprawnienie między naszym odczytem
    // („brak") a wstawieniem. Indeks unikalny odrzuca drugi wiersz, a stan
    // tego zdarzenia trafia aktualizacją w wiersz zwycięzcy.
    plan({
      existing: null,
      insert: fail("duplicate key value violates unique constraint", "23505"),
    });

    await syncEntitlementState(input({ status: "past_due" }));

    const { chain, row } = writeOf("update");
    expect(chain?.argsOf("eq")).toEqual(["external_ref", SUB]);
    expect(chain?.argsOf("neq")).toEqual(["status", "refunded"]);
    expect(row).toMatchObject({ status: "active", plan_id: "plan-member-monthly" });
  });

  it("dwie równoległe synchronizacje bez wiersza: jedno uprawnienie (indeks unikalny)", async () => {
    // Najgorszy przeplot odtworzony deterministycznie: druga synchronizacja
    // biegnie w całości w chwili, gdy pierwsza właśnie przeczytała „brak".
    const store = rowStore({ unique: ["external_ref"] });
    let inner: Promise<void> | null = null;
    db.setResponse("user_subscriptions", async (chain) => {
      const result = await store.respond(chain);
      if (chain.has("maybeSingle") && inner === null) {
        inner = syncEntitlementState(input({ status: "trialing" }));
        await inner;
      }
      return result;
    });

    await syncEntitlementState(input({ status: "past_due" }));
    await inner;

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ external_ref: SUB, status: "active" });
  });

  it("wiersz odebrany po zwrocie nie wraca do życia także na ścieżce wyścigu", async () => {
    // Wstawienie przegrywa z wierszem, który w międzyczasie dostał `refunded`
    // (zwrot) - aktualizacja z warunkiem `status <> 'refunded'` go nie rusza.
    const store = rowStore({
      rows: [{ id: "us-1", external_ref: SUB, status: "refunded" }],
      unique: ["external_ref"],
    });
    let reads = 0;
    db.setResponse("user_subscriptions", (chain) => {
      // Odczyt sprzed zwrotu: „brak wiersza".
      if (chain.has("maybeSingle") && reads++ === 0) return ok(null);
      return store.respond(chain);
    });

    await syncEntitlementState(input({ status: "active" }));

    expect(store.rows).toEqual([{ id: "us-1", external_ref: SUB, status: "refunded" }]);
  });

  it("błąd odczytu nie prowadzi do zapisu „na ślepo”", async () => {
    plan({ existing: null, read: fail("statement timeout", "57014") });

    await expect(syncEntitlementState(input())).rejects.toThrow();

    expect(db.chainsFor("user_subscriptions")).toHaveLength(1);
  });
});
