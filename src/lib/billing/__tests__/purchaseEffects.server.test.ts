// SKUTKI ZAKUPU, ZMIANY PLANU, REZYGNACJI I ZMIANY STANU SUBSKRYPCJI
// (`purchaseEffects.server`) - miejsce, w którym zdarzenie operatora płatności
// zamienia się w to, co widzi człowiek: dostęp do treści, mail, wpis w CRM,
// zapis na newsletter premium i dzwonek w aplikacji.
//
// JAKIE RYZYKA PRZYBIJA TEN PLIK:
//   * PIENIĄDZE W MAILU. Upgrade rozlicza się od razu - mail ma pokazać realną
//     dopłatę proporcjonalną, liczoną od długości CYKLU planu (rok to nie 30
//     dni). Kiedy danych nie da się wiarygodnie policzyć (brak końca okresu,
//     okres minął, nowy plan tańszy, zmiana cyklu miesiąc <-> rok), zdanie
//     o dopłacie ma ZNIKNĄĆ, a nie pokazać kwotę niezgodną z fakturą operatora.
//   * IZOLACJA NAJEMCY. Uprawnienie, mail i dzwonek dostają plan WŁASNEJ
//     organizacji, nawet gdy obca ma plan o tym samym progu.
//   * ZGODA NA NEWSLETTER. Zapis na listę wyłącznie z jawną zgodą z checkoutu
//     (pełny zestaw reguł SUB-15: `purchaseEffectsNewsletterConsent.server.test.ts`),
//     a świadome wypisanie się jest nadrzędne - automat nie zapisuje ponownie
//     kogoś, kto zrezygnował.
//   * FAIL-SOFT. Awaria CRM, newslettera albo dzwonka nie może wywrócić
//     webhooka (operator ponowiłby zdarzenie i zdublował mail) - ma zostać
//     w logu, a pozostałe skutki mają dojść do końca. Atrapa modeluje awarię
//     na DWA sposoby: WYJĄTKIEM klienta (tak rzuca `supabaseAdmin` bez
//     konfiguracji - Proxy w `client.server`) oraz odpowiedzią `{ error }`
//     (tak supabase-js zgłasza błąd bazy i sieci - BEZ rzutu). Drugi przypadek
//     ma zostawić ten sam ślad w logu, a nieudany ODCZYT nie może udawać
//     „brak wiersza" (duplikat leada, nadpisane wypisanie z newslettera).
//   * IZOLACJA ZGODY. Wypisanie z newslettera czytamy w organizacji, której
//     dotyczy zakup - nie w obcej, i nie po samym adresie.
//   * LEJEK CRM. Rezygnacja i pauza muszą być widoczne tak samo jak zakup.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: klienta roli serwisowej
// (`@/integrations/supabase/client.server`), wysyłkę poczty (`sendTxEmail`)
// i operatora płatności (`subscriptionProvider.server` - skutki zdarzeń nie
// mają prawa go wołać).
// Sąsiedzi - `entitlementSync.server`, `notifications.server`, `catalog`,
// `premiumNewsletter` - biegną prawdziwym kodem, więc test widzi wiersz,
// który naprawdę trafia do `user_subscriptions`, i treść maila, którą
// naprawdę buduje warstwa powiadomień.
//
// Zegar jest zamrożony (`freezeClock`) - prorata liczy dni do końca okresu
// względem „teraz". Adresy wyłącznie syntetyczne (`example.com`).
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessPlan } from "@/lib/billing/types";
import type { TxSendInput } from "@/lib/email/transactional.server";
import type { PurchaseContext } from "@/lib/billing/purchaseEffects.server";
import {
  BILLING_IDS,
  accessPlan,
  fail,
  moneyPattern,
  ok,
  planLadder,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/billing/fixtures";
import { DZIEN, FIXED_NOW_ISO, MINUTA, freezeClock, relativeIso } from "@/test/time";
import { PREMIUM_NEWSLETTER_CONSENT_VERSION } from "@/lib/billing/premiumNewsletter";

const h = vi.hoisted(() => ({
  db: { current: null as { from: (table: string) => unknown } | null },
  emails: [] as unknown[],
  // Operator płatności: skutki zdarzeń NIE mogą go wołać (kwoty idą z ładunku).
  operator: vi.fn(),
}));

// GRANICA 3: operator płatności - każde wywołanie to błąd testu.
vi.mock("@/lib/billing/subscriptionProvider.server", () => ({
  renewalListCharge: h.operator,
  upgradeProrationCharge: h.operator,
}));

// GRANICA 1: klient roli serwisowej.
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
    // Lista wykluczeń (zapis na newsletter po zgodzie) - tu zawsze czysto.
    rpc: () => Promise.resolve({ data: [], error: null }),
  },
}));

// GRANICA 2: poczta. Formatowanie kwot i dat zostaje prawdziwe.
vi.mock("@/lib/email/transactional.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/transactional.server")>(
    "@/lib/email/transactional.server",
  );
  return {
    ...actual,
    sendTxEmail: (message: unknown) => {
      h.emails.push(message);
      return Promise.resolve({ ok: true });
    },
  };
});

const {
  applyCancellationEffects,
  applyPlanChangeEffects,
  applyPurchaseEffects,
  applyStatusTransitionEffects,
  deliverAnnouncements,
  NewsletterOptInRetryableError,
  RetryableAnnouncementError,
  syncCrmSubscriptionState,
} = await import("@/lib/billing/purchaseEffects.server");

freezeClock();

const SUB = "sub_1SyntetycznaSubskrypcja";
const EMAIL = "klientka@example.com";
/** Zaznaczone pole zgody w checkoucie - bez niego zakup nie dotyka listy (SUB-15). */
const WITH_CONSENT: Partial<PurchaseContext> = {
  newsletterConsent: {
    version: PREMIUM_NEWSLETTER_CONSENT_VERSION,
    lang: "pl",
    at: relativeIso(-2 * MINUTA),
    orderId: "order-1",
  },
};

// --- scena ------------------------------------------------------------------

interface Scene {
  plans: AccessPlan[];
  profile: Record<string, unknown> | null;
  lead: { id: string; tags: string[] } | null;
  newsletter: Record<string, unknown> | null;
  /** Tabela, której KAŻDE zapytanie kończy się WYJĄTKIEM klienta (nie `{ error }`). */
  broken: string | null;
  /**
   * Zapytanie, na które PostgREST odpowiada `{ error }` - bez wyjątku, tak jak
   * supabase-js zgłasza błąd bazy (CHECK, RLS) i sieci.
   */
  rejected: ((table: string, chain: RecordedChain) => boolean) | null;
}

