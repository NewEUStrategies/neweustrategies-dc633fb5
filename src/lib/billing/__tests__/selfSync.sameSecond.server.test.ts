// Synchronizacja na żądanie i zdarzenie operatora Z TEJ SAMEJ SEKUNDY (1.1) -
// przez PRAWDZIWY dyspozytor i strażnika kolejności.
//
// SCENARIUSZ Z PRZEGLĄDU. Tuż po kasie profil nie pokazuje planu, więc klient
// klika „Synchronizuj ze Stripe". Odczyt (10:00:00.300) widzi subskrypcję
// jeszcze `incomplete`; operator zaraz potem opłaca fakturę i wysyła
// `customer.subscription.updated` (`active`) ze stemplem 10:00:00. Dawny
// znacznik synchronizacji - „teraz" w milisekundach PO odczycie (10:00:00.900)
// - był NOWSZY od zdarzenia operatora, więc zdarzenie wypadało jako spóźnione:
// klient zapłacił i zostawał bez dostępu do następnego zdarzenia (miesiąc).
//
// ATRAPY NA GRANICACH: klient roli serwisowej (tabele w pamięci), SDK operatora
// i wysyłka maili. Normalizacja, dyspozytor, efekty zakupu i zapis uprawnień
// biegną PRAWDZIWYM kodem.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { rowStore, type RowStore } from "@/test/billing/rowStore";

let db: SupabaseFromStub;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));

const h = vi.hoisted(() => ({ remote: null as null | Record<string, unknown> }));

vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getStripeClient: async () => ({
    subscriptions: {
      search: async () => ({ data: [] }),
      retrieve: async () => {
        // Odczyt u operatora trwa - zegar idzie dalej (600 ms).
        vi.setSystemTime(new Date("2026-10-12T10:00:00.900Z"));
        return h.remote;
      },
    },
  }),
}));
vi.mock("@/lib/billing/notifications.server", () => ({
  notifySubscriptionEmail: async () => true,
  notifyPaymentEmail: async () => true,
}));

const { syncUserSubscriptionsFromProvider } = await import("@/lib/billing/selfSync.server");
const { normalizeStripeEvent } = await import("@/lib/billing/stripeEvents.server");
const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");

const USER = "4b1c2d3e-0000-4000-8000-00000000abcd";

function stripeSubscription(status: string): Record<string, unknown> {
  return {
    id: "sub_kasa",
    object: "subscription",
    customer: "cus_kasa",
    status,
    metadata: { userId: USER },
    items: {
      data: [
        {
          quantity: 1,
          current_period_start: Date.parse("2026-10-12T10:00:00.000Z") / 1000,
          current_period_end: Date.parse("2026-11-12T10:00:00.000Z") / 1000,
          price: { id: "price_pro", lookup_key: "pro_monthly", product: "prod_pro" },
        },
      ],
    },
  };
}

let subscriptions: RowStore;
let entitlements: RowStore;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T10:00:00.300Z"));
  db = supabaseFromStub();
  subscriptions = rowStore({
    unique: ["provider_subscription_id"],
    timestamps: ["last_event_at"],
  });
  entitlements = rowStore({ unique: ["external_ref"] });
  db.setResponse("subscriptions", (chain) => subscriptions.respond(chain));
  db.setResponse("user_subscriptions", (chain) => entitlements.respond(chain));
  db.setResponse(
    "access_plans",
    ok({ id: "plan-pro-m", tenant_id: "tenant-alfa", price_cents: 9900, currency: "PLN" }),
  );
  db.setResponse("profiles", ok({ email: "kupujacy@example.com", tenant_id: "tenant-alfa" }));
  for (const table of ["crm_leads", "notifications", "newsletter_subscribers"]) {
    db.setResponse(table, ok(null));
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe("synchronizacja na żądanie a zdarzenie operatora z tej samej sekundy (1.1)", () => {
  it("`updated` (active) ze stemplem sekundy odczytu jest ŚWIEŻE - klient dostaje dostęp", async () => {
    h.remote = stripeSubscription("incomplete");

    const sync = await syncUserSubscriptionsFromProvider("live", USER, ["sub_kasa"]);
    expect(sync.applied).toBe(1);
    expect(entitlements.rows[0]).toMatchObject({ status: "canceled" });

    const event = normalizeStripeEvent({
      id: "evt_oplacona",
      type: "customer.subscription.updated",
      created: Date.parse("2026-10-12T10:00:00.000Z") / 1000,
      data: { object: stripeSubscription("active") },
    });
    if (!event) throw new Error("test: zdarzenie poza zakresem integracji");

    const outcome = await dispatchWebhookEvent({
      eventId: "evt_oplacona",
      eventType: event.eventType,
      data: event.data,
      environment: "live",
      occurredAt: "2026-10-12T10:00:00.000Z",
    });

    expect(outcome).toBe("processed");
    expect(subscriptions.rows[0]).toMatchObject({
      status: "active",
      last_event_id: "evt_oplacona",
    });
    expect(entitlements.rows).toEqual([expect.objectContaining({ status: "active" })]);
  });
});
