// Alarm o DRUGIEJ żywej subskrypcji planu tego samego konta (siatka
// bezpieczeństwa webhooka za strażnikiem kasy).
//
// DLACZEGO TEN PLIK. Kasa blokuje drugi plan tylko na swojej ścieżce. Panel
// operatora, skrajny wyścig i świadomie dopuszczony osobny zakup w innym
// modelu rozliczenia (Zespół za miejsce <-> plan indywidualny) zakładały
// drugą subskrypcję bez śladu u organizatora - podwójne obciążenie wychodziło
// dopiero w reklamacji. Każdy przypadek niżej przybija jedną granicę:
//   * ten sam model -> ostrzeżenie RAZ (ponowienie zdarzenia nie dzwoni),
//   * `created(incomplete)` -> `updated(active)` po 3DS -> ostrzeżenie przy
//     aktywacji (w obie strony), ponowienie aktywacji nie dzwoni,
//   * subskrypcja z panelu bez `metadata.userId` -> właściciel z naszych
//     wierszy tego klienta, ostrzeżenie; powtórka tego dnia nie dzwoni,
//   * sprawdzenia widzące się nawzajem (także RÓWNOLEGLE, przy nieatomowym
//     `enqueue_notification`) -> ten sam klucz, atomowa bramka, jeden dzwonek,
//   * darowizna -> cisza (nowa z `purpose`, istniejąca z rejestru darowizn),
//   * inny model rozliczenia -> alarm INFORMACYJNY,
//   * jedna subskrypcja -> cisza, ale sprawdzenie naprawdę się odbyło,
//   * awaria albo zawieszenie alarmu -> webhook i tak przetworzony; chwilowa
//     awaria odczytu ponawia się w tle, awaria bramki nie wycisza dzwonka.
//
// ATRAPUJEMY GRANICE: klienta Supabase, SDK operatora (bezpiecznik - nic tu
// nie ma prawa niczego anulować u operatora) i `waitUntil` środowiska
// Workers, żeby test mógł dokończyć pracę „za odpowiedzią" deterministycznie.
// Dispatch, efekty zakupu, `notifyTenantAdmins` i `rateLimit` biegną
// prawdziwym kodem; `enqueue_notification` i `rate_limit_hit` odwzorowują
// semantykę SQL (pierwsza nieatomowo, druga atomowo).
//
// RODO: adresy syntetyczne (`example.com`), identyfikatory zmyślone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
  type TableResponder,
} from "@/test/supabase/chain";
import { supabaseRpcStub, type RecordedRpc, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { accessPlan } from "@/test/billing/fixtures";
import type { SubscriptionData } from "@/lib/billing/webhookDispatch.server";

const h = vi.hoisted(() => ({
  /** Praca zarejestrowana „za odpowiedzią" (atrapa `ctx.waitUntil`). */
  background: [] as Promise<unknown>[],
}));

let db: SupabaseFromStub;
let rpc: SupabaseRpcStub;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => db.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => rpc.rpc(name, args),
  },
}));

// Bezpiecznik: alarm NIGDY nie anuluje subskrypcji u operatora. Gdyby którakolwiek
// ścieżka sięgnęła po klienta Stripe, test poleci z jawnym komunikatem.
// `environmentGrantsAccess` zostaje PRAWDZIWE (czysta funkcja bramki PAY-05,
// poza produkcją oba środowiska nadają dostęp) - jak w teście cyklu życia.
vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getConnectionApiKey: () => "test_klucz_atrapy",
  getWebhookSecret: () => "test_sekret_atrapy",
  getStripeClient: async () => {
    throw new Error("test: alarm o drugiej subskrypcji nie ma prawa wołać operatora");
  },
  getStripeErrorMessage: (error: unknown) => String(error),
  resolveEnvironment: () => "sandbox",
  verifyWebhook: () => {
    throw new Error("test: weryfikacja podpisu nie należy do tej warstwy");
  },
}));

// `ctx.waitUntil` to granica środowiska: zbieramy obietnice, żeby test mógł je
// dokończyć PO powrocie dispatchu - dokładnie tak, jak runtime po odpowiedzi.
vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>) => {
    h.background.push(work.catch(() => undefined));
  },
}));

const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");
const {
  alertOnDuplicatePlanSubscription,
  alertOnUnmirroredPlanSubscription,
  duplicatePlanAlertHref,
  duplicatePlanAlertKey,
  duplicatePlanSeverity,
} = await import("@/lib/billing/duplicateSubscriptionAlert.server");

const TENANT = "tenant-a";
const BUYER = "user-kupujacy";
const ADMIN = "admin-najemcy";
const NEW_SUB = "sub_nowa";
const OLD_SUB = "sub_stara";
const OCCURRED_AT = "2026-10-13T10:00:00.000Z";

const TABLES = [
  "subscriptions",
  "user_subscriptions",
  "access_plans",
  "payment_orders",
  "billing_documents",
  "billing_profiles",
  "donations",
  "notifications",
  "crm_leads",
  "crm_consent_log",
  "newsletter_subscribers",
  "member_organizations",
  "organization_seats",
  "event_rsvps",
  "membership_grants",
] as const;

interface LiveRow {
  provider_subscription_id: string;
  price_id: string;
  status: string;
}

interface Scenario {
  /** Czy wstawienie-jeśli-brak zapisało wiersz (`false` = ponowienie, wiersz już był). */
  inserted: boolean;
  /** Żywe subskrypcje planu, które zwraca odczyt „czy jest druga". */
  live: LiveRow[];
  liveError?: string;
  /** Ile PIERWSZYCH odczytów „czy jest druga" pada (chwilowa awaria bazy). */
  liveFailures?: number;
  /** Odczyt zawieszony na zawsze (alarm, który się nie kończy). */
  liveHangs?: boolean;
  /** Identyfikatory znane rejestrowi darowizn. */
  donationIds: string[];
  userRolesError?: string;
  /** Błąd bramki jednokrotności (`rate_limit_hit`). */
  gateError?: string;
}

let scenario: Scenario;

