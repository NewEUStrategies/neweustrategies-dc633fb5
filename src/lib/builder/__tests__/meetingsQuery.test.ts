// Kontrakt czystej logiki widgetu meeting-booking: normalizacja inputu,
// warunek skonfigurowania, mapowanie wierszy RPC i grupowanie slotow po dniu.
import { describe, it, expect } from "vitest";
import {
  formatSlotRange,
  groupSlotsByDay,
  mapMeetingSlotRow,
  meetingSlotsConfigured,
  meetingSlotsInput,
  type MeetingSlotRow,
} from "@/lib/builder/meetingsQuery";

const slot = (over: Partial<MeetingSlotRow>): MeetingSlotRow => ({
  id: "s-1",
  host_user_id: "u-1",
  host_name: "Jan",
  host_avatar_url: null,
  host_slug: null,
  event_id: null,
  starts_at: "2026-10-12T09:00:00Z",
  ends_at: "2026-10-12T09:30:00Z",
  location: null,
  is_booked: false,
  booked_by_me: false,
  is_mine: false,
  ...over,
});

describe("meetingSlotsInput", () => {
  it("defaults to host mode with a 14-day horizon", () => {
    expect(meetingSlotsInput({})).toEqual({
      mode: "host",
      hostUserId: "",
      eventId: "",
      daysAhead: 14,
    });
  });

  it("clamps daysAhead to 1..90 and whitelists mode", () => {
    expect(meetingSlotsInput({ daysAhead: 0 }).daysAhead).toBe(1);
    expect(meetingSlotsInput({ daysAhead: 365 }).daysAhead).toBe(90);
    expect(meetingSlotsInput({ mode: "event" }).mode).toBe("event");
    expect(meetingSlotsInput({ mode: "weird" }).mode).toBe("host");
  });
});

describe("meetingSlotsConfigured", () => {
  it("requires a host in host mode and an event in event mode", () => {
    expect(meetingSlotsConfigured(meetingSlotsInput({ mode: "host" }))).toBe(false);
    expect(meetingSlotsConfigured(meetingSlotsInput({ mode: "host", hostUserId: "u" }))).toBe(true);
    expect(meetingSlotsConfigured(meetingSlotsInput({ mode: "event" }))).toBe(false);
    expect(meetingSlotsConfigured(meetingSlotsInput({ mode: "event", eventId: "e" }))).toBe(true);
  });
});

describe("mapMeetingSlotRow", () => {
  it("normalizes flags and nulls empty strings", () => {
    const row = mapMeetingSlotRow({
      id: "s-9",
      host_user_id: "u-9",
      host_name: "",
      starts_at: "2026-01-01T10:00:00Z",
      ends_at: "2026-01-01T10:30:00Z",
      is_booked: true,
      booked_by_me: "yes",
      is_mine: false,
    });
    expect(row.host_name).toBeNull();
    expect(row.is_booked).toBe(true);
    // Tylko literalne true przechodzi (RPC zwraca boolean).
    expect(row.booked_by_me).toBe(false);
  });
});

describe("groupSlotsByDay", () => {
  it("groups chronologically by local day and keeps slot order", () => {
    const groups = groupSlotsByDay(
      [
        slot({ id: "b", starts_at: "2026-10-13T12:00:00Z", ends_at: "2026-10-13T12:30:00Z" }),
        slot({ id: "a", starts_at: "2026-10-12T09:00:00Z" }),
        slot({ id: "c", starts_at: "2026-10-12T11:00:00Z", ends_at: "2026-10-12T11:30:00Z" }),
      ],
      "pl",
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].slots.map((s) => s.id)).toEqual(["a", "c"]);
    expect(groups[1].slots.map((s) => s.id)).toEqual(["b"]);
    expect(groups[0].label.length).toBeGreaterThan(0);
  });

  it("drops slots with unparseable dates", () => {
    expect(groupSlotsByDay([slot({ starts_at: "garbage" })], "en")).toEqual([]);
  });
});

describe("formatSlotRange", () => {
  it("joins with a hyphen and degrades to the start time", () => {
    const full = formatSlotRange(slot({}), "pl");
    expect(full).toContain(" - ");
    expect(full).not.toContain("—");
    expect(formatSlotRange(slot({ ends_at: "bad" }), "pl")).not.toContain(" - ");
    expect(formatSlotRange(slot({ starts_at: "bad" }), "pl")).toBe("");
  });
});
