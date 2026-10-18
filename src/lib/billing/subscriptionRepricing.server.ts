// Przeniesienie trwających subskrypcji na cenę katalogu v6.2 - orkiestracja
// jednej strony przebiegu (podgląd albo wykonanie).
//
// Trzy źródła, trzy moduły, żaden nie robi cudzej roboty:
//   * operator płatności - `subscriptionProvider.server.ts` (żywy stan,
//     decyzja na nim, jedno wywołanie mutujące),
//   * baza - `server/subscriptionRepricingStore.server.ts` (jedyne miejsce
//     z rolą serwisową, filtr najemcy w każdym zapytaniu),
//   * poczta - `notifyPriceLoweredEmail` (kolejka maili transakcyjnych).
// Tu zapada wyłącznie kolejność i zapis wyniku.
//
// PREWARUNKI. Cena docelowa musi być ceną v6.2 TEGO najemcy: katalog operatora
// jest wspólny dla instalacji (`catalogSync.server.ts`), a jego kwoty liczy się
// z planów najemcy domyślnego. Najemca z innym cennikiem niż katalog nie może
// przenieść klientów na cudzą kwotę - podgląd pokazuje rozjazd
// (`target_price_mismatch`), wykonanie odmawia. Tak samo przed synchronizacją
// katalogu po deployu (`catalog_not_synced`): pod `lookup_key` wisi wtedy
// jeszcze stara cena i „przeniesienie" byłoby pustym ruchem.
//
// IDEMPOTENCJA W TRZECH WARSTWACH: wiersz `applied` w dzienniku na KTÓRĄKOLWIEK
// aktualną cenę docelową pomija operatora (w trybie harmonogramu cena docelowa
// należy do klucza NASTĘPNEJ fazy, nie do klucza z lustra); klucz idempotencji
// operatora z odcisku żywego stanu; klucz idempotencji maila
// `subscription_price_lowered:<sub>:<cena>`.
//
// WPIS INTENCJI PRZED MUTACJĄ. Zanim operator dostanie zmianę, dziennik ma
// wiersz `failed` z kodem `in_progress` (kwoty i ceny z decyzji). Przerwane
// żądanie (timeout, restart, błąd bazy po udanej zmianie) albo niejednoznaczny
// błąd sieci zostawia więc ślad, a ponowne „Wykonaj" widzi u operatora cenę
// docelową (`already_current`) przy wpisie `failed` na tę cenę - to znaczy, że
// zmiana jednak weszła: dokańcza wpis `applied` i mail zamiast zapisywać
// „pominięto". Wpis `applied` jest nienaruszalny także w bazie (strażnik
// w 20261018160000), więc ponowny przebieg nie gubi śladu wykonanej zmiany.
// Ponowne „Wykonaj" jest bezpieczne i dokańcza wyłącznie to, czego brakuje
// (także sam mail po awarii kolejki).
import { catalogEntryByPriceId, catalogRecurringFor } from "@/lib/billing/catalog";
import { catalogPlanForEntry } from "@/lib/billing/catalogSync.server";
import {
  amountForQuantity,
  REPRICE_LOOKUP_KEYS,
  REPRICING_CAMPAIGN,
  type PriceShape,
  type RepriceDecision,
  type RepricingEmailStatus,
  type RepricingMode,
  type RepricingPage,
  type RepricingRow,
} from "@/lib/billing/subscriptionRepricing";
import type {
  RepricingCandidate,
  RepricingLogRow,
  RepricingTenantPlan,
} from "@/lib/server/subscriptionRepricingStore.server";
import type { StripeEnv } from "@/lib/stripe.server";

/** Statusy lustra, które pokazujemy w podglądzie (zaległe - jako „poczekaj"). */
const CANDIDATE_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
] as const;

export interface RepricingPageInput {
  tenantId: string;
  environment: StripeEnv;
  mode: RepricingMode;
  cursor: string | null;
  batchSize: number;
  actorUserId: string;
}

export type RepricingPageResult =
  RepricingPage | { ok: false; error: "preconditions_failed"; problems: string[] };

