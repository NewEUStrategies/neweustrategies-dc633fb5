// UZGODNIENIE DAWNYCH ANULOWAŃ ZA BRAK PŁATNOŚCI
// (`legacyNonPaymentReconcile.server.ts`, audyt SUB-03).
//
// JAKIE RYZYKA PRZYBIJA TEN PLIK:
//   * ROK NIEOPŁACONEGO DOSTĘPU. Plan roczny anulowany za brak płatności przed
//     regułą karencji ma uprawnienie do końca nowego, nieopłaconego roku.
//     Po uzgodnieniu: min(koniec okresu, kotwica + 14 dni), a gdy karencja
//     minęła - brak dostępu.
//   * ODEBRANIE DOSTĘPU KLIENTOWI, KTÓRY ZAPŁACIŁ. Rezygnacja klienta
//     (`cancellation_requested`) i anulowanie bez dowodu braku płatności
//     zostają nietknięte; zwrot (`refunded`) jest ostateczny. Zaległa faktura
//     zapłacona PO anulowaniu `payment_failed` (link z maila, zapłata poza
//     operatorem) to opłacony okres - bez kotwicy, przycięcia i zawieszenia.
//   * POZORNA SYMULACJA. `dry_run` ma nie wysłać ANI JEDNEGO zapisu.
//   * PODWÓJNY SKUTEK. Drugi przebieg `apply` nie zmienia niczego.
//   * PARTIE. Kursor po `subscriptions.id` przechodzi każdy wiersz raz.
//   * GRANICE. Uprawnienie i organizacja innego najemcy z tym samym
//     `external_ref` nie są ani podstawą decyzji, ani celem zapisu; partia
//     czyta tylko swoje środowisko.
//   * OPERATOR. `resource_missing` to pominięcie wiersza, nie awaria partii;
//     odczyty idą sekwencyjnie.
//
// Baza jest PAMIĘCIOWA (filtry `eq`/`is`/`gt`/`in`, `order`, `limit`, `update`
// na wierszach), bo idempotencji i kursora nie da się udowodnić na odpowiedzi
// stałej. Operator - atrapa `subscriptions.retrieve`. Zegar zamrożony.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/billing/fixtures";
import { DZIEN, GODZINA, FIXED_NOW, freezeClock, relativeIso } from "@/test/time";
import type {
  LegacyEntitlementRow,
  LegacySubscriptionRow,
} from "@/lib/billing/legacyNonPaymentReconcile.server";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  /** Subskrypcje u operatora po identyfikatorze; brak = `resource_missing`. */
  remote: new Map<string, Record<string, unknown>>(),
  /** Wymuszony błąd operatora dla identyfikatora. */
  remoteErrors: new Map<string, unknown>(),
  retrieveCalls: [] as Array<{ id: string; params: unknown }>,
  inFlight: 0,
  maxInFlight: 0,
}));

let db: SupabaseFromStub;
let tables: Record<string, Row[]>;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));

vi.mock("@/lib/stripe.server", () => ({
  getStripeClient: async () => ({
    subscriptions: {
      retrieve: async (id: string, params: unknown) => {
        h.retrieveCalls.push({ id, params });
        h.inFlight += 1;
        h.maxInFlight = Math.max(h.maxInFlight, h.inFlight);
        await Promise.resolve();
        h.inFlight -= 1;
        const forced = h.remoteErrors.get(id);
        if (forced) throw forced;
        const sub = h.remote.get(id);
        if (!sub) {
          throw Object.assign(new Error(`No such subscription: '${id}'`), {
            code: "resource_missing",
          });
        }
        return sub;
      },
    },
  }),
  getStripeErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Stripe request failed",
}));

const {
  decideLegacyNonPayment,
  readLegacyStripeFacts,
  reconcileLegacyNonPaymentCancellations,
  triageLegacyCandidate,
} = await import("@/lib/billing/legacyNonPaymentReconcile.server");
const { mergeLegacyReconcileReports } = await import("@/lib/billing/legacyNonPaymentReconcile");

freezeClock();

const TENANT = "tenant-alfa";
const FOREIGN = "tenant-beta";

// --- pamięciowa baza --------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}T/;

