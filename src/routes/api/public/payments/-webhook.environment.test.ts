// @vitest-environment node
//
// ŚRODOWISKO ZDARZENIA A WDROŻENIE (PAY-05) - przez całą trasę webhooka.
//
// CO BYŁO ZŁE. Na wdrożeniu produkcyjnym trasa przyjmowała zdarzenia
// piaskownicy (`?env=sandbox`, podpis sekretem piaskownicy) i ścieżka
// subskrypcji nadawała z nich REALNE uprawnienia: `user_subscriptions` nie zna
// środowisk, a `metadata.userId` subskrypcji testowej potrafi wskazać
// prawdziwe konto. Karta testowa = płatny plan za darmo.
//
// CO TEN PLIK PRZYBIJA. Produkcja + piaskownica: wyłącznie ślad księgowy
// w `subscriptions` (sonda nocna i diagnostyka go czytają), ZERO wywołań
// `syncEntitlementState`, zero zapisów `user_subscriptions`, CRM, dzwonków
// i maili; zdarzenie innego typu kończy się `skipped`. Lustro: zdarzenie
// `live` na produkcji synchronizuje uprawnienie jak dotąd.
//
// GRANICE ATRAP: klient roli serwisowej (tabele w pamięci), weryfikacja
// podpisu (ma własne testy - `-webhook.ack.test.ts` jedzie prawdziwym HMAC),
// praca „za odpowiedzią" (kontrola katalogu woła operatora przez sieć) i
// wysyłka maili. Normalizacja, dziennik webhooków, wspólny rdzeń odtwarzania,
// dyspozytor, efekty zakupu i zapis uprawnień biegną PRAWDZIWYM kodem -
// `syncEntitlementState` jest tylko PODSŁUCHANY (oryginał wykonuje się dalej).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { rowStore, type RowStore } from "@/test/billing/rowStore";

const h = vi.hoisted(() => ({
  event: { value: null as unknown },
  emails: { subscription: vi.fn(async () => {}), payment: vi.fn(async () => {}) },
  sync: vi.fn(),
}));

let db: SupabaseFromStub;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));
vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  verifyWebhook: async () => h.event.value,
  getStripeClient: () => {
    throw new Error("test: żaden przypadek nie ma prawa wołać operatora");
  },
}));
vi.mock("@/lib/http/waitUntil.server", () => ({ runAfterResponse: () => {} }));
vi.mock("@/lib/billing/catalogAutoSync.server", () => ({ ensureCatalogSynced: async () => {} }));
vi.mock("@/lib/billing/notifications.server", () => ({
  notifySubscriptionEmail: (...args: unknown[]) => h.emails.subscription(...(args as [])),
  notifyPaymentEmail: (...args: unknown[]) => h.emails.payment(...(args as [])),
}));
vi.mock("@/lib/billing/entitlementSync.server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/billing/entitlementSync.server")>();
  return {
    ...real,
    syncEntitlementState: async (input: Parameters<typeof real.syncEntitlementState>[0]) => {
      h.sync(input);
      await real.syncEntitlementState(input);
    },
  };
});

import { __handleForTests as handle } from "./webhook";

const CREATED_S = Math.floor(Date.parse("2026-09-15T10:00:00.000Z") / 1000);
const OWNER = { user_id: "user-kupujacy", tenant_id: "tenant-alfa" };

let subscriptions: RowStore;
let entitlements: RowStore;

function request(env: "sandbox" | "live"): Request {
  return new Request(`https://example.com/api/public/payments/webhook?env=${env}`, {
    method: "POST",
    body: "{}",
  });
}

/** Surowe zdarzenie subskrypcji z bramki operatora (kształt API Basil). */
function subscriptionEvent(type: string, status: string, id: string): Record<string, unknown> {
  return {
    id,
    type,
    created: CREATED_S,
    data: {
      object: {
        id: "sub_kupujacy",
        customer: "cus_kupujacy",
        status,
        metadata: { userId: OWNER.user_id },
        items: {
          data: [
            {
              quantity: 1,
              current_period_start: CREATED_S,
              current_period_end: CREATED_S + 30 * 86_400,
              price: { id: "price_pro", lookup_key: "pro_monthly", product: "prod_pro" },
            },
          ],
        },
      },
    },
  };
}

/** Istniejąca subskrypcja (wstrzymana) w danym środowisku. */
function pausedSubscription(environment: "sandbox" | "live"): Record<string, unknown> {
  return {
    provider_subscription_id: "sub_kupujacy",
    environment,
    ...OWNER,
    price_id: "pro_monthly",
    product_id: "plan_pro",
    status: "paused",
    current_period_end: "2026-09-01T00:00:00.000Z",
    last_event_at: "2026-09-01T00:00:00.000Z",
    last_event_id: "evt_pauza",
  };
}

/** Tabele, które ścieżka subskrypcji może dotknąć poza `subscriptions`. */
const touched = (table: string) =>
  db.chainsFor(table).filter((c) => c.has("insert") || c.has("update") || c.has("upsert"));