type Targets = Partial<Record<string, PriceShape>>;

/**
 * Rozjazd ceny operatora z planem najemcy. Kwoty porównujemy przez
 * `amountForQuantity` - tą samą funkcją, którą liczy się decyzja - więc dla
 * Zespołu sprawdzamy oba progi wolumenowe (10 i 11 miejsc), a nie samą stawkę.
 */
export function targetPriceProblems(
  targets: Targets,
  plans: readonly RepricingTenantPlan[],
): string[] {
  const problems: string[] = [];
  for (const key of REPRICE_LOOKUP_KEYS) {
    const target = targets[key];
    if (!target) {
      problems.push(`target_price_missing:${key}`);
      continue;
    }
    const entry = catalogEntryByPriceId(key);
    const plan = entry ? catalogPlanForEntry(plans, entry) : undefined;
    const cycle = entry ? catalogRecurringFor(entry) : null;
    const price = Math.round(Number(plan?.price_cents ?? -1));
    const sameCurrency =
      (plan?.currency ?? "PLN").toLowerCase() === (target.currency ?? "").toLowerCase();
    const sameCycle =
      !!cycle &&
      cycle.interval === target.interval &&
      cycle.interval_count === target.intervalCount;
    let amountsMatch = !!plan && plan.active !== false && amountForQuantity(target, 1) === price;
    const threshold = plan?.volume_threshold_seats ?? null;
    if (amountsMatch && entry?.volumeTiered && threshold !== null && threshold >= 2) {
      const volume = Math.round(Number(plan?.volume_price_cents ?? -1));
      amountsMatch =
        amountForQuantity(target, threshold - 1) === price * (threshold - 1) &&
        amountForQuantity(target, threshold) === volume * threshold;
    }
    if (!sameCurrency || !sameCycle || !amountsMatch) problems.push(`target_price_mismatch:${key}`);
  }
  return problems;
}

/** Kod powodu do dziennika: wyłącznie `[a-z_]`, nigdy treść błędu operatora. */
function reasonCode(error: string): string {
  return /^[a-z_]{1,64}$/.test(error) ? error : "provider_error";
}

function baseRow(candidate: RepricingCandidate, decision: RepriceDecision): RepricingRow {
  return {
    ...decision,
    subscriptionId: candidate.id,
    providerSubscriptionId: candidate.provider_subscription_id,
    outcome: decision.action === "apply" ? "planned" : "skipped",
    emailStatus: null,
    error: null,
  };
}

/** Decyzja odtworzona z wpisu dziennika - wiersz `applied` nie wymaga operatora. */
function decisionFromLog(log: RepricingLogRow): RepriceDecision {
  const entry = catalogEntryByPriceId(log.lookup_key);
  // Kampania obejmuje wyłącznie cykle miesięczne i roczne (`REPRICE_LOOKUP_KEYS`).
  const months = entry?.interval === "year" ? 12 : 1;
  return {
    action: "apply",
    reason: null,
    mode: null,
    lookupKey: log.lookup_key,
    interval: entry?.interval ?? null,
    quantity: log.quantity,
    fromPriceId: log.from_provider_price_id,
    toPriceId: log.to_provider_price_id,
    currency: log.currency,
    currentAmount: log.from_amount_cents,
    newAmount: log.to_amount_cents,
    currentMrr: log.from_amount_cents / months,
    newMrr: log.to_amount_cents / months,
    effectiveAt: log.effective_at,
    emailEligible: log.to_amount_cents < log.from_amount_cents,
  };
}

/** Pusta decyzja dla wiersza, którego nie dało się w ogóle ocenić. */
function unreadable(candidate: RepricingCandidate): RepriceDecision {
  return {
    action: "skip",
    reason: null,
    mode: null,
    lookupKey: candidate.price_id,
    interval: catalogEntryByPriceId(candidate.price_id)?.interval ?? null,
    quantity: Math.max(1, candidate.quantity),
    fromPriceId: null,
    toPriceId: null,
    currency: null,
    currentAmount: null,
    newAmount: null,
    currentMrr: 0,
    newMrr: 0,
    effectiveAt: null,
    emailEligible: false,
  };
}

