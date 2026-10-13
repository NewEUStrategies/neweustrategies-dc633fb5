// Jednorazowe uzgodnienie DAWNYCH anulowań za brak płatności (audyt SUB-03).
//
// LUKA, KTÓRĄ TO ZAMYKA. Reguła karencji (`accessPeriod.ts`, migracje
// 20261013090500 i 20261013090600) działa od chwili wdrożenia: webhook
// `customer.subscription.deleted` z powodem `payment_failed` /
// `payment_disputed` daje dostęp najwyżej do końca karencji, a migracje
// przycięły uprawnienia subskrypcji, które W CHWILI WDROŻENIA były zaległe.
// Subskrypcje anulowane za brak płatności WCZEŚNIEJ zostały poza obiema
// ścieżkami: stary kod dał im dostęp do końca okresu operatora - czyli przy
// planie rocznym do końca nowego, NIGDY NIEOPŁACONEGO roku - a w bazie nie ma
// ani powodu anulowania, ani kotwicy karencji (`first_payment_failed_at`).
// Ślepa migracja SQL nie odróżni ich od rezygnacji klienta (ta zachowuje
// dostęp do końca opłaconego okresu), więc rozstrzyga operator płatności:
// `cancellation_details.reason` i stan ostatniej faktury.
//
// CO ROBI (dla `subscriptions.status = 'canceled'` z uprawnieniem, które
// jeszcze daje dostęp):
//   1. pobiera subskrypcję od operatora klientem WŁAŚCIWEGO środowiska,
//   2. anulowanie za brak płatności (powód albo - gdy operator powodu nie
//      podał - ostatnia faktura nieopłacona po nieudanych próbach) dostaje
//      kotwicę karencji: zapisaną, inaczej chwilę pierwszej próby obciążenia
//      tej faktury, inaczej początek okresu (`paymentGraceAnchor`),
//   3. uprawnienie zostaje PRZYCIĘTE do min(koniec okresu, kotwica +
//      `PAYMENT_GRACE_DAYS`) ze statusem jak przy webhooku
//      (`mapProviderStatus("canceled", ...)`): karencja trwa - `active` do jej
//      końca, minęła - `canceled`,
//   4. plan Zespół: organizacja, której karencja już minęła, zostaje
//      zawieszona (reguła `subscriptionGrantsTeamAccess`); trwającą domknie
//      dobowy `suspendTeamsPastPaymentGrace`, który po zapisaniu kotwicy
//      rozpoznaje to anulowanie jako koniec windykacji.
//
// TRWAŁOŚĆ. Zapisana kotwica to jedyny ślad decyzji widoczny dla webhooka:
// kolejne `customer.subscription.deleted` (przycisk synchronizacji rozliczeń
// klienta, odtworzenie zdarzenia, remis) przechodzi przez `handleCanceled`,
// który anulowanie BEZ powodu z kotwicą i bez zapłaty za okres traktuje jak
// koniec windykacji (`effectiveCancellationReason`) - więc liczy tę samą
// karencję, zamiast oddać dostęp do końca nieopłaconego okresu.
//
// CZEGO NIE ROBI - CELOWO:
//   * rezygnacja klienta (`cancellation_requested`) i anulowanie bez dowodu
//     braku płatności zostają nietknięte - tam okres był opłacony,
//   * okres OPŁACONY mimo anulowania za brak płatności zostaje nietknięty:
//     klient zapłacił zaległą fakturę już po anulowaniu (link z maila
//     windykacyjnego, zapłata oznaczona poza operatorem). Operator zostawia
//     wtedy `payment_failed`, ale ostatnia faktura jest `paid`, a webhook
//     `invoice.paid` zapisał `last_payment_at` (i wyzerował kotwicę). Dowodem
//     zapłaty jest jedno z dwóch (`periodPaymentProof`). Spór o płatność
//     (`payment_disputed`) dotyczy faktury opłaconej, więc tam zapłata dowodem
//     nie jest,
//   * zwrot jest ostateczny (`syncEntitlementState`): uprawnienie `refunded`
//     nie jest ani czytane do decyzji, ani zapisywane,
//   * zadanie WYŁĄCZNIE SKRACA dostęp. Każdy zapis ma strażnika w `WHERE`
//     (`current_period_end` później niż koniec karencji, organizacja
//     `active`, pusta kotwica), więc ponowny przebieg niczego nie zmienia,
//     a wyścig z webhookiem nie cofnie świeższego zapisu. Organizacji
//     zawieszonej przez stary kod w chwili anulowania NIE wznawiamy, choć
//     karencja mogłaby jeszcze trwać - uzgodnienie nie nadaje dostępu,
//   * bez maili, CRM i dzwonka: skutki anulowania wyszły przy starym
//     webhooku; ponowne `applyCancellationEffects` zdublowałoby je.
//
// DLACZEGO NIE `syncEntitlementState`. Ten sam wynik (status z
// `mapProviderStatus`, `canceled_at` zachowane albo „teraz", zwrot
// ostateczny), ale zapis bezwarunkowy po PIERWSZYM wierszu klucza, bez
// filtra najemcy i z nadpisaniem `plan_id`. Tu potrzebny jest zapis
// warunkowy (tylko skrócenie, tylko `active`, tylko najemca subskrypcji)
// na KAŻDYM wierszu klucza - duplikat uprawnienia też nie może zostać z rokiem
// nieopłaconego dostępu.
//
// IZOLACJA. Partia czyta `subscriptions` jednego środowiska (`environment`),
// a każde uprawnienie i każda organizacja muszą mieć NAJEMCĘ TEGO SAMEGO
// wiersza subskrypcji - dopasowanie po samym `external_ref` mogłoby sięgnąć
// do cudzego obszaru roboczego (kod pilnuje unikalności, baza nie).
//
// OPERATOR. Odczyt sekwencyjny (jedno żądanie naraz), tylko dla wierszy, które
// jeszcze dają dostęp; `resource_missing` (subskrypcja usunięta w
// piaskownicy) to `stripe_missing`, a nie błąd całej partii.
//
// Moduł server-only (klient service_role + SDK operatora) - importuj
// wyłącznie z handlerów (`legacyNonPaymentReconcile.functions.ts`).
import type Stripe from "stripe";

