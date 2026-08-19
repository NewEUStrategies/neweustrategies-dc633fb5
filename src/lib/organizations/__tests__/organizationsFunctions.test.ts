// SERWEROWE FUNKCJE ORGANIZACJI: samoobsługa zaproszeń (0/6 funkcji) oraz
// zarządzanie miejscami planu Zespół (0/16 funkcji).
//
// To warstwa, w której PIENIĄDZE spotykają się z DOSTĘPEM: zmiana liczby miejsc
// najpierw idzie do operatora płatności, a dopiero potem do bazy - inaczej panel
// twierdziłby, że klient ma miejsca, za które nikt nie zapłacił. Testujemy
// kolejność, ścieżki odmowy i to, że autorytet zostaje przy bazie (RPC definera),
// a nie przy kliencie.
//
// Autoryzację i RLS sprawdza pgTAP; tutaj kształt wyników i orkiestracja.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
import {
  callServerFn,
  type ServerFnContext,
  serverFnMiddlewareNames,
} from "@/test/serverFnHarness";

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

const h = vi.hoisted(() => ({
  emails: [] as Array<{ to: string; subject: string }>,
  emailOk: true,
  providerResult: { ok: true } as { ok: boolean; error?: string },
  providerCalls: [] as unknown[],
  notified: [] as unknown[],
  expiry: { expired: 0, notified: 0 },
  reminders: { checked: 0, sent: 0, days: [7, 1], perOrg: true },
  reminderArgs: [] as unknown[],
}));

vi.mock("@/lib/server/email.server", () => ({
  sendTransactionalEmail: async (input: { to: string; subject: string }) => {
    h.emails.push(input);
    return h.emailOk ? { ok: true } : { ok: false, error: "smtp down" };
  },
}));
vi.mock("@/lib/billing/subscriptionProvider.server", () => ({
  updateSubscriptionQuantity: async (...args: unknown[]) => {
    h.providerCalls.push(args);
    return h.providerResult;
  },
}));
vi.mock("@/lib/organizations/teamSeats.server", () => ({
  notifySeatAccessChanges: async (input: unknown) => {
    h.notified.push(input);
    return { graceSent: 0, endedSent: 0 };
  },
  expireSeatGrace: async () => h.expiry,
  sendSeatGraceReminders: async (days: unknown) => {
    h.reminderArgs.push(days);
    return h.reminders;
  },
}));

import * as selfservice from "@/lib/organizations/selfservice.functions";
import * as seats from "@/lib/organizations/teamSeats.functions";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const SEAT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

const db = supabaseFromStub();
let rpcCalls: Array<{ fn: string; args: unknown }> = [];
let rpcResults: Record<string, SupabaseResult> = {};

function context(): ServerFnContext {
  return {
    supabase: {
      from: db.from,
      rpc: async (fn: string, args?: unknown) => {
        rpcCalls.push({ fn, args });
        return rpcResults[fn] ?? ok(null);
      },
    },
    userId: USER_ID,
  };
}

beforeEach(() => {
  db.reset();
  rpcCalls = [];
  rpcResults = {};
  h.emails = [];
  h.emailOk = true;
  h.providerResult = { ok: true };
  h.providerCalls = [];
  h.notified = [];
  h.expiry = { expired: 0, notified: 0 };
  h.reminders = { checked: 0, sent: 0, days: [7, 1], perOrg: true };
  h.reminderArgs = [];
  process.env.PUBLIC_SITE_URL = "https://example.test";
});

