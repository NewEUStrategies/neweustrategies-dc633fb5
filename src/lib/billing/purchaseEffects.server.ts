// Efekty biznesowe zakupu przez wbudowane płatności.
// Jedno miejsce, w którym „opłacona subskrypcja” zamienia się w: dostęp do
// treści, mail transakcyjny, wpis w CRM i powiadomienie w aplikacji.
// Moduł jest server-only (klient service_role) - importuj wyłącznie z handlerów.
import {
  syncEntitlementState,
  type ProviderSubscriptionStatus,
} from "@/lib/billing/entitlementSync.server";
import { notifySubscriptionEmail } from "@/lib/billing/notifications.server";
import { accessActiveAt, isEntitledSubscriptionStatus } from "@/lib/billing/accessPeriod";
import { catalogEntryByPriceId, type PlanBillingInterval } from "@/lib/billing/catalog";
import {
  buildPremiumNewsletterConsentEntry,
  buildPremiumNewsletterRow,
  canAutoSubscribe,
  mergeNewsletterConsents,
  PREMIUM_NEWSLETTER_FORM_NAME,
  recordedCheckoutConsentAt,
  type PremiumNewsletterConsentGrant,
} from "@/lib/billing/premiumNewsletter";
import {
  suppressionBlocksSignup,
  type SuppressionReason,
  type SuppressionScope,
} from "@/lib/email/suppressionPolicy";
import { PROFILE_PLAN_PATH } from "@/lib/profile/routes";
import { isRepriceLookupKey } from "@/lib/billing/subscriptionRepricing";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";

/** Klient roli serwisowej (typ; moduł ładowany dynamicznie w funkcjach). */
type AdminClient = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

export interface PurchaseContext {
  userId: string;
  priceId: string;
  subscriptionId: string;
  periodEnd: string | null;
  /**
   * Początek okresu rozliczeniowego subskrypcji (`current_period_start`).
   * Uprawnienie `refunded` ożywa wyłącznie dla okresu zaczętego PO korekcie
   * (S1, `mayReviveRefunded`) - bez tego pola nawet kolejne opłacone
   * odnowienie zostawiało klienta bez dostępu.
   */
  periodStart?: string | null;
  environment: "sandbox" | "live";
  /** Status subskrypcji u operatora; domyślnie `active`. */
  status?: ProviderSubscriptionStatus;
  /**
   * Zaplanowana rezygnacja u operatora - steruje `canceled_at` uprawnienia
   * (`syncEntitlementState`). Brak = wołający nie zna stanu, data bez zmian.
   */
  cancelAtPeriodEnd?: boolean;
  /**
   * Atomowe zajęcie potwierdzenia zakupu (`subscriptions.purchase_confirmed_at`)
   * - wołane PO zapisie uprawnienia oraz idempotentnych skutkach (CRM, zgoda
   * na newsletter), tuż przed mailem i dzwonkiem. `false` = potwierdzenie już
   * wyszło (powtórka, równoległe zdarzenie), więc mail i dzwonek nie idą drugi
   * raz. Brak = bez zajęcia.
   */
  claimConfirmation?: () => Promise<boolean>;
  /**
   * Najemca z wiersza `subscriptions`, gdy wołający go zna - oszczędza odczyt
   * profilu przy odwzorowaniu ceny na plan (`PlanScope`).
   */
  tenantId?: string | null;
  /**
   * Chwila zdarzenia, które wywołało skutki (ISO) - próg deduplikacji dzwonka.
   * Powtórka zdarzenia po porażce dalszych skutków (PAY-02) nie dokłada
   * drugiego dzwonka, bo pierwszy powstał PO tej chwili. Bez wartości (wołający
   * spoza webhooka) dzwonek idzie jak dawniej.
   */
  eventAt?: string | null;
  /**
   * Kolejka komunikatów odroczonych (patrz `AnnouncementQueue`). Bez niej mail,
   * CRM, newsletter i dzwonek idą od razu, jak dawniej.
   */
  announcements?: AnnouncementQueue;
  /**
   * Zgoda na newsletter z pola w checkoucie (metadane subskrypcji operatora).
   * Brak = pole niezaznaczone, więc zakup NIE dotyka listy - nowe miejsce
   * wołające `applyPurchaseEffects`, które zapomni przekazać to pole, kończy
   * się brakiem zapisu, a nie zgodą, której nikt nie wyraził (SUB-15).
   */
  newsletterConsent?: PremiumNewsletterConsentGrant | null;
}

/**
 * Komunikaty dla człowieka (mail, dzwonek, CRM, newsletter) odroczone do
 * chwili, w której wołający ZAPISAŁ stan, z którego wynikają.
 *
 * DLACZEGO. Webhook zapisuje stan subskrypcji na końcu, warunkiem na zajęcie
 * zdarzenia. Komunikat wysłany PRZED tym zapisem mówił klientowi o stanie,
 * którego potem nie było: zapis padał (np. limit czasu zapytania) albo nowsze
 * zdarzenie przejmowało wiersz, a to nowsze liczyło przejście od stanu SPRZED
 * nas - klient słyszał „wstrzymana" i nigdy „wznowiona" (regresja A3). Dlatego
 * tu zostają wyłącznie zapisy zbieżne, które RZUCAJĄ (plan, uprawnienie), a
 * komunikaty - z planem rozwiązanym zawczasu - czekają w kolejce na
 * `deliverAnnouncements` po udanym zapisie stanu.
 */
export type AnnouncementQueue = Array<() => Promise<void>>;

/**
 * Porażka komunikatu, którą trzeba oddać operatorowi do ponowienia, choć stan
 * jest już zapisany. Dotyczy wyłącznie potwierdzenia zakupu (SUB-02 x SUB-15):
 * jego wyzwalaczem nie jest PRZEJŚCIE stanu, tylko pusty
 * `subscriptions.purchase_confirmed_at`, więc ponowienie zdarzenia (powtórka
 * po `replay` albo kolejne zdarzenie tej subskrypcji) ogłosi zakup jeszcze raz
 * - a przejściowo nieudany zapis zgody z checkoutu albo zajęcie potwierdzenia
 * wraca, zamiast przepaść (#34). Komunikaty przejść stanu nigdy tak nie rzucają:
 * ich ponowienie widziałoby nowy stan i nie ogłosiłoby przejścia wcale.
 */
export class RetryableAnnouncementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableAnnouncementError";
  }
}

/** Komunikat do kolejki wołającego albo - bez kolejki - od razu. */
async function announce(
  queue: AnnouncementQueue | undefined,
  task: () => Promise<void>,
): Promise<void> {
  if (queue) {
    queue.push(task);
    return;
  }
  await task();
}

/**
 * Wysyła komunikaty z kolejki. Stan jest już zapisany, więc zwykły wyjątek
 * oznaczałby zdarzenie `failed`, a jego ponowienie widziałoby nowy stan
 * i przejścia nie ogłosiłoby wcale. Każdy komunikat jest i tak miękki
 * (`notifySubscriptionEmail`, `pushAppNotification`, CRM łapią własne błędy) -
 * ten `catch` to ostatnia linia obrony.
 *
 * Wyjątek od reguły: `RetryableAnnouncementError` (potwierdzenie zakupu).
 * Najpierw wychodzą WSZYSTKIE komunikaty z kolejki, a dopiero potem pierwszy
 * taki błąd wraca do wołającego - zdarzenie kończy się `failed`, operator je
 * ponawia, a pusty `purchase_confirmed_at` każe ogłosić zakup jeszcze raz.
 */
