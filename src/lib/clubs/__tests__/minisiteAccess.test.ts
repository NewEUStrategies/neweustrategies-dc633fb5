import { describe, expect, it } from "vitest";
import {
  CLUB_MINISITE_TIER_RANK,
  resolveClubMinisiteAccess,
  showsClubMinisiteContent,
  type ClubMinisiteAccessInput,
} from "../minisiteAccess";

const base: ClubMinisiteAccessInput = {
  canRead: true,
  myStatus: null,
  hasInvitation: false,
  tierRank: 0,
  isStaff: false,
};

describe("resolveClubMinisiteAccess", () => {
  it("staff widzi minisite nawet bez odczytu z bazy", () => {
    expect(resolveClubMinisiteAccess({ ...base, canRead: false, isStaff: true })).toBe("member");
  });

  it("brak odczytu z bazy bije plan i zaproszenie", () => {
    expect(
      resolveClubMinisiteAccess({
        ...base,
        canRead: false,
        hasInvitation: true,
        tierRank: CLUB_MINISITE_TIER_RANK,
      }),
    ).toBe("no_read");
  });

  it("czlonkostwo bije brak planu", () => {
    expect(resolveClubMinisiteAccess({ ...base, myStatus: "active", tierRank: 0 })).toBe("member");
  });

  it("zaproszenie bije brak planu", () => {
    expect(resolveClubMinisiteAccess({ ...base, hasInvitation: true })).toBe("invited");
  });

  it("plan Pro+ wystarcza", () => {
    expect(resolveClubMinisiteAccess({ ...base, tierRank: CLUB_MINISITE_TIER_RANK })).toBe(
      "entitled",
    );
  });

  it("ponizej progu i bez zaproszenia - locked", () => {
    expect(resolveClubMinisiteAccess({ ...base, tierRank: CLUB_MINISITE_TIER_RANK - 1 })).toBe(
      "locked",
    );
  });

  it("nieznana ranga planu nie odblokowuje", () => {
    expect(resolveClubMinisiteAccess({ ...base, tierRank: null })).toBe("locked");
  });

  it("tresc rysuje sie tylko dla przepustek", () => {
    expect(showsClubMinisiteContent("member")).toBe(true);
    expect(showsClubMinisiteContent("invited")).toBe(true);
    expect(showsClubMinisiteContent("entitled")).toBe(true);
    expect(showsClubMinisiteContent("locked")).toBe(false);
    expect(showsClubMinisiteContent("no_read")).toBe(false);
  });
});
