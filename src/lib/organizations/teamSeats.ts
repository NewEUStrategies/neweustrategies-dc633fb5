// Plan Zespół rozliczany ZA MIEJSCE - czysta logika miejsc, wspólna dla panelu,
// profilu właściciela i testów. Odwzorowuje regułę bazy (org_reconcile_seats):
// gdy miejsc jest więcej niż opłaconych, zostają aktywne te najważniejsze -
// najpierw właściciel, potem miejsca faktycznie objęte (claimed), a na końcu
// najstarsze zaproszenia. Reszta jest ZAWIESZANA, nie kasowana: obniżenie
// limitu nie może po cichu wyrzucić ludzi z organizacji.
export const MIN_TEAM_SEATS = 1;
export const MAX_TEAM_SEATS = 500;

export type SeatStatus = "active" | "grace" | "suspended";

/** Zakres okresu karencji ustawianego dla organizacji (w dniach). */
export const MIN_GRACE_DAYS = 0;
export const MAX_GRACE_DAYS = 90;
export const DEFAULT_GRACE_DAYS = 7;

export function clampGraceDays(value: number | null | undefined): number {
  const n = Math.trunc(Number(value ?? DEFAULT_GRACE_DAYS));
  if (!Number.isFinite(n)) return DEFAULT_GRACE_DAYS;
  return Math.max(MIN_GRACE_DAYS, Math.min(MAX_GRACE_DAYS, n));
}

export interface SeatLike {
  id: string;
  role: string;
  claimed_at: string | null;
  created_at: string;
  status?: string | null;
  grace_until?: string | null;
}

export interface SeatsSummary {
  limit: number;
  total: number;
  /** Miejsca mieszczące się w limicie (mają uprawnienia warstwy). */
  active: number;
  /** Miejsca ponad limit w okresie karencji - nadal z dostępem. */
  grace: number;
  /** Miejsca ponad limit po karencji - zachowane, ale bez uprawnień. */
  suspended: number;
  /** Wolne miejsca do zaproszenia kolejnych osób. */
  free: number;
  atLimit: boolean;
}

/** Liczba miejsc zawsze w granicach oferty (1-500). */
export function clampSeats(value: number | null | undefined): number {
  const n = Math.trunc(Number(value ?? MIN_TEAM_SEATS));
  if (!Number.isFinite(n)) return MIN_TEAM_SEATS;
  return Math.max(MIN_TEAM_SEATS, Math.min(MAX_TEAM_SEATS, n));
}

function seatWeight(seat: SeatLike): [number, number, string, string] {
  return [
    seat.role === "owner" ? 0 : 1,
    seat.claimed_at ? 0 : 1,
    seat.claimed_at ?? seat.created_at,
    seat.id,
  ];
}

/** Kolejność zachowania miejsc przy kurczącym się limicie (jak w bazie). */
export function rankSeats<T extends SeatLike>(seats: readonly T[]): T[] {
  return [...seats].sort((a, b) => {
    const wa = seatWeight(a);
    const wb = seatWeight(b);
    for (let i = 0; i < wa.length; i += 1) {
      if (wa[i] === wb[i]) continue;
      return wa[i] < wb[i] ? -1 : 1;
    }
    return 0;
  });
}

/** Identyfikatory miejsc, które przy danym limicie stracą uprawnienia. */
export function seatsBeyondLimit<T extends SeatLike>(
  seats: readonly T[],
  limit: number,
): string[] {
  return rankSeats(seats)
    .slice(clampSeats(limit))
    .map((seat) => seat.id);
}

/** Stan miejsca po zastosowaniu limitu - podgląd przed zapisem. */
export function projectedSeatStatus<T extends SeatLike>(
  seats: readonly T[],
  limit: number,
): Map<string, SeatStatus> {
  const ranked = rankSeats(seats);
  const cap = clampSeats(limit);
  return new Map(ranked.map((seat, index) => [seat.id, index < cap ? "active" : "suspended"]));
}

export function summarizeSeats<T extends SeatLike>(
  seats: readonly T[],
  limit: number,
): SeatsSummary {
  const cap = clampSeats(limit);
  const total = seats.length;
  const active = Math.min(total, cap);
  const beyond = seats.filter((s) => s.status === "grace" || s.status === "suspended");
  return {
    limit: cap,
    total,
    active,
    grace: beyond.filter((s) => s.status === "grace").length,
    suspended: beyond.filter((s) => s.status === "suspended").length || Math.max(0, total - cap - beyond.filter((s) => s.status === "grace").length),
    free: Math.max(0, cap - total),
    atLimit: active >= cap,
  };
}

/**
 * Czy zmiana limitu wymaga ostrzeżenia operatora - czyli komuś odbierze
 * dostęp. UI musi to pokazać ZANIM zapisze, bo płatność za miejsca i dostęp
 * ludzi to dwie różne rzeczy dla klienta.
 */
export function seatsAtRisk<T extends SeatLike>(seats: readonly T[], nextLimit: number): T[] {
  const cap = clampSeats(nextLimit);
  return rankSeats(seats).slice(cap);
}

/**
 * Data, do której miejsce ponad limit zachowa dostęp po zmianie limitu.
 * Odwzorowuje regułę bazy: karencja liczy się od chwili zmiany, a raz nadana
 * data nie jest przedłużana kolejnym przeliczeniem.
 */
export function graceDeadline(
  seat: Pick<SeatLike, "grace_until">,
  graceDays: number,
  now: Date = new Date(),
): string | null {
  const days = clampGraceDays(graceDays);
  if (days === 0) return null;
  if (seat.grace_until) return seat.grace_until;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Czy karencja miejsca już minęła (dostęp powinien być wygaszony). */
export function isGraceExpired(
  seat: Pick<SeatLike, "status" | "grace_until">,
  now: Date = new Date(),
): boolean {
  if (seat.status !== "grace" || !seat.grace_until) return false;
  const until = new Date(seat.grace_until).getTime();
  return Number.isFinite(until) && until <= now.getTime();
}

/** Czy miejsce nadal nadaje uprawnienia (aktywne albo w trwającej karencji). */
export function seatGrantsAccess(
  seat: Pick<SeatLike, "status" | "grace_until">,
  now: Date = new Date(),
): boolean {
  if (seat.status === "grace") return !isGraceExpired(seat, now);
  return seat.status !== "suspended";
}

export type SeatsSource = "manual" | "subscription";

export function isSeatsSource(value: unknown): value is SeatsSource {
  return value === "manual" || value === "subscription";
}
