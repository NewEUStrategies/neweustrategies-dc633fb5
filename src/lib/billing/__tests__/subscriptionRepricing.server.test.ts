// Orkiestracja przeniesienia subskrypcji na cenę katalogu v6.2
// (`subscriptionRepricing.server.ts`) - operator, baza i poczta atrapowane na
// granicach modułów, reguły decyzji prawdziwe.
//
// CZEGO PILNUJE:
//   1. PODGLĄD NIC NIE ZAPISUJE - ani u operatora, ani w dzienniku, ani w poczcie.
//   2. PREWARUNKI - katalog niezsynchronizowany albo cena operatora inna niż
//      plan v6.2 najemcy: podgląd pokazuje problem, wykonanie odmawia CAŁEJ
//      strony, zanim przeczyta choć jednego kandydata.
//   3. WYKONANIE - mutacja u operatora, wpis `applied` z `tenant_id` i kluczem
//      konfliktu, mail z kluczem idempotencji i zapis jego wyniku.
//   4. IDEMPOTENCJA - wpis `applied` na tę samą cenę pomija operatora; mail
//      ponawia się wyłącznie, gdy wcześniej nie wyszedł.
//   5. BŁĄD OPERATORA - do dziennika trafia KOD powodu, nigdy treść błędu.
//   6. PRZERWANY PRZEBIEG - intencja w dzienniku PRZED mutacją; cena już
//      docelowa przy wpisie intencji to zmiana, która weszła: dokończenie
//      wpisu `applied` i maila zamiast „pominięto". Wpis `applied` na cenę
//      klucza NASTĘPNEJ fazy (harmonogram) nie jest degradowany.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PriceShape, RepriceDecision } from "@/lib/billing/subscriptionRepricing";

const h = vi.hoisted(() => ({
  listCandidates: vi.fn(),
  loadPlans: vi.fn(),
  loadLogs: vi.fn(),
  upsertLog: vi.fn(),
  updateEmail: vi.fn(),
  loadTargets: vi.fn(),
  inspect: vi.fn(),
  reprice: vi.fn(),
  integration: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/server/subscriptionRepricingStore.server", () => ({
  listRepricingCandidates: h.listCandidates,
  loadRepricingTenantPlans: h.loadPlans,
  loadRepricingLogRows: h.loadLogs,
  upsertRepricingLogRow: h.upsertLog,
  updateRepricingEmailStatus: h.updateEmail,
}));
vi.mock("@/lib/billing/subscriptionProvider.server", () => ({
  loadRepricingTargets: h.loadTargets,
  inspectSubscriptionRepricing: h.inspect,
  repriceSubscriptionToCatalog: h.reprice,
  isProviderSubscriptionRef: (ref: string) => ref.startsWith("sub_"),
}));
vi.mock("@/lib/billing/catalogAutoSync.server", () => ({ getIntegrationState: h.integration }));
vi.mock("@/lib/billing/notifications.server", () => ({ notifyPriceLoweredEmail: h.notify }));

import {
  runRepricingPage,
  targetPriceProblems,
  type RepricingPageInput,
} from "@/lib/billing/subscriptionRepricing.server";
import { repriceDecision } from "@/lib/billing/subscriptionRepricing";

const TENANT = "tenant-a";

function flat(
  id: string,
  unitAmount: number,
  interval: PriceShape["interval"] = "month",
): PriceShape {
  return {
    id,
    currency: "pln",
    interval,
    intervalCount: 1,
    unitAmount,
    tiersMode: null,
    tiers: null,
  };
}

const TARGETS: Record<string, PriceShape> = {
  plus_monthly: flat("price_plusNew", 3900),
  plus_annual: flat("price_plusYearNew", 39000, "year"),
  pro_monthly: flat("price_proNew", 11900),
  pro_annual: flat("price_proYearNew", 119000, "year"),
  team_monthly_seat: {
    id: "price_teamNew",
    currency: "pln",
    interval: "month",
    intervalCount: 1,
    unitAmount: null,
    tiersMode: "volume",
    tiers: [
      { upTo: 10, unitAmount: 8900, flatAmount: null },
      { upTo: null, unitAmount: 7900, flatAmount: null },
    ],
  },
};

function plan(tier: string, interval: string, price: number, extra: Record<string, unknown> = {}) {
  return {
    id: `plan-${tier}-${interval}`,
    tier_key: tier,
    interval,
    price_cents: price,
    currency: "PLN",
    active: true,
    volume_threshold_seats: null,
    volume_price_cents: null,
    sort_order: 0,
    created_at: "2026-10-18T00:00:00Z",
    name_pl: tier,
    name_en: tier,
    description_pl: null,
    trial_days: 7,
    ...extra,
  };
}

