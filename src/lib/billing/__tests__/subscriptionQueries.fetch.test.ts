// Odczyt subskrypcji operatora dla ZALOGOWANEGO użytkownika (przeglądarka)
// oraz reguły dostępu / wznowienia na brzegach danych.
//
// Ryzyka, które ten plik przypina:
//   1. ŚRODOWISKO. Wiersze sandboxa i produkcji leżą w JEDNEJ tabeli
//      `subscriptions`. Bez filtra `environment` opublikowana aplikacja
//      pokazałaby klientowi subskrypcję z trybu testowego (i odwrotnie) -
//      a karta subskrypcji na jej podstawie oferuje anulowanie i zmianę planu.
//   2. WŁAŚCICIEL. Identyfikator użytkownika pochodzi z SESJI, nie z argumentu -
//      anonim nie wysyła żadnego zapytania.
//   3. BŁĄD TO NIE BRAK. Odmowa PostgREST musi polecieć wyjątkiem; zamieniona
//      na `null` wyglądałaby jak „nie masz subskrypcji" i zachęcała do
//      ponownego zakupu.
//   4. BRAK DATY KOŃCA OKRESU (webhook nie dowiózł pozycji) nie może odebrać
//      dostępu płacącemu klientowi ani zablokować cofnięcia anulowania.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DZIEN, FIXED_NOW, freezeClock, relativeIso } from "@/test/time";
import {
  fail,
  ok,
  supabaseAuthStub,
  supabaseFromStub,
  type SupabaseAuthStub,
  type SupabaseFromStub,
} from "@/test/supabase";
import type { StripeSubscriptionRow } from "@/lib/billing/subscriptionQueries";

freezeClock();

const h = vi.hoisted(() => ({
  chain: null as unknown as SupabaseFromStub,
  auth: null as unknown as SupabaseAuthStub,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.chain.from(table),
    auth: { getSession: () => h.auth.getSession() },
  },
}));

const COLUMNS =
  "id, provider_subscription_id, provider_customer_id, product_id, price_id, status, quantity, current_period_start, current_period_end, cancel_at_period_end, environment, created_at";

function row(patch: Partial<StripeSubscriptionRow> = {}): StripeSubscriptionRow {
  return {
    id: "row-1",
    provider_subscription_id: "sub_1",
    provider_customer_id: "cus_1",
    product_id: "plan_plus",
    price_id: "plus_monthly",
    status: "active",
    quantity: 1,
    current_period_start: relativeIso(-DZIEN),
    current_period_end: relativeIso(30 * DZIEN),
    cancel_at_period_end: false,
    environment: "sandbox",
    created_at: relativeIso(-30 * DZIEN),
    ...patch,
  };
}

/** Świeży moduł - token środowiska jest czytany przy ładowaniu `@/lib/stripe`. */
async function loadQueries(): Promise<typeof import("@/lib/billing/subscriptionQueries")> {
  vi.resetModules();
  return import("@/lib/billing/subscriptionQueries");
}

