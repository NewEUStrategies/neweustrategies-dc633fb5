// Brzegi reguł wiersza zgłoszenia: puste kolumny i zdegenerowane stronicowanie.
//
// DLACZEGO TEN TEST ISTNIEJE. `registrationRows.test.ts` pilnuje przypadków
// typowych. Wiersz z RPC bywa jednak dziurawy (wpis organizatora bez adresu,
// bilet bez nazwy w żadnym języku, stary wiersz bez licznika zgód), a limit
// strony przychodzi z kodu, który mógł go wyzerować. Każda z tych dziur
// kończyła się dotąd bez dowodu: `undefined` w plakietce albo `NaN` w liczniku
// stron to błędy, które organizator widzi, a test nie.
import { describe, expect, it } from "vitest";
import type { EventRegistrationRow } from "@/lib/events/registrationsApi";
import {
  hasMissingRequiredTerms,
  isAwaitingWaitlistNotice,
  registrationGroupLabel,
  registrationOffsetForPage,
  registrationPageCount,
  registrationPageIndex,
  registrationPersonName,
  registrationTicketLabel,
} from "@/lib/events/registrationRows";

type RowOverrides = Partial<Record<keyof EventRegistrationRow, string | number | null>>;

function row(overrides: RowOverrides): EventRegistrationRow {
  return {
    first_name: "Anna",
    last_name: "Kowalska",
    email: "anna@example.org",
    ticket_type_id: null,
    ticket_key: null,
    ticket_name_pl: null,
    ticket_name_en: null,
    group_id: null,
    group_key: null,
    group_name_pl: null,
    group_name_en: null,
    required_terms_missing: 0,
    ...overrides,
  } as unknown as EventRegistrationRow;
}

describe("puste kolumny wiersza", () => {
  it("wpis bez imienia, nazwiska i adresu to pusty napis, nie `undefined`", () => {
    expect(registrationPersonName(row({ first_name: null, last_name: null, email: null }))).toBe(
      "",
    );
    expect(registrationPersonName(row({}))).toBe("Anna Kowalska");
    // Z adresem - adres zastępuje brakujące imię i nazwisko.
    expect(registrationPersonName(row({ first_name: " ", last_name: null }))).toBe(
      "anna@example.org",
    );
  });

  it("awans bez stempla powiadomienia czeka na wiadomość; brak kolumn to „nie awansował”", () => {
    expect(
      isAwaitingWaitlistNotice(
        row({ promoted_at: "2026-09-01T10:00:00Z", waitlist_notified_at: null }),
      ),
    ).toBe(true);
    expect(isAwaitingWaitlistNotice(row({}))).toBe(false);
  });

  it("bilet bez nazwy w żadnym języku i bez klucza to `null`", () => {
    expect(registrationTicketLabel(row({ ticket_type_id: "t-1" }), "pl")).toBeNull();
    expect(registrationTicketLabel(row({ ticket_type_id: "t-1", ticket_key: "vip" }), "en")).toBe(
      "vip",
    );
  });

  it("grupa: angielski spada na polski, polski na angielski, oba puste na klucz albo `null`", () => {
    expect(registrationGroupLabel(row({ group_id: "g-1", group_name_pl: "Media" }), "en")).toBe(
      "Media",
    );
    expect(registrationGroupLabel(row({ group_id: "g-1", group_name_en: "Press" }), "pl")).toBe(
      "Press",
    );
    expect(registrationGroupLabel(row({ group_id: "g-1", group_name_en: "Press" }), "en")).toBe(
      "Press",
    );
    expect(registrationGroupLabel(row({ group_id: "g-1", group_key: "media" }), "en")).toBe(
      "media",
    );
    expect(registrationGroupLabel(row({ group_id: "g-1" }), "pl")).toBeNull();
  });

  it("brak licznika zgód wymaganych znaczy „nic nie brakuje”", () => {
    expect(hasMissingRequiredTerms(row({ required_terms_missing: null }))).toBe(false);
  });
});

describe("stronicowanie przy limicie zero albo ujemnym", () => {
  it("jedna strona, strona pierwsza i przesunięcie zero - bez dzielenia przez zero", () => {
    expect(registrationPageCount(120, 0)).toBe(1);
    expect(registrationPageIndex(40, 0)).toBe(1);
    expect(registrationOffsetForPage(3, -5, 120)).toBe(0);
  });
});