function compare(a: unknown, b: unknown): number {
  if (typeof a === "string" && typeof b === "string" && ISO.test(a) && ISO.test(b)) {
    return Date.parse(a) - Date.parse(b);
  }
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function execute(table: string, chain: RecordedChain): SupabaseResult {
  const rows = tables[table] ?? [];
  const matched = rows.filter((row) =>
    chain.calls.every(({ method, args }) => {
      const [column, value] = args as [string, unknown];
      switch (method) {
        case "eq":
          return row[column] === value;
        case "is":
          return (row[column] ?? null) === value;
        case "gt":
          return row[column] != null && compare(row[column], value) > 0;
        case "in":
          return (value as unknown[]).includes(row[column]);
        default:
          return true;
      }
    }),
  );
  const update = chain.argsOf("update")?.[0] as Row | undefined;
  if (update) {
    for (const row of matched) Object.assign(row, update);
    return ok(matched.map((row) => ({ id: row.id })));
  }
  const order = chain.argsOf("order")?.[0] as string | undefined;
  const sorted = order ? [...matched].sort((a, b) => compare(a[order], b[order])) : matched;
  const limit = chain.argsOf("limit")?.[0] as number | undefined;
  return ok((limit ? sorted.slice(0, limit) : sorted).map((row) => ({ ...row })));
}

function updates(table?: string): RecordedChain[] {
  return db.chains.filter((c) => c.has("update") && (!table || c.table === table));
}

// --- fixture'y --------------------------------------------------------------

const subId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const providerId = (n: number) => `sub_legacy_${n}`;
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** Wiersz `subscriptions`: anulowany plan roczny, okres zaczął się 5 dni temu. */
function subRow(n: number, overrides: Partial<Row> = {}): Row {
  return {
    id: subId(n),
    tenant_id: TENANT,
    environment: "live",
    status: "canceled",
    provider_subscription_id: providerId(n),
    price_id: "plus_annual",
    current_period_start: relativeIso(-5 * DZIEN),
    current_period_end: relativeIso(360 * DZIEN),
    first_payment_failed_at: null,
    // Ostatnia zapłata - za POPRZEDNI rok (odnowienie się nie udało).
    last_payment_at: relativeIso(-370 * DZIEN),
    ...overrides,
  };
}

/** Uprawnienie dawnego anulowania: aktywne do końca nieopłaconego roku. */
function entRow(n: number, overrides: Partial<Row> = {}): Row {
  return {
    id: `us-${n}`,
    tenant_id: TENANT,
    external_ref: providerId(n),
    status: "active",
    current_period_end: relativeIso(360 * DZIEN),
    canceled_at: relativeIso(-1 * DZIEN),
    ...overrides,
  };
}

interface RemoteInvoice {
  status: string;
  attempts: number;
  finalizedAt?: string | null;
  /** `status_transitions.paid_at`. */
  paidAt?: string | null;
  amountPaid?: number;
  amountDue?: number;
  outOfBand?: boolean;
  billingReason?: string;
}

interface RemoteOptions {
  reason?: string | null;
  status?: string;
  start?: string;
  end?: string;
  endedAt?: string;
  invoice?: RemoteInvoice | null;
}

/** Surowa subskrypcja operatora (API Basil+: okres na pozycji). */
function remoteSub(n: number, o: RemoteOptions = {}): Record<string, unknown> {
  const start = o.start ?? relativeIso(-5 * DZIEN);
  const end = o.end ?? relativeIso(360 * DZIEN);
  const ended = o.endedAt ?? relativeIso(-1 * DZIEN);
  const invoice =
    o.invoice === null
      ? null
      : (o.invoice ?? {
          status: "open",
          attempts: 4,
          finalizedAt: relativeIso(-5 * DZIEN + GODZINA),
        });
  return {
    id: providerId(n),
    object: "subscription",
    status: o.status ?? "canceled",
    customer: "cus_legacy",
    cancellation_details: { reason: o.reason === undefined ? "payment_failed" : o.reason },
    canceled_at: unix(ended),
    ended_at: unix(ended),
    items: {
      data: [
        {
          current_period_start: unix(start),
          current_period_end: unix(end),
          price: { id: "price_plus_annual", lookup_key: "plus_annual" },
        },
      ],
    },
    latest_invoice: invoice
      ? {
          id: `in_${n}`,
          object: "invoice",
          status: invoice.status,
          attempt_count: invoice.attempts,
          created: unix(start),
          amount_due: invoice.amountDue ?? 49900,
          amount_paid: invoice.amountPaid ?? 0,
          paid_out_of_band: invoice.outOfBand ?? false,
          billing_reason: invoice.billingReason ?? "subscription_cycle",
          status_transitions: {
            finalized_at: invoice.finalizedAt ? unix(invoice.finalizedAt) : null,
            paid_at: invoice.paidAt ? unix(invoice.paidAt) : null,
          },
        }
      : null,
  };
}

function seed(input: { subscriptions?: Row[]; entitlements?: Row[]; orgs?: Row[] }) {
  tables = {
    subscriptions: input.subscriptions ?? [],
    user_subscriptions: input.entitlements ?? [],
    member_organizations: input.orgs ?? [],
  };
}

function run(
  mode: "dry_run" | "apply",
  extra: { cursor?: string | null; batchSize?: number } = {},
) {
  return reconcileLegacyNonPaymentCancellations({ environment: "live", mode, ...extra });
}

let consoleInfo: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
  db = supabaseFromStub();
  seed({});
  for (const table of ["subscriptions", "user_subscriptions", "member_organizations"]) {
    db.setResponse(table, (chain) => execute(table, chain));
  }
  h.remote.clear();
  h.remoteErrors.clear();
  h.retrieveCalls.length = 0;
  h.inFlight = 0;
  h.maxInFlight = 0;
});

