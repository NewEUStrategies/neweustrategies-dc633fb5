// Mapa odmów raportu dla sponsorów (`adminSponsorReportErrors.ts`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. ORGANIZATOR CZYTA `23514` albo angielski ogon plpgsql zamiast zdania.
//   2. LICZBA Z OGONA NIE TRAFIA DO ZDANIA („najwyżej {{count}} linków").
//   3. NIEZNANY KLUCZ UDAJE ZNANY albo znika bez zdania awaryjnego.
import { describe, expect, it } from "vitest";

import {
  adminSponsorReportErrorMessage,
  adminSponsorReportFailure,
} from "@/lib/events/adminSponsorReportErrors";

describe("adminSponsorReportFailure", () => {
  it("głowa komunikatu -> klucz; liczby z ogona -> count/total", () => {
    expect(
      adminSponsorReportFailure(
        new Error("invalid_label: the label must have 2 to 120 characters"),
      ),
    ).toEqual({
      key: "adminEventSponsorReport.errors.invalidLabel",
      params: { count: 2, total: 120 },
    });
    expect(adminSponsorReportFailure("too_many_links: at most 10 active links")).toEqual({
      key: "adminEventSponsorReport.errors.tooManyLinks",
      params: { count: 10 },
    });
    expect(adminSponsorReportFailure({ message: "forbidden" })).toEqual({
      key: "adminEventSponsorReport.errors.forbidden",
      params: {},
    });
  });

  it("nieznana głowa, zły kształt i brak komunikatu -> zdanie awaryjne", () => {
    const unknown = { key: "adminEventSponsorReport.errors.unknown", params: {} };
    expect(adminSponsorReportFailure(new Error("some_other_code: x"))).toEqual(unknown);
    expect(adminSponsorReportFailure(new Error("23514 violates check constraint"))).toEqual(
      unknown,
    );
    expect(adminSponsorReportFailure(42)).toEqual(unknown);
    expect(adminSponsorReportFailure(null)).toEqual(unknown);
  });

  it("zdanie dla toasta ma liczby i nie jest kluczem", () => {
    const message = adminSponsorReportErrorMessage(
      new Error("too_many_links: at most 10 active links"),
    );
    expect(message).toContain("10");
    expect(message).not.toContain("adminEventSponsorReport");
  });
});
