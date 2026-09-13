// Warstwa danych rejestru monetyzacji: izolacja najemcy, filtr środowiska
// i mapowanie wierszy. Klient serwisowy omija RLS, więc zawężenie `tenant_id`
// MUSI być dowiedzione testem.
//
// NAJEMCA JEST ARGUMENTEM, NIE ROZSTRZYGNIĘCIEM Z HOSTA. Podaje go wołający,
// a jedynym legalnym źródłem jest bramka `assertAdmin` (profil administratora)
// - to samo pole, po którym autoryzuje się rola. Wcześniej moduł pytał o hosta
// sam, więc admin obszaru A na domenie obszaru B przechodził bramkę w A
// i dostawał rejestr B. Atrapy `currentTenantHost` i `resolveTenantIdForHost`
// zniknęły stąd razem z tamtym kontraktem.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  tenantId: string | null;
  donations: Record<string, unknown>[];
  grants: Record<string, unknown>[];
  links: Record<string, unknown>[];
  errors: Partial<Record<string, { message: string }>>;
  queries: Array<{ table: string; tenantId: string | null; limit: number }>;
} = {
  tenantId: "t-1",
  donations: [],
  grants: [],
  links: [],
  errors: {},
  queries: [],
};

vi.mock("@/integrations/supabase/client.server", () => {
  function builder(table: string) {
    const q: { table: string; tenantId: string | null; limit: number } = {
      table,
      tenantId: null,
      limit: 0,
    };
    state.queries.push(q);
    const rows =
      table === "donations"
        ? state.donations
        : table === "membership_grants"
          ? state.grants
          : state.links;
    const chain = {
      select: () => chain,
      eq: (_col: string, value: string) => {
        q.tenantId = value;
        return chain;
      },
      order: () => chain,
      limit: (n: number) => {
        q.limit = n;
        const error = state.errors[table] ?? null;
        return Promise.resolve(error ? { data: null, error } : { data: rows, error: null });
      },
    };
    return chain;
  }
  return { supabaseAdmin: { from: (table: string) => builder(table) } };
});

import { loadMonetizationLedger as loadMonetizationLedgerRaw } from "@/lib/admin/monetization/ledger.server";

// Wołanie takie jak w handlerze: najemca z bramki, polem wejścia. Pusty
// identyfikator odwzorowuje wartość, której bramka nigdy nie wypuści -
// zostaje jako dowód bezpiecznika (pusty zakres to pusty rejestr).
const loadMonetizationLedger = (input: {
  environment: "all" | "live" | "sandbox";
  limit: number;
}) => loadMonetizationLedgerRaw({ ...input, tenantId: state.tenantId ?? "" });

function donationRow(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    amount_cents: 5000,
    currency: "PLN",
    status: "paid",
    recurring: false,
    donor_email: "anna@example.com",
    environment: "live",
    created_at: "2026-08-01T10:00:00.000Z",
    paid_at: "2026-08-01T10:01:00.000Z",
    ...over,
  };
}

function grantRow(over: Record<string, unknown> = {}) {
  return {
    id: "g1",
    user_id: "u1",
    tier_key: "pro",
    source: "donation",
    note: null,
    source_donation_id: "d1",
    starts_at: "2026-08-01T10:00:00.000Z",
    expires_at: null,
    revoked_at: null,
    created_at: "2026-08-01T10:00:00.000Z",
    ...over,
  };
}

function linkRow(over: Record<string, unknown> = {}) {
  return {
    id: "l1",
    code: "abcdef123456",
    post_id: "p1",
    created_at: "2026-08-01T10:00:00.000Z",
    expires_at: null,
    revoked_at: null,
    redemption_count: 0,
    max_redemptions: 5,
    ...over,
  };
}

beforeEach(() => {
  state.tenantId = "t-1";
  state.donations = [donationRow()];
  state.grants = [grantRow()];
  state.links = [linkRow()];
  state.errors = {};
  state.queries = [];
});

describe("loadMonetizationLedger", () => {
  it("zawęża każdą tabelę do najemcy podanego przez wołającego", async () => {
    await loadMonetizationLedger({ environment: "all", limit: 50 });
    expect(state.queries.map((q) => q.table).sort()).toEqual([
      "donations",
      "membership_grants",
      "post_gift_links",
    ]);
    expect(state.queries.every((q) => q.tenantId === "t-1")).toBe(true);
  });

  it("pusty najemca = pusty rejestr, bez zapytań", async () => {
    state.tenantId = null;
    const result = await loadMonetizationLedger({ environment: "all", limit: 50 });
    expect(result.tenantResolved).toBe(false);
    expect(result.donations).toEqual([]);
    expect(result.grants).toEqual([]);
    expect(result.giftLinks).toEqual([]);
    expect(result.summary.donationCount).toBe(0);
    expect(state.queries).toHaveLength(0);
  });

  it("mapuje wiersze na model domenowy", async () => {
    const result = await loadMonetizationLedger({ environment: "all", limit: 10 });
    expect(result.donations[0]).toMatchObject({
      id: "d1",
      amountCents: 5000,
      donorEmail: "anna@example.com",
      environment: "live",
    });
    expect(result.grants[0]).toMatchObject({ tierKey: "pro", sourceDonationId: "d1" });
    expect(result.giftLinks[0]).toMatchObject({ code: "abcdef123456", maxRedemptions: 5 });
  });

  it("stosuje filtr środowiska, w tym dziedziczenie przez nadania", async () => {
    state.donations = [
      donationRow({ id: "d-live", environment: "live" }),
      donationRow({ id: "d-box", environment: "sandbox" }),
    ];
    state.grants = [
      grantRow({ id: "g-live", source_donation_id: "d-live" }),
      grantRow({ id: "g-box", source_donation_id: "d-box" }),
    ];
    const result = await loadMonetizationLedger({ environment: "sandbox", limit: 50 });
    expect(result.donations.map((d) => d.id)).toEqual(["d-box"]);
    expect(result.grants.map((g) => g.id)).toEqual(["g-box"]);
    expect(result.environment).toBe("sandbox");
  });

  it("puste środowisko w bazie daje unknown i nie znika przy zawężeniu", async () => {
    state.donations = [donationRow({ id: "d-legacy", environment: null })];
    const result = await loadMonetizationLedger({ environment: "live", limit: 50 });
    expect(result.donations[0]?.environment).toBe("unknown");
  });

  it("ogranicza limit do zakresu 1..200", async () => {
    await loadMonetizationLedger({ environment: "all", limit: 5000 });
    expect(state.queries.every((q) => q.limit === 200)).toBe(true);
    state.queries = [];
    await loadMonetizationLedger({ environment: "all", limit: 0 });
    expect(state.queries.every((q) => q.limit === 1)).toBe(true);
  });

  it.each(["donations", "membership_grants", "post_gift_links"])(
    "błąd zapytania %s propaguje",
    async (table) => {
      state.errors = { [table]: { message: `boom ${table}` } };
      await expect(loadMonetizationLedger({ environment: "all", limit: 10 })).rejects.toThrow(
        `boom ${table}`,
      );
    },
  );

  it("liczy podsumowanie z odfiltrowanego rejestru", async () => {
    state.donations = [
      donationRow({ id: "a", amount_cents: 1000 }),
      donationRow({ id: "b", amount_cents: 2000, status: "pending" }),
    ];
    const result = await loadMonetizationLedger({ environment: "all", limit: 50 });
    expect(result.summary.paidTotals).toEqual([{ currency: "PLN", amountCents: 1000, count: 1 }]);
    expect(result.summary.pendingCount).toBe(1);
  });
});