import {
  accessActiveAt,
  isNonPaymentCancellation,
  paymentCoversPeriod,
  paymentGraceAnchor,
  paymentGraceEnd,
} from "@/lib/billing/accessPeriod";
import { mapProviderStatus, type EntitlementStatus } from "@/lib/billing/entitlementSync.server";
import {
  emptyLegacyCounts,
  type LegacyDecision,
  type LegacyEvidence,
  type LegacyPaymentProof,
  type LegacyReconcileMode,
  type LegacyReconcileReport,
  type LegacyReconcileRow,
  type LegacyReconcileWrites,
} from "@/lib/billing/legacyNonPaymentReconcile";
import { mapStripeSubscription } from "@/lib/billing/stripeEvents.server";
import { isPerSeatPrice, subscriptionGrantsTeamAccess } from "@/lib/organizations/teamSeats.server";
import type { StripeEnv } from "@/lib/stripe.server";

/** Domyślna partia: tyle wierszy `subscriptions` czyta jedno wywołanie. */
export const LEGACY_RECONCILE_DEFAULT_BATCH = 50;
/**
 * Górna granica partii. Każdy kandydat to jedno żądanie do operatora,
 * a wywołanie z panelu musi zmieścić się w czasie żądania Workera.
 */
export const LEGACY_RECONCILE_MAX_BATCH = 100;

/**
 * Faktura, która DOWODZI nieudanej płatności: obciążenie było próbowane
 * (`attempt_count > 0`), a faktura nie jest opłacona - otwarta (operator
 * przestał ponawiać), nieściągalna albo unieważniona po windykacji.
 */
