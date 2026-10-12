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
// webhooka po sekundach może przepuścić dowolną z nich).
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  invoices = new Map<string, { id: string; status: string; hosted_invoice_url: string }>();
  /** Pamięć kluczy idempotencji: klucz -> zapamiętana odpowiedź albo błąd. */
  private cache = new Map<string, { value?: unknown; error?: unknown }>();
  /** Dziennik wywołań: `nazwa:EXEC` (wykonane) albo `nazwa:REPLAY` (z pamięci). */
  log: string[] = [];
  events: SubscriptionEvent[] = [];
  /** Następna dopłata (`pending_if_incomplete`) zostanie odrzucona. */
  declineNextPayment = false;
  private seq = 0;
  private readonly now = PERIOD_START + 3_600;

  constructor(over: Partial<FakeSub> = {}, item: Partial<FakeItem> = {}) {
    this.sub = {
      id: "sub_1",
      object: "subscription",
      status: "active",
      customer: "cus_1",
      cancel_at_period_end: false,
      cancel_at: null,
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
    });
  }

  /** Harmonogram dołączony do subskrypcji, o ile wciąż steruje nią operator. */
  liveSchedule(): FakeSchedule | null {
    const s = this.sub.schedule ? this.schedules.get(this.sub.schedule) : undefined;
    return s && (s.status === "active" || s.status === "not_started") ? s : null;
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
      out.latest_invoice = { ...clone(this.invoices.get(this.sub.latest_invoice)), payments: { data: [] } };
    }
    return out;
  }

  private newInvoice(status: string): string {
    const id = this.nextId("in");
    this.invoices.set(id, { id, status, hosted_invoice_url: HOSTED });
    this.sub.latest_invoice = id;
    return id;
  }

  private applyCancellation(params: Raw): void {
    if (params.cancel_at_period_end === true) {
      this.sub.cancel_at_period_end = true;
      this.sub.cancel_at = this.sub.items.data[0].current_period_end;
    } else if (params.cancel_at_period_end === false) {
      this.sub.cancel_at_period_end = false;
      this.sub.cancel_at = null;
    }
    if (params.cancel_at === "") this.sub.cancel_at = null;
    else if (typeof params.cancel_at === "number") this.sub.cancel_at = params.cancel_at;
  }

  client(): Stripe {
    const self = this;
    return {
      prices: {
        list: async (p: { lookup_keys: string[] }) => ({
          data: p.lookup_keys.map((k) => ({ id: priceIdOf(k) })),
        }),
      },
      paymentIntents: { retrieve: async () => ({ status: "requires_payment_method" }) },
      subscriptions: {
        retrieve: async (_id: string, p?: { expand?: string[] }) => self.view(p?.expand ?? []),
        update: async (_id: string, params: Raw, opts?: { idempotencyKey?: string }) =>
          self.idem("sub.update", opts?.idempotencyKey, () => {
            const touchesCancel = "cancel_at_period_end" in params || "cancel_at" in params;
            if (touchesCancel && self.sub.schedule) {
              throw stripeError(
                "The subscription is managed by the subscription schedule, and updating any cancelation behavior directly is not allowed.",
                "invalid_request_error",
              );
            }
            const items = params.items as { id: string; price?: string; quantity?: number }[] | undefined;
            if (items && params.payment_behavior === "pending_if_incomplete" && self.declineNextPayment) {
              self.declineNextPayment = false;
              self.newInvoice("open");
              // Nic nie weszło: ani pozycje, ani pola wysłane razem z nimi.
              self.sub.pending_update = { subscription_items: items, expires_at: PERIOD_END };
              self.emit();
              return self.view(["latest_invoice"]);
            }
            if (items) {
              const item = self.sub.items.data[0];
              const next = items[0];
              if (next.price) item.price = { id: next.price, lookup_key: lookupKeyOf(next.price) };
              if (next.quantity) item.quantity = next.quantity;
              self.newInvoice("paid");
            }
            self.applyCancellation(params);
            if (params.pause_collection === "") self.sub.pause_collection = null;
            if (params.metadata) Object.assign(self.sub.metadata, params.metadata);
            self.emit();
            return self.view(items ? ["latest_invoice"] : []);
          }),
        resume: async () => self.view(),
      },
      subscriptionSchedules: {
        create: async (params: { from_subscription: string }, opts?: { idempotencyKey?: string }) =>
          self.idem("schedule.create", opts?.idempotencyKey, () => {
            if (self.sub.schedule) {
              throw stripeError("You cannot migrate a subscription that is already attached to a schedule.", "invalid_request_error");
            }
            const item = self.sub.items.data[0];
            const schedule: FakeSchedule = {
              id: self.nextId("sched"),
              object: "subscription_schedule",
              status: "active",
              subscription: params.from_subscription,
              metadata: {},
              end_behavior: "release",
              current_phase: { start_date: item.current_period_start, end_date: item.current_period_end },
              phases: [
                {
                  start_date: item.current_period_start,
                  end_date: item.current_period_end,
                  items: [{ price: item.price.id, quantity: item.quantity }],
                  discounts: self.sub.discounts.map((d) => ({ discount: d })),
                  trial_end: self.sub.trial_end,
                },
              ],
            };
            self.schedules.set(schedule.id, schedule);
            self.sub.schedule = schedule.id;
            self.emit();
            return schedule;
          }),
        retrieve: async (id: string) => clone(self.schedules.get(id)),
        update: async (id: string, params: Raw, opts?: { idempotencyKey?: string }) =>
          self.idem("schedule.update", opts?.idempotencyKey, () => {
            const schedule = self.schedules.get(id);
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
        release: async (id: string, _p: Raw, opts?: { idempotencyKey?: string }) =>
          self.idem("schedule.release", opts?.idempotencyKey, () => {
            const schedule = self.schedules.get(id);
            if (!schedule || schedule.status !== "active") {
              throw stripeError("You cannot release this schedule.", "invalid_request_error");
            }
            schedule.status = "released";
            schedule.subscription = null;
            self.sub.schedule = null;
            self.emit();
            return schedule;
          }),
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
  changeSubscriptionPrice,
  PAUSED_BY_OPERATOR,
  PAYMENT_FAILED,
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

    expect(third).toEqual({ ok: true, quantity: 5, effect: "scheduled", effectiveAt: PERIOD_END_ISO });
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
  const terms = {
    discounts: ["di_promo"],
    default_tax_rates: [{ id: "txr_vat" }],
    automatic_tax: { enabled: true, liability: { type: "self" }, disabled_reason: null },
  } as const;

  it("zmniejszenie miejsc w trialu z kodem promocyjnym: obie fazy z rabatem, bieżąca z trialem", async () => {
    useFake(
      new FakeStripe(
        { ...clone(terms), status: "trialing", trial_end: PERIOD_END },
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
      new FakeStripe(clone(terms), {
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
