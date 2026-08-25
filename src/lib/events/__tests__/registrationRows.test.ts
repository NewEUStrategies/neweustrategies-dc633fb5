import { describe, expect, it } from "vitest";
import type { EventRegistrationRow } from "@/lib/events/registrationsApi";
import {
  actionRequiresReason,
  allowedRegistrationActions,
  areConsentsWithdrawn,
  hasMissingRequiredTerms,
  isAwaitingWaitlistNotice,
  registrationGroupLabel,
  registrationOffsetForPage,
  registrationPageCount,
  registrationPageIndex,
  registrationPersonName,
  registrationStatusTone,
  registrationTicketLabel,
} from "@/lib/events/registrationRows";

type RowOverrides = Partial<Record<keyof EventRegistrationRow, string | number | null>>;

function row(overrides: RowOverrides): EventRegistrationRow {
  return {
    first_name: "Anna",
    last_name: "Kowalska",
    email: "anna@example.org",
    status: "pending",
    ticket_type_id: null,
    ticket_key: null,
    ticket_name_pl: null,
    ticket_name_en: null,
    group_id: null,
    group_key: null,
    group_name_pl: null,
    group_name_en: null,
    promoted_at: null,
    waitlist_notified_at: null,
    required_terms_missing: 0,
    consent_withdrawn_at: null,
    ...overrides,
  } as unknown as EventRegistrationRow;
}

describe("allowedRegistrationActions", () => {
  it("nie oferuje zatwierdzenia zgloszenia juz zatwierdzonego", () => {
    expect(allowedRegistrationActions("approved")).not.toContain("approve");
    expect(allowedRegistrationActions("approved")).toContain("attended");
  });

  it("pozwala przywrocic odrzucone zgloszenie", () => {
    expect(allowedRegistrationActions("rejected")).toEqual(["approve", "waitlist"]);
  });

  it("nieznany stan nie daje zadnej czynnosci", () => {
    expect(allowedRegistrationActions("teleported")).toEqual([]);
  });
});

describe("actionRequiresReason", () => {
  it("wymaga powodu tam, gdzie wymaga go baza", () => {
    expect(actionRequiresReason("reject")).toBe(true);
    expect(actionRequiresReason("cancel")).toBe(true);
    expect(actionRequiresReason("approve")).toBe(false);
    expect(actionRequiresReason("attended")).toBe(false);
  });
});

describe("etykiety wiersza", () => {
  it("bez imienia pokazuje adres poczty", () => {
    expect(registrationPersonName(row({ first_name: null, last_name: null }))).toBe(
      "anna@example.org",
    );
  });

  it("bez biletu zwraca null, a nie pusty napis", () => {
    expect(registrationTicketLabel(row({}), "pl")).toBeNull();
  });

  it("brak nazwy w jezyku interfejsu spada na drugi jezyk", () => {
    const withTicket = row({
      ticket_type_id: "t1",
      ticket_name_pl: "Wstep wolny",
      ticket_name_en: null,
    });
    expect(registrationTicketLabel(withTicket, "en")).toBe("Wstep wolny");
  });

  it("bilet bez nazwy w obu jezykach spada na klucz", () => {
    const withTicket = row({ ticket_type_id: "t1", ticket_key: "free" });
    expect(registrationTicketLabel(withTicket, "pl")).toBe("free");
  });

  it("grupa dziala tak samo jak bilet", () => {
    const withGroup = row({ group_id: "g1", group_name_en: "Speakers" });
    expect(registrationGroupLabel(withGroup, "en")).toBe("Speakers");
    expect(registrationGroupLabel(row({}), "pl")).toBeNull();
  });

  it("tonacja nieznanego stanu jest neutralna", () => {
    expect(registrationStatusTone("pending")).toBe("warning");
    expect(registrationStatusTone("nonsense")).toBe("neutral");
  });
});

describe("znaczniki wymagajace uwagi organizatora", () => {
  it("awans bez powiadomienia jest oznaczony", () => {
    expect(isAwaitingWaitlistNotice(row({ promoted_at: "2026-01-01T10:00:00Z" }))).toBe(true);
  });

  it("awans z wyslana wiadomoscia nie jest oznaczony", () => {
    const notified = row({
      promoted_at: "2026-01-01T10:00:00Z",
      waitlist_notified_at: "2026-01-01T11:00:00Z",
    });
    expect(isAwaitingWaitlistNotice(notified)).toBe(false);
  });

  it("brakujace zgody i wycofanie zgod sa dwoma roznymi sygnalami", () => {
    expect(hasMissingRequiredTerms(row({ required_terms_missing: 2 }))).toBe(true);
    expect(hasMissingRequiredTerms(row({}))).toBe(false);
    expect(areConsentsWithdrawn(row({ consent_withdrawn_at: "2026-02-02T00:00:00Z" }))).toBe(true);
    expect(areConsentsWithdrawn(row({}))).toBe(false);
  });
});

describe("stronicowanie", () => {
  it("pusta lista ma jedna strone", () => {
    expect(registrationPageCount(0, 25)).toBe(1);
  });

  it("liczy strony w gore", () => {
    expect(registrationPageCount(26, 25)).toBe(2);
    expect(registrationPageIndex(25, 25)).toBe(2);
    expect(registrationPageIndex(0, 25)).toBe(1);
  });

  it("przesuniecie jest przyciete do istniejacych stron", () => {
    expect(registrationOffsetForPage(99, 25, 26)).toBe(25);
    expect(registrationOffsetForPage(0, 25, 26)).toBe(0);
  });
});
