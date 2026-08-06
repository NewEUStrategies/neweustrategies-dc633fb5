// Logika nocnej sondy odnowienia i dunningu (Stripe sandbox) - warstwa czysta.
//
// ── PO CO SONDA ISTNIEJE ────────────────────────────────────────────────────
// Odnowienie subskrypcji i ścieżka nieudanej płatności to jedyne części lejka,
// których nie da się sprawdzić klikając checkout: trzeba przesunąć zegar
// rozliczeniowy i poczekać, aż operator naliczy fakturę. W Stripe robi się to
// Test Clockiem przypiętym do klienta.
//
// ── CO BYŁO ZŁE W POPRZEDNIEJ WERSJI ────────────────────────────────────────
// 1. Workflow eksportował `PADDLE_SANDBOX_API_KEY`, skrypt czytał
//    `STRIPE_SANDBOX_API_KEY`. Sonda co dobę wychodziła gałęzią „brak kluczy"
//    i kończyła się na ZIELONO - po 40 minutach `sleep`. Zielony przebieg bez
//    ani jednego żądania do operatora jest gorszy niż brak przebiegu: kupuje
//    fałszywe zaufanie i pali 40 minut runnera dziennie (~20 h miesięcznie).
// 2. Czekanie było ślepym `for i in $(seq 1 40); do sleep 60; done`, mimo że
//    Test Clock ma pole `status` (`advancing` -> `ready`) i wystarczy je odpytać.
//    Stripe kończy przeliczanie zwykle w kilkadziesiąt sekund.
// 3. Wykrycie odnowienia brzmiało `inv.created >= armedAt || billing_reason ===
//    "subscription_cycle"`. Alternatywa (`||`) sprawiała, że DOWOLNA stara
//    faktura cykliczna - także sprzed miesięcy - liczyła się jako „nowa".
//    Sonda potrafiła więc potwierdzić odnowienie, którego nie było.
// 4. Dunning był w tytule, ale nie w teście: sonda liczyła globalne
//    `past_due` i nic z tą liczbą nie robiła.
//
// ── CO SPRAWDZAMY TERAZ ─────────────────────────────────────────────────────
// Po przesunięciu zegara muszą się zgadzać TRZY rzeczy naraz, każda innej
// natury, więc żadna nie zastępuje pozostałych:
//   - powstała NOWA faktura (identyfikator nieznany w momencie zbrojenia)
//     z `billing_reason = subscription_cycle`,
//   - okres rozliczeniowy przesunął się do przodu,
//   - stan faktury i stan subskrypcji są SPÓJNE.
// Ten trzeci punkt jest właściwym testem dunningu i wychwytuje najgorszy
// możliwy wynik: faktura nieopłacona, a subskrypcja dalej `active` - czyli
// dostęp do płatnej treści bez płatności, którego nikt nie zauważy, bo
// wszystkie zielone metryki wyglądają normalnie.
//
// Warstwa wykonawcza (HTTP przez bramkę konektorów, pliki, kody wyjścia) żyje
// w `scripts/billing-renewal-probe.ts`; ten moduł jest czysty i testowalny.

export interface StripeSubscriptionItem {
  readonly current_period_end?: number | null;
}

export interface StripeCustomerRef {
  readonly id: string;
  readonly test_clock?: string | { id: string } | null;
}

export interface StripeSubscription {
  readonly id: string;
  readonly status: string;
  readonly customer: string | StripeCustomerRef;
  readonly test_clock?: string | { id: string } | null;
  readonly items?: { readonly data?: readonly StripeSubscriptionItem[] };
}

export interface StripeInvoice {
  readonly id: string;
  readonly status: string | null;
  readonly created: number;
  readonly billing_reason?: string | null;
  readonly attempt_count?: number | null;
}

export interface StripeTestClock {
  readonly id: string;
  readonly status: string;
  readonly frozen_time: number;
}

/** Stany subskrypcji, w których operator prowadzi windykację należności. */
export const DUNNING_STATUSES: ReadonlySet<string> = new Set([
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
]);

/** Stany faktury oznaczające, że pieniądze faktycznie wpłynęły. */
export const SETTLED_INVOICE_STATUSES: ReadonlySet<string> = new Set(["paid"]);

/** Faktura jeszcze nie sfinalizowana - wynik nierozstrzygnięty, nie błąd. */
export const PENDING_INVOICE_STATUSES: ReadonlySet<string> = new Set(["draft"]);

export type ProbeOutcome = "renewed" | "dunning" | "pending" | "failed" | "skipped";

/** Czy wynik ma wywrócić przebieg. `skipped` rozstrzyga tryb ścisły osobno. */
export function isFailure(outcome: ProbeOutcome): boolean {
  return outcome === "failed";
}