let db: SupabaseFromStub;
let scene: Scene;

/** Filtry `eq` łańcucha jako para kolumna -> wartość. */
function eqFilters(chain: RecordedChain): [string, unknown][] {
  return chain.calls
    .filter((call) => call.method === "eq")
    .map((call) => [call.args[0] as string, call.args[1]]);
}

/**
 * `access_plans` jak w bazie: filtry `eq` naprawdę zawężają, a kolejność
 * idzie po `sort_order`. Plan obcego najemcy stoi w scenie PIERWSZY w
 * kolejności - zapytanie bez zakresu najemcy wybrałoby właśnie jego.
 */
function plansResponder(chain: RecordedChain): SupabaseResult {
  const filters = eqFilters(chain);
  const match = scene.plans
    .filter((plan) =>
      filters.every(
        ([column, value]) => (plan as unknown as Record<string, unknown>)[column] === value,
      ),
    )
    .sort((a, b) => a.sort_order - b.sort_order);
  return ok(match[0] ?? null);
}

function guarded(table: string, respond: (chain: RecordedChain) => SupabaseResult) {
  return (chain: RecordedChain): SupabaseResult => {
    if (scene.broken === table) throw new Error(`test: wyjątek klienta (${table})`);
    if (scene.rejected?.(table, chain)) {
      return fail(`test: PostgREST odrzucił zapytanie (${table})`, "23514");
    }
    return respond(chain);
  };
}

/** Kolumny z `select(...)` łańcucha - rozróżnia odczyty tej samej tabeli. */
function selectedColumns(chain: RecordedChain): string {
  return String(chain.argsOf("select")?.[0] ?? "");
}

function isWrite(chain: RecordedChain): boolean {
  return chain.has("insert") || chain.has("update") || chain.has("upsert");
}

beforeEach(() => {
  h.emails.length = 0;
  h.operator.mockReset();
  scene = {
    plans: [
      accessPlan({
        id: "plan-member-obcy",
        tenant_id: BILLING_IDS.foreignTenant,
        name_pl: "Członek (obca organizacja)",
        sort_order: 0,
      }),
      ...planLadder(),
      accessPlan({
        id: "plan-member-annual",
        interval: "year",
        name_pl: "Członek rocznie",
        name_en: "Member yearly",
        price_cents: 49900,
        sort_order: 31,
      }),
    ],
    profile: {
      email: "  Klientka@Example.com ",
      first_name: "Anna",
      last_name: null,
      display_name: null,
      tenant_id: BILLING_IDS.tenant,
      prefs: { language: "pl" },
    },
    lead: null,
    newsletter: null,
    broken: null,
    rejected: null,
  };

  db = supabaseFromStub();
  h.db.current = db;
  db.setResponse("access_plans", plansResponder);
  db.setResponse(
    "profiles",
    guarded("profiles", () => ok(scene.profile)),
  );
  db.setResponse("user_subscriptions", () => ok(null));
  db.setResponse(
    "crm_leads",
    guarded("crm_leads", (chain) => ok(isWrite(chain) ? null : scene.lead)),
  );
  db.setResponse(
    "newsletter_subscribers",
    guarded("newsletter_subscribers", (chain) =>
      ok(isWrite(chain) ? (chain.has("select") ? [{ id: "nl-1" }] : null) : scene.newsletter),
    ),
  );
  db.setResponse(
    "notifications",
    guarded("notifications", () => ok(null)),
  );
});

/** Pierwszy zapis danego rodzaju do tabeli (wiersz / łatka). */
function written(table: string, method: "insert" | "update" | "upsert") {
  const chain = db.chainsFor(table).find((c) => c.has(method));
  return chain?.argsOf(method)?.[0] as Record<string, unknown> | undefined;
}

function writes(table: string): RecordedChain[] {
  return db.chainsFor(table).filter(isWrite);
}

function mails(): TxSendInput[] {
  return h.emails as TxSendInput[];
}

/** Odczyty planu po cenie (`resolvePlanForPrice`), nie odczyty nazwy do maila. */
function planLookups(): RecordedChain[] {
  return db
    .chainsFor("access_plans")
    .filter((chain) => eqFilters(chain).some(([column]) => column === "tier_key"));
}

function purchase(overrides: Partial<PurchaseContext> = {}): PurchaseContext {
  return {
    userId: BILLING_IDS.me,
    priceId: "plus_monthly",
    subscriptionId: SUB,
    periodEnd: relativeIso(30 * DZIEN),
    environment: "live",
    tenantId: BILLING_IDS.tenant,
    ...overrides,
  };
}

type PlanChange = Parameters<typeof applyPlanChangeEffects>[0];