describe("inviteOrgSeat", () => {
  const input = { org_id: ORG_ID, email: "Anna@Example.Test", lang: "pl" as const };

  it("miejsce zakłada RPC definera, a zaproszony dostaje maila", async () => {
    rpcResults.org_add_seat = ok(SEAT_ID);
    db.setResponse("member_organizations", () => ok({ name: "Acme" }));
    db.setResponse("profiles", () => ok({ display_name: "Bartek" }));

    const result = await callServerFn(selfservice.inviteOrgSeat, {
      data: input,
      context: context(),
    });
    expect(result).toEqual({ ok: true, seatId: SEAT_ID, emailSent: true });
    expect(rpcCalls[0]).toEqual({
      fn: "org_add_seat",
      args: { p_org: ORG_ID, p_email: "anna@example.test", p_role: "member" },
    });
    expect(h.emails[0].to).toBe("anna@example.test");
  });

  it("odmowa definera wraca krótkim komunikatem, bez wysyłki", async () => {
    rpcResults.org_add_seat = fail("orgs: seats limit reached");
    const result = await callServerFn(selfservice.inviteOrgSeat, {
      data: input,
      context: context(),
    });
    expect(result).toEqual({ ok: false, error: "orgs: seats limit reached" });
    expect(h.emails).toHaveLength(0);
  });

  it("organizacja bez nazwy nie wysyła maila (nie ma czego napisać)", async () => {
    rpcResults.org_add_seat = ok(SEAT_ID);
    db.setResponse("member_organizations", () => ok(null));
    db.setResponse("profiles", () => ok(null));
    const result = await callServerFn<{ emailSent: boolean }>(selfservice.inviteOrgSeat, {
      data: input,
      context: context(),
    });
    expect(result.emailSent).toBe(false);
    expect(h.emails).toHaveLength(0);
  });

  it("brak adresu serwisu w środowisku wyłącza wysyłkę, ale miejsce powstaje", async () => {
    delete process.env.PUBLIC_SITE_URL;
    delete process.env.SITE_URL;
    delete process.env.URL;
    rpcResults.org_add_seat = ok(SEAT_ID);
    db.setResponse("member_organizations", () => ok({ name: "Acme" }));
    db.setResponse("profiles", () => ok(null));
    const result = await callServerFn<{ ok: boolean; emailSent: boolean }>(
      selfservice.inviteOrgSeat,
      { data: input, context: context() },
    );
    expect(result).toMatchObject({ ok: true, emailSent: false });
    expect(h.emails).toHaveLength(0);
  });

  it("nieudana wysyłka nie unieważnia zaproszenia", async () => {
    h.emailOk = false;
    rpcResults.org_add_seat = ok(SEAT_ID);
    db.setResponse("member_organizations", () => ok({ name: "Acme" }));
    db.setResponse("profiles", () => ok({ first_name: "Bartek", last_name: "Nowak" }));
    const result = await callServerFn<{ ok: boolean; emailSent: boolean }>(
      selfservice.inviteOrgSeat,
      { data: input, context: context() },
    );
    expect(result).toMatchObject({ ok: true, emailSent: false });
  });

  it("adres, który nie jest e-mailem, nie przechodzi walidacji", async () => {
    await expect(
      callServerFn(selfservice.inviteOrgSeat, {
        data: { ...input, email: "nie-email" },
        context: context(),
      }),
    ).rejects.toThrow();
  });
});

describe("resendOrgSeatInvite", () => {
  const input = { seat_id: SEAT_ID, lang: "en" as const };

  it("ponowienie stempluje zaproszenie w bazie i wysyła maila", async () => {
    rpcResults.org_touch_seat_invite = ok([
      { org_name: "Acme", invited_email: "anna@example.test" },
    ]);
    db.setResponse("profiles", () => ok({ display_name: "Bartek" }));
    const result = await callServerFn(selfservice.resendOrgSeatInvite, {
      data: input,
      context: context(),
    });
    expect(result).toEqual({ ok: true, emailSent: true });
    expect(h.emails[0].to).toBe("anna@example.test");
  });

  it("odmowa definera wraca komunikatem", async () => {
    rpcResults.org_touch_seat_invite = fail("orgs: not allowed");
    expect(
      await callServerFn(selfservice.resendOrgSeatInvite, { data: input, context: context() }),
    ).toEqual({ ok: false, error: "orgs: not allowed" });
  });

  it("brak miejsca to jasny błąd, nie pusty mail", async () => {
    rpcResults.org_touch_seat_invite = ok([]);
    expect(
      await callServerFn(selfservice.resendOrgSeatInvite, { data: input, context: context() }),
    ).toEqual({ ok: false, error: "orgs: not found" });
    expect(h.emails).toHaveLength(0);
  });
});