// --- decyzja (czysta funkcja) -----------------------------------------------

function decide(o: {
  sub?: Partial<Row>;
  ents?: Row[];
  remote?: RemoteOptions;
  teamActive?: boolean;
}) {
  return decideLegacyNonPayment({
    subscription: subRow(1, o.sub) as unknown as LegacySubscriptionRow,
    entitlements: (o.ents ?? [entRow(1)]) as unknown as LegacyEntitlementRow[],
    teamActive: o.teamActive ?? false,
    stripe: readLegacyStripeFacts(remoteSub(1, o.remote)),
    now: FIXED_NOW,
  });
}

describe("decyzja - anulowanie za brak płatności", () => {
  it("plan roczny: dostęp do kotwicy + 14 dni, a nie do końca nieopłaconego roku", () => {
    // Kotwica = pierwsza próba obciążenia nieopłaconej faktury (finalizacja),
    // nie koniec roku u operatora.
    const plan = decide({});

    expect(plan.decision).toBe("clamp");
    expect(plan.evidence).toBe("reason");
    expect(plan.anchor).toBe(relativeIso(-5 * DZIEN + GODZINA));
    expect(plan.accessUntil).toBe(relativeIso(9 * DZIEN + GODZINA));
    expect(plan.entitlementStatus).toBe("active");
    expect(plan.writeAnchor).toBe(true);
    expect(plan.clamp.map((r) => r.id)).toEqual(["us-1"]);
  });

  it("karencja już minęła: brak dostępu (`canceled`), ani dnia nieopłaconego okresu", () => {
    const start = relativeIso(-40 * DZIEN);
    const plan = decide({
      sub: { current_period_start: start },
      remote: {
        start,
        end: relativeIso(325 * DZIEN),
        invoice: { status: "uncollectible", attempts: 4, finalizedAt: start },
      },
      ents: [entRow(1, { current_period_end: relativeIso(325 * DZIEN) })],
    });

    expect(plan.decision).toBe("revoke");
    expect(plan.accessUntil).toBe(relativeIso(-26 * DZIEN));
    expect(plan.entitlementStatus).toBe("canceled");
    expect(plan.clamp).toHaveLength(1);
  });

  it("brak powodu u operatora: dowodem jest faktura nieopłacona po nieudanych próbach", () => {
    const plan = decide({
      remote: {
        reason: null,
        invoice: { status: "void", attempts: 3, finalizedAt: relativeIso(-5 * DZIEN) },
      },
    });

    expect(plan.decision).toBe("clamp");
    expect(plan.evidence).toBe("invoice");
    expect(plan.accessUntil).toBe(relativeIso(9 * DZIEN));
  });

  it("spór o płatność przy opłaconej fakturze: kotwicą jest początek okresu", () => {
    const plan = decide({
      remote: { reason: "payment_disputed", invoice: { status: "paid", attempts: 1 } },
    });

    expect(plan.evidence).toBe("reason");
    expect(plan.anchor).toBe(relativeIso(-5 * DZIEN));
    expect(plan.accessUntil).toBe(relativeIso(9 * DZIEN));
  });

  it("zapisana kotwica wygrywa z fakturą - kolejne przebiegi liczą z tej samej daty", () => {
    const stored = relativeIso(-12 * DZIEN);
    const plan = decide({ sub: { first_payment_failed_at: stored } });

    expect(plan.anchor).toBe(stored);
    expect(plan.writeAnchor).toBe(false);
    expect(plan.accessUntil).toBe(relativeIso(2 * DZIEN));
  });

  it("nowa kotwica nie jest późniejsza niż koniec subskrypcji", () => {
    const plan = decide({
      remote: {
        endedAt: relativeIso(-3 * DZIEN),
        invoice: { status: "open", attempts: 1, finalizedAt: relativeIso(-1 * DZIEN) },
      },
    });

    expect(plan.anchor).toBe(relativeIso(-3 * DZIEN));
  });

  it("uprawnienie już nie dalej niż koniec karencji: bez przycinania", () => {
    const plan = decide({ ents: [entRow(1, { current_period_end: relativeIso(3 * DZIEN) })] });

    expect(plan.decision).toBe("already_clamped");
    expect(plan.clamp).toEqual([]);
  });
});

