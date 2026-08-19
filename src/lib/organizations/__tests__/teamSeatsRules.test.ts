// CZYSTA LOGIKA MIEJSC W PLANIE ZESPÓŁ (lib/organizations/teamSeats.ts).
//
// Ten moduł odwzorowuje regułę bazy (`org_reconcile_seats`): przy kurczącym się
// limicie zostają miejsca NAJWAŻNIEJSZE - najpierw właściciel, potem miejsca
// faktycznie objęte, na końcu najstarsze zaproszenia; reszta jest ZAWIESZANA,
// nie kasowana. Panel pokazuje ten sam podgląd PRZED zapisem, więc rozjazd
// między nim a bazą oznaczałby, że operator ostrzega o odebraniu dostępu
// niewłaściwej osobie.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRACE_DAYS,
  DEFAULT_SEAT_GRACE_REMINDER_DAYS,
  MAX_GRACE_DAYS,
  MAX_TEAM_SEATS,
  MIN_TEAM_SEATS,
  clampGraceDays,
  clampSeats,
  effectiveReminderDays,
  formatReminderDays,
  graceDeadline,
  isGraceExpired,
  isSeatsSource,
  normalizeReminderDays,
  parseReminderDays,
  projectedSeatStatus,
  rankSeats,
  sameReminderDays,
  seatGrantsAccess,
  seatsAtRisk,
  seatsBeyondLimit,
  summarizeSeats,
  type SeatLike,
} from "@/lib/organizations/teamSeats";

const seat = (over: Partial<SeatLike> & { id: string }): SeatLike => ({
  role: "member",
  claimed_at: null,
  created_at: "2026-08-01T10:00:00.000Z",
  ...over,
});

describe("clampSeats / clampGraceDays", () => {
  it("liczba miejsc trzyma się oferty", () => {
    expect(clampSeats(0)).toBe(MIN_TEAM_SEATS);
    expect(clampSeats(9000)).toBe(MAX_TEAM_SEATS);
    expect(clampSeats(7.9)).toBe(7);
    expect(clampSeats(null)).toBe(MIN_TEAM_SEATS);
    expect(clampSeats(Number.NaN)).toBe(MIN_TEAM_SEATS);
  });

  it("karencja trzyma się zakresu 0-90 dni", () => {
    expect(clampGraceDays(-5)).toBe(0);
    expect(clampGraceDays(500)).toBe(MAX_GRACE_DAYS);
    expect(clampGraceDays(null)).toBe(DEFAULT_GRACE_DAYS);
    expect(clampGraceDays(Number.NaN)).toBe(DEFAULT_GRACE_DAYS);
    expect(clampGraceDays(14)).toBe(14);
  });
});

describe("progi przypomnień", () => {
  it("normalizacja: całkowite 1-90, malejąco, bez duplikatów, maks. 10", () => {
    expect(normalizeReminderDays([1, 7, 7, 0, -3, 200, 30.7])).toEqual([30, 7, 1]);
    expect(normalizeReminderDays(Array.from({ length: 20 }, (_, i) => i + 1))).toHaveLength(10);
  });

  it("parsowanie z pola tekstowego przyjmuje przecinki, spacje i średniki", () => {
    expect(parseReminderDays("14, 7;3  1")).toEqual([14, 7, 3, 1]);
    expect(parseReminderDays("abc")).toEqual([]);
    expect(parseReminderDays("")).toEqual([]);
  });

  it("formatowanie wraca do postaci z pola tekstowego", () => {
    expect(formatReminderDays([1, 7, 30])).toBe("30, 7, 1");
    expect(formatReminderDays([])).toBe("");
  });

  it("brak konfiguracji organizacji to progi domyślne, pusta lista to brak przypomnień", () => {
    expect(effectiveReminderDays(null)).toEqual([...DEFAULT_SEAT_GRACE_REMINDER_DAYS]);
    expect(effectiveReminderDays(undefined)).toEqual([...DEFAULT_SEAT_GRACE_REMINDER_DAYS]);
    expect(effectiveReminderDays([])).toEqual([]);
    expect(effectiveReminderDays([3, 3])).toEqual([3]);
  });

  it("porównanie progów ignoruje kolejność i duplikaty", () => {
    expect(sameReminderDays([7, 1], [1, 7])).toBe(true);
    expect(sameReminderDays([7, 1], [7])).toBe(false);
    expect(sameReminderDays([7, 7, 1], [1, 7])).toBe(true);
  });
});

