// Mapowanie wyjątków bazy na kody słownikowe interfejsu.
//
// Sedno: użytkownik NIGDY nie widzi tekstu wyjątku z Postgresa. Baza rzuca
// "clubs: invite quota exceeded" po angielsku, a interfejs musi z tego złożyć
// polskie zdanie mówiące, co zrobić. Test pilnuje, że każdy komunikat
// rzucany przez migrację A2 ma swój kod - bo brak dopasowania oznacza, że
// użytkownik dostanie ogólne "nie udało się zapisać" zamiast konkretu.
import { describe, expect, it } from "vitest";
import { CLUB_INVITE_ERRORS, toClubInviteError } from "../types";

/** Dokładne komunikaty rzucane przez 20260808092000_..._a2_invitations.sql. */
const DB_MESSAGES: ReadonlyArray<[string, string]> = [
  ["clubs: invite quota exceeded", "quota_exceeded"],
  ["clubs: already a member", "already_member"],
  ["clubs: recently declined", "recently_declined"],
  ["clubs: user not available", "user_unavailable"],
  ["clubs: elevated role requires admin", "elevated_role"],
  ["clubs: link expired", "link_expired"],
  ["clubs: link revoked", "link_revoked"],
  ["clubs: link exhausted", "link_exhausted"],
  ["clubs: invitation required", "invitation_required"],
  ["clubs: tier too low", "tier_too_low"],
  ["clubs: banned", "banned"],
];

describe("toClubInviteError", () => {
  it("rozpoznaje każdy komunikat rzucany przez migrację A2", () => {
    for (const [message, expected] of DB_MESSAGES) {
      expect(toClubInviteError(new Error(message)), message).toBe(expected);
    }
  });

  it("pokrywa cały słownik kodów - żaden kod nie jest martwy", () => {
    const mapped = new Set(DB_MESSAGES.map(([, code]) => code));
    for (const code of CLUB_INVITE_ERRORS) {
      expect(mapped.has(code), `kod ${code} nie ma odpowiadającego komunikatu`).toBe(true);
    }
  });

  it("nieznany błąd daje null, a nie zgadywany kod", () => {
    expect(toClubInviteError(new Error("connection reset"))).toBeNull();
    expect(toClubInviteError(new Error(""))).toBeNull();
  });

  it("znosi wartości, które nie są instancją Error", () => {
    expect(toClubInviteError(null)).toBeNull();
    expect(toClubInviteError(undefined)).toBeNull();
    expect(toClubInviteError({ message: "clubs: banned" })).toBeNull();
    // String przechodzi, bo supabase-js potrafi oddać surowy komunikat.
    expect(toClubInviteError("clubs: link expired")).toBe("link_expired");
  });

  // Kolejność dopasowań ma znaczenie: "clubs: banned" jest podciągiem
  // niczego innego, ale gdyby ktoś dodał komunikat go zawierający, ten test
  // złapie zmianę zachowania.
  it("dopasowanie nie myli podobnych komunikatów", () => {
    expect(toClubInviteError(new Error("clubs: link expired"))).toBe("link_expired");
    expect(toClubInviteError(new Error("clubs: link revoked"))).toBe("link_revoked");
    expect(toClubInviteError(new Error("clubs: link exhausted"))).toBe("link_exhausted");
  });
});
