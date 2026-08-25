import { describe, expect, it } from "vitest";
import type { MeetingSettings } from "@/lib/events/meetingsApi";
import {
  draftFromSettings,
  settingsInputFromDraft,
  slotsPerDay,
  timeToMinutes,
  validateSettingsDraft,
  type MeetingSettingsDraft,
} from "@/lib/events/meetingsSettingsDraft";

const SETTINGS: MeetingSettings = {
  configured: true,
  event_id: "e1",
  event_timezone: "Europe/Warsaw",
  is_enabled: true,
  slot_minutes: 20,
  break_minutes: 5,
  day_start_time: "09:00:00",
  day_end_time: "17:00:00",
  meeting_days: ["2026-09-02", "2026-09-01"],
  timezone: "Europe/Brussels",
  invites_open_at: null,
  invites_close_at: null,
  max_invites_per_person: 5,
  max_meetings_per_day: null,
  invite_expires_after_hours: 72,
  visibility: "everyone",
  intro_pl: "Witamy",
  intro_en: "Welcome",
  updated_at: null,
  requester_groups: [
    {
      group_id: "g1",
      key: "sponsors",
      name_pl: "Sponsorzy",
      name_en: "Sponsors",
      can_meet: true,
      can_lead_retrieval: true,
    },
  ],
  invitee_groups: [],
  available_groups: [],
  tables_count: 4,
  seats_count: 8,
  participants_count: 40,
  with_availability_count: 12,
};

function draft(overrides: Partial<MeetingSettingsDraft> = {}): MeetingSettingsDraft {
  return { ...draftFromSettings(SETTINGS), ...overrides };
}

describe("draftFromSettings", () => {
  it("skraca godziny do HH:MM i sortuje dni", () => {
    const value = draftFromSettings(SETTINGS);
    expect(value.dayStartTime).toBe("09:00");
    expect(value.dayEndTime).toBe("17:00");
    expect(value.meetingDays).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("brak limitu to pusty napis, nie zero", () => {
    const value = draftFromSettings(SETTINGS);
    expect(value.maxMeetingsPerDay).toBe("");
    expect(value.maxInvitesPerPerson).toBe("5");
  });

  it("przenosi przydzial grup po identyfikatorach", () => {
    expect(draftFromSettings(SETTINGS).requesterGroupIds).toEqual(["g1"]);
  });
});

describe("validateSettingsDraft", () => {
  it("poprawny szkic nie ma bledow", () => {
    expect(validateSettingsDraft(draft())).toEqual([]);
  });

  it("lapie odwrocona kolejnosc godzin", () => {
    expect(validateSettingsDraft(draft({ dayStartTime: "18:00", dayEndTime: "09:00" }))).toContain(
      "dayOrder",
    );
  });

  it("lapie okno krotsze niz jeden slot", () => {
    const errors = validateSettingsDraft(
      draft({ dayStartTime: "09:00", dayEndTime: "09:10", slotMinutes: "20" }),
    );
    expect(errors).toContain("dayTooShort");
    expect(errors).not.toContain("dayOrder");
  });

  it("wymaga dni tylko przy wlaczonej gieldzie", () => {
    expect(validateSettingsDraft(draft({ meetingDays: [] }))).toContain("meetingDaysRequired");
    expect(validateSettingsDraft(draft({ meetingDays: [], isEnabled: false }))).not.toContain(
      "meetingDaysRequired",
    );
  });

  it("wymaga grup po obu stronach przy regule groups", () => {
    expect(validateSettingsDraft(draft({ visibility: "groups" }))).toContain("groupsRequired");
    expect(
      validateSettingsDraft(
        draft({ visibility: "groups", requesterGroupIds: ["g1"], inviteeGroupIds: ["g2"] }),
      ),
    ).toEqual([]);
  });

  it("pusty limit jest dozwolony, ujemny nie", () => {
    expect(validateSettingsDraft(draft({ maxInvitesPerPerson: "" }))).toEqual([]);
    expect(validateSettingsDraft(draft({ maxInvitesPerPerson: "0" }))).toContain("limitRange");
  });

  it("pilnuje kolejnosci okna zaproszen", () => {
    const errors = validateSettingsDraft(
      draft({ invitesOpenAt: "2026-09-02T10:00", invitesCloseAt: "2026-09-01T10:00" }),
    );
    expect(errors).toContain("windowOrder");
  });

  it("zwraca wszystkie bledy naraz", () => {
    const errors = validateSettingsDraft(
      draft({ slotMinutes: "0", inviteExpiresAfterHours: "0", timezone: " " }),
    );
    expect(new Set(errors)).toEqual(
      new Set(["timezoneRequired", "slotMinutesRange", "expiryRange"]),
    );
  });
});

describe("settingsInputFromDraft", () => {
  it("zamienia napisy na liczby i puste limity na null", () => {
    const input = settingsInputFromDraft("e1", draft({ maxInvitesPerPerson: "" }));
    expect(input.slotMinutes).toBe(20);
    expect(input.maxInvitesPerPerson).toBeNull();
    expect(input.eventId).toBe("e1");
  });

  it("nie wysyla grup poza regula groups", () => {
    const input = settingsInputFromDraft("e1", draft({ visibility: "everyone" }));
    expect(input.requesterGroupIds).toBeUndefined();
    expect(input.inviteeGroupIds).toBeUndefined();
  });

  it("wysyla obie strony przy regule groups", () => {
    const input = settingsInputFromDraft(
      "e1",
      draft({ visibility: "groups", requesterGroupIds: ["g1"], inviteeGroupIds: ["g2"] }),
    );
    expect(input.requesterGroupIds).toEqual(["g1"]);
    expect(input.inviteeGroupIds).toEqual(["g2"]);
  });

  it("puste okno zaproszen idzie jako null", () => {
    const input = settingsInputFromDraft("e1", draft({ invitesOpenAt: "" }));
    expect(input.invitesOpenAt).toBeNull();
  });
});

describe("slotsPerDay", () => {
  it("liczy sloty tak samo jak siatka w bazie", () => {
    // 09:00-17:00 = 480 min, krok 25 min, ostatni slot musi zmiescic sie caly.
    expect(slotsPerDay(draft())).toBe(20);
  });

  it("bez przerwy krok rowna sie dlugosci slotu", () => {
    expect(slotsPerDay(draft({ breakMinutes: "0", dayEndTime: "10:00" }))).toBe(3);
  });

  it("niepoprawne okno daje zero", () => {
    expect(slotsPerDay(draft({ dayEndTime: "08:00" }))).toBe(0);
  });
});

describe("timeToMinutes", () => {
  it("czyta HH:MM i HH:MM:SS", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("09:30:00")).toBe(570);
  });

  it("odrzuca smieci i godziny spoza doby", () => {
    expect(timeToMinutes("brak")).toBeNull();
    expect(timeToMinutes("25:00")).toBeNull();
  });
});