export interface ProbeState {
  readonly version: 1;
  readonly subscriptionId: string;
  readonly testClockId: string;
  readonly armedAt: string;
  /** Czas zegara PRZED przesunięciem - punkt odniesienia dla nowych faktur. */
  readonly frozenBefore: number;
  readonly advancedTo: number;
  readonly previousPeriodEnd: number | null;
  /**
   * Faktury istniejące w chwili zbrojenia. Porównanie po IDENTYFIKATORACH, a nie
   * po `created`, jest jedynym odpornym testem „to jest nowa faktura": pole
   * `created` żyje w czasie Test Clocka, który właśnie przesuwamy.
   */
  readonly knownInvoiceIds: readonly string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Waliduje stan zapisany przez krok `arm`. Zwraca `null` zamiast rzucać - brak
 * albo uszkodzenie pliku stanu to sytuacja operacyjna (job przerwany, cache),
 * a nie błąd programu.
 */
export function parseProbeState(raw: string): ProbeState | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;

  const state = value as Record<string, unknown>;
  if (state.version !== 1) return null;
  if (typeof state.subscriptionId !== "string" || state.subscriptionId === "") return null;
  if (typeof state.testClockId !== "string" || state.testClockId === "") return null;
  if (typeof state.armedAt !== "string" || Number.isNaN(Date.parse(state.armedAt))) return null;
  if (typeof state.frozenBefore !== "number" || !Number.isFinite(state.frozenBefore)) return null;
  if (typeof state.advancedTo !== "number" || !Number.isFinite(state.advancedTo)) return null;
  if (state.previousPeriodEnd !== null && typeof state.previousPeriodEnd !== "number") return null;
  if (!isStringArray(state.knownInvoiceIds)) return null;

  return {
    version: 1,
    subscriptionId: state.subscriptionId,
    testClockId: state.testClockId,
    armedAt: state.armedAt,
    frozenBefore: state.frozenBefore,
    advancedTo: state.advancedTo,
    previousPeriodEnd: state.previousPeriodEnd as number | null,
    knownInvoiceIds: state.knownInvoiceIds,
  };
}

export function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** Test Clock bywa na subskrypcji albo na rozwiniętym kliencie - bierzemy oba. */
export function testClockIdOf(subscription: StripeSubscription): string | null {
  const direct = idOf(subscription.test_clock);
  if (direct) return direct;
  const { customer } = subscription;
  return typeof customer === "object" ? idOf(customer.test_clock) : null;
}

/**
 * Koniec okresu rozliczeniowego. W API `2026-03-25.dahlia` pole żyje na
 * POZYCJACH subskrypcji, nie na samej subskrypcji.
 */
export function periodEndOf(subscription: StripeSubscription): number | null {
  const ends = (subscription.items?.data ?? [])
    .map((item) => item.current_period_end ?? null)
    .filter((value): value is number => typeof value === "number");
  return ends.length > 0 ? Math.max(...ends) : null;
}

export interface RenewalCandidate {
  readonly subscription: StripeSubscription;
  readonly testClockId: string;
}

/**
 * Wybiera subskrypcję do zbrojenia. Jawne `preferredId` wygrywa (determinizm w
 * sandboxie z wieloma subskrypcjami); bez niego bierzemy pierwszą po
 * posortowaniu identyfikatorów, żeby kolejność z API nie zmieniała wyniku
 * z przebiegu na przebieg.
 */
export function selectRenewalCandidate(
  subscriptions: readonly StripeSubscription[],
  preferredId?: string | null,
): RenewalCandidate | null {
  const eligible = subscriptions
    .filter((subscription) => subscription.status === "active")
    .filter((subscription) => testClockIdOf(subscription) !== null)
    .filter((subscription) => periodEndOf(subscription) !== null)
    .sort((a, b) => a.id.localeCompare(b.id));

  const chosen =
    (preferredId ? eligible.find((subscription) => subscription.id === preferredId) : undefined) ??
    (preferredId ? undefined : eligible[0]);
  if (!chosen) return null;

  const testClockId = testClockIdOf(chosen);
  return testClockId ? { subscription: chosen, testClockId } : null;
}

export interface RenewalInput {
  readonly subscription: StripeSubscription;
  readonly invoices: readonly StripeInvoice[];
  readonly state: ProbeState;
}

export interface RenewalVerdict {
  readonly outcome: ProbeOutcome;
  readonly renewalInvoice: StripeInvoice | null;
  readonly periodEnd: number | null;
  readonly periodMoved: boolean;
  /** Zdanie po polsku wyjaśniające werdykt - trafia wprost do podsumowania. */
  readonly reason: string;
}

/**
 * Rozstrzyga, co realnie zrobił operator po przesunięciu zegara.
 *
 * Kolejność sprawdzeń jest istotna: najpierw „czy w ogóle powstała nowa faktura
 * cykliczna", potem „czy okres poszedł do przodu", a dopiero na końcu spójność
 * faktura ⇄ subskrypcja. Odwrotna kolejność raportowałaby dunning tam, gdzie
 * problemem jest brak naliczenia.
 */
