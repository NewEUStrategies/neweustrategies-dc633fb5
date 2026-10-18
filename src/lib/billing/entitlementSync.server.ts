// Most między stanem subskrypcji u operatora (`subscriptions`) a uprawnieniami
// czytanymi przez resztę platformy (`user_subscriptions`).
//
// `has_content_access()`, profil użytkownika, /admin/users, CRM, retencja oraz
// widgety z gatingiem czytają WYŁĄCZNIE `user_subscriptions`. Webhook operatora
// aktualizuje `subscriptions`, więc bez tej synchronizacji anulowanie, pauza,
// zwrot lub zmiana okresu rozliczeniowego nigdy nie docierały do uprawnień.
//
// Moduł server-only (klient service_role) - importuj wyłącznie z handlerów.
import { isEntitledSubscriptionStatus } from "@/lib/billing/accessPeriod";

/** Statusy subskrypcji zwracane przez operatora płatności. */
export type ProviderSubscriptionStatus =
  "active" | "trialing" | "past_due" | "unpaid" | "paused" | "canceled" | string;

/** Status w `user_subscriptions` (enum `purchase_status`). */
export type EntitlementStatus = "pending" | "active" | "refunded" | "canceled";

export interface EntitlementSyncInput {
  userId: string;
  tenantId: string;
  planId: string;
  /** Identyfikator subskrypcji u operatora - klucz idempotencji (`external_ref`). */
  externalRef: string;
  status: ProviderSubscriptionStatus;
  /**
   * Do kiedy uprawnienie daje dostęp; `null` = brak wygaśnięcia. Dla
   * zaległości i anulowania za brak płatności to koniec KARENCJI, nie okresu
   * operatora - wylicza go `accessPeriodFromEvent` (`accessPeriod.ts`).
   */
  periodEnd: string | null;
  /**
   * Czy u operatora jest zaplanowana rezygnacja (`cancel_at_period_end` /
   * `cancel_at`). `true` utrzymuje `canceled_at`, `false` je czyści (klient
   * wznowił), a brak wartości (wołający nie zna stanu operatora) zostawia
   * zapisane `canceled_at` bez zmian.
   */
  cancelAtPeriodEnd?: boolean;
  /**
   * Początek okresu rozliczeniowego, którego dotyczy stan (`current_period_start`).
   * Uprawnienie `refunded` (zwrot albo spór bieżącego okresu, `canceled_at` =
   * chwila korekty) wraca do życia WYŁĄCZNIE dla okresu, który zaczął się PO
   * korekcie - czyli po kolejnym opłaconym odnowieniu. Ten sam okres
   * (`subscription.updated`, synchronizacja na żądanie) go nie wskrzesza.
   */
  periodStart?: string | null;
  /**
   * Przywrócenie z rozstrzygnięcia na naszą korzyść (wygrany spór): stan
   * operatora nadpisuje `refunded` niezależnie od okresu.
   */
  force?: boolean;
}

/**
 * Mapuje status operatora na status uprawnienia.
 *
 * - `active` / `trialing` -> dostęp działa do `periodEnd`,
 * - `past_due` / `unpaid` -> dostęp działa, ale `periodEnd` to KONIEC
 *   KARENCJI (wyliczony przez wołającego): operator ponawia obciążenie, więc
 *   nie odbieramy dostępu przedwcześnie - i nie dajemy go za nieopłacony
 *   okres; `has_content_access()` sam wygasza rekord po karencji, bez
 *   czekania na kolejne zdarzenie operatora,
 * - `canceled` -> dostęp do `periodEnd` (koniec opłaconego okresu albo, przy
 *   anulowaniu za brak płatności, koniec karencji): zostawiamy `active`
 *   z datą, bo `has_content_access()` sam wygasza rekord; gdy data już
 *   minęła (lub jej nie ma) - `canceled`,
 * - `paused` i reszta (`incomplete`, `incomplete_expired`) -> `canceled`
 *   (brak dostępu od razu; wznowienie albo płatność doda go ponownie).
 */
export function mapProviderStatus(
  status: ProviderSubscriptionStatus,
  periodEnd: string | null,
  now: Date = new Date(),
): EntitlementStatus {
  switch (status) {
    case "active":
    case "trialing":
    case "past_due":
    case "unpaid":
      return "active";
    case "canceled": {
      if (!periodEnd) return "canceled";
      return new Date(periodEnd).getTime() > now.getTime() ? "active" : "canceled";
    }
    case "paused":
      return "canceled";
    default:
      return "canceled";
  }
}

/** Naruszenie unikalności (Postgres 23505) - przegrany wyścig o ten sam klucz. */
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

