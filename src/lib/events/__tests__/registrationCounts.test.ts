// Odczyt liczników zapisów z `jsonb`.
//
// RPC oddaje `jsonb`, więc typ po stronie klienta nikt nie sprawdza. Test pilnuje
// dwóch rzeczy, których rzutowanie nie daje: (1) brak pola degraduje do zera,
// a nie do „NaN" na ekranie, (2) `capacity: null` (wydarzenie bez limitu) NIE
// jest zerem - „0 wolnych miejsc" na wydarzeniu bez limitu to komunikat
// dokładnie odwrotny do prawdy.
import { describe, expect, it } from "vitest";
import {
  emptyRegistrationCounts,
  occupancyPct,
  parseRegistrationCounts,
} from "@/lib/events/registrationCounts";

describe("parseRegistrationCounts", () => {
  it("czyta pełną odpowiedź bazy", () => {
    const counts = parseRegistrationCounts({
      all: 12,
      draft: 1,
      pending: 2,
      approved: 5,
      rejected: 1,
      waitlist: 2,
      cancelled: 0,
      attended: 1,
      no_show: 0,
      awaiting_notice: 2,
      capacity: 120,
      seats_left: 114,
    });
    expect(counts.all).toBe(12);
    expect(counts.byStatus.approved).toBe(5);
    expect(counts.byStatus.waitlist).toBe(2);
    expect(counts.awaitingNotice).toBe(2);
    expect(counts.capacity).toBe(120);
    expect(counts.seatsLeft).toBe(114);
  });

  it("brak pola daje zero, nie NaN", () => {
    const counts = parseRegistrationCounts({ all: 3 });
    expect(counts.byStatus.pending).toBe(0);
    expect(Number.isNaN(counts.byStatus.pending)).toBe(false);
  });

  it("null i nie-obiekt nie wysypują ekranu", () => {
    expect(parseRegistrationCounts(null)).toEqual(emptyRegistrationCounts());
    expect(parseRegistrationCounts("nonsense")).toEqual(emptyRegistrationCounts());
    expect(parseRegistrationCounts([1, 2, 3])).toEqual(emptyRegistrationCounts());
  });

  it("brak limitu miejsc zostaje nullem, a nie zerem", () => {
    const counts = parseRegistrationCounts({ all: 1, capacity: null, seats_left: null });
    expect(counts.capacity).toBeNull();
    expect(counts.seatsLeft).toBeNull();
    expect(occupancyPct(counts)).toBeNull();
  });

  it("wypełnienie liczy potwierdzonych i obecnych, i nie przekracza 100%", () => {
    expect(
      occupancyPct(parseRegistrationCounts({ approved: 30, attended: 30, capacity: 120 })),
    ).toBe(50);
    expect(
      occupancyPct(parseRegistrationCounts({ approved: 200, attended: 0, capacity: 120 })),
    ).toBe(100);
    expect(occupancyPct(parseRegistrationCounts({ approved: 1, capacity: 0 }))).toBeNull();
  });

  it("wartość ujemna z bazy nie robi ujemnego licznika", () => {
    expect(parseRegistrationCounts({ pending: -4 }).byStatus.pending).toBe(0);
  });
});
