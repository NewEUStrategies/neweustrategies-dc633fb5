// Odczyt zamówień płatniczych dla panelu admina - 0 z 7 funkcji pokrytych
// do 18.08.2026.
//
// Ten moduł czyta świadomie przez klienta ZALOGOWANEGO ADMINA (RLS), nie przez
// rolę serwisową: panel nie może zobaczyć więcej, niż baza przyzna adminowi.
// Testy pilnują tego kontraktu razem z regułą, o którą cały panel istnieje:
//
//   ZAMÓWIENIE „WISZĄCE" = `pending`/`processing` BEZ identyfikatora sesji
//   u operatora. To ono sygnalizuje przerwaną ścieżkę checkoutu - klient
//   kliknął „kup", a sesja nigdy nie powstała albo nie została powiązana.
//   Zamówienie oczekujące Z sesją jest normalne (klient jeszcze płaci).
import { describe, expect, it, beforeEach } from "vitest";

import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import { loadPaymentOrders } from "@/lib/billing/paymentOrders.server";

/** Wiersz `payment_orders` w kształcie, jaki czyta ten moduł. */
function orderRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "order-1",
    created_at: "2026-08-18T10:00:00.000Z",
    paid_at: "2026-08-18T10:01:00.000Z",
    status: "paid",
    kind: "subscription",
    provider: "stripe",
    environment: "sandbox",
    provider_session_id: "cs_test_1",
    amount_cents: 4900,
    currency: "PLN",
    plan_id: "plan-1",
    user_id: "user-me",
    receipt_email: "syntetyczny@example.test",
    ...overrides,
  };
}

let chain: SupabaseFromStub;

/** Klient w kształcie, jakiego oczekuje `loadPaymentOrders`. */
const client = () => ({ from: (table: string) => chain.from(table) }) as never;

const load = (status: Parameters<typeof loadPaymentOrders>[1]["status"] = "all", limit = 200) =>
  loadPaymentOrders(client(), { status, limit });

beforeEach(() => {
  chain = supabaseFromStub();
  chain.setResponse("payment_orders", ok([orderRecord()]));
  chain.setResponse("access_plans", ok([]));
});

describe("loadPaymentOrders - kontrakt zapytania", () => {
  it("czyta najnowsze zamówienia z limitem", async () => {
    await load("all", 50);

    const query = chain.lastChain("payment_orders")!;
    expect(query.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(query.argsOf("limit")).toEqual([50]);
  });

  it("filtr „all” NIE zawęża zapytania po statusie", async () => {
    await load("all");

    const query = chain.lastChain("payment_orders")!;
    expect(query.has("eq")).toBe(false);
    expect(query.has("select")).toBe(true);
  });

  it("wybrany status zawęża zapytanie po stronie bazy, nie w pamięci", async () => {
    await load("failed");

    expect(chain.lastChain("payment_orders")!.argsOf("eq")).toEqual(["status", "failed"]);
  });

  it("BŁĄD ODCZYTU jest zgłaszany, nie zamieniany na pustą listę", async () => {
    chain.setResponse("payment_orders", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });

    await expect(load()).rejects.toThrow("permission denied");
  });

  it("brak zamówień daje puste wiersze i zerowe podsumowanie", async () => {
    chain.setResponse("payment_orders", ok([]));

    const result = await load();

    expect(result.rows).toEqual([]);
    expect(result.summary).toEqual({ total: 0, stuck: 0, paid: 0, failed: 0 });
  });

  it("brak planów w zamówieniach nie generuje zapytania o plany", async () => {
    chain.setResponse("payment_orders", ok([orderRecord({ plan_id: null })]));

    await load();

    expect(chain.chainsFor("access_plans")).toHaveLength(0);
  });

  it("plany są dociągane JEDNYM zapytaniem po unikalnych identyfikatorach", async () => {
    chain.setResponse(
      "payment_orders",
      ok([
        orderRecord({ id: "o1", plan_id: "plan-1" }),
        orderRecord({ id: "o2", plan_id: "plan-1" }),
        orderRecord({ id: "o3", plan_id: "plan-2" }),
      ]),
    );

    await load();

    expect(chain.chainsFor("access_plans")).toHaveLength(1);
    expect(chain.lastChain("access_plans")!.argsOf("in")).toEqual(["id", ["plan-1", "plan-2"]]);
  });
});