function planChange(overrides: Partial<PlanChange> = {}): PlanChange {
  return {
    ...purchase({ priceId: "pro_monthly", periodEnd: relativeIso(15 * DZIEN) }),
    previousPriceId: "plus_monthly",
    direction: "upgrade",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe("applyPurchaseEffects - opłacona subskrypcja", () => {
  it("nadaje dostęp w planie WŁASNEGO najemcy, wysyła jedno potwierdzenie i dzwoni w aplikacji", async () => {
    const periodEnd = relativeIso(30 * DZIEN);

    await applyPurchaseEffects(purchase({ periodEnd }));

    expect(written("user_subscriptions", "insert")).toEqual({
      user_id: BILLING_IDS.me,
      tenant_id: BILLING_IDS.tenant,
      // Nie `plan-member-obcy`, choć obca organizacja ma plan o tym samym progu.
      plan_id: "plan-member-monthly",
      status: "active",
      external_ref: SUB,
      current_period_end: periodEnd,
      canceled_at: null,
    });

    expect(mails()).toHaveLength(1);
    const [mail] = mails();
    expect(mail).toMatchObject({
      type: "subscription_confirmed",
      idempotencyKey: `subscription_confirmed:${SUB}`,
      subjectName: "Członek",
    });
    expect(mail?.bodyVars?.amount).toMatch(moneyPattern(4900));

    expect(written("notifications", "insert")).toEqual({
      user_id: BILLING_IDS.me,
      tenant_id: BILLING_IDS.tenant,
      kind: "billing",
      title_pl: "Subskrypcja aktywna",
      title_en: "Subscription active",
      body_pl: "Dostęp do treści premium został włączony.",
      body_en: "Access to premium content is now enabled.",
      href: "/profile/plan",
      icon: "badge-check",
    });
  });

  it("klient bez leada trafia do CRM jako „won”, a po zgodzie na newsletter premium z adresem znormalizowanym", async () => {
    await applyPurchaseEffects(purchase(WITH_CONSENT));

    const lookup = db.chainsFor("crm_leads").find((c) => !isWrite(c));
    expect(eqFilters(lookup!)).toEqual([
      ["tenant_id", BILLING_IDS.tenant],
      ["email_norm", EMAIL],
    ]);
    expect(written("crm_leads", "insert")).toEqual({
      tenant_id: BILLING_IDS.tenant,
      email: EMAIL,
      email_norm: EMAIL,
      first_name: "Anna",
      last_name: null,
      stage: "won",
      source_type: "paid_subscriber",
      tags: ["customer", "plan:member"],
    });

    // Stan zgody czytany w organizacji zakupu i po adresie znormalizowanym -
    // wypisanie w obcej organizacji nie blokuje, a brak filtra nie myli osób.
    const consentLookup = db.chainsFor("newsletter_subscribers").find((c) => !isWrite(c));
    expect(consentLookup ? eqFilters(consentLookup) : []).toEqual([
      ["tenant_id", BILLING_IDS.tenant],
      ["email", EMAIL],
    ]);
    // Wstawienie BEZ nadpisywania: wiersz, który pojawił się w międzyczasie,
    // nie traci dowodów (SUB-15) - zostanie scalony.
    const upsert = db.chainsFor("newsletter_subscribers").find((c) => c.has("upsert"));
    expect(upsert?.argsOf("upsert")?.[1]).toEqual({
      onConflict: "tenant_id,email",
      ignoreDuplicates: true,
    });
    expect(written("newsletter_subscribers", "upsert")).toMatchObject({
      tenant_id: BILLING_IDS.tenant,
      user_id: BILLING_IDS.me,
      email: EMAIL,
      first_name: "Anna",
      last_name: null,
      language: "pl",
      status: "subscribed",
      unsubscribed_at: null,
      confirmed_at: FIXED_NOW_ISO,
      meta: { tier: "member", subscription_id: SUB },
    });
  });

  it("stan operatora z wywołania wygrywa z domyślnym „active”: pauza przy zakupie nie otwiera dostępu", async () => {
    await applyPurchaseEffects(purchase({ status: "paused" }));

    expect(written("user_subscriptions", "insert")).toMatchObject({
      status: "canceled",
      canceled_at: FIXED_NOW_ISO,
    });
  });

  it("lead po rezygnacji wraca do „won”: znaczniki rezygnacji i pauzy znikają, własne zostają", async () => {
    scene.lead = { id: "lead-1", tags: ["churned", "subscription:paused", "vip"] };

    await applyPurchaseEffects(purchase());

    const update = db.chainsFor("crm_leads").find((c) => c.has("update"));
    expect(update?.argsOf("eq")).toEqual(["id", "lead-1"]);
    expect(written("crm_leads", "update")).toEqual({
      stage: "won",
      tags: ["vip", "customer", "plan:member"],
      last_activity_at: FIXED_NOW_ISO,
    });
    expect(written("crm_leads", "insert")).toBeUndefined();
  });

  it("świadome wypisanie z newslettera jest nadrzędne - nawet zgoda z checkoutu go nie odwraca", async () => {
    scene.newsletter = {
      id: "nl-1",
      status: "unsubscribed",
      unsubscribed_at: relativeIso(-10 * DZIEN),
      language: "pl",
    };

    await applyPurchaseEffects(purchase(WITH_CONSENT));

    expect(writes("newsletter_subscribers")).toHaveLength(0);
    // Reszta skutków zakupu biegnie normalnie.
    expect(written("notifications", "insert")).toMatchObject({ title_pl: "Subskrypcja aktywna" });
  });

  it("nowy zapis na newsletter bierze dane z profilu bez imienia (istniejący wiersz jest scalany - SUB-15)", async () => {
    scene.profile = { ...scene.profile, first_name: null, last_name: "Nowak" };

    await applyPurchaseEffects(purchase(WITH_CONSENT));

    expect(written("newsletter_subscribers", "upsert")).toMatchObject({
      email: EMAIL,
      first_name: null,
      last_name: "Nowak",
      language: "pl",
    });
    expect(written("crm_leads", "insert")).toMatchObject({ first_name: null, last_name: "Nowak" });
  });

  it("profil bez adresu: dostęp i dzwonek są, ale CRM, newsletter i mail nie zgadują odbiorcy", async () => {
    scene.profile = { ...scene.profile, email: null };

    await applyPurchaseEffects(purchase());

    expect(written("user_subscriptions", "insert")).toMatchObject({ status: "active" });
    expect(db.chainsFor("crm_leads")).toHaveLength(0);
    expect(db.chainsFor("newsletter_subscribers")).toHaveLength(0);
    expect(mails()).toHaveLength(0);
    expect(written("notifications", "insert")).toMatchObject({ user_id: BILLING_IDS.me });
  });

  it("cena spoza katalogu: żadnego zapisu ani maila, tylko ostrzeżenie w logu", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await applyPurchaseEffects(purchase({ priceId: "cena_spoza_katalogu" }));

    expect(warn).toHaveBeenCalledWith("[payments] no local plan for price", "cena_spoza_katalogu");
    expect(db.chains).toHaveLength(0);
    expect(mails()).toHaveLength(0);
    warn.mockRestore();
  });

  describe("fail-soft: awaria warstwy pobocznej nie wywraca webhooka", () => {
    it("awaria CRM zostaje w logu, a newsletter i dzwonek dochodzą do skutku", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      scene.broken = "crm_leads";

      await expect(applyPurchaseEffects(purchase(WITH_CONSENT))).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith(
        "[payments] crm sync failed",
        expect.objectContaining({ message: "test: wyjątek klienta (crm_leads)" }),
      );
      expect(written("newsletter_subscribers", "upsert")).toMatchObject({ email: EMAIL });
      expect(written("notifications", "insert")).toMatchObject({ icon: "badge-check" });
      error.mockRestore();
    });

    it("awaria zapisu na newsletter zostaje w logu, a dzwonek dochodzi do skutku", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      scene.broken = "newsletter_subscribers";

      await expect(applyPurchaseEffects(purchase(WITH_CONSENT))).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith(
        "[payments] premium newsletter opt-in failed",
        expect.objectContaining({ message: "test: wyjątek klienta (newsletter_subscribers)" }),
      );
      expect(written("notifications", "insert")).toMatchObject({ icon: "badge-check" });
      error.mockRestore();
    });

    it("awaria dzwonka zostaje w logu - dostęp i mail są już zapisane", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      scene.broken = "notifications";

      await expect(applyPurchaseEffects(purchase())).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith(
        "[payments] app notification failed",
        expect.objectContaining({ message: "test: wyjątek klienta (notifications)" }),
      );
      expect(written("user_subscriptions", "insert")).toMatchObject({ status: "active" });
      expect(mails()).toHaveLength(1);
      error.mockRestore();
    });
  });

  describe("fail-soft: błąd zwrócony jako `{ error }` (supabase-js nie rzuca) też zostaje w logu", () => {
    it.each([
      {
        // Dokładnie ten scenariusz opisuje komentarz przy `source_type`:
        // CHECK odrzuca wiersz, a płacący klient nie trafia do CRM.
        przypadek: "zakładanie leada odrzucone przez CHECK bazy",
        table: "crm_leads",
        method: "insert",
        lead: null,
        log: "[payments] crm sync failed",
      },
      {
        przypadek: "aktualizacja istniejącego leada",
        table: "crm_leads",
        method: "update",
        lead: { id: "lead-1", tags: ["vip"] },
        log: "[payments] crm sync failed",
      },
      {
        przypadek: "zapis na newsletter premium",
        table: "newsletter_subscribers",
        method: "upsert",
        lead: null,
        log: "[payments] premium newsletter opt-in failed",
      },
      {
        przypadek: "dzwonek w aplikacji",
        table: "notifications",
        method: "insert",
        lead: null,
        log: "[payments] app notification failed",
      },
    ])(
      "$przypadek: log z komunikatem bazy, a dostęp i mail są zapisane",
      async ({ table, method, lead, log }) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        scene.lead = lead;
        scene.rejected = (t, chain) => t === table && chain.has(method);

        await expect(applyPurchaseEffects(purchase(WITH_CONSENT))).resolves.toBeUndefined();

        expect(error).toHaveBeenCalledWith(
          log,
          expect.objectContaining({
            message: expect.stringContaining(`test: PostgREST odrzucił zapytanie (${table})`),
          }),
        );
        expect(written("user_subscriptions", "insert")).toMatchObject({ status: "active" });
        expect(mails()).toHaveLength(1);
        error.mockRestore();
      },
    );

    it("nieudany odczyt leada to nie „brak leada” - CRM nie zakłada duplikatu kontaktu", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      scene.rejected = (table, chain) => table === "crm_leads" && !isWrite(chain);

      await applyPurchaseEffects(purchase());

      expect(writes("crm_leads")).toHaveLength(0);
      expect(error).toHaveBeenCalledWith(
        "[payments] crm sync failed",
        expect.objectContaining({ message: expect.stringContaining("(crm_leads)") }),
      );
      // Pozostałe skutki zakupu biegną dalej.
      expect(written("notifications", "insert")).toMatchObject({ icon: "badge-check" });
      error.mockRestore();
    });

    it("nieudany odczyt zgody to nie „brak zapisu” - automat nie nadpisuje możliwego wypisania", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      scene.rejected = (table, chain) => table === "newsletter_subscribers" && !isWrite(chain);

      await applyPurchaseEffects(purchase(WITH_CONSENT));

      // Upsert po (tenant_id, email) ustawiłby `status: subscribed` na wierszu,
      // którego stanu zgody nie udało się przeczytać.
      expect(writes("newsletter_subscribers")).toHaveLength(0);
      expect(error).toHaveBeenCalledWith(
        "[payments] premium newsletter opt-in failed",
        expect.objectContaining({ message: expect.stringContaining("(newsletter_subscribers)") }),
      );
      expect(written("notifications", "insert")).toMatchObject({ icon: "badge-check" });
      error.mockRestore();
    });

    it("nieudany odczyt profilu przy zapisie na newsletter zostaje w logu, bez zapisu", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      // Tylko odczyt profilu warstwy newslettera - mail i CRM czytają inne kolumny.
      scene.rejected = (table, chain) =>
        table === "profiles" && selectedColumns(chain) === "email, first_name, last_name";

      await applyPurchaseEffects(purchase(WITH_CONSENT));

      expect(db.chainsFor("newsletter_subscribers")).toHaveLength(0);
      expect(error).toHaveBeenCalledWith(
        "[payments] premium newsletter opt-in failed",
        expect.objectContaining({ message: expect.stringContaining("(profiles)") }),
      );
      error.mockRestore();
    });
  });
});

