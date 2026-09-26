// Mapa odmów KLONU EDYCJI - głowa plpgsql -> zdanie.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. SUROWY KOMUNIKAT BAZY NA EKRANIE. Odmowa bez rozpoznanej głowy ma dać
//      zdanie awaryjne, a nie `violates check constraint` albo pusty toast.
//   2. LICZBA SESJI ZGUBIONA. `clone_sessions_outside_window: 3 session(s)`
//      niesie liczbę w ogonie - bez niej organizator nie wie, ile sesji ucina.
//   3. BŁĄD W INNYM KSZTAŁCIE. PostgREST oddaje obiekt `{message}`, testy
//      i sieć - `Error`, starszy kod - napis. Wszystkie trzy mają dać to samo.
import { describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";
import { ensureCloneI18n } from "@/lib/i18n-admin-event-clone";
import { adminCloneErrorMessage, adminCloneFailure } from "@/lib/events/adminCloneErrors";

describe("adminCloneFailure", () => {
  it("rozpoznaje głowę w Error, w obiekcie {message} i w napisie", () => {
    const expected = { key: "adminEventClone.errors.slugTaken", params: {} };
    expect(adminCloneFailure(new Error("slug_taken: another event already uses this address"))).toEqual(expected);
    expect(adminCloneFailure({ message: "slug_taken: another event" })).toEqual(expected);
    expect(adminCloneFailure("slug_taken")).toEqual(expected);
  });

  it("liczba z ogona trafia do interpolacji", () => {
    expect(
      adminCloneFailure(new Error("clone_sessions_outside_window: 3 session(s) would fall outside")),
    ).toEqual({ key: "adminEventClone.errors.cloneSessionsOutsideWindow", params: { count: 3 } });
  });

  it("głowa nieznana, niepoprawna albo brak wiadomości -> zdanie awaryjne", () => {
    const fallback = { key: "adminEventClone.errors.unknown", params: {} };
    expect(adminCloneFailure(new Error("nieznany_kod: cos"))).toEqual(fallback);
    expect(adminCloneFailure(new Error('duplicate key value violates unique constraint "x"'))).toEqual(fallback);
    expect(adminCloneFailure(42)).toEqual(fallback);
    expect(adminCloneFailure(null)).toEqual(fallback);
  });
});

describe("adminCloneErrorMessage", () => {
  it("oddaje gotowe zdanie z liczbą, a nie klucz", async () => {
    ensureCloneI18n();
    await i18n.changeLanguage("pl");
    const message = adminCloneErrorMessage(new Error("clone_sessions_outside_window: 4 session(s)"));
    expect(message).toContain("4");
    expect(message).not.toContain("adminEventClone");
    await i18n.changeLanguage("en");
    expect(adminCloneErrorMessage(new Error("forbidden: admin role required"))).toBe(
      "Copying events is available to administrators only.",
    );
    await i18n.changeLanguage("pl");
  });
});
