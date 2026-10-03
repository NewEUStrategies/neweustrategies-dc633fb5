// Kopia zaproszenia (e-mail + jego podgląd) żyje POZA słownikami i18next, bo
// renderuje się na serwerze bez instancji i18n. Bramki parytetu słowników jej
// nie widzą - ten plik jest jej jedyną siatką: oba języki muszą mieć te same
// klucze i prawdziwe (niepuste, przetłumaczone) napisy, bo brakujący klucz
// w szablonie e-maila wychodzi do odbiorcy jako `undefined`.
import { describe, expect, it } from "vitest";
import { invitationCopy } from "../invitation";

describe("invitationCopy - parytet PL/EN", () => {
  it("oferuje dokładnie oba języki serwisu", () => {
    expect(Object.keys(invitationCopy).sort()).toEqual(["en", "pl"]);
  });

  it("oba języki mają identyczny zestaw kluczy", () => {
    expect(Object.keys(invitationCopy.en).sort()).toEqual(Object.keys(invitationCopy.pl).sort());
  });

  it.each(Object.keys(invitationCopy.pl) as (keyof typeof invitationCopy.pl)[])(
    "%s: niepusty napis w obu językach, EN przetłumaczone (różne od PL)",
    (key) => {
      const pl = invitationCopy.pl[key];
      const en = invitationCopy.en[key];
      expect(pl.trim()).not.toBe("");
      expect(en.trim()).not.toBe("");
      expect(en).not.toBe(pl);
    },
  );
});