export function classifyRenewal({ subscription, invoices, state }: RenewalInput): RenewalVerdict {
  const known = new Set(state.knownInvoiceIds);
  const fresh = invoices.filter((invoice) => !known.has(invoice.id));
  const renewalInvoice =
    fresh.find((invoice) => invoice.billing_reason === "subscription_cycle") ?? null;

  const periodEnd = periodEndOf(subscription);
  const periodMoved =
    periodEnd !== null && (state.previousPeriodEnd === null || periodEnd > state.previousPeriodEnd);

  if (!renewalInvoice) {
    const nearMiss = fresh.length > 0 ? ` (nowe faktury bez cyklu: ${fresh.length})` : "";
    return {
      outcome: "failed",
      renewalInvoice: null,
      periodEnd,
      periodMoved,
      reason:
        "Po przesunięciu Test Clocka nie powstała NOWA faktura `subscription_cycle`" +
        `${nearMiss}. Odnowienie subskrypcji nie zadziałało - sprawdź dziennik webhooków ` +
        "w panelu administratora.",
    };
  }

  const status = renewalInvoice.status ?? "";

  if (PENDING_INVOICE_STATUSES.has(status)) {
    return {
      outcome: "pending",
      renewalInvoice,
      periodEnd,
      periodMoved,
      reason:
        `Faktura \`${renewalInvoice.id}\` jest jeszcze w stanie \`${status}\` - Stripe jej nie ` +
        "sfinalizował. Wynik nierozstrzygnięty, nie błąd naszej strony.",
    };
  }

  if (!periodMoved) {
    return {
      outcome: "failed",
      renewalInvoice,
      periodEnd,
      periodMoved,
      reason:
        `Faktura \`${renewalInvoice.id}\` powstała, ale okres rozliczeniowy się NIE przesunął. ` +
        "Subskrypcja została obciążona bez przedłużenia dostępu - to rozjazd stanu, " +
        "nie opóźnienie.",
    };
  }

  if (SETTLED_INVOICE_STATUSES.has(status)) {
    return {
      outcome: "renewed",
      renewalInvoice,
      periodEnd,
      periodMoved,
      reason: `Odnowienie zadziałało: faktura \`${renewalInvoice.id}\` opłacona, okres przesunięty.`,
    };
  }

  if (DUNNING_STATUSES.has(subscription.status)) {
    return {
      outcome: "dunning",
      renewalInvoice,
      periodEnd,
      periodMoved,
      reason:
        `Ścieżka nieudanej płatności zadziałała: faktura \`${renewalInvoice.id}\` w stanie ` +
        `\`${status}\` (próby: ${renewalInvoice.attempt_count ?? 0}), subskrypcja przeszła ` +
        `w \`${subscription.status}\`.`,
    };
  }

  return {
    outcome: "failed",
    renewalInvoice,
    periodEnd,
    periodMoved,
    reason:
      `Faktura \`${renewalInvoice.id}\` jest w stanie \`${status}\` (nieopłacona), a subskrypcja ` +
      `nadal ma status \`${subscription.status}\`. To dostęp do płatnej treści bez płatności: ` +
      "dunning się nie uruchomił.",
  };
}

/** Sekundy uniksowe -> czytelny znacznik ISO (albo `-`). */
export function formatUnix(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return new Date(value * 1000).toISOString().replace(".000Z", "Z");
}

export function renderArmSummary(state: ProbeState): string {
  return [
    "### Sonda odnowienia - zbrojenie",
    `- subskrypcja: \`${state.subscriptionId}\``,
    `- Test Clock: \`${state.testClockId}\``,
    `- zegar: ${formatUnix(state.frozenBefore)} → ${formatUnix(state.advancedTo)}`,
    `- koniec okresu przed przesunięciem: ${formatUnix(state.previousPeriodEnd)}`,
    `- faktury znane przed zbrojeniem: ${state.knownInvoiceIds.length}`,
  ].join("\n");
}

export interface VerifySummaryInput {
  readonly state: ProbeState;
  readonly subscription: StripeSubscription;
  readonly verdict: RenewalVerdict;
  /** Wszystkie subskrypcje sandboxa w windykacji - kontekst, nie kryterium. */
  readonly dunningCensus: number;
}

const OUTCOME_LABEL: Readonly<Record<ProbeOutcome, string>> = {
  renewed: "✓ odnowienie potwierdzone",
  dunning: "✓ dunning potwierdzony",
  pending: "· nierozstrzygnięte",
  failed: "✗ regresja",
  skipped: "· pominięte",
};

export function renderVerifySummary({
  state,
  subscription,
  verdict,
  dunningCensus,
}: VerifySummaryInput): string {
  return [
    "### Sonda odnowienia - weryfikacja",
    `- wynik: **${OUTCOME_LABEL[verdict.outcome]}**`,
    `- subskrypcja: \`${state.subscriptionId}\` (status \`${subscription.status}\`)`,
    `- faktura odnowieniowa: ${
      verdict.renewalInvoice
        ? `\`${verdict.renewalInvoice.id}\` (${verdict.renewalInvoice.status ?? "-"})`
        : "brak"
    }`,
    `- okres rozliczeniowy: ${formatUnix(state.previousPeriodEnd)} → ${formatUnix(verdict.periodEnd)}` +
      ` (${verdict.periodMoved ? "przesunięty" : "bez zmiany"})`,
    `- subskrypcje sandboxa w windykacji: ${dunningCensus}`,
    "",
    verdict.reason,
  ].join("\n");
}