/**
 * Jedna strona przebiegu. Podgląd NIC nie zapisuje (ani u operatora, ani
 * w bazie, ani w poczcie). Wykonanie odmawia całej strony, gdy prewarunki nie
 * są spełnione - częściowe przeniesienie na złą kwotę byłoby gorsze niż żadne.
 */
export async function runRepricingPage(input: RepricingPageInput): Promise<RepricingPageResult> {
  const store = await import("@/lib/server/subscriptionRepricingStore.server");
  const provider = await import("@/lib/billing/subscriptionProvider.server");
  const { getIntegrationState } = await import("@/lib/billing/catalogAutoSync.server");

  const [plans, targets, integration] = await Promise.all([
    store.loadRepricingTenantPlans(input.tenantId),
    provider.loadRepricingTargets(input.environment, REPRICE_LOOKUP_KEYS),
    getIntegrationState(input.environment),
  ]);
  const problems = targetPriceProblems(targets, plans);
  if (!integration.catalogCurrent || integration.lastStatus !== "ok") {
    problems.unshift("catalog_not_synced");
  }
  if (input.mode === "execute" && problems.length > 0) {
    return { ok: false, error: "preconditions_failed", problems };
  }

  const candidates = await store.listRepricingCandidates({
    tenantId: input.tenantId,
    environment: input.environment,
    lookupKeys: REPRICE_LOOKUP_KEYS,
    statuses: CANDIDATE_STATUSES,
    cursor: input.cursor,
    limit: input.batchSize,
  });
  const logs = await store.loadRepricingLogRows({
    tenantId: input.tenantId,
    environment: input.environment,
    campaign: REPRICING_CAMPAIGN,
    providerSubscriptionIds: candidates.map((c) => c.provider_subscription_id),
  });

  const rows: RepricingRow[] = [];
  for (const candidate of candidates) {
    rows.push(await processCandidate(input, candidate, { plans, targets, logs, store, provider }));
  }

  const last = candidates[candidates.length - 1];
  const nextCursor = candidates.length === input.batchSize && last ? last.id : null;
  return {
    ok: true,
    mode: input.mode,
    environment: input.environment,
    problems,
    rows,
    nextCursor,
    done: nextCursor === null,
  };
}

interface PageContext {
  plans: readonly RepricingTenantPlan[];
  targets: Targets;
  logs: readonly RepricingLogRow[];
  store: typeof import("@/lib/server/subscriptionRepricingStore.server");
  provider: typeof import("@/lib/billing/subscriptionProvider.server");
}

