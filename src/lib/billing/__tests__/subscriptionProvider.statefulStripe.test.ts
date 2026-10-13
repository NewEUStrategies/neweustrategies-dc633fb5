// Operacje na subskrypcji przeciw STANOWEJ atrapie operatora - scenariusze
// z przeglądu audytu billingowego (SUB-04 / SUB-14), których atrapy
// wywołań w `subscriptionProvider.server.test.ts` nie potrafią odtworzyć.
//
// Atrapa trzyma subskrypcję, harmonogramy i faktury, a przede wszystkim
// pamięć kluczy idempotencji tak jak operator: ten sam klucz w ciągu doby
// dostaje ZAPAMIĘTANĄ odpowiedź (także błąd) bez ponownego wykonania. Bez
// tego nie widać, że zmniejsz -> cofnij -> zmniejsz wraca do identycznego
// odcisku i dostaje z pamięci harmonogram już zwolniony. Każda mutacja
// subskrypcji emituje `customer.subscription.updated` z migawką stanu - w
// jednej sekundzie, jak dwa wywołania jedno po drugim - więc test widzi, czy
// któraś migawka niesie stan sprzeczny z wynikiem operacji (strażnik
// webhooka po sekundach może przepuścić dowolną z nich). Atrapa umie też
// zwrócić przejściowe 5xx albo zgubić odpowiedź PO wykonaniu - kompensacja
// musi rozstrzygać żywym stanem, a nie samym faktem błędu.
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Kopia przez JSON - odpowiedź operatora to dane, nie żywe referencje. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const PERIOD_START = 1_764_547_200;
/** 2026-01-01T00:00:00Z - koniec bieżącego okresu. */
const PERIOD_END = 1_767_225_600;
const PERIOD_END_ISO = new Date(Date.UTC(2026, 0, 1)).toISOString();
const HOSTED = "https://invoice.stripe.test/i/acct_1/inv_proration";

type Raw = Record<string, unknown>;

interface FakeItem {
  id: string;
  quantity: number;
  current_period_start: number;
  current_period_end: number;
  price: { id: string; lookup_key: string };
  tax_rates: { id: string }[] | null;
  discounts: string[];
}

interface FakeSub {
  id: string;
  object: "subscription";
  status: string;
  customer: string;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  /** Chwila ostatniego ustawienia końca - operator przesuwa ją przy KAŻDYM ustawieniu. */
  canceled_at: number | null;
  pause_collection: { behavior: string; resumes_at: number | null } | null;
  schedule: string | null;
  latest_invoice: string | null;
  pending_update: Raw | null;
  metadata: Record<string, string>;
  discounts: string[];
  default_tax_rates: { id: string }[] | null;
  automatic_tax: { enabled: boolean; liability: { type: string } | null; disabled_reason: null };
  trial_end: number | null;
  items: { data: FakeItem[] };
}

interface FakeInvoice {
  id: string;
  status: string;
  hosted_invoice_url: string;
  metadata?: Record<string, string>;
  created?: number;
  billing_reason?: string;
  /** Chwila zapłaty (`status_transitions.paid_at`). */
  paid_at?: number | null;
  /** Subskrypcja faktury (`parent`) - domyślnie ta jedyna. */
  subscription?: string;
  /** Status intencji płatności faktury (`requires_action` = 3DS). */
  intentStatus?: string;
}

interface FakeSchedule {
  id: string;
  object: "subscription_schedule";
  status: string;
  subscription: string | null;
  metadata: Record<string, string>;
  end_behavior: string;
  current_phase: { start_date: number; end_date: number } | null;
  phases: Raw[];
}

interface SubscriptionEvent {
  /** Sekunda zdarzenia - cała operacja mieści się w jednej. */
  created: number;
  price: string;
  quantity: number;
  cancelScheduled: boolean;
  schedule: string | null;
  pendingUpdate: boolean;
}

const priceIdOf = (lookupKey: string) => `price_${lookupKey}`;
const lookupKeyOf = (priceId: string) => priceId.replace(/^price_/, "");

/** Błąd w kształcie SDK operatora (`type` + `code` + `raw`). */
function stripeError(message: string, type: string, code?: string): Error {
  return Object.assign(new Error(message), { type, code, raw: { type, code } });
}

class FakeStripe {
  sub: FakeSub;
  schedules = new Map<string, FakeSchedule>();
  invoices = new Map<string, FakeInvoice>();
  /** Pamięć kluczy idempotencji: klucz -> zapamiętana odpowiedź albo błąd. */
  private cache = new Map<string, { value?: unknown; error?: unknown }>();
  /** Dziennik wywołań: `nazwa:EXEC` (wykonane) albo `nazwa:REPLAY` (z pamięci). */
  log: string[] = [];
  events: SubscriptionEvent[] = [];
  /**
   * Następna dopłata (`pending_if_incomplete`) nie przejdzie: `true` - odmowa
   * zwrócona z `pending_update`, `requires_action` - 3DS (też zwrócone),
   * `thrown` - oczekująca zmiana powstaje, ale operator RZUCA `card_declined`,
   * `thrown_unchanged` - operator RZUCA `card_declined`, a oczekująca zmiana
   * (także wcześniejsza) i ostatnia faktura zostają, jakie były.
   */
  declineNextPayment: boolean | "requires_action" | "thrown" | "thrown_unchanged" = false;
  /**
   * Następna aktualizacja subskrypcji kończy się tym błędem BEZ wykonania.
   * Operator zapamiętuje pod kluczem także 5xx, więc atrapa też - ponowienie
   * tym samym kluczem dostałoby ten sam błąd z pamięci.
   */
  failNextUpdate: Error | null = null;
  /**
   * Następne wywołanie tej metody WYKONUJE się (i trafia do pamięci klucza),
   * ale odpowiedź ginie - zerwane połączenie po stronie klienta.
   */
  loseResponseOf: "sub.update" | "schedule.release" | null = null;
  /**
   * Następne zwolnienie harmonogramu odbija się PRZED wykonaniem (limit
   * zapytań, blokada obiektu) - operator niczego nie zapamiętuje pod kluczem,
   * więc ponowienie tym samym kluczem naprawdę się wykona.
   */
  rejectNextRelease: Error | null = null;
  /** Jak `rejectNextRelease`, dla aktualizacji subskrypcji (odbita PRZED wykonaniem). */
  rejectNextUpdate: Error | null = null;
  /** Następny zapis metadanych faktury kończy się tym błędem (zapamiętanym pod kluczem). */
  failNextInvoiceUpdate: Error | null = null;
  /**
   * Koniec okresu bez daty końca: data krótsza niż okres nowej ceny (upgrade
   * ze zmianą interwału) skraca okres do siebie, a jej zdjęcie go przedłuża.
   */
  uncappedPeriodEnd: number | null = null;
  private seq = 0;
  /** Zegar operatora - `tick` przesuwa go między krokami klienta. */
  private now = PERIOD_START + 3_600;

  constructor(over: Partial<FakeSub> = {}, item: Partial<FakeItem> = {}) {
    this.sub = {
      id: "sub_1",
      object: "subscription",
      status: "active",
      customer: "cus_1",
      cancel_at_period_end: false,
      cancel_at: null,
      canceled_at: null,
      pause_collection: null,
      schedule: null,
      latest_invoice: "in_period",
      pending_update: null,
      metadata: {},
      discounts: [],
      default_tax_rates: null,
      automatic_tax: { enabled: false, liability: null, disabled_reason: null },
      trial_end: null,
      items: {
        data: [
          {
            id: "si_1",
            quantity: 1,
            current_period_start: PERIOD_START,
            current_period_end: PERIOD_END,
            price: { id: priceIdOf("plus_monthly"), lookup_key: "plus_monthly" },
            tax_rates: null,
            discounts: [],
            ...item,
          },
        ],
      },
      ...over,
    };
    this.invoices.set("in_period", {
      id: "in_period",
      status: "paid",
      hosted_invoice_url: "https://invoice.stripe.test/i/period",
      billing_reason: "subscription_cycle",
      paid_at: PERIOD_START,
    });
  }

  /** Kolejne kroki klienta dzieją się później niż poprzednie (sekundy). */
  tick(seconds: number): void {
    this.now += seconds;
  }

  /** Zegar operatora w milisekundach - do zrównania z zegarem aplikacji. */
  nowMs(): number {
    return this.now * 1000;
  }

  /**
   * Zmiana końca SPOZA aplikacji (portal klienta, panel operatora): bez
   * klucza idempotencji, z własnym zdarzeniem - jak każda aktualizacja.
   */
  customer(params: { cancel_at?: number | ""; cancel_at_period_end?: boolean }): void {
    this.log.push("portal.update:EXEC");
    this.applyCancellation(params);
    this.emit();
  }

  /** Harmonogram dołączony do subskrypcji, o ile wciąż steruje nią operator. */
  liveSchedule(): FakeSchedule | null {
    const s = this.sub.schedule ? this.schedules.get(this.sub.schedule) : undefined;
    return s && (s.status === "active" || s.status === "not_started") ? s : null;
  }

  /**
   * Harmonogram ustawiony w panelu operatora (migracja cennika, zmiana
   * uzgodniona przez obsługę): bieżąca faza = żywe pozycje do końca okresu,
   * następna = `next`. Daty faz wypełnione tak jak w odpowiedzi operatora.
   */
  seedSchedule(next: { price: string; quantity: number }[]): string {
    const item = this.sub.items.data[0];
    const id = this.nextId("sched");
    const length = item.current_period_end - item.current_period_start;
    this.schedules.set(id, {
      id,
      object: "subscription_schedule",
      status: "active",
      subscription: this.sub.id,
      metadata: {},
      end_behavior: "release",
      current_phase: { start_date: item.current_period_start, end_date: item.current_period_end },
      phases: [
        {
          start_date: item.current_period_start,
          end_date: item.current_period_end,
          items: [{ price: item.price.id, quantity: item.quantity }],
        },
        {
          start_date: item.current_period_end,
          end_date: item.current_period_end + length,
          items: next,
        },
      ],
    });
    this.sub.schedule = id;
    return id;
  }