beforeEach(() => {
  h.chain = supabaseFromStub();
  h.auth = supabaseAuthStub("user-me");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("fetchMyStripeSubscription - kto i z jakiego środowiska", () => {
  it("anonim dostaje null BEZ zapytania do tabeli subskrypcji", async () => {
    h.auth = supabaseAuthStub(null);
    const { fetchMyStripeSubscription } = await loadQueries();

    expect(await fetchMyStripeSubscription()).toBeNull();
    expect(h.chain.chains).toHaveLength(0);
  });

  it("filtruje po użytkowniku z sesji i środowisku sandbox (token testowy), najnowszy wiersz", async () => {
    vi.stubEnv("VITE_PAYMENTS_CLIENT_TOKEN", "pk_test_example");
    h.chain.setResponse("subscriptions", ok(row()));
    const { fetchMyStripeSubscription } = await loadQueries();

    const result = await fetchMyStripeSubscription();

    expect(result).toEqual(row());
    const calls = h.chain.lastChain("subscriptions")!.calls;
    expect(calls).toEqual([
      { method: "select", args: [COLUMNS] },
      { method: "eq", args: ["user_id", "user-me"] },
      { method: "eq", args: ["environment", "sandbox"] },
      { method: "order", args: ["created_at", { ascending: false }] },
      { method: "limit", args: [1] },
      { method: "maybeSingle", args: [] },
    ]);
  });

  it("opublikowana aplikacja (token live) czyta WYŁĄCZNIE wiersze środowiska live", async () => {
    vi.stubEnv("VITE_PAYMENTS_CLIENT_TOKEN", "pk_live_example");
    h.chain.setResponse("subscriptions", ok(row({ environment: "live" })));
    const { fetchMyStripeSubscription } = await loadQueries();

    await fetchMyStripeSubscription();

    const chain = h.chain.lastChain("subscriptions")!;
    const envFilters = chain.calls.filter((c) => c.method === "eq" && c.args[0] === "environment");
    expect(envFilters).toEqual([{ method: "eq", args: ["environment", "live"] }]);
  });

  it("brak skonfigurowanego tokenu NIE zgaduje produkcji - filtr zostaje na sandboxie", async () => {
    vi.stubEnv("VITE_PAYMENTS_CLIENT_TOKEN", "");
    h.chain.setResponse("subscriptions", ok(null));
    const { fetchMyStripeSubscription } = await loadQueries();

    await fetchMyStripeSubscription();

    expect(h.chain.lastChain("subscriptions")!.calls).toContainEqual({
      method: "eq",
      args: ["environment", "sandbox"],
    });
  });

  it("użytkownik bez subskrypcji dostaje null (nie pusty obiekt)", async () => {
    h.chain.setResponse("subscriptions", ok(null));
    const { fetchMyStripeSubscription } = await loadQueries();

    expect(await fetchMyStripeSubscription()).toBeNull();
  });

  it("odpowiedź bez pola `data` też daje ŚCISŁE null, nie `undefined`", async () => {
    // React Query traktuje `undefined` z queryFn jako błąd - brak subskrypcji
    // musi wyjść jako `null`, żeby karta pokazała stan pusty, a nie awarię.
    h.chain.setResponse("subscriptions", ok(undefined));
    const { fetchMyStripeSubscription } = await loadQueries();

    // `toBeNull` jest ścisłe (`=== null`) - `undefined` tu nie przejdzie.
    expect(await fetchMyStripeSubscription()).toBeNull();
  });

  it("odmowa bazy leci wyjątkiem - nie udaje „brak subskrypcji”", async () => {
    h.chain.setResponse(
      "subscriptions",
      fail("permission denied for table subscriptions", "42501"),
    );
    const { fetchMyStripeSubscription } = await loadQueries();

    await expect(fetchMyStripeSubscription()).rejects.toMatchObject({
      message: "permission denied for table subscriptions",
      code: "42501",
    });
  });
});

describe("isStripeSubscriptionActive - brak daty końca okresu", () => {
  it("aktywna subskrypcja bez daty końca okresu NADAL daje dostęp", async () => {
    const { isStripeSubscriptionActive } = await loadQueries();

    expect(isStripeSubscriptionActive(row({ current_period_end: null }))).toBe(true);
    expect(isStripeSubscriptionActive(row({ status: "trialing", current_period_end: null }))).toBe(
      true,
    );
  });

  it("anulowana subskrypcja bez daty końca NIE daje dostępu (brak okresu karencji)", async () => {
    const { isStripeSubscriptionActive } = await loadQueries();

    expect(isStripeSubscriptionActive(row({ status: "canceled", current_period_end: null }))).toBe(
      false,
    );
  });

  it("statusy spoza listy (incomplete, unpaid) nie dają dostępu nawet w trwającym okresie", async () => {
    const { isStripeSubscriptionActive } = await loadQueries();

    expect(isStripeSubscriptionActive(row({ status: "incomplete" }))).toBe(false);
    expect(isStripeSubscriptionActive(row({ status: "unpaid" }))).toBe(false);
  });

  it("granica okresu: koniec dokładnie „teraz” to już brak dostępu", async () => {
    const { isStripeSubscriptionActive } = await loadQueries();

    expect(isStripeSubscriptionActive(row({ current_period_end: FIXED_NOW.toISOString() }))).toBe(
      false,
    );
  });
});

describe("canResumeStripeSubscription - kiedy wolno cofnąć anulowanie", () => {
  it("brak subskrypcji = nie ma czego wznawiać", async () => {
    const { canResumeStripeSubscription } = await loadQueries();

    expect(canResumeStripeSubscription(null)).toBe(false);
  });

  it("wstrzymaną subskrypcję zawsze da się odwiesić - nawet bez zaplanowanego anulowania", async () => {
    const { canResumeStripeSubscription } = await loadQueries();

    expect(canResumeStripeSubscription(row({ status: "paused" }))).toBe(true);
  });

  it("zaplanowane anulowanie bez daty końca okresu da się cofnąć", async () => {
    const { canResumeStripeSubscription } = await loadQueries();

    expect(
      canResumeStripeSubscription(row({ cancel_at_period_end: true, current_period_end: null })),
    ).toBe(true);
  });

  it("subskrypcji już anulowanej u operatora nie da się „wznowić” flagą", async () => {
    const { canResumeStripeSubscription } = await loadQueries();

    expect(
      canResumeStripeSubscription(row({ status: "canceled", cancel_at_period_end: true })),
    ).toBe(false);
  });
});

describe("catalogEntryFor - plan z katalogu cen", () => {
  it("wiersz operatora mapuje się na wpis katalogu po lookup_key", async () => {
    const { catalogEntryFor } = await loadQueries();

    expect(catalogEntryFor(row({ price_id: "team_monthly_seat" }))).toMatchObject({
      priceId: "team_monthly_seat",
      tierKey: "team",
    });
    expect(catalogEntryFor(null)).toBeNull();
    expect(catalogEntryFor(row({ price_id: "price_spoza_katalogu" }))).toBeNull();
  });
});
