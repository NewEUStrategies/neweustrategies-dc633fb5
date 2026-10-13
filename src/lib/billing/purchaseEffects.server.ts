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
   * Zgoda na newsletter z pola w checkoucie (metadane subskrypcji operatora).
   * Brak = pole niezaznaczone, więc zakup NIE dotyka listy - nowe miejsce
   * wołające `applyPurchaseEffects`, które zapomni przekazać to pole, kończy
   * się brakiem zapisu, a nie zgodą, której nikt nie wyraził (SUB-15).
   */
  newsletterConsent?: PremiumNewsletterConsentGrant | null;
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
    // RAZ NA ZDARZENIE. Webhook zapisuje stan subskrypcji dopiero po skutkach,
    // więc powtórka po porażce (operator, zamiatarka, panel) wykonuje skutki
    // jeszcze raz. Maile mają ziarna idempotencji, CRM jest zapisem zbieżnym -
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

/** Stan komercyjny kontaktu wynikający ze stanu subskrypcji u operatora. */
export type CrmSubscriptionState = "customer" | "paused" | "churned";

const CRM_STAGE_BY_STATE: Record<CrmSubscriptionState, "won" | "archived"> = {
  customer: "won",
  paused: "won",
  churned: "archived",
};

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
      .select("id, tags")
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
      churned: [tag, "churned"],
    };
    const dropTags: Record<CrmSubscriptionState, string[]> = {
      customer: ["subscription:paused", "churned"],
      paused: ["churned"],
      churned: ["customer", "subscription:paused"],
    };

    if (lead) {
      const tags = Array.from(
        new Set([...lead.tags.filter((t) => !dropTags[state].includes(t)), ...stateTags[state]]),
      );
      const { error } = await supabaseAdmin
        .from("crm_leads")
        .update({
          stage: CRM_STAGE_BY_STATE[state],
          tags,
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", lead.id);
      if (error) throw new Error(`crm lead update failed: ${error.message}`);
    } else {
      const { error } = await supabaseAdmin.from("crm_leads").insert({
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
      });
      if (error) throw new Error(`crm lead insert failed: ${error.message}`);
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
 */
export class NewsletterOptInRetryableError extends Error {
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
    cancelAtPeriodEnd: ctx.cancelAtPeriodEnd,
  });

  if (!isEntitledSubscriptionStatus(ctx.status ?? "active")) return;

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

  if (ctx.claimConfirmation && !(await ctx.claimConfirmation())) return;

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
    cancelAtPeriodEnd: ctx.cancelAtPeriodEnd,
  });

  // Upgrade rozlicza się od razu: różnica cen za pozostałą część okresu to
  // realna kwota dopłaty, którą pokazujemy w mailu (bez niej klient widzi samą
  // nową cenę i zgłasza reklamację o "podwójne obciążenie").
  const prorationCents =
    ctx.direction === "upgrade" && previous
      ? proratedDifferenceCents(previous, plan, ctx.periodEnd)
      : null;

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
    await syncCrmSubscriptionState(ctx.userId, plan.tierKey, "churned");
    const graceRunning = accessActiveAt(ctx.periodEnd) && ctx.periodEnd !== null;
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
    });
    return;
  }

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
    href: `${PROFILE_PLAN_PATH}?retention=1`,
    icon: "message-circle-question",
    since: ctx.eventAt,
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
}

/**
 * Zmiana samego stanu subskrypcji (pauza, wznowienie, zaległość, powrót do
 * rozliczeń). Uprawnienie synchronizuje webhook; tutaj domykamy warstwy
 * widoczne dla człowieka: CRM i powiadomienie w aplikacji.
 */
export async function applyStatusTransitionEffects(ctx: StatusTransitionContext): Promise<void> {
  if (ctx.previousStatus === ctx.status) return;
  const plan = await resolvePlanForPrice(ctx.priceId, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });
  if (!plan) return;

  if (ctx.status === "paused") {
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
    return;
  }

  if (ctx.status === "active" || ctx.status === "trialing") {
    await syncCrmSubscriptionState(ctx.userId, plan.tierKey, "customer");
    if (ctx.previousStatus === "paused" || ctx.previousStatus === "past_due") {
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
      await notifySubscriptionEmail({
        kind: "subscription_resumed",
        userId: ctx.userId,
        planId: plan.planId,
        periodEnd: ctx.periodEnd,
        amountCents: plan.priceCents,
        currency: plan.currency,
        idempotencySeed: `${ctx.subscriptionId}:resumed:${ctx.periodEnd ?? ""}`,
      });
    }
  }
}