describe("decyzja - bez zmian", () => {
  it("rezygnacja klienta zostaje z dostępem do końca okresu, nawet przy otwartej fakturze", () => {
    const plan = decide({ remote: { reason: "cancellation_requested" } });

    expect(plan.decision).toBe("voluntary");
    expect(plan.clamp).toEqual([]);
    expect(plan.writeAnchor).toBe(false);
    expect(plan.suspendTeam).toBe(false);
  });

  it("brak powodu i opłacona faktura: brak dowodu braku płatności", () => {
    const plan = decide({ remote: { reason: null, invoice: { status: "paid", attempts: 1 } } });

    expect(plan.decision).toBe("no_evidence");
    expect(plan.clamp).toEqual([]);
  });

  it("faktura bez próby obciążenia (szkic, 0 prób) nie jest dowodem", () => {
    const plan = decide({ remote: { reason: null, invoice: { status: "open", attempts: 0 } } });

    expect(plan.decision).toBe("no_evidence");
  });

  it("u operatora NIE anulowana: rozjazd stanu, nie przycinamy", () => {
    const plan = decide({ remote: { status: "active", reason: null } });

    expect(plan.decision).toBe("stripe_not_canceled");
  });

  it("zwrot jest ostateczny - wstępna selekcja nie pyta operatora", () => {
    expect(
      triageLegacyCandidate(
        [entRow(1, { status: "refunded" })] as unknown as LegacyEntitlementRow[],
        false,
        FIXED_NOW,
      ),
    ).toBe("refunded");
    expect(
      triageLegacyCandidate(
        [entRow(1, { status: "canceled" })] as unknown as LegacyEntitlementRow[],
        false,
        FIXED_NOW,
      ),
    ).toBe("skip");
  });
});