describe("setTeamSeatLimit", () => {
  const input = { org_id: ORG_ID, seats: 5 };

  it("organizacja bez subskrypcji zmienia limit wyłącznie w bazie", async () => {
    db.setResponse("member_organizations", () =>
      ok({ id: ORG_ID, seats_limit: 3, seats_source: "manual", provider_subscription_id: null }),
    );
    rpcResults.org_set_seats_limit = ok({ seats_limit: 5, active: 4, grace: 1, suspended: 0 });
    const result = await callServerFn(seats.setTeamSeatLimit, { data: input, context: context() });
    expect(result).toMatchObject({
      ok: true,
      seatsLimit: 5,
      active: 4,
      grace: 1,
      source: "manual",
      providerSynced: false,
    });
    expect(h.providerCalls).toHaveLength(0);
    // Osoby wchodzące w karencję dostają powiadomienie z wyniku przeliczenia.
    expect(h.notified).toHaveLength(1);
  });

  it("organizacja spięta z subskrypcją NAJPIERW zmienia liczbę u operatora", async () => {
    db.setResponse("member_organizations", () =>
      ok({
        id: ORG_ID,
        seats_limit: 3,
        seats_source: "subscription",
        provider_subscription_id: "sub_1",
      }),
    );
    db.setResponse("subscriptions", () =>
      ok({ price_id: "team_monthly_seat", quantity: 3, environment: "live", status: "active" }),
    );
    rpcResults.org_set_seats_limit = ok({ seats_limit: 5, active: 5, grace: 0, suspended: 0 });

    const result = await callServerFn(seats.setTeamSeatLimit, { data: input, context: context() });
    expect(result).toMatchObject({ ok: true, source: "subscription", providerSynced: true });
    expect(h.providerCalls[0]).toEqual([
      "live",
      "sub_1",
      { priceExternalId: "team_monthly_seat", quantity: 5, previousQuantity: 3 },
    ]);
    // Nowa liczba opłaconych miejsc zapisuje się też lokalnie.
    expect(db.chainsFor("subscriptions").some((c) => c.has("update"))).toBe(true);
  });

  it("odmowa operatora zatrzymuje zmianę limitu w bazie", async () => {
    db.setResponse("member_organizations", () =>
      ok({ id: ORG_ID, seats_limit: 3, provider_subscription_id: "sub_1" }),
    );
    db.setResponse("subscriptions", () =>
      ok({ price_id: "team_monthly_seat", quantity: 3, environment: "sandbox", status: "active" }),
    );
    h.providerResult = { ok: false, error: "card declined" };
    const result = await callServerFn(seats.setTeamSeatLimit, { data: input, context: context() });
    expect(result).toEqual({ ok: false, error: "provider: card declined" });
    expect(rpcCalls.map((c) => c.fn)).not.toContain("org_set_seats_limit");
  });

  it("niewidoczna subskrypcja przerywa zmianę", async () => {
    db.setResponse("member_organizations", () =>
      ok({ id: ORG_ID, seats_limit: 3, provider_subscription_id: "sub_1" }),
    );
    db.setResponse("subscriptions", () => ok(null));
    expect(await callServerFn(seats.setTeamSeatLimit, { data: input, context: context() })).toEqual(
      {
        ok: false,
        error: "orgs: subscription not visible",
      },
    );
  });

  it("organizacja poza zasięgiem wołającego to odmowa", async () => {
    db.setResponse("member_organizations", () => ok(null));
    expect(await callServerFn(seats.setTeamSeatLimit, { data: input, context: context() })).toEqual(
      {
        ok: false,
        error: "orgs: not allowed",
      },
    );
  });

  it("błąd RPC limitu wraca komunikatem, nie wyjątkiem", async () => {
    db.setResponse("member_organizations", () =>
      ok({ id: ORG_ID, seats_limit: 3, provider_subscription_id: null }),
    );
    rpcResults.org_set_seats_limit = fail("orgs: not allowed");
    expect(await callServerFn(seats.setTeamSeatLimit, { data: input, context: context() })).toEqual(
      {
        ok: false,
        error: "orgs: not allowed",
      },
    );
  });

  it("liczba miejsc poza zakresem nie przechodzi walidacji", async () => {
    await expect(
      callServerFn(seats.setTeamSeatLimit, {
        data: { org_id: ORG_ID, seats: 0 },
        context: context(),
      }),
    ).rejects.toThrow();
  });
});

