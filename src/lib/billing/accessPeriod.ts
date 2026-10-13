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
//
// JEDNA REGUŁA DLA OSOBY I ZESPOŁU. Anulowanie za brak płatności
// (`payment_failed` / `payment_disputed`) to koniec TEGO SAMEGO cyklu
// windykacji, w którym mail obiecał dostęp do końca karencji - więc dostęp
// trwa do końca karencji i ani dnia dłużej, a gdy karencja już minęła, nie ma
// go wcale. Tak samo dla uprawnienia indywidualnego, dla organizacji planu
// Zespół (`subscriptionGrantsTeamAccess`, dobowy `suspendTeamsPastPaymentGrace`)
// i dla treści dzwonka po takim anulowaniu. Wcześniej zespół tracił dostęp
// w chwili `deleted`, a osoba z planem indywidualnym miała go do końca
// karencji - jedna płatność, dwie reguły (audyt SUB-03). Subskrypcja, która
// nigdy nie została opłacona (`incomplete*`), po anulowaniu nie daje dostępu
// w ogóle - nie ma okresu, za który ktoś zapłacił.
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
 * Stan sprzed pierwszej zapłaty: checkout założył subskrypcję, ale pieniądze
 * nie wpłynęły (3DS w toku, przelew) albo już nie wpłyną (wygasła po 23 h).
 * Taka subskrypcja nie ma opłaconego okresu, więc jej anulowanie nie zostawia
 * dostępu ani nie jest „rezygnacją klienta" (mail, CRM, dzwonek).
 */