  /**
   * Klient płaci odrzuconą wcześniej dopłatę (strona faktury, inna karta) w
   * oknie oczekującej zmiany: operator stosuje `pending_update` - pozycje
   * dostają nową cenę/ilość, faktura jest opłacona, a fazy dołączonego
   * harmonogramu domyślnie zostają nietknięte. Zwraca migawkę subskrypcji
   * z chwili zastosowania (ładunek `customer.subscription.pending_update_applied`:
   * harmonogram jako identyfikator, nie obiekt).
   *
   * `splitPhase` odtwarza drugie zachowanie operatora: zmiana `items` na
   * subskrypcji z harmonogramem potrafi PODZIELIĆ bieżącą fazę - stara kończy
   * się teraz ze starymi pozycjami, nowa (bieżąca) niesie już nowe, a faza
   * następna (zaplanowana zmiana) zostaje. Wtedy bieżąca faza harmonogramu
   * z odmowy wygląda tak samo jak przepisanego po zastosowaniu zmiany.
   */
  payPendingInvoice(o: { splitPhase?: boolean } = {}): Raw {
    const pending = this.sub.pending_update as {
      subscription_items: { price?: string; quantity?: number }[];
    } | null;
    if (!pending) throw new Error("test: brak oczekującej zmiany do zastosowania");
    const item = this.sub.items.data[0];
    const next = pending.subscription_items[0];
    if (next.price) item.price = { id: next.price, lookup_key: lookupKeyOf(next.price) };
    if (next.quantity) item.quantity = next.quantity;
    const schedule = this.liveSchedule();
    if (o.splitPhase && schedule?.current_phase) {
      const start = schedule.current_phase.start_date;
      const index = schedule.phases.findIndex((phase) => phase.start_date === start);
      const ended = { ...schedule.phases[index], end_date: this.now };
      const applied = {
        ...schedule.phases[index],
        start_date: this.now,
        items: [{ price: item.price.id, quantity: item.quantity }],
      };
      schedule.phases.splice(index, 1, ended, applied);
      schedule.current_phase = { start_date: this.now, end_date: item.current_period_end };
    }
    if (this.sub.latest_invoice) {
      const invoice = this.invoices.get(this.sub.latest_invoice);
      if (invoice) Object.assign(invoice, { status: "paid", paid_at: this.now });
    }
    this.sub.pending_update = null;
    this.emit();
    return this.view();
  }

  /**
   * Odnowienie na koniec okresu: dołączony harmonogram wchodzi w następną
   * fazę (jej pozycje zastępują pozycje subskrypcji), a bez fazy następnej
   * zwalnia subskrypcję (`end_behavior: release`).
   */
  renew(): void {
    const item = this.sub.items.data[0];
    const length = item.current_period_end - item.current_period_start;
    // Zaplanowany koniec (flaga albo data) w tym okresie: operator kończy subskrypcję.
    if (this.sub.cancel_at !== null && this.sub.cancel_at <= item.current_period_end) {
      this.sub.status = "canceled";
      this.emit();
      return;
    }
    const schedule = this.liveSchedule();
    if (schedule?.current_phase) {
      const start = schedule.current_phase.start_date;
      const index = schedule.phases.findIndex((phase) => phase.start_date === start);
      const next = schedule.phases[index + 1] as
        { items?: { price: string; quantity?: number }[] } | undefined;
      const line = next?.items?.[0];
      if (line) {
        item.price = { id: line.price, lookup_key: lookupKeyOf(line.price) };
        item.quantity = line.quantity ?? 1;
        schedule.current_phase = {
          start_date: item.current_period_end,
          end_date: item.current_period_end + length,
        };
      } else {
        schedule.status = "released";
        schedule.subscription = null;
        this.sub.schedule = null;
      }
    }
    item.current_period_start = item.current_period_end;
    item.current_period_end += length;
    this.emit();
  }

  private delivered<T>(name: "sub.update" | "schedule.release", value: T): T {
    if (this.loseResponseOf !== name) return value;
    this.loseResponseOf = null;
    throw stripeError("Connection reset by peer", "StripeConnectionError");
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  private emit(): void {
    const item = this.sub.items.data[0];
    this.events.push({
      created: this.now,
      price: item.price.lookup_key,
      quantity: item.quantity,
      cancelScheduled: this.sub.cancel_at_period_end || this.sub.cancel_at !== null,
      schedule: this.sub.schedule,
      pendingUpdate: this.sub.pending_update !== null,
    });
  }

  private idem<T>(name: string, key: string | undefined, exec: () => T): T {
    const cached = key ? this.cache.get(key) : undefined;
    if (cached) {
      this.log.push(`${name}:REPLAY`);
      if (cached.error) throw cached.error;
      return clone(cached.value) as T;
    }
    this.log.push(`${name}:EXEC`);
    try {
      const value = exec();
      if (key) this.cache.set(key, { value: clone(value) });
      return clone(value);
    } catch (error) {
      if (key) this.cache.set(key, { error });
      throw error;
    }
  }

  private view(expand: readonly string[] = []): Raw {
    const out = clone(this.sub) as unknown as Raw;
    if (expand.includes("schedule") && this.sub.schedule) {
      out.schedule = clone(this.schedules.get(this.sub.schedule));
    }
    if (expand.some((e) => e.startsWith("latest_invoice")) && this.sub.latest_invoice) {
      out.latest_invoice = this.invoiceView(this.sub.latest_invoice);
    }
    return out;
  }

  /** Faktura w kształcie operatora (API Basil+: subskrypcja w `parent`). */
  private invoiceView(id: string): Raw | undefined {
    const invoice = this.invoices.get(id);
    if (!invoice) return undefined;
    const { intentStatus, paid_at, subscription, ...rest } = clone(invoice);
    return {
      object: "invoice",
      metadata: {},
      ...rest,
      status_transitions: { paid_at: paid_at ?? null },
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: subscription ?? this.sub.id },
      },
      payments: {
        data: intentStatus ? [{ payment: { payment_intent: { status: intentStatus } } }] : [],
      },
    };
  }

  private newInvoice(status: string, intentStatus?: string): string {
    const id = this.nextId("in");
    this.invoices.set(id, {
      id,
      status,
      hosted_invoice_url: HOSTED,
      metadata: {},
      created: this.now,
      billing_reason: "subscription_update",
      paid_at: status === "paid" ? this.now : null,
      ...(intentStatus ? { intentStatus } : {}),
    });
    this.sub.latest_invoice = id;
    return id;
  }

  private applyCancellation(params: Raw): void {
    if (params.cancel_at_period_end === true) {
      this.sub.cancel_at_period_end = true;
      this.sub.cancel_at = this.sub.items.data[0].current_period_end;
      this.sub.canceled_at = this.now;
    } else if (params.cancel_at_period_end === false) {
      this.sub.cancel_at_period_end = false;
      this.sub.cancel_at = null;
      this.sub.canceled_at = null;
    }
    if (params.cancel_at === "") {
      this.sub.cancel_at = null;
      this.sub.canceled_at = null;
      if (this.uncappedPeriodEnd !== null) {
        this.sub.items.data[0].current_period_end = this.uncappedPeriodEnd;
      }
    } else if (typeof params.cancel_at === "number") {
      this.sub.cancel_at = params.cancel_at;
      this.sub.canceled_at = this.now;
    }
  }

  client(): Stripe {
    return {
      prices: {
        list: async (p: { lookup_keys: string[] }) => ({
          data: p.lookup_keys.map((k) => ({ id: priceIdOf(k) })),
        }),
        retrieve: async (id: string) => {
          this.log.push("price.retrieve:EXEC");
          return { id, lookup_key: lookupKeyOf(id) };
        },
      },
      paymentIntents: { retrieve: async () => ({ status: "requires_payment_method" }) },
      invoices: {
        retrieve: async (id: string) => {
          this.log.push("invoice.retrieve:EXEC");
          const invoice = this.invoiceView(id);
          if (!invoice) {
            throw stripeError(
              `No such invoice: '${id}'`,
              "invalid_request_error",
              "resource_missing",
            );
          }
          return invoice;
        },
        update: async (id: string, params: Raw, opts?: { idempotencyKey?: string }) =>
          this.idem("invoice.update", opts?.idempotencyKey, () => {
            if (this.failNextInvoiceUpdate) {
              const error = this.failNextInvoiceUpdate;
              this.failNextInvoiceUpdate = null;
              throw error;
            }
            const invoice = this.invoices.get(id);
            if (!invoice) throw stripeError("No such invoice", "invalid_request_error");
            invoice.metadata = {
              ...invoice.metadata,
              ...(params.metadata as Record<string, string>),
            };
            return this.invoiceView(id);
          }),
      },
      subscriptions: {
        retrieve: async (_id: string, p?: { expand?: string[] }) => this.view(p?.expand ?? []),
        update: async (_id: string, params: Raw, opts?: { idempotencyKey?: string }) => {
          if (this.rejectNextUpdate) {
            const error = this.rejectNextUpdate;
            this.rejectNextUpdate = null;
            this.log.push("sub.update:REJECTED");
            throw error;
          }
          const result = this.idem("sub.update", opts?.idempotencyKey, () => {
            if (this.failNextUpdate) {
              const error = this.failNextUpdate;
              this.failNextUpdate = null;
              throw error;
            }
            const touchesCancel = "cancel_at_period_end" in params || "cancel_at" in params;
            if (touchesCancel && this.sub.schedule) {
              throw stripeError(
                "The subscription is managed by the subscription schedule, and updating any cancelation behavior directly is not allowed.",
                "invalid_request_error",
              );
            }
            const items = params.items as
              { id: string; price?: string; quantity?: number }[] | undefined;
            if (
              items &&
              params.payment_behavior === "pending_if_incomplete" &&
              this.declineNextPayment
            ) {
              const decline = this.declineNextPayment;
              this.declineNextPayment = false;
              if (decline === "thrown_unchanged") {
                throw stripeError("Your card was declined.", "card_error", "card_declined");
              }
              this.newInvoice(
                "open",
                decline === "requires_action" ? "requires_action" : undefined,
              );
              // Nic nie weszło: ani pozycje, ani pola wysłane razem z nimi.
              this.sub.pending_update = { subscription_items: items, expires_at: PERIOD_END };
              this.emit();
              if (decline === "thrown") {
                throw stripeError("Your card was declined.", "card_error", "card_declined");
              }
              return this.view(["latest_invoice"]);
            }
            if (items) {
              const item = this.sub.items.data[0];
              const next = items[0];
              if (next.price) item.price = { id: next.price, lookup_key: lookupKeyOf(next.price) };
              if (next.quantity) item.quantity = next.quantity;
              this.newInvoice("paid");
            }
            this.applyCancellation(params);
            if (params.pause_collection === "") this.sub.pause_collection = null;
            if (params.metadata) Object.assign(this.sub.metadata, params.metadata);
            this.emit();
            return this.view(items ? ["latest_invoice"] : []);
          });
          return this.delivered("sub.update", result);
        },
        resume: async () => this.view(),
      },
      subscriptionSchedules: {
        create: async (params: { from_subscription: string }, opts?: { idempotencyKey?: string }) =>
          this.idem("schedule.create", opts?.idempotencyKey, () => {
            if (this.sub.schedule) {
              throw stripeError(
                "You cannot migrate a subscription that is already attached to a schedule.",
                "invalid_request_error",
              );
            }
            const item = this.sub.items.data[0];
            const schedule: FakeSchedule = {
              id: this.nextId("sched"),
              object: "subscription_schedule",
              status: "active",
              subscription: params.from_subscription,
              metadata: {},
              end_behavior: "release",
              current_phase: {
                start_date: item.current_period_start,
                end_date: item.current_period_end,
              },
              phases: [
                {
                  start_date: item.current_period_start,
                  end_date: item.current_period_end,
                  items: [{ price: item.price.id, quantity: item.quantity }],
                  discounts: this.sub.discounts.map((d) => ({ discount: d })),
                  trial_end: this.sub.trial_end,
                },
              ],
            };
            this.schedules.set(schedule.id, schedule);
            this.sub.schedule = schedule.id;
            this.emit();
            return schedule;
          }),
        retrieve: async (id: string) => clone(this.schedules.get(id)),
        update: async (id: string, params: Raw, opts?: { idempotencyKey?: string }) =>
          this.idem("schedule.update", opts?.idempotencyKey, () => {
            const schedule = this.schedules.get(id);
            if (!schedule || (schedule.status !== "active" && schedule.status !== "not_started")) {
              throw stripeError(
                `You cannot update a subscription schedule that is currently in the \`${schedule?.status}\` status.`,
                "invalid_request_error",
              );
            }
            schedule.phases = clone(params.phases as Raw[]);
            schedule.end_behavior = String(params.end_behavior ?? schedule.end_behavior);
            if (params.metadata) Object.assign(schedule.metadata, params.metadata);
            return schedule;
          }),
        release: async (id: string, _p: Raw, opts?: { idempotencyKey?: string }) => {
          if (this.rejectNextRelease) {
            const error = this.rejectNextRelease;
            this.rejectNextRelease = null;
            this.log.push("schedule.release:REJECTED");
            throw error;
          }
          return this.delivered(
            "schedule.release",
            this.idem("schedule.release", opts?.idempotencyKey, () => {
              const schedule = this.schedules.get(id);
              if (!schedule || schedule.status !== "active") {
                throw stripeError("You cannot release this schedule.", "invalid_request_error");
              }
              schedule.status = "released";
              schedule.subscription = null;
              this.sub.schedule = null;
              this.emit();
              return schedule;
            }),
          );
        },
      },
    } as unknown as Stripe;
  }
}

