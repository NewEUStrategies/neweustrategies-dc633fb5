// Kontrakt adresu skrzynki zapytań do ekspertów. Powiadomienie z bazy buduje
// ten link „na sucho" (string w SQL), więc walidator po stronie klienta jest
// jedynym miejscem, w którym rozjazd wychodzi na jaw.
import { describe, expect, it } from "vitest";
import { validateExpertRequestsSearch } from "../expertRequestsSearch";

const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("validateExpertRequestsSearch", () => {
  it("przyjmuje obie skrzynki", () => {
    expect(validateExpertRequestsSearch({ box: "received" })).toEqual({ box: "received" });
    expect(validateExpertRequestsSearch({ box: "sent" })).toEqual({ box: "sent" });
  });

  it("odrzuca skrzynkę spoza słownika zamiast przepuszczać ją do RPC", () => {
    expect(validateExpertRequestsSearch({ box: "archiwum" })).toEqual({});
    expect(validateExpertRequestsSearch({ box: 7 })).toEqual({});
  });

  it("przyjmuje identyfikator zapytania i normalizuje go do małych liter", () => {
    expect(validateExpertRequestsSearch({ r: UUID.toUpperCase() })).toEqual({ r: UUID });
    expect(validateExpertRequestsSearch({ r: `  ${UUID}  ` })).toEqual({ r: UUID });
  });

  it("odrzuca identyfikator, który nie jest UUID-em", () => {
    for (const value of ["../../admin", "1", "", "'; drop table --", UUID.slice(0, -1)]) {
      expect(validateExpertRequestsSearch({ r: value })).toEqual({});
    }
  });

  it("nie dokłada kluczy bez wartości (czysty link do skopiowania)", () => {
    expect(Object.keys(validateExpertRequestsSearch({}))).toEqual([]);
    expect(Object.keys(validateExpertRequestsSearch({ box: "sent" }))).toEqual(["box"]);
  });

  it("ignoruje parametry spoza kontraktu", () => {
    expect(validateExpertRequestsSearch({ box: "sent", r: UUID, utm_source: "mail" })).toEqual({
      box: "sent",
      r: UUID,
    });
  });

  it("odtwarza dokładnie linki produkowane przez trigger powiadomień", () => {
    // /profile/expert-requests?box=received&r=<id>  (nowe zapytanie u eksperta)
    expect(validateExpertRequestsSearch({ box: "received", r: UUID })).toEqual({
      box: "received",
      r: UUID,
    });
    // /profile/expert-requests?box=sent&r=<id>      (decyzja u nadawcy)
    expect(validateExpertRequestsSearch({ box: "sent", r: UUID })).toEqual({
      box: "sent",
      r: UUID,
    });
  });
});