const PLANS_V62 = [
  plan("member", "month", 3900),
  plan("member", "year", 39000),
  plan("pro", "month", 11900),
  plan("pro", "year", 119000),
  plan("team", "month", 8900, { volume_threshold_seats: 11, volume_price_cents: 7900 }),
];

function candidate(id: string, priceId = "plus_monthly", status = "active") {
  return {
    id,
    user_id: `user-${id}`,
    provider_subscription_id: `sub_${id}`,
    price_id: priceId,
    status,
    quantity: 1,
  };
}

const APPLY: RepriceDecision = repriceDecision({
  status: "active",
  pauseCollection: false,
  pendingUpdate: false,
  items: [{ lookupKey: "plus_monthly", price: flat("price_plusOld", 5900), quantity: 1 }],
  schedule: null,
  targets: TARGETS,
  cancelScheduled: false,
  trialEnd: null,
  periodEnd: 1_798_761_600,
});

const WOULD_INCREASE: RepriceDecision = repriceDecision({
  status: "active",
  pauseCollection: false,
  pendingUpdate: false,
  items: [{ lookupKey: "plus_monthly", price: flat("price_promo", 3500), quantity: 1 }],
  schedule: null,
  targets: TARGETS,
  cancelScheduled: false,
  trialEnd: null,
  periodEnd: 1_798_761_600,
});

const NOT_BILLABLE: RepriceDecision = repriceDecision({
  status: "past_due",
  pauseCollection: false,
  pendingUpdate: false,
  items: [{ lookupKey: "plus_monthly", price: flat("price_plusOld", 5900), quantity: 1 }],
  schedule: null,
  targets: TARGETS,
  cancelScheduled: false,
  trialEnd: null,
  periodEnd: null,
});

const ALREADY_CURRENT: RepriceDecision = repriceDecision({
  status: "active",
  pauseCollection: false,
  pendingUpdate: false,
  items: [{ lookupKey: "plus_monthly", price: flat("price_plusNew", 3900), quantity: 1 }],
  schedule: null,
  targets: TARGETS,
  cancelScheduled: false,
  trialEnd: null,
  periodEnd: 1_798_761_600,
});

/** Wpis dziennika w kształcie `RepricingLogRow` (Członek 59 -> 39 zł). */
function logRow(patch: Record<string, unknown> = {}) {
  return {
    id: "log-1",
    provider_subscription_id: "sub_a",
    to_provider_price_id: "price_plusNew",
    from_provider_price_id: "price_plusOld",
    status: "applied",
    reason: null,
    attempts: 1,
    email_status: "pending",
    lookup_key: "plus_monthly",
    quantity: 1,
    currency: "PLN",
    billing_interval: "month",
    from_amount_cents: 5900,
    to_amount_cents: 3900,
    effective_at: "2027-01-01T00:00:00.000Z",
    applied_at: null,
    user_id: "user-a",
    subscription_id: "a",
    created_at: "2026-10-18T10:00:00.000Z",
    updated_at: "2026-10-18T10:00:00.000Z",
    ...patch,
  };
}

type LoggedRow = { status: string; reason: string | null; toPriceId: string };

function loggedRows(): LoggedRow[] {
  return h.upsertLog.mock.calls.map(([row]) => row as LoggedRow);
}

function input(patch: Partial<RepricingPageInput> = {}): RepricingPageInput {
  return {
    tenantId: TENANT,
    environment: "sandbox",
    mode: "preview",
    cursor: null,
    batchSize: 50,
    actorUserId: "admin-1",
    ...patch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  h.loadPlans.mockResolvedValue(PLANS_V62);
  h.loadTargets.mockResolvedValue(TARGETS);
  h.integration.mockResolvedValue({ catalogCurrent: true, lastStatus: "ok" });
  h.listCandidates.mockResolvedValue([candidate("a")]);
  h.loadLogs.mockResolvedValue([]);
  h.inspect.mockResolvedValue({ ok: true, decision: APPLY });
  h.reprice.mockResolvedValue({ ok: true, decision: APPLY });
  h.upsertLog.mockResolvedValue(undefined);
  h.updateEmail.mockResolvedValue(undefined);
  h.notify.mockResolvedValue("queued");
});