/** Wiersz po pierwszym przebiegu - dla ponowienia, które idzie torem aktualizacji. */
const EXISTING_ROW = {
  id: "row-nowy",
  user_id: BUYER,
  tenant_id: TENANT,
  price_id: "pro_monthly",
  status: "active",
  current_period_start: "2026-10-01T00:00:00.000Z",
  current_period_end: "2026-11-01T00:00:00.000Z",
  first_payment_failed_at: null,
  purchase_confirmed_at: OCCURRED_AT,
  last_event_at: OCCURRED_AT,
};

/** Odczyt „czy konto ma INNĄ żywą subskrypcję planu" - jedyny z `neq` po identyfikatorze. */
const isLiveLookup = (chain: RecordedChain): boolean =>
  chain.argsOf("neq")?.[0] === "provider_subscription_id";

function subscriptionsResponder(): TableResponder {
  return (chain) => {
    if (chain.has("upsert") && chain.has("select")) {
      // RETURNING niesie najemcę przypiętego triggerem z profilu właściciela.
      return ok(scenario.inserted ? [{ id: "row-nowy", tenant_id: TENANT, user_id: BUYER }] : []);
    }
    if (chain.has("update") && chain.has("select")) return ok([{ id: "row-nowy" }]);
    if (isLiveLookup(chain)) {
      if (scenario.liveHangs) return new Promise<SupabaseResult>(() => undefined);
      if (scenario.liveFailures && scenario.liveFailures > 0) {
        scenario.liveFailures -= 1;
        return fail("connection reset");
      }
      if (scenario.liveError) return fail(scenario.liveError);
      // Jak SQL: `neq` wyklucza subskrypcję, która właśnie się sprawdza.
      const self = chain.argsOf("neq")?.[1];
      return ok(scenario.live.filter((row) => row.provider_subscription_id !== self));
    }
    if (chain.has("maybeSingle")) return ok(scenario.inserted ? null : EXISTING_ROW);
    return ok(null);
  };
}

function donationsResponder(): TableResponder {
  return (chain) => {
    if (!chain.has("in")) return ok(null);
    const ids = (chain.argsOf("in")?.[1] ?? []) as string[];
    return ok(
      ids
        .filter((id) => scenario.donationIds.includes(id))
        .map((id) => ({ provider_subscription_id: id })),
    );
  };
}

/** Deduplikacja `enqueue_notification`: (odbiorca, rodzaj, href) - jak w SQL. */
let deliveredKeys: Set<string>;
/** Licznik `rate_limits` (zakres, podmiot) - atomowy, jak INSERT ... ON CONFLICT DO UPDATE. */
let gateHits: Map<string, number>;
/** Stan lustra `subscriptions` w scenariuszach wielozdarzeniowych (`null` = odpowiedzi ze `scenario`). */
let mirror: Map<string, MirrorRow> | null;

interface MirrorRow {
  id: string;
  provider_subscription_id: string;
  provider_customer_id: string;
  user_id: string;
  tenant_id: string;
  environment: string;
  price_id: string;
  product_id: string;
  status: string;
  quantity: number;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  cancel_at_period_end: boolean;
  pause_collection_behavior: string | null;
  first_payment_failed_at: string | null;
  purchase_confirmed_at: string | null;
  last_event_at: string | null;
  /** Identyfikator zdarzenia z pary strażnika (po nim strażnik rozpoznaje powtórkę). */
  last_event_id?: string | null;
  last_payment_at: string | null;
}

function eqFilters(chain: RecordedChain): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const call of chain.calls) {
    if (call.method === "eq") out[String(call.args[0])] = call.args[1];
  }
  return out;
}

/**
 * Lustro `subscriptions` ze stanem: wstawienie-jeśli-brak, strażnik kolejności
 * (`last_event_at < stamp`, para znacznik + identyfikator zdarzenia), zapis
 * stanu warunkiem na tę parę, atomowe zajęcie `purchase_confirmed_at`
 * i odczyty z filtrami - po to, żeby `created(incomplete)` -> `updated(active)`
 * szło przez dispatch dokładnie tymi zapytaniami, którymi idzie w produkcji.
 */
