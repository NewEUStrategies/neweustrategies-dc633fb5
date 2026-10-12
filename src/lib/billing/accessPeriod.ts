// Data końca dostępu wyliczana ze zdarzenia operatora płatności.
//
// Jedno źródło prawdy dla webhooka (zapis do bazy + uprawnienia), dla planu
// Zespół (stan organizacji) i dla ekranu potwierdzenia zakupu. Reguła jest
// prosta, ale łatwa do zgubienia w kodzie obsługi zdarzeń: zdarzenia stanu
// (pauza, past_due, samo `canceled`) potrafią przyjść bez okresu
// rozliczeniowego i wtedy NIE wolno skracać dostępu - obowiązuje ostatni
// znany, opłacony okres.
//
// KARENCJA PŁATNOŚCI. Okres rozliczeniowy u operatora to NIE jest okres
// opłacony: przy odnowieniu Stripe przesuwa `current_period_end` o cały cykl
// ZANIM obciąży kartę. Nieudane odnowienie planu rocznego zostawiało więc
// datę końca za rok - `past_due` dawał dostęp do niej przez całe ponowienia,
// a `customer.subscription.deleted` po wyczerpaniu windykacji („anulowano za
// brak płatności") nadal do końca nowego, NIEOPŁACONEGO roku (audyt SUB-03).
// Stała `PAYMENT_GRACE_DAYS` żyła wyłącznie w treści maila. Teraz jest
// regułą: przy zaległości dostęp trwa do min(koniec okresu, pierwsza nieudana
// płatność + karencja) - i to TA data trafia do uprawnienia, więc dostęp
// gaśnie sam (`has_content_access()` czyta `current_period_end`), bez
// czekania na kolejne zdarzenie operatora.
export type SubscriptionEventKind = "created" | "updated" | "canceled";

/**
 * Karencja miękkiej windykacji: dostęp działa mimo nieudanej płatności przez
 * tyle dni od PIERWSZEJ nieudanej próby bieżącego cyklu - nigdy dłużej.
 */
export const PAYMENT_GRACE_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * Statusy, w których subskrypcja nadaje dostęp bez zastrzeżeń. Wszystko inne
 * albo dostępu nie daje (`incomplete`, `incomplete_expired`, `paused`), albo
 * daje go wyłącznie w karencji (`past_due`, `unpaid`), albo do końca okresu
 * (`canceled` z własnej woli).
 */
export function isEntitledSubscriptionStatus(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing";
}

/**
 * Zaległość: operator ponawia obciążenie (`past_due`) albo przestał i trzyma
 * fakturę otwartą (`unpaid`). Dostęp wyłącznie w karencji.
 */
export function isDelinquentSubscriptionStatus(status: string | null | undefined): boolean {
  return status === "past_due" || status === "unpaid";
}

/**
 * Anulowanie z powodu braku zapłaty (koniec windykacji albo spór o płatność)
 * - w odróżnieniu od rezygnacji klienta nie zostawia dostępu do końca okresu,
 * bo ten okres nigdy nie został opłacony (`cancellation_details.reason`).
 */
export function isNonPaymentCancellation(reason: string | null | undefined): boolean {
  return reason === "payment_failed" || reason === "payment_disputed";
}

export interface PaymentGraceInput {
  /** Pierwsza nieudana płatność bieżącego cyklu windykacji (kotwica karencji). */
  firstPaymentFailedAt?: string | null;
  /** Początek okresu - zapasowa kotwica, gdy pierwszej porażki nie znamy. */
  periodStart?: string | null;
  /** Koniec okresu u operatora - karencja nigdy go nie przekracza. */
  periodEnd?: string | null;
  /** „Teraz" - kotwica ostatniej szansy (testy podają je jawnie). */
  now?: Date;
}

const iso = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : value;
};

/**
 * Koniec karencji: min(koniec okresu, kotwica + `PAYMENT_GRACE_DAYS`).
 *
 * Kotwica to pierwsza nieudana płatność; bez niej - początek okresu (przy
 * obciążeniu automatycznym odnowienie i pierwsza próba to ta sama chwila);
 * bez obu - „teraz", żeby brak danych nigdy nie oznaczał dostępu do końca
 * nieopłaconego okresu. Zawsze zwraca datę.
 */