/**
 * Konto właściciela usunięte (23503 na `user_subscriptions_user_id_fkey`,
 * 20261018120000): uprawnienia nie ma komu zapisać, a wyjątek skazałby
 * zdarzenie na ponowienia bez końca. 23503 na innym kluczu (plan, najemca)
 * zostaje błędem - to stan do naprawy, nie brak właściciela.
 */
export function isEntitlementOwnerGone(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return (
    error?.code === "23503" && (error.message ?? "").includes("user_subscriptions_user_id_fkey")
  );
}

/**
 * Czy stan operatora wolno zapisać na uprawnieniu `refunded`.
 *
 * `refunded` to korekta BIEŻĄCEGO okresu (pełny zwrot, spór otwarty albo
 * przegrany - `refunds.server`), zapisana z `canceled_at` = chwila korekty.
 * Subskrypcja u operatora trwa dalej (zwrot ani spór jej nie anulują), więc
 * stan wraca do uprawnienia w dwóch i tylko dwóch przypadkach:
 *
 *   * `force` - rozstrzygnięcie na naszą korzyść (wygrany spór, zwrot, który
 *     przepadł) z AUTORYTATYWNYM stanem od operatora;
 *   * nowy okres - `periodStart` późniejszy niż korekta, czyli kolejne
 *     OPŁACONE odnowienie. Bez tego klient płacił co miesiąc bez dostępu.
 *
 * Ten sam okres (`subscription.updated` po zmianie `cancel_at_period_end`,
 * synchronizacja na żądanie klienta, ponowione zdarzenie) korekty nie cofa:
 * inaczej klient sam przywracał sobie dostęp w trakcie sporu.
 *
 * NOWY OKRES TO JESZCZE NIE ZAPŁATA. Stripe przesuwa `current_period_start`
 * przy odnowieniu ZANIM obciąży kartę, więc nieudane odnowienie po korekcie
 * przychodzi jako `past_due` / `unpaid` z okresem zaczętym po niej. Karencja
 * płatności (SUB-03) nadaje takiemu stanowi dostęp do końca karencji - ale
 * karencja jest kredytem dla płacącego klienta, nie dla kogoś, komu właśnie
 * zwróciliśmy pieniądze albo kto je odebrał sporem. Ożywia więc wyłącznie
 * stan opłacony (`active` / `trialing`) albo rezygnacja z takiego okresu
 * (`canceled` - dostęp do końca opłaconego okresu); zaległość, pauza i stan
 * sprzed zapłaty - nigdy (poza `force`). Anulowanie za brak płatności
 * (koniec windykacji) nie jest opłaconym okresem: webhook nie podaje wtedy
 * `periodStart` (`webhookDispatch.server`, `cancellationAccess`).
 */
export function mayReviveRefunded(
  input: Pick<EntitlementSyncInput, "periodStart" | "force" | "status">,
  correctedAt: string | null,
): boolean {
  if (input.force === true) return true;
  if (!isEntitledSubscriptionStatus(input.status) && input.status !== "canceled") return false;
  if (!input.periodStart || !correctedAt) return false;
  const periodStart = Date.parse(input.periodStart);
  const corrected = Date.parse(correctedAt);
  return Number.isFinite(periodStart) && Number.isFinite(corrected) && periodStart > corrected;
}

/** Wiersz uprawnienia w kształcie potrzebnym do decyzji o zapisie. */
interface ExistingEntitlement {
  id: string;
  status: string;
  canceled_at: string | null;
}

/**
 * Znacznik `canceled_at` uprawnienia: „rezygnacja zaplanowana albo dostęp
 * zakończony". Na nim stoją przycisk „Wznów" w panelu klienta i lokalne
 * `resumeSubscription`, więc:
 *   - stan końcowy (`canceled`, `paused`) albo zaplanowana rezygnacja -> data
 *     ZACHOWANA, jeśli już jest (np. ustawiło ją lokalne `cancelSubscription`),
 *     a tylko przy jej braku - „teraz". Wcześniej każde zdarzenie stemplowało
 *     „teraz" od nowa, a zdarzenie bez stanu końcowego ZERAWAŁO datę ustawioną
 *     przez lokalne anulowanie - panel gubił „anulowanie zaplanowane" przy
 *     pierwszym `subscription.updated` (audyt SUB-14),
 *   - jawny brak planowanej rezygnacji -> `null` (klient wznowił),
 *   - wołający nie zna stanu operatora -> bez zmian.
 */
function canceledAtFor(input: EntitlementSyncInput, stored: string | null): string | null {
  const ending =
    input.status === "canceled" || input.status === "paused" || input.cancelAtPeriodEnd === true;
  if (ending) return stored ?? new Date().toISOString();
  if (input.cancelAtPeriodEnd === false) return null;
  return stored;
}