describe("decyzja - okres opłacony mimo anulowania za brak płatności", () => {
  /** Zaległa faktura odnowienia zapłacona 2 dni temu - już po anulowaniu. */
  const paidLate: RemoteInvoice = {
    status: "paid",
    attempts: 4,
    finalizedAt: relativeIso(-5 * DZIEN + GODZINA),
    paidAt: relativeIso(-2 * DZIEN),
    amountPaid: 49900,
  };

  it("`payment_failed`, a faktura opłacona po anulowaniu: bez kotwicy, przycięcia i zawieszenia", () => {
    // `invoice.paid` wyzerował kotwicę i zapisał zapłatę - baza też to wie.
    const plan = decide({
      sub: { price_id: "team_monthly_seat", last_payment_at: relativeIso(-2 * DZIEN) },
      remote: { invoice: paidLate },
      teamActive: true,
    });

    expect(plan).toMatchObject({
      decision: "paid",
      evidence: "reason",
      paymentProof: "invoice",
      anchor: null,
      writeAnchor: false,
      accessUntil: null,
      clamp: [],
      suspendTeam: false,
    });
  });

  it("zapłata oznaczona poza operatorem (kwota 0, `paid_out_of_band`) też jest zapłatą", () => {
    const plan = decide({
      remote: { invoice: { ...paidLate, amountPaid: 0, outOfBand: true } },
    });

    expect(plan.decision).toBe("paid");
    expect(plan.paymentProof).toBe("invoice");
  });

  it("zapłata zaksięgowana w bieżącym okresie wystarcza, gdy faktura u operatora jej nie pokazuje", () => {
    const plan = decide({ sub: { last_payment_at: relativeIso(-1 * DZIEN) } });

    expect(plan).toMatchObject({ decision: "paid", paymentProof: "ledger", clamp: [] });
  });

  it("brak powodu: faktura nieopłacona, ale zapłata zaksięgowana w okresie - bez zmian", () => {
    const plan = decide({
      sub: { last_payment_at: relativeIso(-1 * DZIEN) },
      remote: { reason: null, invoice: { status: "void", attempts: 3 } },
    });

    expect(plan).toMatchObject({ decision: "paid", evidence: "invoice", paymentProof: "ledger" });
  });

  it("to NIE są dowody zapłaty: dopłata za zmianę, `paid` bez znacznika ani kwoty, zapłata sprzed okresu", () => {
    for (const invoice of [
      { ...paidLate, billingReason: "subscription_update" },
      { ...paidLate, paidAt: null },
      { ...paidLate, amountPaid: 0 },
    ]) {
      expect(decide({ remote: { invoice } })).toMatchObject({
        decision: "clamp",
        paymentProof: null,
      });
    }
    // Zapłata sprzed początku okresu (za poprzedni) nie opłaca bieżącego.
    expect(decide({ sub: { last_payment_at: relativeIso(-6 * DZIEN) } })).toMatchObject({
      decision: "clamp",
      paymentProof: null,
    });
  });

  it("spór o płatność dotyczy faktury opłaconej - zapłata nie znosi przycięcia", () => {
    const plan = decide({
      sub: { last_payment_at: relativeIso(-4 * DZIEN) },
      remote: { reason: "payment_disputed", invoice: paidLate },
    });

    expect(plan).toMatchObject({ decision: "clamp", evidence: "reason", paymentProof: null });
  });
});

describe("decyzja - plan Zespół", () => {
  it("karencja minęła: aktywna organizacja zostaje zawieszona", () => {
    const start = relativeIso(-40 * DZIEN);
    const plan = decide({
      sub: { price_id: "team_monthly_seat", current_period_start: start },
      remote: {
        start,
        end: relativeIso(-10 * DZIEN),
        invoice: { status: "open", attempts: 4, finalizedAt: start },
      },
      ents: [],
      teamActive: true,
    });

    expect(plan.suspendTeam).toBe(true);
    expect(plan.decision).toBe("revoke");
  });

  it("karencja trwa: organizacja zostaje (domknie ją dobowy przebieg po kotwicy)", () => {
    const plan = decide({ sub: { price_id: "team_monthly_seat" }, ents: [], teamActive: true });

    expect(plan.suspendTeam).toBe(false);
    expect(plan.decision).toBe("already_clamped");
    expect(plan.writeAnchor).toBe(true);
  });
});

// --- przebieg (baza + operator) ---------------------------------------------

describe("symulacja", () => {
  it("raportuje decyzję i NIE wysyła żadnego zapisu", async () => {
    seed({ subscriptions: [subRow(1)], entitlements: [entRow(1)] });
    h.remote.set(providerId(1), remoteSub(1));
    const before = structuredClone(tables);

    const report = await run("dry_run");

    expect(report.mode).toBe("dry_run");
    expect(report.counts.clamp).toBe(1);
    expect(report.rows[0]).toMatchObject({
      subscriptionId: providerId(1),
      tenantId: TENANT,
      decision: "clamp",
      accessUntilBefore: relativeIso(360 * DZIEN),
      accessUntilAfter: relativeIso(9 * DZIEN + GODZINA),
      applied: false,
    });
    expect(report.writes).toEqual({ anchors: 0, entitlements: 0, teams: 0 });
    expect(updates()).toEqual([]);
    expect(tables).toEqual(before);
    expect(consoleInfo).not.toHaveBeenCalled();
  });
});

