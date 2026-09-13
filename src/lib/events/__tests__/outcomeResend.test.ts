// Ponowna wysyłka powiadomień: odtwarza wynik ze stanu bazy i NIE zmienia
// niczego poza wysłaniem wiadomości.
//
// ZAKRES NAJEMCY JEST TU DOWODZONY, NIE ZAKŁADANY. Odczyt idzie kluczem
// serwisowym (z pominięciem RLS) po identyfikatorze, który przyszedł od
// klienta, więc jedyną granicą najemcy jest jawny `.eq("tenant_id", …)`.
// Dlatego atrapa bazy REALNIE FILTRUJE po zapisanych ogniwach `.eq()` -
// atrapa oddająca stały wiersz przechodziłaby tak samo dla cudzego zgłoszenia
// i „dowodziłaby" izolacji, której by nie było.
import { beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.fn(async () => ({ emailed: true, smsSent: false, promotedNotified: 0 }));

type Row = Record<string, unknown>;

/** Wszystkie wiersze w bazie, per tabela - atrapa wybiera z nich filtrami. */
const rows: Record<string, Row[]> = {};

/** Zapisane ogniwa `.eq()` każdego wykonanego łańcucha (tabela + para). */
const eqCalls: Array<{ table: string; column: string; value: unknown }> = [];

function table(name: string) {
  const filters: Array<[string, unknown]> = [];
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      eqCalls.push({ table: name, column, value });
      return builder;
    },
    maybeSingle: async () => {
      const match = (rows[name] ?? []).find((row) =>
        filters.every(([column, value]) => row[column] === value),
      );
      return { data: match ?? null, error: null };
    },
  };
  return builder;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (name: string) => table(name) },
}));

vi.mock("@/lib/events/registrationOutcomeNotify.server", () => ({
  notifyTicketOutcome: (...args: unknown[]) => notify(...(args as [])),
}));

const REG = "11111111-1111-4111-8111-111111111111";
const TENANT = "t1";
/** Najemca, w którego obszarze wołający NIE ma nic do szukania. */
const OBCY_TENANT = "t2";

function eqOf(table: string, column: string): unknown {
  return eqCalls.find((c) => c.table === table && c.column === column)?.value;
}

beforeEach(() => {
  notify.mockClear();
  eqCalls.length = 0;
  rows["event_registrations"] = [
    {
      id: REG,
      tenant_id: TENANT,
      event_id: "e1",
      person_id: "p1",
      payment_status: "paid",
      payment_order_id: "o1",
    },
  ];
  rows["event_people"] = [
    { id: "p1", tenant_id: TENANT, user_id: "u1", email: "a@b.pl", phone: null, first_name: "Ala" },
  ];
  rows["events"] = [
    { id: "e1", tenant_id: TENANT, slug: "kongres", title_pl: "Kongres", title_en: "Congress" },
  ];
  rows["payment_orders"] = [
    { id: "o1", tenant_id: TENANT, amount_cents: 10000, refunded_amount_cents: 0, currency: "PLN" },
  ];
});

describe("resendTicketOutcome", () => {
  it("odtwarza wynik 'paid' i wysyła powiadomienie z omięciem bramki duplikatów", async () => {
    const { resendTicketOutcome } = await import("@/lib/events/outcomeResend.server");
    const result = await resendTicketOutcome(REG, TENANT);

    expect(result.outcome).toBe("paid");
    expect(result.emailed).toBe(true);
    const [payload, options] = notify.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { idempotencySuffix?: string },
    ];
    expect(payload["registration_id"]).toBe(REG);
    expect(payload["waitlist"]).toBeNull();
    expect(options.idempotencySuffix).toMatch(/^resend:/);
  });

  it("rozpoznaje zwrot częściowy po kwocie, nie po statusie", async () => {
    rows["payment_orders"] = [
      {
        id: "o1",
        tenant_id: TENANT,
        amount_cents: 10000,
        refunded_amount_cents: 3000,
        currency: "PLN",
      },
    ];
    const { resendTicketOutcome } = await import("@/lib/events/outcomeResend.server");
    expect((await resendTicketOutcome(REG, TENANT)).outcome).toBe("partial_refund");
  });

  it("pełny zwrot kwoty daje wynik 'refunded'", async () => {
    rows["payment_orders"] = [
      {
        id: "o1",
        tenant_id: TENANT,
        amount_cents: 10000,
        refunded_amount_cents: 10000,
        currency: "PLN",
      },
    ];
    const { resendTicketOutcome } = await import("@/lib/events/outcomeResend.server");
    expect((await resendTicketOutcome(REG, TENANT)).outcome).toBe("refunded");
  });

  it("odmawia dla nieistniejącego zgłoszenia", async () => {
    rows["event_registrations"] = [];
    const { resendTicketOutcome } = await import("@/lib/events/outcomeResend.server");
    await expect(resendTicketOutcome(REG, TENANT)).rejects.toThrow(/nie istnieje/i);
  });
});