describe("applyPlanChangeEffects - zmiana planu", () => {
  it("upgrade w połowie okresu: nowy plan od razu, mail z proporcjonalną dopłatą i dzwonek", async () => {
    await applyPlanChangeEffects(planChange());

    expect(written("user_subscriptions", "insert")).toMatchObject({
      tenant_id: BILLING_IDS.tenant,
      plan_id: "plan-pro-monthly",
      status: "active",
      external_ref: SUB,
    });

    expect(mails()).toHaveLength(1);
    const [mail] = mails();
    expect(mail).toMatchObject({
      type: "subscription_upgraded",
      idempotencyKey: `subscription_upgraded:${SUB}:pro_monthly`,
    });
    expect(mail?.bodyVars).toMatchObject({ planName: "Pro", previousPlanName: "Członek" });
    // Członek to klucz objęty zmianą cennika v6.2 - klient mógł płacić STARĄ
    // cenę (59 zł), a katalog ma już nową: różnica z katalogu ((9900 - 4900)
    // za 15 z 30 dni = 2500) byłaby fikcją, więc zdania o dopłacie nie ma.
    expect(mail?.bodyVars?.prorationAmount).toBeNull();
    expect(h.operator).not.toHaveBeenCalled();

    expect(written("notifications", "insert")).toEqual({
      user_id: BILLING_IDS.me,
      tenant_id: BILLING_IDS.tenant,
      kind: "billing",
      title_pl: "Plan podniesiony",
      title_en: "Plan upgraded",
      body_pl: "Nowy plan działa od razu, rozliczyliśmy różnicę proporcjonalnie.",
      body_en: "The new plan is active now; the difference was prorated.",
      href: "/profile/plan",
      icon: "arrow-up-right",
    });
  });

  it("dopłata nigdy nie przekracza pełnej różnicy cen, nawet przy okresie dłuższym niż 30 dni", async () => {
    // Student -> Pro: klucz spoza zmiany cennika, katalog = cena klienta.
    await applyPlanChangeEffects(
      planChange({ previousPriceId: "student_monthly", periodEnd: relativeIso(45 * DZIEN) }),
    );

    expect(mails()[0]?.bodyVars?.prorationAmount).toMatch(moneyPattern(8000));
  });

  it("upgrade w cyklu ROCZNYM: dopłata liczona od długości roku, nie od 30 dni", async () => {
    scene.plans = [
      ...scene.plans,
      accessPlan({
        id: "plan-student-annual",
        tier_key: "student",
        interval: "year",
        name_pl: "Student rocznie",
        name_en: "Student yearly",
        price_cents: 19000,
        sort_order: 11,
      }),
    ];
    await applyPlanChangeEffects(
      planChange({
        priceId: "pro_annual",
        previousPriceId: "student_annual",
        periodEnd: relativeIso(180 * DZIEN),
      }),
    );

    expect(written("user_subscriptions", "insert")).toMatchObject({ plan_id: "plan-pro-annual" });
    // (99900 - 19000) za 180 z 365 dni = 39895,89 -> 39896. Mianownik 30 dni
    // dawał pełną różnicę (809 zł) - dwa razy więcej niż faktura operatora.
    expect(mails()[0]?.bodyVars?.prorationAmount).toMatch(moneyPattern(39896));
  });

  it("klucz spoza zmiany cennika (Student -> Pro): szacunek dopłaty z katalogu zostaje", async () => {
    await applyPlanChangeEffects(planChange({ previousPriceId: "student_monthly" }));

    // (9900 - 1900) za 15 z 30 dni = 4000.
    expect(mails()[0]?.bodyVars?.prorationAmount).toMatch(moneyPattern(4000));
  });

  it("upgrade ze zmianą cyklu (miesiąc -> rok): mail bez kwoty dopłaty", async () => {
    // Operator zaczyna NOWY okres roczny - faktura to pełna cena roczna minus
    // niewykorzystana część miesiąca, a nie różnica cen planów.
    await applyPlanChangeEffects(
      planChange({
        priceId: "pro_annual",
        previousPriceId: "plus_monthly",
        periodEnd: relativeIso(365 * DZIEN),
      }),
    );

    expect(mails()).toHaveLength(1);
    expect(mails()[0]).toMatchObject({ type: "subscription_upgraded" });
    expect(mails()[0]?.bodyVars?.prorationAmount).toBeNull();
  });

  it("upgrade do planu, który najemca wycenił taniej w tym samym cyklu - mail bez kwoty dopłaty", async () => {
    scene.plans = scene.plans.map((plan) =>
      plan.id === "plan-pro-monthly" ? { ...plan, price_cents: 3900 } : plan,
    );

    await applyPlanChangeEffects(planChange());

    expect(mails()[0]?.bodyVars?.prorationAmount).toBeNull();
  });

  it.each([
    { przypadek: "brak końca okresu", ctx: { periodEnd: null } },
    { przypadek: "opłacony okres już minął", ctx: { periodEnd: relativeIso(-1 * DZIEN) } },
    { przypadek: "nieczytelny koniec okresu", ctx: { periodEnd: "nie-data" } },
    {
      // Wyższa ranga, inny cykl (i niższa cena): roczny „Członek” (499 zł) ->
      // miesięczny „Pro”.
      przypadek: "zmiana cyklu rok -> miesiąc",
      ctx: { previousPriceId: "plus_annual" },
    },
  ] satisfies { przypadek: string; ctx: Partial<PlanChange> }[])(
    "upgrade bez wiarygodnej proraty ($przypadek) - mail bez kwoty dopłaty",
    async ({ ctx }) => {
      await applyPlanChangeEffects(planChange(ctx));

      expect(mails()).toHaveLength(1);
      expect(mails()[0]).toMatchObject({ type: "subscription_upgraded" });
      expect(mails()[0]?.bodyVars?.prorationAmount).toBeNull();
      expect(written("user_subscriptions", "insert")).toMatchObject({
        plan_id: "plan-pro-monthly",
      });
    },
  );

  it("poprzednia cena bez planu w najemcy: mail bez „poprzedniego planu” i bez dopłaty", async () => {
    await applyPlanChangeEffects(planChange({ previousPriceId: "educator_monthly" }));

    expect(planLookups()).toHaveLength(2);
    expect(mails()[0]?.bodyVars).toMatchObject({
      planName: "Pro",
      previousPlanName: null,
      prorationAmount: null,
    });
  });

  it("bez poprzedniej ceny nie pyta o drugi plan", async () => {
    await applyPlanChangeEffects(planChange({ previousPriceId: null }));

    expect(planLookups()).toHaveLength(1);
    expect(mails()[0]?.bodyVars).toMatchObject({ previousPlanName: null, prorationAmount: null });
  });

  it("downgrade: mail o zmianie od nowego okresu bez dopłaty, dzwonek „zmiana zaplanowana”", async () => {
    await applyPlanChangeEffects(
      planChange({
        priceId: "plus_monthly",
        previousPriceId: "pro_monthly",
        direction: "downgrade",
      }),
    );

    expect(written("user_subscriptions", "insert")).toMatchObject({
      plan_id: "plan-member-monthly",
    });
    expect(mails()[0]).toMatchObject({
      type: "subscription_downgraded",
      idempotencyKey: `subscription_downgraded:${SUB}:plus_monthly`,
    });
    expect(mails()[0]?.bodyVars).toMatchObject({
      planName: "Członek",
      previousPlanName: "Pro",
      prorationAmount: null,
    });
    expect(written("notifications", "insert")).toMatchObject({
      title_pl: "Zmiana planu zaplanowana",
      title_en: "Plan change scheduled",
      body_pl: "Niższy plan zacznie obowiązywać po zakończeniu opłaconego okresu.",
      body_en: "The lower plan starts once the paid period ends.",
    });
  });

  it("nowa cena bez planu w najemcy: żadnego zapisu dostępu, maila ani dzwonka", async () => {
    await applyPlanChangeEffects(planChange({ priceId: "educator_monthly" }));

    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(mails()).toHaveLength(0);
    expect(db.chainsFor("notifications")).toHaveLength(0);
  });
});

