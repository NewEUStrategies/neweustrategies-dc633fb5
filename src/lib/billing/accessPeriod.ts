// Data końca dostępu wyliczana ze zdarzenia operatora płatności.
//
// Jedno źródło prawdy dla webhooka (zapis do bazy + uprawnienia) i dla ekranu
// potwierdzenia zakupu. Reguła jest prosta, ale łatwa do zgubienia w kodzie
// obsługi zdarzeń: zdarzenia stanu (pauza, past_due, samo `canceled`) potrafią
// przyjść bez okresu rozliczeniowego i wtedy NIE wolno skracać dostępu -
// obowiązuje ostatni znany, opłacony okres.
export type SubscriptionEventKind = "created" | "updated" | "canceled";

export interface AccessPeriodInput {
  kind: SubscriptionEventKind;
  /** `currentBillingPeriod.endsAt` ze zdarzenia (bywa puste). */
  eventPeriodEnd?: string | null;
  /** Ostatnia data zapisana przy subskrypcji w bazie. */
  storedPeriodEnd?: string | null;
  status?: string | null;
}

export interface AccessPeriod {
  /** Data zapisywana w kolumnie `current_period_end` (null = nieznana). */
  periodEnd: string | null;
  /** Do kiedy realnie trwa dostęp - także po anulowaniu (karencja do końca okresu). */
  accessUntil: string | null;
  /** Czy zdarzenie wnosi nowy okres rozliczeniowy. */
  extendsPeriod: boolean;
}

const iso = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : value;
};

/** Wylicza spójną datę końca dostępu dla zdarzenia subskrypcji. */
export function accessPeriodFromEvent(input: AccessPeriodInput): AccessPeriod {
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
