// Strażnik kolejności zdarzeń subskrypcji - KOLEJNOŚĆ SKUTKÓW, nie tylko zajęć
// (przegląd 1.0, 1.2, 1.3 / 5.10 / 6.2, S1).
//
// CO BYŁO ZŁE. Strażnik porządkował ZAJĘCIA zdarzeń (para `last_event_at` +
// `last_event_id`), ale skutki dwóch zajętych zdarzeń biegły równolegle,
// a ich zapisy były bezwarunkowe:
//   * 1.0 - zapis uprawnienia STARSZEGO zdarzenia lądował po zapisie nowszego:
//     klient zapłacił (`active`), a uprawnienie zostawało `canceled` aż do
//     następnego zdarzenia, czyli zwykle miesiąc;
//   * 1.3 - stan subskrypcji szedł do wiersza PRZED skutkami, więc powtórka po
//     ich porażce czytała już nowy status i cenę: dzwonek, mail i CRM pauzy,
//     wznowienia i zmiany planu nie szły nigdy, a dziennik mówił `processed`;
//   * 1.2 - `created` wstawiało wiersz PRZED skutkami założenia; gdy skutki
//     padły, a przed ponowieniem przyszło inne zdarzenie, `created` było już
//     spóźnione - mail potwierdzenia, CRM, newsletter i dzwonek ginęły;
//   * S1 - zdarzenie subskrypcji nie podawało początku okresu, więc
//     uprawnienie zwrócone w bieżącym okresie nie wracało nawet po kolejnym
//     OPŁACONYM odnowieniu.
//
// PRZEPLOTY ODTWARZAMY DETERMINISTYCZNIE (jak w `webhookDispatch.server.test`):
// druga obsługa biegnie w całości w punkcie, w którym pierwsza właśnie
// zapisuje uprawnienie - to najgorszy przeplot, jaki może dać baza.
//
// ATRAPY NA GRANICACH: klient roli serwisowej (tabele w pamięci), SDK
// operatora (`stripe.server`, tylko `subscriptions.retrieve`) i wysyłka maili
// (`notifications.server` - interesuje nas RODZAJ maila, nie szablon).
// Dyspozytor, efekty zakupu, zapis uprawnień i CRM biegną PRAWDZIWYM kodem.
//
// RODO: adresy syntetyczne (`example.com`), identyfikatory zmyślone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok, fail, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { rowStore, type RowStore, type StoredRow } from "@/test/billing/rowStore";
import type { SubscriptionData } from "@/lib/billing/webhookDispatch.server";

let db: SupabaseFromStub;
let rpc: SupabaseRpcStub;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => db.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => rpc.rpc(name, args),
  },
}));

const h = vi.hoisted(() => ({
  retrieve: null as null | ((id: string) => Promise<unknown>),
  retrieveCalls: [] as string[],
  mails: [] as Array<{ kind: string; idempotencySeed?: string }>,
}));

vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getStripeClient: async () => {
    const retrieve = h.retrieve;
    if (!retrieve) throw new Error("test: żaden przypadek nie ma prawa wołać operatora");
    return {
      subscriptions: {
        retrieve: (id: string) => {
          h.retrieveCalls.push(id);
          return retrieve(id);
        },
      },
    };
  },
}));
vi.mock("@/lib/billing/notifications.server", () => ({
  notifySubscriptionEmail: async (input: { kind: string; idempotencySeed?: string }) => {
    h.mails.push({ kind: input.kind, idempotencySeed: input.idempotencySeed });
    return true;
  },
  notifyPaymentEmail: async () => true,
}));

const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");

const T0 = "2026-08-29T10:00:00.000Z";
const T1 = "2026-08-30T10:00:00.000Z";
const T2 = "2026-08-30T10:00:05.000Z";
const PLAN_PRO = { id: "plan-pro-m", tenant_id: "tenant-alfa", price_cents: 9900, currency: "PLN" };
const PLAN_PLUS = {
  id: "plan-plus-m",
  tenant_id: "tenant-alfa",
  price_cents: 4900,
  currency: "PLN",
};

/** Zdarzenie subskrypcji po normalizacji (`stripeEvents.server`). */
function subscriptionEvent(overrides: Partial<SubscriptionData> = {}): SubscriptionData {
  return {
    id: "sub_atrapa_1",
    customerId: "cus_atrapa_1",
    status: "active",
    customData: { userId: "user-kupujacy" },
    currentBillingPeriod: {
      startsAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2026-09-01T00:00:00.000Z",
    },
    items: [
      {
        quantity: 1,
        price: { id: "pri_atrapa", externalId: "pro_monthly" },
        product: { id: "prod_atrapa", externalId: "plan_pro" },
      },
    ],
    ...overrides,
  };
}