describe("applyCancellationEffects - rezygnacja", () => {
  it("dostęp do końca okresu, mail o rezygnacji, CRM „archived” i dzwonek z ankietą", async () => {
    scene.lead = { id: "lead-1", tags: ["customer", "plan:member", "vip"] };
    const periodEnd = relativeIso(12 * DZIEN);

    await applyCancellationEffects(purchase({ periodEnd }));

    // Opłacony okres trwa - uprawnienie zostaje `active` do jego końca.
    expect(written("user_subscriptions", "insert")).toMatchObject({
      plan_id: "plan-member-monthly",
      status: "active",
      current_period_end: periodEnd,
      canceled_at: FIXED_NOW_ISO,
    });
    expect(mails()[0]).toMatchObject({
      type: "subscription_canceled",
      idempotencyKey: `subscription_canceled:cancel:${SUB}`,
    });
    expect(written("crm_leads", "update")).toMatchObject({
      stage: "archived",
      tags: ["plan:member", "vip", "churned"],
    });
    expect(written("notifications", "insert")).toMatchObject({
      title_pl: "Subskrypcja anulowana",
      href: "/profile/plan?retention=1",
      icon: "message-circle-question",
    });
  });

  it("cena bez planu w najemcy: rezygnacja niczego nie zapisuje", async () => {
    await applyCancellationEffects(purchase({ priceId: "educator_monthly" }));

    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(db.chainsFor("crm_leads")).toHaveLength(0);
    expect(mails()).toHaveLength(0);
    expect(db.chainsFor("notifications")).toHaveLength(0);
  });
});