async function processCandidate(
  input: RepricingPageInput,
  candidate: RepricingCandidate,
  ctx: PageContext,
): Promise<RepricingRow> {
  const pid = candidate.provider_subscription_id;
  if (!ctx.provider.isProviderSubscriptionRef(pid)) {
    return {
      ...baseRow(candidate, unreadable(candidate)),
      outcome: "failed",
      error: "not_provider_subscription",
    };
  }

  // Warstwa 1: wpis `applied` na KTÓRĄKOLWIEK aktualną cenę docelową -
  // operatora nie ruszamy. Nie tylko na cenę klucza z lustra: przy własnym
  // harmonogramie (zaplanowany downgrade Pro -> Członek) przeniesienie
  // wskazuje cenę klucza NASTĘPNEJ fazy. Wykonanie dokańcza tylko mail, jeśli
  // wcześniej nie wyszedł.
  const subLogs = ctx.logs.filter((log) => log.provider_subscription_id === pid);
  const targetIds = targetPriceIds(ctx.targets);
  const applied = subLogs.find(
    (log) =>
      log.status === "applied" && (targetIds.size === 0 || targetIds.has(log.to_provider_price_id)),
  );
  if (applied) return finishApplied(input, candidate, applied, ctx);

  const inspected = await ctx.provider.inspectSubscriptionRepricing(
    input.environment,
    pid,
    ctx.targets,
  );
  if (!inspected.ok) {
    console.error("[billing] repricing inspect failed", { pid, error: inspected.error });
    return {
      ...baseRow(candidate, unreadable(candidate)),
      outcome: "failed",
      error: reasonCode(inspected.error),
    };
  }
  const previewRow = baseRow(candidate, inspected.decision);
  const previous = subLogs.find((log) => log.to_provider_price_id === inspected.decision.toPriceId);
  const interrupted =
    inspected.decision.reason === "already_current" && previous?.status === "failed";
  if (input.mode === "preview") {
    // Podgląd pokazuje, co zrobi wykonanie: dokończenie przerwanej zmiany
    // z kwotami z intencji, a nie „cena już aktualna".
    return interrupted && previous
      ? { ...baseRow(candidate, decisionFromLog(previous)), outcome: "planned" }
      : previewRow;
  }
  const attempts = (previous?.attempts ?? 0) + 1;

  if (inspected.decision.action !== "apply") {
    // Cena już docelowa, a dziennik ma na nią wpis `failed` (intencja albo
    // niejednoznaczny błąd operatora): poprzednia próba JEDNAK zmieniła cenę.
    // Dokańczamy wpis `applied` i mail, zamiast zapisać „pominięto".
    if (interrupted && previous) return completeInterrupted(input, candidate, previous, ctx);
    // Wpis `applied` spoza bieżących cen docelowych (np. po kolejnej
    // synchronizacji katalogu) - ślad wykonanej zmiany, nie nadpisujemy go.
    if (previous?.status === "applied") return finishApplied(input, candidate, previous, ctx);
    await recordSkip(input, candidate, inspected.decision, attempts, ctx);
    return previewRow;
  }

  // Wpis intencji PRZED mutacją (nagłówek): przerwanie po udanej zmianie
  // u operatora zostawia ślad, z którego ponowne „Wykonaj" dokończy wpis i mail.
  const emailIntent: Exclude<RepricingEmailStatus, null> = inspected.decision.emailEligible
    ? "pending"
    : "skipped";
  await writeLog(
    input,
    candidate,
    inspected.decision,
    { status: "failed", reason: "in_progress", attempts, emailStatus: emailIntent },
    ctx,
  );

  // Wykonanie: provider liczy decyzję JESZCZE RAZ na stanie sprzed mutacji.
  const result = await ctx.provider.repriceSubscriptionToCatalog(input.environment, pid, {
    targets: ctx.targets,
    campaign: REPRICING_CAMPAIGN,
  });
  if (!result.ok) {
    console.error("[billing] repricing failed", { pid, error: result.error });
    const reason = reasonCode(result.error);
    await writeLog(
      input,
      candidate,
      inspected.decision,
      {
        status: "failed",
        reason,
        attempts,
        emailStatus: emailIntent,
      },
      ctx,
    );
    return { ...previewRow, outcome: "failed", error: reason };
  }
  const decision = result.decision;
  if (decision.action !== "apply") {
    // Stan zmienił się między podglądem a mutacją (np. anulowanie w portalu)
    // - u operatora NIC się nie zmieniło. Wpis intencji zamykamy jako
    // pominięcie, żeby kolejny przebieg nie wziął go za zmianę, która weszła.
    await closeIntentAsSkipped(input, candidate, inspected.decision, decision, attempts, ctx);
    return baseRow(candidate, decision);
  }
  // Zmiana weszła, ale na INNĄ cenę docelową niż w intencji (klient zmienił
  // plan między odczytami) - intencja pod starym kluczem nie może wisieć jako
  // „przerwana".
  if (decision.toPriceId !== inspected.decision.toPriceId) {
    await writeLog(
      input,
      candidate,
      inspected.decision,
      { status: "skipped", reason: "state_changed", attempts, emailStatus: "skipped" },
      ctx,
    );
  }

  await writeLog(
    input,
    candidate,
    decision,
    {
      status: "applied",
      reason: null,
      attempts,
      emailStatus: decision.emailEligible ? "pending" : "skipped",
    },
    ctx,
  );
  const emailStatus: RepricingEmailStatus = decision.emailEligible
    ? await sendAndRecordEmail(input, candidate, decision, ctx)
    : "skipped";
  return { ...baseRow(candidate, decision), outcome: "applied", emailStatus };
}