/** Subskrypcja w API operatora (kształt Basil) - stan autorytatywny. */
function remoteSubscription(status: string, lookupKey = "pro_monthly") {
  return {
    id: "sub_atrapa_1",
    customer: "cus_atrapa_1",
    status,
    metadata: { userId: "user-kupujacy" },
    items: {
      data: [
        {
          quantity: 1,
          current_period_start: Date.parse("2026-08-01T00:00:00.000Z") / 1000,
          current_period_end: Date.parse("2026-09-01T00:00:00.000Z") / 1000,
          price: { id: "pri_atrapa", lookup_key: lookupKey, product: "prod_atrapa" },
        },
      ],
    },
  };
}

function storedSubscription(overrides: StoredRow = {}): StoredRow {
  return {
    id: "sub-baza-1",
    provider_subscription_id: "sub_atrapa_1",
    environment: "live",
    user_id: "user-kupujacy",
    tenant_id: "tenant-alfa",
    price_id: "pro_monthly",
    product_id: "plan_pro",
    status: "active",
    current_period_end: "2026-09-01T00:00:00.000Z",
    last_event_at: T0,
    last_event_id: "evt_poprzednie",
    ...overrides,
  };
}

let subscriptions: RowStore;
let entitlements: RowStore;
let leads: RowStore;
/** Dzwonki: wiersz dostaje `created_at` z chwili zapisu, jak w bazie (DEFAULT now()). */
let bells: StoredRow[];

/** Uprawnienie: zapis wstrzymany w punkcie, w którym test wpuszcza drugie zdarzenie. */
let beforeEntitlementWrite: ((chain: { has(method: string): boolean }) => Promise<void>) | null;

const bellTitles = () => bells.map((row) => row.title_pl);
const mailKinds = () => h.mails.map((mail) => mail.kind);