export async function deliverAnnouncements(queue: AnnouncementQueue): Promise<void> {
  let retry: RetryableAnnouncementError | null = null;
  for (const task of queue.splice(0)) {
    try {
      await task();
    } catch (err) {
      console.error("[payments] subscription announcement failed", err);
      if (err instanceof RetryableAnnouncementError && !retry) retry = err;
    }
  }
  if (retry) throw retry;
}

interface ResolvedPlan {
  planId: string;
  tenantId: string;
  priceCents: number | null;
  currency: string | null;
  /**
   * Próg i cykl z wpisu katalogu, po którym plan został znaleziony. Plan
   * istnieje tylko dla ceny katalogowej, więc wołający nie musi drugi raz
   * pytać katalogu (i obsługiwać „braku wpisu", który tu nie zachodzi).
   */
  tierKey: string;
  interval: PlanBillingInterval;
}

/**
 * Zakres najemcy dla odwzorowania ceny na plan. `tenantId` wygrywa (wiersz
 * subskrypcji / zamówienia już go niesie); bez niego najemca idzie z profilu
 * `userId`. Oba puste = najemca nieznany, czyli brak planu.
 */
export interface PlanScope {
  tenantId?: string | null;
  userId?: string | null;
}

async function scopeTenant(scope: PlanScope): Promise<string | null> {
  if (scope.tenantId) return scope.tenantId;
  if (!scope.userId) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("tenant_id")
    .eq("id", scope.userId)
    .maybeSingle();
  if (error) throw new Error(`plan scope lookup failed: ${error.message}`);
  return data?.tenant_id ?? null;
}

/**
 * Mapuje czytelny identyfikator ceny dostawcy na plan z `access_plans`
 * NAJEMCY, którego dotyczy zdarzenie.
 *
 * DLACZEGO ZAKRES JEST WYMAGANY. Katalog cen jest jeden na konto operatora
 * (`plus_monthly` znaczy to samo w każdym obszarze roboczym), a plany są per
 * najemca. Zapytanie po samym `tier_key` + `interval` z `.limit(1)` i bez
 * `ORDER BY` oddawało PIERWSZY LEPSZY aktywny plan całego wdrożenia: przy
 * dwóch najemcach z planem „Plus" uprawnienie, mail i dzwonek mogły dostać
 * `plan_id`/`tenant_id` obcej organizacji - i to różnej przy kolejnych
 * zdarzeniach tej samej subskrypcji (audyt wyd. 11/12: „odwzorowanie ceny
 * operatora na plan nie jest zawężone do najemcy ani deterministyczne").
 *
 * KOLEJNOŚĆ JAWNA (`sort_order`, potem `created_at`, potem `id`): dwa aktywne
 * plany tego samego progu w jednym najemcy to stan dopuszczalny (np. wariant
 * dla innej grupy odbiorców), więc wybór musi być powtarzalny.
 */
export async function resolvePlanForPrice(
  priceId: string,
  scope: PlanScope,
): Promise<ResolvedPlan | null> {
  const entry = catalogEntryByPriceId(priceId);
  if (!entry) return null;
  const tenantId = await scopeTenant(scope);
  if (!tenantId) {
    console.warn("[payments] plan lookup without tenant scope - skipped", { priceId });
    return null;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("access_plans")
    .select("id, tenant_id, price_cents, currency")
    .eq("tenant_id", tenantId)
    .eq("tier_key", entry.tierKey)
    .eq("interval", entry.interval)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`plan lookup failed: ${error.message}`);
  if (!data) return null;
  return {
    planId: data.id,
    tenantId: data.tenant_id,
    priceCents: data.price_cents,
    currency: data.currency,
    tierKey: entry.tierKey,
    interval: entry.interval,
  };
}

/**
 * Powiadomienie w aplikacji (dzwonek). Nigdy nie rzuca.
 *
 * FAIL-SOFT A `{ error }`. supabase-js nie rzuca na błąd bazy ani sieci, tylko
 * zwraca go w wyniku - dlatego tu i w pozostałych skutkach pobocznych błąd
 * jest jawnie przerzucany do `catch`. Bez tego `catch` widziałby wyłącznie
 * wyjątki klienta, a odrzucony zapis znikałby bez śladu w logu.
 */
async function pushAppNotification(params: {
  userId: string;
  tenantId: string;
  titlePl: string;
  titleEn: string;
  bodyPl: string;
  bodyEn: string;
  href: string;
  icon: string;
  /** Próg deduplikacji (patrz `PurchaseContext.eventAt`). */
  since?: string | null;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // RAZ NA ZDARZENIE. Ponowna dostawa zdarzenia już obsłużonego (operator,
    // zamiatarka, panel) i powtórne założenie (`created` po zdarzeniu, które
    // założyło wiersz) ogłaszają skutki jeszcze raz. Maile mają ziarna
    // idempotencji, CRM jest zapisem zbieżnym -
    // dzwonek to zwykły INSERT, więc pomijamy go, gdy ten sam dzwonek (tytuł
    // + adres) leży już u odbiorcy od chwili zdarzenia. Awaria odczytu nie
    // wstrzymuje dzwonka: lepszy duplikat niż cisza.
    if (params.since) {
      const { data: seen, error: seenError } = await supabaseAdmin
        .from("notifications")
        .select("id")
        .eq("user_id", params.userId)
        .eq("tenant_id", params.tenantId)
        .eq("kind", "billing")
        .eq("title_pl", params.titlePl)
        .eq("href", params.href)
        .gte("created_at", params.since)
        .limit(1);
      if (seenError) {
        console.warn("[payments] notification dedupe lookup failed", seenError.message);
      } else if ((seen ?? []).length > 0) {
        return;
      }
    }
    const { error } = await supabaseAdmin.from("notifications").insert({
      user_id: params.userId,
      tenant_id: params.tenantId,
      kind: "billing",
      title_pl: params.titlePl,
      title_en: params.titleEn,
      body_pl: params.bodyPl,
      body_en: params.bodyEn,
      href: params.href,
      icon: params.icon,
    });
    if (error) throw new Error(`notification insert failed: ${error.message}`);
  } catch (err) {
    console.error("[payments] app notification failed", err);
  }
}

/**
 * Stan komercyjny kontaktu wynikający ze stanu subskrypcji u operatora.
 *
 * PAUZA ≠ ODEJŚCIE (P13). Wstrzymana subskrypcja i zaległa płatność to wciąż
 * klient: etap sprzedaży `won`, cykl życia `customer`, a stan widać po tagu
 * (`subscription:paused`, `subscription:past_due`). Odejściem jest dopiero
 * zakończenie subskrypcji (`churned` -> `former_customer`).
 */
export type CrmSubscriptionState = "customer" | "paused" | "past_due" | "churned";

