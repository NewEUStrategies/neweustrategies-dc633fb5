// Księga darowizn: co dokładnie dzieje się w tabeli `donations` na każdej
// ścieżce - otwarcie kasy, zapłata jednorazowa, pierwsza wpłata cykliczna,
// odnowienie, ponowienie webhooka, zwrot, anulowanie subskrypcji.
//
// Test pracuje na miniaturowej, prawdziwej tabeli (filtry, ORDER BY, unikaty),
// a nie na atrapie liczącej wywołania: interesuje nas STAN rejestru po
// zdarzeniu, bo to on trafia do panelu, eksportów księgowych i triggera
// nadającego status wspierającego.
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Miniaturowa baza -------------------------------------------------------

type Row = Record<string, unknown>;
type Pred = (row: Row) => boolean;
type Result = { data: Row[] | Row | null; error: { message: string; code?: string } | null };

/** Unikaty z migracji: `provider_session_id` oraz `(provider, provider_intent_id)`. */
function uniqueViolation(rows: Row[], candidate: Row): boolean {
  return rows.some(
    (row) =>
      row["provider_session_id"] === candidate["provider_session_id"] ||
      (candidate["provider_intent_id"] != null &&
        row["provider_intent_id"] === candidate["provider_intent_id"] &&
        row["provider"] === candidate["provider"]),
  );
}

class FakeTable {
  constructor(public rows: Row[] = []) {}
}

class FakeQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | null = null;
  private preds: Pred[] = [];
  private orderBy: { column: string; asc: boolean } | null = null;
  private take: number | null = null;

  constructor(private table: FakeTable) {}

  select(_columns?: string): this {
    return this;
  }
  insert(row: Row): this {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(patch: Row): this {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown): this {
    this.preds.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown): this {
    this.preds.push((row) => row[column] !== value);
    return this;
  }
  is(column: string, value: unknown): this {
    this.preds.push((row) => (row[column] ?? null) === value);
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { column, asc: opts?.ascending !== false };
    return this;
  }
  limit(count: number): this {
    this.take = count;
    return this;
  }

  private matched(): Row[] {
    let rows = this.table.rows.filter((row) => this.preds.every((pred) => pred(row)));
    if (this.orderBy) {
      const { column, asc } = this.orderBy;
      rows = [...rows].sort((a, b) =>
        String(a[column]) < String(b[column]) ? (asc ? -1 : 1) : asc ? 1 : -1,
      );
    }
    return this.take === null ? rows : rows.slice(0, this.take);
  }

  private run(): Result {
    if (this.op === "insert") {
      const row: Row = {
        id: `row-${this.table.rows.length + 1}`,
        created_at: new Date(2026, 0, this.table.rows.length + 1).toISOString(),
        status: "paid",
        recurring: false,
        paid_at: null,
        provider_intent_id: null,
        provider_subscription_id: null,
        user_id: null,
        message: null,
        ...this.payload,
      };
      if (uniqueViolation(this.table.rows, row)) {
        return { data: null, error: { message: "duplicate key", code: "23505" } };
      }
      this.table.rows.push(row);
      return { data: [row], error: null };
    }
    if (this.op === "update") {
      const rows = this.matched();
      for (const row of rows) Object.assign(row, this.payload);
      return { data: rows, error: null };
    }
    if (this.op === "delete") {
      const rows = this.matched();
      this.table.rows = this.table.rows.filter((row) => !rows.includes(row));
      return { data: rows, error: null };
    }
    return { data: this.matched(), error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const result = this.run();
    const rows = (result.data ?? []) as Row[];
    return { data: rows[0] ?? null, error: null };
  }
  async single(): Promise<Result> {
    const result = this.run();
    const rows = (result.data ?? []) as Row[];
    if (rows.length === 0) return { data: null, error: { message: "no rows" } };
    return { data: rows[0] ?? null, error: null };
  }
  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

const donations = new FakeTable();
const settings: Row[] = [];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) =>
      new FakeQuery(table === "donations" ? donations : new FakeTable(settings)),
  },
}));