const UNPAID_INVOICE_STATUSES: ReadonlySet<string> = new Set(["open", "uncollectible", "void"]);

/** Wiersz `subscriptions` czytany przez zadanie. */
export interface LegacySubscriptionRow {
  id: string;
  tenant_id: string;
  provider_subscription_id: string;
  price_id: string;
  current_period_start: string | null;
  current_period_end: string | null;
  first_payment_failed_at: string | null;
  /** Ostatnia zaksięgowana zapłata (`invoice.paid` -> windykacja). */
  last_payment_at: string | null;
}

/** Wiersz `user_subscriptions` czytany przez zadanie. */
export interface LegacyEntitlementRow {
  id: string;
  tenant_id: string;
  external_ref: string | null;
  status: string;
  current_period_end: string | null;
  canceled_at: string | null;
}

/** Ostatnia faktura subskrypcji u operatora. */
export interface LegacyInvoiceFacts {
  status: string | null;
  attemptCount: number;
  /**
   * Chwila pierwszej próby obciążenia: przy poborze automatycznym operator
   * obciąża kartę przy FINALIZACJI faktury (`status_transitions.finalized_at`),
   * a bez tego znacznika - przy jej utworzeniu.
   */
  attemptedAt: string | null;
  /** `status_transitions.paid_at` - chwila zapłaty (także poza operatorem). */
  paidAt: string | null;
  amountPaid: number | null;
  amountDue: number | null;
  /** Zapłata oznaczona ręcznie w panelu operatora (`paid_out_of_band`). */
  paidOutOfBand: boolean;
  /** Po co faktura: odnowienie, pierwsza płatność albo dopłata za zmianę. */
  billingReason: string | null;
}

/** To, co zadanie musi wiedzieć od operatora. */
export interface LegacyStripeFacts {
  status: string;
  cancellationReason: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** `ended_at` (albo `canceled_at`) - nowa kotwica nigdy nie jest późniejsza. */
  endedAt: string | null;
  invoice: LegacyInvoiceFacts | null;
}

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null;

const isoFromUnix = (value: unknown): string | null =>
  typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;

const numberOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Fakty operatora z surowej subskrypcji (z rozwiniętym `latest_invoice`). */
export function readLegacyStripeFacts(raw: Raw): LegacyStripeFacts {
  // Status, powód i okres - tą samą normalizacją co webhook (API Basil+:
  // okres żyje na pozycji subskrypcji).
  const normalized = mapStripeSubscription(raw);
  const invoiceRaw = isRecord(raw.latest_invoice) ? raw.latest_invoice : null;
  const transitions =
    invoiceRaw && isRecord(invoiceRaw.status_transitions) ? invoiceRaw.status_transitions : null;
  const invoice: LegacyInvoiceFacts | null = invoiceRaw
    ? {
        status: typeof invoiceRaw.status === "string" ? invoiceRaw.status : null,
        attemptCount: typeof invoiceRaw.attempt_count === "number" ? invoiceRaw.attempt_count : 0,
        attemptedAt: isoFromUnix(transitions?.finalized_at) ?? isoFromUnix(invoiceRaw.created),
        paidAt: isoFromUnix(transitions?.paid_at),
        amountPaid: numberOf(invoiceRaw.amount_paid),
        amountDue: numberOf(invoiceRaw.amount_due),
        paidOutOfBand: invoiceRaw.paid_out_of_band === true,
        billingReason:
          typeof invoiceRaw.billing_reason === "string" ? invoiceRaw.billing_reason : null,
      }
    : null;
  return {
    status: normalized.status,
    cancellationReason: normalized.cancellationReason ?? null,
    periodStart: normalized.currentBillingPeriod?.startsAt ?? null,
    periodEnd: normalized.currentBillingPeriod?.endsAt ?? null,
    endedAt: isoFromUnix(raw.ended_at) ?? isoFromUnix(raw.canceled_at),
    invoice,
  };
}