function mirrorResponder(rows: Map<string, MirrorRow>): TableResponder {
  return (chain) => {
    const eq = eqFilters(chain);
    const id = typeof eq.provider_subscription_id === "string" ? eq.provider_subscription_id : null;
    const target = id ? rows.get(id) : undefined;
    const inEnv = (row: MirrorRow) =>
      eq.environment === undefined || row.environment === eq.environment;

    if (chain.has("upsert")) {
      const values = chain.argsOf("upsert")?.[0] as Partial<MirrorRow> & {
        provider_subscription_id: string;
      };
      if (rows.has(values.provider_subscription_id)) return ok([]);
      // Najemcę przypina trigger z profilu właściciela - nie ładunek.
      const row = {
        trial_ends_at: null,
        first_payment_failed_at: null,
        last_event_at: null,
        ...values,
        id: `row-${values.provider_subscription_id}`,
        tenant_id: TENANT,
        purchase_confirmed_at: null,
        last_payment_at: null,
      } as MirrorRow;
      rows.set(row.provider_subscription_id, row);
      return ok([{ id: row.id, tenant_id: row.tenant_id, user_id: row.user_id }]);
    }
    if (chain.has("update")) {
      const patch = (chain.argsOf("update")?.[0] ?? {}) as Partial<MirrorRow>;
      const none = ok(chain.has("select") ? [] : null);
      if (!target || !inEnv(target)) return none;
      const isNull = chain.argsOf("is")?.[0];
      if (isNull === "purchase_confirmed_at") {
        // `claimPurchaseConfirmation`: UPDATE ... WHERE purchase_confirmed_at IS NULL.
        if (target.purchase_confirmed_at) return ok([]);
        Object.assign(target, patch);
        return ok([{ id: target.id }]);
      }
      if (chain.has("or")) {
        // Strażnik kolejności: zajęcie tylko starszego (albo pustego) znacznika -
        // razem z identyfikatorem zdarzenia (para strażnika).
        const stamp = Date.parse(String(patch.last_event_at));
        if (target.last_event_at && Date.parse(target.last_event_at) >= stamp) return ok([]);
        Object.assign(target, patch);
        return ok([{ id: target.id }]);
      }
      if ("last_event_at" in eq) {
        // Zapis warunkiem na zajęcie (`commitSubscriptionState`, remis): tylko
        // gdy para w wierszu wciąż jest TEGO zdarzenia.
        const sameId =
          isNull === "last_event_id"
            ? (target.last_event_id ?? null) === null
            : !("last_event_id" in eq) || target.last_event_id === eq.last_event_id;
        if (target.last_event_at !== eq.last_event_at || !sameId) return none;
        Object.assign(target, patch);
        return ok(chain.has("select") ? [{ id: target.id }] : null);
      }
      Object.assign(target, patch);
      return ok(null);
    }
    if (isLiveLookup(chain)) {
      const statuses = (chain.argsOf("in")?.[1] ?? []) as string[];
      const self = chain.argsOf("neq")?.[1];
      return ok(
        [...rows.values()]
          .filter(
            (row) =>
              row.tenant_id === eq.tenant_id &&
              row.user_id === eq.user_id &&
              row.environment === eq.environment &&
              statuses.includes(row.status) &&
              row.provider_subscription_id !== self,
          )
          .map((row) => ({
            provider_subscription_id: row.provider_subscription_id,
            price_id: row.price_id,
            status: row.status,
          })),
      );
    }
    if (typeof eq.provider_customer_id === "string") {
      return ok(
        [...rows.values()]
          .filter((row) => row.provider_customer_id === eq.provider_customer_id && inEnv(row))
          .map((row) => ({
            provider_subscription_id: row.provider_subscription_id,
            user_id: row.user_id,
            tenant_id: row.tenant_id,
          })),
      );
    }
    if (chain.has("maybeSingle")) return ok(target && inEnv(target) ? { ...target } : null);
    return ok(null);
  };
}