describe("linkTeamSubscription", () => {
  it("spięcie wymaga roli administratora", async () => {
    rpcResults.has_role = ok(false);
    expect(
      await callServerFn(seats.linkTeamSubscription, {
        data: { org_id: ORG_ID, subscription_id: "sub_abc" },
        context: context(),
      }),
    ).toEqual({ ok: false, error: "orgs: not allowed" });
  });

  it("rozpięcie wraca do limitu ręcznego", async () => {
    rpcResults.has_role = ok(true);
    db.setResponse("member_organizations", () => ok(null));
    const result = await callServerFn(seats.linkTeamSubscription, {
      data: { org_id: ORG_ID, subscription_id: null },
      context: context(),
    });
    expect(result).toEqual({ ok: true, linked: false, seatsLimit: null });
    expect(db.lastChain("member_organizations")?.argsOf("update")?.[0]).toEqual({
      provider_subscription_id: null,
      seats_source: "manual",
    });
  });

  it("spięcie ustawia limit z liczby opłaconych miejsc", async () => {
    rpcResults.has_role = ok(true);
    db.setResponse("subscriptions", () => ok({ quantity: 7, price_id: "team_monthly_seat" }));
    db.setResponse("member_organizations", () => ok(null));
    rpcResults.org_set_seats_limit = ok({ seats_limit: 7, active: 7, grace: 0, suspended: 0 });
    const result = await callServerFn(seats.linkTeamSubscription, {
      data: { org_id: ORG_ID, subscription_id: "sub_abc" },
      context: context(),
    });
    expect(result).toMatchObject({ ok: true, linked: true, seatsLimit: 7 });
    expect(rpcCalls.at(-1)?.args).toMatchObject({ p_limit: 7, p_source: "subscription" });
  });

  it("nieznana subskrypcja przerywa spięcie", async () => {
    rpcResults.has_role = ok(true);
    db.setResponse("subscriptions", () => ok(null));
    expect(
      await callServerFn(seats.linkTeamSubscription, {
        data: { org_id: ORG_ID, subscription_id: "sub_abc" },
        context: context(),
      }),
    ).toEqual({ ok: false, error: "orgs: subscription not found" });
  });

  it("błąd zapisu spięcia wraca komunikatem", async () => {
    rpcResults.has_role = ok(true);
    db.setResponse("subscriptions", () => ok({ quantity: 2, price_id: "team_monthly_seat" }));
    db.setResponse("member_organizations", () => fail("update failed"));
    expect(
      await callServerFn(seats.linkTeamSubscription, {
        data: { org_id: ORG_ID, subscription_id: "sub_abc" },
        context: context(),
      }),
    ).toEqual({ ok: false, error: "update failed" });
  });

  it("identyfikator subskrypcji musi mieć format operatora", async () => {
    await expect(
      callServerFn(seats.linkTeamSubscription, {
        data: { org_id: ORG_ID, subscription_id: "cokolwiek" },
        context: context(),
      }),
    ).rejects.toThrow();
  });
});

describe("reconcileTeamSeats", () => {
  it("przelicza miejsca względem obecnego limitu", async () => {
    db.setResponse("member_organizations", () => ok({ seats_limit: 4 }));
    rpcResults.org_set_seats_limit = ok({ seats_limit: 4, active: 3, grace: 1, suspended: 0 });
    const result = await callServerFn(seats.reconcileTeamSeats, {
      data: { org_id: ORG_ID },
      context: context(),
    });
    expect(result).toMatchObject({ ok: true, seatsLimit: 4, grace: 1 });
    expect(rpcCalls[0].args).toMatchObject({ p_limit: 4 });
  });

  it("organizacja poza zasięgiem to odmowa", async () => {
    db.setResponse("member_organizations", () => ok(null));
    expect(
      await callServerFn(seats.reconcileTeamSeats, {
        data: { org_id: ORG_ID },
        context: context(),
      }),
    ).toEqual({ ok: false, error: "orgs: not allowed" });
  });

  it("błąd RPC wraca komunikatem", async () => {
    db.setResponse("member_organizations", () => ok({ seats_limit: 4 }));
    rpcResults.org_set_seats_limit = fail("boom");
    expect(
      await callServerFn(seats.reconcileTeamSeats, {
        data: { org_id: ORG_ID },
        context: context(),
      }),
    ).toEqual({ ok: false, error: "boom" });
  });
});