const CRM_STAGE_BY_STATE: Record<CrmSubscriptionState, "won" | "archived"> = {
  customer: "won",
  paused: "won",
  past_due: "won",
  churned: "archived",
};

/**
 * Etap cyklu życia ustawiany przez billing (`crm_set_lifecycle_stage(...,
 * 'billing')`, S4). Etapy klienta należą WYŁĄCZNIE do billingu - strażnik
 * kolumn huba (Z-06) odrzuca je z każdego innego źródła.
 */
export const CRM_LIFECYCLE_BY_STATE: Record<CrmSubscriptionState, "customer" | "former_customer"> =
  {
    customer: "customer",
    paused: "customer",
    past_due: "customer",
    churned: "former_customer",
  };

/**
 * Ranga segmentu kontaktu - lustro `public._crm_source_type_rank`
 * (20260926090000; parytet pilnuje test czytający migrację). Zakup podnosi
 * segment do `paid_subscriber`, ale nigdy go nie obniża.
 */
export const CRM_SOURCE_TYPE_RANK: Readonly<Record<string, number>> = {
  manual: 10,
  contact_form: 20,
  newsletter: 20,
  registered: 30,
  event_participant: 40,
  event_cfp: 50,
  speaker: 60,
  club_application: 70,
  careers: 70,
  expert: 70,
  paid_subscriber: 90,
};

/** Czy segment `current` należy podnieść do klienta płacącego. */
export function shouldRaiseToPaidSubscriber(current: string | null | undefined): boolean {
  const rank = current ? (CRM_SOURCE_TYPE_RANK[current] ?? 0) : 0;
  return rank < CRM_SOURCE_TYPE_RANK.paid_subscriber;
}

/**
 * Prefiksy `origin_ref` zadań retencyjnych z przepisów (20261020130200):
 * `retention:cancel_scheduled:<zdarzenie>` i `retention:canceled:<zdarzenie>`.
 */
const RETENTION_TASK_PREFIX = "retention:";
const RETENTION_CANCELED_TASK_PREFIX = "retention:canceled:";

/**
 * Zamyka (status `cancelled`) otwarte zadania retencyjne leada.
 *
 * DLACZEGO. Pauza u operatora zapisuje dostęp jako `canceled`, więc przepis
 * „anulowanie -> zadanie win-back" odpala się także przy pauzie - handlowiec
 * dzwonił do klienta, który nie zrezygnował (P13). Pauza zamyka więc zadania
 * `retention:canceled:*`, a wznowienie / powrót do rozliczeń - wszystkie
 * zadania retencyjne: klient jest z powrotem, nie ma kogo odzyskiwać.
 * Anulowane, nie skasowane: historia leada zostaje.
 */
async function closeRetentionTasks(
  admin: AdminClient,
  tenantId: string,
  leadId: string,
  prefix: string,
): Promise<void> {
  const { error } = await admin
    .from("crm_tasks")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .eq("status", "open")
    .like("origin_ref", `${prefix}%`);
  if (error) throw new Error(`crm retention tasks close failed: ${error.message}`);
}

/**
 * Znacznik w CRM wynikający ze stanu subskrypcji. Nigdy nie rzuca.
 *
 * Anulowanie i pauza muszą być widoczne w CRM tak samo jak zakup - inaczej
 * lejek pokazuje „won” dla kontaktu, który już nie płaci.
 */
export async function syncCrmSubscriptionState(
  userId: string,
  tierKey: string,
  state: CrmSubscriptionState = "customer",
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("email, first_name, last_name, tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw new Error(`crm profile read failed: ${profileError.message}`);
    const email = profile?.email?.trim().toLowerCase();
    if (!email || !profile?.tenant_id) return;

    const { data: lead, error: leadError } = await supabaseAdmin
      .from("crm_leads")
      .select("id, tags, source_type")
      .eq("tenant_id", profile.tenant_id)
      .eq("email_norm", email)
      .maybeSingle();
    // Nieudany odczyt to NIE „brak leada" - gałąź `insert` założyłaby wtedy
    // drugi kontakt dla tej samej osoby.
    if (leadError) throw new Error(`crm lead lookup failed: ${leadError.message}`);

    const tag = `plan:${tierKey}`;
    const stateTags: Record<CrmSubscriptionState, string[]> = {
      customer: ["customer", tag],
      paused: ["customer", tag, "subscription:paused"],
      past_due: ["customer", tag, "subscription:past_due"],
      churned: [tag, "churned"],
    };
    const dropTags: Record<CrmSubscriptionState, string[]> = {
      customer: ["subscription:paused", "subscription:past_due", "churned"],
      paused: ["subscription:past_due", "churned"],
      past_due: ["subscription:paused", "churned"],
      churned: ["customer", "subscription:paused", "subscription:past_due"],
    };

    let leadId: string | null = null;
    if (lead) {
      leadId = lead.id;
      const tags = Array.from(
        new Set([...lead.tags.filter((t) => !dropTags[state].includes(t)), ...stateTags[state]]),
      );
      const raise =
        state !== "churned" &&
        shouldRaiseToPaidSubscriber((lead as { source_type?: string | null }).source_type);
      const { error } = await supabaseAdmin
        .from("crm_leads")
        .update({
          stage: CRM_STAGE_BY_STATE[state],
          tags,
          last_activity_at: new Date().toISOString(),
          // Zakup podnosi segment (ranga 90), nigdy go nie obniża - lustro
          // `_crm_source_type_rank`, którym rośnie każdy inny pisarz CRM.
          ...(raise ? { source_type: "paid_subscriber" } : {}),
        })
        .eq("id", lead.id);
      if (error) throw new Error(`crm lead update failed: ${error.message}`);
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from("crm_leads")
        .insert({
          tenant_id: profile.tenant_id,
          email,
          email_norm: email,
          first_name: profile.first_name ?? null,
          last_name: profile.last_name ?? null,
          stage: CRM_STAGE_BY_STATE[state],
          // ZBIÓR DOZWOLONYCH WARTOŚCI PILNUJE BAZA (crm_leads_source_type_check).
          // Było tu "import", którego CHECK nie zna - INSERT dostawał 23514
          // w `{ error }`, którego nikt nie czytał, więc klient PŁACĄCY BEZ
          // WCZEŚNIEJSZEGO LEADA nie trafiał do CRM, a log milczał. Kontrakt
          // wartości pilnuje test `lib/crm/__tests__/leadSourceTypeContract.test.ts`,
          // a każdy inny odrzucony zapis trafia teraz przez `throw` do `catch`
          // niżej (log, bez rzutu).
          source_type: "paid_subscriber",
          tags: stateTags[state],
        })
        .select("id")
        .maybeSingle();
      if (error) throw new Error(`crm lead insert failed: ${error.message}`);
      leadId = (inserted as { id?: string } | null)?.id ?? null;
    }

    if (!leadId) return;

    // Cykl życia: billing jest jedynym pisarzem etapów klienta (Z-06). Nowy
    // lead powstaje z etapem domyślnym, a etap klienta nadaje RPC - wprost
    // w INSERT strażnik by go odrzucił (źródło spoza billingu). Powrót
    // `former_customer` -> `customer` to „cofnięcie" na osi lejka, stąd
    // `p_allow_backward`.
    const { error: lifecycleError } = await (supabaseAdmin as unknown as RpcCallable).rpc(
      "crm_set_lifecycle_stage",
      {
        p_lead_id: leadId,
        p_stage: CRM_LIFECYCLE_BY_STATE[state],
        p_source: "billing",
        p_allow_backward: true,
      },
    );
    if (lifecycleError) {
      throw new Error(`crm lifecycle update failed: ${lifecycleError.message}`);
    }

    if (state === "paused") {
      await closeRetentionTasks(
        supabaseAdmin,
        profile.tenant_id,
        leadId,
        RETENTION_CANCELED_TASK_PREFIX,
      );
    } else if (state === "customer") {
      await closeRetentionTasks(supabaseAdmin, profile.tenant_id, leadId, RETENTION_TASK_PREFIX);
    }
  } catch (err) {
    console.error("[payments] crm sync failed", err);
  }
}

