// Walidacja szkicu PAKIETU GRUPOWEGO.
//
// Sprawdzamy dokładnie te warunki, których odmowa wraca z bazy jako `23514` bez
// nazwy kolumny - gdyby przestały być wychwytywane tutaj, organizator dostałby
// „coś poszło nie tak" bez wskazania pola.
import { describe, expect, it } from "vitest";
import {
  emptyPackageDraft,
  packageDraftIssue,
  packageDraftToInput,
  type PackageDraft,
} from "@/lib/events/packageDraft";

const EVENT = "11111111-2222-3333-4444-555555555555";
const TICKET = "66666666-7777-8888-9999-000000000000";

function valid(overrides: Partial<PackageDraft> = {}): PackageDraft {
  return {
    ...emptyPackageDraft(100),
    key: "delegacja_10",
    ticketTypeId: TICKET,
    namePl: "Delegacja 10",
    nameEn: "Delegation 10",
    ...overrides,
  };
}

describe("packageDraftIssue", () => {
  it("przepuszcza poprawny szkic", () => {
    expect(packageDraftIssue(valid())).toBeNull();
  });

  it("wymaga klucza we wzorcu tylko dla nowego pakietu", () => {
    expect(packageDraftIssue(valid({ key: "10 Delegacja" }))?.field).toBe("key");
    // Przy edycji klucz jest zamrożony, więc jego treść nie blokuje zapisu.
    expect(packageDraftIssue(valid({ id: "abc", key: "10 Delegacja" }))).toBeNull();
  });

  it("wymaga wskazania biletu", () => {
    expect(packageDraftIssue(valid({ ticketTypeId: "" }))?.errorKey).toBe("packageTicketRequired");
  });

  it("odrzuca pakiet bez miejsc i ponad limitem", () => {
    expect(packageDraftIssue(valid({ seats: "0" }))?.field).toBe("seats");
    expect(packageDraftIssue(valid({ seats: "1001" }))?.field).toBe("seats");
    expect(packageDraftIssue(valid({ seats: "1" }))).toBeNull();
  });

  it("odrzuca okno sprzedaży kończące się przed startem", () => {
    const issue = packageDraftIssue(
      valid({ salesFrom: "2026-05-10T10:00", salesTo: "2026-05-09T10:00" }),
    );
    expect(issue?.errorKey).toBe("packageSalesWindow");
  });
});

describe("packageDraftToInput", () => {
  it("zamienia pustą pulę na brak limitu, a nie na zero", () => {
    const input = packageDraftToInput(valid({ quota: "" }), EVENT);
    expect(input.quota).toBeNull();
    expect(packageDraftToInput(valid({ quota: "0" }), EVENT).quota).toBe(0);
  });

  it("przycina nazwy i przenosi wydarzenie", () => {
    const input = packageDraftToInput(valid({ namePl: "  Delegacja  " }), EVENT);
    expect(input.namePl).toBe("Delegacja");
    expect(input.eventId).toBe(EVENT);
    expect(input.seats).toBe(5);
  });
});