/** Żywa, potwierdzona subskrypcja planu, którą konto już ma. */
function liveMirrorRow(overrides: Partial<MirrorRow> = {}): MirrorRow {
  return {
    id: `row-${OLD_SUB}`,
    provider_subscription_id: OLD_SUB,
    provider_customer_id: "cus_atrapa",
    user_id: BUYER,
    tenant_id: TENANT,
    environment: "live",
    price_id: "pro_monthly",
    product_id: "plan_pro",
    status: "active",
    quantity: 1,
    current_period_start: "2026-09-20T00:00:00.000Z",
    current_period_end: "2026-10-20T00:00:00.000Z",
    trial_ends_at: null,
    cancel_at_period_end: false,
    pause_collection_behavior: null,
    first_payment_failed_at: null,
    purchase_confirmed_at: "2026-09-20T00:00:00.000Z",
    last_event_at: "2026-09-20T00:00:00.000Z",
    last_payment_at: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

function useMirror(rows: MirrorRow[]): Map<string, MirrorRow> {
  mirror = new Map(rows.map((row) => [row.provider_subscription_id, row]));
  db.setResponse("subscriptions", mirrorResponder(mirror));
  return mirror;
}

beforeEach(() => {
  h.background.length = 0;
  scenario = { inserted: true, live: [], donationIds: [] };
  deliveredKeys = new Set();
  gateHits = new Map();
  mirror = null;
  db = supabaseFromStub();
  rpc = supabaseRpcStub();
  for (const table of TABLES) db.setResponse(table, ok(null));
  db.setResponse("subscriptions", subscriptionsResponder());
  // Plan najemcy dla ceny zdarzenia - bez niego uprawnienie nie powstaje, a test
  // „awaria alarmu nie odbiera dostępu" nie miałby czego sprawdzić.
  db.setResponse("access_plans", (chain) => {
    const tier = chain.calls.find((c) => c.method === "eq" && c.args[0] === "tier_key")?.args[1];
    return ok(
      accessPlan({ id: `plan-${String(tier)}`, tenant_id: TENANT, tier_key: String(tier) }),
    );
  });
  db.setResponse("donations", donationsResponder());
  db.setResponse("user_roles", () =>
    scenario.userRolesError ? fail(scenario.userRolesError) : ok([{ user_id: ADMIN }]),
  );
  db.setResponse("profiles", (chain) =>
    chain.has("in")
      ? ok([{ id: ADMIN }])
      : ok({
          email: "kupujacy@example.com",
          first_name: "Jan",
          last_name: null,
          display_name: null,
          tenant_id: TENANT,
          prefs: { language: "pl" },
        }),
  );
  rpc.setData("email_filter_suppressed", []);
  rpc.setData("org_apply_subscription_seats", { linked: false });
  // Wiernie jak SQL (20260926153300): `IF EXISTS (...) THEN RETURN NULL; END IF;
  // INSERT ...` BEZ blokady - pod READ COMMITTED dwa równoległe wywołania mijają
  // się między sprawdzeniem a zapisem i oba wstawiają dzwonek.
  rpc.setResponse("enqueue_notification", async (call: RecordedRpc) => {
    const key = `${String(call.arg("p_user_id"))}|${String(call.arg("p_kind"))}|${String(call.arg("p_href"))}`;
    const exists = deliveredKeys.has(key);
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (exists) return ok(null);
    deliveredKeys.add(key);
    return ok(`notif-${deliveredKeys.size}`);
  });
  // `rate_limit_hit`: INSERT ... ON CONFLICT DO UPDATE SET count = count + 1
  // RETURNING - drugie wywołanie czeka na blokadę wiersza i widzi licznik 2.
  rpc.setResponse("rate_limit_hit", (call: RecordedRpc) => {
    if (scenario.gateError) return fail(scenario.gateError);
    const key = `${String(call.arg("_scope"))}|${String(call.arg("_subject"))}`;
    const hits = (gateHits.get(key) ?? 0) + 1;
    gateHits.set(key, hits);
    return ok([
      { allowed: hits <= Number(call.arg("_max")), hits, bucket_start: "2026-10-13T00:00:00Z" },
    ]);
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Dokończ pracę „za odpowiedzią" - jak runtime po wysłaniu odpowiedzi. */
async function settleBackground(): Promise<void> {
  while (h.background.length > 0) await h.background.shift();
}

function createdEvent(overrides: Partial<SubscriptionData> = {}, priceId = "pro_monthly") {
  const productId = priceId === "team_monthly_seat" ? "plan_team" : "plan_pro";
  const data: SubscriptionData = {
    id: NEW_SUB,
    customerId: "cus_atrapa",
    status: "active",
    customData: { userId: BUYER },
    currentBillingPeriod: {
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-11-01T00:00:00.000Z",
    },
    items: [
      {
        quantity: 1,
        price: { id: "price_atrapa", externalId: priceId },
        product: { id: "prod_atrapa", externalId: productId },
      },
    ],
    ...overrides,
  };
  return data;
}

/**
 * Identyfikator zdarzenia operatora: ten sam typ, subskrypcja i chwila = TO
 * SAMO zdarzenie (ponowna dostawa, ponowienie z panelu). Trasa podaje go
 * dyspozytorowi, a strażnik kolejności rozpoznaje po nim powtórkę (`replay`) -
 * bez niego każda powtórka byłaby remisem rozstrzyganym u operatora.
 */
const eventIdOf = (eventType: string, data: SubscriptionData, occurredAt: string): string =>
  `evt_${eventType}_${data.id}_${occurredAt}`;

async function deliverCreated(
  data: SubscriptionData,
  environment: "live" | "sandbox" = "live",
): Promise<string> {
  return dispatchWebhookEvent({
    eventId: eventIdOf("subscription.created", data, OCCURRED_AT),
    eventType: "subscription.created",
    data,
    environment,
    occurredAt: OCCURRED_AT,
  });
}

/** Dzwonki alarmu o drugiej subskrypcji (inne `enqueue_notification` się nie liczą). */
const duplicateBells = (): RecordedRpc[] =>
  rpc
    .callsFor("enqueue_notification")
    .filter((call) => String(call.arg("p_href")).includes("duplicate_subscriptions="));

const liveLookups = (): RecordedChain[] => db.chainsFor("subscriptions").filter(isLiveLookup);

const loggedWith = (spy: unknown, message: string): unknown[][] =>
  (spy as { mock: { calls: unknown[][] } }).mock.calls.filter((args) => args[0] === message);

describe("webhook: druga żywa subskrypcja planu w tym samym modelu", () => {
  it("ostrzega administratorów RAZ, a ponowienie tego samego zdarzenia nie dzwoni drugi raz", async () => {
    scenario.live = [
      { provider_subscription_id: OLD_SUB, price_id: "pro_monthly", status: "active" },
    ];

    expect(await deliverCreated(createdEvent())).toBe("processed");
    await settleBackground();

    // Zakres z WIERSZA W BAZIE (RETURNING) - ładunek nie niesie najemcy.
    const [lookup] = liveLookups();
    expect(lookup?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["tenant_id", TENANT],
      ["user_id", BUYER],
      ["environment", "live"],
    ]);
    expect(lookup?.argsOf("in")).toEqual([
      "status",
      ["active", "trialing", "past_due", "unpaid", "paused"],
    ]);
    expect(lookup?.argsOf("neq")).toEqual(["provider_subscription_id", NEW_SUB]);

    const bells = duplicateBells();
    expect(bells).toHaveLength(1);
    expect(bells[0]?.arg("p_user_id")).toBe(ADMIN);
    expect(bells[0]?.arg("p_kind")).toBe("billing");
    expect(bells[0]?.arg("p_title_pl")).toBe("Druga aktywna subskrypcja planu");
    expect(bells[0]?.arg("p_href")).toBe(
      "/admin/billing?duplicate_subscriptions=sub_nowa,sub_stara",
    );
    expect(String(bells[0]?.arg("p_body_pl"))).toContain(NEW_SUB);
    expect(String(bells[0]?.arg("p_body_pl"))).toContain(OLD_SUB);
    // Głośny log z obiema subskrypcjami - ślad zostaje, nawet gdy dzwonek padnie.
    expect(loggedWith(console.error, "[payments] duplicate live plan subscription")).toEqual([
      [
        "[payments] duplicate live plan subscription",
        expect.objectContaining({
          subscriptionId: NEW_SUB,
          otherSubscriptionIds: [OLD_SUB],
          tenantId: TENANT,
          environment: "live",
          severity: "warning",
        }),
      ],
    ]);
    // Nic nie anulowano: żaden zapis nie zmienia statusu na `canceled`.
    const cancelWrites = db
      .chainsFor("subscriptions")
      .filter((c) => c.has("update"))
      .filter((c) => (c.argsOf("update")?.[0] as { status?: string })?.status === "canceled");
    expect(cancelWrites).toHaveLength(0);

    // Ponowienie (operator albo panel admina): wiersz już jest -> tor aktualizacji.
    scenario.inserted = false;
    expect(await deliverCreated(createdEvent())).toBe("processed");
    await settleBackground();

    expect(liveLookups()).toHaveLength(1);
    expect(duplicateBells()).toHaveLength(1);
  });

  it("dwa sprawdzenia widzące się nawzajem (po kolei) dają TEN SAM klucz i jeden dzwonek", async () => {
    scenario.live = [
      { provider_subscription_id: OLD_SUB, price_id: "pro_monthly", status: "active" },
    ];
    const first = await alertOnDuplicatePlanSubscription({
      subscriptionId: NEW_SUB,
      userId: BUYER,
      tenantId: TENANT,
      environment: "live",
      priceId: "pro_monthly",
      status: "active",
    });
    scenario.live = [
      { provider_subscription_id: NEW_SUB, price_id: "pro_monthly", status: "active" },
    ];
    const second = await alertOnDuplicatePlanSubscription({
      subscriptionId: OLD_SUB,
      userId: BUYER,
      tenantId: TENANT,
      environment: "live",
      priceId: "pro_monthly",
      status: "trialing",
    });

    expect(first).toMatchObject({ kind: "alerted", severity: "warning", delivered: 1 });
    // Drugie sprawdzenie zatrzymuje atomowa bramka - do `enqueue_notification` nie dochodzi.
    expect(second).toMatchObject({ kind: "deduped", severity: "warning" });
    expect(first.kind === "alerted" && first.dedupeKey).toBe("sub_nowa,sub_stara");
    expect(second.kind === "deduped" && second.dedupeKey).toBe("sub_nowa,sub_stara");
    expect(duplicateBells().map((call) => call.arg("p_href"))).toEqual([
      "/admin/billing?duplicate_subscriptions=sub_nowa,sub_stara",
    ]);
  });

  it("klucz deduplikacji nie zależy od kolejności i nie dubluje identyfikatorów", () => {
    expect(duplicatePlanAlertKey(["sub_b", "sub_a", "sub_b"])).toBe("sub_a,sub_b");
    expect(duplicatePlanAlertKey(["sub_a", "sub_b"])).toBe(
      duplicatePlanAlertKey(["sub_b", "sub_a"]),
    );
    expect(duplicatePlanAlertHref("sub_a,sub_b")).toBe(
      "/admin/billing?duplicate_subscriptions=sub_a,sub_b",
    );
  });
});

describe("webhook: darowizna nie jest drugim planem", () => {
  it("istniejący wiersz znany rejestrowi darowizn nie podnosi alarmu", async () => {
    scenario.live = [
      { provider_subscription_id: "sub_darowizna", price_id: "donation_monthly", status: "active" },
    ];
    scenario.donationIds = ["sub_darowizna"];

    expect(await deliverCreated(createdEvent())).toBe("processed");
    await settleBackground();

    // Sprawdzenie naprawdę się odbyło i zapytało rejestr darowizn w tym zakresie.
    expect(liveLookups()).toHaveLength(1);
    const ledger = db.chainsFor("donations").find((c) => c.has("in"));
    expect(ledger?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["tenant_id", TENANT],
      ["environment", "live"],
    ]);
    expect(ledger?.argsOf("in")).toEqual(["provider_subscription_id", ["sub_darowizna"]]);
    expect(duplicateBells()).toHaveLength(0);
    expect(db.chainsFor("user_roles")).toHaveLength(0);
  });

  it("nowa subskrypcja z `purpose = donation` w ogóle nie trafia do sprawdzenia", async () => {
    const outcome = await alertOnDuplicatePlanSubscription({
      subscriptionId: "sub_darowizna",
      userId: BUYER,
      tenantId: TENANT,
      environment: "live",
      priceId: "donation_monthly",
      status: "active",
      purpose: "donation",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "donation" });
    expect(db.chains).toHaveLength(0);
  });
});

describe("webhook: osobny zakup w innym modelu rozliczenia", () => {
  it("Zespół za miejsce obok planu indywidualnego daje alarm INFORMACYJNY", async () => {
    scenario.live = [
      { provider_subscription_id: OLD_SUB, price_id: "pro_monthly", status: "active" },
    ];

    expect(await deliverCreated(createdEvent({}, "team_monthly_seat"), "sandbox")).toBe(
      "processed",
    );
    await settleBackground();

    expect(liveLookups()[0]?.calls.find((c) => c.args[0] === "environment")?.args).toEqual([
      "environment",
      "sandbox",
    ]);
    const bells = duplicateBells();
    expect(bells).toHaveLength(1);
    expect(bells[0]?.arg("p_title_pl")).toBe("Informacja: osobny plan w innym modelu rozliczenia");
    expect(String(bells[0]?.arg("p_body_pl"))).toContain("środowisko testowe");
    expect(
      loggedWith(console.warn, "[payments] separate plan subscription in another billing model"),
    ).toEqual([
      [
        "[payments] separate plan subscription in another billing model",
        expect.objectContaining({ severity: "info", otherSubscriptionIds: [OLD_SUB] }),
      ],
    ]);
    // Niższa waga: żadnego ostrzeżenia o podwójnym obciążeniu.
    expect(loggedWith(console.error, "[payments] duplicate live plan subscription")).toHaveLength(
      0,
    );
  });

  it("waga wynika ze wspólnej reguły kasy: inny model = info, każdy inny konflikt = ostrzeżenie", () => {
    expect(duplicatePlanSeverity("pro_monthly", ["team_monthly_seat"])).toBe("info");
    expect(duplicatePlanSeverity("team_monthly_seat", ["plus_monthly"])).toBe("info");
    // Ten sam plan, zmiana planu i cena spoza katalogu - kasa by to zablokowała.
    expect(duplicatePlanSeverity("pro_monthly", ["pro_monthly"])).toBe("warning");
    expect(duplicatePlanSeverity("pro_monthly", ["plus_monthly"])).toBe("warning");
    expect(duplicatePlanSeverity("pro_monthly", ["nieznany_klucz"])).toBe("warning");
    expect(duplicatePlanSeverity("nieznany_klucz", ["pro_monthly"])).toBe("warning");
    // Mieszanka: jeden prawdziwy duplikat wystarcza do ostrzeżenia.
    expect(duplicatePlanSeverity("pro_monthly", ["team_monthly_seat", "plus_annual"])).toBe(
      "warning",
    );
  });
});

describe("webhook: jedna subskrypcja", () => {
  it("bez innej żywej subskrypcji planu nie ma alarmu - choć sprawdzenie się odbyło", async () => {
    expect(await deliverCreated(createdEvent())).toBe("processed");
    await settleBackground();

    expect(liveLookups()).toHaveLength(1);
    expect(duplicateBells()).toHaveLength(0);
    expect(db.chainsFor("user_roles")).toHaveLength(0);
    expect(db.chainsFor("donations").filter((c) => c.has("in"))).toHaveLength(0);
  });

  it("subskrypcja bez dostępu (`incomplete`) nie jest jeszcze drugim opłaconym planem", async () => {
    scenario.live = [
      { provider_subscription_id: OLD_SUB, price_id: "pro_monthly", status: "active" },
    ];
    const outcome = await alertOnDuplicatePlanSubscription({
      subscriptionId: NEW_SUB,
      userId: BUYER,
      tenantId: TENANT,
      environment: "live",
      priceId: "pro_monthly",
      status: "incomplete",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "not_entitled" });
    expect(db.chains).toHaveLength(0);
  });
});

describe("webhook: awaria alarmu nie dotyka obsługi zdarzenia", () => {
  const entitlementWrites = (): RecordedChain[] =>
    db
      .chainsFor("user_subscriptions")
      .filter((c) => c.has("insert") || c.has("update") || c.has("upsert"));

  it("błąd odczytu: zdarzenie przetworzone, uprawnienie nadane, błąd w logu", async () => {
    scenario.liveError = "connection reset";

    expect(await deliverCreated(createdEvent())).toBe("processed");
    await settleBackground();

    expect(entitlementWrites().length).toBeGreaterThan(0);
    expect(duplicateBells()).toHaveLength(0);
    expect(
      loggedWith(console.error, "[payments] duplicate plan subscription check failed"),
    ).toEqual([
      [
        "[payments] duplicate plan subscription check failed",
        {
          subscriptionId: NEW_SUB,
          error: "live plan subscriptions lookup failed: connection reset",
        },
      ],
    ]);
  });

  it("błąd dzwonka: zdarzenie przetworzone, a duplikat i tak zostaje w logu", async () => {
    scenario.live = [
      { provider_subscription_id: OLD_SUB, price_id: "pro_monthly", status: "active" },
    ];
    scenario.userRolesError = "permission denied";

    expect(await deliverCreated(createdEvent())).toBe("processed");
    await settleBackground();

    expect(entitlementWrites().length).toBeGreaterThan(0);
    expect(duplicateBells()).toHaveLength(0);
    expect(loggedWith(console.error, "[payments] duplicate live plan subscription")).toHaveLength(
      1,
    );
    expect(loggedWith(console.error, "[tenantAdminAlert] alert failed")).toHaveLength(1);
  });

  it("zawieszony alarm nie wstrzymuje webhooka - biegnie za odpowiedzią", async () => {
    scenario.live = [
      { provider_subscription_id: OLD_SUB, price_id: "pro_monthly", status: "active" },
    ];
    scenario.liveHangs = true;

    // Dispatch wraca, choć odczyt alarmu nigdy się nie kończy.
    expect(await deliverCreated(createdEvent())).toBe("processed");
    expect(entitlementWrites().length).toBeGreaterThan(0);
    expect(h.background).toHaveLength(1);
    // Odczyt ruszył - alarm nie został po prostu pominięty.
    await vi.waitFor(() => expect(liveLookups()).toHaveLength(1));
    h.background.length = 0;
  });
});

// ---------------------------------------------------------------------------
// Przegląd poprawek: aktywacja po 3DS, panel operatora, równoległe sprawdzenia.
// ---------------------------------------------------------------------------

/** Aktywacja po 3DS / przelewie - kilka sekund po `created`. */
const ACTIVATED_AT = "2026-10-13T10:00:07.000Z";

async function deliver(
  eventType: string,
  data: SubscriptionData,
  occurredAt: string,
  environment: "live" | "sandbox" = "live",
): Promise<string> {
  return dispatchWebhookEvent({
    eventId: eventIdOf(eventType, data, occurredAt),
    eventType,
    data,
    environment,
    occurredAt,
  });
}

const liveLookupScope = (chain: RecordedChain | undefined) =>
  chain?.calls.filter((c) => c.method === "eq").map((c) => c.args);

describe("webhook: drugi plan aktywowany dopiero po 3DS (created incomplete -> updated active)", () => {
  it("ostrzega RAZ przy aktywacji, a ponowienie tej samej aktywacji nie dzwoni drugi raz", async () => {
    const rows = useMirror([liveMirrorRow()]);

    expect(await deliverCreated(createdEvent({ status: "incomplete" }))).toBe("processed");
    await settleBackground();
    // `incomplete` to jeszcze nie drugi opłacony plan - kasa unieważnia taką fakturę.
    expect(rows.get(NEW_SUB)?.status).toBe("incomplete");
    expect(duplicateBells()).toHaveLength(0);

    const activation = createdEvent({ status: "active" });
    expect(await deliver("subscription.activated", activation, ACTIVATED_AT)).toBe("processed");
    await settleBackground();

    // Pierwsze wejście w stan uprawniający = zajęcie potwierdzenia zakupu.
    expect(rows.get(NEW_SUB)?.purchase_confirmed_at).not.toBeNull();
    const [lookup] = liveLookups();
    // Zakres z WIERSZA (`existing.tenant_id` / `user_id`), nie z ładunku.
    expect(liveLookupScope(lookup)).toEqual([
      ["tenant_id", TENANT],
      ["user_id", BUYER],
      ["environment", "live"],
    ]);
    expect(lookup?.argsOf("neq")).toEqual(["provider_subscription_id", NEW_SUB]);
    const bells = duplicateBells();
    expect(bells).toHaveLength(1);
    expect(bells[0]?.arg("p_title_pl")).toBe("Druga aktywna subskrypcja planu");
    expect(bells[0]?.arg("p_href")).toBe(
      "/admin/billing?duplicate_subscriptions=sub_nowa,sub_stara",
    );

    // Ponowienie tej samej aktywacji: potwierdzenie już zajęte - bez drugiego sprawdzenia.
    await deliver("subscription.activated", activation, ACTIVATED_AT);
    await settleBackground();
    expect(liveLookups()).toHaveLength(1);
    expect(duplicateBells()).toHaveLength(1);
  });

  it("lustrzany przypadek: druga jeszcze `incomplete` przy pierwszym sprawdzeniu - alarm przy JEJ aktywacji", async () => {
    useMirror([
      liveMirrorRow({
        status: "incomplete",
        purchase_confirmed_at: null,
        last_payment_at: null,
        last_event_at: "2026-10-13T09:59:00.000Z",
      }),
    ]);

    // Nowa wchodzi od razu jako `active`: starsza (`incomplete`) nie jest żywym planem.
    expect(await deliverCreated(createdEvent())).toBe("processed");
    await settleBackground();
    expect(liveLookups()).toHaveLength(1);
    expect(duplicateBells()).toHaveLength(0);

    // Starsza kończy 3DS - teraz ONA widzi nową i dzwoni.
    const olderActivation = createdEvent({ id: OLD_SUB, status: "active" });
    expect(await deliver("subscription.activated", olderActivation, ACTIVATED_AT)).toBe(
      "processed",
    );
    await settleBackground();

    expect(liveLookups()).toHaveLength(2);
    expect(liveLookups()[1]?.argsOf("neq")).toEqual(["provider_subscription_id", OLD_SUB]);
    const bells = duplicateBells();
    expect(bells).toHaveLength(1);
    expect(bells[0]?.arg("p_href")).toBe(
      "/admin/billing?duplicate_subscriptions=sub_nowa,sub_stara",
    );
  });

  it("chwilowa awaria odczytu nie gubi jedynego sprawdzenia - ponawia je w tle", async () => {
    scenario.live = [
      { provider_subscription_id: OLD_SUB, price_id: "pro_monthly", status: "active" },
    ];
    scenario.liveFailures = 1;

    expect(await deliverCreated(createdEvent())).toBe("processed");
    await settleBackground();

    expect(liveLookups()).toHaveLength(2);
    expect(duplicateBells()).toHaveLength(1);
    expect(
      loggedWith(console.error, "[payments] duplicate plan subscription check failed"),
    ).toHaveLength(0);
  });
});

describe("webhook: subskrypcja z panelu operatora (bez `metadata.userId`)", () => {
  it("właściciela bierze z NASZYCH wierszy po kliencie operatora i ostrzega o drugim planie", async () => {
    const rows = useMirror([liveMirrorRow({ provider_customer_id: "cus_panel" })]);
    const panel = createdEvent({ customerId: "cus_panel", customData: {} });

    expect(await deliverCreated(panel)).toBe("processed");
    await settleBackground();

    // Bez właściciela w metadanych wiersz nie powstaje i dostęp nie idzie - jak dotąd.
    expect(rows.has(NEW_SUB)).toBe(false);
    expect(db.chainsFor("subscriptions").filter((c) => c.has("upsert"))).toHaveLength(0);
    const ownerLookup = db
      .chainsFor("subscriptions")
      .find((c) => eqFilters(c).provider_customer_id !== undefined);
    expect(ownerLookup && eqFilters(ownerLookup)).toEqual({
      provider_customer_id: "cus_panel",
      environment: "live",
    });
    expect(liveLookupScope(liveLookups()[0])).toEqual([
      ["tenant_id", TENANT],
      ["user_id", BUYER],
      ["environment", "live"],
    ]);
    const bells = duplicateBells();
    expect(bells).toHaveLength(1);
    expect(bells[0]?.arg("p_user_id")).toBe(ADMIN);
    expect(bells[0]?.arg("p_title_pl")).toBe("Subskrypcja planu spoza kasy obok żywego planu");
    expect(String(bells[0]?.arg("p_body_pl"))).toContain(NEW_SUB);
    expect(String(bells[0]?.arg("p_body_pl"))).toContain(OLD_SUB);
    expect(
      loggedWith(console.error, "[payments] unmirrored plan subscription next to a live plan"),
    ).toEqual([
      [
        "[payments] unmirrored plan subscription next to a live plan",
        expect.objectContaining({
          subscriptionId: NEW_SUB,
          otherSubscriptionIds: [OLD_SUB],
          tenantId: TENANT,
          environment: "live",
          severity: "warning",
        }),
      ],
    ]);

    // Klient, którego nie znamy: bez najemcy z bazy nie ma komu dzwonić - tylko log.
    await deliverCreated(createdEvent({ id: "sub_obca", customerId: "cus_obcy", customData: {} }));
    await settleBackground();
    expect(liveLookups()).toHaveLength(1);
    expect(duplicateBells()).toHaveLength(1);
  });

  it("`incomplete` -> `active` z panelu dzwoni przy aktywacji, a ponowienie tego samego dnia już nie", async () => {
    useMirror([liveMirrorRow({ provider_customer_id: "cus_panel" })]);
    const panel = { customerId: "cus_panel", customData: {} };

    await deliverCreated(createdEvent({ ...panel, status: "incomplete" }));
    await settleBackground();
    expect(duplicateBells()).toHaveLength(0);

    const activation = createdEvent({ ...panel, status: "active" });
    expect(await deliver("subscription.activated", activation, ACTIVATED_AT)).toBe("processed");
    await settleBackground();
    expect(duplicateBells()).toHaveLength(1);

    await deliver("subscription.activated", activation, ACTIVATED_AT);
    await settleBackground();
    expect(duplicateBells()).toHaveLength(1);
    expect(rpc.callsFor("rate_limit_hit").map((c) => [c.arg("_scope"), c.arg("_subject")])).toEqual(
      [
        ["billing.duplicate_plan_alert", `${TENANT}:live:sub_nowa,sub_stara`],
        ["billing.duplicate_plan_alert", `${TENANT}:live:sub_nowa,sub_stara`],
      ],
    );
  });
});

describe("deduplikacja: dwa sprawdzenia widzące się nawzajem RÓWNOLEGLE", () => {
  const check = (subscriptionId: string) =>
    alertOnDuplicatePlanSubscription({
      subscriptionId,
      userId: BUYER,
      tenantId: TENANT,
      environment: "live",
      priceId: "pro_monthly",
      status: "active",
    });

  it("atomowa bramka przed dzwonkiem daje jeden dzwonek, choć `enqueue_notification` nie jest atomowe", async () => {
    scenario.live = [
      { provider_subscription_id: NEW_SUB, price_id: "pro_monthly", status: "active" },
      { provider_subscription_id: OLD_SUB, price_id: "pro_monthly", status: "active" },
    ];

    // Drugie sprawdzenie rusza, gdy pierwsze jest już W OKNIE `enqueue_notification`
    // (po EXISTS, przed INSERT) - dokładnie tam, gdzie dwa izolaty mijają się
    // w produkcji. Start po wejściu w okno, a nie `Promise.all` od zera: atrapa
    // modułów vitest myli równoległe dynamiczne importy tego samego modułu
    // (drugi dostaje prawdziwego klienta), a to nie jest zachowanie produkcji.
    const first = check(NEW_SUB);
    await vi.waitFor(() => expect(rpc.callsFor("enqueue_notification").length).toBeGreaterThan(0));
    const outcomes = await Promise.all([first, check(OLD_SUB)]);

    expect(duplicateBells()).toHaveLength(1);
    expect(deliveredKeys.size).toBe(1);
    expect(outcomes.map((o) => o.kind).sort()).toEqual(["alerted", "deduped"]);
    expect(
      rpc
        .callsFor("rate_limit_hit")
        .map((c) => [c.arg("_scope"), c.arg("_subject"), c.arg("_max"), c.arg("_window_minutes")]),
    ).toEqual([
      ["billing.duplicate_plan_alert", `${TENANT}:live:sub_nowa,sub_stara`, 1, 1440],
      ["billing.duplicate_plan_alert", `${TENANT}:live:sub_nowa,sub_stara`, 1, 1440],
    ]);
    // Oba sprawdzenia i tak zostawiają ślad w logu.
    expect(loggedWith(console.error, "[payments] duplicate live plan subscription")).toHaveLength(
      2,
    );
  });

  it("awaria bramki nie wycisza alarmu (fail-open)", async () => {
    scenario.live = [
      { provider_subscription_id: OLD_SUB, price_id: "pro_monthly", status: "active" },
    ];
    scenario.gateError = "connection reset";

    const outcome = await check(NEW_SUB);

    expect(rpc.callsFor("rate_limit_hit")).toHaveLength(1);
    expect(outcome).toMatchObject({ kind: "alerted", delivered: 1 });
    expect(duplicateBells()).toHaveLength(1);
  });
});

describe("izolacja środowisk (PAY-05): ślad księgowy piaskownicy na produkcji nie sprawdza drugiego planu", () => {
  // Na wdrożeniu produkcyjnym zdarzenie piaskownicy zostawia wyłącznie wiersz
  // księgowy - karta testowa nie jest podwójnym obciążeniem, więc alarm dla
  // administratorów byłby fałszywy. Poza produkcją (reszta pliku) oba
  // środowiska sprawdzają normalnie.
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("subskrypcja z kasy i subskrypcja z panelu: bez zajęcia potwierdzenia i bez sprawdzenia w tle", async () => {
    scenario.live = [
      { provider_subscription_id: OLD_SUB, price_id: "pro_monthly", status: "active" },
    ];

    expect(await deliverCreated(createdEvent(), "sandbox")).toBe("processed");
    expect(await deliverCreated(createdEvent({ id: "sub_panel", customData: {} }), "sandbox")).toBe(
      "processed",
    );

    expect(h.background).toHaveLength(0);
    await settleBackground();
    expect(liveLookups()).toHaveLength(0);
    expect(
      db.chainsFor("subscriptions").filter((c) => eqFilters(c).provider_customer_id !== undefined),
    ).toHaveLength(0);
    expect(duplicateBells()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Subskrypcja z panelu operatora: odczyt właściciela po kliencie operatora.
// ---------------------------------------------------------------------------

/** Wejście alarmu dla subskrypcji z panelu (bez `metadata.userId`). */
const panelInput = (
  overrides: Partial<Parameters<typeof alertOnUnmirroredPlanSubscription>[0]> = {},
) => ({
  subscriptionId: NEW_SUB,
  customerId: "cus_panel",
  environment: "live" as const,
  priceId: "pro_monthly",
  status: "active",
  ...overrides,
});

/** Odczyt właściciela - jedyny odczyt `subscriptions` po kliencie operatora. */
const ownerLookups = (): RecordedChain[] =>
  db.chainsFor("subscriptions").filter((c) => eqFilters(c).provider_customer_id !== undefined);

/** Lustro, w którym PIERWSZE `failures` odczytów właściciela pada (chwilowa awaria bazy). */
function failOwnerLookups(rows: Map<string, MirrorRow>, failures: number): void {
  const base = mirrorResponder(rows);
  let left = failures;
  db.setResponse("subscriptions", (chain) => {
    if (eqFilters(chain).provider_customer_id !== undefined && left > 0) {
      left -= 1;
      return fail("connection reset");
    }
    return base(chain);
  });
}

describe("panel operatora: chwilowa awaria odczytu właściciela", () => {
  // DEFEKT: odczyt właściciela nie miał ponowienia, choć moduł obiecuje je
  // każdemu chwilowemu błędowi odczytu. Jedno `connection reset` przy
  // `created(active)` subskrypcji z panelu dawało `failed` - następna okazja
  // to dopiero kolejne zdarzenie stanu (zwykle odnowienie, czyli jeszcze jedno
  // podwójne obciążenie, zanim organizator się dowie).
  it("ponawia odczyt właściciela w tle i dzwoni, zamiast kończyć się `failed`", async () => {
    failOwnerLookups(useMirror([liveMirrorRow({ provider_customer_id: "cus_panel" })]), 1);

    const outcomes = await alertOnUnmirroredPlanSubscription(panelInput());

    expect(ownerLookups()).toHaveLength(2);
    expect(outcomes).toEqual([
      expect.objectContaining({
        kind: "alerted",
        severity: "warning",
        otherSubscriptionIds: [OLD_SUB],
        delivered: 1,
      }),
    ]);
    expect(duplicateBells().map((call) => call.arg("p_title_pl"))).toEqual([
      "Subskrypcja planu spoza kasy obok żywego planu",
    ]);
    expect(
      loggedWith(console.error, "[payments] duplicate plan subscription check failed"),
    ).toHaveLength(0);
  });
});