/** Czy ostatnia faktura dowodzi braku zapłaty po nieudanych próbach. */
export function invoiceProvesNonPayment(invoice: LegacyInvoiceFacts | null): boolean {
  return (
    invoice !== null &&
    invoice.attemptCount > 0 &&
    invoice.status !== null &&
    UNPAID_INVOICE_STATUSES.has(invoice.status)
  );
}

/**
 * Czy ostatnia faktura DOWODZI zapłaty: `paid` ze znacznikiem zapłaty i realną
 * kwotą (zapłacona kwota, faktura na zero po saldzie/kuponie albo zapłata
 * oznaczona poza operatorem). Opłacona dopłata za zmianę w trakcie okresu
 * (`subscription_update`) nie spłaca nieudanego odnowienia - ta sama reguła
 * co w windykacji (`dunning.server`), więc dowodem nie jest.
 */
export function invoiceProvesPayment(invoice: LegacyInvoiceFacts | null): boolean {
  if (!invoice || invoice.status !== "paid" || !invoice.paidAt) return false;
  if (invoice.billingReason === "subscription_update") return false;
  return invoice.paidOutOfBand || (invoice.amountPaid ?? 0) > 0 || invoice.amountDue === 0;
}

/**
 * Dowód, że bieżący okres został opłacony mimo anulowania za brak płatności:
 * opłacona ostatnia faktura u operatora albo zapłata zaksięgowana w bazie nie
 * wcześniej niż początek okresu (`paymentCoversPeriod` - tą samą regułą
 * webhook rozstrzyga anulowanie bez powodu). Błąd w tę stronę zostawia dostęp
 * jak dotąd, błąd w drugą odebrałby go płacącemu - stąd „którykolwiek".
 */
export function periodPaymentProof(
  sub: LegacySubscriptionRow,
  stripe: LegacyStripeFacts,
): LegacyPaymentProof | null {
  if (invoiceProvesPayment(stripe.invoice)) return "invoice";
  const periodStart = stripe.periodStart ?? sub.current_period_start;
  return paymentCoversPeriod(sub.last_payment_at, periodStart) ? "ledger" : null;
}

/** Uprawnienie, które na `now` jeszcze daje dostęp (`null` = bez końca). */
function grantsAccess(row: LegacyEntitlementRow, now: Date): boolean {
  return row.status === "active" && accessActiveAt(row.current_period_end, now);
}

/**
 * Wstępna selekcja bez operatora: `skip` - wiersz nie daje już dostępu i nie
 * ma czego przycinać; `refunded` - zwrot (stan ostateczny, raportujemy, nie
 * ruszamy); `evaluate` - trzeba zapytać operatora.
 */
export function triageLegacyCandidate(
  entitlements: readonly LegacyEntitlementRow[],
  teamActive: boolean,
  now: Date,
): "skip" | "refunded" | "evaluate" {
  const hasAccess = entitlements.some((row) => grantsAccess(row, now));
  const refunded = entitlements.filter((row) => row.status === "refunded");
  if (refunded.length > 0) {
    const stillDated = refunded.some((row) => accessActiveAt(row.current_period_end, now));
    return hasAccess || teamActive || stillDated ? "refunded" : "skip";
  }
  return hasAccess || teamActive ? "evaluate" : "skip";
}

export interface LegacyDecisionInput {
  subscription: LegacySubscriptionRow;
  /** Uprawnienia z TYM `external_ref` i z najemcy subskrypcji (każdy status). */
  entitlements: readonly LegacyEntitlementRow[];
  /** Aktywna organizacja planu Zespół tego samego najemcy na tej subskrypcji. */
  teamActive: boolean;
  stripe: LegacyStripeFacts;
  now: Date;
}