const h = vi.hoisted(() => ({ fake: null as unknown as { client(): unknown } }));

vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getStripeClient: async () => h.fake.client(),
}));

import {
  cancelSubscriptionAtPeriodEnd,
  changeSubscriptionPrice,
  clearCancelDateAfterAppliedUpgrade,
  PAUSED_BY_OPERATOR,
  PAYMENT_FAILED,
  PAYMENT_REQUIRES_ACTION,
  reconcileScheduleWithAppliedUpdate,
  resumeProviderSubscription,
  updateSubscriptionQuantity,
} from "@/lib/billing/subscriptionProvider.server";

let fake: FakeStripe;
const useFake = (f: FakeStripe) => {
  fake = f;
  h.fake = f;
};

const teamItem = (quantity: number): Partial<FakeItem> => ({
  quantity,
  price: { id: priceIdOf("team_monthly_seat"), lookup_key: "team_monthly_seat" },
});

const seats = (quantity: number) =>
  updateSubscriptionQuantity("sandbox", "sub_1", {
    priceExternalId: "team_monthly_seat",
    quantity,
  });

const changePlan = (lookupKey: string) =>
  changeSubscriptionPrice("sandbox", "sub_1", { newPriceExternalId: lookupKey });

const cancel = () => cancelSubscriptionAtPeriodEnd("sandbox", "sub_1");

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("zmniejsz -> cofnij -> zmniejsz w ciągu doby (przegląd #8)", () => {
  beforeEach(() => useFake(new FakeStripe({}, teamItem(10))));

  it("drugie zmniejszenie zakłada ŻYWY harmonogram zamiast dostać z pamięci zwolniony", async () => {
    expect(await seats(5)).toMatchObject({ ok: true, effect: "scheduled" });
    expect(fake.liveSchedule()?.phases[1]).toMatchObject({ items: [{ quantity: 5 }] });

    // Powrót do 10 zwalnia harmonogram - odcisk subskrypcji wraca do stanu
    // sprzed pierwszego zmniejszenia (zwolnienie nie zmienia subskrypcji).
    expect(await seats(10)).toMatchObject({ ok: true, effect: "applied" });
    expect(fake.liveSchedule()).toBeNull();

    const third = await seats(5);

    expect(third).toEqual({
      ok: true,
      quantity: 5,
      effect: "scheduled",
      effectiveAt: PERIOD_END_ISO,
    });
    // Bez potwierdzenia odczytem: `create` z pamięci (harmonogram zwolniony),
    // aktualizacja faz z pamięci (200) - wynik „zaplanowano", a odnowienie
    // po 10 miejscach. Teraz zmniejszenie naprawdę czeka u operatora.
    const live = fake.liveSchedule();
    expect(live).not.toBeNull();
    expect(live?.phases[1]).toMatchObject({ items: [{ quantity: 5 }] });
    expect(fake.log.filter((l) => l.startsWith("schedule.create"))).toEqual([
      "schedule.create:EXEC",
      "schedule.create:REPLAY",
      "schedule.create:EXEC",
    ]);
  });

  it("inny cel po cofnięciu (6) nie trafia w zwolniony harmonogram - zamiast błędu przez dobę jest plan", async () => {
    await seats(5);
    await seats(10);

    expect(await seats(6)).toMatchObject({ ok: true, effect: "scheduled" });
    expect(fake.liveSchedule()?.phases[1]).toMatchObject({ items: [{ quantity: 6 }] });
  });

  it("kolejne cykle w tej samej dobie łańcuchem trafiają w świeży harmonogram", async () => {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      expect(await seats(5)).toMatchObject({ ok: true, effect: "scheduled" });
      expect(fake.liveSchedule()?.phases[1]).toMatchObject({ items: [{ quantity: 5 }] });
      expect(await seats(10)).toMatchObject({ ok: true, effect: "applied" });
    }
    expect(await seats(5)).toMatchObject({ ok: true, effect: "scheduled" });
    expect(fake.liveSchedule()).not.toBeNull();
  });

  it("dwuklik tego samego zmniejszenia nie zakłada drugiego harmonogramu", async () => {
    await seats(5);
    const scheduleId = fake.sub.schedule;
    await seats(5);

    expect(fake.sub.schedule).toBe(scheduleId);
    expect(fake.log.filter((l) => l === "schedule.create:EXEC")).toHaveLength(1);
  });
});

describe("odrzucona dopłata NIE kasuje zaplanowanej wcześniej zmiany (przegląd #9/#41)", () => {
  it("upgrade z kartą odrzuconą zostawia zaplanowany downgrade - odnowienie po cenie, na którą klient się umówił", async () => {
    useFake(
      new FakeStripe({}, { price: { id: priceIdOf("pro_monthly"), lookup_key: "pro_monthly" } }),
    );
    expect(await changePlan("plus_monthly")).toMatchObject({ ok: true, effect: "scheduled" });
    const downgrade = fake.liveSchedule();
    expect(downgrade?.phases[1]).toMatchObject({ items: [{ price: priceIdOf("plus_monthly") }] });

    fake.declineNextPayment = true;
    expect(await changePlan("business_monthly")).toMatchObject({
      ok: false,
      error: PAYMENT_FAILED,
      hostedInvoiceUrl: HOSTED,
    });

    // Dawniej harmonogram był zwalniany PRZED dopłatą: wynik „zmiana nie
    // weszła", a odnowienie po Pro zamiast zaplanowanego Plus.
    expect(fake.liveSchedule()?.id).toBe(downgrade?.id);
    expect(fake.liveSchedule()?.phases[1]).toMatchObject({
      items: [{ price: priceIdOf("plus_monthly") }],
    });
    expect(fake.sub.items.data[0].price.lookup_key).toBe("pro_monthly");
  });

  it("dołożenie miejsc z kartą odrzuconą zostawia zaplanowane zmniejszenie", async () => {
    useFake(new FakeStripe({}, teamItem(10)));
    await seats(5);
    fake.declineNextPayment = true;

    expect(await seats(12)).toMatchObject({ ok: false, error: PAYMENT_FAILED });
    expect(fake.liveSchedule()?.phases[1]).toMatchObject({ items: [{ quantity: 5 }] });
    expect(fake.sub.items.data[0].quantity).toBe(10);
  });

  it("udana dopłata zwalnia zastąpiony harmonogram - opłacony upgrade nie wraca na koniec okresu", async () => {
    useFake(new FakeStripe({}, teamItem(10)));
    await seats(5);

    expect(await seats(12)).toEqual({ ok: true, quantity: 12, effect: "applied" });
    expect(fake.liveSchedule()).toBeNull();
    expect(fake.sub.items.data[0].quantity).toBe(12);
  });
});