/** Zgodność wstecz: zakup = kontakt w stanie „customer”. */
const syncCrmCustomer = (userId: string, tierKey: string) =>
  syncCrmSubscriptionState(userId, tierKey, "customer");

/**
 * Ile razy ponawiamy scalenie zgód po przegranym wyścigu z innym zapisem tego
 * samego wiersza (warunkowy UPDATE po `updated_at` nie trafił).
 */
const NEWSLETTER_MERGE_ATTEMPTS = 3;

/**
 * Tolerancja zegarów (serwer aplikacji vs baza) przy szukaniu w rejestrze
 * `crm_consent_log` wpisu dopisanego po scaleniu - `created_at` rejestru
 * stempluje baza, `received_at` wpisu w wierszu stempluje serwer.
 */
const CONSENT_LOG_CLOCK_SKEW_MS = 10 * 60 * 1000;

/**
 * Klasy SQLSTATE, po których PONOWIENIE ma sens: połączenie (08), wycofana
 * transakcja - serializacja i zakleszczenie (40), brak zasobów (53),
 * przerwanie przez operatora i limit czasu zapytania (57), błąd systemu (58)
 * i błąd wewnętrzny (XX). Kody PostgREST `PGRST000`-`PGRST003` to połączenie
 * z bazą, pula i limit czasu. Brak kodu = błąd sieci po drodze (supabase-js
 * zwraca wtedy `{ error }` z pustym `code`). Wszystko inne (uprawnienia,
 * schemat, CHECK, dane) ponowienie tylko by powtórzyło.
 */
const TRANSIENT_SQLSTATE_CLASSES: ReadonlySet<string> = new Set([
  "08",
  "40",
  "53",
  "57",
  "58",
  "XX",
]);

function isTransientDbError(error: { code?: string | null } | null | undefined): boolean {
  const code = typeof error?.code === "string" ? error.code : "";
  if (!code) return true;
  if (/^PGRST00[0-3]$/.test(code)) return true;
  if (code === "55P03") return true; // lock_not_available
  return TRANSIENT_SQLSTATE_CLASSES.has(code.slice(0, 2));
}

/**
 * Przejściowa awaria zapisu zgody. Jedyny błąd, który `subscribePremiumNewsletter`
 * wypuszcza na zewnątrz - webhook odpowiada wtedy błędem, operator ponawia
 * zdarzenie, a zapis zgody wraca, ZANIM potwierdzenie zakupu zostanie zajęte.
 * Rodzaj `RetryableAnnouncementError`: w kolejce komunikatów webhooka
 * (`deliverAnnouncements`) też wraca do wołającego zamiast zniknąć w logu.
 */
export class NewsletterOptInRetryableError extends RetryableAnnouncementError {
  constructor(message: string) {
    super(message);
    this.name = "NewsletterOptInRetryableError";
  }
}

/** Błąd bazy przełożony na „ponów" (przejściowy) albo zwykły błąd (trwały). */
function newsletterDbFailure(
  what: string,
  error: { message: string; code?: string | null },
): Error {
  const message = `${what}: ${error.message}`;
  return isTransientDbError(error)
    ? new NewsletterOptInRetryableError(message)
    : new Error(message);
}

/**
 * Wpis rejestru `crm_consent_log` dla zgody dopisanej do istniejącego wiersza.
 * Wyzwalacz `newsletter_to_lead` loguje wyłącznie INSERT wiersza, więc przy
 * scaleniu dowód do rejestru dopisujemy sami.
 */
