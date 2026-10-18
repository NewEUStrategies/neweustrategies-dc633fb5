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
//     operatorem) to opłacony okres - bez kotwicy, przycięcia i zawieszenia -
//     także gdy ostatnią fakturą jest inna, a `last_payment_at` jest stary.
//   * DOPŁATA ZAMIAST ODNOWIENIA. Opłacona dopłata za zmianę w trakcie okresu
//     (`subscription_update`, także znacznik `last_payment_at` z niej) nie
//     jest zapłatą za okres - dowodem jest wyłącznie opłacona faktura OKRESU
//     w historii operatora (także dopłata za zmianę interwału, która ten
//     okres otworzyła); błąd historii to `error` bez zapisów. Znacznik
//     obalony historią zostaje wyczyszczony (zapis warunkowy), żeby webhook
//     nie cofnął przycięcia przy kolejnym `deleted` bez powodu.
//   * POZORNA SYMULACJA. `dry_run` ma nie wysłać ANI JEDNEGO zapisu.
//   * PODWÓJNY SKUTEK. Drugi przebieg `apply` nie zmienia niczego.
//   * ZAPIS CZĘŚCIOWY. Błąd późniejszego kroku zapisu nie ukrywa wcześniejszych:
//     liczniki partii, ślad w logu i `applied` mówią, co już jest w bazie.
//   * PARTIE. Kursor po `subscriptions.id` przechodzi każdy wiersz raz.
//   * GRANICE. Uprawnienie i organizacja innego najemcy z tym samym
//     `external_ref` nie są ani podstawą decyzji, ani celem zapisu; partia
//     czyta tylko swoje środowisko.
//   * OPERATOR. `resource_missing` to pominięcie wiersza, nie awaria partii;
//     odczyty idą sekwencyjnie, a historię faktur czytamy tylko wtedy, gdy
//     decyzja zależy od dowodu zapłaty.
//
// Baza jest PAMIĘCIOWA (filtry `eq`/`is`/`gt`/`in`, `order`, `limit`, `update`
// na wierszach), bo idempotencji i kursora nie da się udowodnić na odpowiedzi
// stałej. Operator - atrapa `subscriptions.retrieve` i `invoices.list`
// (filtry `subscription`/`status`/`created.gte` jak u operatora, wynik jako
// iterator stron). Zegar zamrożony.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fail,
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
  /** Historia faktur u operatora po identyfikatorze subskrypcji (surowe faktury). */
  invoiceHistory: new Map<string, Array<Record<string, unknown>>>(),
  /** Wymuszony błąd listy faktur dla subskrypcji. */
  listErrors: new Map<string, unknown>(),
  retrieveCalls: [] as Array<{ id: string; params: unknown }>,
  listCalls: [] as Array<Record<string, unknown>>,
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
    invoices: {
      // Jak `ApiListPromise` operatora: iterator, który sam doczytuje strony.
      list: (params: Record<string, unknown>) => {
        h.listCalls.push(params);
        const subscription = params.subscription as string;
        const gte = (params.created as { gte: number }).gte;
        return {
          async *[Symbol.asyncIterator]() {
            h.inFlight += 1;
            h.maxInFlight = Math.max(h.maxInFlight, h.inFlight);
            await Promise.resolve();
            h.inFlight -= 1;
            const forced = h.listErrors.get(subscription);
            if (forced) throw forced;
            for (const invoice of h.invoiceHistory.get(subscription) ?? []) {
              if (invoice.status !== params.status) continue;
              if ((invoice.created as number) < gte) continue;
              yield invoice;
            }
          },
        };
      },
    },
  }),
  getStripeErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Stripe request failed",
}));

const {
  PERIOD_INVOICE_SCAN_LIMIT,
  decideLegacyNonPayment,
  needsPeriodInvoiceCheck,
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
  /** `amount_paid_off_stripe` (API dahlia) - kwota oznaczona jako zapłacona poza operatorem. */
  amountPaidOffStripe?: number;
  billingReason?: string;
  /** Chwila wystawienia (domyślnie początek okresu). */
  created?: string;
  /** Pozycje faktury (API Basil+: `parent.subscription_item_details`). */
  lines?: Array<{ proration: boolean; start: string; end?: string }>;
}

/**
 * Surowa faktura operatora - ostatnia albo z historii - w kształcie przypiętej
 * wersji API (dahlia): bez `paid_out_of_band`, zapłata poza operatorem w
 * `amount_paid` i `amount_paid_off_stripe`.
 */
function rawInvoice(id: string, invoice: RemoteInvoice, defaultCreated: string) {
  return {
    id,
    object: "invoice",
    status: invoice.status,
    attempt_count: invoice.attempts,
    created: unix(invoice.created ?? defaultCreated),
    amount_due: invoice.amountDue ?? 49900,
    amount_paid: invoice.amountPaid ?? 0,
    ...(invoice.amountPaidOffStripe !== undefined
      ? { amount_paid_off_stripe: invoice.amountPaidOffStripe }
      : {}),
    billing_reason: invoice.billingReason ?? "subscription_cycle",
    status_transitions: {
      finalized_at: invoice.finalizedAt ? unix(invoice.finalizedAt) : null,
      paid_at: invoice.paidAt ? unix(invoice.paidAt) : null,
    },
    lines: {
      object: "list",
      data: (invoice.lines ?? []).map((line, i) => ({
        id: `il_${id}_${i}`,
        object: "line_item",
        period: { start: unix(line.start), end: unix(line.end ?? relativeIso(360 * DZIEN)) },
        parent: {
          type: "subscription_item_details",
          invoice_item_details: null,
          subscription_item_details: {
            invoice_item: line.proration ? `ii_${id}_${i}` : null,
            proration: line.proration,
            proration_details: null,
            subscription: "sub_legacy",
            subscription_item: "si_legacy",
          },
        },
      })),
    },
  };
}