describe("targetPriceProblems - cena operatora vs plan v6.2 najemcy", () => {
  it("komplet cen zgodnych z planami -> brak problemów", () => {
    expect(targetPriceProblems(TARGETS, PLANS_V62)).toEqual([]);
  });

  it("brak ceny, inna kwota i plan sprzed v6.2 są nazwane po kluczu", () => {
    const targets = { ...TARGETS, pro_annual: undefined };
    const plans = PLANS_V62.map((p) =>
      p.tier_key === "member" && p.interval === "month" ? { ...p, price_cents: 5900 } : p,
    );
    expect(targetPriceProblems(targets, plans)).toEqual([
      "target_price_mismatch:plus_monthly",
      "target_price_missing:pro_annual",
    ]);
  });

  it("Zespół: próg wolumenowy sprawdzany na 10 i 11 miejscach", () => {
    const plans = PLANS_V62.map((p) =>
      p.tier_key === "team" ? { ...p, volume_price_cents: 7500 } : p,
    );
    expect(targetPriceProblems(TARGETS, plans)).toEqual([
      "target_price_mismatch:team_monthly_seat",
    ]);
  });

  it("waluta i cykl ceny muszą być te same co w katalogu", () => {
    expect(
      targetPriceProblems(
        { ...TARGETS, plus_monthly: { ...TARGETS.plus_monthly, currency: "eur" } },
        PLANS_V62,
      ),
    ).toEqual(["target_price_mismatch:plus_monthly"]);
    expect(
      targetPriceProblems(
        { ...TARGETS, plus_annual: { ...TARGETS.plus_annual, interval: "month" } },
        PLANS_V62,
      ),
    ).toEqual(["target_price_mismatch:plus_annual"]);
  });
});

describe("podgląd", () => {
  it("decyzje z żywego stanu, BEZ mutacji, dziennika i poczty", async () => {
    const page = await runRepricingPage(input());

    expect(page).toMatchObject({
      ok: true,
      mode: "preview",
      problems: [],
      done: true,
      nextCursor: null,
    });
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({
      outcome: "planned",
      providerSubscriptionId: "sub_a",
      currentAmount: 5900,
      newAmount: 3900,
    });
    expect(h.inspect).toHaveBeenCalledWith("sandbox", "sub_a", TARGETS);
    expect(h.reprice).not.toHaveBeenCalled();
    expect(h.upsertLog).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.updateEmail).not.toHaveBeenCalled();
  });

  it("najemca i środowisko trafiają do każdego odczytu bazy", async () => {
    await runRepricingPage(input({ cursor: "c-1", batchSize: 10 }));

    expect(h.loadPlans).toHaveBeenCalledWith(TENANT);
    expect(h.listCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        environment: "sandbox",
        cursor: "c-1",
        limit: 10,
      }),
    );
    expect(h.loadLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        environment: "sandbox",
        campaign: "pricing_v62",
      }),
    );
  });

  it("pełna partia zwraca kursor ostatniego wiersza", async () => {
    h.listCandidates.mockResolvedValue([candidate("a"), candidate("b")]);
    const page = await runRepricingPage(input({ batchSize: 2 }));
    expect(page).toMatchObject({ ok: true, nextCursor: "b", done: false });
  });

  it("katalog niezsynchronizowany: problem w podglądzie, wiersze nadal liczone", async () => {
    h.integration.mockResolvedValue({ catalogCurrent: false, lastStatus: "ok" });
    const page = await runRepricingPage(input());
    expect(page).toMatchObject({ ok: true, problems: ["catalog_not_synced"] });
  });

  it("identyfikator spoza operatora (np. mock) jest błędem wiersza, bez odczytu", async () => {
    h.listCandidates.mockResolvedValue([{ ...candidate("m"), provider_subscription_id: "mock_m" }]);
    const page = await runRepricingPage(input());
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows[0]).toMatchObject({ outcome: "failed", error: "not_provider_subscription" });
    expect(h.inspect).not.toHaveBeenCalled();
  });

  it("odczyt operatora nieudany: kod powodu zamiast treści błędu", async () => {
    h.inspect.mockResolvedValue({
      ok: false,
      error: "No such subscription: 'sub_a' for jan@example.org",
    });
    const page = await runRepricingPage(input());
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows[0]).toMatchObject({ outcome: "failed", error: "provider_error" });
  });
});

