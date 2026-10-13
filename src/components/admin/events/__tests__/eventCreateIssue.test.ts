// Reguła gotowości formularza „Nowe wydarzenie".
//
// CO TEN PLIK DOWODZI. Kolejność sprawdzeń jest kolejnością CZYTANIA formularza -
// redaktor dostaje uwagę o pierwszym brakującym polu od góry, a nie o ostatnim.
// Osobno: tryb `external` na rodzaju wymaga adresu zapisów, bo warunek
// `events_external_mode_requires_url` w bazie odrzuca taki wiersz bez adresu
// (recenzja PR 285, P1: jedna z czterech dopuszczalnych wartości trybu była
// przez to martwa - nie dało się utworzyć wydarzenia z takiego rodzaju).
import { describe, expect, it } from "vitest";
import {
  EMPTY_EVENT_CREATE_DRAFT,
  eventCreateIssue,
  type EventCreateDraft,
} from "@/components/admin/events/organisms/EventCreateForm";

const READY: EventCreateDraft = {
  eventTypeId: "3f1a0c8e-0000-4000-8000-000000000001",
  titlePl: "Śniadanie eksperckie",
  titleEn: "Expert breakfast",
  startsAt: "2026-09-01T09:00",
  endsAt: "",
  timezone: "Europe/Warsaw",
  format: "onsite",
  city: "",
  country: "",
  externalRegistrationUrl: "",
};

describe("eventCreateIssue - pola podstawowe", () => {
  it("pusta wersja robocza zgłasza tytuły jako pierwsze", () => {
    expect(eventCreateIssue(EMPTY_EVENT_CREATE_DRAFT, null)).toBe(
      "adminEvents.list.create.errors.titles",
    );
  });

  it("wymaga obu języków, nie jednego", () => {
    expect(eventCreateIssue({ ...READY, titleEn: "  " }, "rsvp")).toBe(
      "adminEvents.list.create.errors.titles",
    );
    expect(eventCreateIssue({ ...READY, titlePl: "" }, "rsvp")).toBe(
      "adminEvents.list.create.errors.titles",
    );
  });

  it("po tytułach pyta o termin, a po terminie o rodzaj", () => {
    expect(eventCreateIssue({ ...READY, startsAt: "" }, "rsvp")).toBe(
      "adminEvents.list.create.errors.startsAt",
    );
    expect(eventCreateIssue({ ...READY, eventTypeId: "" }, "rsvp")).toBe(
      "adminEvents.list.create.errors.type",
    );
  });

  it("kompletna wersja robocza nie ma zastrzeżeń", () => {
    expect(eventCreateIssue(READY, "rsvp")).toBeNull();
    expect(eventCreateIssue(READY, null)).toBeNull();
    expect(eventCreateIssue(READY, "form")).toBeNull();
    expect(eventCreateIssue(READY, "none")).toBeNull();
  });
});

describe("eventCreateIssue - termin, strefa i format", () => {
  it("koniec przed początkiem jest odrzucany", () => {
    expect(eventCreateIssue({ ...READY, endsAt: "2026-09-01T08:00" }, "rsvp")).toBe(
      "adminEvents.list.create.errors.endsAt",
    );
    expect(eventCreateIssue({ ...READY, endsAt: "2026-09-01T09:00" }, "rsvp")).toBe(
      "adminEvents.list.create.errors.endsAt",
    );
  });

  it("termin to zegar STREFY WYDARZENIA: koniec liczony na chwilach, nie na napisach", () => {
    // 29.03.2026 w Warszawie nie ma 02:00-02:59: początek „02:30" to 03:30
    // CEST (01:30Z), więc koniec „03:00" (01:00Z) jest PRZED nim, choć napis
    // jest późniejszy. Przeglądarka w UTC czytała oba napisy jako UTC.
    expect(
      eventCreateIssue(
        { ...READY, startsAt: "2026-03-29T02:30", endsAt: "2026-03-29T03:00" },
        "rsvp",
      ),
    ).toBe("adminEvents.list.create.errors.endsAt");
    expect(
      eventCreateIssue(
        { ...READY, startsAt: "2026-03-29T02:30", endsAt: "2026-03-29T03:31" },
        "rsvp",
      ),
    ).toBeNull();
  });

  it("nieistniejąca albo niepełna data początku nie przechodzi", () => {
    expect(eventCreateIssue({ ...READY, startsAt: "2026-02-30T10:00" }, "rsvp")).toBe(
      "adminEvents.list.create.errors.startsAt",
    );
    expect(eventCreateIssue({ ...READY, startsAt: "2026-09-01" }, "rsvp")).toBe(
      "adminEvents.list.create.errors.startsAt",
    );
  });

  it("koniec po początku i brak końca są równie poprawne", () => {
    expect(eventCreateIssue({ ...READY, endsAt: "2026-09-01T17:00" }, "rsvp")).toBeNull();
    expect(eventCreateIssue({ ...READY, endsAt: "" }, "rsvp")).toBeNull();
  });

  it("wymaga strefy czasowej i zbioru formatów zgodnego z bazą", () => {
    expect(eventCreateIssue({ ...READY, timezone: " " }, "rsvp")).toBe(
      "adminEvents.list.create.errors.timezone",
    );
    expect(eventCreateIssue({ ...READY, format: "teleport" }, "rsvp")).toBe(
      "adminEvents.list.create.errors.format",
    );
    for (const format of ["onsite", "online", "hybrid", ""]) {
      expect(eventCreateIssue({ ...READY, format }, "rsvp")).toBeNull();
    }
  });
});

describe("eventCreateIssue - adres zapisów zewnętrznych", () => {
  it("tryb external bez adresu jest odrzucany", () => {
    expect(eventCreateIssue(READY, "external")).toBe("adminEvents.list.create.errors.externalUrl");
    expect(eventCreateIssue({ ...READY, externalRegistrationUrl: "   " }, "external")).toBe(
      "adminEvents.list.create.errors.externalUrl",
    );
  });

  it("adres musi być https, bez spacji i bez schematu wykonywalnego", () => {
    for (const bad of [
      "http://rejestracja.example.org",
      "rejestracja.example.org",
      "javascript:alert(1)",
      "https://exa mple.org",
      "https://",
    ]) {
      expect(eventCreateIssue({ ...READY, externalRegistrationUrl: bad }, "external")).toBe(
        "adminEvents.list.create.errors.externalUrlInvalid",
      );
    }
  });

  it("odrzuca adres dłuższy niż limit kolumny", () => {
    const long = `https://example.org/${"a".repeat(2100)}`;
    expect(eventCreateIssue({ ...READY, externalRegistrationUrl: long }, "external")).toBe(
      "adminEvents.list.create.errors.externalUrlInvalid",
    );
  });

  it("poprawny adres domyka formularz", () => {
    expect(
      eventCreateIssue(
        { ...READY, externalRegistrationUrl: " https://rejestracja.example.org/nes-2026 " },
        "external",
      ),
    ).toBeNull();
  });

  it("adres podany przy innym trybie nie jest walidowany - serwer go zeruje", () => {
    expect(eventCreateIssue({ ...READY, externalRegistrationUrl: "cokolwiek" }, "rsvp")).toBeNull();
  });
});