describe("applyStatusTransitionEffects - zmiana samego stanu", () => {
  const transition = (previousStatus: string | null, status: string) => ({
    userId: BILLING_IDS.me,
    tenantId: BILLING_IDS.tenant,
    priceId: "plus_monthly",
    subscriptionId: SUB,
    periodEnd: relativeIso(20 * DZIEN),
    previousStatus,
    status,
  });

  it("ponowione zdarzenie z tym samym stanem nie dotyka bazy ani poczty", async () => {
    await applyStatusTransitionEffects(transition("active", "active"));

    expect(db.chains).toHaveLength(0);
    expect(mails()).toHaveLength(0);
  });

  it("pauza: CRM „paused”, dzwonek i mail o wstrzymaniu", async () => {
    scene.lead = { id: "lead-1", tags: ["customer", "plan:member"] };
    const ctx = transition("active", "paused");

    await applyStatusTransitionEffects(ctx);

    expect(written("crm_leads", "update")).toMatchObject({
      stage: "won",
      tags: ["customer", "plan:member", "subscription:paused"],
    });
    expect(written("notifications", "insert")).toMatchObject({
      title_pl: "Subskrypcja wstrzymana",
      icon: "pause-circle",
    });
    expect(mails()[0]).toMatchObject({
      type: "subscription_paused",
      idempotencyKey: `subscription_paused:${SUB}:paused:${ctx.periodEnd}`,
    });
  });

  it("wznowienie po zaległości: CRM „customer”, dzwonek i mail związany z okresem", async () => {
    scene.lead = { id: "lead-1", tags: ["customer", "plan:member", "subscription:paused"] };
    const ctx = transition("past_due", "active");

    await applyStatusTransitionEffects(ctx);

    expect(written("crm_leads", "update")).toMatchObject({
      tags: ["customer", "plan:member"],
    });
    expect(written("notifications", "insert")).toMatchObject({
      title_pl: "Subskrypcja wznowiona",
      title_en: "Subscription resumed",
    });
    expect(mails()[0]).toMatchObject({
      type: "subscription_resumed",
      idempotencyKey: `subscription_resumed:${SUB}:resumed:${ctx.periodEnd}`,
    });
  });

  it("wznowienie: kwota z ceny, na której subskrypcja JEST (ładunek zdarzenia), nie z katalogu", async () => {
    // Stara cena 59 zł po zmianie cennika - katalog mówi 49 zł (fikstura).
    await applyStatusTransitionEffects({
      ...transition("paused", "active"),
      charge: { amountCents: 5900, currency: "PLN" },
    });

    expect(mails()[0]?.bodyVars?.amount).toMatch(moneyPattern(5900));
    expect(JSON.stringify(mails()[0]?.details)).not.toMatch(moneyPattern(4900));
    expect(h.operator).not.toHaveBeenCalled();
  });

  it("wznowienie klucza objętego zmianą cennika bez kwoty w zdarzeniu: mail BEZ kwoty", async () => {
    await applyStatusTransitionEffects(transition("paused", "active"));

    expect(mails()).toHaveLength(1);
    expect(mails()[0]?.bodyVars?.amount).toBeNull();
    expect(JSON.stringify(mails()[0]?.details)).not.toMatch(moneyPattern(4900));
  });

  it.each([
    { previous: "active", status: "paused", key: `subscription_paused:${SUB}:paused:` },
    { previous: "paused", status: "active", key: `subscription_resumed:${SUB}:resumed:` },
  ])(
    "$previous -> $status bez znanego końca okresu: klucz idempotencji maila nadal stabilny",
    async ({ previous, status, key }) => {
      await applyStatusTransitionEffects({ ...transition(previous, status), periodEnd: null });

      expect(mails()).toHaveLength(1);
      expect(mails()[0]?.idempotencyKey).toBe(key);
    },
  );

  it("zaległa płatność (past_due) nie rusza CRM, dzwonka ani poczty - to robota windykacji", async () => {
    await applyStatusTransitionEffects(transition("active", "past_due"));

    expect(db.chainsFor("crm_leads")).toHaveLength(0);
    expect(db.chainsFor("notifications")).toHaveLength(0);
    expect(mails()).toHaveLength(0);
  });

  it("cena bez planu w najemcy: zmiana stanu nie generuje żadnego skutku", async () => {
    await applyStatusTransitionEffects({
      ...transition("active", "paused"),
      priceId: "educator_monthly",
    });

    expect(db.chainsFor("crm_leads")).toHaveLength(0);
    expect(db.chainsFor("notifications")).toHaveLength(0);
    expect(mails()).toHaveLength(0);
  });

  it("koniec okresu próbnego to nie „wznowienie” - bez dzwonka i maila", async () => {
    await applyStatusTransitionEffects(transition("trialing", "active"));

    expect(written("crm_leads", "insert")).toMatchObject({ stage: "won" });
    expect(db.chainsFor("notifications")).toHaveLength(0);
    expect(mails()).toHaveLength(0);
  });
});

