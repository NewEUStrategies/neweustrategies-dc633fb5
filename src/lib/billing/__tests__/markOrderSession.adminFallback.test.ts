// Domknięcie zapisu sesji operatora rolą serwisową - gałęzie awaryjne
// `markOrderSession.server.ts`.
//
// RYZYKO. Fallback roli serwisowej omija RLS, więc jego zakres jest regułą
// pieniężną: wolno mu dotknąć WYŁĄCZNIE tego zamówienia, tylko gdy nie jest
// zapłacone (`paid_at IS NULL`) i tylko w stanach przejściowych - nigdy nie
// może cofnąć `paid` ani nadpisać zamówienia zamkniętego. Druga połowa ryzyka
// to FAŁSZYWY SUKCES: funkcja zwraca `true` tylko wtedy, gdy zapis naprawdę
// objął wiersz - inaczej wołający uznałby, że webhook ma się czego złapać.
//
// Siostrzany `markOrderSession.test.ts` pilnuje ścieżki szczęśliwej; tutaj
// stoją filtry zapisu, odpowiedź „zero wierszy" i awarie fallbacku.
//
// GRANICA ATRAP: klient użytkownika (`rpc`) i klient roli serwisowej (`from`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BILLING_IDS,
  fail,
  ok,
  supabaseFromStub,
  type SupabaseFromStub,
} from "@/test/billing/fixtures";

const h = vi.hoisted(() => ({
  db: null as { from: (table: string) => unknown } | null,
  /** Rzut z samego klienta roli serwisowej (zerwane połączenie, brak sekretu). */
  adminThrows: null as unknown,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (h.adminThrows !== null) throw h.adminThrows;
      if (!h.db) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.from(table);
    },
  },
}));

import { markOrderSession } from "@/lib/billing/markOrderSession.server";

const ORDER = BILLING_IDS.order;

type RpcResult = { data: unknown; error: { message: string } | null };

function userClient(result: RpcResult) {
  return { rpc: vi.fn(async (_fn: string, _args: Record<string, unknown>) => result) };
}

let db: SupabaseFromStub;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db = supabaseFromStub();
  h.db = db;
  h.adminThrows = null;
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("markOrderSession - argumenty RPC ścieżki użytkownika", () => {
  it("bez `sessionId` nie wysyła `_session_id`, więc baza nie nadpisuje sesji pustką", async () => {
    const supabase = userClient({ data: true, error: null });

    const result = await markOrderSession(supabase, { orderId: ORDER, status: "canceled" });

    expect(result).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("payment_order_mark_session", {
      _order_id: ORDER,
      _status: "canceled",
    });
  });

  it("pusty `sessionId` też nie trafia do RPC jako identyfikator sesji", async () => {
    const supabase = userClient({ data: true, error: null });

    await markOrderSession(supabase, { orderId: ORDER, sessionId: "", status: "processing" });

    const args = supabase.rpc.mock.calls[0]?.[1];
    expect(args).not.toHaveProperty("_session_id");
  });
});

describe("markOrderSession - zakres zapisu roli serwisowej", () => {
  it("dotyka wyłącznie tego, niezapłaconego zamówienia w stanie przejściowym", async () => {
    db.setResponse("payment_orders", ok([{ id: ORDER }]));
    const supabase = userClient({ data: false, error: null });

    const result = await markOrderSession(supabase, {
      orderId: ORDER,
      sessionId: "cs_test_1",
      status: "processing",
    });

    expect(result).toBe(true);
    const chain = db.lastChain("payment_orders");
    expect(chain?.argsOf("update")?.[0]).toMatchObject({
      status: "processing",
      provider_session_id: "cs_test_1",
    });
    expect(chain?.argsOf("eq")).toEqual(["id", ORDER]);
    // Zapłacone zamówienie (`paid_at` ustawione) jest poza zasięgiem fallbacku.
    expect(chain?.argsOf("is")).toEqual(["paid_at", null]);
    expect(chain?.argsOf("in")).toEqual(["status", ["pending", "processing"]]);
    expect(error).toHaveBeenCalledWith(
      "[checkout] mark_session fallback",
      ORDER,
      "processing",
      "rpc_returned_false",
    );
  });

  it("zero objętych wierszy (zamówienie już zamknięte) to `false`, a nie fałszywy sukces", async () => {
    db.setResponse("payment_orders", ok([]));
    const supabase = userClient({ data: null, error: { message: "status race" } });

    const result = await markOrderSession(supabase, {
      orderId: ORDER,
      sessionId: "cs_test_1",
      status: "failed",
    });

    expect(result).toBe(false);
    // Przyczyna odmowy ścieżki użytkownika trafia do logu dosłownie.
    expect(error).toHaveBeenCalledWith(
      "[checkout] mark_session fallback",
      ORDER,
      "failed",
      "status race",
    );
  });

  it("brak tablicy wierszy w odpowiedzi też jest `false`", async () => {
    db.setResponse("payment_orders", ok(null));
    const supabase = userClient({ data: false, error: null });

    await expect(markOrderSession(supabase, { orderId: ORDER, status: "canceled" })).resolves.toBe(
      false,
    );
  });
});

describe("markOrderSession - awaria fallbacku", () => {
  it("błąd zapisu roli serwisowej zwraca `false` i loguje przyczynę z zamówieniem", async () => {
    db.setResponse("payment_orders", fail("violates check constraint"));
    const supabase = userClient({ data: false, error: null });

    const result = await markOrderSession(supabase, {
      orderId: ORDER,
      sessionId: "cs_test_1",
      status: "processing",
    });

    expect(result).toBe(false);
    expect(error).toHaveBeenCalledWith(
      "[checkout] mark_session admin failed",
      ORDER,
      "violates check constraint",
    );
  });

  it("wyjątek klienta roli serwisowej nie wycieka do checkoutu", async () => {
    h.adminThrows = new Error("missing SUPABASE_SERVICE_ROLE_KEY");
    const supabase = userClient({ data: false, error: null });

    const result = await markOrderSession(supabase, { orderId: ORDER, status: "failed" });

    expect(result).toBe(false);
    expect(error).toHaveBeenCalledWith(
      "[checkout] mark_session admin threw",
      ORDER,
      "missing SUPABASE_SERVICE_ROLE_KEY",
    );
  });

  it("rzut nie-`Error` (goły napis) też kończy się `false` i trafia do logu dosłownie", async () => {
    h.adminThrows = "socket hang up";
    const supabase = userClient({ data: false, error: null });

    await expect(markOrderSession(supabase, { orderId: ORDER, status: "failed" })).resolves.toBe(
      false,
    );
    expect(error).toHaveBeenCalledWith(
      "[checkout] mark_session admin threw",
      ORDER,
      "socket hang up",
    );
  });
});