describe("wykonanie", () => {
  it("prewarunki niespełnione: odmowa CAŁEJ strony przed odczytem kandydatów", async () => {
    h.integration.mockResolvedValue({ catalogCurrent: true, lastStatus: "partial" });
    const page = await runRepricingPage(input({ mode: "execute" }));

    expect(page).toEqual({
      ok: false,
      error: "preconditions_failed",
      problems: ["catalog_not_synced"],
    });
    expect(h.listCandidates).not.toHaveBeenCalled();
    expect(h.reprice).not.toHaveBeenCalled();
  });

  it("apply: operator, dziennik z tenant_id, mail z kluczem i zapis jego wyniku", async () => {
    const page = await runRepricingPage(input({ mode: "execute" }));

    expect(h.reprice).toHaveBeenCalledWith("sandbox", "sub_a", {
      targets: TARGETS,
      campaign: "pricing_v62",
    });
    expect(h.upsertLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        campaign: "pricing_v62",
        environment: "sandbox",
        subscriptionId: "a",
        providerSubscriptionId: "sub_a",
        userId: "user-a",
        lookupKey: "plus_monthly",
        fromPriceId: "price_plusOld",
        toPriceId: "price_plusNew",
        fromAmountCents: 5900,
        toAmountCents: 3900,
        billingInterval: "month",
        status: "applied",
        attempts: 1,
        emailStatus: "pending",
        actorUserId: "admin-1",
      }),
    );
    // Pierwszy zapis to intencja sprzed mutacji, ostatni - wynik `applied`.
    const logged = h.upsertLog.mock.calls.at(-1)?.[0] as { appliedAt: string | null };
    expect(logged.appliedAt).not.toBeNull();
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-a",
        tenantId: TENANT,
        planId: "plan-member-month",
        previousAmountCents: 5900,
        newAmountCents: 3900,
        currency: "PLN",
        interval: "month",
        idempotencySeed: "sub_a:price_plusNew",
      }),
    );
    expect(h.updateEmail).toHaveBeenCalledWith({
      tenantId: TENANT,
      environment: "sandbox",
      providerSubscriptionId: "sub_a",
      toPriceId: "price_plusNew",
      emailStatus: "queued",
    });
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows[0]).toMatchObject({ outcome: "applied", emailStatus: "queued" });
  });

  it("apply bez obniżki kwoty (Zespół od 11 miejsc): wpis ze statusem maila `skipped`, bez maila", async () => {
    const noEmail = { ...APPLY, emailEligible: false };
    h.inspect.mockResolvedValue({ ok: true, decision: noEmail });
    h.reprice.mockResolvedValue({ ok: true, decision: noEmail });
    const page = await runRepricingPage(input({ mode: "execute" }));

    expect(h.upsertLog).toHaveBeenCalledWith(expect.objectContaining({ emailStatus: "skipped" }));
    expect(h.notify).not.toHaveBeenCalled();
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows[0].emailStatus).toBe("skipped");
  });

  it("wpis `applied` na tę samą cenę: operator pominięty, mail ponowiony po awarii", async () => {
    h.loadLogs.mockResolvedValue([
      {
        id: "log-1",
        provider_subscription_id: "sub_a",
        to_provider_price_id: "price_plusNew",
        from_provider_price_id: "price_plusOld",
        status: "applied",
        reason: null,
        attempts: 1,
        email_status: "failed",
        lookup_key: "plus_monthly",
        quantity: 1,
        currency: "PLN",
        billing_interval: "month",
        from_amount_cents: 5900,
        to_amount_cents: 3900,
        effective_at: "2027-01-01T00:00:00.000Z",
        applied_at: "2026-10-18T10:00:00.000Z",
        user_id: "user-a",
        subscription_id: "a",
        created_at: "2026-10-18T10:00:00.000Z",
        updated_at: "2026-10-18T10:00:00.000Z",
      },
    ]);
    const page = await runRepricingPage(input({ mode: "execute" }));

    expect(h.inspect).not.toHaveBeenCalled();
    expect(h.reprice).not.toHaveBeenCalled();
    expect(h.upsertLog).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencySeed: "sub_a:price_plusNew" }),
    );
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows[0]).toMatchObject({ outcome: "already_applied", emailStatus: "queued" });
  });

  it("wpis `applied` z wysłanym mailem: podgląd i wykonanie bez żadnego ruchu", async () => {
    h.loadLogs.mockResolvedValue([
      {
        id: "log-1",
        provider_subscription_id: "sub_a",
        to_provider_price_id: "price_plusNew",
        from_provider_price_id: "price_plusOld",
        status: "applied",
        reason: null,
        attempts: 1,
        email_status: "queued",
        lookup_key: "plus_monthly",
        quantity: 1,
        currency: "PLN",
        billing_interval: "month",
        from_amount_cents: 5900,
        to_amount_cents: 3900,
        effective_at: null,
        applied_at: "2026-10-18T10:00:00.000Z",
        user_id: "user-a",
        subscription_id: "a",
        created_at: "2026-10-18T10:00:00.000Z",
        updated_at: "2026-10-18T10:00:00.000Z",
      },
    ]);
    const page = await runRepricingPage(input({ mode: "execute" }));

    expect(h.notify).not.toHaveBeenCalled();
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows[0]).toMatchObject({
      outcome: "already_applied",
      currentAmount: 5900,
      newAmount: 3900,
      currentMrr: 5900,
      newMrr: 3900,
    });
  });

  it("błąd operatora: wpis `failed` z KODEM powodu i licznikiem prób", async () => {
    h.loadLogs.mockResolvedValue([
      {
        id: "log-1",
        provider_subscription_id: "sub_a",
        to_provider_price_id: "price_plusNew",
        from_provider_price_id: "price_plusOld",
        status: "failed",
        reason: "provider_error",
        attempts: 2,
        email_status: "pending",
        lookup_key: "plus_monthly",
        quantity: 1,
        currency: "PLN",
        billing_interval: "month",
        from_amount_cents: 5900,
        to_amount_cents: 3900,
        effective_at: null,
        applied_at: null,
        user_id: "user-a",
        subscription_id: "a",
        created_at: "2026-10-18T10:00:00.000Z",
        updated_at: "2026-10-18T10:00:00.000Z",
      },
    ]);
    h.reprice.mockResolvedValue({ ok: false, error: "Card for jan@example.org was declined" });
    const page = await runRepricingPage(input({ mode: "execute" }));

    expect(h.upsertLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        reason: "provider_error",
        attempts: 3,
        appliedAt: null,
      }),
    );
    expect(h.notify).not.toHaveBeenCalled();
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows[0]).toMatchObject({ outcome: "failed", error: "provider_error" });
  });

  it("stan zmieniony między odczytem a mutacją: pominięcie bez maila", async () => {
    h.reprice.mockResolvedValue({ ok: true, decision: WOULD_INCREASE });
    const page = await runRepricingPage(input({ mode: "execute" }));

    expect(h.upsertLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "skipped",
        reason: "would_increase",
        emailStatus: "skipped",
      }),
    );
    expect(h.notify).not.toHaveBeenCalled();
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows[0]).toMatchObject({ outcome: "skipped", reason: "would_increase" });
  });

  it("pominięcia bez kwot (zaległa płatność) nie trafiają do dziennika", async () => {
    h.inspect.mockResolvedValue({ ok: true, decision: NOT_BILLABLE });
    const page = await runRepricingPage(input({ mode: "execute" }));

    expect(h.reprice).not.toHaveBeenCalled();
    expect(h.upsertLog).not.toHaveBeenCalled();
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows[0]).toMatchObject({ outcome: "skipped", reason: "status_not_billable" });
  });

  it("awaria zapisu statusu maila nie wywraca strony - mail i tak jest w kolejce", async () => {
    h.updateEmail.mockRejectedValue(new Error("db down"));
    const page = await runRepricingPage(input({ mode: "execute" }));
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows[0]).toMatchObject({ outcome: "applied", emailStatus: "queued" });
  });
});

