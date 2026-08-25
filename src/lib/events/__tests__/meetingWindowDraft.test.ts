import { describe, expect, it } from "vitest";
import {
  MAX_WINDOW_MINUTES,
  MIN_WINDOW_MINUTES,
  NEW_WINDOW_DRAFT,
  draftFromWindow,
  isoToLocalInput,
  localInputToIso,
  validateWindowDraft,
  windowPayload,
} from "@/lib/events/meetingWindowDraft";

function draft(startsAtLocal: string, endsAtLocal: string, note = "") {
  return { ...NEW_WINDOW_DRAFT, startsAtLocal, endsAtLocal, note };
}

describe("meetingWindowDraft", () => {
  it("robi z napisu datetime-local ISO i wraca do tego samego napisu", () => {
    const iso = localInputToIso("2026-09-14T09:30");
    expect(iso).not.toBeNull();
    expect(isoToLocalInput(iso)).toBe("2026-09-14T09:30");
  });

  it("odrzuca wartosc niepelna zamiast zwracac Invalid Date", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("2026-09-14")).toBeNull();
    expect(isoToLocalInput("nie-data")).toBe("");
    expect(isoToLocalInput(null)).toBe("");
  });

  it("nie przepuszcza okna konczacego sie przed poczatkiem", () => {
    expect(validateWindowDraft(draft("2026-09-14T11:00", "2026-09-14T10:00"))).toBe("order");
    expect(validateWindowDraft(draft("2026-09-14T10:00", "2026-09-14T10:00"))).toBe("order");
  });

  it("pilnuje granic dlugosci z migracji", () => {
    expect(validateWindowDraft(draft("2026-09-14T10:00", "2026-09-14T10:10"))).toBe("tooShort");
    expect(validateWindowDraft(draft("2026-09-14T10:00", "2026-09-15T10:00"))).toBe("tooLong");
    expect(validateWindowDraft(draft("2026-09-14T10:00", "2026-09-14T10:15"))).toBeNull();
    expect(MIN_WINDOW_MINUTES).toBe(15);
    expect(MAX_WINDOW_MINUTES).toBe(960);
  });

  it("zglasza brak danych, a nie falszywy blad zakresu", () => {
    expect(validateWindowDraft(NEW_WINDOW_DRAFT)).toBe("incomplete");
    expect(windowPayload(NEW_WINDOW_DRAFT)).toBeNull();
  });

  it("zamienia pusta notatke na null, a nie na pusty napis", () => {
    const payload = windowPayload(draft("2026-09-14T10:00", "2026-09-14T11:00", "   "));
    expect(payload?.note).toBeNull();
    const withNote = windowPayload(draft("2026-09-14T10:00", "2026-09-14T11:00", " panel "));
    expect(withNote?.note).toBe("panel");
  });

  it("odrzuca zbyt dluga notatke", () => {
    expect(validateWindowDraft(draft("2026-09-14T10:00", "2026-09-14T11:00", "x".repeat(301)))).toBe(
      "noteTooLong",
    );
  });

  it("z wiersza bazy robi szkic edycji z zachowanym id i stanem okna", () => {
    const iso = localInputToIso("2026-09-14T09:00") as string;
    const isoEnd = localInputToIso("2026-09-14T12:00") as string;
    const result = draftFromWindow({
      id: "w-1",
      startsAt: iso,
      endsAt: isoEnd,
      isOpen: false,
      note: null,
    });
    expect(result).toEqual({
      id: "w-1",
      startsAtLocal: "2026-09-14T09:00",
      endsAtLocal: "2026-09-14T12:00",
      isOpen: false,
      note: "",
    });
    expect(windowPayload(result)?.isOpen).toBe(false);
  });
});
