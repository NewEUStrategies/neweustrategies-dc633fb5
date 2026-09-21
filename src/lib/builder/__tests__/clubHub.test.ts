// Model widgetu „Klub: strona": limity, daty, skróty i inicjały.
//
// Test pilnuje wlasnosci, ktore w komponencie byloby widac dopiero na produkcji:
// limit spoza widelek nie moze przejsc do RPC, data nie moze przeskoczyc doby
// przez strefe serwera SSR, a skrot nie moze urwac slowa w polowie.
import { describe, expect, it } from "vitest";
import {
  CLUB_HUB_DEFAULTS,
  CLUB_HUB_LIMIT_MAX,
  CLUB_HUB_LIMIT_MIN,
  CLUB_HUB_SECTIONS,
  clubHubDateAttr,
  clubHubExcerpt,
  clubHubInitials,
  clubHubLimit,
  formatClubHubDate,
} from "@/lib/builder/clubHub";

describe("clubHub - sekcje", () => {
  it("ma dokladnie trzy sekcje w kolejnosci strony klubu", () => {
    expect([...CLUB_HUB_SECTIONS]).toEqual(["articles", "comments", "signups"]);
  });
});

describe("clubHubLimit", () => {
  it("przycina do widelek", () => {
    expect(clubHubLimit(0, 4)).toBe(4);
    expect(clubHubLimit(-3, 4)).toBe(4);
    expect(clubHubLimit(99, 4)).toBe(CLUB_HUB_LIMIT_MAX);
    expect(clubHubLimit(1, 4)).toBe(CLUB_HUB_LIMIT_MIN);
    expect(clubHubLimit(Number.NaN, 6)).toBe(6);
  });

  it("zaokragla wartosci ulamkowe", () => {
    expect(clubHubLimit(3.6, 4)).toBe(4);
  });

  it("domyslne limity mieszcza sie w widelkach", () => {
    for (const value of [
      CLUB_HUB_DEFAULTS.articlesLimit,
      CLUB_HUB_DEFAULTS.commentsLimit,
      CLUB_HUB_DEFAULTS.signupsLimit,
    ]) {
      expect(clubHubLimit(value, 1)).toBe(value);
    }
  });
});

describe("formatClubHubDate / clubHubDateAttr", () => {
  it("formatuje date w jezyku widoku", () => {
    expect(formatClubHubDate("2026-03-04T22:30:00Z", "pl")).toBe("4 marca 2026");
    expect(formatClubHubDate("2026-03-04T22:30:00Z", "en")).toBe("4 Mar 2026");
  });

  it("puste i bledne wartosci daja pusty napis", () => {
    expect(formatClubHubDate(null, "pl")).toBe("");
    expect(formatClubHubDate("  ", "en")).toBe("");
    expect(formatClubHubDate("kiedys", "pl")).toBe("");
    expect(clubHubDateAttr("kiedys")).toBe("");
    expect(clubHubDateAttr(null)).toBe("");
  });

  it("atrybut datetime jest maszynowy", () => {
    expect(clubHubDateAttr("2026-03-04T22:30:00Z")).toBe("2026-03-04T22:30:00.000Z");
  });
});

describe("clubHubExcerpt", () => {
  it("splaszcza biale znaki", () => {
    expect(clubHubExcerpt("Pierwsze\n\n  zdanie")).toBe("Pierwsze zdanie");
  });

  it("nie dokleja wielokropka, gdy tekst sie miesci", () => {
    expect(clubHubExcerpt("krotko", 20)).toBe("krotko");
  });

  it("tnie na granicy slowa i konczy wielokropkiem", () => {
    const out = clubHubExcerpt("alfa beta gamma delta", 12);
    expect(out).toBe("alfa beta…");
  });

  it("tnie twardo, gdy slowo jest dluzsze niz limit", () => {
    expect(clubHubExcerpt("abcdefghijklmnop", 5)).toBe("abcde…");
  });
});

describe("clubHubInitials", () => {
  it("bierze dwie pierwsze litery imienia i nazwiska", () => {
    expect(clubHubInitials("Anna Kowalska")).toBe("AK");
    expect(clubHubInitials("  jan   nowak  kowalski ")).toBe("JN");
  });

  it("pusty tekst daje znak zapytania", () => {
    expect(clubHubInitials("   ")).toBe("?");
  });
});