describe("nieudana rezygnacja NIE kasuje zaplanowanej zmiany (przegląd #495, P1)", () => {
  /** Przejściowy błąd operatora (5xx) - zapamiętany pod kluczem jak u operatora. */
  const transient = () => stripeError("An unknown error occurred", "api_error");

  it("błąd flagi po zwolnieniu: zaplanowane zmniejszenie miejsc wraca, a ponowienie rezygnuje nowym kluczem", async () => {
    useFake(new FakeStripe({}, teamItem(10)));
    await seats(5);
    const released = fake.sub.schedule;
    fake.failNextUpdate = transient();

    expect(await cancel()).toEqual({
      ok: false,
      error: "An unknown error occurred (api_error)",
    });

    // Dawniej: harmonogram zwolniony, flaga nie weszła - odnowienie po 10
    // miejscach, choć ani rezygnacja, ani zmniejszenie nie weszły.
    const restored = fake.liveSchedule();
    expect(restored?.id).not.toBe(released);
    expect(restored?.phases).toEqual([
      expect.objectContaining({
        items: [{ price: priceIdOf("team_monthly_seat"), quantity: 10 }],
        end_date: PERIOD_END,
      }),
      expect.objectContaining({ items: [{ price: priceIdOf("team_monthly_seat"), quantity: 5 }] }),
    ]);
    expect(fake.sub).toMatchObject({ cancel_at_period_end: false, cancel_at: null });
    expect(fake.sub.items.data[0].quantity).toBe(10);

    // Stan po kompensacji ma inny odcisk (inny harmonogram), więc rezygnacja
    // idzie świeżym kluczem zamiast dostać z pamięci zapamiętane 5xx.
    expect(await cancel()).toEqual({ ok: true });
    expect(fake.sub.cancel_at_period_end).toBe(true);
    expect(fake.liveSchedule()).toBeNull();
    expect(fake.log.filter((l) => l.startsWith("sub.update"))).toEqual([
      "sub.update:EXEC",
      "sub.update:EXEC",
    ]);
  });

  it("błąd flagi przy zaplanowanym downgradzie: niższy plan wraca z rabatem - odnowienie po cenie, na którą klient się umówił", async () => {
    useFake(
      new FakeStripe(
        { discounts: ["di_promo"] },
        { price: { id: priceIdOf("pro_monthly"), lookup_key: "pro_monthly" } },
      ),
    );
    expect(await changePlan("plus_monthly")).toMatchObject({ ok: true, effect: "scheduled" });
    fake.failNextUpdate = transient();

    expect(await cancel()).toMatchObject({ ok: false });

    expect(fake.liveSchedule()?.phases[1]).toMatchObject({
      items: [{ price: priceIdOf("plus_monthly"), quantity: 1 }],
      discounts: [{ discount: "di_promo" }],
    });
    expect(fake.sub.items.data[0].price.lookup_key).toBe("pro_monthly");
    expect(fake.sub.cancel_at_period_end).toBe(false);
  });

  it("flaga weszła, a odpowiedź zginęła: harmonogramu NIE odtwarzamy - nie odwołałby rezygnacji", async () => {
    useFake(new FakeStripe({}, teamItem(10)));
    await seats(5);
    fake.loseResponseOf = "sub.update";

    expect(await cancel()).toMatchObject({ ok: false });

    // Kompensacja najpierw czyta żywy stan: koniec już zaplanowany, więc
    // nowy harmonogram z `end_behavior: release` byłby odnowieniem klienta,
    // który zrezygnował.
    expect(fake.sub.cancel_at_period_end).toBe(true);
    expect(fake.liveSchedule()).toBeNull();
    expect(fake.log.filter((l) => l === "schedule.create:EXEC")).toHaveLength(1);
    // Ponowienie trafia w „już się kończy" - bez drugiej mutacji.
    expect(await cancel()).toEqual({ ok: true });
    expect(fake.log.filter((l) => l.startsWith("sub.update"))).toEqual(["sub.update:EXEC"]);
  });

  it("zwolnienie weszło, a jego odpowiedź zginęła: zaplanowana zmiana też wraca", async () => {
    useFake(new FakeStripe({}, teamItem(10)));
    await seats(5);
    fake.loseResponseOf = "schedule.release";

    expect(await cancel()).toMatchObject({ ok: false });

    // Flaga nie poszła wcale, a harmonogram zniknął - ten sam stan co po
    // błędzie flagi, więc i ta sama kompensacja.
    expect(fake.liveSchedule()?.phases[1]).toMatchObject({ items: [{ quantity: 5 }] });
    expect(fake.sub.cancel_at_period_end).toBe(false);
    expect(fake.log.filter((l) => l.startsWith("sub.update"))).toEqual([]);
  });
});

describe("powrót do bieżącej liczby miejsc NIE kasuje zaplanowanej zmiany planu (przegląd #495, P1)", () => {
  /** Cena za miejsce, na którą operator przenosi subskrypcję od odnowienia (panel, migracja cennika). */
  const NEXT_PRICE = "price_team_monthly_seat_2027";

  it("sama zaplanowana zmiana ceny zostaje nietknięta", async () => {
    useFake(new FakeStripe({}, teamItem(10)));
    const scheduleId = fake.seedSchedule([{ price: NEXT_PRICE, quantity: 10 }]);

    expect(await seats(10)).toEqual({ ok: true, quantity: 10, effect: "applied" });

    // Dawniej: zwolnienie - ponowny zapis tej samej liczby miejsc i odnowienie
    // po starej cenie zamiast zaplanowanej.
    expect(fake.liveSchedule()?.id).toBe(scheduleId);
    expect(fake.liveSchedule()?.phases[1]).toMatchObject({
      items: [{ price: NEXT_PRICE, quantity: 10 }],
    });
    expect(fake.log.filter((l) => l.startsWith("schedule."))).toEqual([]);
  });

  it("zmiana ceny RAZEM ze zmniejszeniem miejsc: schodzi tylko zmniejszenie, nowa cena zostaje", async () => {
    useFake(new FakeStripe({}, teamItem(10)));
    const scheduleId = fake.seedSchedule([{ price: NEXT_PRICE, quantity: 5 }]);

    expect(await seats(10)).toEqual({ ok: true, quantity: 10, effect: "applied" });

    const live = fake.liveSchedule();
    expect(live?.id).toBe(scheduleId);
    expect(live?.phases).toEqual([
      expect.objectContaining({
        items: [{ price: priceIdOf("team_monthly_seat"), quantity: 10 }],
        start_date: PERIOD_START,
        end_date: PERIOD_END,
      }),
      expect.objectContaining({ items: [{ price: NEXT_PRICE, quantity: 10 }] }),
    ]);
    expect(fake.log).not.toContain("schedule.release:EXEC");
  });

  it("czysta zmiana miejsc z panelu (ta sama cena) jest zwalniana jak dotąd", async () => {
    useFake(new FakeStripe({}, teamItem(10)));
    fake.seedSchedule([{ price: priceIdOf("team_monthly_seat"), quantity: 7 }]);

    expect(await seats(10)).toEqual({ ok: true, quantity: 10, effect: "applied" });
    expect(fake.liveSchedule()).toBeNull();
  });
});

describe("zdarzenia z tej samej sekundy niosą stan opłaconej zmiany (przegląd #37)", () => {
  it("upgrade przy zaplanowanym downgradzie: KAŻDE zdarzenie po zmianie niesie nową cenę", async () => {
    useFake(
      new FakeStripe({}, { price: { id: priceIdOf("pro_monthly"), lookup_key: "pro_monthly" } }),
    );
    await changePlan("plus_monthly");
    fake.events.length = 0;

    expect(await changePlan("business_monthly")).toMatchObject({ ok: true, effect: "applied" });

    // Dawniej zwolnienie szło pierwsze i jego zdarzenie (stara cena) mogło
    // wygrać remis sekundy z opłaconą zmianą - plan i limit zostawały stare.
    expect(fake.events.length).toBeGreaterThan(0);
    expect(new Set(fake.events.map((e) => e.created)).size).toBe(1);
    expect(fake.events.map((e) => e.price)).toEqual(fake.events.map(() => "business_monthly"));
    expect(fake.events.at(-1)).toMatchObject({ schedule: null });
  });

  it("dołożenie miejsc przy zaplanowanym zmniejszeniu: żadne zdarzenie nie niesie starej liczby", async () => {
    useFake(new FakeStripe({}, teamItem(10)));
    await seats(5);
    fake.events.length = 0;

    await seats(12);

    expect(fake.events.map((e) => e.quantity)).toEqual(fake.events.map(() => 12));
  });

  it("upgrade subskrypcji kończącej się: JEDNO zdarzenie - nowa cena i cofnięty koniec razem", async () => {
    useFake(new FakeStripe({ cancel_at_period_end: true, cancel_at: PERIOD_END }));
    fake.events.length = 0;

    expect(await changePlan("pro_monthly")).toMatchObject({
      ok: true,
      effect: "applied",
      cancelAtPeriodEnd: false,
    });

    // Dawniej: zdarzenie A (nowa cena, wciąż „kończy się") i B (cofnięcie) -
    // przy remisie sekundy A wygrywało, lustro i przypomnienia mówiły
    // „wygasa", a operator odnawiał.
    expect(fake.events).toEqual([
      expect.objectContaining({ price: "pro_monthly", cancelScheduled: false }),
    ]);
    expect(fake.sub.cancel_at_period_end).toBe(false);
  });

  it("odrzucona dopłata za upgrade kończącej się subskrypcji NIE odwołuje rezygnacji", async () => {
    useFake(new FakeStripe({ cancel_at_period_end: true, cancel_at: PERIOD_END }));
    fake.declineNextPayment = true;

    expect(await changePlan("pro_monthly")).toMatchObject({ ok: false, error: PAYMENT_FAILED });
    expect(fake.sub.cancel_at_period_end).toBe(true);
  });
});

