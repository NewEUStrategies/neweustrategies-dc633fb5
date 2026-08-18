// ORKIESTRACJA KARENCJI MIEJSC W ZESPOLE (lib/organizations/teamSeats.server.ts).
//
// Reguły progów przypomnień mają już własne testy (seatGraceReminderDays,
// seatGraceReminders, inviteEmail). Tutaj testujemy to, czego one nie dotykają:
// CO SIĘ FAKTYCZNIE DZIEJE CZŁOWIEKOWI - kiedy wchodzi w karencję, kiedy traci
// dostęp, w jakim języku dostaje maila i czy powtórny przebieg zadania nie
// wyśle mu tego samego powiadomienia drugi raz.
//
// To jednocześnie ryzyko pieniężne i dostępowe: fałszywe odebranie miejsca to
// reklamacja, fałszywe utrzymanie to darmowy dostęp.
//
// Wszystkie dane są syntetyczne. Klient serwisowy i wysyłka maili są atrapami -
// autoryzację i RLS sprawdza pgTAP, nie ten plik.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface SendCall {
  type: string;
  to: string;
  lang: string;
  subjectName: string | null;
  idempotencyKey: string;
  details: Array<{ label: string; value: string }>;
  bodyVars: Record<string, unknown>;
}

const h = vi.hoisted(() => {
  interface State {
    /** Wyniki `rpc(nazwa)` w kolejności wywołań. */
    rpc: Record<string, { data: unknown; error: { message: string } | null }>;
    rpcCalls: Array<{ fn: string; args: unknown }>;
    /** Wynik SELECT-a per tabela. */
    selects: Record<string, { data: unknown; error: { message: string } | null }>;
    /** Zapisy UPDATE per tabela. */
    updates: Array<{ table: string; values: unknown }>;
    updateResult: { data: unknown; error: { message: string } | null };
    /** Wysłane maile + klucze idempotencji już „zużyte". */
    sent: SendCall[];
    usedKeys: Set<string>;
    /** Klucze, dla których wysyłka ma rzucić wyjątkiem (fail-soft). */
    throwOnKey: Set<string>;
  }
  const state: State = {
    rpc: {},
    rpcCalls: [],
    selects: {},
    updates: [],
    updateResult: { data: [], error: null },
    sent: [],
    usedKeys: new Set(),
    throwOnKey: new Set(),
  };
  return { state };
});