describe("loadPaymentOrders - odwzorowanie wiersza", () => {
  it("przepisuje pola zamówienia na kształt czytelny dla panelu", async () => {
    const result = await load();

    expect(result.rows[0]).toMatchObject({
      id: "order-1",
      createdAt: "2026-08-18T10:00:00.000Z",
      status: "paid",
      amountCents: 4900,
      currency: "PLN",
      sessionId: "cs_test_1",
      buyerEmail: "syntetyczny@example.test",
    });
    expect(result.rows).toHaveLength(1);
  });

  it("brak dostawcy schodzi na kreskę, żeby kolumna nie była pusta", async () => {
    chain.setResponse("payment_orders", ok([orderRecord({ provider: null })]));

    const result = await load();

    expect(result.rows[0].provider).toBe("-");
    expect(result.rows[0].provider).not.toBeNull();
  });

  it("brak sesji u operatora jest zachowany jako `null` (to sygnał, nie brak danych)", async () => {
    chain.setResponse("payment_orders", ok([orderRecord({ provider_session_id: null })]));

    const result = await load();

    expect(result.rows[0].sessionId).toBeNull();
    expect(result.rows[0].id).toBe("order-1");
  });

  it("zamówienie bez planu nie dostaje nazwy planu", async () => {
    chain.setResponse("payment_orders", ok([orderRecord({ plan_id: null })]));

    const result = await load();

    expect(result.rows[0].planId).toBeNull();
    expect(result.rows[0].planName).toBeNull();
  });
});

describe("loadPaymentOrders - PODSUMOWANIE i zamówienia wiszące", () => {
  it("zamówienie `pending` BEZ sesji jest wiszące", async () => {
    chain.setResponse(
      "payment_orders",
      ok([orderRecord({ status: "pending", provider_session_id: null })]),
    );

    const result = await load();

    expect(result.summary.stuck).toBe(1);
    expect(result.summary.paid).toBe(0);
  });

  it("zamówienie `processing` BEZ sesji też jest wiszące", async () => {
    chain.setResponse(
      "payment_orders",
      ok([orderRecord({ status: "processing", provider_session_id: null })]),
    );

    const result = await load();

    expect(result.summary.stuck).toBe(1);
    expect(result.summary.total).toBe(1);
  });

  it("zamówienie oczekujące Z SESJĄ NIE jest wiszące - klient po prostu płaci", async () => {
    chain.setResponse(
      "payment_orders",
      ok([orderRecord({ status: "pending", provider_session_id: "cs_w_toku" })]),
    );

    const result = await load();

    expect(result.summary.stuck).toBe(0);
    expect(result.rows[0].sessionId).toBe("cs_w_toku");
  });

  it("zamówienie NIEUDANE bez sesji nie jest wiszące - jest po prostu nieudane", async () => {
    chain.setResponse(
      "payment_orders",
      ok([orderRecord({ status: "failed", provider_session_id: null })]),
    );

    const result = await load();

    expect(result.summary.stuck).toBe(0);
    expect(result.summary.failed).toBe(1);
  });

  it("opłacone bez sesji też nie jest wiszące (webhook dowiózł stan)", async () => {
    chain.setResponse(
      "payment_orders",
      ok([orderRecord({ status: "paid", provider_session_id: null })]),
    );

    const result = await load();

    expect(result.summary.stuck).toBe(0);
    expect(result.summary.paid).toBe(1);
  });

  it("podsumowanie liczy wszystkie kategorie na jednym zestawie", async () => {
    chain.setResponse(
      "payment_orders",
      ok([
        orderRecord({ id: "a", status: "paid" }),
        orderRecord({ id: "b", status: "paid" }),
        orderRecord({ id: "c", status: "failed" }),
        orderRecord({ id: "d", status: "pending", provider_session_id: null }),
        orderRecord({ id: "e", status: "processing", provider_session_id: null }),
        orderRecord({ id: "f", status: "refunded" }),
      ]),
    );

    const result = await load();

    expect(result.summary).toEqual({ total: 6, stuck: 2, paid: 2, failed: 1 });
    expect(result.rows).toHaveLength(6);
  });
});
