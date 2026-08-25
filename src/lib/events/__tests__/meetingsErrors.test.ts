import { describe, expect, it } from "vitest";
import {
  MEETING_ERROR_KEYS,
  meetingErrorI18nKey,
  meetingErrorKey,
} from "@/lib/events/meetingsErrors";

describe("meetingErrorKey", () => {
  it("wyjmuje klucz z komunikatu wyjatku Postgresa", () => {
    expect(meetingErrorKey(new Error("participant_busy: one of you already has a meeting"))).toBe(
      "participant_busy",
    );
  });

  it("dziala na goly napis i na obiekt bledu Supabase", () => {
    expect(meetingErrorKey("table_busy: taken")).toBe("table_busy");
    expect(meetingErrorKey({ message: "invitation_expired: expired on 2026-08-25" })).toBe(
      "invitation_expired",
    );
  });

  it("nieznany klucz oddaje jako unknown zamiast pokazywac go uzytkownikowi", () => {
    expect(meetingErrorKey(new Error("brand_new_rule: something"))).toBe("unknown");
  });

  it("nie bierze za klucz zwyklego zdania ani pustego bledu", () => {
    expect(meetingErrorKey(new Error("ERROR: coś poszło nie tak"))).toBe("unknown");
    expect(meetingErrorKey(new Error("Failed to fetch"))).toBe("unknown");
    expect(meetingErrorKey(null)).toBe("unknown");
    expect(meetingErrorKey(undefined)).toBe("unknown");
  });

  it("sklada pelna sciezke i18n w jednym miejscu", () => {
    expect(meetingErrorI18nKey(new Error("no_free_table: x"))).toBe(
      "eventMeetings.errors.no_free_table",
    );
  });

  it("lista kluczy nie ma duplikatow", () => {
    expect(new Set(MEETING_ERROR_KEYS).size).toBe(MEETING_ERROR_KEYS.length);
  });
});