describe("syncCrmSubscriptionState - wywołanie bezpośrednie", () => {
  it("bez podanego stanu traktuje kontakt jako aktywnego klienta", async () => {
    await syncCrmSubscriptionState(BILLING_IDS.me, "pro");

    const profileLookup = db.chainsFor("profiles")[0];
    expect(profileLookup ? eqFilters(profileLookup) : []).toEqual([["id", BILLING_IDS.me]]);
    expect(written("crm_leads", "insert")).toMatchObject({
      tenant_id: BILLING_IDS.tenant,
      stage: "won",
      tags: ["customer", "plan:pro"],
    });
  });

  it("profil bez organizacji: CRM nie szuka ani nie zakłada leada bez najemcy", async () => {
    scene.profile = { ...scene.profile, tenant_id: null };

    await syncCrmSubscriptionState(BILLING_IDS.me, "pro", "churned");

    expect(db.chainsFor("crm_leads")).toHaveLength(0);
  });

  it("nieudany odczyt profilu (`{ error }`) zostaje w logu i nie rusza CRM", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    scene.rejected = (table) => table === "profiles";

    await expect(
      syncCrmSubscriptionState(BILLING_IDS.me, "pro", "churned"),
    ).resolves.toBeUndefined();

    expect(db.chainsFor("crm_leads")).toHaveLength(0);
    expect(error).toHaveBeenCalledWith(
      "[payments] crm sync failed",
      expect.objectContaining({ message: expect.stringContaining("(profiles)") }),
    );
    error.mockRestore();
  });
});

// PRZEGLĄD S1. Uprawnienie `refunded` (zwrot albo spór BIEŻĄCEGO okresu,
// `canceled_at` = chwila korekty) wraca do życia wyłącznie dla okresu zaczętego
// PO korekcie. Skutki zakupu, zmiany planu i rezygnacji nie podawały początku
// okresu, więc nawet kolejne OPŁACONE odnowienie zostawiało klienta bez dostępu.
describe("S1 - początek okresu trafia do zapisu uprawnienia", () => {
  const CORRECTED_AT = relativeIso(-10 * DZIEN);

  beforeEach(() => {
    db.setResponse("user_subscriptions", (chain) =>
      chain.has("maybeSingle")
        ? ok({ id: "us-1", status: "refunded", canceled_at: CORRECTED_AT })
        : ok(null),
    );
  });

  /** Ożywienie: aktualizacja WYŁĄCZNIE tej korekty, którą widział odczyt. */
  function revive(): RecordedChain | undefined {
    return db
      .chainsFor("user_subscriptions")
      .find(
        (chain) =>
          chain.has("update") &&
          eqFilters(chain).some(([column, value]) => column === "status" && value === "refunded"),
      );
  }

  it.each([
    [
      "zakup (odnowienie po korekcie)",
      () => applyPurchaseEffects(purchase({ periodStart: FIXED_NOW_ISO })),
    ],
    ["zmiana planu", () => applyPlanChangeEffects(planChange({ periodStart: FIXED_NOW_ISO }))],
    [
      "rezygnacja w nowym okresie",
      () => applyCancellationEffects(purchase({ periodStart: FIXED_NOW_ISO })),
    ],
  ])("%s: okres zaczęty PO korekcie ożywia uprawnienie", async (_label, run) => {
    await run();

    const revived = revive();
    expect(revived).toBeDefined();
    expect(eqFilters(revived as RecordedChain)).toContainEqual(["canceled_at", CORRECTED_AT]);
  });

  it("okres sprzed korekty (to samo zdarzenie okresu) zostawia `refunded`", async () => {
    await applyPurchaseEffects(purchase({ periodStart: relativeIso(-20 * DZIEN) }));

    expect(revive()).toBeUndefined();
  });
});

// PRZEGLĄD 1.3 (dokładnie raz). Webhook zapisuje stan subskrypcji dopiero PO
// skutkach, więc powtórka po porażce wykonuje je jeszcze raz. Maile mają ziarna
// idempotencji, CRM jest zbieżny - dzwonek to zwykły INSERT i musi sam
// rozpoznać, że już leży u odbiorcy od chwili zdarzenia.
describe("dzwonek raz na zdarzenie (`eventAt`)", () => {
  const EVENT_AT = relativeIso(-1 * DZIEN);

  function bellLookup(): RecordedChain | undefined {
    return db.chainsFor("notifications").find((chain) => chain.has("select"));
  }

  it("dzwonek z tym samym tytułem i adresem od chwili zdarzenia już jest: drugiego nie ma", async () => {
    db.setResponse("notifications", (chain) =>
      chain.has("select") ? ok([{ id: "dzwonek-1" }]) : ok(null),
    );

    await applyStatusTransitionEffects({
      userId: BILLING_IDS.me,
      tenantId: BILLING_IDS.tenant,
      priceId: "plus_monthly",
      subscriptionId: SUB,
      periodEnd: relativeIso(20 * DZIEN),
      previousStatus: "active",
      status: "paused",
      eventAt: EVENT_AT,
    });

    expect(written("notifications", "insert")).toBeUndefined();
    const lookup = bellLookup();
    expect(lookup).toBeDefined();
    expect(eqFilters(lookup as RecordedChain)).toEqual([
      ["user_id", BILLING_IDS.me],
      ["tenant_id", BILLING_IDS.tenant],
      ["kind", "billing"],
      ["title_pl", "Subskrypcja wstrzymana"],
      ["href", "/profile/plan"],
    ]);
    expect(lookup?.argsOf("gte")).toEqual(["created_at", EVENT_AT]);
    // Mail idzie dalej - jego duplikat odsiewa ziarno idempotencji.
    expect(mails()).toHaveLength(1);
  });

  it.each([
    ["zakup", () => applyPurchaseEffects(purchase({ eventAt: EVENT_AT }))],
    ["zmiana planu", () => applyPlanChangeEffects(planChange({ eventAt: EVENT_AT }))],
    ["rezygnacja", () => applyCancellationEffects(purchase({ eventAt: EVENT_AT }))],
  ])("%s: dzwonek już leży - drugiego nie ma", async (_label, run) => {
    db.setResponse("notifications", (chain) =>
      chain.has("select") ? ok([{ id: "dzwonek-1" }]) : ok(null),
    );

    await run();

    expect(written("notifications", "insert")).toBeUndefined();
  });

  it("dzwonka jeszcze nie ma: pierwszy przebieg go zapisuje", async () => {
    db.setResponse("notifications", (chain) => (chain.has("select") ? ok([]) : ok(null)));

    await applyPurchaseEffects(purchase({ eventAt: EVENT_AT }));

    expect(written("notifications", "insert")).toMatchObject({ title_pl: "Subskrypcja aktywna" });
  });

  it("nieudany odczyt deduplikacji nie wstrzymuje dzwonka - lepszy duplikat niż cisza", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.setResponse("notifications", (chain) =>
      chain.has("select") ? fail("statement timeout") : ok(null),
    );

    await applyPurchaseEffects(purchase({ eventAt: EVENT_AT }));

    expect(written("notifications", "insert")).toMatchObject({ title_pl: "Subskrypcja aktywna" });
    expect(warn).toHaveBeenCalledWith(
      "[payments] notification dedupe lookup failed",
      "statement timeout",
    );
    warn.mockRestore();
  });

  it("bez chwili zdarzenia (wołający spoza webhooka) dzwonek idzie bez odczytu", async () => {
    await applyPurchaseEffects(purchase());

    expect(bellLookup()).toBeUndefined();
    expect(written("notifications", "insert")).toBeDefined();
  });
});