const sessionsCreate = vi.fn();
vi.mock("@/lib/stripe.server", () => ({
  createStripeClient: () => ({ checkout: { sessions: { create: sessionsCreate } } }),
  getStripeErrorMessage: () => "provider_error",
}));
vi.mock("@/lib/server/tenant.server", () => ({ resolveTenantIdForHost: async () => "tenant-1" }));
vi.mock("@/lib/http/requestHost", () => ({ currentTenantHost: async () => "nes.test" }));

const allowAttempt = vi.fn(async () => true);
vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: () => allowAttempt() }));

import {
  createDonationSession,
  recordRecurringDonationPayment,
  settleDonation,
  syncDonationSubscription,
} from "@/lib/billing/donations.server";

const ANCHOR = {
  id: "don-1",
  tenant_id: "tenant-1",
  user_id: "user-1",
  amount_cents: 5000,
  currency: "PLN",
  donor_email: "darczynca@example.com",
  message: "Trzymajcie tak dalej",
  provider: "stripe",
  provider_session_id: "cs_first",
  provider_intent_id: null,
  provider_subscription_id: "sub_1",
  recurring: true,
  status: "pending",
  paid_at: null,
  created_at: "2026-01-01T10:00:00.000Z",
};

function seed(...rows: Row[]): void {
  donations.rows = rows.map((row) => ({ ...row }));
}
const row = (id: string): Row | undefined => donations.rows.find((r) => r["id"] === id);