vi.mock("@/integrations/supabase/client.server", () => {
  interface Query extends PromiseLike<{ data: unknown; error: unknown }> {
    select: (columns?: string) => Query;
    update: (values: unknown) => Query;
    eq: (column: string, value: unknown) => Query;
    in: (column: string, values: unknown) => Query;
    not: (column: string, op: string, value: unknown) => Query;
    gt: (column: string, value: unknown) => Query;
    lte: (column: string, value: unknown) => Query;
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  }
  const makeQuery = (table: string): Query => {
    let mode: "select" | "update" = "select";
    const result = () =>
      mode === "update"
        ? h.state.updateResult
        : (h.state.selects[table] ?? { data: [], error: null });
    const query: Query = {
      select: () => query,
      update: (values: unknown) => {
        mode = "update";
        h.state.updates.push({ table, values });
        return query;
      },
      eq: () => query,
      in: () => query,
      not: () => query,
      gt: () => query,
      lte: () => query,
      maybeSingle: async () => {
        const r = h.state.selects[table] ?? { data: null, error: null };
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      then: (onFulfilled, onRejected) => Promise.resolve(result()).then(onFulfilled, onRejected),
    };
    return query;
  };
  return {
    supabaseAdmin: {
      from: (table: string) => makeQuery(table),
      rpc: async (fn: string, args: unknown) => {
        h.state.rpcCalls.push({ fn, args });
        return h.state.rpc[fn] ?? { data: null, error: null };
      },
    },
  };
});

vi.mock("@/lib/email/transactional.server", () => ({
  formatDate: (iso: string, lang: string) => `${iso.slice(0, 10)}/${lang}`,
  sendTxEmail: async (input: SendCall) => {
    if (h.state.throwOnKey.has(input.idempotencyKey)) throw new Error("smtp down");
    h.state.sent.push(input);
    // Ten sam klucz idempotencji = wiadomość pominięta, dokładnie jak w
    // prawdziwej wysyłce (dedup w tabeli kolejki).
    if (h.state.usedKeys.has(input.idempotencyKey)) return { ok: true, skipped: "duplicate" };
    h.state.usedKeys.add(input.idempotencyKey);
    return { ok: true };
  },
}));

import {
  applySubscriptionOrgState,
  applySubscriptionSeats,
  expireSeatGrace,
  isPerSeatPrice,
  notifySeatAccessChanges,
  readEnteredGrace,
  readLostAccess,
  sendSeatGraceReminders,
} from "@/lib/organizations/teamSeats.server";

const PER_SEAT_PRICE = "team_monthly_seat";
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const SEAT_ID = "22222222-2222-4222-8222-222222222222";
const DAY = 86_400_000;

const iso = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();

beforeEach(() => {
  h.state.rpc = {};
  h.state.rpcCalls = [];
  h.state.selects = {};
  h.state.updates = [];
  h.state.updateResult = { data: [], error: null };
  h.state.sent = [];
  h.state.usedKeys = new Set();
  h.state.throwOnKey = new Set();
});

describe("isPerSeatPrice", () => {
  it("rozpoznaje plan rozliczany za miejsce", () => {
    expect(isPerSeatPrice(PER_SEAT_PRICE)).toBe(true);
  });

  it("plan bez miejsc i brak ceny to nie jest plan za miejsce", () => {
    expect(isPerSeatPrice("pro_monthly")).toBe(false);
    expect(isPerSeatPrice(null)).toBe(false);
    expect(isPerSeatPrice(undefined)).toBe(false);
  });
});

describe("readEnteredGrace / readLostAccess", () => {
  it("czytają listy z wyniku przeliczenia", () => {
    const value = {
      entered_grace: [
        { seat_id: SEAT_ID, email: " Anna@Example.TEST ", grace_until: iso(3 * DAY) },
      ],
      lost_access: [{ seat_id: SEAT_ID, email: "bartek@example.test" }],
    };
    expect(readEnteredGrace(value)).toEqual([
      { seatId: SEAT_ID, email: "anna@example.test", graceUntil: expect.any(String) },
    ]);
    expect(readLostAccess(value)).toEqual([
      { seatId: SEAT_ID, email: "bartek@example.test", graceUntil: null },
    ]);
  });

  it("śmieci na wejściu dają pustą listę zamiast wyjątku", () => {
    for (const value of [null, undefined, 42, "tekst", {}, { entered_grace: "nie tablica" }]) {
      expect(readEnteredGrace(value)).toEqual([]);
      expect(readLostAccess(value)).toEqual([]);
    }
  });

  it("wiersz bez e-maila albo bez identyfikatora miejsca odpada", () => {
    const value = {
      entered_grace: [
        { seat_id: SEAT_ID },
        { email: "anna@example.test" },
        { seat_id: "", email: "anna@example.test" },
        { seat_id: SEAT_ID, email: "   " },
        "nie obiekt",
        null,
        { seat_id: SEAT_ID, email: "ok@example.test", grace_until: 12345 },
      ],
    };
    expect(readEnteredGrace(value)).toEqual([
      { seatId: SEAT_ID, email: "ok@example.test", graceUntil: null },
    ]);
  });
});

describe("applySubscriptionSeats", () => {
  it("plan spoza rozliczenia za miejsce nie rusza organizacji", async () => {
    const result = await applySubscriptionSeats({
      subscriptionId: "sub_1",
      quantity: 5,
      priceId: "pro_monthly",
    });
    expect(result).toEqual({ linked: false });
    expect(h.state.rpcCalls).toHaveLength(0);
  });

  it("liczba miejsc jest przycinana do zakresu 1-500", async () => {
    h.state.rpc.org_apply_subscription_seats = { data: { linked: false }, error: null };
    await applySubscriptionSeats({ subscriptionId: "sub_1", quantity: 0, priceId: PER_SEAT_PRICE });
    await applySubscriptionSeats({
      subscriptionId: "sub_1",
      quantity: 9000,
      priceId: PER_SEAT_PRICE,
    });
    expect(h.state.rpcCalls.map((c) => c.args)).toEqual([
      { p_subscription_id: "sub_1", p_quantity: 1 },
      { p_subscription_id: "sub_1", p_quantity: 500 },
    ]);
  });

  it("błąd RPC nie wywraca webhooka - zwraca linked:false", async () => {
    h.state.rpc.org_apply_subscription_seats = { data: null, error: { message: "boom" } };
    const result = await applySubscriptionSeats({
      subscriptionId: "sub_1",
      quantity: 3,
      priceId: PER_SEAT_PRICE,
    });
    expect(result).toEqual({ linked: false });
    expect(h.state.sent).toHaveLength(0);
  });

  it("zmniejszenie liczby miejsc powiadamia osoby wchodzące w karencję", async () => {
    const graceUntil = iso(7 * DAY);
    h.state.rpc.org_apply_subscription_seats = {
      data: {
        linked: true,
        org_id: ORG_ID,
        seats_limit: 2,
        active: 2,
        suspended: 0,
        entered_grace: [{ seat_id: SEAT_ID, email: "anna@example.test", grace_until: graceUntil }],
      },
      error: null,
    };
    h.state.selects.member_organizations = { data: [{ name: "Acme" }], error: null };

    const result = await applySubscriptionSeats({
      subscriptionId: "sub_1",
      quantity: 2,
      priceId: PER_SEAT_PRICE,
    });

    expect(result).toEqual({ linked: true, orgId: ORG_ID, seatsLimit: 2, active: 2, suspended: 0 });
    expect(h.state.sent).toHaveLength(1);
    expect(h.state.sent[0].type).toBe("team_seat_grace");
    expect(h.state.sent[0].to).toBe("anna@example.test");
    expect(h.state.sent[0].idempotencyKey).toBe(`team-seat-grace:${SEAT_ID}:${graceUntil}`);
  });

  it("wynik bez organizacji nie próbuje wysyłać powiadomień", async () => {
    h.state.rpc.org_apply_subscription_seats = { data: { linked: true }, error: null };
    const result = await applySubscriptionSeats({
      subscriptionId: "sub_1",
      quantity: 2,
      priceId: PER_SEAT_PRICE,
    });
    expect(result.linked).toBe(true);
    expect(result.orgId).toBeUndefined();
    expect(h.state.sent).toHaveLength(0);
  });

  it("nieczytelny wynik RPC nie jest brany za powiązaną organizację", async () => {
    h.state.rpc.org_apply_subscription_seats = { data: "nonsens", error: null };
    await expect(
      applySubscriptionSeats({ subscriptionId: "sub_1", quantity: 2, priceId: PER_SEAT_PRICE }),
    ).resolves.toEqual({ linked: false });
  });
});

describe("applySubscriptionOrgState", () => {
  it("plan spoza rozliczenia za miejsce nic nie zmienia", async () => {
    expect(
      await applySubscriptionOrgState({
        subscriptionId: "sub_1",
        status: "active",
        priceId: "pro_monthly",
      }),
    ).toEqual({ changed: false });
    expect(h.state.updates).toHaveLength(0);
  });

  it("aktywna i próbna subskrypcja utrzymują dostęp zespołu", async () => {
    h.state.updateResult = { data: [{ id: ORG_ID }], error: null };
    for (const status of ["active", "trialing"]) {
      await applySubscriptionOrgState({ subscriptionId: "sub_1", status, priceId: PER_SEAT_PRICE });
    }
    expect(h.state.updates.map((u) => (u.values as { status: string }).status)).toEqual([
      "active",
      "active",
    ]);
  });

  it("wstrzymanie subskrypcji zawiesza całą organizację", async () => {
    h.state.updateResult = { data: [{ id: ORG_ID }], error: null };
    const result = await applySubscriptionOrgState({
      subscriptionId: "sub_1",
      status: "past_due",
      priceId: PER_SEAT_PRICE,
    });
    expect(result).toEqual({ changed: true });
    expect((h.state.updates[0].values as { status: string }).status).toBe("suspended");
  });

  it("brak trafionej organizacji to brak zmiany", async () => {
    h.state.updateResult = { data: [], error: null };
    expect(
      await applySubscriptionOrgState({
        subscriptionId: "sub_nieznany",
        status: "active",
        priceId: PER_SEAT_PRICE,
      }),
    ).toEqual({ changed: false });
  });

  it("błąd zapisu nie wywraca webhooka", async () => {
    h.state.updateResult = { data: null, error: { message: "boom" } };
    expect(
      await applySubscriptionOrgState({
        subscriptionId: "sub_1",
        status: "active",
        priceId: PER_SEAT_PRICE,
      }),
    ).toEqual({ changed: false });
  });
});

describe("notifySeatAccessChanges", () => {
  it("brak zmian = brak wysyłki", async () => {
    expect(await notifySeatAccessChanges({ orgId: ORG_ID, reconcile: {} })).toEqual({
      graceSent: 0,
      endedSent: 0,
    });
    expect(h.state.sent).toHaveLength(0);
  });

  it("mail o karencji niesie nazwę organizacji i datę końca dostępu", async () => {
    const graceUntil = iso(5 * DAY);
    h.state.selects.member_organizations = { data: [{ name: "Acme" }], error: null };
    const result = await notifySeatAccessChanges({
      orgId: ORG_ID,
      reconcile: {
        entered_grace: [{ seat_id: SEAT_ID, email: "anna@example.test", grace_until: graceUntil }],
      },
    });
    expect(result).toEqual({ graceSent: 1, endedSent: 0 });
    const mail = h.state.sent[0];
    expect(mail.subjectName).toBe("Acme");
    expect(mail.details.map((d) => d.label)).toEqual(["Organizacja", "Dostęp do"]);
    expect(mail.bodyVars.accessUntil).toBe(`${graceUntil.slice(0, 10)}/pl`);
  });

  it("organizacja bez nazwy nie dokłada pustego wiersza do maila", async () => {
    h.state.selects.member_organizations = { data: [], error: null };
    await notifySeatAccessChanges({
      orgId: ORG_ID,
      reconcile: { entered_grace: [{ seat_id: SEAT_ID, email: "anna@example.test" }] },
    });
    expect(h.state.sent[0].details).toEqual([]);
    expect(h.state.sent[0].bodyVars.accessUntil).toBeNull();
  });

  it("utrata dostępu wysyła mail końcowy z linkiem do cennika", async () => {
    h.state.selects.member_organizations = { data: [{ name: "Acme" }], error: null };
    const result = await notifySeatAccessChanges({
      orgId: ORG_ID,
      reconcile: { lost_access: [{ seat_id: SEAT_ID, email: "bartek@example.test" }] },
    });
    expect(result).toEqual({ graceSent: 0, endedSent: 1 });
    expect(h.state.sent[0].type).toBe("team_seat_access_ended");
    expect(h.state.sent[0].idempotencyKey.startsWith(`team-seat-ended:${SEAT_ID}:`)).toBe(true);
  });

  it("język maila bierze się z zapisu do newslettera", async () => {
    h.state.selects.member_organizations = { data: [{ name: "Acme" }], error: null };
    h.state.selects.newsletter_subscribers = { data: [{ language: "en" }], error: null };
    await notifySeatAccessChanges({
      orgId: ORG_ID,
      reconcile: { entered_grace: [{ seat_id: SEAT_ID, email: "anna@example.test" }] },
    });
    expect(h.state.sent[0].lang).toBe("en");
    expect(h.state.sent[0].details).toEqual([{ label: "Organisation", value: "Acme" }]);
  });

  it("nieznany albo brakujący język to polski", async () => {
    h.state.selects.member_organizations = { data: [{ name: "Acme" }], error: null };
    for (const language of ["de", null]) {
      h.state.sent = [];
      h.state.selects.newsletter_subscribers = { data: [{ language }], error: null };
      await notifySeatAccessChanges({
        orgId: ORG_ID,
        reconcile: { lost_access: [{ seat_id: SEAT_ID, email: "anna@example.test" }] },
      });
      expect(h.state.sent[0].lang).toBe("pl");
    }
  });

  it("ten sam okres karencji nie wysyła drugiego maila", async () => {
    const graceUntil = iso(5 * DAY);
    h.state.selects.member_organizations = { data: [{ name: "Acme" }], error: null };
    const reconcile = {
      entered_grace: [{ seat_id: SEAT_ID, email: "anna@example.test", grace_until: graceUntil }],
    };
    const first = await notifySeatAccessChanges({ orgId: ORG_ID, reconcile });
    const second = await notifySeatAccessChanges({ orgId: ORG_ID, reconcile });
    expect(first.graceSent).toBe(1);
    // Druga próba trafia w ten sam klucz idempotencji -> wiadomość pominięta.
    expect(second.graceSent).toBe(0);
  });
});

describe("expireSeatGrace", () => {
  it("błąd RPC kończy się zerami, nie wyjątkiem", async () => {
    h.state.rpc.org_expire_seat_grace = { data: null, error: { message: "boom" } };
    expect(await expireSeatGrace()).toEqual({ expired: 0, notified: 0 });
  });

  it("brak wygasłych miejsc nie wysyła niczego", async () => {
    h.state.rpc.org_expire_seat_grace = { data: { expired: [] }, error: null };
    expect(await expireSeatGrace()).toEqual({ expired: 0, notified: 0 });
    expect(h.state.sent).toHaveLength(0);
  });

  it("wygasłe miejsca grupują się po organizacji i dostają mail końcowy", async () => {
    const OTHER_ORG = "33333333-3333-4333-8333-333333333333";
    h.state.rpc.org_expire_seat_grace = {
      data: {
        expired: [
          { org_id: ORG_ID, seat_id: "seat-1", email: "anna@example.test" },
          { org_id: ORG_ID, seat_id: "seat-2", email: "bartek@example.test" },
          { org_id: OTHER_ORG, seat_id: "seat-3", email: "celina@example.test" },
          { org_id: null, seat_id: "seat-4", email: "bez-org@example.test" },
          "nie obiekt",
        ],
      },
      error: null,
    };
    h.state.selects.member_organizations = { data: [{ name: "Acme" }], error: null };

    const result = await expireSeatGrace();

    // Wiersz bez organizacji i śmieć nie mają jak trafić do maila, ale nadal
    // liczą się jako wygaszone miejsca (to zrobiła baza, nie my).
    expect(result.expired).toBe(5);
    expect(result.notified).toBe(3);
    expect(h.state.sent.map((m) => m.to)).toEqual([
      "anna@example.test",
      "bartek@example.test",
      "celina@example.test",
    ]);
  });

  it("wynik RPC bez listy `expired` jest traktowany jak pusty", async () => {
    h.state.rpc.org_expire_seat_grace = { data: { cokolwiek: 1 }, error: null };
    expect(await expireSeatGrace()).toEqual({ expired: 0, notified: 0 });
  });
});

describe("sendSeatGraceReminders", () => {
  const seatRow = (
    over: Partial<{ id: string; org_id: string; invited_email: string; grace_until: string }>,
  ) => ({
    id: "seat-1",
    org_id: ORG_ID,
    invited_email: "anna@example.test",
    grace_until: iso(7 * DAY),
    ...over,
  });

  it("puste progi w trybie override kończą pracę bez zapytania", async () => {
    const result = await sendSeatGraceReminders([0, 999]);
    expect(result).toEqual({ checked: 0, sent: 0, days: [], perOrg: false });
  });

  it("błąd zapytania nie przerywa crona", async () => {
    h.state.selects.organization_seats = { data: null, error: { message: "boom" } };
    const result = await sendSeatGraceReminders([7]);
    expect(result).toEqual({ checked: 0, sent: 0, days: [7], perOrg: false });
  });

  it("brak miejsc w karencji = brak wysyłki", async () => {
    h.state.selects.organization_seats = { data: [], error: null };
    expect(await sendSeatGraceReminders([7])).toEqual({
      checked: 0,
      sent: 0,
      days: [7],
      perOrg: false,
    });
  });

  it("wysyła przypomnienie miejscu, któremu został dokładnie próg dni", async () => {
    h.state.selects.organization_seats = {
      // +6 dni i 12 h -> „zostało 7 dni" po zaokrągleniu w górę.
      data: [seatRow({ grace_until: iso(6 * DAY + DAY / 2) })],
      error: null,
    };
    h.state.selects.member_organizations = {
      data: [{ id: ORG_ID, name: "Acme", seats_grace_reminder_days: null }],
      error: null,
    };
    const result = await sendSeatGraceReminders([7]);
    expect(result.checked).toBe(1);
    expect(result.sent).toBe(1);
    expect(h.state.sent[0].type).toBe("team_seat_grace_reminder");
    expect(h.state.sent[0].details.at(-1)).toEqual({ label: "Pozostało", value: "7 dni" });
  });

  it("dzień przed końcem mówi „1 dzień”, a nie „1 dni”", async () => {
    h.state.selects.organization_seats = {
      data: [seatRow({ grace_until: iso(DAY / 2) })],
      error: null,
    };
    h.state.selects.member_organizations = {
      data: [{ id: ORG_ID, name: "Acme", seats_grace_reminder_days: null }],
      error: null,
    };
    await sendSeatGraceReminders([1]);
    expect(h.state.sent[0].details.at(-1)).toEqual({ label: "Pozostało", value: "1 dzień" });
    expect(h.state.sent[0].bodyVars.daysLeft).toBe(1);
  });

  it("miejsce spoza progu jest sprawdzone, ale bez wysyłki", async () => {
    h.state.selects.organization_seats = {
      data: [seatRow({ grace_until: iso(3 * DAY) })],
      error: null,
    };
    h.state.selects.member_organizations = {
      data: [{ id: ORG_ID, name: "Acme", seats_grace_reminder_days: null }],
      error: null,
    };
    const result = await sendSeatGraceReminders([7, 1]);
    expect(result).toMatchObject({ checked: 1, sent: 0 });
  });

  it("progi organizacji mają pierwszeństwo, gdy nie podano override", async () => {
    h.state.selects.organization_seats = {
      data: [seatRow({ grace_until: iso(2 * DAY + DAY / 2) })],
      error: null,
    };
    h.state.selects.member_organizations = {
      data: [{ id: ORG_ID, name: "Acme", seats_grace_reminder_days: [3] }],
      error: null,
    };
    const result = await sendSeatGraceReminders();
    expect(result.perOrg).toBe(true);
    expect(result.sent).toBe(1);
  });

  it("organizacja bez własnych progów wraca do domyślnych 7 i 1", async () => {
    h.state.selects.organization_seats = {
      data: [seatRow({ grace_until: iso(6 * DAY + DAY / 2) })],
      error: null,
    };
    h.state.selects.member_organizations = { data: [], error: null };
    const result = await sendSeatGraceReminders();
    expect(result.days).toEqual([7, 1]);
    expect(result.sent).toBe(1);
  });

  it("miejsce bez adresu e-mail jest pomijane", async () => {
    h.state.selects.organization_seats = {
      data: [seatRow({ invited_email: "   ", grace_until: iso(6 * DAY + DAY / 2) })],
      error: null,
    };
    h.state.selects.member_organizations = {
      data: [{ id: ORG_ID, name: "Acme", seats_grace_reminder_days: null }],
      error: null,
    };
    expect(await sendSeatGraceReminders([7])).toMatchObject({ checked: 1, sent: 0 });
  });

  it("wiersz z uszkodzoną datą karencji nie trafia do wysyłki", async () => {
    h.state.selects.organization_seats = {
      data: [seatRow({ grace_until: "brak-daty" })],
      error: null,
    };
    h.state.selects.member_organizations = {
      data: [{ id: ORG_ID, name: "Acme", seats_grace_reminder_days: null }],
      error: null,
    };
    // `daysUntil` oddaje -1 dla nieparsowalnej daty, a -1 nie jest żadnym progiem.
    expect(await sendSeatGraceReminders([7, 1])).toMatchObject({ sent: 0 });
  });

  it("DRUGI PRZEBIEG NIE WYSYŁA DRUGI RAZ (idempotencja klucza)", async () => {
    h.state.selects.organization_seats = {
      data: [seatRow({ grace_until: iso(6 * DAY + DAY / 2) })],
      error: null,
    };
    h.state.selects.member_organizations = {
      data: [{ id: ORG_ID, name: "Acme", seats_grace_reminder_days: null }],
      error: null,
    };
    const first = await sendSeatGraceReminders([7]);
    const second = await sendSeatGraceReminders([7]);
    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(new Set(h.state.sent.map((m) => m.idempotencyKey)).size).toBe(1);
  });

  it("błąd wysyłki jednego maila nie przerywa serii (fail-soft)", async () => {
    h.state.selects.organization_seats = {
      data: [
        seatRow({ id: "seat-1", grace_until: iso(6 * DAY + DAY / 2) }),
        seatRow({
          id: "seat-2",
          invited_email: "bartek@example.test",
          grace_until: iso(6 * DAY + DAY / 2),
        }),
      ],
      error: null,
    };
    h.state.selects.member_organizations = {
      data: [{ id: ORG_ID, name: "Acme", seats_grace_reminder_days: null }],
      error: null,
    };
    h.state.throwOnKey.add(
      `team-seat-grace-reminder:seat-1:${h.state.selects.organization_seats.data ? "" : ""}`,
    );
    // Klucz zależy od daty, więc blokujemy po prostu pierwszą wysyłkę:
    h.state.throwOnKey = new Set([
      `team-seat-grace-reminder:seat-1:${(h.state.selects.organization_seats.data as Array<{ grace_until: string }>)[0].grace_until}:7`,
    ]);
    const result = await sendSeatGraceReminders([7]);
    expect(result.checked).toBe(2);
    expect(result.sent).toBe(1);
    expect(h.state.sent.map((m) => m.to)).toEqual(["bartek@example.test"]);
  });
});