export interface LegacyPlan {
  decision: LegacyDecision;
  evidence: LegacyEvidence | null;
  /** Dowód zapłaty za bieżący okres (decyzja `paid`). */
  paymentProof: LegacyPaymentProof | null;
  anchor: string | null;
  /** Kotwicę trzeba dopisać (`first_payment_failed_at` był pusty). */
  writeAnchor: boolean;
  /** Koniec dostępu po regule karencji. */
  accessUntil: string | null;
  entitlementStatus: EntitlementStatus | null;
  /** Uprawnienia z dostępem sięgającym dalej niż koniec karencji. */
  clamp: LegacyEntitlementRow[];
  suspendTeam: boolean;
}

function untouched(decision: LegacyDecision): LegacyPlan {
  return {
    decision,
    evidence: null,
    paymentProof: null,
    anchor: null,
    writeAnchor: false,
    accessUntil: null,
    entitlementStatus: null,
    clamp: [],
    suspendTeam: false,
  };
}

/**
 * Decyzja dla jednej anulowanej subskrypcji - czysta funkcja (zero I/O),
 * ta sama reguła co `handleCanceled` w webhooku, ale wyłącznie skracająca.
 */
export function decideLegacyNonPayment(input: LegacyDecisionInput): LegacyPlan {
  const { subscription: sub, stripe, now } = input;
  if (stripe.status !== "canceled") return untouched("stripe_not_canceled");

  // Powód od operatora rozstrzyga, gdy jest: koniec windykacji albo spór to
  // brak płatności, każdy inny powód (`cancellation_requested`) to decyzja
  // klienta. Dopiero BRAK powodu (stare anulowania, ręczne zamknięcie
  // w panelu operatora) oddaje głos ostatniej fakturze.
  const reason = stripe.cancellationReason;
  const invoiceFailed = invoiceProvesNonPayment(stripe.invoice);
  let evidence: LegacyEvidence;
  if (isNonPaymentCancellation(reason)) evidence = "reason";
  else if (reason) return untouched("voluntary");
  else if (invoiceFailed) evidence = "invoice";
  else return untouched("no_evidence");

  // Okres opłacony po anulowaniu (zaległa faktura zapłacona z linku albo poza
  // operatorem): powód zostaje `payment_failed`, ale klient zapłacił za cały
  // okres - bez kotwicy, przycięcia i zawieszenia zespołu. Spór o płatność
  // dotyczy faktury opłaconej, więc tam zapłata niczego nie dowodzi.
  if (reason !== "payment_disputed") {
    const paymentProof = periodPaymentProof(sub, stripe);
    if (paymentProof) return { ...untouched("paid"), evidence, paymentProof };
  }

  // Kotwica: zapisana wygrywa (tak samo jak w webhooku - kolejny przebieg
  // liczy z tej samej daty). Nowa: pierwsza próba obciążenia nieopłaconej
  // faktury, inaczej początek okresu - i nigdy później niż koniec subskrypcji
  // (windykacja kończy się anulowaniem, więc porażka była wcześniej).
  const stored = sub.first_payment_failed_at;
  let anchor = paymentGraceAnchor({
    firstPaymentFailedAt: stored ?? (invoiceFailed ? (stripe.invoice?.attemptedAt ?? null) : null),
    periodStart: stripe.periodStart ?? sub.current_period_start,
    now,
  });
  if (!stored && stripe.endedAt && Date.parse(anchor) > Date.parse(stripe.endedAt)) {
    anchor = stripe.endedAt;
  }

  const accessUntil = paymentGraceEnd({
    firstPaymentFailedAt: anchor,
    periodEnd: stripe.periodEnd ?? sub.current_period_end,
    now,
  });
  const accessUntilMs = Date.parse(accessUntil);
  const clamp = input.entitlements.filter(
    (row) =>
      grantsAccess(row, now) &&
      (row.current_period_end === null || Date.parse(row.current_period_end) > accessUntilMs),
  );

  // Zespół: ta sama reguła co webhook i dobowy przebieg. Bez powodu od
  // operatora dowodem jest faktura - dla reguły to `payment_failed`.
  const teamReason = evidence === "reason" ? reason : "payment_failed";
  const suspendTeam =
    input.teamActive &&
    isPerSeatPrice(sub.price_id) &&
    !subscriptionGrantsTeamAccess("canceled", accessUntil, now, teamReason);

  const decision: LegacyDecision =
    clamp.length === 0 && !suspendTeam
      ? "already_clamped"
      : accessActiveAt(accessUntil, now)
        ? "clamp"
        : "revoke";

  return {
    decision,
    evidence,
    paymentProof: null,
    anchor,
    writeAnchor: !stored,
    accessUntil,
    entitlementStatus: mapProviderStatus("canceled", accessUntil, now),
    clamp,
    suspendTeam,
  };
}

