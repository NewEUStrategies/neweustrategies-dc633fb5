// Szkic sesji: konwersje i warunki, które baza sprawdza CHECK-iem.
//
// DLACZEGO TEN TEST ISTNIEJE. Odmowa CHECK-a wraca jako `23514` bez nazwy
// kolumny, więc jedyne, co wskazuje organizatorowi pole do poprawy, to ta
// walidacja. Jeśli przepuści limit miejsc bez zapisów albo `endsAt` przed
// `startsAt`, użytkownik dostanie błąd bez informacji, co zmienić.
import { describe, expect, it } from "vitest";
import {
  emptySessionDraft,
  fromLocalInput,
  sessionDraftFromRow,
  sessionDraftToInput,
  toLocalInput,
  validateSessionDraft,
  type SessionDraft,
} from "@/lib/events/sessionDraft";
import type { EventSessionRow } from "@/lib/events/sessionsApi";

const EVENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function draft(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return {
    ...emptySessionDraft(100),
    titlePl: "Panel otwarcia",
    titleEn: "Opening panel",
    startsAt: "2026-09-01T10:00",
    endsAt: "2026-09-01T11:00",
    ...overrides,
  };
}

function fields(d: SessionDraft): string[] {
  return validateSessionDraft(d).map((error) => error.field);
}

describe("sessionDraft - konwersje", () => {
  it("ISO i `datetime-local` wracają do siebie bez przesunięcia", () => {
    const local = toLocalInput("2026-09-01T10:30:00.000Z");
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fromLocalInput(local)).toBe("2026-09-01T10:30:00.000Z");
  });

  it("puste i niepełne pole daty nie stają się `Invalid Date`", () => {
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("   ")).toBeNull();
    expect(fromLocalInput("2026-13-45T99:99")).toBeNull();
    expect(toLocalInput(null)).toBe("");
    expect(toLocalInput("nie-data")).toBe("");
  });

  it("brak limitu miejsc wraca z bazy jako PUSTE pole, nie zero", () => {
    const row = {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      title_pl: "Sesja",
      title_en: "Session",
      starts_at: "2026-09-01T08:00:00.000Z",
      ends_at: "2026-09-01T09:00:00.000Z",
      format: "hybrid",
      status: "published",
      capacity: null,
      requires_signup: false,
      allow_overlap: false,
    } as unknown as EventSessionRow;
    const converted = sessionDraftFromRow(row);
    expect(converted.capacity).toBe("");
    expect(converted.format).toBe("hybrid");
    expect(converted.status).toBe("published");
    expect(converted.allowOverlap).toBe(false);
  });

  it("nieznany format i stan z bazy schodzą do wartości bezpiecznych", () => {
    const row = {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      format: "teleport",
      status: "archived",
    } as unknown as EventSessionRow;
    const converted = sessionDraftFromRow(row);
    expect(converted.format).toBe("onsite");
    expect(converted.status).toBe("draft");
  });
});

describe("validateSessionDraft", () => {
  it("poprawny szkic nie ma błędów", () => {
    expect(validateSessionDraft(draft())).toEqual([]);
  });

  it("wymaga OBU tytułów - publiczna agenda ma dwie wersje językowe", () => {
    expect(fields(draft({ titleEn: "  " }))).toEqual(["titleEn"]);
    expect(fields(draft({ titlePl: "" }))).toEqual(["titlePl"]);
  });

  it("koniec przed początkiem i koniec równy początkowi są odrzucane", () => {
    expect(fields(draft({ endsAt: "2026-09-01T09:00" }))).toContain("endsAt");
    expect(fields(draft({ endsAt: "2026-09-01T10:00" }))).toContain("endsAt");
  });

  it("brak godzin wskazuje oba pola", () => {
    expect(fields(draft({ startsAt: "", endsAt: "" }))).toEqual(["startsAt", "endsAt"]);
  });

  it("limit miejsc bez włączonych zapisów jest odrzucany PRZED żądaniem", () => {
    const errors = validateSessionDraft(draft({ capacity: "80", requiresSignup: false }));
    expect(errors.map((e) => e.messageKey)).toContain(
      "adminEventAgenda.sessionDialog.validation.capacityNeedsSignup",
    );
  });

  it("limit z zapisami przechodzi, limit ujemny nie", () => {
    expect(validateSessionDraft(draft({ capacity: "80", requiresSignup: true }))).toEqual([]);
    expect(fields(draft({ capacity: "-1", requiresSignup: true }))).toContain("capacity");
    expect(fields(draft({ capacity: "8,5", requiresSignup: true }))).toContain("capacity");
  });

  it("adresy transmisji i nagrania muszą być https", () => {
    expect(fields(draft({ streamUrl: "http://stream.example" }))).toContain("streamUrl");
    expect(fields(draft({ recordingUrl: "example.com/x" }))).toContain("recordingUrl");
    expect(validateSessionDraft(draft({ streamUrl: "https://stream.example" }))).toEqual([]);
  });
});

describe("sessionDraftToInput", () => {
  it("puste pole limitu jedzie jako null, a nie zero", () => {
    const input = sessionDraftToInput(draft({ capacity: "" }), EVENT);
    expect(input.capacity).toBeNull();
    expect(input.eventId).toBe(EVENT);
    expect(input.id).toBeNull();
  });

  it("puste adresy jadą jako null, a wypełnione są obcinane", () => {
    const input = sessionDraftToInput(
      draft({ streamUrl: "  https://a.example  ", recordingUrl: "" }),
      EVENT,
    );
    expect(input.streamUrl).toBe("https://a.example");
    expect(input.recordingUrl).toBeNull();
  });

  it("szkic bez godzin nie zamienia się w payload z `Invalid Date`", () => {
    expect(() => sessionDraftToInput(draft({ startsAt: "" }), EVENT)).toThrow();
  });
});
