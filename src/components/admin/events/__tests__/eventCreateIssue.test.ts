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
