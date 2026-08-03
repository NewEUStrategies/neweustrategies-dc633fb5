// Retencja dowodów księgowych przy usuwaniu konta.
//
// Moduł jest cienki (jedno RPC), ale jego kontrakt jest twardy: RZUCA przy
// każdej awarii, bo `deleteMyAccount` woła go PRZED `deleteUser`. Cicha porażka
// oznaczałaby konto usunięte razem z ewidencją transakcji - dokładnie regresja,
// którą zamyka migracja 20260803090002.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const state: {
    calls: { fn: string; args: unknown }[];
    result: { data: unknown; error: { message: string } | null };
  } = { calls: [], result: { data: { retained: 0, discarded: 0 }, error: null } };
  return { state };
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (fn: string, args: unknown) => {
      h.state.calls.push({ fn, args });
      return h.state.result;
    },
  },
}));

import { retainAccountingEvidence } from "@/lib/billing/accountingRetention.server";

const USER = "11111111-1111-1111-1111-111111111111";

describe("retainAccountingEvidence", () => {
  beforeEach(() => {
    h.state.calls = [];
    h.state.result = { data: { retained: 0, discarded: 0 }, error: null };
  });

  it("woła anonimizację zamówień dla wskazanego konta", async () => {
    h.state.result = { data: { retained: 3, discarded: 2 }, error: null };

    const result = await retainAccountingEvidence(USER);

    expect(h.state.calls).toEqual([
      { fn: "anonymize_payment_orders_for_user", args: { p_user_id: USER } },
    ]);
    expect(result).toEqual({ retained: 3, discarded: 2 });
  });

  it("rzuca, gdy anonimizacja padła - konto NIE może zostać usunięte", async () => {
    h.state.result = { data: null, error: { message: "permission denied" } };

    await expect(retainAccountingEvidence(USER)).rejects.toThrow(/permission denied/);
  });

  it("liczniki niesie tekstem lub liczbą; śmieci degradują do zera", async () => {
    // Postgres zwraca jsonb; klient potrafi oddać liczby jako string.
    h.state.result = { data: { retained: "4", discarded: null }, error: null };
    await expect(retainAccountingEvidence(USER)).resolves.toEqual({ retained: 4, discarded: 0 });
  });

  it("nietypowy ładunek (null / tablica) nie wywraca usuwania konta", async () => {
    h.state.result = { data: null, error: null };
    await expect(retainAccountingEvidence(USER)).resolves.toEqual({ retained: 0, discarded: 0 });

    h.state.result = { data: [], error: null };
    await expect(retainAccountingEvidence(USER)).resolves.toEqual({ retained: 0, discarded: 0 });
  });
});
