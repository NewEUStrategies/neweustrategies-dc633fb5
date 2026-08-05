// Retencja dowodów przy usuwaniu konta.
//
// Moduł jest cienki (jedno RPC), ale jego kontrakt jest twardy: RZUCA przy
// każdej awarii, bo `deleteMyAccount` woła go PRZED `deleteUser`. Cicha porażka
// oznaczałaby albo konto usunięte razem z ewidencją transakcji (regresja
// domknięta migracją 20260803090002), albo osierocony identyfikator osoby
// w `user_purchases` (20260805090100).
//
// JEDNO RPC dla obu tabel jest częścią kontraktu: dwa wywołania to dwie
// transakcje, a między nimi stan „zamówienia zanonimizowane, zakupy jeszcze
// nie" - i awaria w tym oknie zostawia naruszenie w danych.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const state: {
    calls: { fn: string; args: unknown }[];
    result: { data: unknown; error: { message: string } | null };
  } = { calls: [], result: { data: {}, error: null } };
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
const EMPTY = { retained: 0, discarded: 0 };

describe("retainAccountingEvidence", () => {
  beforeEach(() => {
    h.state.calls = [];
    h.state.result = { data: {}, error: null };
  });

  it("anonimizuje OBIE tabele dowodowe jednym wywołaniem", async () => {
    h.state.result = {
      data: {
        orders: { retained: 3, discarded: 2 },
        purchases: { retained: 4, discarded: 1 },
        retained: 3,
        discarded: 2,
      },
      error: null,
    };

    const result = await retainAccountingEvidence(USER);

    expect(h.state.calls).toEqual([
      { fn: "anonymize_accounting_evidence_for_user", args: { p_user_id: USER } },
    ]);
    expect(result).toEqual({
      orders: { retained: 3, discarded: 2 },
      purchases: { retained: 4, discarded: 1 },
      retainedTotal: 7,
    });
  });

  it("rzuca, gdy anonimizacja padła - konto NIE może zostać usunięte", async () => {
    h.state.result = { data: null, error: { message: "permission denied" } };

    await expect(retainAccountingEvidence(USER)).rejects.toThrow(/permission denied/);
  });

  it("liczniki niesie tekstem lub liczbą; śmieci degradują do zera", async () => {
    // Postgres zwraca jsonb; klient potrafi oddać liczby jako string.
    h.state.result = {
      data: { orders: { retained: "4", discarded: null }, purchases: { retained: "1" } },
      error: null,
    };
    await expect(retainAccountingEvidence(USER)).resolves.toEqual({
      orders: { retained: 4, discarded: 0 },
      purchases: { retained: 1, discarded: 0 },
      retainedTotal: 5,
    });
  });

  it("czyta STARY, płaski kształt {retained, discarded} jako zamówienia", async () => {
    // Baza migrowana do 20260803090002, ale jeszcze nie do 20260805090100:
    // funkcja zwraca płaski obiekt. Liczba zachowanych dowodów w komunikacie
    // dla użytkownika musi wtedy nadal być prawdziwa, a nie zerowa.
    h.state.result = { data: { retained: 5, discarded: 1 }, error: null };
    await expect(retainAccountingEvidence(USER)).resolves.toEqual({
      orders: { retained: 5, discarded: 1 },
      purchases: EMPTY,
      retainedTotal: 5,
    });
  });

  it("nietypowy ładunek (null / tablica) nie wywraca usuwania konta", async () => {
    const empty = { orders: EMPTY, purchases: EMPTY, retainedTotal: 0 };

    h.state.result = { data: null, error: null };
    await expect(retainAccountingEvidence(USER)).resolves.toEqual(empty);

    h.state.result = { data: [], error: null };
    await expect(retainAccountingEvidence(USER)).resolves.toEqual(empty);
  });
});
