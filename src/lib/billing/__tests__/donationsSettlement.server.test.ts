// KSIĘGOWANIE DAROWIZN - ścieżki, których nie widać w księdze, bo kończą się
// BŁĘDEM albo ODNAJDUJĄ WIERSZ OKRĘŻNĄ DROGĄ. Stan rejestru po szczęśliwych
// ścieżkach (zapłata, ponowienie, zwrot, odnowienie) przybija
// `donationsLedger.server.test.ts` na miniaturowej tabeli.
//
// JAKIE RYZYKA PRZYBIJA TEN PLIK:
//   * POZORNE „POMINIĘTO”. Błąd zapisu w bazie musi polecieć wyjątkiem
//     (webhook zapisze `failed`, operator ponowi). Zamieniony na `false`
//     / `"skipped"` oznaczałby wpłatę, której nikt nie zaksięguje - pieniądze
//     są u operatora, a rejestr i trigger statusu wspierającego o nich nie wiedzą.
//   * ZGUBIONA WPŁATA CYKLICZNA. Gdy `metadata.donationId` wskazuje wiersz,
//     którego nie ma, kotwica ma się znaleźć po subskrypcji - inaczej każde
//     odnowienie tej darowizny przepada jako „bez kotwicy”.
//   * KLUCZ IDEMPOTENCJI. Webhook faktury nie przekazuje identyfikatora
//     płatności - pierwsza wpłata ma wtedy dostać `provider_intent_id`
//     równy identyfikatorowi faktury (unikat `(provider, provider_intent_id)`).
//
// Atrapa stoi wyłącznie na kliencie roli serwisowej. Zegar zamrożony -
// `paid_at` stempluje „teraz".
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/billing/fixtures";
import { FIXED_NOW_ISO, freezeClock } from "@/test/time";

let db: SupabaseFromStub;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));

const { recordRecurringDonationPayment, settleDonation } =
  await import("@/lib/billing/donations.server");

freezeClock();

const ANCHOR = {
  id: "don-1",
  tenant_id: "tenant-1",
  user_id: "user-1",
  amount_cents: 5000,
  currency: "PLN",
  donor_email: "darczynca@example.com",
  message: "Trzymajcie tak dalej",
  status: "paid",
};

interface Scene {
  /** Odczyt kotwicy po `id` z metadanych. */
  byId: unknown;
  /** Odczyt kotwicy po `provider_subscription_id`. */
  bySubscription: unknown;
  /** Pierwszy UPDATE (z warunkiem `paid_at IS NULL` albo `status = pending`). */
  firstUpdate: SupabaseResult;
  /** Drugi UPDATE księgowania jednorazowego (bez warunku na `paid_at`). */
  retryUpdate: SupabaseResult;
  insert: SupabaseResult;
}

let scene: Scene;

function eqColumn(chain: RecordedChain, column: string): unknown {
  return chain.calls.find((c) => c.method === "eq" && c.args[0] === column)?.args[1];
}

beforeEach(() => {
  scene = {
    byId: null,
    bySubscription: null,
    firstUpdate: ok([{ id: "don-1" }]),
    retryUpdate: ok([]),
    insert: ok(null),
  };
  db = supabaseFromStub();
  db.setResponse("donations", (chain) => {
    if (chain.has("insert")) return scene.insert;
    if (chain.has("update")) {
      const conditional = chain.has("is") || eqColumn(chain, "status") === "pending";
      return conditional ? scene.firstUpdate : scene.retryUpdate;
    }
    if (eqColumn(chain, "id") !== undefined) return ok(scene.byId);
    return ok(scene.bySubscription);
  });
});

function updates(): RecordedChain[] {
  return db.chainsFor("donations").filter((c) => c.has("update"));
}

function inserted(): Record<string, unknown> | undefined {
  const chain = db.chainsFor("donations").find((c) => c.has("insert"));
  return chain?.argsOf("insert")?.[0] as Record<string, unknown> | undefined;
}