/** Historia faktur subskrypcji `n` u operatora (to, co zwraca `invoices.list`). */
function history(n: number, invoices: RemoteInvoice[]) {
  h.invoiceHistory.set(
    providerId(n),
    invoices.map((invoice, i) => rawInvoice(`in_${n}_h${i}`, invoice, relativeIso(-5 * DZIEN))),
  );
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
    latest_invoice: invoice ? rawInvoice(`in_${n}`, invoice, start) : null,
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
  h.invoiceHistory.clear();
  h.listErrors.clear();
  h.retrieveCalls.length = 0;
  h.listCalls.length = 0;
  h.inFlight = 0;
  h.maxInFlight = 0;
});

// --- decyzja (czysta funkcja) -----------------------------------------------

function decide(o: {
  sub?: Partial<Row>;
  ents?: Row[];
  remote?: RemoteOptions;
  teamActive?: boolean;
  /** Wynik historii faktur okresu (domyślnie: nie sprawdzano). */
  periodInvoicePaid?: boolean | null;
}) {
  return decideLegacyNonPayment({
    subscription: subRow(1, o.sub) as unknown as LegacySubscriptionRow,
    entitlements: (o.ents ?? [entRow(1)]) as unknown as LegacyEntitlementRow[],
    teamActive: o.teamActive ?? false,
    stripe: {
      ...readLegacyStripeFacts(remoteSub(1, o.remote)),
      periodInvoicePaid: o.periodInvoicePaid ?? null,
    },
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

  // ZMIANA FIXTURE'A: było `amount_paid: 0` z `paid_out_of_band: true` -
  // kształtu, którego przypięta wersja API (dahlia) nie zwraca (Basil usunął
  // `paid_out_of_band` z faktury, a zapłatę poza operatorem liczy w
  // `amount_paid`; dahlia dokłada `amount_paid_off_stripe`).
  it("zapłata oznaczona poza operatorem (`amount_paid` i `amount_paid_off_stripe`) też jest zapłatą", () => {
    const plan = decide({
      remote: { invoice: { ...paidLate, amountPaid: 49900, amountPaidOffStripe: 49900 } },
    });

    expect(plan.decision).toBe("paid");
    expect(plan.paymentProof).toBe("invoice");
  });

  it("fakty faktury: kwota poza operatorem i początek pozycji za cały okres", () => {
    const facts = readLegacyStripeFacts(
      remoteSub(1, {
        invoice: {
          ...paidLate,
          amountPaidOffStripe: 49900,
          billingReason: "subscription_update",
          lines: [
            { proration: true, start: relativeIso(-5 * DZIEN), end: relativeIso(25 * DZIEN) },
            { proration: false, start: relativeIso(-5 * DZIEN) },
          ],
        },
      }),
    ).invoice;

    expect(facts).toMatchObject({
      amountPaidOffStripe: 49900,
      paidOutOfBand: false,
      fullPeriodStart: relativeIso(-5 * DZIEN),
    });
    // Same proraty (zwykła dopłata) - pozycji za cały okres nie ma.
    expect(
      readLegacyStripeFacts(
        remoteSub(1, {
          invoice: { ...paidLate, lines: [{ proration: true, start: relativeIso(-3 * DZIEN) }] },
        }),
      ).invoice?.fullPeriodStart,
    ).toBeNull();
  });

  // ZMIANA ASERCJI (Codex P1, PR #502): było „zapłata zaksięgowana w okresie
  // wystarcza" - `last_payment_at` nie wcześniejszy niż początek okresu dawał
  // dowód `ledger`. Dawne wiersze niosą tam chwilę opłaconej DOPŁATY za zmianę
  // (windykacja przesuwała znacznik przy każdej zapłacie), więc sam znacznik
  // zostawiał rok nieopłaconego dostępu. Dowodem jest opłacona faktura okresu
  // w historii operatora (`periodInvoicePaid`).
  it("sam `last_payment_at` w bieżącym okresie NIE jest dowodem zapłaty", () => {
    const plan = decide({ sub: { last_payment_at: relativeIso(-1 * DZIEN) } });

    expect(plan).toMatchObject({ decision: "clamp", paymentProof: null, writeAnchor: true });
  });

  it("opłacona faktura okresu w historii operatora wystarcza, gdy ostatnia faktura jej nie pokazuje", () => {
    const plan = decide({ periodInvoicePaid: true });

    expect(plan).toMatchObject({ decision: "paid", paymentProof: "ledger", clamp: [] });
  });

  it("brak powodu: faktura nieopłacona, ale historia ma opłaconą fakturę okresu - bez zmian", () => {
    const plan = decide({
      remote: { reason: null, invoice: { status: "void", attempts: 3 } },
      periodInvoicePaid: true,
    });

    expect(plan).toMatchObject({ decision: "paid", evidence: "invoice", paymentProof: "ledger" });
  });

  it("to NIE są dowody zapłaty: dopłata za zmianę, `paid` bez znacznika ani kwoty, historia bez faktury okresu", () => {
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
    // Historia sprawdzona i bez opłaconej faktury okresu - zapłata sprzed
    // początku okresu (za poprzedni) nie opłaca bieżącego.
    expect(
      decide({ sub: { last_payment_at: relativeIso(-6 * DZIEN) }, periodInvoicePaid: false }),
    ).toMatchObject({ decision: "clamp", paymentProof: null });
  });

  it("znacznik zapłaty z okresu obalony historią operatora idzie do wyczyszczenia - i tylko on", () => {
    // Dopłata zapisana przez dawną windykację: webhook uznałby z nią okres za
    // opłacony i przy `deleted` bez powodu cofnął przycięcie.
    const proration = relativeIso(-3 * DZIEN);
    const clamped = decide({ sub: { last_payment_at: proration }, periodInvoicePaid: false });
    expect(clamped).toMatchObject({ decision: "clamp", staleLastPaymentAt: proration });
    expect(
      decide({
        sub: { last_payment_at: proration },
        remote: { reason: null },
        periodInvoicePaid: false,
      }),
    ).toMatchObject({ decision: "clamp", evidence: "invoice", staleLastPaymentAt: proration });
    // Zapłata za poprzedni okres, historia niesprawdzona albo okres opłacony -
    // znacznik zostaje.
    expect(decide({ periodInvoicePaid: false }).staleLastPaymentAt).toBeNull();
    expect(decide({ sub: { last_payment_at: proration } }).staleLastPaymentAt).toBeNull();
    expect(
      decide({ sub: { last_payment_at: proration }, periodInvoicePaid: true }).staleLastPaymentAt,
    ).toBeNull();
  });

  it("spór o płatność dotyczy faktury opłaconej - zapłata nie znosi przycięcia", () => {
    const plan = decide({
      sub: { last_payment_at: relativeIso(-4 * DZIEN) },
      remote: { reason: "payment_disputed", invoice: paidLate },
      periodInvoicePaid: true,
    });

    expect(plan).toMatchObject({ decision: "clamp", evidence: "reason", paymentProof: null });
  });
});

describe("historia faktur okresu - kiedy pytać operatora (`needsPeriodInvoiceCheck`)", () => {
  function needs(o: { sub?: Partial<Row>; remote?: RemoteOptions }) {
    return needsPeriodInvoiceCheck(
      subRow(1, o.sub) as unknown as LegacySubscriptionRow,
      readLegacyStripeFacts(remoteSub(1, o.remote)),
    );
  }

  it("anulowanie za brak płatności bez opłaconej ostatniej faktury - tak", () => {
    expect(needs({})).toBe(true);
    expect(needs({ remote: { reason: null, invoice: { status: "void", attempts: 2 } } })).toBe(
      true,
    );
    // Opłacona dopłata za zmianę jako ostatnia faktura nie zwalnia z pytania.
    expect(
      needs({
        remote: {
          invoice: {
            status: "paid",
            attempts: 1,
            paidAt: relativeIso(-2 * DZIEN),
            amountPaid: 2500,
            billingReason: "subscription_update",
          },
        },
      }),
    ).toBe(true);
  });

  it("ostatnia faktura dowodzi zapłaty, spór, rezygnacja, brak dowodu albo nieznany okres - nie", () => {
    const paid: RemoteInvoice = {
      status: "paid",
      attempts: 1,
      paidAt: relativeIso(-2 * DZIEN),
      amountPaid: 49900,
    };
    expect(needs({ remote: { invoice: paid } })).toBe(false);
    expect(needs({ remote: { reason: "payment_disputed" } })).toBe(false);
    expect(needs({ remote: { reason: "cancellation_requested" } })).toBe(false);
    expect(needs({ remote: { reason: null, invoice: paid } })).toBe(false);
    expect(needs({ remote: { status: "active" } })).toBe(false);
    // Bez początku okresu (ani od operatora, ani w bazie) nie ma od kiedy pytać.
    const facts = { ...readLegacyStripeFacts(remoteSub(1)), periodStart: null };
    expect(
      needsPeriodInvoiceCheck(
        subRow(1, { current_period_start: null }) as unknown as LegacySubscriptionRow,
        facts,
      ),
    ).toBe(false);
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
    expect(report.writes).toEqual({ anchors: 0, paymentMarkers: 0, entitlements: 0, teams: 0 });
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

    expect(first.writes).toEqual({ anchors: 1, paymentMarkers: 0, entitlements: 1, teams: 0 });
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
    expect(second.writes).toEqual({ anchors: 0, paymentMarkers: 0, entitlements: 0, teams: 0 });
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

describe("zapis przerwany w połowie - raport nie ukrywa tego, co już zapisano", () => {
  // Kroki zapisu idą po kolei (znacznik, kotwica, uprawnienia, zespół), więc
  // błąd późniejszego kroku zostawia w bazie skutki wcześniejszych. Wiersz to
  // `error`, ale liczniki partii, ślad w logu i `applied` muszą mówić prawdę -
  // inaczej operator czyta „nic się nie zmieniło", a dostęp klienta już
  // przycięto.
  const start = relativeIso(-40 * DZIEN);

  it("odmowa zawieszenia zespołu po kotwicy i przycięciu: zapisane kroki są policzone", async () => {
    seed({
      subscriptions: [subRow(1, { price_id: "team_monthly_seat", current_period_start: start })],
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
      remoteSub(1, { start, invoice: { status: "open", attempts: 4, finalizedAt: start } }),
    );
    db.setResponse("member_organizations", (chain) =>
      chain.has("update")
        ? fail("trigger rejected the update")
        : execute("member_organizations", chain),
    );

    const report = await run("apply");

    expect(report.rows[0]).toMatchObject({
      decision: "error",
      error: "team suspend failed: trigger rejected the update",
      suspendTeam: true,
      applied: true,
    });
    expect(report.writes).toEqual({ anchors: 1, paymentMarkers: 0, entitlements: 1, teams: 0 });
    expect(consoleInfo).toHaveBeenCalledWith(
      "[billing] legacy non-payment reconcile batch",
      expect.objectContaining({
        writes: { anchors: 1, paymentMarkers: 0, entitlements: 1, teams: 0 },
      }),
    );
    // To, co raport liczy, naprawdę jest w bazie.
    expect(tables.subscriptions?.[0]?.first_payment_failed_at).toBe(start);
    expect(tables.user_subscriptions?.[0]).toMatchObject({
      status: "canceled",
      current_period_end: relativeIso(-26 * DZIEN),
    });
    expect(tables.member_organizations?.[0]?.status).toBe("active");
  });

  it("wyczyszczony znacznik zapłaty, a potem błąd kotwicy: znacznik jest w licznikach", async () => {
    const prorationPaidAt = relativeIso(-3 * DZIEN);
    seed({
      subscriptions: [subRow(1, { last_payment_at: prorationPaidAt })],
      entitlements: [entRow(1)],
    });
    h.remote.set(providerId(1), remoteSub(1));
    db.setResponse("subscriptions", (chain) => {
      const update = chain.argsOf("update")?.[0] as Row | undefined;
      return update && "first_payment_failed_at" in update
        ? fail("statement timeout")
        : execute("subscriptions", chain);
    });

    const report = await run("apply");

    expect(report.rows[0]).toMatchObject({
      decision: "error",
      error: "anchor write failed: statement timeout",
      applied: true,
    });
    expect(report.writes).toEqual({ anchors: 0, paymentMarkers: 1, entitlements: 0, teams: 0 });
    expect(tables.subscriptions?.[0]).toMatchObject({
      last_payment_at: null,
      first_payment_failed_at: null,
    });
    // Uprawnienie nietknięte - przycięcie czeka na kotwicę (kolejny przebieg).
    expect(tables.user_subscriptions?.[0]?.current_period_end).toBe(relativeIso(360 * DZIEN));
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
      expect(report.writes).toEqual({ anchors: 0, paymentMarkers: 0, entitlements: 0, teams: 0 });
    }
    expect(updates()).toEqual([]);
    expect(tables).toEqual(before);
    // Ostatnia faktura już dowodzi zapłaty - historii nie trzeba.
    expect(h.listCalls).toEqual([]);
  });
});

describe("historia faktur okresu u operatora - przebieg (Codex P1, PR #502)", () => {
  const start = relativeIso(-5 * DZIEN);
  /** Zapytanie o historię: opłacone faktury tej subskrypcji od początku okresu (- 1 h). */
  const listQuery = (n: number) => ({
    subscription: providerId(n),
    status: "paid",
    created: { gte: unix(start) - 60 * 60 },
    limit: 100,
  });
  /** Nieudane odnowienie: otwarte po 4 próbach, wystawione na początku okresu. */
  const openRenewal: RemoteInvoice = {
    status: "open",
    attempts: 4,
    finalizedAt: relativeIso(-5 * DZIEN + GODZINA),
  };
  /** Opłacona dopłata za upgrade w trakcie okresu (3 dni temu) - same proraty. */
  const proration: RemoteInvoice = {
    status: "paid",
    attempts: 1,
    created: relativeIso(-3 * DZIEN),
    paidAt: relativeIso(-3 * DZIEN),
    amountPaid: 2500,
    amountDue: 2500,
    billingReason: "subscription_update",
    lines: [
      { proration: true, start: relativeIso(-3 * DZIEN) },
      { proration: true, start: relativeIso(-3 * DZIEN) },
    ],
  };
  /** Odnowienie zapłacone już PO anulowaniu (sprzed doby), wystawione 30 min przed okresem. */
  const renewalPaidLate: RemoteInvoice = {
    status: "paid",
    attempts: 4,
    created: relativeIso(-5 * DZIEN - 30 * 60 * 1000),
    finalizedAt: relativeIso(-5 * DZIEN + GODZINA),
    paidAt: relativeIso(-12 * GODZINA),
    amountPaid: 49900,
  };

  it("dopłata za zmianę w okresie (i `last_payment_at` z niej) NIE opłaca odnowienia: przycięcie", async () => {
    // Porażka odnowienia nie dotarła (brak licznika), więc dawna windykacja
    // zapisała `last_payment_at` z opłaconej dopłaty - w bieżącym okresie.
    // 1: bez powodu, dowodem otwarte odnowienie; 2: `payment_failed`,
    // a ostatnią fakturą jest opłacona dopłata.
    seed({
      subscriptions: [
        subRow(1, { last_payment_at: proration.paidAt }),
        subRow(2, { last_payment_at: proration.paidAt }),
      ],
      entitlements: [entRow(1), entRow(2)],
    });
    h.remote.set(providerId(1), remoteSub(1, { reason: null, invoice: openRenewal }));
    h.remote.set(providerId(2), remoteSub(2, { invoice: proration }));
    // Historia ma tylko dopłatę (odnowienie jest otwarte - nie `paid`).
    history(1, [openRenewal, proration]);
    history(2, [openRenewal, proration]);

    const report = await run("apply");

    expect(
      report.rows.map((r) => [r.subscriptionId, r.decision, r.evidence, r.paymentProof]),
    ).toEqual([
      [providerId(1), "clamp", "invoice", null],
      [providerId(2), "clamp", "reason", null],
    ]);
    expect(h.listCalls).toEqual([listQuery(1), listQuery(2)]);
    expect(report.writes).toEqual({ anchors: 2, paymentMarkers: 2, entitlements: 2, teams: 0 });
    expect(tables.user_subscriptions?.map((r) => r.current_period_end)).toEqual([
      // 1: kotwica = pierwsza próba odnowienia; 2: ostatnia faktura opłacona,
      // więc kotwicą jest początek okresu.
      relativeIso(9 * DZIEN + GODZINA),
      relativeIso(9 * DZIEN),
    ]);
    // Znacznik z dopłaty obalony historią - wyczyszczony, żeby webhook nie
    // uznał okresu za opłacony. Zapis warunkowy na zaobserwowanej wartości.
    expect(tables.subscriptions?.map((r) => r.last_payment_at)).toEqual([null, null]);
    const markerClear = updates("subscriptions").find(
      (c) => (c.argsOf("update")?.[0] as Row).last_payment_at === null,
    );
    expect(markerClear?.calls).toContainEqual({
      method: "eq",
      args: ["last_payment_at", proration.paidAt],
    });
    expect(markerClear?.calls).toContainEqual({ method: "eq", args: ["status", "canceled"] });

    // Drugi przebieg: znacznik pusty, kotwica i przycięcie zapisane - zero zapisów.
    db.chains.length = 0;
    const second = await run("apply");
    expect(second.rows.map((r) => r.decision)).toEqual(["already_clamped", "already_clamped"]);
    expect(second.writes).toEqual({ anchors: 0, paymentMarkers: 0, entitlements: 0, teams: 0 });
    expect(updates()).toEqual([]);
  });

  it("zapłata zaksięgowana w trakcie przebiegu (znacznik się zmienił): `error` bez zapisów", async () => {
    seed({
      subscriptions: [subRow(1, { last_payment_at: proration.paidAt })],
      entitlements: [entRow(1)],
    });
    h.remote.set(providerId(1), remoteSub(1, { reason: null, invoice: openRenewal }));
    history(1, [proration]);
    // `invoice.paid` odnowienia dociera między odczytem partii a zapisem.
    const paidNow = relativeIso(-1 * GODZINA);
    db.setResponse("subscriptions", (chain) => {
      if (chain.has("update")) {
        const row = tables.subscriptions?.[0];
        if (row) row.last_payment_at = paidNow;
      }
      return execute("subscriptions", chain);
    });
    const entitlementBefore = structuredClone(tables.user_subscriptions?.[0]);

    const report = await run("apply");

    expect(report.rows[0]).toMatchObject({ decision: "error", applied: false });
    expect(report.rows[0]?.error).toMatch(/payment marker changed/);
    expect(report.writes).toEqual({ anchors: 0, paymentMarkers: 0, entitlements: 0, teams: 0 });
    expect(tables.subscriptions?.[0]).toMatchObject({
      last_payment_at: paidNow,
      first_payment_failed_at: null,
    });
    expect(tables.user_subscriptions?.[0]).toEqual(entitlementBefore);
  });

  it("dopłata za zmianę interwału, która OTWORZYŁA bieżący okres, opłaca go: bez zmian", async () => {
    // Samoobsługowy upgrade z miesięcznego na roczny (`always_invoice`)
    // resetuje okres: faktura `subscription_update` obciąża za cały nowy rok
    // (pozycja bez proraty od początku okresu). Później odrzucona dopłata za
    // miejsca zepchnęła subskrypcję w zaległość i operator ją anulował.
    seed({ subscriptions: [subRow(1)], entitlements: [entRow(1)] });
    const seatsFailed: RemoteInvoice = {
      ...openRenewal,
      created: relativeIso(-2 * DZIEN),
      finalizedAt: relativeIso(-2 * DZIEN),
      billingReason: "subscription_update",
      lines: [{ proration: true, start: relativeIso(-2 * DZIEN) }],
    };
    h.remote.set(providerId(1), remoteSub(1, { invoice: seatsFailed }));
    history(1, [
      {
        status: "paid",
        attempts: 1,
        created: start,
        paidAt: start,
        amountPaid: 47500,
        amountDue: 47500,
        billingReason: "subscription_update",
        lines: [
          { proration: true, start, end: relativeIso(20 * DZIEN) },
          { proration: false, start },
        ],
      },
    ]);
    const before = structuredClone(tables);

    const report = await run("apply");

    expect(report.rows[0]).toMatchObject({
      decision: "paid",
      evidence: "reason",
      paymentProof: "ledger",
    });
    expect(updates()).toEqual([]);
    expect(tables).toEqual(before);
  });

  it("zwykła dopłata dzień po początku okresu nie opłaca okresu - także z pozycją spoza tego okresu", async () => {
    seed({ subscriptions: [subRow(1)], entitlements: [entRow(1)] });
    h.remote.set(providerId(1), remoteSub(1, { invoice: openRenewal }));
    const dayAfter = relativeIso(-4 * DZIEN);
    history(1, [
      // Same proraty za resztę okresu.
      {
        ...proration,
        created: dayAfter,
        paidAt: dayAfter,
        lines: [{ proration: true, start: dayAfter }],
      },
      // Pozycja bez proraty, ale zaczyna się dobę po początku BIEŻĄCEGO okresu.
      {
        ...proration,
        created: dayAfter,
        paidAt: dayAfter,
        lines: [{ proration: false, start: dayAfter }],
      },
    ]);

    const report = await run("apply");

    expect(report.rows[0]).toMatchObject({ decision: "clamp", paymentProof: null });
    expect(tables.user_subscriptions?.[0]?.current_period_end).toBe(
      relativeIso(9 * DZIEN + GODZINA),
    );
  });

  it("odnowienie opłacone po anulowaniu, a ostatnią fakturą jest inna: dowód z historii, bez zmian", async () => {
    seed({
      subscriptions: [subRow(1, { last_payment_at: renewalPaidLate.paidAt })],
      entitlements: [entRow(1)],
    });
    h.remote.set(providerId(1), remoteSub(1, { invoice: proration }));
    history(1, [proration, renewalPaidLate]);
    const before = structuredClone(tables);

    const report = await run("apply");

    expect(report.rows[0]).toMatchObject({
      decision: "paid",
      evidence: "reason",
      paymentProof: "ledger",
      invoiceStatus: "paid",
      anchor: null,
      accessUntilAfter: null,
      applied: false,
    });
    expect(h.listCalls).toEqual([listQuery(1)]);
    expect(updates()).toEqual([]);
    expect(tables).toEqual(before);
  });

  it("zgubione `invoice.paid` (stary `last_payment_at`), ale opłacone odnowienie u operatora: dostęp zostaje", async () => {
    // `last_payment_at` z poprzedniego roku - według bazy okres nieopłacony.
    seed({ subscriptions: [subRow(1)], entitlements: [entRow(1)] });
    h.remote.set(providerId(1), remoteSub(1, { invoice: proration }));
    history(1, [proration, renewalPaidLate]);
    const before = structuredClone(tables);

    const report = await run("apply");

    expect(report.rows[0]).toMatchObject({
      decision: "paid",
      evidence: "reason",
      paymentProof: "ledger",
    });
    expect(updates()).toEqual([]);
    expect(tables).toEqual(before);
  });

  // ZMIANA FIXTURE'A: było `amount_paid: 0` z `paid_out_of_band: true` - kształt,
  // którego przypięta wersja API (dahlia) nie zwraca. Zapłata poza operatorem
  // jest w `amount_paid`, a jej część poza operatorem - w `amount_paid_off_stripe`.
  it("odnowienie oznaczone jako opłacone poza operatorem (API dahlia) też jest dowodem", async () => {
    seed({ subscriptions: [subRow(1)], entitlements: [entRow(1)] });
    h.remote.set(providerId(1), remoteSub(1, { invoice: proration }));
    history(1, [{ ...renewalPaidLate, amountPaid: 49900, amountPaidOffStripe: 49900 }]);

    const report = await run("apply");

    expect(report.rows[0]).toMatchObject({ decision: "paid", paymentProof: "ledger" });
    expect(updates()).toEqual([]);
  });

  it("faktura ręczna, dopłata, `paid` bez zapłaty i odnowienie z POPRZEDNIEGO okresu nie są dowodem", async () => {
    // `last_payment_at` z opłaconej faktury ręcznej w okresie - też nie dowód.
    seed({
      subscriptions: [subRow(1, { last_payment_at: relativeIso(-2 * DZIEN) })],
      entitlements: [entRow(1)],
    });
    h.remote.set(providerId(1), remoteSub(1, { invoice: openRenewal }));
    history(1, [
      {
        ...renewalPaidLate,
        created: relativeIso(-2 * DZIEN),
        paidAt: relativeIso(-2 * DZIEN),
        billingReason: "manual",
      },
      proration,
      { ...renewalPaidLate, paidAt: null, amountPaid: 0 },
      // Odnowienie sprzed roku - operator odfiltrowuje je po `created`.
      { ...renewalPaidLate, created: relativeIso(-370 * DZIEN), paidAt: relativeIso(-370 * DZIEN) },
    ]);

    const report = await run("apply");

    expect(report.rows[0]).toMatchObject({ decision: "clamp", paymentProof: null });
    expect(tables.user_subscriptions?.[0]?.current_period_end).toBe(
      relativeIso(9 * DZIEN + GODZINA),
    );
    // Znacznik z faktury ręcznej też nie opłaca okresu - wyczyszczony.
    expect(tables.subscriptions?.[0]?.last_payment_at).toBeNull();
  });

  it("błąd historii faktur u operatora: wiersz `error` bez zapisów, partia idzie dalej", async () => {
    seed({
      subscriptions: [subRow(1), subRow(2)],
      entitlements: [entRow(1), entRow(2)],
    });
    h.remote.set(providerId(1), remoteSub(1));
    h.remote.set(providerId(2), remoteSub(2));
    h.listErrors.set(providerId(1), new Error("Stripe invoices are down"));
    const untouchedRow = structuredClone(tables.user_subscriptions?.[0]);

    const report = await run("apply");

    expect(report.rows.map((r) => [r.subscriptionId, r.decision, r.error])).toEqual([
      [providerId(1), "error", "Stripe invoices are down"],
      [providerId(2), "clamp", null],
    ]);
    expect(report.rows[0]).toMatchObject({ applied: false, accessUntilAfter: null });
    // Zapisy wyłącznie dla wiersza 2.
    expect(report.writes).toEqual({ anchors: 1, paymentMarkers: 0, entitlements: 1, teams: 0 });
    for (const chain of updates()) {
      expect(chain.calls).not.toContainEqual({ method: "eq", args: ["id", subId(1)] });
      expect(chain.calls).not.toContainEqual({ method: "eq", args: ["id", "us-1"] });
    }
    expect(tables.user_subscriptions?.[0]).toEqual(untouchedRow);
    expect(tables.subscriptions?.[0]?.first_payment_failed_at).toBeNull();
  });

  it("historia ponad limit bez faktury okresu to `error`, a nie przycięcie", async () => {
    seed({ subscriptions: [subRow(1)], entitlements: [entRow(1)] });
    h.remote.set(providerId(1), remoteSub(1));
    history(
      1,
      Array.from({ length: PERIOD_INVOICE_SCAN_LIMIT + 1 }, () => proration),
    );

    const report = await run("apply");

    expect(report.rows[0]?.decision).toBe("error");
    expect(report.rows[0]?.error).toMatch(/exceeds/);
    expect(updates()).toEqual([]);
  });

  it("o historię pytamy tylko, gdy decyzja zależy od dowodu zapłaty", async () => {
    const paid: RemoteInvoice = {
      status: "paid",
      attempts: 1,
      paidAt: relativeIso(-2 * DZIEN),
      amountPaid: 49900,
    };
    seed({
      subscriptions: [subRow(1), subRow(2), subRow(3), subRow(4)],
      entitlements: [entRow(1), entRow(2), entRow(3), entRow(4)],
    });
    // 1: rezygnacja; 2: bez powodu, ostatnia opłacona (brak dowodu braku
    // płatności); 3: `payment_failed`, ostatnia opłacona (dowód z faktury);
    // 4: spór o płatność - zapłata niczego nie dowodzi, nawet w historii.
    h.remote.set(providerId(1), remoteSub(1, { reason: "cancellation_requested" }));
    h.remote.set(providerId(2), remoteSub(2, { reason: null, invoice: paid }));
    h.remote.set(providerId(3), remoteSub(3, { invoice: paid }));
    h.remote.set(providerId(4), remoteSub(4, { reason: "payment_disputed", invoice: paid }));
    for (const n of [1, 2, 3, 4]) history(n, [renewalPaidLate]);

    const report = await run("dry_run");

    expect(report.rows.map((r) => [r.decision, r.paymentProof])).toEqual([
      ["voluntary", null],
      ["no_evidence", null],
      ["paid", "invoice"],
      ["clamp", null],
    ]);
    expect(h.listCalls).toEqual([]);
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

  it("odczyty operatora idą po kolei, z rozwiniętą ostatnią fakturą - także historia faktur", async () => {
    seed({
      subscriptions: [subRow(1), subRow(2), subRow(3)],
      entitlements: [entRow(1), entRow(2), entRow(3)],
    });
    for (const n of [1, 2, 3]) h.remote.set(providerId(n), remoteSub(n));

    await run("dry_run");

    expect(h.maxInFlight).toBe(1);
    expect(h.retrieveCalls[0]?.params).toEqual({ expand: ["latest_invoice"] });
    // Każde z trzech odnowień jest nieopłacone - historia dla każdego, po kolei.
    expect(h.listCalls.map((c) => c.subscription)).toEqual([1, 2, 3].map(providerId));
  });
});

// --- kształt ładunku operatora ----------------------------------------------

describe("fakty operatora - ładunek bez pól, na których stoi decyzja", () => {
  /** Subskrypcja `n` u operatora z dowolną surową ostatnią fakturą. */
  const withInvoice = (latestInvoice: Record<string, unknown>, o: RemoteOptions = {}) => ({
    ...remoteSub(1, o),
    latest_invoice: { id: "in_surowa", object: "invoice", ...latestInvoice },
  });
  const decideRaw = (raw: Record<string, unknown>) =>
    decideLegacyNonPayment({
      subscription: subRow(1) as unknown as LegacySubscriptionRow,
      entitlements: [entRow(1)] as unknown as LegacyEntitlementRow[],
      teamActive: false,
      stripe: readLegacyStripeFacts(raw),
      now: FIXED_NOW,
    });

  it("faktura bez statusu, prób i powodu niczego nie dowodzi; chwila próby to jej utworzenie", () => {
    const created = relativeIso(-5 * DZIEN + 30 * 60 * 1000);
    const raw = withInvoice({ created: unix(created) });

    expect(readLegacyStripeFacts(raw).invoice).toEqual({
      status: null,
      attemptCount: 0,
      attemptedAt: created,
      paidAt: null,
      amountPaid: null,
      amountDue: null,
      amountPaidOffStripe: null,
      paidOutOfBand: false,
      billingReason: null,
      fullPeriodStart: null,
    });
    // `payment_failed` od operatora wystarcza, ale kotwicą nie jest
    // utworzenie faktury, która porażki nie dowodzi - tylko początek okresu.
    expect(decideRaw(raw)).toMatchObject({
      decision: "clamp",
      evidence: "reason",
      anchor: relativeIso(-5 * DZIEN),
    });
    // Bez powodu taka faktura nie jest dowodem braku płatności.
    expect(decideRaw(withInvoice({ created: unix(created) }, { reason: null }))).toMatchObject({
      decision: "no_evidence",
      clamp: [],
    });
  });

  it("bez `ended_at` (starszy ładunek) koniec subskrypcji to `canceled_at` - kotwica nie później", () => {
    const canceledAt = relativeIso(-3 * DZIEN);
    const raw = {
      ...remoteSub(1, {
        invoice: { status: "open", attempts: 1, finalizedAt: relativeIso(-1 * DZIEN) },
      }),
      ended_at: null,
      canceled_at: unix(canceledAt),
    };

    expect(readLegacyStripeFacts(raw).endedAt).toBe(canceledAt);
    expect(decideRaw(raw).anchor).toBe(canceledAt);
  });

  it("nieopłacona faktura bez znaczników czasu: kotwicą zostaje początek okresu", () => {
    const raw = withInvoice({ status: "open", attempt_count: 4 }, { reason: null });

    expect(decideRaw(raw)).toMatchObject({
      decision: "clamp",
      evidence: "invoice",
      anchor: relativeIso(-5 * DZIEN),
      accessUntil: relativeIso(9 * DZIEN),
    });
  });

  it("ładunek sprzed Basil bez kwot, opłacony poza operatorem (`paid_out_of_band`): dowód zapłaty", () => {
    const raw = withInvoice({
      status: "paid",
      attempt_count: 4,
      paid_out_of_band: true,
      billing_reason: "subscription_cycle",
      status_transitions: { paid_at: unix(relativeIso(-2 * DZIEN)) },
    });

    expect(decideRaw(raw)).toMatchObject({ decision: "paid", paymentProof: "invoice" });
    // Ten sam ładunek bez znacznika poza operatorem - zero kwot to nie zapłata.
    expect(
      decideRaw(
        withInvoice({
          status: "paid",
          attempt_count: 4,
          status_transitions: { paid_at: unix(relativeIso(-2 * DZIEN)) },
        }),
      ),
    ).toMatchObject({ decision: "clamp", paymentProof: null });
  });
});

describe("przebieg - operator bez okresu i bez ostatniej faktury", () => {
  it("okres z bazy: kotwica z jej początku, koniec karencji ograniczony jej końcem", async () => {
    // Starsza odpowiedź operatora: okres ani na pozycji, ani na subskrypcji,
    // ostatnia faktura nieznana. Baza pamięta okres, który kończy się za 3 dni.
    seed({
      subscriptions: [subRow(1, { current_period_end: relativeIso(3 * DZIEN) })],
      entitlements: [entRow(1)],
    });
    h.remote.set(providerId(1), {
      ...remoteSub(1, { invoice: null }),
      items: { data: [{ price: { id: "price_plus_annual", lookup_key: "plus_annual" } }] },
    });

    const report = await run("apply");

    expect(report.rows[0]).toMatchObject({
      decision: "clamp",
      evidence: "reason",
      cancellationReason: "payment_failed",
      invoiceStatus: null,
      anchor: relativeIso(-5 * DZIEN),
      accessUntilAfter: relativeIso(3 * DZIEN),
      applied: true,
    });
    // Historia faktur okresu liczona od początku okresu z bazy.
    expect(h.listCalls).toEqual([
      expect.objectContaining({ created: { gte: unix(relativeIso(-5 * DZIEN)) - 60 * 60 } }),
    ]);
    expect(tables.subscriptions?.[0]?.first_payment_failed_at).toBe(relativeIso(-5 * DZIEN));
    expect(tables.user_subscriptions?.[0]?.current_period_end).toBe(relativeIso(3 * DZIEN));
  });
});

describe("wstępna selekcja - zwrot", () => {
  it("zwrot bez dostępu, bez zespołu i z minionym okresem nie trafia do raportu", () => {
    const expired = [
      entRow(1, { status: "refunded", current_period_end: relativeIso(-1 * DZIEN) }),
    ] as unknown as LegacyEntitlementRow[];

    expect(triageLegacyCandidate(expired, false, FIXED_NOW)).toBe("skip");
    // Aktywny zespół na tej subskrypcji - zwrot raportujemy, nie ruszamy.
    expect(triageLegacyCandidate(expired, true, FIXED_NOW)).toBe("refunded");
  });
});

describe("przebieg - błędy operatora w kształcie SDK", () => {
  it("`resource_missing` w `raw` (kształt błędu SDK) to pominięcie; limit zapytań to `error`", async () => {
    seed({ subscriptions: [subRow(1), subRow(2)], entitlements: [entRow(1), entRow(2)] });
    h.remoteErrors.set(
      providerId(1),
      Object.assign(new Error("No such subscription: 'sub_legacy_1'"), {
        type: "StripeInvalidRequestError",
        raw: { code: "resource_missing", message: "No such subscription" },
      }),
    );
    h.remoteErrors.set(
      providerId(2),
      Object.assign(new Error("Too many requests"), {
        type: "StripeRateLimitError",
        code: "rate_limit",
        raw: { code: "rate_limit", message: "Too many requests" },
      }),
    );

    const report = await run("apply");

    expect(report.rows.map((r) => [r.subscriptionId, r.decision, r.error])).toEqual([
      [providerId(1), "stripe_missing", null],
      [providerId(2), "error", "Too many requests"],
    ]);
    expect(updates()).toEqual([]);
  });
});

describe("przebieg - zapisy", () => {
  it("zapisana kotwica: przycięcie bez ponownego zapisu kotwicy", async () => {
    const stored = relativeIso(-12 * DZIEN);
    seed({
      subscriptions: [subRow(1, { first_payment_failed_at: stored })],
      entitlements: [entRow(1)],
    });
    h.remote.set(providerId(1), remoteSub(1));

    const report = await run("apply");

    expect(report.rows[0]).toMatchObject({ decision: "clamp", anchor: stored, applied: true });
    expect(report.writes).toEqual({ anchors: 0, paymentMarkers: 0, entitlements: 1, teams: 0 });
    expect(updates("subscriptions")).toEqual([]);
    expect(tables.user_subscriptions?.[0]?.current_period_end).toBe(relativeIso(2 * DZIEN));
  });

  it("dwa aktywne uprawnienia tego klucza: oba przycięte, „przed” to najdalszy koniec", async () => {
    seed({
      subscriptions: [subRow(1)],
      entitlements: [
        entRow(1, { current_period_end: relativeIso(200 * DZIEN) }),
        entRow(1, { id: "us-1-dup", current_period_end: relativeIso(360 * DZIEN) }),
        entRow(1, { id: "us-1-old", current_period_end: relativeIso(100 * DZIEN) }),
      ],
    });
    h.remote.set(providerId(1), remoteSub(1));

    const report = await run("apply");

    expect(report.rows[0]).toMatchObject({
      decision: "clamp",
      accessUntilBefore: relativeIso(360 * DZIEN),
      accessUntilAfter: relativeIso(9 * DZIEN + GODZINA),
    });
    expect(report.writes.entitlements).toBe(3);
    expect(tables.user_subscriptions?.map((r) => r.current_period_end)).toEqual([
      relativeIso(9 * DZIEN + GODZINA),
      relativeIso(9 * DZIEN + GODZINA),
      relativeIso(9 * DZIEN + GODZINA),
    ]);
  });

  it("odmowa przycięcia drugiego uprawnienia: pierwsze przycięte i policzone, wiersz `error`", async () => {
    seed({
      subscriptions: [subRow(1)],
      entitlements: [entRow(1), entRow(1, { id: "us-1-dup" })],
    });
    h.remote.set(providerId(1), remoteSub(1));
    db.setResponse("user_subscriptions", (chain) =>
      chain.has("update") && chain.calls.some((c) => c.method === "eq" && c.args[1] === "us-1-dup")
        ? fail("row is locked")
        : execute("user_subscriptions", chain),
    );

    const report = await run("apply");

    expect(report.rows[0]).toMatchObject({
      decision: "error",
      error: "entitlement clamp failed: row is locked",
      applied: true,
    });
    expect(report.writes).toEqual({ anchors: 1, paymentMarkers: 0, entitlements: 1, teams: 0 });
    expect(tables.user_subscriptions?.map((r) => [r.id, r.current_period_end])).toEqual([
      ["us-1", relativeIso(9 * DZIEN + GODZINA)],
      ["us-1-dup", relativeIso(360 * DZIEN)],
    ]);
  });

  it("odmowa wyczyszczenia znacznika zapłaty: `error` bez żadnego zapisu", async () => {
    seed({
      subscriptions: [subRow(1, { last_payment_at: relativeIso(-3 * DZIEN) })],
      entitlements: [entRow(1)],
    });
    h.remote.set(providerId(1), remoteSub(1));
    db.setResponse("subscriptions", (chain) =>
      chain.has("update") ? fail("permission denied") : execute("subscriptions", chain),
    );
    const before = structuredClone(tables);

    const report = await run("apply");

    expect(report.rows[0]).toMatchObject({
      decision: "error",
      error: "payment marker clear failed: permission denied",
      applied: false,
    });
    expect(report.writes).toEqual({ anchors: 0, paymentMarkers: 0, entitlements: 0, teams: 0 });
    expect(updates("user_subscriptions")).toEqual([]);
    expect(tables).toEqual(before);
  });
});

describe("przebieg - odczyt bazy", () => {
  // Nieudany odczyt NIE jest pustą partią: `done: true` z zerem wierszy
  // zakończyłby zadanie w panelu, choć nic nie zostało sprawdzone.
  it.each([
    ["subscriptions", "legacy reconcile: subscriptions read failed: boom"],
    ["user_subscriptions", "legacy reconcile: entitlements read failed: boom"],
    ["member_organizations", "legacy reconcile: teams read failed: boom"],
  ])("błąd odczytu `%s` przerywa partię - bez operatora i bez zapisów", async (table, message) => {
    seed({
      subscriptions: [subRow(1, { price_id: "team_monthly_seat" })],
      entitlements: [entRow(1)],
    });
    db.setResponse(table, fail("boom"));
    h.remote.set(providerId(1), remoteSub(1));

    await expect(run("apply")).rejects.toThrow(message);
    expect(h.retrieveCalls).toEqual([]);
    expect(updates()).toEqual([]);
  });

  it("partia bez planu Zespół nie pyta o organizacje", async () => {
    seed({ subscriptions: [subRow(1)], entitlements: [entRow(1)] });
    h.remote.set(providerId(1), remoteSub(1));

    await run("dry_run");

    expect(db.chainsFor("member_organizations")).toEqual([]);
  });

  it("rozmiar partii: poza 1..100 - domyślna albo górna granica, ułamek obcięty", async () => {
    seed({ subscriptions: [subRow(1)] });

    for (const [requested, limit] of [
      [0, 50],
      [Number.NaN, 50],
      [500, 100],
      [2.7, 2],
    ] as const) {
      db.chains.length = 0;
      await run("dry_run", { batchSize: requested });
      expect(db.chainsFor("subscriptions")[0]?.argsOf("limit")).toEqual([limit]);
    }
  });
});