// WERYFIKACJA RUNDY 3 (A3). Webhook zapisuje stan subskrypcji NA KOŃCU,
// warunkiem na zajęcie zdarzenia. Komunikat wysłany przed tym zapisem mówił
// klientowi o stanie, którego potem nie było (zapis padł albo nowsze zdarzenie
// przejęło wiersz) - „wstrzymana" bez „wznowiona". Z kolejką skutki dzielą się
// na zapisy zbieżne, które RZUCAJĄ (plan, uprawnienie - od razu), i komunikaty
// (mail, dzwonek, CRM, newsletter), które czekają na `deliverAnnouncements`.
describe("kolejka komunikatów (`announcements`) - komunikaty po zapisie stanu", () => {
  let queue: Array<() => Promise<void>> = [];
  beforeEach(() => {
    queue = [];
  });

  it.each([
    ["zakup", () => applyPurchaseEffects(purchase({ announcements: queue }))],
    ["zmiana planu", () => applyPlanChangeEffects(planChange({ announcements: queue }))],
    ["rezygnacja", () => applyCancellationEffects(purchase({ announcements: queue }))],
  ])(
    "%s: uprawnienie od razu, mail, dzwonek i CRM dopiero po `deliverAnnouncements`",
    async (_, run) => {
      scene.lead = { id: "lead-1", tags: ["customer", "plan:member"] };

      await run();

      expect(writes("user_subscriptions")).toHaveLength(1);
      expect(mails()).toHaveLength(0);
      expect(writes("notifications")).toHaveLength(0);
      expect(writes("crm_leads")).toHaveLength(0);
      expect(queue).toHaveLength(1);

      await deliverAnnouncements(queue);

      expect(mails()).toHaveLength(1);
      expect(writes("notifications")).toHaveLength(1);
      expect(queue).toHaveLength(0);
    },
  );

  it("zmiana stanu: plan rozwiązany od razu (porażka odczytu RZUCA przed zapisem stanu), komunikaty w kolejce", async () => {
    const ctx = {
      userId: BILLING_IDS.me,
      tenantId: BILLING_IDS.tenant,
      priceId: "plus_monthly",
      subscriptionId: SUB,
      periodEnd: relativeIso(20 * DZIEN),
      previousStatus: "active",
      status: "paused",
      announcements: queue,
    };

    await applyStatusTransitionEffects(ctx);

    expect(planLookups()).toHaveLength(1);
    expect(mails()).toHaveLength(0);
    expect(writes("notifications")).toHaveLength(0);

    await deliverAnnouncements(queue);

    expect(mails()[0]).toMatchObject({ type: "subscription_paused" });
    expect(written("notifications", "insert")).toMatchObject({
      title_pl: "Subskrypcja wstrzymana",
    });
    // Drugie doręczenie tej samej kolejki niczego nie powtarza.
    await deliverAnnouncements(queue);
    expect(mails()).toHaveLength(1);
  });

  it("wyjątek jednego komunikatu zostaje w logu, a pozostałe wychodzą - doręczenie nigdy nie rzuca", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const delivered: string[] = [];
    queue.push(
      async () => {
        throw new Error("test: awaria komunikatu");
      },
      async () => {
        delivered.push("drugi");
      },
    );

    await expect(deliverAnnouncements(queue)).resolves.toBeUndefined();

    expect(delivered).toEqual(["drugi"]);
    expect(error).toHaveBeenCalledWith(
      "[payments] subscription announcement failed",
      expect.any(Error),
    );
    error.mockRestore();
  });

  // SCALENIE SUB-15 (#34) Z A3. Potwierdzenie zakupu (zgoda z checkoutu,
  // zajęcie `purchase_confirmed_at`, mail, dzwonek) jest komunikatem w kolejce,
  // a jego przejściowa porażka nie może zniknąć w logu: zdarzenie ma paść,
  // operator je ponowi, a pusty znacznik potwierdzenia każe ogłosić zakup
  // jeszcze raz. Reszta kolejki wychodzi PRZED wyjątkiem.
  it("porażka do ponowienia (`RetryableAnnouncementError`) wraca PO doręczeniu reszty kolejki", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const delivered: string[] = [];
    const transient = new NewsletterOptInRetryableError("test: zapis zgody - reset połączenia");
    queue.push(
      async () => {
        throw transient;
      },
      async () => {
        delivered.push("drugi");
      },
      async () => {
        throw new RetryableAnnouncementError("test: druga porażka do ponowienia");
      },
    );

    await expect(deliverAnnouncements(queue)).rejects.toBe(transient);

    expect(delivered).toEqual(["drugi"]);
    expect(queue).toHaveLength(0);
    error.mockRestore();
  });

  it("zakup: awaria zajęcia potwierdzenia to porażka do ponowienia - mail i dzwonek nie wychodzą", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await applyPurchaseEffects(
      purchase({
        announcements: queue,
        claimConfirmation: () => Promise.reject(new Error("connection reset")),
      }),
    );

    await expect(deliverAnnouncements(queue)).rejects.toThrow(
      "purchase confirmation claim failed: connection reset",
    );
    expect(mails()).toHaveLength(0);
    expect(writes("notifications")).toHaveLength(0);
    error.mockRestore();
  });
});