/** Czy plan niesie jakikolwiek zapis. */
function plansWrites(plan: LegacyPlan): boolean {
  return (plan.writeAnchor && plan.anchor !== null) || plan.clamp.length > 0 || plan.suspendTeam;
}

function isResourceMissing(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const raw = isRecord(error.raw) ? error.raw : null;
  return (raw?.code ?? error.code) === "resource_missing";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type AdminClient = Awaited<ReturnType<typeof admin>>;

/** Subskrypcja u operatora; `null` = operator jej nie zna (`resource_missing`). */
async function fetchStripeFacts(stripe: Stripe, id: string): Promise<LegacyStripeFacts | null> {
  let raw: unknown;
  try {
    raw = await stripe.subscriptions.retrieve(id, { expand: ["latest_invoice"] });
  } catch (error) {
    if (isResourceMissing(error)) return null;
    throw error;
  }
  return readLegacyStripeFacts(raw as Raw);
}

/**
 * Zapis planu - każdy krok z warunkiem w `WHERE`, więc powtórka (drugi
 * przebieg, ponowione wywołanie) trafia w zero wierszy.
 */
async function applyLegacyPlan(
  supabase: AdminClient,
  environment: StripeEnv,
  sub: LegacySubscriptionRow,
  plan: LegacyPlan,
  now: Date,
): Promise<LegacyReconcileWrites> {
  const writes: LegacyReconcileWrites = { anchors: 0, entitlements: 0, teams: 0 };

  // 1. Kotwica - najpierw, bo z niej liczy karencję dobowy przebieg
  //    zespołów, a kolejny przebieg tego zadania - koniec dostępu.
  if (plan.writeAnchor && plan.anchor) {
    const { data, error } = await supabase
      .from("subscriptions")
      .update({ first_payment_failed_at: plan.anchor })
      .eq("id", sub.id)
      .eq("tenant_id", sub.tenant_id)
      .eq("environment", environment)
      .eq("status", "canceled")
      .is("first_payment_failed_at", null)
      .select("id");
    if (error) throw new Error(`anchor write failed: ${error.message}`);
    writes.anchors += (data ?? []).length;
  }

  // 2. Uprawnienia - wyłącznie skrócenie aktywnego dostępu w najemcy
  //    subskrypcji. `canceled_at` jak w `syncEntitlementState` (stan końcowy):
  //    zapisana data zostaje, brak - „teraz".
  if (plan.accessUntil && plan.entitlementStatus) {
    for (const row of plan.clamp) {
      const base = supabase
        .from("user_subscriptions")
        .update({
          status: plan.entitlementStatus,
          current_period_end: plan.accessUntil,
          canceled_at: row.canceled_at ?? now.toISOString(),
        })
        .eq("id", row.id)
        .eq("tenant_id", sub.tenant_id)
        .eq("external_ref", sub.provider_subscription_id)
        .eq("status", "active");
      const guarded =
        row.current_period_end === null
          ? base.is("current_period_end", null)
          : base.gt("current_period_end", plan.accessUntil);
      const { data, error } = await guarded.select("id");
      if (error) throw new Error(`entitlement clamp failed: ${error.message}`);
      writes.entitlements += (data ?? []).length;
    }
  }

  // 3. Zespół po karencji - tylko z `active` na `suspended`, w najemcy
  //    subskrypcji. `applySubscriptionOrgState` umie też WZNOWIĆ organizację
  //    i nie filtruje najemcy, więc tu zapis jest węższy niż w webhooku.
  if (plan.suspendTeam) {
    const { data, error } = await supabase
      .from("member_organizations")
      .update({ status: "suspended", updated_at: now.toISOString() })
      .eq("provider_subscription_id", sub.provider_subscription_id)
      .eq("tenant_id", sub.tenant_id)
      .eq("status", "active")
      .select("id");
    if (error) throw new Error(`team suspend failed: ${error.message}`);
    writes.teams += (data ?? []).length;
  }

  return writes;
}

export interface LegacyReconcileOptions {
  /** Rozstrzygnięte po stronie serwera (`resolveEnvironment`). */
  environment: StripeEnv;
  mode: LegacyReconcileMode;
  /** `subscriptions.id` ostatniego wiersza poprzedniej partii. */
  cursor?: string | null;
  batchSize?: number;
  now?: Date;
}

function batchSizeOf(requested: number | undefined): number {
  const size = Math.trunc(requested ?? LEGACY_RECONCILE_DEFAULT_BATCH);
  if (!Number.isFinite(size) || size < 1) return LEGACY_RECONCILE_DEFAULT_BATCH;
  return Math.min(size, LEGACY_RECONCILE_MAX_BATCH);
}

/** Najdalszy koniec aktywnego dostępu (null = bez końca albo brak). */
function accessUntilBefore(rows: readonly LegacyEntitlementRow[], now: Date): string | null {
  const active = rows.filter((row) => grantsAccess(row, now));
  if (active.some((row) => row.current_period_end === null)) return null;
  return active.reduce<string | null>(
    (latest, row) =>
      latest === null || Date.parse(row.current_period_end as string) > Date.parse(latest)
        ? row.current_period_end
        : latest,
    null,
  );
}

/**
 * Jedna partia zadania (kursor po `subscriptions.id`, rosnąco). Symulacja
 * (`dry_run`) niczego nie zapisuje - ani w bazie, ani u operatora; operatora
 * tylko CZYTA. Zastosowanie (`apply`) zapisuje wyłącznie skrócenia.
 */
export async function reconcileLegacyNonPaymentCancellations(
  options: LegacyReconcileOptions,
): Promise<LegacyReconcileReport> {
  const now = options.now ?? new Date();
  const batchSize = batchSizeOf(options.batchSize);
  const { environment, mode } = options;
  const supabase = await admin();

  const page = supabase
    .from("subscriptions")
    .select(
      "id, tenant_id, provider_subscription_id, price_id, current_period_start, current_period_end, first_payment_failed_at, last_payment_at",
    )
    .eq("environment", environment)
    .eq("status", "canceled");
  const { data: subRows, error: subError } = await (
    options.cursor ? page.gt("id", options.cursor) : page
  )
    .order("id", { ascending: true })
    .limit(batchSize);
  if (subError) throw new Error(`legacy reconcile: subscriptions read failed: ${subError.message}`);
  const subs = (subRows ?? []) as LegacySubscriptionRow[];

  const report: LegacyReconcileReport = {
    environment,
    mode,
    scanned: subs.length,
    candidates: 0,
    counts: emptyLegacyCounts(),
    writes: { anchors: 0, entitlements: 0, teams: 0 },
    rows: [],
    nextCursor: subs.length === batchSize ? (subs[subs.length - 1]?.id ?? null) : null,
    done: subs.length < batchSize,
  };
  if (subs.length === 0) return report;

  const refs = [...new Set(subs.map((sub) => sub.provider_subscription_id))];
  const { data: entRows, error: entError } = await supabase
    .from("user_subscriptions")
    .select("id, tenant_id, external_ref, status, current_period_end, canceled_at")
    .in("external_ref", refs);
  if (entError) throw new Error(`legacy reconcile: entitlements read failed: ${entError.message}`);
  const entitlements = (entRows ?? []) as LegacyEntitlementRow[];

  const seatRefs = [
    ...new Set(
      subs.filter((sub) => isPerSeatPrice(sub.price_id)).map((sub) => sub.provider_subscription_id),
    ),
  ];
  let orgs: { tenant_id: string; provider_subscription_id: string | null }[] = [];
  if (seatRefs.length > 0) {
    const { data: orgRows, error: orgError } = await supabase
      .from("member_organizations")
      .select("id, tenant_id, provider_subscription_id")
      .in("provider_subscription_id", seatRefs)
      .eq("status", "active");
    if (orgError) throw new Error(`legacy reconcile: teams read failed: ${orgError.message}`);
    orgs = orgRows ?? [];
  }

  let stripe: Stripe | null = null;
  const push = (row: LegacyReconcileRow) => {
    report.rows.push(row);
    report.counts[row.decision] += 1;
  };

  // Sekwencyjnie - jedno żądanie do operatora naraz (limit zapytań konta
  // dzielą wszyscy najemcy i webhook).
  for (const sub of subs) {
    const own = entitlements.filter(
      (row) => row.tenant_id === sub.tenant_id && row.external_ref === sub.provider_subscription_id,
    );
    const teamActive =
      isPerSeatPrice(sub.price_id) &&
      orgs.some(
        (org) =>
          org.tenant_id === sub.tenant_id &&
          org.provider_subscription_id === sub.provider_subscription_id,
      );
    const triage = triageLegacyCandidate(own, teamActive, now);
    if (triage === "skip") continue;
    report.candidates += 1;

    const row: LegacyReconcileRow = {
      subscriptionId: sub.provider_subscription_id,
      tenantId: sub.tenant_id,
      decision: "refunded",
      evidence: null,
      paymentProof: null,
      cancellationReason: null,
      invoiceStatus: null,
      anchor: sub.first_payment_failed_at,
      accessUntilBefore: accessUntilBefore(own, now),
      accessUntilAfter: null,
      suspendTeam: false,
      applied: false,
      error: null,
    };
    if (triage === "refunded") {
      push(row);
      continue;
    }

    let facts: LegacyStripeFacts | null;
    try {
      if (!stripe) {
        const { getStripeClient } = await import("@/lib/stripe.server");
        stripe = await getStripeClient(environment);
      }
      facts = await fetchStripeFacts(stripe, sub.provider_subscription_id);
    } catch (error) {
      const { getStripeErrorMessage } = await import("@/lib/stripe.server");
      push({ ...row, decision: "error", error: getStripeErrorMessage(error) });
      continue;
    }
    if (!facts) {
      push({ ...row, decision: "stripe_missing" });
      continue;
    }

    const plan = decideLegacyNonPayment({
      subscription: sub,
      entitlements: own,
      teamActive,
      stripe: facts,
      now,
    });
    const decided: LegacyReconcileRow = {
      ...row,
      decision: plan.decision,
      evidence: plan.evidence,
      paymentProof: plan.paymentProof,
      cancellationReason: facts.cancellationReason,
      invoiceStatus: facts.invoice?.status ?? null,
      anchor: plan.anchor ?? row.anchor,
      accessUntilAfter: plan.accessUntil,
      suspendTeam: plan.suspendTeam,
    };

    if (mode === "apply" && plansWrites(plan)) {
      try {
        const writes = await applyLegacyPlan(supabase, environment, sub, plan, now);
        report.writes.anchors += writes.anchors;
        report.writes.entitlements += writes.entitlements;
        report.writes.teams += writes.teams;
        decided.applied = writes.anchors + writes.entitlements + writes.teams > 0;
      } catch (error) {
        push({ ...decided, decision: "error", error: messageOf(error) });
        continue;
      }
    }
    push(decided);
  }

  if (mode === "apply") {
    console.info("[billing] legacy non-payment reconcile batch", {
      environment,
      scanned: report.scanned,
      candidates: report.candidates,
      writes: report.writes,
      nextCursor: report.nextCursor,
    });
  }
  return report;
}