async function insertCheckoutConsentLog(
  supabaseAdmin: (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"],
  input: {
    tenantId: string;
    email: string;
    subscriberId: string;
    consent: NonNullable<ReturnType<typeof buildPremiumNewsletterConsentEntry>>;
  },
): Promise<void> {
  const { error } = await supabaseAdmin.from("crm_consent_log").insert({
    tenant_id: input.tenantId,
    email: input.email,
    source_type: "newsletter",
    source_id: input.subscriberId,
    form_name: PREMIUM_NEWSLETTER_FORM_NAME,
    consent_key: input.consent.key,
    consent_text: input.consent.text,
    consent_version: input.consent.version,
    given: true,
    lang: input.consent.lang,
  });
  if (error) throw newsletterDbFailure("newsletter consent log failed", error);
}

/**
 * Domknięcie rejestru po przerwanym scaleniu: wiersz niesie już zgodę TEGO
 * zakupu (`recordedAt`), więc rejestr musi mieć wpis tego klucza i wersji dla
 * tego wiersza, dopisany nie wcześniej niż scalenie. Brak = poprzednia próba
 * padła między dwoma zapisami - dopisujemy teraz. Zgody, która zdążyła trafić
 * do rejestru, NIE dublujemy.
 */
async function ensureCheckoutConsentLogged(
  supabaseAdmin: (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"],
  input: {
    tenantId: string;
    email: string;
    subscriberId: string;
    recordedAt: string;
    consent: NonNullable<ReturnType<typeof buildPremiumNewsletterConsentEntry>>;
  },
): Promise<void> {
  const recorded = Date.parse(input.recordedAt);
  const since = new Date(
    (Number.isNaN(recorded) ? Date.now() : recorded) - CONSENT_LOG_CLOCK_SKEW_MS,
  ).toISOString();
  const { data, error } = await supabaseAdmin
    .from("crm_consent_log")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("source_type", "newsletter")
    .eq("source_id", input.subscriberId)
    .eq("consent_key", input.consent.key)
    .eq("consent_version", input.consent.version)
    .eq("given", true)
    .gte("created_at", since)
    .limit(1);
  // Nieudany odczyt to NIE „brak wpisu" - dopisanie na ślepo dublowałoby dowód.
  if (error) throw newsletterDbFailure("newsletter consent log lookup failed", error);
  if (Array.isArray(data) && data.length > 0) return;
  await insertCheckoutConsentLog(supabaseAdmin, input);
}

/**
 * Zapis płacącego klienta na newsletter premium - WYŁĄCZNIE po jawnej zgodzie
 * z pola w checkoucie (SUB-15).
 *
 * ODPORNOŚĆ NA PONOWIENIE (audyt, SUB-15 #34). Dawniej funkcja szła PO zajęciu
 * potwierdzenia zakupu i połykała każdy błąd: jedna chwilowa awaria odczytu
 * profilu, listy wykluczeń albo zapisu i zaznaczona zgoda przepadała na
 * zawsze - webhook kończył się 200, operator nie ponawiał, a ręczną powtórkę
 * blokowało już zajęte potwierdzenie. Teraz:
 *   * `applyPurchaseEffects` woła ją PRZED zajęciem potwierdzenia, a cały zapis
 *     jest idempotentny (wstawienie bez nadpisywania, scalenie bez dublowania,
 *     domknięcie rejestru bez dublowania), więc ponowienie zdarzenia jest
 *     bezpieczne i nie dubluje maila ani dzwonka,
 *   * awaria PRZEJŚCIOWA (sieć, limit czasu, serializacja, przegrany wyścig)
 *     wychodzi jako `NewsletterOptInRetryableError` - webhook odpowiada
 *     błędem i operator ponawia zdarzenie,
 *   * awaria TRWAŁA (uprawnienia, schemat, CHECK) zostaje w logu, a zakup
 *     biegnie dalej - ponowienie i tak by jej nie naprawiło, a blokowałoby
 *     potwierdzenie zakupu przez trzy doby ponowień.
 *
 * Reguły zapisu:
 *  1. Bez zgody ani jednego zapytania: zakup nie jest zgodą marketingową.
 *     Zgoda nieważna (nieznana wersja treści, przeterminowana) - tak samo.
 *  2. Lista wykluczeń jak przy zapisie z formularza (`suppressionBlocksSignup`),
 *     ale FAIL-CLOSED: nieudany odczyt listy to brak zapisu, nie „czysto".
 *     Pole w checkoucie nie jest double opt-in, więc wypis (`unsubscribe`)
 *     i blokady trwałe zatrzymują zapis - zdejmuje je DOI albo operator.
 *  3. Świadome wypisanie się jest nadrzędne (`canAutoSubscribe`).
 *  4. Brak wiersza: wstawienie bez nadpisywania (`ignoreDuplicates`), a dowód
 *     do rejestru `crm_consent_log` dopisuje wyzwalacz `newsletter_to_lead`
 *     w tej samej transakcji co wiersz.
 *  5. Wiersz istnieje: SCALENIE. `consents` dostaje nowy wpis obok starych,
 *     `confirmed_at`, `source`, `created_at`, imię, język i `meta` zostają
 *     nietknięte; `pending` przechodzi w `subscribed` (zgodę złożył właściciel
 *     zalogowanego konta), a `confirmed_at` ustawiamy tylko, gdy go nie było.
 *     Wyzwalacz nie loguje UPDATE-u, więc dowód do rejestru dopisujemy sami -
 *     a gdy ten drugi zapis padnie, ponowienie widzi zgodę tego zakupu
 *     w wierszu i domyka rejestr (`ensureCheckoutConsentLogged`).
 *  6. Wyścig: odczyt-scalenie-zapis jest warunkowy (`updated_at` z odczytu),
 *     więc równoległy zapis tego samego wiersza nie zginie - przegrany ponawia.
 */
async function subscribePremiumNewsletter(params: {
  userId: string;
  tenantId: string;
  tierKey: string;
  subscriptionId: string;
  consent: PremiumNewsletterConsentGrant | null;
}): Promise<void> {
  if (!params.consent) return;
  const consent = buildPremiumNewsletterConsentEntry({
    grant: params.consent,
    subscriptionId: params.subscriptionId,
  });
  if (!consent) {
    console.warn("[payments] premium newsletter consent rejected (unknown version or stale)", {
      subscriptionId: params.subscriptionId,
    });
    return;
  }

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("email, first_name, last_name")
      .eq("id", params.userId)
      .maybeSingle();
    if (profileError) throw newsletterDbFailure("newsletter profile read failed", profileError);
    const email = profile?.email?.trim().toLowerCase();
    if (!email) return;

    const { data: suppressed, error: suppressionError } = await supabaseAdmin.rpc(
      "email_filter_suppressed",
      { p_tenant: params.tenantId, p_emails: [email] },
    );
    if (suppressionError) {
      throw newsletterDbFailure("newsletter suppression lookup failed", suppressionError);
    }
    const blocked = (suppressed ?? []).some(
      (hit) =>
        hit.email?.trim().toLowerCase() === email &&
        suppressionBlocksSignup({
          reason: hit.reason as SuppressionReason,
          scope: hit.scope as SuppressionScope,
          doubleOptIn: false,
        }),
    );
    if (blocked) return;

    for (let attempt = 0; attempt < NEWSLETTER_MERGE_ATTEMPTS; attempt += 1) {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from("newsletter_subscribers")
        .select("id, status, unsubscribed_at, confirmed_at, consents, user_id, updated_at")
        .eq("tenant_id", params.tenantId)
        .eq("email", email)
        .maybeSingle();
      // Nieudany odczyt to NIE „brak zapisu" - `canAutoSubscribe(null)` przepuszcza,
      // a zapis bez odczytu nadpisałby świadome wypisanie albo cudze dowody.
      if (existingError) {
        throw newsletterDbFailure("newsletter consent lookup failed", existingError);
      }

      if (!canAutoSubscribe(existing)) return;

      if (!existing) {
        const row = buildPremiumNewsletterRow({
          tenantId: params.tenantId,
          userId: params.userId,
          email,
          firstName: profile?.first_name ?? null,
          lastName: profile?.last_name ?? null,
          tierKey: params.tierKey,
          subscriptionId: params.subscriptionId,
          consent,
        });
        // `ignoreDuplicates` = ON CONFLICT DO NOTHING: wiersz wstawiony w
        // międzyczasie przez formularz albo drugą dostawę zdarzenia NIE jest
        // nadpisywany - pusta odpowiedź każe go przeczytać i scalić.
        const { data: inserted, error } = await supabaseAdmin
          .from("newsletter_subscribers")
          .upsert(row, { onConflict: "tenant_id,email", ignoreDuplicates: true })
          .select("id");
        if (error) throw newsletterDbFailure("newsletter insert failed", error);
        if (inserted && inserted.length > 0) return;
        continue;
      }

      const merged = mergeNewsletterConsents(existing.consents, consent);
      if (!merged) {
        console.error("[payments] newsletter consents column is not an array - left intact", {
          subscriberId: existing.id,
        });
        return;
      }
      if (!merged.appended && existing.status === "subscribed") {
        // Zgoda tego zakupu już w wierszu (ponowienie po awarii między scaleniem
        // a rejestrem) - domykamy rejestr. Zgoda z innego źródła: nic do zrobienia.
        const recordedAt = recordedCheckoutConsentAt(existing.consents, consent);
        if (recordedAt) {
          await ensureCheckoutConsentLogged(supabaseAdmin, {
            tenantId: params.tenantId,
            email,
            subscriberId: existing.id,
            recordedAt,
            consent,
          });
        }
        return;
      }

      const { data: updated, error } = await supabaseAdmin
        .from("newsletter_subscribers")
        .update({
          consents: merged.consents,
          ...(existing.status === "subscribed" ? {} : { status: "subscribed" }),
          ...(existing.confirmed_at ? {} : { confirmed_at: consent.received_at }),
          ...(existing.user_id ? {} : { user_id: params.userId }),
        })
        .eq("id", existing.id)
        .eq("updated_at", existing.updated_at)
        .select("id");
      if (error) throw newsletterDbFailure("newsletter consent merge failed", error);
      if (!updated || updated.length === 0) continue;

      if (merged.appended) {
        await insertCheckoutConsentLog(supabaseAdmin, {
          tenantId: params.tenantId,
          email,
          subscriberId: existing.id,
          consent,
        });
      }
      return;
    }
    // Ciągle przegrywany wyścig to rywalizacja, nie wada danych - ponowienie
    // zdarzenia za chwilę trafi na spokojniejszy wiersz.
    throw new NewsletterOptInRetryableError(
      "newsletter consent merge kept losing the race - nothing written",
    );
  } catch (err) {
    console.error("[payments] premium newsletter opt-in failed", err);
    if (err instanceof NewsletterOptInRetryableError) throw err;
  }
}

/**
 * Zajęcie potwierdzenia zakupu; awaria zajęcia (błąd bazy) to porażka do
 * ponowienia - potwierdzenie zostaje wolne, więc ponowienie zdarzenia wraca
 * tu, zamiast zgubić mail i dzwonek zakupu.
 */
async function claimConfirmationOrRetry(claim: () => Promise<boolean>): Promise<boolean> {
  try {
    return await claim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RetryableAnnouncementError(`purchase confirmation claim failed: ${message}`);
  }
}

/**
 * Nowa subskrypcja: dostęp + mail + CRM + newsletter + powiadomienie.
 *
 * POTWIERDZENIE TYLKO ZA ZAPŁACONY STAN. Uprawnienie synchronizujemy zawsze
 * (stan operatora wygrywa z domyślnym „active"), ale mail „subskrypcja
 * potwierdzona", CRM „won", newsletter premium i dzwonek „Subskrypcja aktywna"
 * wychodzą WYŁĄCZNIE przy `active` / `trialing`. Checkout zakłada subskrypcję
 * jako `incomplete`, zanim przejdzie płatność (3DS, przelew) - porzucone 3DS
 * (`incomplete_expired`) zostawiało klientowi potwierdzenie zakupu, którego
 * nie było (audyt SUB-02).
 *
 * JEDNOKROTNOŚĆ: webhook (`webhookDispatch.server`) podaje `claimConfirmation`
 * - atomowe zajęcie `subscriptions.purchase_confirmed_at`. Zajęcie idzie PO
 * zapisie uprawnienia, więc awaria zapisu (wyjątek, operator ponawia
 * zdarzenie) nie „zużywa" potwierdzenia, a powtórka po sukcesie go nie dubluje.
 *
 * KOLEJNOŚĆ: IDEMPOTENTNE PRZED ZAJĘCIEM, JEDNORAZOWE PO NIM. CRM (stan
 * leada) i zapis zgody na newsletter powtórzone dają ten sam wynik, więc idą
 * PRZED zajęciem - przejściowa awaria zapisu zgody rzuca, webhook odpowiada
 * błędem, a ponowienie zdarzenia (potwierdzenie wciąż wolne) wraca do niej.
 * Po zajęciu zostają wyłącznie skutki, których nie wolno zdublować: mail
 * i dzwonek. CRM stoi przed newsletterem jak dotąd: wyzwalacz listy zakłada
 * leada, gdy go brak, a lead założony tu niesie źródło `paid_subscriber`.
 *
 * W WEBHOOKU CAŁE OGŁOSZENIE CZEKA NA ZAPIS STANU. CRM, zgoda, zajęcie, mail
 * i dzwonek to jeden komunikat w `announcements` - wychodzi dopiero po
 * zapisie wiersza `subscriptions` (A3), a zajęcie potwierdzenia trafia wtedy
 * w wiersz, który już istnieje (ścieżka zakładania wstawia go na końcu).
 * Przejściowa awaria zgody albo zajęcia wraca z `deliverAnnouncements` jako
 * `RetryableAnnouncementError`; potwierdzenie zostaje wolne, więc ponowienie
 * zdarzenia ogłasza zakup jeszcze raz - dokładnie raz do skutku.
 */
export async function applyPurchaseEffects(ctx: PurchaseContext): Promise<void> {
  const plan = await resolvePlanForPrice(ctx.priceId, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });
  if (!plan) {
    console.warn("[payments] no local plan for price", ctx.priceId);
    return;
  }

  await syncEntitlementState({
    userId: ctx.userId,
    tenantId: plan.tenantId,
    planId: plan.planId,
    externalRef: ctx.subscriptionId,
    status: ctx.status ?? "active",
    periodEnd: ctx.periodEnd,
    periodStart: ctx.periodStart ?? null,
    cancelAtPeriodEnd: ctx.cancelAtPeriodEnd,
  });

  if (!isEntitledSubscriptionStatus(ctx.status ?? "active")) return;

  await announce(ctx.announcements, async () => {
    await syncCrmCustomer(ctx.userId, plan.tierKey);

    // Rzuca WYŁĄCZNIE przy przejściowej awarii (`NewsletterOptInRetryableError`)
    // - przed zajęciem potwierdzenia, więc ponowienie zdarzenia wróci tutaj.
    await subscribePremiumNewsletter({
      userId: ctx.userId,
      tenantId: plan.tenantId,
      tierKey: plan.tierKey,
      subscriptionId: ctx.subscriptionId,
      consent: ctx.newsletterConsent ?? null,
    });

    if (ctx.claimConfirmation && !(await claimConfirmationOrRetry(ctx.claimConfirmation))) {
      return;
    }

    await notifySubscriptionEmail({
      kind: "subscription_confirmed",
      userId: ctx.userId,
      planId: plan.planId,
      periodEnd: ctx.periodEnd,
      amountCents: plan.priceCents,
      currency: plan.currency,
      idempotencySeed: ctx.subscriptionId,
    });

    await pushAppNotification({
      userId: ctx.userId,
      tenantId: plan.tenantId,
      titlePl: "Subskrypcja aktywna",
      titleEn: "Subscription active",
      bodyPl: "Dostęp do treści premium został włączony.",
      bodyEn: "Access to premium content is now enabled.",
      href: PROFILE_PLAN_PATH,
      icon: "badge-check",
      since: ctx.eventAt,
    });
  });
}

