// Odmowy bazy ekranu lejka -> komunikat i18n (`adminAdsFunnelErrors.ts`).
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. ODMOWA WSADU KOSZTOW BEZ NUMERU WIERSZA - organizator nie wie, ktory
//      z 300 dni poprawic (`{{count}}` z ogona komunikatu).
//   2. NIEZNANY KOD POKAZUJE SUROWY KLUCZ albo SQLSTATE zamiast zdania.
//   3. BLAD W INNYM KSZTALCIE (napis, obiekt Postgrest, nic) wywraca mape.
// Pelna lista kodow z migracji jest pilnowana w `eventErrorMapsI18n.gate.test.ts`.
import { describe, expect, it } from "vitest";
import "@/test/i18nReal";

import i18n from "@/lib/i18n";
import {
  adminAdsFunnelErrorMessage,
  adminAdsFunnelFailure,
} from "@/lib/events/adminAdsFunnelErrors";
import { adminEventAdsFunnelPl } from "@/lib/i18n-admin-event-ads-funnel";

const PL = adminEventAdsFunnelPl.adminEventAdsFunnel.errors;

describe("adminAdsFunnelFailure", () => {
  it("glowa komunikatu -> klucz camelCase, numer wiersza -> {{count}}", () => {
    expect(adminAdsFunnelFailure(new Error("invalid_cost_row: row 7 is invalid"))).toEqual({
      key: "adminEventAdsFunnel.errors.invalidCostRow",
      params: { count: 7 },
    });
    expect(adminAdsFunnelFailure("campaign_exists: already mapped")).toEqual({
      key: "adminEventAdsFunnel.errors.campaignExists",
      params: {},
    });
    expect(adminAdsFunnelFailure({ message: "forbidden" })).toEqual({
      key: "adminEventAdsFunnel.errors.forbidden",
      params: {},
    });
  });

  it("nieznany kod, zla glowa i brak komunikatu -> unknown", () => {
    for (const error of [
      new Error("totally_new_code: x"),
      new Error("23514: violates check constraint"),
      { message: 42 },
      { nie: "komunikat" },
      null,
    ]) {
      expect(adminAdsFunnelFailure(error).key).toBe("adminEventAdsFunnel.errors.unknown");
    }
  });
});

describe("adminAdsFunnelErrorMessage", () => {
  it("gotowe zdanie z numerem wiersza w jezyku panelu", async () => {
    await i18n.changeLanguage("pl");
    expect(adminAdsFunnelErrorMessage(new Error("duplicate_cost_day: row 3 repeats a day"))).toBe(
      PL.duplicateCostDay.replace("{{count}}", "3"),
    );
    expect(adminAdsFunnelErrorMessage(new Error("xyz"))).toBe(PL.unknown);
  });
});