describe("zastosowanie", () => {
  it("przycina uprawnienie, dopisuje kotwicę, a drugi przebieg niczego nie zmienia", async () => {
    seed({ subscriptions: [subRow(1)], entitlements: [entRow(1)] });
    h.remote.set(providerId(1), remoteSub(1));

    const first = await run("apply");

    expect(first.writes).toEqual({ anchors: 1, entitlements: 1, teams: 0 });
    expect(first.rows[0]).toMatchObject({ decision: "clamp", applied: true });
    // Ślad partii w logu serwera - zastosowanie zmienia dostęp klientów.
    expect(consoleInfo).toHaveBeenCalledWith(
      "[billing] legacy non-payment reconcile batch",
      expect.objectContaining({ environment: "live", writes: first.writes }),
    );
    expect(tables.subscriptions?.[0]?.first_payment_failed_at).toBe(
      relativeIso(-5 * DZIEN + GODZINA),
    );
    expect(tables.user_subscriptions?.[0]).toMatchObject({
      status: "active",
      current_period_end: relativeIso(9 * DZIEN + GODZINA),
      // Zapisana data rezygnacji zostaje (semantyka `syncEntitlementState`).
      canceled_at: relativeIso(-1 * DZIEN),
    });

    db.chains.length = 0;
    const after = structuredClone(tables);
    const second = await run("apply");

    expect(second.rows[0]?.decision).toBe("already_clamped");
    expect(second.writes).toEqual({ anchors: 0, entitlements: 0, teams: 0 });
    expect(updates()).toEqual([]);
    expect(tables).toEqual(after);
  });

  it("po karencji: uprawnienie gaśnie, a kolejny przebieg nie widzi już kandydata", async () => {
    const start = relativeIso(-40 * DZIEN);
    seed({
      subscriptions: [subRow(1, { current_period_start: start })],
      entitlements: [entRow(1, { canceled_at: null })],
    });
    h.remote.set(
      providerId(1),
      remoteSub(1, { start, invoice: { status: "open", attempts: 4, finalizedAt: start } }),
    );

    const first = await run("apply");

    expect(first.rows[0]?.decision).toBe("revoke");
    expect(tables.user_subscriptions?.[0]).toMatchObject({
      status: "canceled",
      current_period_end: relativeIso(-26 * DZIEN),
      canceled_at: FIXED_NOW.toISOString(),
    });

    db.chains.length = 0;
    const second = await run("apply");

    expect(second).toMatchObject({ scanned: 1, candidates: 0, rows: [] });
    expect(updates()).toEqual([]);
  });

  it("rezygnacja klienta i zwrot zostają nietknięte także przy `apply`", async () => {
    seed({
      subscriptions: [subRow(1), subRow(2)],
      entitlements: [entRow(1), entRow(2, { status: "refunded" })],
    });
    h.remote.set(providerId(1), remoteSub(1, { reason: "cancellation_requested" }));
    h.remote.set(providerId(2), remoteSub(2));
    const before = structuredClone(tables);

    const report = await run("apply");

    expect(report.rows.map((r) => [r.subscriptionId, r.decision])).toEqual([
      [providerId(1), "voluntary"],
      [providerId(2), "refunded"],
    ]);
    // Zwrot rozstrzyga się bez operatora.
    expect(h.retrieveCalls.map((c) => c.id)).toEqual([providerId(1)]);
    expect(updates()).toEqual([]);
    expect(tables).toEqual(before);
  });

  it("subskrypcja nieznana operatorowi jest pomijana, a partia idzie dalej", async () => {
    seed({
      subscriptions: [subRow(1), subRow(2), subRow(3)],
      entitlements: [entRow(1), entRow(2), entRow(3)],
    });
    // 1 - brak u operatora, 2 - inna awaria operatora, 3 - do przycięcia.
    h.remoteErrors.set(providerId(2), new Error("Stripe is down"));
    h.remote.set(providerId(3), remoteSub(3));

    const report = await run("apply");

    expect(report.rows.map((r) => [r.subscriptionId, r.decision, r.error])).toEqual([
      [providerId(1), "stripe_missing", null],
      [providerId(2), "error", "Stripe is down"],
      [providerId(3), "clamp", null],
    ]);
    expect(report.counts).toMatchObject({ stripe_missing: 1, error: 1, clamp: 1 });
    expect(tables.user_subscriptions?.map((r) => r.current_period_end)).toEqual([
      relativeIso(360 * DZIEN),
      relativeIso(360 * DZIEN),
      relativeIso(9 * DZIEN + GODZINA),
    ]);
  });

  it("uprawnienie bez daty końca (dostęp bezterminowy) też zostaje przycięte", async () => {
    seed({ subscriptions: [subRow(1)], entitlements: [entRow(1, { current_period_end: null })] });
    h.remote.set(providerId(1), remoteSub(1));

    const report = await run("apply");

    expect(report.rows[0]?.accessUntilBefore).toBeNull();
    expect(tables.user_subscriptions?.[0]?.current_period_end).toBe(
      relativeIso(9 * DZIEN + GODZINA),
    );
  });

  it("plan Zespół po karencji: organizacja tego najemcy zawieszona, cudza nietknięta", async () => {
    const start = relativeIso(-40 * DZIEN);
    seed({
      subscriptions: [subRow(1, { price_id: "team_monthly_seat", current_period_start: start })],
      orgs: [
        {
          id: "org-1",
          tenant_id: TENANT,
          provider_subscription_id: providerId(1),
          status: "active",
        },
        {
          id: "org-x",
          tenant_id: FOREIGN,
          provider_subscription_id: providerId(1),
          status: "active",
        },
      ],
    });
    h.remote.set(
      providerId(1),
      remoteSub(1, {
        start,
        end: relativeIso(-10 * DZIEN),
        invoice: { status: "open", attempts: 4, finalizedAt: start },
      }),
    );

    const report = await run("apply");

    expect(report.rows[0]).toMatchObject({ decision: "revoke", suspendTeam: true, applied: true });
    expect(report.writes.teams).toBe(1);
    expect(tables.member_organizations?.map((o) => [o.id, o.status])).toEqual([
      ["org-1", "suspended"],
      ["org-x", "active"],
    ]);
  });
});