describe("przepisanie faz przenosi rabat, podatek i trial (przegląd #11)", () => {
  /** Rabat z kodu promocyjnego checkoutu, VAT i podatek automatyczny - świeża kopia na test. */
  const terms = (): Partial<FakeSub> => ({
    discounts: ["di_promo"],
    default_tax_rates: [{ id: "txr_vat" }],
    automatic_tax: { enabled: true, liability: { type: "self" }, disabled_reason: null },
  });

  it("zmniejszenie miejsc w trialu z kodem promocyjnym: obie fazy z rabatem, bieżąca z trialem", async () => {
    useFake(
      new FakeStripe(
        { ...terms(), status: "trialing", trial_end: PERIOD_END },
        { ...teamItem(10), tax_rates: [{ id: "txr_item" }], discounts: ["di_item"] },
      ),
    );

    expect(await seats(5)).toMatchObject({ ok: true, effect: "scheduled" });

    const [current, next] = fake.liveSchedule()?.phases ?? [];
    // Pominięte `discounts` = rabat KLIENTA (zwykle żaden): odnowienie po
    // pełnej cenie. Pominięty `trial_end` = faza płatna: koniec triala od razu.
    expect(current).toMatchObject({
      discounts: [{ discount: "di_promo" }],
      default_tax_rates: ["txr_vat"],
      automatic_tax: { enabled: true, liability: { type: "self" } },
      trial_end: PERIOD_END,
      items: [
        {
          price: priceIdOf("team_monthly_seat"),
          quantity: 10,
          tax_rates: ["txr_item"],
          discounts: [{ discount: "di_item" }],
        },
      ],
    });
    expect(next).toMatchObject({
      discounts: [{ discount: "di_promo" }],
      default_tax_rates: ["txr_vat"],
      automatic_tax: { enabled: true },
      items: [
        {
          price: priceIdOf("team_monthly_seat"),
          quantity: 5,
          tax_rates: ["txr_item"],
          discounts: [{ discount: "di_item" }],
        },
      ],
    });
    // Trial należy do bieżącej fazy - następna jest już płatna.
    expect(next).not.toHaveProperty("trial_end");
  });

  it("downgrade planu: rabat subskrypcji przechodzi do nowej ceny, rabat POZYCJI zostaje przy starej", async () => {
    useFake(
      new FakeStripe(terms(), {
        price: { id: priceIdOf("pro_monthly"), lookup_key: "pro_monthly" },
        discounts: ["di_item"],
      }),
    );

    await changePlan("plus_monthly");

    const [current, next] = fake.liveSchedule()?.phases ?? [];
    expect(current).toMatchObject({ discounts: [{ discount: "di_promo" }] });
    expect(next).toMatchObject({
      discounts: [{ discount: "di_promo" }],
      items: [{ price: priceIdOf("plus_monthly") }],
    });
    // Kupon pozycji bywa ograniczony do produktu - na innej cenie operator
    // odrzuciłby całą aktualizację faz.
    expect((next.items as Raw[])[0]).not.toHaveProperty("discounts");
  });
});

describe("wznowienie przy dacie końca `cancel_at` (przegląd #14)", () => {
  it("data końca z portalu jest zdejmowana - wynik „cofnięto”, operator już nie zakończy subskrypcji", async () => {
    useFake(new FakeStripe({ cancel_at: PERIOD_END }));

    expect(await resumeProviderSubscription("sandbox", "sub_1")).toEqual({
      ok: true,
      mode: "cancellation_reverted",
    });
    // Dawniej: pusty patch, `already_active`, UI „wznowiono", a operator
    // kończył subskrypcję w dniu `cancel_at`.
    expect(fake.sub.cancel_at).toBeNull();
    expect(fake.events.at(-1)).toMatchObject({ cancelScheduled: false });
  });

  it("downgrade przy dacie końca zdejmuje ją jawnie przed harmonogramem", async () => {
    useFake(
      new FakeStripe(
        { cancel_at: PERIOD_END },
        { price: { id: priceIdOf("pro_monthly"), lookup_key: "pro_monthly" } },
      ),
    );

    expect(await changePlan("plus_monthly")).toMatchObject({
      ok: true,
      effect: "scheduled",
      cancelAtPeriodEnd: false,
    });
    expect(fake.sub.cancel_at).toBeNull();
    expect(fake.liveSchedule()).not.toBeNull();
  });

  it("zmniejszenie miejsc subskrypcji, która się kończy, to odmowa - harmonogram nie odwoła rezygnacji", async () => {
    useFake(new FakeStripe({ cancel_at_period_end: true, cancel_at: PERIOD_END }, teamItem(10)));

    expect(await seats(5)).toEqual({ ok: false, error: "subscription_canceling" });
    expect(fake.schedules.size).toBe(0);
    expect(fake.sub.cancel_at_period_end).toBe(true);
  });
});

describe("pauza poboru operatora - samoobsługowe wznowienie (przegląd #10)", () => {
  it.each(["void", "uncollectible", "draft"])(
    "odnowienie w czasie pauzy (faktura %s): odmowa, pauza trwa - bez darmowego okresu",
    async (status) => {
      useFake(new FakeStripe({ pause_collection: { behavior: "void", resumes_at: null } }));
      fake.invoices.set("in_renewal", { id: "in_renewal", status, hosted_invoice_url: HOSTED });
      fake.sub.latest_invoice = "in_renewal";

      expect(await resumeProviderSubscription("sandbox", "sub_1")).toEqual({
        ok: false,
        error: PAUSED_BY_OPERATOR,
      });
      expect(fake.sub.pause_collection).not.toBeNull();
      expect(fake.log.filter((l) => l.startsWith("sub.update"))).toEqual([]);
    },
  );

  it("pauza w środku OPŁACONEGO okresu schodzi - klient ma dostęp, za który zapłacił", async () => {
    useFake(new FakeStripe({ pause_collection: { behavior: "keep_as_draft", resumes_at: null } }));

    expect(await resumeProviderSubscription("sandbox", "sub_1")).toEqual({
      ok: true,
      mode: "collection_resumed",
    });
    expect(fake.sub.pause_collection).toBeNull();
  });
});

