// Weryfikacja end-to-end webhooka operatora płatności: każde zdarzenie stanu
// (pauza, wznowienie, zaległość, nowy okres, rezygnacja) musi domknąć CZTERY
// warstwy odczytu, z których korzysta reszta platformy:
//   1. `subscriptions`      -> /admin/billing (zakładki subskrypcji i webhooków),
//   2. `user_subscriptions` -> uprawnienia (`has_content_access`), profil,
//                              /admin/users i widgety z gatingiem,
//   3. `crm_leads`          -> lejek CRM,
//   4. `notifications`      -> dzwonek w aplikacji.
// Test jedzie realną ścieżką handlera; wymieniamy tylko klienta bazy,
// weryfikację podpisu i wysyłkę maili.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

interface QueryResult {
  data: unknown;
  error: unknown;
}
type Op = { table: string; method: string; args: unknown[] };

const h = vi.hoisted(() => {
  const state: {
    ops: Op[];
    table: string;
    /** Bieżący łańcuch (od `from` do terminala) - rozróżnia UPDATE...RETURNING. */
    current: string[];
    /** Wynik `maybeSingle()` per tabela (kolejka - kolejne odczyty). */
    lookups: Record<string, QueryResult[]>;
    write: QueryResult;
    /**
     * Wynik warunkowego UPDATE strażnika kolejności (`claimSubscriptionEvent`).
     * Domyślnie zdarzenie jest ŚWIEŻSZE od zapisanego stanu (jeden wiersz
     * zaktualizowany). Test spóźnionego webhooka ustawia `[]`.
     */
    claim: QueryResult;
  } = {
    ops: [],
    table: "",
    current: [],
    lookups: {},
    write: { data: null, error: null },
    claim: { data: [{ id: "row_1" }], error: null },
  };

  interface Chain extends PromiseLike<QueryResult> {
    from: (t: string) => Chain;
    maybeSingle: () => Promise<QueryResult>;
    single: () => Promise<QueryResult>;
    // Pozostałe operatory PostgREST (select/eq/or/is/in/order/...) są
    // dostarczane dynamicznie przez proxy - handler dokłada filtry (np.
    // strażnik `last_event_at` używa `.or(...)`), a test nie ma powodu
    // pilnować ich listy ręcznie.
    [method: string]: unknown;
  }

  const record =
    (method: string) =>
    (...args: unknown[]): Chain => {
      if (method === "from") {
        state.table = String(args[0]);
        state.current = [];
      }
      state.current.push(method);
      state.ops.push({ table: state.table, method, args });
      return chain;
    };

  const lookup = (): Promise<QueryResult> => {
    const queue = state.lookups[state.table];
    return Promise.resolve(
      queue && queue.length > 0 ? queue.shift()! : { data: null, error: null },
    );
  };

  const settle = (): QueryResult =>
    // `update(...).select(...)` to RETURNING - zwraca wiersze, nie pusty zapis.
    state.current.includes("update") && state.current.includes("select")
      ? state.claim
      : state.write;

  const terminals: Record<string, unknown> = {
    maybeSingle: lookup,
    single: lookup,
    then: (ok: unknown, err: unknown) =>
      Promise.resolve(settle()).then(
        ok as (v: QueryResult) => unknown,
        err as (e: unknown) => unknown,
      ),
  };

  const methodCache = new Map<string, unknown>();
  const chain: Chain = new Proxy({} as Chain, {
    get(_t, prop: string | symbol) {
      if (typeof prop !== "string") return undefined;
      if (prop in terminals) return terminals[prop];
      let fn = methodCache.get(prop);
      if (!fn) {
        fn = record(prop);
        methodCache.set(prop, fn);
      }
      return fn;
    },
  });

  // Klient NIE może być thenable - `async function admin() { return supabase }`
  // rozpakowałoby go do wyniku zapisu zamiast zwrócić builder.
  const client = { from: (t: string) => chain.from(t) };

  const event: { value: unknown } = { value: null };
  const emails = { subscription: vi.fn(async () => {}), payment: vi.fn(async () => {}) };
  // Praca „za odpowiedzią" + budzik do deterministycznego doczekania jej
  // REJESTRACJI (wzorzec z `src/lib/__tests__/ssrCacheHostScope.test.ts`).
  const afterResponse: Promise<unknown>[] = [];
  const wake: { notify: null | (() => void) } = { notify: null };
  const catalogSync = vi.fn(async () => {});

  return { state, chain, client, event, emails, afterResponse, wake, catalogSync };
});

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: h.client }));
vi.mock("@/lib/stripe.server", () => ({
  verifyWebhook: async () => h.event.value,
  // catalogAutoSync liczy odcisk integracji na starcie handlera.
  getConnectionApiKey: () => "test_key",
  EventName: {
    SubscriptionCreated: "subscription.created",
    SubscriptionUpdated: "subscription.updated",
    SubscriptionActivated: "subscription.activated",
    SubscriptionTrialing: "subscription.trialing",
    SubscriptionPastDue: "subscription.past_due",
    SubscriptionPaused: "subscription.paused",
    SubscriptionResumed: "subscription.resumed",
    SubscriptionImported: "subscription.imported",
    SubscriptionCanceled: "subscription.canceled",
    TransactionCompleted: "transaction.completed",
    TransactionPaymentFailed: "transaction.payment_failed",
  },
}));
vi.mock("@/lib/billing/notifications.server", () => ({
  notifySubscriptionEmail: (...a: unknown[]) => h.emails.subscription(...(a as [])),
  notifyPaymentEmail: (...a: unknown[]) => h.emails.payment(...(a as [])),
}));