describe("granica najemcy", () => {
  it("zgłoszenie CUDZEGO najemcy nie wysyła ANI JEDNEGO maila/SMS", async () => {
    // Wiersz istnieje i ma komplet danych kontaktowych - jedyne, co dzieli
    // uczestnika od maila z obcym brandingiem, to filtr najemcy.
    const { resendTicketOutcome } = await import("@/lib/events/outcomeResend.server");

    await expect(resendTicketOutcome(REG, OBCY_TENANT)).rejects.toThrow(/nie istnieje/i);

    expect(notify).not.toHaveBeenCalled();
  });

  it("komunikat dla cudzego zgłoszenia jest IDENTYCZNY jak dla nieistniejącego", async () => {
    // Różnica treści zamieniłaby przycisk w wyrocznię „czy ten UUID istnieje".
    const { resendTicketOutcome } = await import("@/lib/events/outcomeResend.server");

    const obcy = await resendTicketOutcome(REG, OBCY_TENANT).catch((e: Error) => e.message);
    rows["event_registrations"] = [];
    const nieistniejace = await resendTicketOutcome(REG, TENANT).catch((e: Error) => e.message);

    expect(obcy).toBe("Zgłoszenie nie istnieje.");
    expect(nieistniejace).toBe(obcy);
  });

  it("odmowa następuje PRZED odczytem uczestnika, wydarzenia i zamówienia", async () => {
    // Trzy dalsze odczyty niosą e-mail, telefon i kwotę - nie wolno ich nawet
    // wykonać dla zgłoszenia spoza obszaru wołającego.
    const { resendTicketOutcome } = await import("@/lib/events/outcomeResend.server");

    await expect(resendTicketOutcome(REG, OBCY_TENANT)).rejects.toThrow();

    expect(eqCalls.map((c) => c.table)).toEqual(["event_registrations", "event_registrations"]);
  });

  it("KAŻDY z czterech odczytów niesie filtr najemcy", async () => {
    // Zakres trzech dalszych zapytań jest wprawdzie przechodni, ale jawny
    // filtr przetrwa refaktor, który zmieni źródło identyfikatora.
    const { resendTicketOutcome } = await import("@/lib/events/outcomeResend.server");

    await resendTicketOutcome(REG, TENANT);

    for (const table of ["event_registrations", "event_people", "events", "payment_orders"]) {
      expect(eqOf(table, "tenant_id"), `${table} bez filtru najemcy`).toBe(TENANT);
    }
  });

  it("nie podstawia najemcy z wiersza - filtr idzie z argumentu bramki", async () => {
    // Gdyby kod czytał `tenant_id` z odczytanego wiersza, filtr byłby
    // tautologią: każdy wiersz pasowałby do samego siebie.
    rows["event_registrations"] = [{ ...rows["event_registrations"][0], tenant_id: OBCY_TENANT }];
    const { resendTicketOutcome } = await import("@/lib/events/outcomeResend.server");

    await expect(resendTicketOutcome(REG, TENANT)).rejects.toThrow(/nie istnieje/i);
    expect(notify).not.toHaveBeenCalled();
  });
});
