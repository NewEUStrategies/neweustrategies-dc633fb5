// Odmowy bazy planu sali -> zdanie dla organizatora.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. `seats_in_use: 3 assigned seat(s)` bez liczby w zdaniu - organizator nie
//      wie, ile osób musi najpierw zwolnić.
//   2. Błąd sieci („Failed to fetch”) udaje klucz bazy i pokazuje surową ścieżkę.
//   3. Obiekt błędu PostgREST (`{ message }`) albo napis nie trafia do mapy.
import { describe, expect, it } from "vitest";

import { adminSeatingErrorMessage, adminSeatingFailure } from "@/lib/events/adminSeatingErrors";
import { adminEventSeatingEn, adminEventSeatingPl } from "@/lib/i18n-admin-event-seating";

function flatten(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") return [prefix.replace(/_(one|few|many|other)$/, "")];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatten(value, prefix === "" ? key : `${prefix}.${key}`),
  );
}

describe("adminSeatingFailure", () => {
  it("rozpoznaje głowę komunikatu i wyciąga liczby z ogona", () => {
    expect(adminSeatingFailure(new Error("map_too_large: plan would have 5200 seats, limit is 5000"))).toEqual({
      key: "adminEventSeating.errors.mapTooLarge",
      params: { count: 5200, total: 5000 },
    });
    expect(adminSeatingFailure(new Error("seat_taken: already")).params).toEqual({});
    expect(adminSeatingFailure(new Error("seats_in_use: 3 assigned")).params).toEqual({ count: 3 });
  });

  it("czyta napis, obiekt z `message` i komunikat bez ogona", () => {
    expect(adminSeatingFailure("seat_blocked").key).toBe("adminEventSeating.errors.seatBlocked");
    expect(adminSeatingFailure({ message: "label_taken: x" }).key).toBe("adminEventSeating.errors.labelTaken");
  });

  it("nieznane, sieciowe i puste błędy spadają do zdania zapasowego", () => {
    for (const error of [new Error("Failed to fetch"), new Error("brand_new: x"), null, 42, {}]) {
      expect(adminSeatingFailure(error)).toEqual({ key: "adminEventSeating.errors.unknown", params: {} });
    }
  });

  it("oddaje gotowe zdanie z liczbą, nie klucz", () => {
    const message = adminSeatingErrorMessage(new Error("seats_in_use: 3 assigned seat(s) would be removed"));
    expect(message).not.toContain("adminEventSeating.");
    expect(message).toContain("3");
  });
});

describe("słownik planu sali", () => {
  it("PL i EN mają ten sam zbiór kluczy (poza formami liczby mnogiej)", () => {
    const pl = [...new Set(flatten(adminEventSeatingPl))].sort();
    const en = [...new Set(flatten(adminEventSeatingEn))].sort();
    expect(en).toEqual(pl);
  });
});