describe("kolejność zachowania miejsc", () => {
  const owner = seat({ id: "owner", role: "owner", created_at: "2026-08-10T10:00:00.000Z" });
  const claimedOld = seat({
    id: "claimed-old",
    claimed_at: "2026-08-02T10:00:00.000Z",
    created_at: "2026-08-02T09:00:00.000Z",
  });
  const claimedNew = seat({
    id: "claimed-new",
    claimed_at: "2026-08-05T10:00:00.000Z",
    created_at: "2026-08-05T09:00:00.000Z",
  });
  const invitedOld = seat({ id: "invited-old", created_at: "2026-08-01T10:00:00.000Z" });
  const invitedNew = seat({ id: "invited-new", created_at: "2026-08-09T10:00:00.000Z" });
  const all = [invitedNew, claimedNew, owner, invitedOld, claimedOld];

  it("właściciel pierwszy, potem objęte miejsca, na końcu najmłodsze zaproszenia", () => {
    expect(rankSeats(all).map((s) => s.id)).toEqual([
      "owner",
      "claimed-old",
      "claimed-new",
      "invited-old",
      "invited-new",
    ]);
  });

  it("kolejność nie zależy od kolejności wejścia (remis rozstrzyga id)", () => {
    const a = seat({ id: "a" });
    const b = seat({ id: "b" });
    expect(rankSeats([b, a]).map((s) => s.id)).toEqual(["a", "b"]);
    expect(rankSeats([a, b]).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("rankSeats nie mutuje wejścia", () => {
    const input = [invitedNew, owner];
    rankSeats(input);
    expect(input.map((s) => s.id)).toEqual(["invited-new", "owner"]);
  });

  it("miejsca ponad limit to te z końca kolejki", () => {
    expect(seatsBeyondLimit(all, 2)).toEqual(["claimed-new", "invited-old", "invited-new"]);
    expect(seatsBeyondLimit(all, 99)).toEqual([]);
  });

  it("ostrzeżenie przed zapisem pokazuje TE SAME miejsca, co odbierze baza", () => {
    expect(seatsAtRisk(all, 2).map((s) => s.id)).toEqual(seatsBeyondLimit(all, 2));
  });

  it("podgląd statusów zna każde miejsce i zawiesza dokładnie nadmiar", () => {
    const projected = projectedSeatStatus(all, 2);
    expect(projected.size).toBe(all.length);
    expect(projected.get("owner")).toBe("active");
    expect(projected.get("claimed-old")).toBe("active");
    expect(projected.get("invited-new")).toBe("suspended");
  });
});

describe("podsumowanie miejsc", () => {
  it("liczy aktywne, wolne i stan „pełno”", () => {
    const summary = summarizeSeats([seat({ id: "a" }), seat({ id: "b" })], 5);
    expect(summary).toMatchObject({ limit: 5, total: 2, active: 2, free: 3, atLimit: false });
  });

  it("nadmiar bez statusów liczy się jako zawieszony", () => {
    const summary = summarizeSeats([seat({ id: "a" }), seat({ id: "b" }), seat({ id: "c" })], 1);
    expect(summary).toMatchObject({ active: 1, suspended: 2, free: 0, atLimit: true });
  });

  it("miejsca w karencji są liczone osobno od zawieszonych", () => {
    const summary = summarizeSeats(
      [
        seat({ id: "a" }),
        seat({ id: "b", status: "grace", grace_until: "2026-09-01T00:00:00.000Z" }),
        seat({ id: "c", status: "suspended" }),
      ],
      1,
    );
    expect(summary).toMatchObject({ grace: 1, suspended: 1, atLimit: true });
  });
});

describe("karencja miejsca", () => {
  const now = new Date("2026-08-18T12:00:00.000Z");

  it("termin liczy się od chwili zmiany limitu", () => {
    const deadline = graceDeadline({ grace_until: null }, 7, now);
    expect(deadline).toBe(new Date(now.getTime() + 7 * 86_400_000).toISOString());
  });

  it("raz nadany termin nie jest przedłużany kolejnym przeliczeniem", () => {
    expect(graceDeadline({ grace_until: "2026-08-20T00:00:00.000Z" }, 30, now)).toBe(
      "2026-08-20T00:00:00.000Z",
    );
  });

  it("karencja zerodniowa nie daje żadnego terminu (dostęp gaśnie od razu)", () => {
    expect(graceDeadline({ grace_until: null }, 0, now)).toBeNull();
  });

  it("karencja jest przeterminowana dopiero po terminie i tylko w statusie grace", () => {
    expect(isGraceExpired({ status: "grace", grace_until: "2026-08-17T12:00:00.000Z" }, now)).toBe(
      true,
    );
    expect(isGraceExpired({ status: "grace", grace_until: "2026-08-19T12:00:00.000Z" }, now)).toBe(
      false,
    );
    expect(isGraceExpired({ status: "grace", grace_until: null }, now)).toBe(false);
    expect(isGraceExpired({ status: "active", grace_until: "2026-01-01T00:00:00.000Z" }, now)).toBe(
      false,
    );
    expect(isGraceExpired({ status: "grace", grace_until: "brak-daty" }, now)).toBe(false);
  });

  it("dostęp mają miejsca aktywne i te w TRWAJĄCEJ karencji", () => {
    expect(seatGrantsAccess({ status: "active", grace_until: null }, now)).toBe(true);
    expect(
      seatGrantsAccess({ status: "grace", grace_until: "2026-08-19T12:00:00.000Z" }, now),
    ).toBe(true);
    expect(
      seatGrantsAccess({ status: "grace", grace_until: "2026-08-17T12:00:00.000Z" }, now),
    ).toBe(false);
    expect(seatGrantsAccess({ status: "suspended", grace_until: null }, now)).toBe(false);
  });
});

describe("źródło limitu miejsc", () => {
  it("rozpoznaje wyłącznie znane wartości", () => {
    expect(isSeatsSource("manual")).toBe(true);
    expect(isSeatsSource("subscription")).toBe(true);
    expect(isSeatsSource("stripe")).toBe(false);
    expect(isSeatsSource(null)).toBe(false);
  });
});