/** Identyfikatory aktualnych cen docelowych (wszystkie klucze kampanii). */
function targetPriceIds(targets: Targets): Set<string> {
  const ids = new Set<string>();
  for (const target of Object.values(targets)) if (target) ids.add(target.id);
  return ids;
}

/**
 * Wiersz `applied` z dziennika: operatora nie ruszamy, wykonanie dokańcza
 * wyłącznie mail, jeśli wcześniej nie wyszedł.
 */
async function finishApplied(
  input: RepricingPageInput,
  candidate: RepricingCandidate,
  applied: RepricingLogRow,
  ctx: PageContext,
): Promise<RepricingRow> {
  const decision = decisionFromLog(applied);
  let emailStatus: RepricingEmailStatus = applied.email_status;
  if (
    input.mode === "execute" &&
    (applied.email_status === "pending" || applied.email_status === "failed") &&
    decision.emailEligible
  ) {
    emailStatus = await sendAndRecordEmail(input, candidate, decision, ctx);
  }
  return { ...baseRow(candidate, decision), outcome: "already_applied", emailStatus };
}

/**
 * Zmiana z przerwanej (albo niejednoznacznie odrzuconej) próby weszła
 * u operatora - dziennik dostaje `applied` z cenami i kwotami zapisanymi
 * w intencji, a mail wychodzi, jeśli intencja go przewidywała (`pending`
 * albo awaria wysyłki). `skipped` w intencji = brak realnej obniżki albo
 * zaplanowany koniec w chwili decyzji: maila nie ma.
 */
async function completeInterrupted(
  input: RepricingPageInput,
  candidate: RepricingCandidate,
  intent: RepricingLogRow,
  ctx: PageContext,
): Promise<RepricingRow> {
  const fromLog = decisionFromLog(intent);
  const decision: RepriceDecision = {
    ...fromLog,
    emailEligible: fromLog.emailEligible && intent.email_status !== "skipped",
  };
  await writeLog(
    input,
    candidate,
    decision,
    {
      status: "applied",
      reason: null,
      attempts: intent.attempts,
      emailStatus: decision.emailEligible ? "pending" : "skipped",
    },
    ctx,
  );
  const emailStatus: RepricingEmailStatus = decision.emailEligible
    ? await sendAndRecordEmail(input, candidate, decision, ctx)
    : "skipped";
  return { ...baseRow(candidate, decision), outcome: "applied", emailStatus };
}

/**
 * Decyzja na stanie sprzed mutacji brzmi „pomiń" - operator nic nie zmienił.
 * Pominięcie z kwotami zapisuje `recordSkip`; pozostałe (zaległa płatność,
 * zaplanowany koniec, obcy harmonogram) zamykają wpis intencji jego
 * kwotami z podglądu i KODEM nowej decyzji.
 */
async function closeIntentAsSkipped(
  input: RepricingPageInput,
  candidate: RepricingCandidate,
  intentDecision: RepriceDecision,
  decision: RepriceDecision,
  attempts: number,
  ctx: PageContext,
): Promise<void> {
  if (decision.reason === "already_current" || decision.reason === "would_increase") {
    await recordSkip(input, candidate, decision, attempts, ctx);
    // `recordSkip` pisze pod cenę docelową NOWEJ decyzji - intencja mogła
    // wskazywać inną (zmiana planu między odczytami).
    if (decision.toPriceId === intentDecision.toPriceId) return;
  }
  await writeLog(
    input,
    candidate,
    intentDecision,
    {
      status: "skipped",
      reason: reasonCode(decision.reason ?? "state_changed"),
      attempts,
      emailStatus: "skipped",
    },
    ctx,
  );
}

/**
 * Ślad „dlaczego nie" - tylko dla decyzji z policzonymi kwotami (cena już
 * aktualna, podwyżka). Pominięcia bez kwot (zaległa płatność, obcy
 * harmonogram) zobaczy admin w podglądzie; dziennik nie zgaduje ich cen.
 */