describe("okres opłacony po anulowaniu - przebieg", () => {
  it("symulacja i zastosowanie: dostęp, zespół i kotwica nietknięte, raport mówi dlaczego", async () => {
    const paidAt = relativeIso(-2 * DZIEN);
    seed({
      subscriptions: [subRow(1, { price_id: "team_monthly_seat", last_payment_at: paidAt })],
      entitlements: [entRow(1)],
      orgs: [
        {
          id: "org-1",
          tenant_id: TENANT,
          provider_subscription_id: providerId(1),
          status: "active",
        },
      ],
    });
    h.remote.set(
      providerId(1),
      remoteSub(1, {
        invoice: { status: "paid", attempts: 4, paidAt, amountPaid: 49900 },
      }),
    );
    const before = structuredClone(tables);

    for (const mode of ["dry_run", "apply"] as const) {
      const report = await run(mode);

      expect(report.counts).toMatchObject({ paid: 1, clamp: 0, revoke: 0 });
      expect(report.rows[0]).toMatchObject({
        decision: "paid",
        paymentProof: "invoice",
        cancellationReason: "payment_failed",
        invoiceStatus: "paid",
        anchor: null,
        accessUntilBefore: relativeIso(360 * DZIEN),
        accessUntilAfter: null,
        suspendTeam: false,
        applied: false,
      });
      expect(report.writes).toEqual({ anchors: 0, entitlements: 0, teams: 0 });
    }
    expect(updates()).toEqual([]);
    expect(tables).toEqual(before);
  });
});

