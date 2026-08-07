// Bramka miekka strony glownej klubow. Najwazniejszy przypadek nie jest
// "kto wchodzi", tylko "kto NIE dostaje cennika mimo braku planu" - czlonek
// z wygasla subskrypcja i osoba z zaproszeniem.
import { describe, expect, it } from "vitest";
import {
  CLUB_TIER_RANK,
  resolveClubHubAccess,
  showsUpgradePanel,
  type ClubHubAccessInput,
} from "../hubAccess";

const base: ClubHubAccessInput = {
  tierRank: 0,
  activeMemberships: 0,
  pendingInvitations: 0,
  isStaff: false,
};

describe("resolveClubHubAccess", () => {
  it("bez planu, czlonkostwa i zaproszenia zwraca locked", () => {
    expect(resolveClubHubAccess(base)).toBe("locked");
  });

  it("plan Pro wystarcza bez czlonkostwa", () => {
    expect(resolveClubHubAccess({ ...base, tierRank: CLUB_TIER_RANK })).toBe("entitled");
  });

  it("plan ponizej progu nie wystarcza", () => {
    expect(resolveClubHubAccess({ ...base, tierRank: CLUB_TIER_RANK - 1 })).toBe("locked");
  });

  it("zaproszenie wpuszcza mimo braku planu", () => {
    expect(resolveClubHubAccess({ ...base, pendingInvitations: 1 })).toBe("invited");
  });

  it("czlonkostwo bije brak planu - wygasla subskrypcja nie wyrzuca z klubu", () => {
    expect(resolveClubHubAccess({ ...base, tierRank: 0, activeMemberships: 1 })).toBe("member");
  });

  it("czlonkostwo bije zaproszenie - czlonek nie oglada zaproszenia jako stanu glownego", () => {
    expect(resolveClubHubAccess({ ...base, activeMemberships: 1, pendingInvitations: 3 })).toBe(
      "member",
    );
  });

  it("staff jest czlonkiem nawet bez wpisu w club_members", () => {
    expect(resolveClubHubAccess({ ...base, isStaff: true })).toBe("member");
  });

  it("nierozstrzygnieta ranga (null) nie awansuje nikogo", () => {
    expect(resolveClubHubAccess({ ...base, tierRank: null })).toBe("locked");
  });
});

describe("showsUpgradePanel", () => {
  it("panel planu pokazuje sie WYLACZNIE w stanie locked", () => {
    expect(showsUpgradePanel("locked")).toBe(true);
    for (const access of ["member", "invited", "entitled"] as const) {
      expect(showsUpgradePanel(access)).toBe(false);
    }
  });
});