/**
 * Idempotentnie odwzorowuje stan subskrypcji operatora w `user_subscriptions`.
 * Klucz: `external_ref` = identyfikator subskrypcji u operatora - UNIKALNY
 * w bazie (`user_subscriptions_external_ref_key`, migracja
 * `user_subscriptions_external_ref_unique`).
 *
 * Unikalności pilnuje indeks, nie kod. Dwa równoległe zdarzenia tej samej
 * subskrypcji (`created` + `updated` bez wiersza) widziały dawniej oba „brak"
 * i wstawiały DWA uprawnienia; późniejsza rezygnacja trafiała tylko
 * w najstarsze, a drugie dawało dostęp bez płatności. Teraz przegrany wyścig
 * kończy się 23505 i zamienia w aktualizację TEGO SAMEGO klucza - według tej
 * samej reguły co zwykła ścieżka (`mayReviveRefunded`).
 *
 * Reguła „korekta jest ostateczna w swoim okresie" stoi w samym zapisie:
 * zwykła aktualizacja ma `status <> 'refunded'`, a ożywienie - warunek na
 * TĘ korektę, którą odczyt widział (`canceled_at`). Zwrot, który wpadnie
 * między odczyt a zapis, nie zostanie więc nadpisany.
 */
export async function syncEntitlementState(input: EntitlementSyncInput): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const status = mapProviderStatus(input.status, input.periodEnd);
  const patch = (canceledAt: string | null) => ({
    plan_id: input.planId,
    status,
    current_period_end: input.periodEnd,
    canceled_at: canceledAt,
  });

  // Aktualizacja po kluczu operatora, nigdy wiersza odebranego korektą.
  // `canceled_at` wg `canceledAtFor` od wartości, którą widział odczyt -
  // lokalne anulowanie nie jest ani kasowane, ani przestemplowane (SUB-14).
  const refresh = async (stored: string | null): Promise<void> => {
    const { error } = await supabaseAdmin
      .from("user_subscriptions")
      .update(patch(canceledAtFor(input, stored)))
      .eq("external_ref", input.externalRef)
      .neq("status", "refunded");
    if (error) {
      throw new Error(`entitlement sync: update failed (${input.externalRef}): ${error.message}`);
    }
  };

  // Ożywienie wiersza `refunded` - wyłącznie TEJ korekty, którą widział odczyt.
  // `canceled_at` dostaje stan operatora (dla aktywnej subskrypcji `null`),
  // a nie zostaje chwilą korekty: ta nie jest zaplanowaną rezygnacją, więc
  // `canceledAtFor` liczy od pustej wartości.
  const revive = async (correctedAt: string | null): Promise<void> => {
    const base = supabaseAdmin
      .from("user_subscriptions")
      .update(patch(canceledAtFor(input, null)))
      .eq("external_ref", input.externalRef)
      .eq("status", "refunded");
    const { error } = await (correctedAt
      ? base.eq("canceled_at", correctedAt)
      : base.is("canceled_at", null));
    if (error) {
      throw new Error(`entitlement sync: revive failed (${input.externalRef}): ${error.message}`);
    }
  };

  const read = async (): Promise<ExistingEntitlement | null> => {
    const { data, error } = await supabaseAdmin
      .from("user_subscriptions")
      .select("id, status, canceled_at")
      .eq("external_ref", input.externalRef)
      .maybeSingle();
    if (error) {
      throw new Error(`entitlement sync: lookup failed (${input.externalRef}): ${error.message}`);
    }
    return data;
  };

  const apply = async (existing: ExistingEntitlement): Promise<void> => {
    if (existing.status !== "refunded") {
      await refresh(existing.canceled_at ?? null);
      return;
    }
    if (!mayReviveRefunded(input, existing.canceled_at)) return;
    await revive(existing.canceled_at);
  };

  const existing = await read();
  if (existing) {
    await apply(existing);
    return;
  }

  const { error } = await supabaseAdmin.from("user_subscriptions").insert({
    user_id: input.userId,
    tenant_id: input.tenantId,
    plan_id: input.planId,
    status,
    external_ref: input.externalRef,
    current_period_end: input.periodEnd,
    canceled_at: canceledAtFor(input, null),
  });
  // Równoległe zdarzenie wstawiło wiersz między odczytem a zapisem - nasz stan
  // trafia w TEN wiersz według tej samej reguły co wyżej. Wiersz zwycięzcy
  // mógł zdążyć dostać korektę (`refunded`) - ślepa aktualizacja by ją cofnęła.
  if (isUniqueViolation(error)) {
    const winner = await read();
    if (winner) await apply(winner);
    else await refresh(null);
    return;
  }
  if (isEntitlementOwnerGone(error)) {
    console.warn("[payments] entitlement owner no longer exists", input.externalRef);
    return;
  }
  if (error) {
    throw new Error(`entitlement sync: insert failed (${input.externalRef}): ${error.message}`);
  }
}