describe("granice najemcy i środowiska", () => {
  it("uprawnienie innego najemcy z tym samym `external_ref` nie jest ani podstawą, ani celem", async () => {
    seed({
      subscriptions: [subRow(1), subRow(2)],
      entitlements: [
        entRow(1, { id: "us-foreign", tenant_id: FOREIGN }),
        entRow(2),
        entRow(2, { id: "us-foreign-2", tenant_id: FOREIGN }),
      ],
    });
    h.remote.set(providerId(1), remoteSub(1));
    h.remote.set(providerId(2), remoteSub(2));

    const report = await run("apply");

    // Subskrypcja 1 nie ma uprawnienia W SWOIM najemcy - nie ma czego uzgadniać.
    expect(report.rows.map((r) => r.subscriptionId)).toEqual([providerId(2)]);
    expect(h.retrieveCalls.map((c) => c.id)).toEqual([providerId(2)]);
    const byId = new Map(tables.user_subscriptions?.map((r) => [r.id, r.current_period_end]));
    expect(byId.get("us-foreign")).toBe(relativeIso(360 * DZIEN));
    expect(byId.get("us-foreign-2")).toBe(relativeIso(360 * DZIEN));
    expect(byId.get("us-2")).toBe(relativeIso(9 * DZIEN + GODZINA));
    for (const chain of updates("user_subscriptions")) {
      expect(chain.calls).toContainEqual({ method: "eq", args: ["tenant_id", TENANT] });
    }
  });

  it("partia czyta tylko anulowane subskrypcje swojego środowiska", async () => {
    seed({
      subscriptions: [subRow(1, { environment: "sandbox" }), subRow(2, { status: "past_due" })],
      entitlements: [entRow(1), entRow(2)],
    });

    const report = await run("apply");

    expect(report.scanned).toBe(0);
    const read = db.chainsFor("subscriptions")[0];
    expect(read?.calls).toContainEqual({ method: "eq", args: ["environment", "live"] });
    expect(read?.calls).toContainEqual({ method: "eq", args: ["status", "canceled"] });
    expect(h.retrieveCalls).toEqual([]);
  });
});

describe("operator i partie", () => {
  it("kursor po `subscriptions.id` przechodzi każdy wiersz dokładnie raz", async () => {
    seed({
      subscriptions: [subRow(3), subRow(1), subRow(2)],
      entitlements: [entRow(1), entRow(2), entRow(3)],
    });
    for (const n of [1, 2, 3]) h.remote.set(providerId(n), remoteSub(n));

    const first = await run("dry_run", { batchSize: 2 });

    expect(first).toMatchObject({ scanned: 2, nextCursor: subId(2), done: false });
    expect(first.rows.map((r) => r.subscriptionId)).toEqual([providerId(1), providerId(2)]);

    const second = await run("dry_run", { batchSize: 2, cursor: first.nextCursor });

    expect(second).toMatchObject({ scanned: 1, nextCursor: null, done: true });
    expect(second.rows.map((r) => r.subscriptionId)).toEqual([providerId(3)]);
    const secondRead = db.chainsFor("subscriptions").at(-1);
    expect(secondRead?.calls).toContainEqual({ method: "gt", args: ["id", subId(2)] });
    expect(secondRead?.calls).toContainEqual({
      method: "order",
      args: ["id", { ascending: true }],
    });
    expect(h.retrieveCalls.map((c) => c.id)).toEqual([1, 2, 3].map(providerId));

    const merged = mergeLegacyReconcileReports(first, second);
    expect(merged).toMatchObject({ scanned: 3, candidates: 3, done: true, nextCursor: null });
    expect(merged.counts.clamp).toBe(3);
  });

  it("pełna partia bez kandydatów i tak oddaje kursor, a pusta kończy zadanie", async () => {
    seed({ subscriptions: [subRow(1), subRow(2)] });

    const full = await run("dry_run", { batchSize: 2 });
    expect(full).toMatchObject({ scanned: 2, candidates: 0, nextCursor: subId(2), done: false });

    const empty = await run("dry_run", { batchSize: 2, cursor: subId(2) });
    expect(empty).toMatchObject({ scanned: 0, nextCursor: null, done: true });
  });

  it("odczyty operatora idą po kolei, z rozwiniętą ostatnią fakturą", async () => {
    seed({
      subscriptions: [subRow(1), subRow(2), subRow(3)],
      entitlements: [entRow(1), entRow(2), entRow(3)],
    });
    for (const n of [1, 2, 3]) h.remote.set(providerId(n), remoteSub(n));

    await run("dry_run");

    expect(h.maxInFlight).toBe(1);
    expect(h.retrieveCalls[0]?.params).toEqual({ expand: ["latest_invoice"] });
  });
});