describe("przerwany przebieg i harmonogram między kluczami", () => {
  it("intencja (`failed` / `in_progress`) trafia do dziennika PRZED mutacją u operatora", async () => {
    await runRepricingPage(input({ mode: "execute" }));

    expect(h.upsertLog.mock.calls[0][0]).toMatchObject({
      status: "failed",
      reason: "in_progress",
      fromPriceId: "price_plusOld",
      toPriceId: "price_plusNew",
      fromAmountCents: 5900,
      toAmountCents: 3900,
      emailStatus: "pending",
      appliedAt: null,
    });
    expect(h.upsertLog.mock.invocationCallOrder[0]).toBeLessThan(
      h.reprice.mock.invocationCallOrder[0],
    );
    // Po udanej zmianie ten sam klucz dostaje `applied`.
    expect(loggedRows().map((row) => row.status)).toEqual(["failed", "applied"]);
  });

  it("cena już docelowa przy wpisie intencji: dokończenie `applied` i mail, nie „pominięto”", async () => {
    h.loadLogs.mockResolvedValue([logRow({ status: "failed", reason: "in_progress" })]);
    h.inspect.mockResolvedValue({ ok: true, decision: ALREADY_CURRENT });

    const page = await runRepricingPage(input({ mode: "execute" }));

    expect(h.reprice).not.toHaveBeenCalled();
    expect(loggedRows()).toEqual([
      expect.objectContaining({
        status: "applied",
        reason: null,
        fromPriceId: "price_plusOld",
        toPriceId: "price_plusNew",
        fromAmountCents: 5900,
        toAmountCents: 3900,
        emailStatus: "pending",
      }),
    ]);
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        previousAmountCents: 5900,
        newAmountCents: 3900,
        idempotencySeed: "sub_a:price_plusNew",
      }),
    );
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows[0]).toMatchObject({ outcome: "applied", emailStatus: "queued" });
  });

  it("niejednoznaczny błąd operatora, po którym cena jednak weszła - też dokończenie", async () => {
    h.loadLogs.mockResolvedValue([logRow({ status: "failed", reason: "provider_error" })]);
    h.inspect.mockResolvedValue({ ok: true, decision: ALREADY_CURRENT });

    const page = await runRepricingPage(input({ mode: "execute" }));

    expect(loggedRows().map((row) => row.status)).toEqual(["applied"]);
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows[0].outcome).toBe("applied");
  });

  it("intencja bez maila (bez realnej obniżki albo przy rezygnacji) - dokończenie bez maila", async () => {
    h.loadLogs.mockResolvedValue([
      logRow({ status: "failed", reason: "in_progress", email_status: "skipped" }),
    ]);
    h.inspect.mockResolvedValue({ ok: true, decision: ALREADY_CURRENT });

    const page = await runRepricingPage(input({ mode: "execute" }));

    expect(loggedRows()).toEqual([
      expect.objectContaining({ status: "applied", emailStatus: "skipped" }),
    ]);
    expect(h.notify).not.toHaveBeenCalled();
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows[0]).toMatchObject({ outcome: "applied", emailStatus: "skipped" });
  });

  it("podgląd przerwanego przebiegu pokazuje dokończenie z kwotami intencji, bez zapisu", async () => {
    h.loadLogs.mockResolvedValue([logRow({ status: "failed", reason: "in_progress" })]);
    h.inspect.mockResolvedValue({ ok: true, decision: ALREADY_CURRENT });

    const page = await runRepricingPage(input());

    expect(h.upsertLog).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows[0]).toMatchObject({
      outcome: "planned",
      currentAmount: 5900,
      newAmount: 3900,
    });
  });

  it("harmonogram Pro -> Członek: wpis `applied` na cenę Członka NIE jest degradowany", async () => {
    // Lustro wskazuje `pro_monthly`, a przeniesienie trafiło w cenę klucza
    // NASTĘPNEJ fazy (`plus_monthly`) - ponowne „Wykonaj" nie może zapisać
    // na tym kluczu `skipped / already_current`.
    h.listCandidates.mockResolvedValue([candidate("a", "pro_monthly")]);
    h.loadLogs.mockResolvedValue([
      logRow({
        status: "applied",
        applied_at: "2026-10-18T10:00:00.000Z",
        email_status: "queued",
      }),
    ]);

    const page = await runRepricingPage(input({ mode: "execute" }));

    expect(h.inspect).not.toHaveBeenCalled();
    expect(h.reprice).not.toHaveBeenCalled();
    expect(h.upsertLog).not.toHaveBeenCalled();
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows[0]).toMatchObject({
      outcome: "already_applied",
      lookupKey: "plus_monthly",
      emailStatus: "queued",
    });
  });

  it("stan zmieniony przed mutacją (zaległa płatność): intencja zamknięta jako pominięcie", async () => {
    h.reprice.mockResolvedValue({ ok: true, decision: NOT_BILLABLE });

    const page = await runRepricingPage(input({ mode: "execute" }));

    expect(loggedRows()).toEqual([
      expect.objectContaining({ status: "failed", reason: "in_progress" }),
      expect.objectContaining({
        status: "skipped",
        reason: "status_not_billable",
        toPriceId: "price_plusNew",
        emailStatus: "skipped",
      }),
    ]);
    expect(h.notify).not.toHaveBeenCalled();
    if (!page.ok) throw new Error("expected ok");
    expect(page.rows[0]).toMatchObject({ outcome: "skipped", reason: "status_not_billable" });
  });
});