beforeEach(() => {
  db = supabaseFromStub();
  rpc = supabaseRpcStub();
  h.retrieve = null;
  h.retrieveCalls = [];
  h.mails = [];
  beforeEntitlementWrite = null;
  bells = [];

  subscriptions = rowStore({
    unique: ["provider_subscription_id"],
    timestamps: ["last_event_at"],
  });
  entitlements = rowStore({
    unique: ["external_ref"],
    beforeResolve: async (chain) => {
      const write = chain.has("insert") || chain.has("update");
      if (write && beforeEntitlementWrite) {
        const hook = beforeEntitlementWrite;
        beforeEntitlementWrite = null;
        await hook(chain);
      }
    },
  });
  leads = rowStore();
  const bellStore = rowStore({ timestamps: ["created_at"] });
  bells = bellStore.rows;

  db.setResponse("subscriptions", (chain) => subscriptions.respond(chain));
  db.setResponse("user_subscriptions", (chain) => entitlements.respond(chain));
  db.setResponse("crm_leads", (chain) => leads.respond(chain));
  db.setResponse("notifications", (chain) => {
    if (chain.has("insert")) {
      const payload = chain.argsOf("insert")?.[0] as StoredRow;
      bellStore.rows.push({
        id: `dzwonek-${bellStore.rows.length + 1}`,
        created_at: new Date().toISOString(),
        ...payload,
      });
      return ok(null);
    }
    return bellStore.respond(chain);
  });
  db.setResponse("access_plans", (chain) => {
    const tier = chain.calls.find((c) => c.method === "eq" && c.args[0] === "tier_key")?.args[1];
    return ok(tier === "plus" ? PLAN_PLUS : PLAN_PRO);
  });
  db.setResponse(
    "profiles",
    ok({ email: "kupujacy@example.com", first_name: "Anna", tenant_id: "tenant-alfa" }),
  );
  for (const table of ["newsletter_subscribers", "member_organizations", "payment_orders"]) {
    db.setResponse(table, ok(null));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("1.0 - skutki starszego zdarzenia nie wygrywają z nowszym", () => {
  it("`created` (incomplete) i `updated` (active) bez wiersza: zapis `created` lądujący OSTATNI nie odbiera dostępu", async () => {
    // Scenariusz z przeglądu: kasa wysyła oba zdarzenia równolegle. `updated`
    // przechodzi w całości w chwili, gdy `created` zapisuje uprawnienie -
    // zapis `created` (`incomplete` -> brak dostępu) ląduje po nim.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    h.retrieve = async () => remoteSubscription("active");
    let inner: Promise<unknown> | null = null;
    beforeEntitlementWrite = async () => {
      inner = dispatchWebhookEvent({
        eventId: "evt_zmiana",
        eventType: "subscription.updated",
        data: subscriptionEvent({ status: "active" }),
        environment: "live",
        occurredAt: T2,
      });
      await inner;
    };

    const outer = await dispatchWebhookEvent({
      eventId: "evt_utworzenie",
      eventType: "subscription.created",
      data: subscriptionEvent({ status: "incomplete" }),
      environment: "live",
      occurredAt: T1,
    });

    expect(outer).toBe("processed");
    expect(await inner).toBe("processed");
    expect(subscriptions.rows).toEqual([
      expect.objectContaining({ status: "active", last_event_at: T2, last_event_id: "evt_zmiana" }),
    ]);
    // Klient zapłacił - uprawnienie MA być aktywne, a stan bierze się z API.
    expect(entitlements.rows).toEqual([
      expect.objectContaining({ external_ref: "sub_atrapa_1", status: "active" }),
    ]);
    expect(h.retrieveCalls).toEqual(["sub_atrapa_1"]);
  });

  it("pauza i wznowienie: starsza pauza, której zapis ląduje po wznowieniu, nie zostawia klienta bez dostępu", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    subscriptions.rows.push(storedSubscription({ status: "active" }));
    entitlements.rows.push({ id: "us-1", external_ref: "sub_atrapa_1", status: "active" });
    h.retrieve = async () => remoteSubscription("active");
    let inner: Promise<unknown> | null = null;
    beforeEntitlementWrite = async () => {
      inner = dispatchWebhookEvent({
        eventId: "evt_wznowienie",
        eventType: "subscription.resumed",
        data: subscriptionEvent({ status: "active" }),
        environment: "live",
        occurredAt: T2,
      });
      await inner;
    };

    const outer = await dispatchWebhookEvent({
      eventId: "evt_pauza",
      eventType: "subscription.paused",
      data: subscriptionEvent({ status: "paused" }),
      environment: "live",
      occurredAt: T1,
    });

    expect(outer).toBe("processed");
    expect(await inner).toBe("processed");
    // Wiersz należy do NOWSZEGO zdarzenia - zapis stanu pauzy nie trafił
    // (warunek na zajęcie), więc nie cofnął wznowienia.
    expect(subscriptions.rows[0]).toMatchObject({
      status: "active",
      last_event_at: T2,
      last_event_id: "evt_wznowienie",
    });
    expect(entitlements.rows[0]).toMatchObject({ status: "active" });
    expect(h.retrieveCalls).toEqual(["sub_atrapa_1"]);
    // Klient usłyszał „wstrzymana" (skutki pauzy wyszły), więc wyrównanie
    // domyka komunikat stanem prawdziwym - „wznowiona".
    expect(bellTitles()).toEqual(["Subskrypcja wstrzymana", "Subskrypcja wznowiona"]);
  });

  it("wyparte zdarzenie bez odpowiedzi operatora pada głośno (dziennik `failed`), zamiast zostawić stary zapis", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    subscriptions.rows.push(storedSubscription({ status: "active" }));
    entitlements.rows.push({ id: "us-1", external_ref: "sub_atrapa_1", status: "active" });
    h.retrieve = async () => {
      throw new Error("gateway timeout");
    };
    beforeEntitlementWrite = async () => {
      // Nowsze zdarzenie przejmuje wiersz (samo zajęcie wystarczy).
      subscriptions.rows[0] = {
        ...subscriptions.rows[0],
        last_event_at: T2,
        last_event_id: "evt_x",
      };
    };

    await expect(
      dispatchWebhookEvent({
        eventId: "evt_pauza",
        eventType: "subscription.paused",
        data: subscriptionEvent({ status: "paused" }),
        environment: "live",
        occurredAt: T1,
      }),
    ).rejects.toThrow("subscription resync: provider read failed (sub_atrapa_1): gateway timeout");
    expect(subscriptions.rows[0]).toMatchObject({ status: "active", last_event_id: "evt_x" });
  });
});

describe("1.3 / 5.10 / 6.2 - powtórka po porażce skutków widzi POPRZEDNI stan", () => {
  it("pauza: porażka zapisu uprawnienia, potem powtórka - dzwonek, mail i CRM pauzy wychodzą", async () => {
    subscriptions.rows.push(storedSubscription({ status: "active" }));
    let writes = 0;
    db.setResponse("user_subscriptions", (chain) => {
      if (chain.has("maybeSingle")) return ok({ id: "us-1", status: "active", canceled_at: null });
      writes += 1;
      return writes === 1 ? fail("connection reset") : ok(null);
    });
    const paused = {
      eventId: "evt_pauza",
      eventType: "subscription.paused",
      data: subscriptionEvent({ status: "paused" }),
      environment: "live" as const,
      occurredAt: T1,
    };

    await expect(dispatchWebhookEvent(paused)).rejects.toThrow("connection reset");
    // Stan NIE poszedł do wiersza - powtórka zobaczy `active` jako poprzedni.
    expect(subscriptions.rows[0]).toMatchObject({ status: "active", last_event_id: "evt_pauza" });

    expect(await dispatchWebhookEvent(paused)).toBe("processed");

    expect(subscriptions.rows[0]).toMatchObject({ status: "paused" });
    expect(bellTitles()).toEqual(["Subskrypcja wstrzymana"]);
    expect(mailKinds()).toEqual(["subscription_paused"]);
    expect(leads.rows[0]?.tags).toContain("subscription:paused");
  });

  it("podniesienie planu: porażka, potem powtórka - mail i dzwonek „Plan podniesiony” wychodzą", async () => {
    subscriptions.rows.push(storedSubscription({ price_id: "plus_monthly" }));
    let writes = 0;
    db.setResponse("user_subscriptions", (chain) => {
      if (chain.has("maybeSingle")) return ok({ id: "us-1", status: "active", canceled_at: null });
      writes += 1;
      return writes === 1 ? fail("connection reset") : ok(null);
    });
    const upgrade = {
      eventId: "evt_upgrade",
      eventType: "subscription.updated",
      data: subscriptionEvent({ status: "active" }),
      environment: "live" as const,
      occurredAt: T1,
    };

    await expect(dispatchWebhookEvent(upgrade)).rejects.toThrow("connection reset");
    expect(subscriptions.rows[0]).toMatchObject({ price_id: "plus_monthly" });

    expect(await dispatchWebhookEvent(upgrade)).toBe("processed");

    expect(subscriptions.rows[0]).toMatchObject({ price_id: "pro_monthly" });
    expect(bellTitles()).toEqual(["Plan podniesiony"]);
    expect(mailKinds()).toEqual(["subscription_upgraded"]);
  });

  it("porażka DOPIERO przy zapisie stanu: powtórka nie dubluje dzwonka (dokładnie raz)", async () => {
    // Skutki przeszły w całości (dzwonek już leży), padł ostatni krok - zapis
    // stanu. Powtórka wykonuje skutki jeszcze raz: mail ma ziarno
    // idempotencji, CRM jest zbieżny, a dzwonek - próg deduplikacji.
    subscriptions.rows.push(storedSubscription({ status: "active" }));
    entitlements.rows.push({ id: "us-1", external_ref: "sub_atrapa_1", status: "active" });
    let stateWrites = 0;
    db.setResponse("subscriptions", (chain) => {
      const patch = chain.argsOf("update")?.[0] as StoredRow | undefined;
      if (patch && "status" in patch) {
        stateWrites += 1;
        if (stateWrites === 1) return fail("statement timeout");
      }
      return subscriptions.respond(chain);
    });
    const paused = {
      eventId: "evt_pauza",
      eventType: "subscription.paused",
      data: subscriptionEvent({ status: "paused" }),
      environment: "live" as const,
      occurredAt: T1,
    };

    await expect(dispatchWebhookEvent(paused)).rejects.toThrow(
      "subscriptions update failed: statement timeout",
    );
    expect(await dispatchWebhookEvent(paused)).toBe("processed");

    expect(bellTitles()).toEqual(["Subskrypcja wstrzymana"]);
    // Oba przebiegi zgłaszają mail z TYM SAMYM ziarnem - dziennik wysyłek
    // (`email_send_log`) przepuszcza tylko pierwszy.
    expect(new Set(h.mails.map((mail) => mail.idempotencySeed)).size).toBe(1);
    expect(subscriptions.rows[0]).toMatchObject({ status: "paused" });
  });
});

describe("1.2 - skutki założenia nie giną, gdy pierwsza próba `created` padnie", () => {
  it("`created` pada na zapisie uprawnienia, potem przychodzi `updated`: mail, CRM i dzwonek założenia wychodzą", async () => {
    let writes = 0;
    db.setResponse("user_subscriptions", (chain) => {
      const write = chain.has("insert") || chain.has("update");
      if (write) {
        writes += 1;
        if (writes === 1) return fail("connection reset");
      }
      return entitlements.respond(chain);
    });
    const created = {
      eventId: "evt_utworzenie",
      eventType: "subscription.created",
      data: subscriptionEvent({ status: "active" }),
      environment: "live" as const,
      occurredAt: T1,
    };

    await expect(dispatchWebhookEvent(created)).rejects.toThrow("connection reset");
    // Wiersz istnieje WYŁĄCZNIE po skutkach założenia - porażka zostawia brak.
    expect(subscriptions.rows).toHaveLength(0);

    expect(
      await dispatchWebhookEvent({
        eventId: "evt_zmiana",
        eventType: "subscription.updated",
        data: subscriptionEvent({ status: "active" }),
        environment: "live",
        occurredAt: T2,
      }),
    ).toBe("processed");
    // Ponowione `created` jest już spóźnione - i niczego nie traci.
    expect(await dispatchWebhookEvent(created)).toBe("skipped");

    expect(mailKinds()).toEqual(["subscription_confirmed"]);
    expect(bellTitles()).toEqual(["Subskrypcja aktywna"]);
    expect(leads.rows[0]?.tags).toEqual(expect.arrayContaining(["customer", "plan:pro"]));
    expect(entitlements.rows).toEqual([expect.objectContaining({ status: "active" })]);
    expect(subscriptions.rows[0]).toMatchObject({ last_event_id: "evt_zmiana" });
  });
});

describe("S1 - zdarzenie subskrypcji podaje początek okresu", () => {
  const REFUNDED_AT = "2026-08-15T12:00:00.000Z";

  it("kolejne OPŁACONE odnowienie (okres zaczęty po korekcie) przywraca uprawnienie `refunded`", async () => {
    subscriptions.rows.push(storedSubscription());
    entitlements.rows.push({
      id: "us-1",
      external_ref: "sub_atrapa_1",
      status: "refunded",
      canceled_at: REFUNDED_AT,
    });

    expect(
      await dispatchWebhookEvent({
        eventId: "evt_odnowienie",
        eventType: "subscription.updated",
        data: subscriptionEvent({
          currentBillingPeriod: {
            startsAt: "2026-09-01T00:00:00.000Z",
            endsAt: "2026-10-01T00:00:00.000Z",
          },
        }),
        environment: "live",
        occurredAt: T1,
      }),
    ).toBe("processed");

    expect(entitlements.rows[0]).toMatchObject({
      status: "active",
      current_period_end: "2026-10-01T00:00:00.000Z",
      canceled_at: null,
    });
  });

  it("zdarzenie z TEGO SAMEGO okresu nie wskrzesza zwróconego uprawnienia", async () => {
    subscriptions.rows.push(storedSubscription());
    entitlements.rows.push({
      id: "us-1",
      external_ref: "sub_atrapa_1",
      status: "refunded",
      canceled_at: REFUNDED_AT,
    });

    await dispatchWebhookEvent({
      eventId: "evt_zmiana_karty",
      eventType: "subscription.updated",
      data: subscriptionEvent(),
      environment: "live",
      occurredAt: T1,
    });

    expect(entitlements.rows[0]).toMatchObject({ status: "refunded", canceled_at: REFUNDED_AT });
  });
});

describe("PAY-05 - remis zdarzenia piaskownicy na produkcji", () => {
  it("remis w obrębie sekundy nie odpytuje API piaskownicy z produkcji", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    subscriptions.rows.push(
      storedSubscription({ environment: "sandbox", last_event_at: T1, last_event_id: "evt_a" }),
    );

    expect(
      await dispatchWebhookEvent({
        eventId: "evt_b",
        eventType: "subscription.updated",
        data: subscriptionEvent({ status: "paused" }),
        environment: "sandbox",
        occurredAt: T1,
      }),
    ).toBe("processed");

    expect(h.retrieveCalls).toEqual([]);
    expect(subscriptions.rows[0]).toMatchObject({ last_event_id: "tie:evt_b" });
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    vi.unstubAllEnvs();
  });
});