describe("odrzucona dopłata opłacona PÓŹNIEJ - `pending_update_applied` (luka po #9/#41)", () => {
  /**
   * Webhook dostaje migawkę z chwili zastosowania - harmonogram jako
   * identyfikator i pozycje z cenami operatora (`price_...`).
   */
  const settle = (snapshot: Raw) => {
    const items = (snapshot.items as { data: FakeItem[] }).data;
    return reconcileScheduleWithAppliedUpdate("sandbox", "sub_1", {
      scheduleId: typeof snapshot.schedule === "string" ? snapshot.schedule : null,
      lines: items.map((item) => ({ price: item.price.id, quantity: item.quantity })),
    });
  };

  const upgradeDeclined = async () => {
    fake.declineNextPayment = true;
    expect(await changePlan("business_monthly")).toMatchObject({
      ok: false,
      error: PAYMENT_FAILED,
    });
  };

  const seatsDeclined = async () => {
    fake.declineNextPayment = true;
    expect(await seats(12)).toMatchObject({ ok: false, error: PAYMENT_FAILED });
  };

  const proFake = () =>
    new FakeStripe({}, { price: { id: priceIdOf("pro_monthly"), lookup_key: "pro_monthly" } });

  it.each([
    { name: "fazy nietknięte", splitPhase: false },
    // Strażnik projektu: bieżąca faza bywa już na nowych pozycjach także
    // w harmonogramie z odmowy, więc „bieżąca faza = opłacone pozycje" NIE
    // znaczy „przepisany po zastosowaniu" - o tym rozstrzyga `nes_basis`.
    { name: "operator podzielił bieżącą fazę", splitPhase: true },
  ])(
    "upgrade przy zaplanowanym downgradzie: zapłata w oknie zwalnia harmonogram, odnowienie po nowym planie ($name)",
    async ({ splitPhase }) => {
      useFake(proFake());
      expect(await changePlan("plus_monthly")).toMatchObject({ ok: true, effect: "scheduled" });
      const downgrade = fake.sub.schedule;
      await upgradeDeclined();

      const snapshot = fake.payPendingInvoice({ splitPhase });
      // Luka: operator zastosował upgrade, ale harmonogram z downgradem żyje -
      // bez zwolnienia odnowienie zeszłoby na Plus, a klient zapłacił za Business.
      expect(fake.sub.items.data[0].price.lookup_key).toBe("business_monthly");
      expect(snapshot.schedule).toBe(downgrade);
      expect(fake.liveSchedule()?.phases.at(-1)).toMatchObject({
        items: [{ price: priceIdOf("plus_monthly") }],
      });
      if (splitPhase) {
        expect(fake.liveSchedule()?.phases[1]).toMatchObject({
          items: [{ price: priceIdOf("business_monthly"), quantity: 1 }],
        });
      }

      expect(await settle(snapshot)).toBe("released");
      expect(fake.liveSchedule()).toBeNull();
      expect(fake.schedules.get(String(downgrade))?.status).toBe("released");

      fake.renew();
      expect(fake.sub.items.data[0].price.lookup_key).toBe("business_monthly");
    },
  );

  it("dołożenie miejsc przy zaplanowanym zmniejszeniu: zapłata w oknie - odnowienie na opłaconej liczbie miejsc", async () => {
    useFake(new FakeStripe({}, teamItem(10)));
    await seats(5);
    await seatsDeclined();

    const snapshot = fake.payPendingInvoice();
    expect(fake.sub.items.data[0].quantity).toBe(12);

    expect(await settle(snapshot)).toBe("released");
    fake.renew();
    expect(fake.sub.items.data[0].quantity).toBe(12);
  });

  it.each([
    {
      name: "przejście na dłuższy cykl z panelu (Business kwartalnie)",
      fakeFor: proFake,
      next: { price: priceIdOf("business_quarterly"), quantity: 1 },
      change: upgradeDeclined,
      renewed: { lookup_key: "business_quarterly", quantity: 1 },
    },
    {
      name: "zaplanowane w panelu 12 miejsc, dokupione od razu",
      fakeFor: () => new FakeStripe({}, teamItem(10)),
      next: { price: priceIdOf("team_monthly_seat"), quantity: 12 },
      change: seatsDeclined,
      renewed: { lookup_key: "team_monthly_seat", quantity: 12 },
    },
  ])("zgodny harmonogram zostaje nietknięty: $name", async ({ fakeFor, next, change, renewed }) => {
    useFake(fakeFor());
    const scheduleId = fake.seedSchedule([next]);
    await change();
    const snapshot = fake.payPendingInvoice();

    expect(await settle(snapshot)).toBe("kept");
    expect(fake.liveSchedule()?.id).toBe(scheduleId);
    expect(fake.liveSchedule()?.phases[1]).toMatchObject({ items: [next] });
    expect(fake.log.filter((l) => l.startsWith("schedule."))).toEqual([]);

    fake.renew();
    expect(fake.sub.items.data[0]).toMatchObject({
      price: { lookup_key: renewed.lookup_key },
      quantity: renewed.quantity,
    });
  });

  it("zmiana ceny z panelu i mniej miejsc: zostaje nowa cena, ilość wraca do opłaconej", async () => {
    const NEXT_PRICE = "price_team_monthly_seat_2027";
    useFake(new FakeStripe({}, teamItem(10)));
    const scheduleId = fake.seedSchedule([{ price: NEXT_PRICE, quantity: 10 }]);
    await seatsDeclined();

    expect(await settle(fake.payPendingInvoice())).toBe("rewritten");

    // Zwolnienie skasowałoby migrację ceny, której klient nie zmieniał -
    // jak przy powrocie do bieżącej liczby miejsc (`dropPendingSeatChange`).
    const live = fake.liveSchedule();
    expect(live?.id).toBe(scheduleId);
    expect(live?.phases).toEqual([
      expect.objectContaining({
        items: [{ price: priceIdOf("team_monthly_seat"), quantity: 12 }],
        end_date: PERIOD_END,
      }),
      expect.objectContaining({ items: [{ price: NEXT_PRICE, quantity: 12 }] }),
    ]);
    fake.renew();
    expect(fake.sub.items.data[0]).toMatchObject({ price: { id: NEXT_PRICE }, quantity: 12 });
  });

  it("harmonogram założony PO zastosowaniu zmiany to nowsza decyzja klienta - zostaje, bez pytania operatora", async () => {
    useFake(proFake());
    await upgradeDeclined();
    const snapshot = fake.payPendingInvoice();
    expect(snapshot.schedule).toBeNull();
    // Spóźniona dostawa (ponowienie webhooka): klient zdążył już zaplanować
    // downgrade z nowego planu.
    expect(await changePlan("plus_monthly")).toMatchObject({ ok: true, effect: "scheduled" });
    const later = fake.sub.schedule;
    const calls = fake.log.length;

    expect(await settle(snapshot)).toBe("not_attached");
    expect(fake.liveSchedule()?.id).toBe(later);
    expect(fake.log).toHaveLength(calls);
  });

  it("odnowienie zdążyło przed obsługą zdarzenia: pozycje już nie te z migawki - harmonogram nietknięty", async () => {
    useFake(proFake());
    await changePlan("plus_monthly");
    await upgradeDeclined();
    const snapshot = fake.payPendingInvoice();
    fake.renew();
    const scheduleId = fake.sub.schedule;

    // Zwolnienie po fakcie nie przywróci opłaconego planu, a pozycje opisuje
    // już inna (późniejsza) chwila - nie działamy na nieaktualnej migawce.
    expect(await settle(snapshot)).toBe("superseded");
    expect(fake.liveSchedule()?.id).toBe(scheduleId);
    expect(fake.log.filter((l) => l.startsWith("schedule.release"))).toEqual([]);
  });

  it("odmowa operatora przy zwolnieniu: wyjątek (webhook ponowi), ponowienie zwalnia", async () => {
    useFake(proFake());
    await changePlan("plus_monthly");
    await upgradeDeclined();
    const snapshot = fake.payPendingInvoice();
    fake.rejectNextRelease = stripeError(
      "Too many requests",
      "invalid_request_error",
      "rate_limit",
    );

    await expect(settle(snapshot)).rejects.toThrow(/Too many requests/);
    // Harmonogram żyje - błąd nie może zniknąć jako „przetworzone".
    expect(fake.liveSchedule()).not.toBeNull();

    expect(await settle(snapshot)).toBe("released");
    expect(fake.liveSchedule()).toBeNull();
    expect(fake.log.filter((l) => l.startsWith("schedule.release"))).toEqual([
      "schedule.release:REJECTED",
      "schedule.release:EXEC",
    ]);
  });

  // Okno ponowień (5xx, limit zapytań, ponowienie z panelu): klient planuje
  // NOWĄ zmianę już z opłaconego planu, a aplikacja przepisuje fazy
  // dołączonego harmonogramu w miejscu - identyfikator ten sam co w migawce.
  // Ponowienie nie może zwolnić tej nowszej decyzji.
  it.each([
    { name: "fazy nietknięte", splitPhase: false },
    { name: "operator podzielił bieżącą fazę", splitPhase: true },
  ])(
    "ponowienie po błędzie NIE zwalnia downgrade'u zaplanowanego już z nowego planu w tym samym harmonogramie ($name)",
    async ({ splitPhase }) => {
      useFake(proFake());
      await changePlan("plus_monthly");
      const scheduleId = fake.sub.schedule;
      await upgradeDeclined();
      const snapshot = fake.payPendingInvoice({ splitPhase });
      fake.rejectNextRelease = stripeError(
        "Too many requests",
        "invalid_request_error",
        "rate_limit",
      );
      await expect(settle(snapshot)).rejects.toThrow(/Too many requests/);

      expect(await changePlan("pro_monthly")).toMatchObject({ ok: true, effect: "scheduled" });
      expect(fake.sub.schedule).toBe(scheduleId);
      expect(fake.liveSchedule()?.phases.at(-1)).toMatchObject({
        items: [{ price: priceIdOf("pro_monthly") }],
      });

      expect(await settle(snapshot)).toBe("superseded");
      expect(fake.liveSchedule()?.id).toBe(scheduleId);
      expect(fake.log.filter((l) => l.startsWith("schedule.release"))).toEqual([
        "schedule.release:REJECTED",
      ]);

      fake.renew();
      expect(fake.sub.items.data[0].price.lookup_key).toBe("pro_monthly");
    },
  );

  it("ponowienie po błędzie NIE zwalnia zmniejszenia miejsc zaplanowanego już od opłaconej liczby", async () => {
    useFake(new FakeStripe({}, teamItem(10)));
    await seats(5);
    const scheduleId = fake.sub.schedule;
    await seatsDeclined();
    const snapshot = fake.payPendingInvoice();
    fake.rejectNextRelease = stripeError(
      "Too many requests",
      "invalid_request_error",
      "rate_limit",
    );
    await expect(settle(snapshot)).rejects.toThrow(/Too many requests/);

    // Klient ma już 12 opłaconych miejsc i planuje 8 od odnowienia.
    expect(await seats(8)).toMatchObject({ ok: true, quantity: 8, effect: "scheduled" });
    expect(fake.sub.schedule).toBe(scheduleId);

    expect(await settle(snapshot)).toBe("superseded");
    expect(fake.liveSchedule()?.phases[1]).toMatchObject({ items: [{ quantity: 8 }] });

    fake.renew();
    expect(fake.sub.items.data[0].quantity).toBe(8);
  });

  it("zwolnienie weszło, a odpowiedź zginęła: wyjątek, a ponowienie widzi zwolniony harmonogram", async () => {
    useFake(new FakeStripe({}, teamItem(10)));
    await seats(5);
    await seatsDeclined();
    const snapshot = fake.payPendingInvoice();
    fake.loseResponseOf = "schedule.release";

    await expect(settle(snapshot)).rejects.toThrow(/Connection reset/);
    expect(fake.liveSchedule()).toBeNull();

    expect(await settle(snapshot)).toBe("not_attached");
    expect(fake.log.filter((l) => l.startsWith("schedule.release"))).toEqual([
      "schedule.release:EXEC",
    ]);
  });
});