/**
 * Nominalna długość cyklu w dniach - mianownik proraty. Operator dzieli przez
 * RZECZYWISTĄ długość okresu (miesiąc ma 28-31 dni), więc kwota w mailu może
 * odbiec od faktury o kilka procent dopłaty - a nie o jej wielokrotność, jak
 * przy stałych 30 dniach dla planu rocznego. Cena jednorazowa nie ma cyklu.
 */
const CYCLE_DAYS: Record<PlanBillingInterval, number | null> = {
  two_weeks: 14,
  month: 30,
  quarter: 91,
  year: 365,
  one_time: null,
};

/**
 * Proporcjonalna dopłata za pozostałe dni bieżącego okresu (upgrade).
 * Zwraca `null`, gdy danych nie da się wiarygodnie policzyć - lepiej pominąć
 * zdanie o proracie niż podać kwotę niezgodną z fakturą operatora.
 */
function proratedDifferenceCents(
  previous: ResolvedPlan,
  next: ResolvedPlan,
  periodEnd: string | null,
): number | null {
  // Zmiana cyklu (miesiąc -> rok) zaczyna u operatora NOWY okres: faktura to
  // pełna nowa cena minus niewykorzystana część starej, a `periodEnd` jest już
  // końcem nowego okresu. Z różnicy cen i tej daty kwoty nie odtworzymy.
  if (previous.interval !== next.interval) return null;
  const cycleDays = CYCLE_DAYS[next.interval];
  if (!cycleDays || !periodEnd || previous.priceCents == null || next.priceCents == null) {
    return null;
  }
  const diff = next.priceCents - previous.priceCents;
  if (diff <= 0) return null;
  const end = new Date(periodEnd).getTime();
  if (Number.isNaN(end)) return null;
  const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
  if (daysLeft <= 0) return null;
  const share = Math.min(1, daysLeft / cycleDays);
  return Math.round(diff * share);
}