/** Domknięcie wiersza dziennika (UPDATE po `event_id`). */
const logFinish = () =>
  db
    .chainsFor("payment_webhook_events")
    .find(
      (c) =>
        c.has("update") &&
        c.calls.some((call) => call.method === "eq" && call.args[0] === "event_id"),
    )
    ?.argsOf("update")?.[0];

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  h.sync.mockReset();
  h.emails.subscription.mockClear();
  h.emails.payment.mockClear();
  db = supabaseFromStub();
  subscriptions = rowStore({
    unique: ["provider_subscription_id"],
    timestamps: ["last_event_at"],
  });
  entitlements = rowStore({ unique: ["external_ref"] });
  db.setResponse("subscriptions", (chain) => subscriptions.respond(chain));
  db.setResponse("user_subscriptions", (chain) => entitlements.respond(chain));
  // Dziennik webhooków: wstawienie wiersza = zdarzenie przejęte, domknięcie OK.
  db.setResponse("payment_webhook_events", ok(null));
  db.setResponse(
    "access_plans",
    ok({ id: "plan-pro-m", ...OWNER, price_cents: 9900, currency: "PLN" }),
  );
  db.setResponse("profiles", ok({ email: "kupujacy@example.com", tenant_id: OWNER.tenant_id }));
  db.setResponse("crm_leads", ok(null));
  db.setResponse("notifications", ok(null));
  db.setResponse("newsletter_subscribers", ok(null));
  db.setResponse("member_organizations", ok(null));
  db.setResponse("payment_orders", ok(null));
  db.setResponse("billing_documents", ok(null));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("webhook płatności na produkcji - środowisko zdarzenia (PAY-05)", () => {
  // KRYTERIUM PAY-05.
  it("produkcja + zdarzenie piaskownicy: `syncEntitlementState` nie biegnie, tylko ślad księgowy", async () => {
    subscriptions.rows.push(pausedSubscription("sandbox"));
    h.event.value = subscriptionEvent(
      "customer.subscription.resumed",
      "active",
      "evt_sandbox_wznowienie",
    );

    const res = await handle(request("sandbox"));

    expect(res.status).toBe(200);
    expect(h.sync).not.toHaveBeenCalled();
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(touched("crm_leads")).toHaveLength(0);
    expect(touched("notifications")).toHaveLength(0);
    expect(h.emails.subscription).not.toHaveBeenCalled();
    // Ślad księgowy JEST - sonda nocna widzi, że webhook piaskownicy żyje.
    expect(subscriptions.rows[0]).toMatchObject({
      environment: "sandbox",
      status: "active",
      last_event_id: "evt_sandbox_wznowienie",
    });
    expect(logFinish()).toMatchObject({ status: "processed", error: null });
  });

  it("produkcja + nowa subskrypcja z piaskownicy: wiersz księgowy, żadnego uprawnienia", async () => {
    h.event.value = subscriptionEvent(
      "customer.subscription.created",
      "active",
      "evt_sandbox_utworzenie",
    );

    const res = await handle(request("sandbox"));

    expect(res.status).toBe(200);
    expect(subscriptions.rows).toEqual([
      expect.objectContaining({
        environment: "sandbox",
        user_id: OWNER.user_id,
        last_event_id: "evt_sandbox_utworzenie",
      }),
    ]);
    expect(h.sync).not.toHaveBeenCalled();
    expect(entitlements.rows).toHaveLength(0);
    expect(h.emails.subscription).not.toHaveBeenCalled();
  });

  it("produkcja + opłacona sesja Checkout z piaskownicy: `skipped`, zero zapisów poza dziennikiem", async () => {
    h.event.value = {
      id: "evt_sandbox_kasa",
      type: "checkout.session.completed",
      created: CREATED_S,
      data: {
        object: {
          id: "cs_test_kasa",
          mode: "payment",
          payment_status: "paid",
          amount_total: 4900,
          currency: "pln",
          metadata: { orderId: "order-1", purpose: "content" },
        },
      },
    };

    const res = await handle(request("sandbox"));

    expect(res.status).toBe(200);
    expect(logFinish()).toMatchObject({ status: "skipped" });
    expect([...new Set(db.chains.map((c) => c.table))]).toEqual(["payment_webhook_events"]);
  });

  // Lustro kryterium: brama środowiska nie może odciąć produkcji od jej własnych pieniędzy.
  it("produkcja + zdarzenie `live`: uprawnienie synchronizuje się jak dotąd", async () => {
    subscriptions.rows.push(pausedSubscription("live"));
    h.event.value = subscriptionEvent(
      "customer.subscription.resumed",
      "active",
      "evt_live_wznowienie",
    );

    const res = await handle(request("live"));

    expect(res.status).toBe(200);
    expect(h.sync).toHaveBeenCalledWith(
      expect.objectContaining({ externalRef: "sub_kupujacy", status: "active" }),
    );
    expect(entitlements.rows).toEqual([
      expect.objectContaining({ external_ref: "sub_kupujacy", status: "active" }),
    ]);
    expect(logFinish()).toMatchObject({ status: "processed" });
  });
});