export function isPreActivationSubscriptionStatus(status: string | null | undefined): boolean {
  return status === "incomplete" || status === "incomplete_expired";
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
 * Kotwica karencji: pierwsza nieudana płatność; bez niej - początek okresu
 * (przy obciążeniu automatycznym odnowienie i pierwsza próba to ta sama
 * chwila); bez obu - „teraz", żeby brak danych nigdy nie oznaczał dostępu do
 * końca nieopłaconego okresu. Wydzielona, bo wołający, który na jej podstawie
 * DAŁ dostęp, musi ją też ZAPISAĆ (`first_payment_failed_at`) - inaczej dobowy
 * przebieg zespołów nie miałby od czego policzyć końca tej samej karencji.
 */
export function paymentGraceAnchor(input: PaymentGraceInput): string {
  return (
    iso(input.firstPaymentFailedAt) ??
    iso(input.periodStart) ??
    (input.now ?? new Date()).toISOString()
  );
}

/**
 * Koniec karencji: min(koniec okresu, kotwica + `PAYMENT_GRACE_DAYS`), kotwica
 * z `paymentGraceAnchor`. Zawsze zwraca datę.
 */
export function paymentGraceEnd(input: PaymentGraceInput): string {
  const anchor = paymentGraceAnchor(input);
  const graceEnd = Date.parse(anchor) + PAYMENT_GRACE_DAYS * DAY_MS;
  const end = iso(input.periodEnd);
  const bounded = end !== null ? Math.min(graceEnd, Date.parse(end)) : graceEnd;
  return new Date(bounded).toISOString();
}

/**
 * `billing_reason` faktur, które opłacają OKRES rozliczeniowy: odnowienie
 * i pierwsza płatność subskrypcji. Dopłata za zmianę w trakcie okresu
 * (`subscription_update`), faktura ręczna (`manual`), próg zużycia i pozostałe
 * powody nieudanego odnowienia nie spłacają.
 */
const PERIOD_INVOICE_BILLING_REASONS: ReadonlySet<string> = new Set([
  "subscription_cycle",
  "subscription_create",
]);

/**
 * Czy faktura o tym `billing_reason` opłaca okres rozliczeniowy: odnowienie,
 * pierwsza płatność albo dopłata za zmianę, która OTWORZYŁA nowy okres
 * (`opensPeriod` - zmiana interwału resetuje okres i obciąża za cały nowy,
 * np. samoobsługowy upgrade z miesięcznego na roczny). Zwykła dopłata
 * (prorata za resztę okresu) i każdy inny powód - nie. Jedna reguła dla
 * windykacji (`last_payment_at`) i uzgodnienia dawnych anulowań (historia
 * faktur u operatora).
 */
export function billingReasonPaysPeriod(billingReason: string, opensPeriod: boolean): boolean {
  if (PERIOD_INVOICE_BILLING_REASONS.has(billingReason)) return true;
  return billingReason === "subscription_update" && opensPeriod;
}

/**
 * Czy zaksięgowana zapłata (`subscriptions.last_payment_at`) pokrywa bieżący
 * okres: nie jest wcześniejsza niż jego początek. Znacznik przesuwa wyłącznie
 * zapłata faktury ZA OKRES (`billingReasonPaysPeriod`: odnowienie, pierwsza
 * płatność, dopłata otwierająca nowy okres) - zwykła dopłata za zmianę
 * w trakcie okresu ani faktura ręczna go nie ruszają
 * (`applyPaymentRecoveredEffects`), bo nieudanego odnowienia nie spłacają.
 * Przy nieudanym odnowieniu ostatnia zapłata pochodzi więc z POPRZEDNIEGO
 * okresu i ten warunek oddziela „windykacja się nie udała" od „klient zapłacił
 * zaległą fakturę już po anulowaniu" (link z maila windykacyjnego, zapłata
 * poza operatorem) - drugi przypadek ma opłacony okres i nie wolno mu
 * odbierać dostępu jak niepłacącemu. Dawne wiersze (sprzed tej reguły) mogą
 * nieść chwilę dopłaty, dlatego uzgodnienie dawnych anulowań nie ufa samemu
 * znacznikowi: sprawdza historię faktur u operatora, a znacznik, który ta
 * historia obaliła, czyści. Bez którejkolwiek daty - `false`.
 */
export function paymentCoversPeriod(
  lastPaymentAt: string | null | undefined,
  periodStart: string | null | undefined,
): boolean {
  const paid = iso(lastPaymentAt);
  const start = iso(periodStart);
  return paid !== null && start !== null && Date.parse(paid) >= Date.parse(start);
}

export interface CancellationReasonInput {
  /** `cancellation_details.reason` operatora (pusty = nie podał). */
  reason?: string | null;
  /** Zapisana kotwica karencji (`subscriptions.first_payment_failed_at`). */
  firstPaymentFailedAt?: string | null;
  /** Ostatnia zaksięgowana zapłata (`subscriptions.last_payment_at`). */
  lastPaymentAt?: string | null;
  /** Początek bieżącego okresu. */
  periodStart?: string | null;
}

/**
 * Powód anulowania, z którym liczymy dostęp. Powód operatora wygrywa, gdy
 * jest. Gdy go NIE MA (anulowania sprzed `cancellation_details`, stare wersje
 * API), zapisana kotwica karencji znaczy, że subskrypcja weszła w windykację
 * (zaległość, koniec windykacji albo dowód z faktury zapisany przez
 * uzgodnienie dawnych anulowań, SUB-03), a zapłata, która by ją zamknęła, nie
 * wpłynęła - to anulowanie za brak płatności, jak w dobowym
 * `suspendTeamsPastPaymentGrace`. Bez tego każde ponowne `deleted` bez powodu
 * (samoobsługowa synchronizacja, odtworzenie zdarzenia, remis rozstrzygany
 * żywym stanem) liczyło dostęp jak po rezygnacji, czyli do końca
 * nieopłaconego okresu, i cofało przycięcie. Zapłata pokrywająca okres
 * (`paymentCoversPeriod`) znosi to wnioskowanie. Uzgodnienie dawnych anulowań
 * rozstrzyga zapłatę okresu historią faktur u operatora, nie tym znacznikiem,
 * a przy przycięciu czyści znacznik z dopłaty, który historia obaliła - więc
 * kolejne `deleted` bez powodu rozstrzyga tak samo jak zadanie.
 */
export function effectiveCancellationReason(input: CancellationReasonInput): string | null {
  if (input.reason) return input.reason;
  if (!iso(input.firstPaymentFailedAt)) return null;
  return paymentCoversPeriod(input.lastPaymentAt, input.periodStart) ? null : "payment_failed";
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