// ── DLACZEGO TE DWA MOCKI USUWAJĄ NIEDETERMINIZM POKRYCIA ─────────────────
//
// ZMIERZONE (wydanie 10 audytu, ten sam kod i ten sam test): próg funkcji dla
// `webhook.ts` dawał 20% (1/5) lokalnie i 40% (2/5) na runnerze. Różnicą jest
// DOKŁADNIE jedna strzałka - `({ ensureCatalogSynced }) => ensureCatalogSynced(env)`
// wewnątrz `runAfterResponse(import(...))` w `webhook.ts:66-70`. W wydaniu 9
// wykonała się 14 razy, w wydaniu 10 ani razu, przy pliku i teście NIETKNIĘTYCH.
//
// MECHANIZM. Ta praca jest fire-and-forget Z PREMEDYTACJĄ: kontrola odcisku
// katalogu ma iść ZA odpowiedzią, żeby nie opóźniać ACK dla Stripe. Skutkiem
// ubocznym jest wyścig - czy łańcuch mikrozadań importu dynamicznego zdąży się
// rozstrzygnąć, ZANIM plik testowy się zakończy. Zdąży albo nie zdąży, i to
// jest cała treść „niedeterministycznego pokrycia": nie brak testu, tylko brak
// PUNKTU ZACZEPIENIA.
//
// Podmiana `waitUntil.server` daje ten punkt: `waitForAfterResponse()` czeka na
// FAKT rejestracji i na rozstrzygnięcie samej obietnicy, a nie na upływ czasu.
// Podmiana `catalogAutoSync.server` trzyma skutki uboczne tej pracy z dala od
// atrapy Supabase - bez niej deterministyczne dokańczanie dokładałoby zapisy do
// `h.state.ops` i psuło asercje pozostałych przypadków.
//
// To NIE jest zaślepka, tylko przyrząd: „odświeżenie w tle wystartowało" i
// „odświeżenie w tle się dokończyło" to dwa różne zdania, a na Workers to
// drugie bywa ucinane (patrz nagłówek `waitUntil.server.ts`). Dotąd nie
// sprawdzało tego nic.
vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>) => {
    h.afterResponse.push(work);
    h.wake.notify?.();
  },
}));
vi.mock("@/lib/billing/catalogAutoSync.server", () => ({
  ensureCatalogSynced: (...a: unknown[]) => h.catalogSync(...(a as [])),
}));

import { __handleForTests as handle } from "./webhook";

/**
 * Czeka na REJESTRACJĘ pracy w tle, a potem na jej ROZSTRZYGNIĘCIE.
 * Deterministycznie: budzi ją samo wywołanie atrapy, nie zegar. Gdyby
 * rejestracja nie nastąpiła, test padnie na `testTimeout` z widocznym
 * komunikatem, a nie przemilczy braku.
 */
async function waitForAfterResponse(): Promise<void> {
  if (h.afterResponse.length === 0) {
    await new Promise<void>((resolve) => {
      h.wake.notify = () => {
        h.wake.notify = null;
        resolve();
      };
    });
  }
  await Promise.all(h.afterResponse);
}

const PLAN = { id: "plan_pro_m", tenant_id: "ten_1", price_cents: 9900, currency: "PLN" };
const PROFILE = {
  email: "Buyer@Example.com",
  first_name: "Anna",
  last_name: "Kowalska",
  tenant_id: "ten_1",
};

function req(): Request {
  return { url: "https://example.com/api/public/payments/webhook?env=live" } as unknown as Request;
}

