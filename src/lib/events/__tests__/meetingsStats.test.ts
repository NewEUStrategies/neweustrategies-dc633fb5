import { describe, expect, it } from "vitest";
import {
  EMPTY_MEETING_STATS,
  parseMeetingStats,
  participantName,
} from "@/lib/events/meetingsStats";
import type { Json } from "@/integrations/supabase/types";

describe("parseMeetingStats", () => {
  it("oddaje pusty zestaw dla braku odpowiedzi", () => {
    expect(parseMeetingStats(null)).toEqual(EMPTY_MEETING_STATS);
    expect(parseMeetingStats(undefined)).toEqual(EMPTY_MEETING_STATS);
    expect(parseMeetingStats([] as unknown as Json)).toEqual(EMPTY_MEETING_STATS);
  });

  it("czyta liczniki i procenty z odpowiedzi RPC", () => {
    const stats = parseMeetingStats({
      total: 12,
      invited: 3,
      expired: 1,
      accepted: 6,
      declined: 2,
      held: 4,
      no_show: 1,
      confirmed: 7,
      acceptance_rate: 75,
      attendance_rate: 80,
      grid_slots: 18,
      seats_count: 20,
      timezone: "Europe/Brussels",
      participants_count: 40,
      with_availability_count: 25,
      without_availability_count: 15,
      with_meeting_count: 14,
      without_meeting_count: 26,
    } as unknown as Json);

    expect(stats.total).toBe(12);
    expect(stats.noShow).toBe(1);
    expect(stats.acceptanceRate).toBe(75);
    expect(stats.timezone).toBe("Europe/Brussels");
    expect(stats.withoutMeetingCount).toBe(26);
  });

  it("rozroznia brak wskaznika od zera", () => {
    const stats = parseMeetingStats({
      accepted: 0,
      acceptance_rate: null,
      attendance_rate: 0,
    } as unknown as Json);

    expect(stats.accepted).toBe(0);
    expect(stats.acceptanceRate).toBeNull();
    expect(stats.attendanceRate).toBe(0);
  });

  it("odrzuca procent spoza zakresu zamiast pokazac bzdure", () => {
    const stats = parseMeetingStats({ acceptance_rate: 420 } as unknown as Json);
    expect(stats.acceptanceRate).toBeNull();
  });

  it("pomija wiersze bez identyfikatora i zachowuje kolejnosc bazy", () => {
    const stats = parseMeetingStats({
      tables: [
        { table_id: "t2", label: "B", capacity: 2, is_active: true, slots_taken: 4 },
        { label: "bez id", capacity: 2 },
        { table_id: "t1", label: "A", capacity: 1, is_active: false, utilisation_pct: 50 },
      ],
      by_day: [{ day: "2026-09-01", confirmed: 2, invited: 1, total: 3 }, { confirmed: 9 }],
      without_meeting: [
        { registration_id: "r1", first_name: "Anna", last_name: "Nowak", has_availability: true },
        { first_name: "duch" },
      ],
    } as unknown as Json);

    expect(stats.tables.map((row) => row.tableId)).toEqual(["t2", "t1"]);
    expect(stats.tables[0]?.utilisationPct).toBeNull();
    expect(stats.tables[1]?.isActive).toBe(false);
    expect(stats.byDay).toHaveLength(1);
    expect(stats.withoutMeeting).toHaveLength(1);
    expect(stats.withoutMeeting[0]?.company).toBeNull();
  });

  it("nie wywraca sie na polach zlego typu", () => {
    const stats = parseMeetingStats({
      total: "12",
      tables: "brak",
      timezone: "   ",
    } as unknown as Json);

    expect(stats.total).toBe(0);
    expect(stats.tables).toEqual([]);
    expect(stats.timezone).toBe("Europe/Warsaw");
  });
});

describe("participantName", () => {
  it("skleja czlony i oddaje null, gdy nie ma zadnego", () => {
    expect(participantName({ firstName: "Jan", lastName: "Kowalski" })).toBe("Jan Kowalski");
    expect(participantName({ firstName: null, lastName: "Kowalski" })).toBe("Kowalski");
    expect(participantName({ firstName: null, lastName: null })).toBeNull();
  });
});