describe("settleDonation - błędy zapisu nie udają „pominięto”", () => {
  it("błąd pierwszego zapisu leci wyjątkiem i nie próbuje drugiej ścieżki", async () => {
    scene.firstUpdate = fail("statement timeout", "57014");

    await expect(settleDonation({ donationId: "don-1", intentId: "pi_1" })).rejects.toThrow(
      "donation settle failed: statement timeout",
    );
    expect(updates()).toHaveLength(1);
    expect(updates()[0]?.argsOf("update")?.[0]).toMatchObject({
      status: "paid",
      provider_intent_id: "pi_1",
      paid_at: FIXED_NOW_ISO,
    });
  });

  it("błąd drugiego zapisu (ponowienie po zapłacie) też leci wyjątkiem", async () => {
    scene.firstUpdate = ok([]);
    scene.retryUpdate = fail("permission denied", "42501");

    await expect(settleDonation({ sessionId: "cs_1" })).rejects.toThrow(
      "donation settle failed: permission denied",
    );
    expect(updates()).toHaveLength(2);
    // Druga próba nie nadpisuje daty pierwszej zapłaty.
    expect(updates()[1]?.argsOf("update")?.[0]).not.toHaveProperty("paid_at");
    expect(updates()[1]?.argsOf("eq")).toEqual(["provider_session_id", "cs_1"]);
  });
});

describe("recordRecurringDonationPayment - kotwica i błędy", () => {
  it("donationId wskazujący nieistniejący wiersz: kotwica z subskrypcji, odnowienie z jej danymi", async () => {
    scene.byId = null;
    scene.bySubscription = { ...ANCHOR };

    const outcome = await recordRecurringDonationPayment({
      donationId: "don-usuniety",
      subscriptionId: "sub_1",
      invoiceId: "in_2",
    });

    expect(outcome).toBe("renewed");
    const reads = db.chainsFor("donations").filter((c) => !c.has("insert"));
    expect(reads.map((c) => c.argsOf("eq"))).toEqual([
      ["id", "don-usuniety"],
      ["provider_subscription_id", "sub_1"],
    ]);
    expect(inserted()).toMatchObject({
      tenant_id: "tenant-1",
      user_id: "user-1",
      amount_cents: 5000,
      currency: "PLN",
      donor_email: "darczynca@example.com",
      provider_session_id: "renewal:in_2",
      provider_intent_id: "in_2",
      provider_subscription_id: "sub_1",
      status: "paid",
      paid_at: FIXED_NOW_ISO,
    });
  });

  it("pierwsza faktura bez identyfikatora płatności: klucz płatności = identyfikator faktury", async () => {
    scene.byId = { ...ANCHOR, status: "pending" };

    const outcome = await recordRecurringDonationPayment({
      donationId: "don-1",
      subscriptionId: "sub_1",
      invoiceId: "in_1",
    });

    expect(outcome).toBe("settled");
    const [update] = updates();
    expect(update?.argsOf("update")?.[0]).toMatchObject({
      status: "paid",
      recurring: true,
      paid_at: FIXED_NOW_ISO,
      provider_subscription_id: "sub_1",
      provider_intent_id: "in_1",
    });
    expect(inserted()).toBeUndefined();
  });

  it("błąd zapisu pierwszej wpłaty leci wyjątkiem - bez dopisywania „odnowienia” w zastępstwie", async () => {
    scene.byId = { ...ANCHOR, status: "pending" };
    scene.firstUpdate = fail("deadlock detected", "40P01");

    await expect(
      recordRecurringDonationPayment({
        donationId: "don-1",
        subscriptionId: "sub_1",
        invoiceId: "in_1",
      }),
    ).rejects.toThrow("donation recurring settle failed: deadlock detected");
    expect(inserted()).toBeUndefined();
  });

  it("błąd zapisu odnowienia inny niż duplikat leci wyjątkiem", async () => {
    scene.byId = { ...ANCHOR };
    scene.insert = fail("violates check constraint", "23514");

    await expect(
      recordRecurringDonationPayment({
        donationId: "don-1",
        subscriptionId: "sub_1",
        invoiceId: "in_3",
      }),
    ).rejects.toThrow("donation renewal insert failed: violates check constraint");
  });
});