/**
 * Dopłata do maila o upgradzie.
 *
 * Szacunek z różnicy cen katalogu (`proratedDifferenceCents`) jest prawdą
 * tylko wtedy, gdy klient płacił cenę katalogu za POPRZEDNI plan. Dla kluczy
 * objętych zmianą cennika v6.2 (Członek, Członek Pro, Zespół) nie da się tego
 * stwierdzić z samego zdarzenia: `access_plans` ma już 39 / 119 / 89 zł, a
 * subskrypcja do akcji przeniesienia (u pominiętych na stałe) płaciła
 * 59 / 129 / 99 zł - mail liczyłby dopłatę z 119-39 zamiast z 119-59. Zdania
 * o dopłacie wtedy nie ma („lepiej pominąć niż podać kwotę niezgodną
 * z fakturą"); kwotę i tak pokazuje faktura operatora. Webhook nie pyta
 * operatora o fakturę - odczyt w trakcie obsługi zdarzenia wydłużałby ją
 * i mieszał się z odczytem żywego stanu strażnika kolejności.
 */
function upgradeProrationCents(
  ctx: PurchaseContext & { previousPriceId: string | null },
  previous: ResolvedPlan,
  plan: ResolvedPlan,
): number | null {
  if (isRepriceLookupKey(ctx.previousPriceId)) return null;
  return proratedDifferenceCents(previous, plan, ctx.periodEnd);
}

/** Zmiana planu: aktualizacja dostępu + mail o upgrade/downgrade. */
export async function applyPlanChangeEffects(
  ctx: PurchaseContext & { previousPriceId: string | null; direction: "upgrade" | "downgrade" },
): Promise<void> {
  const plan = await resolvePlanForPrice(ctx.priceId, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });
  if (!plan) return;
  const previous = ctx.previousPriceId
    ? await resolvePlanForPrice(ctx.previousPriceId, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
      })
    : null;

  await syncEntitlementState({
    userId: ctx.userId,
    tenantId: plan.tenantId,
    planId: plan.planId,
    externalRef: ctx.subscriptionId,
    status: ctx.status ?? "active",
    periodEnd: ctx.periodEnd,
    periodStart: ctx.periodStart ?? null,
    cancelAtPeriodEnd: ctx.cancelAtPeriodEnd,
  });

  // Upgrade rozlicza się od razu: różnica cen za pozostałą część okresu to
  // realna kwota dopłaty, którą pokazujemy w mailu (bez niej klient widzi samą
  // nową cenę i zgłasza reklamację o "podwójne obciążenie").
  const prorationCents =
    ctx.direction === "upgrade" && previous ? upgradeProrationCents(ctx, previous, plan) : null;

  await announce(ctx.announcements, async () => {
    await notifySubscriptionEmail({
      kind: ctx.direction === "upgrade" ? "subscription_upgraded" : "subscription_downgraded",
      userId: ctx.userId,
      planId: plan.planId,
      previousPlanId: previous?.planId ?? null,
      periodEnd: ctx.periodEnd,
      amountCents: plan.priceCents,
      currency: plan.currency,
      prorationCents,
      idempotencySeed: `${ctx.subscriptionId}:${ctx.priceId}`,
    });

    await pushAppNotification({
      userId: ctx.userId,
      tenantId: plan.tenantId,
      titlePl: ctx.direction === "upgrade" ? "Plan podniesiony" : "Zmiana planu zaplanowana",
      titleEn: ctx.direction === "upgrade" ? "Plan upgraded" : "Plan change scheduled",
      bodyPl:
        ctx.direction === "upgrade"
          ? "Nowy plan działa od razu, rozliczyliśmy różnicę proporcjonalnie."
          : "Niższy plan zacznie obowiązywać po zakończeniu opłaconego okresu.",
      bodyEn:
        ctx.direction === "upgrade"
          ? "The new plan is active now; the difference was prorated."
          : "The lower plan starts once the paid period ends.",
      href: PROFILE_PLAN_PATH,
      icon: "arrow-up-right",
      since: ctx.eventAt,
    });
  });
}

/** Kontekst zakończenia subskrypcji: `nonPayment` = koniec windykacji, nie rezygnacja. */
export interface CancellationContext extends PurchaseContext {
  /**
   * Operator zakończył subskrypcję za brak płatności (`payment_failed` /
   * `payment_disputed`). `periodEnd` to wtedy koniec KARENCJI (bywa już w
   * przeszłości), a nie koniec opłaconego okresu.
   */
  nonPayment?: boolean;
}

/**
 * Rezygnacja: dostęp do końca okresu + mail + ankieta retencyjna.
 *
 * KONIEC WINDYKACJI TO NIE REZYGNACJA. Mail `subscription_canceled` ma stałą
 * treść „potwierdzamy rezygnację, dostęp do końca opłaconego okresu, wznów
 * jednym kliknięciem", a dzwonek - „Dostęp działa do końca opłaconego
 * okresu". Po anulowaniu za brak płatności żadne z tych zdań nie jest
 * prawdą: klient nie rezygnował, okres nie był opłacony, dostęp trwa
 * najwyżej do końca karencji (często już minionej), a anulowanej subskrypcji
 * nie da się wznowić (audyt SUB-03). Taki klient dostał już maile windykacji
 * z datą końca dostępu, więc mail o rezygnacji nie idzie, a dzwonek mówi, co
 * się stało i co dalej. CRM odnotowuje odejście tak samo.
 */