beforeEach(() => {
  donations.rows = [];
  settings.length = 0;
  sessionsCreate.mockReset();
  allowAttempt.mockClear();
  allowAttempt.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------

describe("otwarcie kasy darowizny", () => {
  beforeEach(() => {
    sessionsCreate.mockResolvedValue({ id: "cs_new", client_secret: "secret_123" });
  });

  it("zapisuje deklarację cykliczności i konto darczyńcy już przy tworzeniu sesji", async () => {
    const result = await createDonationSession({
      environment: "sandbox",
      amountCents: 5000,
      recurring: true,
      donorEmail: "  DARCZYNCA@Example.com ",
      userId: "user-1",
      returnUrl: "https://nes.test/donate?status=thanks",
      rateKey: "ip:abc",
    });

    expect(result.ok).toBe(true);
    const created = donations.rows[0];
    expect(created).toMatchObject({
      recurring: true,
      status: "pending",
      user_id: "user-1",
      // E-mail normalizowany do lowercase - inaczej ten sam darczyńca ma dwa
      // wpisy w rejestrze i dwa różne potwierdzenia.
      donor_email: "darczynca@example.com",
      provider_session_id: "cs_new",
    });
  });

  it("kasuje osierocony wiersz, gdy operator nie utworzył sesji", async () => {
    sessionsCreate.mockRejectedValue(new Error("card_declined"));
    const result = await createDonationSession({
      environment: "sandbox",
      amountCents: 5000,
      recurring: false,
      returnUrl: "https://nes.test/donate",
      rateKey: "ip:abc",
    });
    expect(result).toEqual({ ok: false, error: "provider_error" });
    expect(donations.rows).toHaveLength(0);
  });

  it("odmawia, gdy podmiot przekroczył limit prób", async () => {
    allowAttempt.mockResolvedValue(false);
    const result = await createDonationSession({
      environment: "sandbox",
      amountCents: 5000,
      recurring: false,
      returnUrl: "https://nes.test/donate",
      rateKey: "ip:abc",
    });
    expect(result).toEqual({ ok: false, error: "rate_limited" });
    expect(donations.rows).toHaveLength(0);
  });
});

describe("księgowanie wpłaty jednorazowej", () => {
  it("ustawia status, kwotę i DATĘ ZAPŁATY", async () => {
    seed({ ...ANCHOR, recurring: false, provider_subscription_id: null });

    const settled = await settleDonation({
      donationId: "don-1",
      intentId: "pi_1",
      amountCents: 7500,
      currency: "pln",
      donorEmail: "Darczynca@Example.com",
      paidAt: "2026-02-01T12:00:00.000Z",
    });

    expect(settled).toBe(true);
    expect(row("don-1")).toMatchObject({
      status: "paid",
      amount_cents: 7500,
      currency: "PLN",
      provider_intent_id: "pi_1",
      donor_email: "darczynca@example.com",
      paid_at: "2026-02-01T12:00:00.000Z",
    });
  });

  it("ponowienie webhooka nie przesuwa daty zapłaty", async () => {
    seed({ ...ANCHOR, status: "paid", paid_at: "2026-02-01T12:00:00.000Z" });

    await settleDonation({
      donationId: "don-1",
      intentId: "pi_1",
      paidAt: "2026-02-03T18:00:00.000Z",
    });

    expect(row("don-1")).toMatchObject({
      status: "paid",
      paid_at: "2026-02-01T12:00:00.000Z",
      provider_intent_id: "pi_1",
    });
  });

  it("NIE wskrzesza darowizny zwróconej darczyńcy", async () => {
    seed({ ...ANCHOR, status: "refunded", paid_at: "2026-02-01T12:00:00.000Z" });

    const settled = await settleDonation({ donationId: "don-1", intentId: "pi_1" });

    expect(settled).toBe(false);
    expect(row("don-1")).toMatchObject({ status: "refunded" });
  });

  it("odnajduje wiersz po identyfikatorze sesji, gdy brakuje metadanych", async () => {
    seed({ ...ANCHOR, provider_session_id: "cs_abc" });
    const settled = await settleDonation({ sessionId: "cs_abc", amountCents: 1000 });
    expect(settled).toBe(true);
    expect(row("don-1")).toMatchObject({ status: "paid", amount_cents: 1000 });
  });

  it("bez identyfikatorów nie zgaduje, którą wpłatę zaksięgować", async () => {
    seed({ ...ANCHOR });
    await expect(settleDonation({ intentId: "pi_1" })).resolves.toBe(false);
    expect(row("don-1")).toMatchObject({ status: "pending" });
  });
});

describe("darowizna cykliczna", () => {
  it("pierwsza faktura domyka wiersz utworzony przy checkoucie", async () => {
    seed({ ...ANCHOR });

    const outcome = await recordRecurringDonationPayment({
      donationId: "don-1",
      subscriptionId: "sub_1",
      invoiceId: "in_1",
      intentId: "pi_1",
      amountCents: 5000,
      currency: "pln",
    });

    expect(outcome).toBe("settled");
    expect(donations.rows).toHaveLength(1);
    expect(row("don-1")).toMatchObject({
      status: "paid",
      recurring: true,
      provider_intent_id: "pi_1",
      provider_subscription_id: "sub_1",
    });
    expect(row("don-1")?.["paid_at"]).toBeTruthy();
  });

  it("każde kolejne odnowienie zakłada OSOBNY wiersz - z danymi kotwicy", async () => {
    seed({ ...ANCHOR, status: "paid", provider_intent_id: "pi_1", paid_at: "2026-01-01" });

    const outcome = await recordRecurringDonationPayment({
      donationId: "don-1",
      subscriptionId: "sub_1",
      invoiceId: "in_2",
      intentId: "pi_2",
      amountCents: 5000,
      currency: "PLN",
    });

    expect(outcome).toBe("renewed");
    expect(donations.rows).toHaveLength(2);
    const renewal = donations.rows[1];
    expect(renewal).toMatchObject({
      tenant_id: "tenant-1",
      user_id: "user-1",
      amount_cents: 5000,
      currency: "PLN",
      donor_email: "darczynca@example.com",
      message: "Trzymajcie tak dalej",
      provider_session_id: "renewal:in_2",
      provider_intent_id: "pi_2",
      provider_subscription_id: "sub_1",
      recurring: true,
      status: "paid",
    });
  });

  it("ponowione dostarczenie tej samej faktury nie dubluje wpłaty", async () => {
    seed({ ...ANCHOR, status: "paid", provider_intent_id: "pi_1", paid_at: "2026-01-01" });

    const first = await recordRecurringDonationPayment({
      subscriptionId: "sub_1",
      invoiceId: "in_2",
      intentId: "pi_2",
    });
    const retry = await recordRecurringDonationPayment({
      subscriptionId: "sub_1",
      invoiceId: "in_2",
      intentId: "pi_2",
    });

    expect(first).toBe("renewed");
    expect(retry).toBe("skipped");
    expect(donations.rows).toHaveLength(2);
  });

  it("odnajduje kotwicę po subskrypcji, gdy faktura nie niesie metadanych", async () => {
    seed(
      { ...ANCHOR, id: "don-1", status: "paid", created_at: "2026-01-01T10:00:00.000Z" },
      {
        ...ANCHOR,
        id: "don-2",
        status: "paid",
        provider_session_id: "renewal:in_2",
        provider_intent_id: "pi_2",
        created_at: "2026-02-01T10:00:00.000Z",
      },
    );

    const outcome = await recordRecurringDonationPayment({
      subscriptionId: "sub_1",
      invoiceId: "in_3",
      intentId: "pi_3",
    });

    expect(outcome).toBe("renewed");
    // Kwota i darczyńca pochodzą z PIERWSZEJ wpłaty subskrypcji.
    expect(donations.rows[2]).toMatchObject({
      amount_cents: 5000,
      donor_email: "darczynca@example.com",
      provider_session_id: "renewal:in_3",
    });
  });

  it("wpłata bez żadnej kotwicy jest pomijana, a nie zgadywana", async () => {
    const outcome = await recordRecurringDonationPayment({
      subscriptionId: "sub_nieznana",
      invoiceId: "in_9",
    });
    expect(outcome).toBe("skipped");
    expect(donations.rows).toHaveLength(0);
  });

  it("brak kwoty na fakturze schodzi do kwoty deklarowanej przy checkoucie", async () => {
    seed({ ...ANCHOR, status: "paid", provider_intent_id: "pi_1", paid_at: "2026-01-01" });

    await recordRecurringDonationPayment({
      subscriptionId: "sub_1",
      invoiceId: "in_2",
      amountCents: 0,
      currency: null,
    });

    expect(donations.rows[1]).toMatchObject({ amount_cents: 5000, currency: "PLN" });
  });

  it("gdy kotwica przestała być `pending` w trakcie zapisu, faktura ląduje jako odnowienie", async () => {
    // Wyścig dwóch równolegle dostarczonych webhooków: odczyt zobaczył
    // `pending`, ale zapis już nie trafił - wpłata NIE może zniknąć.
    seed({ ...ANCHOR });
    const anchorRow = row("don-1");
    const original = FakeQuery.prototype.update;
    let firstUpdate = true;
    FakeQuery.prototype.update = function patched(this: FakeQuery, patch: Row) {
      if (firstUpdate && patch["status"] === "paid") {
        firstUpdate = false;
        if (anchorRow) anchorRow["status"] = "paid";
      }
      return original.call(this, patch);
    };

    try {
      const outcome = await recordRecurringDonationPayment({
        donationId: "don-1",
        subscriptionId: "sub_1",
        invoiceId: "in_1",
        intentId: "pi_1",
      });
      expect(outcome).toBe("renewed");
      expect(donations.rows).toHaveLength(2);
      expect(donations.rows[1]).toMatchObject({ provider_session_id: "renewal:in_1" });
    } finally {
      FakeQuery.prototype.update = original;
    }
  });
});

describe("stan subskrypcji darowizny", () => {
  it("wiąże subskrypcję z wierszem oczekującym", async () => {
    seed({ ...ANCHOR, provider_subscription_id: null });

    await syncDonationSubscription({
      subscriptionId: "sub_1",
      donationId: "don-1",
      status: "active",
    });

    expect(row("don-1")).toMatchObject({
      provider_subscription_id: "sub_1",
      recurring: true,
      status: "pending",
    });
  });

  it("anulowanie zamyka wyłącznie wpłatę, która nigdy nie została opłacona", async () => {
    seed(
      { ...ANCHOR, id: "don-1", status: "pending" },
      { ...ANCHOR, id: "don-2", status: "paid", provider_session_id: "renewal:in_2" },
    );

    await syncDonationSubscription({ subscriptionId: "sub_1", status: "canceled" });

    expect(row("don-1")).toMatchObject({ status: "canceled" });
    expect(row("don-2")).toMatchObject({ status: "paid" });
  });
});