const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/**
 * Surowe zdarzenie Stripe (kształt dokładnie taki, jaki przychodzi z bramki) -
 * normalizacja do modelu domenowego dzieje się w `normalizeStripeEvent`,
 * którego celowo NIE mockujemy: test ma pilnować całej ścieżki.
 */
function subEvent(
  stripeType: string,
  opts: {
    status: string;
    startsAt?: string;
    endsAt?: string;
    userId?: string;
    withoutItems?: boolean;
    eventId?: string;
  },
): Record<string, unknown> {
  const item: Record<string, unknown> = {
    quantity: 1,
    current_period_start: opts.startsAt ? unix(opts.startsAt) : undefined,
    current_period_end: opts.endsAt ? unix(opts.endsAt) : undefined,
    price: {
      id: "pri_1",
      lookup_key: "pro_monthly",
      product: { id: "pro_1", metadata: { lovable_external_id: "plan_pro" } },
    },
  };

  return {
    id: opts.eventId ?? `evt_${Math.random().toString(36).slice(2)}`,
    type: stripeType,
    created: unix("2026-07-29T10:00:00.000Z"),
    data: {
      object: {
        id: "sub_1",
        customer: "ctm_1",
        status: opts.status,
        metadata: opts.userId ? { userId: opts.userId } : {},
        items: { data: opts.withoutItems ? [] : [item] },
      },
    },
  };
}

/** Domyślne odczyty: istniejąca subskrypcja, plan, profil, lead w CRM. */
function seed(
  existing: Record<string, unknown> | null,
  extra?: Partial<Record<string, QueryResult[]>>,
) {
  h.state.lookups = {
    subscriptions: existing ? [{ data: existing, error: null }] : [{ data: null, error: null }],
    access_plans: [
      { data: PLAN, error: null },
      { data: PLAN, error: null },
      { data: PLAN, error: null },
    ],
    profiles: [{ data: PROFILE, error: null }],
    crm_leads: [{ data: { id: "lead_1", tags: ["newsletter"] }, error: null }],
    user_subscriptions: [{ data: { id: "us_1" }, error: null }],
    ...extra,
  };
}

const opsOn = (table: string, method: string) =>
  h.state.ops.filter((o) => o.table === table && o.method === method);
/** Czy to wyłącznie zapis strażnika kolejności zdarzeń (`last_event_at`). */
const isClaimOnly = (arg: unknown): boolean =>
  typeof arg === "object" &&
  arg !== null &&
  Object.keys(arg as Record<string, unknown>).every((k) => k === "last_event_at");
const payload = <T>(table: string, method: string): T =>
  (opsOn(table, method)
    .map((o) => o.args[0])
    .find((a) => !isClaimOnly(a)) ?? {}) as T;