export function paymentGraceEnd(input: PaymentGraceInput): string {
  const anchor =
    iso(input.firstPaymentFailedAt) ??
    iso(input.periodStart) ??
    (input.now ?? new Date()).toISOString();
  const graceEnd = Date.parse(anchor) + PAYMENT_GRACE_DAYS * DAY_MS;
  const end = iso(input.periodEnd);
  const bounded = end !== null ? Math.min(graceEnd, Date.parse(end)) : graceEnd;
  return new Date(bounded).toISOString();
}

export interface AccessPeriodInput {
  kind: SubscriptionEventKind;
  /** `currentBillingPeriod.endsAt` ze zdarzenia (bywa puste). */
  eventPeriodEnd?: string | null;
  /** Ostatnia data zapisana przy subskrypcji w bazie. */
  storedPeriodEnd?: string | null;
  status?: string | null;
  /** Początek okresu (ze zdarzenia, a bez niego z bazy) - kotwica zapasowa karencji. */
  periodStart?: string | null;
  /** Pierwsza nieudana płatność bieżącego cyklu (`subscriptions.first_payment_failed_at`). */
  firstPaymentFailedAt?: string | null;
  /** `cancellation_details.reason` operatora - tylko dla `canceled`. */
  cancellationReason?: string | null;
  now?: Date;
}

export interface AccessPeriod {
  /** Data zapisywana w kolumnie `current_period_end` (null = nieznana). */
  periodEnd: string | null;
  /**
   * Do kiedy realnie trwa dostęp: koniec okresu, a przy zaległości albo
   * anulowaniu za brak płatności - koniec karencji (nigdy później).
   */
  accessUntil: string | null;
  /** Czy zdarzenie wnosi nowy okres rozliczeniowy. */
  extendsPeriod: boolean;
}

/** Wylicza spójną datę końca dostępu dla zdarzenia subskrypcji. */
export function accessPeriodFromEvent(input: AccessPeriodInput): AccessPeriod {
  const base = periodFromEvent(input);
  const graceInput = {
    firstPaymentFailedAt: input.firstPaymentFailedAt,
    periodStart: input.periodStart,
    periodEnd: base.periodEnd,
    now: input.now,
  };

  // Anulowanie za brak płatności: okres nigdy nie został opłacony, więc
  // dostęp kończy karencja (a gdy już minęła - nie ma go wcale). Rezygnacja
  // klienta zostawia dostęp do końca okresu, jak dotąd.
  if (input.kind === "canceled") {
    return isNonPaymentCancellation(input.cancellationReason)
      ? { ...base, accessUntil: paymentGraceEnd(graceInput) }
      : base;
  }

  // Zaległość: okres u operatora już przesunięty o cały cykl, opłacona jest
  // tylko karencja. `periodEnd` zostaje datą operatora (panel, odnowienie).
  if (isDelinquentSubscriptionStatus(input.status)) {
    return { ...base, accessUntil: paymentGraceEnd(graceInput) };
  }
  return base;
}

function periodFromEvent(input: AccessPeriodInput): AccessPeriod {
  const fromEvent = iso(input.eventPeriodEnd);
  const stored = iso(input.storedPeriodEnd);

  // Anulowanie nigdy nie niesie nowego okresu - dostęp trwa do końca
  // opłaconego cyklu, więc zdarzenie tylko potwierdza zapisaną datę.
  if (input.kind === "canceled") {
    const end = fromEvent ?? stored;
    return { periodEnd: end, accessUntil: end, extendsPeriod: false };
  }

  if (!fromEvent) {
    return { periodEnd: stored, accessUntil: stored, extendsPeriod: false };
  }

  // Zdarzenie stanu może powtórzyć starszy okres (np. wznowienie po pauzie
  // wysłane po nowym cyklu) - bierzemy późniejszą z dat, żeby nie cofnąć dostępu.
  const later =
    stored && Date.parse(stored) > Date.parse(fromEvent) && input.kind === "updated"
      ? stored
      : fromEvent;

  return {
    periodEnd: later,
    accessUntil: later,
    extendsPeriod: !stored || Date.parse(later) > Date.parse(stored),
  };
}

/** Czy dostęp na dany moment jest jeszcze ważny (null = bezterminowy). */
export function accessActiveAt(accessUntil: string | null, now: Date = new Date()): boolean {
  if (!accessUntil) return true;
  const t = Date.parse(accessUntil);
  return Number.isNaN(t) ? true : t > now.getTime();
}