describe("ustawienia karencji", () => {
  it("zmiana długości karencji od razu przelicza i powiadamia", async () => {
    rpcResults.org_set_seats_grace_days = ok({
      seats_limit: 3,
      active: 2,
      grace: 1,
      suspended: 0,
    });
    const result = await callServerFn(seats.setTeamSeatGraceDays, {
      data: { org_id: ORG_ID, days: 14 },
      context: context(),
    });
    expect(result).toMatchObject({ ok: true, graceDays: 14, grace: 1 });
    expect(h.notified).toHaveLength(1);
  });

  it("błąd RPC karencji wraca komunikatem, bez powiadomień", async () => {
    rpcResults.org_set_seats_grace_days = fail("orgs: not allowed");
    expect(
      await callServerFn(seats.setTeamSeatGraceDays, {
        data: { org_id: ORG_ID, days: 7 },
        context: context(),
      }),
    ).toEqual({ ok: false, error: "orgs: not allowed" });
    expect(h.notified).toHaveLength(0);
  });

  it("liczba dni poza zakresem nie przechodzi walidacji", async () => {
    await expect(
      callServerFn(seats.setTeamSeatGraceDays, {
        data: { org_id: ORG_ID, days: 500 },
        context: context(),
      }),
    ).rejects.toThrow();
  });

  it("progi przypomnień są normalizowane przed zapisem", async () => {
    rpcResults.org_set_seats_grace_reminder_days = ok(null);
    const result = await callServerFn(seats.setTeamSeatGraceReminderDays, {
      data: { org_id: ORG_ID, days: [1, 7, 7, 30] },
      context: context(),
    });
    expect(result).toEqual({ ok: true, days: [30, 7, 1] });
    expect(rpcCalls[0].args).toMatchObject({ p_days: [30, 7, 1] });
  });

  it("pusta lista progów jest dozwolona (zostaje sam mail końcowy)", async () => {
    rpcResults.org_set_seats_grace_reminder_days = ok(null);
    expect(
      await callServerFn(seats.setTeamSeatGraceReminderDays, {
        data: { org_id: ORG_ID, days: [] },
        context: context(),
      }),
    ).toEqual({ ok: true, days: [] });
  });

  it("błąd zapisu progów wraca komunikatem", async () => {
    rpcResults.org_set_seats_grace_reminder_days = fail("boom");
    expect(
      await callServerFn(seats.setTeamSeatGraceReminderDays, {
        data: { org_id: ORG_ID, days: [7] },
        context: context(),
      }),
    ).toEqual({ ok: false, error: "boom" });
  });

  it("próg spoza zakresu nie przechodzi walidacji", async () => {
    await expect(
      callServerFn(seats.setTeamSeatGraceReminderDays, {
        data: { org_id: ORG_ID, days: [0] },
        context: context(),
      }),
    ).rejects.toThrow();
  });
});

describe("akcje awaryjne karencji", () => {
  it("wygaszenie karencji wymaga roli administratora", async () => {
    rpcResults.has_role = ok(false);
    expect(await callServerFn(seats.runSeatGraceExpiry, { context: context() })).toEqual({
      ok: false,
      error: "orgs: not allowed",
    });
  });

  it("administrator dostaje liczby z zaplecza", async () => {
    rpcResults.has_role = ok(true);
    h.expiry = { expired: 2, notified: 2 };
    expect(await callServerFn(seats.runSeatGraceExpiry, { context: context() })).toEqual({
      ok: true,
      expired: 2,
      notified: 2,
    });
  });

  it("ręczne przypomnienia wymagają roli administratora", async () => {
    rpcResults.has_role = ok(false);
    expect(
      await callServerFn(seats.runSeatGraceReminders, { data: {}, context: context() }),
    ).toEqual({ ok: false, error: "orgs: not allowed" });
  });

  it("bez podanych progów zaplecze używa konfiguracji organizacji", async () => {
    rpcResults.has_role = ok(true);
    h.reminders = { checked: 3, sent: 1, days: [7, 1], perOrg: true };
    const result = await callServerFn(seats.runSeatGraceReminders, {
      data: {},
      context: context(),
    });
    expect(result).toMatchObject({ ok: true, checked: 3, sent: 1, perOrg: true });
    expect(h.reminderArgs[0]).toBeNull();
  });

  it("podane progi jadą jako override", async () => {
    rpcResults.has_role = ok(true);
    await callServerFn(seats.runSeatGraceReminders, { data: { days: [3] }, context: context() });
    expect(h.reminderArgs[0]).toEqual([3]);
  });
});

describe("bramka uwierzytelnienia - test strukturalny", () => {
  it("każda funkcja organizacji deklaruje requireSupabaseAuth", () => {
    const fns = [...Object.entries(selfservice), ...Object.entries(seats)].filter(
      ([, value]) => typeof value === "object" && value !== null && "handler" in (value as object),
    );
    expect(fns.length).toBeGreaterThan(6);
    for (const [name, value] of fns) {
      expect(serverFnMiddlewareNames(value), `${name} bez bramki`).toContain("requireSupabaseAuth");
    }
  });
});
