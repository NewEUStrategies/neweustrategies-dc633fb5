// ZGODA Z CHECKOUTU PRZEZ CAŁY TOR WEBHOOKA (SUB-15).
//
// Zgoda wyrażona polem w checkoucie dociera do skutku zakupu WYŁĄCZNIE
// metadanymi subskrypcji operatora (`subscription_data.metadata` ->
// `customer.subscription.created`). Ten plik przybija cały tor naraz:
// surowy obiekt Stripe -> `normalizeStripeEvent` -> `dispatchWebhookEvent`
// -> `applyPurchaseEffects` -> wiersz `newsletter_subscribers`. Pęknięcie
// któregokolwiek ogniwa (zgubione pole w normalizacji, w kontekście zakupu)
// kończy się BRAKIEM zapisu - nigdy zgodą dopowiedzianą przez kod.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: klienta roli serwisowej, SDK operatora
// (bezpiecznik - żadna ścieżka nie ma prawa go wołać) i wysyłkę poczty.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedWebhookEvent } from "@/lib/stripe.server";
import {
  PREMIUM_NEWSLETTER_CONSENT,
  PREMIUM_NEWSLETTER_CONSENT_VERSION,
  premiumNewsletterConsentMetadata,
} from "@/lib/billing/premiumNewsletter";
import { accessPlan } from "@/test/billing/fixtures";
import {
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
} from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { FIXED_NOW_ISO, MINUTA, freezeClock, relativeIso } from "@/test/time";

let db: SupabaseFromStub;
let rpc: SupabaseRpcStub;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => db.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => rpc.rpc(name, args),
  },
}));

// `environmentGrantsAccess` (bramka środowisk PAY-05) zostaje prawdziwe -
// poza produkcją oba środowiska nadają skutki zakupu.
vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getStripeClient: () => {
    throw new Error("test: żaden przypadek nie ma prawa wołać operatora");
  },
  getStripeErrorMessage: (error: unknown) => String(error),
  resolveEnvironment: () => "sandbox",
}));

vi.mock("@/lib/email/transactional.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/transactional.server")>(
    "@/lib/email/transactional.server",
  );
  return { ...actual, sendTxEmail: () => Promise.resolve({ ok: true }) };
});

const { normalizeStripeEvent } = await import("@/lib/billing/stripeEvents.server");
const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");

freezeClock();

const TENANT = "tenant-alfa";
const USER = "user-kupujacy";
const ORDER = "order-zgoda-1";
const CONSENT_AT = relativeIso(-3 * MINUTA);

const TABLES = [
  "subscriptions",
  "user_subscriptions",
  "notifications",
  "crm_leads",
  "crm_consent_log",
  "member_organizations",
] as const;

const isWrite = (chain: RecordedChain) =>
  chain.has("insert") || chain.has("update") || chain.has("upsert");

/** Surowa subskrypcja Stripe (API Basil) z metadanymi z `subscription_data.metadata`. */
function stripeSubscription(metadata: Record<string, string>): VerifiedWebhookEvent {
  return {
    id: "evt_sub_created",
    type: "customer.subscription.created",
    created: 1_700_000_000,
    data: {
      object: {
        id: "sub_zgoda_1",
        customer: "cus_1",
        status: "active",
        cancel_at_period_end: false,
        metadata: { userId: USER, planId: "plan-pro", orderId: ORDER, ...metadata },
        items: {
          data: [
            {
              quantity: 1,
              current_period_start: 4_085_000_000,
              current_period_end: 4_087_000_000,
              price: {
                id: "price_1",
                lookup_key: "pro_monthly",
                product: { id: "prod_1", metadata: { lovable_external_id: "plan_pro" } },
              },
            },
          ],
        },
      },
    },
  };
}

async function deliver(event: VerifiedWebhookEvent): Promise<void> {
  const normalized = normalizeStripeEvent(event);
  if (!normalized) throw new Error("test: zdarzenie miało przejść normalizację");
  await dispatchWebhookEvent({
    eventType: normalized.eventType,
    data: normalized.data,
    environment: "sandbox",
    occurredAt: FIXED_NOW_ISO,
  });
}

beforeEach(() => {
  db = supabaseFromStub();
  rpc = supabaseRpcStub();
  for (const table of TABLES) db.setResponse(table, ok(null));
  // Tor `created` (SUB-02): wstawienie-jeśli-brak (`upsert(..., { ignoreDuplicates })
  // .select("id")`) i atomowe zajęcie potwierdzenia zakupu (`update(...).select("id")`)
  // zwracają zapisany wiersz - pusty wynik znaczyłby „wiersz już był" albo „potwierdzenie
  // już wysłane", czyli inny scenariusz niż pierwszy zakup, który ten plik przybija.
  db.setResponse("subscriptions", (chain) =>
    ok(isWrite(chain) && chain.has("select") ? [{ id: "sub-row-1" }] : null),
  );
  db.setResponse(
    "profiles",
    ok({
      email: "kupujacy@example.com",
      first_name: "Jan",
      last_name: null,
      display_name: null,
      tenant_id: TENANT,
      prefs: { language: "pl" },
    }),
  );
  db.setResponse(
    "access_plans",
    ok(accessPlan({ id: "plan-pro", tenant_id: TENANT, tier_key: "pro", name_pl: "Pro" })),
  );
  db.setResponse("newsletter_subscribers", (chain) =>
    ok(isWrite(chain) ? [{ id: "nl-nowy" }] : null),
  );
  rpc.setData("email_filter_suppressed", []);
});

describe("SUB-15: zgoda z checkoutu przez tor webhooka", () => {
  it("subskrypcja BEZ metadanych zgody: zakup przetworzony, lista nietknięta", async () => {
    await deliver(stripeSubscription({}));

    expect(db.chainsFor("subscriptions").some(isWrite)).toBe(true);
    expect(db.chainsFor("newsletter_subscribers").filter(isWrite)).toHaveLength(0);
    expect(rpc.callsFor("email_filter_suppressed")).toHaveLength(0);
  });

  it("niepełne metadane (sama wersja) to też brak zgody - kod jej nie dopowiada", async () => {
    await deliver(
      stripeSubscription({ newsletterConsentVersion: PREMIUM_NEWSLETTER_CONSENT_VERSION }),
    );

    expect(db.chainsFor("newsletter_subscribers").filter(isWrite)).toHaveLength(0);
  });

  it("metadane zgody z sesji: wiersz z dowodem powiązanym z zamówieniem i subskrypcją", async () => {
    await deliver(
      stripeSubscription(
        premiumNewsletterConsentMetadata({
          version: PREMIUM_NEWSLETTER_CONSENT_VERSION,
          lang: "en",
          at: CONSENT_AT,
        }),
      ),
    );

    const insert = db.chainsFor("newsletter_subscribers").find((c) => c.has("upsert"));
    const row = insert?.argsOf("upsert")?.[0] as { consents?: unknown[] } | undefined;
    expect(row).toMatchObject({ tenant_id: TENANT, user_id: USER, language: "en" });
    expect(row?.consents).toEqual([
      expect.objectContaining({
        key: PREMIUM_NEWSLETTER_CONSENT,
        given: true,
        version: PREMIUM_NEWSLETTER_CONSENT_VERSION,
        lang: "en",
        timestamp: CONSENT_AT,
        subscription_id: "sub_zgoda_1",
        order_id: ORDER,
      }),
    ]);
  });
});
