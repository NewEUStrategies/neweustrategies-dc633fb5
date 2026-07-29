// Plan Zespół rozliczany ZA MIEJSCE - czysta logika miejsc, wspólna dla panelu,
// profilu właściciela i testów. Odwzorowuje regułę bazy (org_reconcile_seats):
// gdy miejsc jest więcej niż opłaconych, zostają aktywne te najważniejsze -
// najpierw właściciel, potem miejsca faktycznie objęte (claimed), a na końcu
// najstarsze zaproszenia. Reszta jest ZAWIESZANA, nie kasowana: obniżenie
// limitu nie może po cichu wyrzucić ludzi z organizacji.
export const MIN_TEAM_SEATS = 1;
export const MAX_TEAM_SEATS = 500;

export type SeatStatus = "active" | "suspended";

export interface SeatLike {
  id: string;
  role: string;
  claimed_at: string | null;
  created_at: string;
  status?: string | null;
}

export interface SeatsSummary {
  limit: number;
  total: number;
  /** Miejsca mieszczące się w limicie (mają uprawnienia warstwy). */
  active: number;
  /** Miejsca ponad limit - zachowane, ale bez uprawnień. */
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
  return {
    limit: cap,
    total,
    active,
    suspended: Math.max(0, total - cap),
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

export type SeatsSource = "manual" | "subscription";

export function isSeatsSource(value: unknown): value is SeatsSource {
  return value === "manual" || value === "subscription";
}