export async function applyCancellationEffects(ctx: CancellationContext): Promise<void> {
  const plan = await resolvePlanForPrice(ctx.priceId, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });
  if (!plan) return;

  // Dostęp gaśnie z końcem opłaconego okresu (albo karencji) - uprawnienie
  // musi to odzwierciedlać.
  await syncEntitlementState({
    userId: ctx.userId,
    tenantId: plan.tenantId,
    planId: plan.planId,
    externalRef: ctx.subscriptionId,
    status: "canceled",
    periodEnd: ctx.periodEnd,
    periodStart: ctx.periodStart ?? null,
  });

  if (ctx.nonPayment) {
    // Treść dzwonka wynika z dostępu w chwili ZDARZENIA, nie wysyłki.
    const graceRunning = accessActiveAt(ctx.periodEnd) && ctx.periodEnd !== null;
    await announce(ctx.announcements, async () => {
      await syncCrmSubscriptionState(ctx.userId, plan.tierKey, "churned");
      await pushAppNotification({
        userId: ctx.userId,
        tenantId: plan.tenantId,
        titlePl: "Subskrypcja zakończona",
        titleEn: "Subscription ended",
        bodyPl: graceRunning
          ? "Nie udało się pobrać płatności. Dostęp działa jeszcze do końca okresu karencji - wybierz plan, żeby go zachować."
          : "Nie udało się pobrać płatności, więc dostęp wygasł. Wybierz plan, żeby wrócić.",
        bodyEn: graceRunning
          ? "We couldn't collect your payment. Access continues until the grace period ends - choose a plan to keep it."
          : "We couldn't collect your payment, so access has ended. Choose a plan to come back.",
        href: PROFILE_PLAN_PATH,
        icon: "credit-card",
        since: ctx.eventAt,
      });
    });
    return;
  }

  await announce(ctx.announcements, async () => {
    await notifySubscriptionEmail({
      kind: "subscription_canceled",
      userId: ctx.userId,
      planId: plan.planId,
      periodEnd: ctx.periodEnd,
      idempotencySeed: `cancel:${ctx.subscriptionId}`,
    });

    // CRM: kontakt przestaje być aktywnym klientem (lejek nie może pokazywać „won”).
    await syncCrmSubscriptionState(ctx.userId, plan.tierKey, "churned");

    await pushAppNotification({
      userId: ctx.userId,
      tenantId: plan.tenantId,
      titlePl: "Subskrypcja anulowana",
      titleEn: "Subscription canceled",
      bodyPl: "Dostęp działa do końca opłaconego okresu. Powiedz nam, co możemy poprawić.",
      bodyEn: "Access remains until the paid period ends. Tell us what we can improve.",
      // Bez `?retention=1`: strona planu nie czyta tego parametru (P12) - link
      // obiecywał ankietę, której nie było.
      href: PROFILE_PLAN_PATH,
      icon: "message-circle-question",
      since: ctx.eventAt,
    });
  });
}

/** Stan subskrypcji zgłoszony przez operatora w zdarzeniu `subscription.updated`. */
export interface StatusTransitionContext {
  userId: string;
  /** Najemca z wiersza `subscriptions` - patrz `PurchaseContext.tenantId`. */
  tenantId?: string | null;
  priceId: string;
  subscriptionId: string;
  periodEnd: string | null;
  previousStatus: string | null;
  status: string;
  /** Próg deduplikacji dzwonka (patrz `PurchaseContext.eventAt`). */
  eventAt?: string | null;
  /** Kolejka komunikatów odroczonych (patrz `AnnouncementQueue`). */
  announcements?: AnnouncementQueue;
  /**
   * Kwota pozycji z ładunku zdarzenia (cena, na której subskrypcja JEST
   * u operatora, × ilość). Brak = cena planu z katalogu wyłącznie dla kluczy
   * spoza zmiany cennika v6.2; dla Członka, Członka Pro i Zespołu - mail bez
   * kwoty (katalog nie musi być ich ceną).
   */
  charge?: { amountCents: number; currency: string } | null;
}

/**
 * Zmiana samego stanu subskrypcji (pauza, wznowienie, zaległość, powrót do
 * rozliczeń). Uprawnienie synchronizuje webhook; tutaj domykamy warstwy
 * widoczne dla człowieka: CRM i powiadomienie w aplikacji. Plan rozwiązujemy
 * od razu (odczyt może rzucić - wtedy przed zapisem stanu), komunikaty idą do
 * kolejki wołającego, gdy ją podał.
 */
export async function applyStatusTransitionEffects(ctx: StatusTransitionContext): Promise<void> {
  if (ctx.previousStatus === ctx.status) return;
  const plan = await resolvePlanForPrice(ctx.priceId, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });
  if (!plan) return;

  if (ctx.status === "paused") {
    await announce(ctx.announcements, async () => {
      await syncCrmSubscriptionState(ctx.userId, plan.tierKey, "paused");
      await pushAppNotification({
        userId: ctx.userId,
        tenantId: plan.tenantId,
        titlePl: "Subskrypcja wstrzymana",
        titleEn: "Subscription paused",
        bodyPl: "Dostęp do treści premium jest nieaktywny do czasu wznowienia.",
        bodyEn: "Premium access is inactive until you resume the subscription.",
        href: PROFILE_PLAN_PATH,
        icon: "pause-circle",
        since: ctx.eventAt,
      });
      await notifySubscriptionEmail({
        kind: "subscription_paused",
        userId: ctx.userId,
        planId: plan.planId,
        periodEnd: ctx.periodEnd,
        amountCents: plan.priceCents,
        currency: plan.currency,
        idempotencySeed: `${ctx.subscriptionId}:paused:${ctx.periodEnd ?? ""}`,
      });
    });
    return;
  }

  // Zaległa płatność: klient nadal jest klientem, ale handlowiec ma to
  // widzieć w CRM (P13: `past_due` było niewidoczne). Maile windykacji
  // wysyła dunning - tu wyłącznie znacznik.
  if (ctx.status === "past_due") {
    await announce(ctx.announcements, async () => {
      await syncCrmSubscriptionState(ctx.userId, plan.tierKey, "past_due");
    });
    return;
  }

  if (ctx.status === "active" || ctx.status === "trialing") {
    const resumed = ctx.previousStatus === "paused" || ctx.previousStatus === "past_due";
    await announce(ctx.announcements, async () => {
      await syncCrmSubscriptionState(ctx.userId, plan.tierKey, "customer");
      if (!resumed) return;
      await pushAppNotification({
        userId: ctx.userId,
        tenantId: plan.tenantId,
        titlePl: "Subskrypcja wznowiona",
        titleEn: "Subscription resumed",
        bodyPl: "Dostęp do treści premium znów działa.",
        bodyEn: "Premium access is active again.",
        href: PROFILE_PLAN_PATH,
        icon: "badge-check",
        since: ctx.eventAt,
      });
      // Kwota z ceny, na której subskrypcja JEST u operatora (ładunek
      // zdarzenia), nie z katalogu: po zmianie cennika wznowiona subskrypcja
      // odnawia się po swojej (np. starej) cenie.
      const catalogTrusted = !isRepriceLookupKey(ctx.priceId);
      const charge = ctx.charge ?? null;
      await notifySubscriptionEmail({
        kind: "subscription_resumed",
        userId: ctx.userId,
        planId: plan.planId,
        periodEnd: ctx.periodEnd,
        amountCents: charge ? charge.amountCents : catalogTrusted ? plan.priceCents : null,
        currency: charge?.currency ?? plan.currency,
        idempotencySeed: `${ctx.subscriptionId}:resumed:${ctx.periodEnd ?? ""}`,
      });
    });
  }
}
