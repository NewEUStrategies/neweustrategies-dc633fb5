// Odmowa bazy -> zdanie dla organizatora.
//
// Test pilnuje trzech rzeczy, na ktorych ten modul stoi: klucz musi ISTNIEC
// w slowniku (inaczej ekran pokaze surowa sciezke i18n), liczba z ogona
// komunikatu musi trafic do interpolacji (bez niej zdanie klamie), a komunikat
// spoza kontraktu bazy nie moze udawac znanego bledu.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-event-meetings";
import { adminMeetingFailure } from "@/lib/events/adminMeetingErrors";

describe("adminMeetingFailure", () => {
  it("mapuje snake_case bazy na istniejacy klucz slownika", () => {
    const failure = adminMeetingFailure(new Error("table_label_taken: duplicate"));
    expect(failure.key).toBe("adminEventMeetings.errors.tableLabelTaken");
    expect(i18n.exists(failure.key)).toBe(true);
  });

  it("wyciaga liczbe z ogona komunikatu do interpolacji", () => {
    const failure = adminMeetingFailure("table_in_use: table is used by 3 meetings");
    expect(failure.params.count).toBe(3);
    expect(i18n.t(failure.key, failure.params)).toContain("3");
  });

  it("nie zwraca pustych parametrow, gdy komunikat nie ma liczb", () => {
    const failure = adminMeetingFailure("invalid_label: label is required");
    expect(failure.params).toEqual({});
  });

  it("nieznany klucz degraduje do zdania awaryjnego", () => {
    for (const message of ["Failed to fetch", "42501", "", "Some Random Error: nope"]) {
      expect(adminMeetingFailure(message).key).toBe("adminEventMeetings.errors.unknown");
    }
  });

  it("klucz spoza slownika nie udaje znanego bledu", () => {
    expect(adminMeetingFailure("totally_made_up_code: x").key).toBe(
      "adminEventMeetings.errors.unknown",
    );
  });
});