async function recordSkip(
  input: RepricingPageInput,
  candidate: RepricingCandidate,
  decision: RepriceDecision,
  attempts: number,
  ctx: PageContext,
): Promise<void> {
  if (decision.reason !== "already_current" && decision.reason !== "would_increase") return;
  await writeLog(
    input,
    candidate,
    decision,
    {
      status: "skipped",
      reason: decision.reason,
      attempts,
      emailStatus: "skipped",
    },
    ctx,
  );
}

async function writeLog(
  input: RepricingPageInput,
  candidate: RepricingCandidate,
  decision: RepriceDecision,
  outcome: {
    status: "applied" | "skipped" | "failed";
    reason: string | null;
    attempts: number;
    emailStatus: Exclude<RepricingEmailStatus, null>;
  },
  ctx: PageContext,
): Promise<void> {
  if (
    !decision.lookupKey ||
    !decision.fromPriceId ||
    !decision.toPriceId ||
    !decision.currency ||
    !decision.interval ||
    decision.interval === "one_time" ||
    decision.currentAmount === null ||
    decision.newAmount === null
  ) {
    return;
  }
  await ctx.store.upsertRepricingLogRow({
    tenantId: input.tenantId,
    campaign: REPRICING_CAMPAIGN,
    environment: input.environment,
    subscriptionId: candidate.id,
    providerSubscriptionId: candidate.provider_subscription_id,
    userId: candidate.user_id,
    lookupKey: decision.lookupKey,
    fromPriceId: decision.fromPriceId,
    toPriceId: decision.toPriceId,
    quantity: decision.quantity,
    currency: decision.currency,
    billingInterval: decision.interval,
    fromAmountCents: decision.currentAmount,
    toAmountCents: decision.newAmount,
    effectiveAt: decision.effectiveAt,
    status: outcome.status,
    reason: outcome.reason,
    attempts: outcome.attempts,
    appliedAt: outcome.status === "applied" ? new Date().toISOString() : null,
    emailStatus: outcome.emailStatus,
    actorUserId: input.actorUserId,
  });
}

/**
 * Mail o niższej cenie i zapis jego wyniku w dzienniku. Plan v6.2 najemcy
 * (nazwa w języku odbiorcy) wybiera ta sama reguła co synchronizacja katalogu.
 */
async function sendAndRecordEmail(
  input: RepricingPageInput,
  candidate: RepricingCandidate,
  decision: RepriceDecision,
  ctx: PageContext,
): Promise<RepricingEmailStatus> {
  if (
    !decision.toPriceId ||
    decision.currentAmount === null ||
    decision.newAmount === null ||
    !decision.currency
  ) {
    return "skipped";
  }
  const entry = catalogEntryByPriceId(decision.lookupKey);
  const plan = entry ? catalogPlanForEntry(ctx.plans, entry) : undefined;
  const { notifyPriceLoweredEmail } = await import("@/lib/billing/notifications.server");
  const status = await notifyPriceLoweredEmail({
    userId: candidate.user_id,
    tenantId: input.tenantId,
    planId: plan?.id ?? null,
    previousAmountCents: decision.currentAmount,
    newAmountCents: decision.newAmount,
    currency: decision.currency,
    interval: decision.interval,
    quantity: decision.quantity,
    effectiveAt: decision.effectiveAt,
    idempotencySeed: `${candidate.provider_subscription_id}:${decision.toPriceId}`,
  });
  try {
    await ctx.store.updateRepricingEmailStatus({
      tenantId: input.tenantId,
      environment: input.environment,
      providerSubscriptionId: candidate.provider_subscription_id,
      toPriceId: decision.toPriceId,
      emailStatus: status,
    });
  } catch (err) {
    // Mail już w kolejce; brak zapisu statusu zostawi `pending`, a ponowienie
    // trafi w klucz idempotencji maila - drugi raz nie wyjdzie.
    console.error("[billing] repricing email status write failed", err);
  }
  return status;
}