describe("webhook operatora płatności - synchronizacja end-to-end", () => {
  beforeEach(() => {
    h.state.ops = [];
    h.state.write = { data: null, error: null };
    h.emails.subscription.mockClear();
    h.emails.payment.mockClear();
    h.afterResponse.length = 0;
    h.wake.notify = null;
    h.catalogSync.mockClear();
  });

  // Praca „za odpowiedzią" jest rejestrowana przy KAŻDYM żądaniu (webhook.ts:66,
  // przed rozgałęzieniem na typ zdarzenia), więc dokańczamy ją po każdym
  // przypadku. Dzięki temu strzałka importu wykonuje się w każdym przebiegu,
  // a nie w losowej ich części - i próg funkcji przestaje zależeć od maszyny.
  afterEach(async () => {
    await Promise.all(h.afterResponse);
  });

  it("pauza: wstrzymuje uprawnienie, oznacza CRM i powiadamia użytkownika", async () => {
    seed({ user_id: "u1", price_id: "pro_monthly", status: "active" });
    h.event.value = subEvent("customer.subscription.updated", {
      status: "paused",
      startsAt: "2026-07-01T00:00:00Z",
      endsAt: "2026-08-01T00:00:00Z",
    });

    const res = await handle(req());
    expect(res.status).toBe(200);

    // 1. subscriptions -> panel administratora
    expect(payload<{ status: string }>("subscriptions", "update").status).toBe("paused");

    // 2. user_subscriptions -> uprawnienia, profil, widgety
    const ent = payload<{ status: string; canceled_at: string | null }>(
      "user_subscriptions",
      "update",
    );
    expect(ent.status).toBe("canceled");
    expect(ent.canceled_at).toBeTruthy();

    // 3. CRM
    const lead = payload<{ stage: string; tags: string[] }>("crm_leads", "update");
    expect(lead.tags).toContain("subscription:paused");

    // 4. dzwonek
    expect(payload<{ title_pl: string }>("notifications", "insert").title_pl).toContain(
      "wstrzymana",
    );
  });

  it("wznowienie po pauzie: przywraca dostęp, czyści znacznik CRM i powiadamia", async () => {
    seed(
      { user_id: "u1", price_id: "pro_monthly", status: "paused" },
      {
        crm_leads: [
          { data: { id: "lead_1", tags: ["customer", "subscription:paused"] }, error: null },
        ],
      },
    );
    h.event.value = subEvent("customer.subscription.updated", {
      status: "active",
      startsAt: "2026-08-01T00:00:00Z",
      endsAt: "2026-09-01T00:00:00Z",
    });

    await handle(req());

    const ent = payload<{ status: string; current_period_end: string }>(
      "user_subscriptions",
      "update",
    );
    expect(ent.status).toBe("active");
    expect(ent.current_period_end).toBe("2026-09-01T00:00:00.000Z");

    const lead = payload<{ stage: string; tags: string[] }>("crm_leads", "update");
    expect(lead.stage).toBe("won");
    expect(lead.tags).not.toContain("subscription:paused");

    expect(payload<{ title_pl: string }>("notifications", "insert").title_pl).toContain(
      "wznowiona",
    );
  });

  it("dedykowane zdarzenia stanu (past_due, paused, resumed, trialing) są obsługiwane", async () => {
    const cases: Array<[string, string]> = [
      ["customer.subscription.updated", "past_due"],
      ["customer.subscription.updated", "paused"],
      ["customer.subscription.resumed", "active"],
      ["customer.subscription.updated", "trialing"],
    ];
    for (const [stripeType, status] of cases) {
      h.state.ops = [];
      seed({ user_id: "u1", price_id: "pro_monthly", status: "active" });
      h.event.value = subEvent(stripeType, {
        status,
        startsAt: "2026-07-01T00:00:00Z",
        endsAt: "2026-08-01T00:00:00Z",
      });

      await handle(req());
      expect(payload<{ status: string }>("subscriptions", "update").status).toBe(status);
    }
  });

  it("aktywacja przed utworzeniem subskrypcji zakłada wiersz zamiast go zgubić", async () => {
    seed(null);
    h.event.value = subEvent("customer.subscription.updated", {
      status: "active",
      userId: "u1",
      startsAt: "2026-07-01T00:00:00Z",
      endsAt: "2026-08-01T00:00:00Z",
    });

    await handle(req());

    const up = payload<{ user_id: string; status: string }>("subscriptions", "upsert");
    expect(up.user_id).toBe("u1");
    expect(up.status).toBe("active");
  });

  it("uprawnienie po zwrocie nie wraca do życia na spóźnionym zdarzeniu", async () => {
    seed(
      { user_id: "u1", price_id: "pro_monthly", status: "active" },
      {
        user_subscriptions: [{ data: { id: "us_1", status: "refunded" }, error: null }],
      },
    );
    h.event.value = subEvent("customer.subscription.updated", {
      status: "active",
      startsAt: "2026-07-01T00:00:00Z",
      endsAt: "2026-08-01T00:00:00Z",
    });

    await handle(req());

    expect(opsOn("user_subscriptions", "update")).toHaveLength(0);
  });

  it("past_due: nie odbiera dostępu, ale zapisuje stan w panelu", async () => {
    seed({ user_id: "u1", price_id: "pro_monthly", status: "active" });
    h.event.value = subEvent("customer.subscription.updated", {
      status: "past_due",
      startsAt: "2026-07-01T00:00:00Z",
      endsAt: "2026-08-01T00:00:00Z",
    });

    await handle(req());

    expect(payload<{ status: string }>("subscriptions", "update").status).toBe("past_due");
    expect(payload<{ status: string }>("user_subscriptions", "update").status).toBe("active");
  });

  it("nowy okres rozliczeniowy: przenosi datę końca do uprawnienia", async () => {
    seed({ user_id: "u1", price_id: "pro_monthly", status: "active" });
    h.event.value = subEvent("customer.subscription.updated", {
      status: "active",
      startsAt: "2026-08-01T00:00:00Z",
      endsAt: "2026-09-01T00:00:00Z",
    });

    await handle(req());

    expect(
      payload<{ current_period_end: string }>("subscriptions", "update").current_period_end,
    ).toBe("2026-09-01T00:00:00.000Z");
    const ent = payload<{ status: string; current_period_end: string }>(
      "user_subscriptions",
      "update",
    );
    expect(ent.status).toBe("active");
    expect(ent.current_period_end).toBe("2026-09-01T00:00:00.000Z");
  });

  it("zdarzenie stanu bez pozycji cennika korzysta z ceny zapisanej przy subskrypcji", async () => {
    seed({ user_id: "u1", price_id: "pro_monthly", status: "active" });
    h.event.value = subEvent("customer.subscription.updated", {
      eventId: "evt_no_items",
      status: "paused",
      withoutItems: true,
      startsAt: "2026-07-01T00:00:00Z",
      endsAt: "2026-08-01T00:00:00Z",
    });

    await handle(req());

    // Bez fallbacku ta ścieżka nie dotknęłaby uprawnień w ogóle.
    expect(opsOn("user_subscriptions", "update").length).toBe(1);
  });

  it("rezygnacja: dostęp do końca okresu, CRM na 'archived', mail i ankieta", async () => {
    seed({
      user_id: "u1",
      price_id: "pro_monthly",
      current_period_end: "2099-01-01T00:00:00Z",
      status: "active",
    });
    h.event.value = subEvent("customer.subscription.deleted", { status: "canceled" });

    await handle(req());

    expect(payload<{ status: string }>("subscriptions", "update").status).toBe("canceled");

    // Dostęp trwa do końca opłaconego okresu -> uprawnienie zostaje aktywne.
    const ent = payload<{ status: string; current_period_end: string }>(
      "user_subscriptions",
      "update",
    );
    expect(ent.status).toBe("active");
    expect(ent.current_period_end).toBe("2099-01-01T00:00:00Z");

    const lead = payload<{ stage: string; tags: string[] }>("crm_leads", "update");
    expect(lead.stage).toBe("archived");
    expect(lead.tags).toContain("churned");
    expect(lead.tags).not.toContain("customer");

    expect(h.emails.subscription).toHaveBeenCalledTimes(1);
    expect(payload<{ href: string }>("notifications", "insert").href).toContain("retention=1");
  });

  it("rezygnacja po zakończonym okresie odbiera uprawnienie", async () => {
    seed({
      user_id: "u1",
      price_id: "pro_monthly",
      current_period_end: "2020-01-01T00:00:00Z",
      status: "active",
    });
    h.event.value = subEvent("customer.subscription.deleted", { status: "canceled" });

    await handle(req());

    expect(payload<{ status: string }>("user_subscriptions", "update").status).toBe("canceled");
  });

  it("duplikat zdarzenia nie dotyka żadnej warstwy", async () => {
    seed({ user_id: "u1", price_id: "pro_monthly", status: "active" });
    h.state.write = { data: null, error: { code: "23505", message: "duplicate" } };
    h.event.value = subEvent("customer.subscription.updated", { status: "paused" });

    const res = await handle(req());
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(opsOn("user_subscriptions", "update").length).toBe(0);
    expect(opsOn("crm_leads", "update").length).toBe(0);
  });

  it("każde obsłużone zdarzenie ląduje w rejestrze webhooków (/admin/billing)", async () => {
    seed({ user_id: "u1", price_id: "pro_monthly", status: "active" });
    h.event.value = subEvent("customer.subscription.updated", { status: "active" });

    await handle(req());

    expect(payload<{ event_type: string }>("payment_webhook_events", "insert").event_type).toBe(
      "subscription.updated",
    );
    expect(payload<{ status: string }>("payment_webhook_events", "update").status).toBe(
      "processed",
    );
  });
  it("kontrola odcisku katalogu jedzie ZA odpowiedzią i FAKTYCZNIE się dokańcza", async () => {
    // Zdarzenie od Stripe jest najwcześniejszym sygnałem, że integracja znowu
    // żyje, więc odtworzenie katalogu rusza od razu - ale ZA odpowiedzią, żeby
    // nie opóźniać ACK. Dotąd nie było testu, który by tego dowodził: praca
    // była rejestrowana i porzucana, a jej wykonanie zależało od tego, czy
    // proces dożyje mikrozadania. Ten przypadek pilnuje OBU zdań naraz -
    // że praca została zarejestrowana jako „po odpowiedzi" ORAZ że doszła do
    // końca z właściwym środowiskiem.
    seed({ user_id: "u1", price_id: "pro_monthly", status: "active" });
    h.event.value = subEvent("customer.subscription.updated", {
      status: "active",
      startsAt: "2026-07-01T00:00:00Z",
      endsAt: "2026-08-01T00:00:00Z",
    });

    const res = await handle(req());

    expect(res.status).toBe(200);
    // Rejestracja nastąpiła PRZED odpowiedzią, ale praca jeszcze się nie
    // dokończyła - to jest cały sens `runAfterResponse`.
    expect(h.afterResponse).toHaveLength(1);

    await waitForAfterResponse();

    expect(h.catalogSync).toHaveBeenCalledWith("live");
  });
});
