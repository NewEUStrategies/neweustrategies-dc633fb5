// Siatka czasu agendy: arytmetyka doby, pasy nakładających się sesji i kolizje.
//
// TESTUJEMY REGUŁY, NIE PIKSELE: doba liczy się w strefie WYDARZENIA, sesja bez
// sali ma własną kolumnę, a dwie sesje na siebie zachodzące dostają dwa pasy.
import { describe, expect, it } from "vitest";
import {
  TIMELINE_NO_ROOM,
  buildAgendaTimeline,
  formatMinuteLabel,
  minutesInEventDay,
} from "@/lib/events/agendaTimeline";
import type { AgendaConflictRow, EventRoomRow, EventSessionRow } from "@/lib/events/sessionsApi";

function session(patch: Partial<EventSessionRow>): EventSessionRow {
  return {
    id: "s1",
    event_id: "e1",
    title_pl: "Sesja",
    title_en: "Session",
    starts_at: "2026-09-01T07:00:00Z",
    ends_at: "2026-09-01T08:00:00Z",
    duration_minutes: 60,
    room_id: "r1",
    room_name: "Sala A",
    status: "published",
    track_name_pl: "Polityka",
    track_name_en: "Policy",
    track_accent_color: "#FA9346",
    ...patch,
  } as EventSessionRow;
}

const rooms = [
  { id: "r1", name: "Sala A", capacity: 100 },
  { id: "r2", name: "Sala B", capacity: 40 },
] as unknown as EventRoomRow[];

describe("minutesInEventDay", () => {
  it("liczy minuty w strefie wydarzenia, nie w UTC", () => {
    // 07:00 UTC to 09:00 w Warszawie (CEST).
    expect(minutesInEventDay("2026-09-01T07:00:00Z", "Europe/Warsaw", "2026-09-01")).toBe(540);
  });

  it("dolicza dobę, gdy koniec sesji wypada po północy", () => {
    expect(minutesInEventDay("2026-09-02T00:30:00+02:00", "Europe/Warsaw", "2026-09-01")).toBe(
      1470,
    );
  });

  it("oddaje null dla pustej i niepoprawnej daty", () => {
    expect(minutesInEventDay("", "Europe/Warsaw", "2026-09-01")).toBeNull();
    expect(minutesInEventDay("nie-data", "Europe/Warsaw", "2026-09-01")).toBeNull();
  });
});

describe("buildAgendaTimeline", () => {
  it("grupuje po dniach wydarzenia i ustawia kafel na właściwej minucie", () => {
    const days = buildAgendaTimeline({
      sessions: [session({}), session({ id: "s2", starts_at: "2026-09-02T07:00:00Z" })],
      rooms,
      conflicts: [],
      timezone: "Europe/Warsaw",
      lang: "pl",
    });
    expect(days.map((day) => day.dayKey)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(days[0]?.blocks[0]?.startMinute).toBe(540);
    expect(days[0]?.blocks[0]?.title).toBe("Sesja");
    expect(days[0]?.fromHour).toBe(9);
  });

  it("daje sesji bez sali własną kolumnę", () => {
    const days = buildAgendaTimeline({
      sessions: [session({ room_id: "" })],
      rooms,
      conflicts: [],
      timezone: "Europe/Warsaw",
      lang: "pl",
    });
    expect(days[0]?.columns.map((column) => column.id)).toEqual([TIMELINE_NO_ROOM]);
  });

  it("rozdziela nakładające się sesje na pasy tej samej kolumny", () => {
    const days = buildAgendaTimeline({
      sessions: [
        session({}),
        session({ id: "s2", starts_at: "2026-09-01T07:30:00Z", ends_at: "2026-09-01T08:30:00Z" }),
      ],
      rooms,
      conflicts: [],
      timezone: "Europe/Warsaw",
      lang: "pl",
    });
    const lanes = (days[0]?.blocks ?? []).map((block) => block.lane).sort();
    expect(lanes).toEqual([0, 1]);
    expect(days[0]?.blocks[0]?.lanes).toBe(2);
  });

  it("oznacza kafel, którego sesja jest w raporcie kolizji", () => {
    const conflicts = [{ session_id: "s1", kind: "speaker_overlap" }] as AgendaConflictRow[];
    const days = buildAgendaTimeline({
      sessions: [session({})],
      rooms,
      conflicts,
      timezone: "Europe/Warsaw",
      lang: "en",
    });
    expect(days[0]?.blocks[0]?.hasConflict).toBe(true);
    expect(days[0]?.blocks[0]?.title).toBe("Session");
  });
});

describe("formatMinuteLabel", () => {
  it("formatuje minuty jako godzinę dwucyfrową", () => {
    expect(formatMinuteLabel(540)).toBe("09:00");
    expect(formatMinuteLabel(1470)).toBe("00:30");
  });
});