describe("data końca `cancel_at` przy upgradzie opłaconym PÓŹNIEJ - zdjęta tylko niezmieniona (luka po #502)", () => {
  /** Klient ustawił koniec datą (portal „anuluj z końcem okresu”, panel) godzinę przed upgradem. */
  const CANCEL_SET_AT = PERIOD_START;
  const DAY = 86_400;

  /** Plus kończący się datą `cancel_at` = koniec okresu. */
  const endingOnDate = (item: Partial<FakeItem> = {}) =>
    new FakeStripe({ cancel_at: PERIOD_END, canceled_at: CANCEL_SET_AT }, item);

  /** Znacznik z chwili prośby o upgrade na fakturze oczekującej zmiany. */
  const MARKER = {
    nes_upgrade_cancel_at: String(PERIOD_END),
    nes_upgrade_canceled_at: String(CANCEL_SET_AT),
    nes_upgrade_price: priceIdOf("pro_monthly"),
  };

  /**
   * Webhook dostaje migawkę z chwili zastosowania: datę i fakturę jako
   * identyfikator. Zegar aplikacji = zegar operatora (okno od zapłaty).
   */
  const clearDate = (snapshot: Raw) => {
    vi.setSystemTime(fake.nowMs());
    return clearCancelDateAfterAppliedUpgrade("sandbox", "sub_1", {
      invoiceId: typeof snapshot.latest_invoice === "string" ? snapshot.latest_invoice : null,
      cancelAt: snapshot.cancel_at as number,
    });
  };

  // Każda zostawiona data to głośny log (klient zapłacił, a subskrypcja się skończy).
  let warned: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Oczekująca zmiana spoza prośby o upgrade (więcej miejsc, np. z panelu) z własną fakturą. */
  const foreignPendingUpdate = async () => {
    fake.declineNextPayment = true;
    await fake.client().subscriptions.update("sub_1", {
      items: [{ id: "si_1", quantity: 2 }],
      proration_behavior: "always_invoice",
      payment_behavior: "pending_if_incomplete",
    });
    return String(fake.sub.latest_invoice);
  };

  const pendingInvoice = () => fake.invoices.get(String(fake.sub.latest_invoice));
  const mutations = () =>
    fake.log.filter(
      (l) => /^(sub|invoice)\.update:(EXEC|REPLAY)$/.test(l) || l === "portal.update:EXEC",
    );

  const upgradeDeclined = async (
    decline: true | "requires_action" | "thrown" | "thrown_unchanged" = true,
    error: string = PAYMENT_FAILED,
  ) => {
    fake.declineNextPayment = decline;
    expect(await changePlan("pro_monthly")).toEqual({
      ok: false,
      error,
      hostedInvoiceUrl: HOSTED,
    });
  };

  it.each([
    { name: "odmowa karty", decline: true as const, error: PAYMENT_FAILED },
    // Zwykła droga kart z UE: dopłata czeka na potwierdzenie, klient kończy je na stronie faktury.
    {
      name: "3DS (`requires_action`)",
      decline: "requires_action" as const,
      error: PAYMENT_REQUIRES_ACTION,
    },
    { name: "odmowa RZUCONA przez operatora", decline: "thrown" as const, error: PAYMENT_FAILED },
  ])(
    "$name -> zapłata w oknie: data z chwili prośby schodzi, odnowienie na opłaconym planie",
    async ({ decline, error }) => {
      useFake(endingOnDate());
      await upgradeDeclined(decline, error);

      // Odmowa niczego nie odwołuje: data zostaje, a na fakturze zmiany jest znacznik.
      expect(fake.sub).toMatchObject({ cancel_at: PERIOD_END, canceled_at: CANCEL_SET_AT });
      expect(pendingInvoice()?.metadata).toEqual(MARKER);

      fake.tick(600);
      const snapshot = fake.payPendingInvoice();
      expect(fake.sub.items.data[0].price.lookup_key).toBe("pro_monthly");
      expect(snapshot.cancel_at).toBe(PERIOD_END);

      expect(await clearDate(snapshot)).toBe("cleared");
      // Dawniej: data zostawała, a operator kończył opłaconą subskrypcję w jej dniu.
      expect(fake.sub).toMatchObject({ cancel_at: null, cancel_at_period_end: false });
      expect(fake.events.at(-1)).toMatchObject({ price: "pro_monthly", cancelScheduled: false });

      // Ponowienie zdarzenia po zdjęciu: żywy stan bez daty - bez drugiej mutacji.
      const calls = mutations().length;
      expect(await clearDate(snapshot)).toBe("not_scheduled");
      expect(mutations()).toHaveLength(calls);

      fake.renew();
      expect(fake.sub.status).toBe("active");
      expect(fake.sub.items.data[0].price.lookup_key).toBe("pro_monthly");
    },
  );

  it("klient zmienia datę po odmowie: nowa data zostaje", async () => {
    useFake(endingOnDate());
    await upgradeDeclined();
    fake.tick(60);
    fake.customer({ cancel_at: PERIOD_END - DAY });
    const snapshot = fake.payPendingInvoice();
    const calls = mutations().length;

    expect(await clearDate(snapshot)).toBe("kept_changed");
    expect(fake.sub.cancel_at).toBe(PERIOD_END - DAY);
    expect(mutations()).toHaveLength(calls);
    expect(warned).toHaveBeenCalledWith(
      "[payments] pending update paid later, cancel date kept",
      "kept_changed",
      "sub_1",
      expect.stringContaining(`"markedCancelAt":"${PERIOD_END}"`),
    );

    fake.renew();
    expect(fake.sub.status).toBe("canceled");
  });

  it("klient ponownie ustawia TĘ SAMĄ datę po odmowie (wznów i anuluj w portalu): zostaje", async () => {
    useFake(endingOnDate());
    await upgradeDeclined();
    fake.tick(60);
    fake.customer({ cancel_at: "" });
    fake.tick(60);
    fake.customer({ cancel_at: PERIOD_END });
    const snapshot = fake.payPendingInvoice();
    // Ta sama data co w znaczniku - odróżnia ją wyłącznie nowsze `canceled_at`.
    expect(snapshot.cancel_at).toBe(PERIOD_END);
    expect(fake.sub.canceled_at).toBeGreaterThan(CANCEL_SET_AT);

    expect(await clearDate(snapshot)).toBe("kept_changed");
    expect(fake.sub.cancel_at).toBe(PERIOD_END);
    fake.renew();
    expect(fake.sub.status).toBe("canceled");
  });

  it("klient przechodzi na flagę „z końcem okresu” po zastosowaniu zmiany, przed obsługą zdarzenia: flaga zostaje", async () => {
    useFake(endingOnDate());
    await upgradeDeclined();
    const snapshot = fake.payPendingInvoice();
    fake.tick(60);
    fake.customer({ cancel_at_period_end: true });

    expect(await clearDate(snapshot)).toBe("kept_changed");
    expect(fake.sub).toMatchObject({ cancel_at_period_end: true, cancel_at: PERIOD_END });
  });

  it.each([
    { name: "odmowa zwrócona", decline: true as const },
    { name: "odmowa RZUCONA", decline: "thrown" as const },
  ])(
    "$name, nieudany zapis znacznika: wynik odmowy bez zmian (link do faktury), log z fakturą, a po zapłacie data zostaje",
    async ({ decline }) => {
      useFake(endingOnDate());
      fake.failNextInvoiceUpdate = stripeError("An unknown error occurred", "api_error");
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});

      await upgradeDeclined(decline);
      // Faktura, której znacznik trzeba dopisać ręcznie - także przy odmowie
      // rzuconej, gdzie odczytujemy ją dopiero z żywej subskrypcji.
      expect(fake.sub.latest_invoice).toMatch(/^in_\d+$/);
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining("cancel date marker not written"),
        "sub_1",
        fake.sub.latest_invoice,
        expect.any(String),
      );
      expect(pendingInvoice()?.metadata).toEqual({});

      const snapshot = fake.payPendingInvoice();
      expect(await clearDate(snapshot)).toBe("not_marked");
      expect(fake.sub.cancel_at).toBe(PERIOD_END);
    },
  );

  it("data bez `canceled_at`: bez znacznika - ponownego ustawienia nie dałoby się odróżnić", async () => {
    useFake(new FakeStripe({ cancel_at: PERIOD_END, canceled_at: null }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await upgradeDeclined();
    expect(fake.log.filter((l) => l.startsWith("invoice."))).toEqual([]);
    expect(pendingInvoice()?.metadata).toEqual({});

    const snapshot = fake.payPendingInvoice();
    expect(await clearDate(snapshot)).toBe("not_marked");
    expect(fake.sub.cancel_at).toBe(PERIOD_END);
  });

  it("odmowa RZUCONA bez oczekującej zmiany: nic do znakowania, bez zapisu faktury i bez alarmu", async () => {
    useFake(endingOnDate());
    fake.declineNextPayment = "thrown_unchanged";
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await changePlan("pro_monthly")).toEqual({
      ok: false,
      error: PAYMENT_FAILED,
      hostedInvoiceUrl: null,
    });
    // Żadna późniejsza zapłata niczego tu nie zastosuje - log „data zostanie" byłby fałszywy.
    expect(logged).not.toHaveBeenCalled();
    expect(fake.log.filter((l) => l.startsWith("invoice."))).toEqual([]);
    expect(fake.invoices.get("in_period")?.metadata).toBeUndefined();
    expect(fake.sub).toMatchObject({ cancel_at: PERIOD_END, pending_update: null });
  });

  it("odmowa RZUCONA przy wcześniejszej oczekującej zmianie spoza prośby: bez znacznika, jej zapłata nie zdejmuje daty", async () => {
    useFake(endingOnDate());
    const earlier = await foreignPendingUpdate();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    // Operator rzuca odmowę, a oczekuje wciąż zmiana sprzed prośby.
    await upgradeDeclined("thrown_unchanged");
    expect(fake.sub.latest_invoice).toBe(earlier);
    expect(fake.log).not.toContain("invoice.update:EXEC");
    expect(fake.invoices.get(earlier)?.metadata).toEqual({});
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("cancel date marker not written"),
      "sub_1",
      null,
      "pending update does not carry the requested price",
    );

    // Dawniej: znacznik trafiał na fakturę dołożenia miejsc, a jej zapłata zdejmowała datę.
    const snapshot = fake.payPendingInvoice();
    expect(fake.sub.items.data[0]).toMatchObject({
      quantity: 2,
      price: { lookup_key: "plus_monthly" },
    });
    expect(await clearDate(snapshot)).toBe("not_marked");
    expect(fake.sub.cancel_at).toBe(PERIOD_END);
    fake.renew();
    expect(fake.sub.status).toBe("canceled");
  });

  it("pełny znacznik na fakturze zmiany innej niż upgrade z prośby (cena po zastosowaniu nie ta): data zostaje", async () => {
    useFake(endingOnDate());
    await foreignPendingUpdate();
    Object.assign(pendingInvoice() ?? {}, { metadata: { ...MARKER } });
    const snapshot = fake.payPendingInvoice();
    const calls = mutations().length;

    expect(await clearDate(snapshot)).toBe("kept_unverified");
    expect(fake.sub.cancel_at).toBe(PERIOD_END);
    expect(mutations()).toHaveLength(calls);
    expect(warned).toHaveBeenCalledWith(
      "[payments] pending update paid later, cancel date kept",
      "kept_unverified",
      "sub_1",
      expect.stringContaining(`"livePrice":"${priceIdOf("plus_monthly")}"`),
    );
  });

  it.each([
    {
      name: "faktura odnowienia (`subscription_cycle`), nie zmiany",
      tamper: () => Object.assign(pendingInvoice() ?? {}, { billing_reason: "subscription_cycle" }),
    },
    {
      name: "faktura innej subskrypcji",
      tamper: () => Object.assign(pendingInvoice() ?? {}, { subscription: "sub_other" }),
    },
    {
      name: "subskrypcja zaległa (`past_due`)",
      tamper: () => Object.assign(fake.sub, { status: "past_due" }),
    },
    {
      name: "faktura zmiany nieopłacona (`open`)",
      tamper: () => Object.assign(pendingInvoice() ?? {}, { status: "open" }),
    },
  ])("$name: znacznik się zgadza, ale data zostaje (`kept_unverified`)", async ({ tamper }) => {
    useFake(endingOnDate());
    await upgradeDeclined();
    const snapshot = fake.payPendingInvoice();
    tamper();
    const calls = mutations().length;

    expect(await clearDate(snapshot)).toBe("kept_unverified");
    expect(fake.sub.cancel_at).toBe(PERIOD_END);
    expect(mutations()).toHaveLength(calls);
  });

  it.each([
    // Ponowienia operatora (do 3 dni) i naprawa z panelu w tym oknie zdejmują datę.
    { name: "tuż przed końcem okna ponowień", delay: 3 * DAY - 60, outcome: "cleared" },
    // Później klient od dawna widzi „kończy się" i mógł ten koniec przyjąć.
    { name: "po oknie ponowień (naprawa z panelu)", delay: 3 * DAY + 60, outcome: "kept_stale" },
  ])("obsługa zdarzenia $name od zapłaty: $outcome", async ({ delay, outcome }) => {
    useFake(endingOnDate());
    await upgradeDeclined();
    const snapshot = fake.payPendingInvoice();
    fake.tick(delay);

    expect(await clearDate(snapshot)).toBe(outcome);
    expect(fake.sub.cancel_at).toBe(outcome === "cleared" ? null : PERIOD_END);
  });

  it.each([
    { name: "opłacony od razu", decline: false },
    { name: "opłacony później", decline: true },
  ])(
    "upgrade ze zmianą interwału, $name: zdjęcie daty przedłuża okres - log o proracji czekającej na następną fakturę",
    async ({ decline }) => {
      useFake(endingOnDate());
      // Okres nowej ceny kończy się w dniu daty; bez niej - po roku od zmiany.
      fake.uncappedPeriodEnd = PERIOD_START + 3_600 + 365 * DAY;
      fake.declineNextPayment = decline;
      const result = await changePlan("plus_annual");

      if (decline) {
        expect(result).toMatchObject({ ok: false, error: PAYMENT_FAILED });
        expect(await clearDate(fake.payPendingInvoice())).toBe("cleared");
      } else {
        expect(result).toMatchObject({ ok: true, cancelAtPeriodEnd: false });
      }
      expect(fake.sub.cancel_at).toBeNull();
      expect(warned).toHaveBeenCalledWith(
        "[payments] cancel date removed, current period extended - its proration waits for the next invoice",
        "sub_1",
        PERIOD_END,
        fake.uncappedPeriodEnd,
      );
    },
  );

  it("oczekująca zmiana spoza aplikacji (panel operatora): faktura bez znacznika - data zostaje", async () => {
    useFake(endingOnDate());
    fake.declineNextPayment = true;
    await fake.client().subscriptions.update("sub_1", {
      items: [{ id: "si_1", price: priceIdOf("pro_monthly"), quantity: 1 }],
      proration_behavior: "always_invoice",
      payment_behavior: "pending_if_incomplete",
    });
    const snapshot = fake.payPendingInvoice();

    expect(await clearDate(snapshot)).toBe("not_marked");
    expect(fake.sub.cancel_at).toBe(PERIOD_END);
  });

  it("dołożenie miejsc przy dacie końca: zapłata później NIE zdejmuje daty - więcej miejsc to nie „zostaję”", async () => {
    useFake(endingOnDate(teamItem(10)));
    fake.declineNextPayment = true;

    expect(await seats(12)).toMatchObject({ ok: false, error: PAYMENT_FAILED });
    expect(fake.log).not.toContain("invoice.update:EXEC");
    const snapshot = fake.payPendingInvoice();
    expect(fake.sub.items.data[0].quantity).toBe(12);

    expect(await clearDate(snapshot)).toBe("not_marked");
    expect(fake.sub.cancel_at).toBe(PERIOD_END);
  });

  it("zaplanowany koniec FLAGĄ: bez znacznika - flaga jedzie w oczekującej zmianie jak dotąd", async () => {
    useFake(
      new FakeStripe({
        cancel_at_period_end: true,
        cancel_at: PERIOD_END,
        canceled_at: CANCEL_SET_AT,
      }),
    );
    await upgradeDeclined();

    expect(fake.log.filter((l) => l.startsWith("invoice."))).toEqual([]);
    expect(pendingInvoice()?.metadata).toEqual({});
    expect(fake.sub.pending_update).toMatchObject({
      subscription_items: [{ price: priceIdOf("pro_monthly") }],
    });
    expect(fake.sub.cancel_at_period_end).toBe(true);
  });

  it("odmowa operatora przy zdjęciu: wyjątek (webhook ponowi), ponowienie zdejmuje", async () => {
    useFake(endingOnDate());
    await upgradeDeclined();
    const snapshot = fake.payPendingInvoice();
    fake.rejectNextUpdate = stripeError("Too many requests", "invalid_request_error", "rate_limit");

    await expect(clearDate(snapshot)).rejects.toThrow(/Too many requests/);
    // Błąd nie może zniknąć jako „przetworzone" - data wciąż jest, zdarzenie wróci.
    expect(fake.sub.cancel_at).toBe(PERIOD_END);

    expect(await clearDate(snapshot)).toBe("cleared");
    expect(fake.sub.cancel_at).toBeNull();
    expect(fake.log.filter((l) => l.startsWith("sub.update"))).toEqual([
      "sub.update:EXEC",
      "sub.update:REJECTED",
      "sub.update:EXEC",
    ]);
  });

  it("zapamiętany 5xx zdjęcia, potem inna operacja (licznik `nes_ops_rev`): ponowienie idzie nowym kluczem i zdejmuje", async () => {
    useFake(endingOnDate());
    await upgradeDeclined();
    const snapshot = fake.payPendingInvoice();
    fake.failNextUpdate = stripeError("An unknown error occurred", "api_error");

    await expect(clearDate(snapshot)).rejects.toThrow(/unknown error/);
    expect(fake.sub.cancel_at).toBe(PERIOD_END);

    // Inna operacja aplikacji podbija licznik, nie ruszając daty ani `canceled_at`.
    // Dawniej klucz go pomijał: ponowienie trafiało w zapamiętany błąd (u operatora
    // - odmowa za ten sam klucz z innymi parametrami) aż do wygaśnięcia klucza.
    const revision = Number.parseInt(fake.sub.metadata.nes_ops_rev ?? "0", 10);
    fake.sub.metadata.nes_ops_rev = String(revision + 1);

    expect(await clearDate(snapshot)).toBe("cleared");
    expect(fake.sub.cancel_at).toBeNull();
  });

  it("zdjęcie weszło, a odpowiedź zginęła: wyjątek, a ponowienie widzi brak daty - bez drugiej mutacji", async () => {
    useFake(endingOnDate());
    await upgradeDeclined();
    const snapshot = fake.payPendingInvoice();
    fake.loseResponseOf = "sub.update";

    await expect(clearDate(snapshot)).rejects.toThrow(/Connection reset/);
    expect(fake.sub.cancel_at).toBeNull();

    expect(await clearDate(snapshot)).toBe("not_scheduled");
    expect(fake.log.filter((l) => l.startsWith("sub.update"))).toEqual([
      "sub.update:EXEC",
      "sub.update:EXEC",
    ]);
  });

  it("subskrypcja już zakończona: nic do zdjęcia, bez mutacji", async () => {
    useFake(endingOnDate());
    await upgradeDeclined();
    const snapshot = fake.payPendingInvoice();
    fake.sub.status = "canceled";
    const calls = fake.log.length;

    expect(await clearDate(snapshot)).toBe("ended");
    expect(fake.log).toHaveLength(calls);
  });

  it("datą steruje dołączony harmonogram: zostaje - należy do harmonogramu", async () => {
    useFake(endingOnDate());
    await upgradeDeclined();
    const snapshot = fake.payPendingInvoice();
    fake.seedSchedule([{ price: priceIdOf("pro_monthly"), quantity: 1 }]);

    expect(await clearDate(snapshot)).toBe("kept_schedule");
    expect(fake.sub.cancel_at).toBe(PERIOD_END);
  });

  it("faktura zmiany jeszcze nieopłacona (zdarzenie spoza kolejności, odtworzenie): data zostaje", async () => {
    useFake(endingOnDate());
    await upgradeDeclined();

    expect(
      await clearDate({ latest_invoice: fake.sub.latest_invoice, cancel_at: PERIOD_END }),
    ).toBe("kept_unverified");
    expect(fake.sub.cancel_at).toBe(PERIOD_END);
  });
});
