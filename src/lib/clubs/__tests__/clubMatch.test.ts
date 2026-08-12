import { describe, expect, it } from "vitest";
import {
  normalizeClubText,
  rankClubs,
  scoreClubMatch,
  tokenizeClubQuery,
} from "@/lib/clubs/clubMatch";

const club = (over: Partial<Parameters<typeof scoreClubMatch>[0]> = {}) => ({
  slug: "bezpieczenstwo-europy",
  name_pl: "Bezpieczeństwo Europy Środkowo-Wschodniej",
  name_en: "Central and Eastern European Security",
  tagline_pl: "Wątki o odstraszaniu i odporności",
  tagline_en: "Threads on deterrence and resilience",
  policy_area: "geopolitics",
  ...over,
});

describe("clubMatch", () => {
  it("normalizuje diakrytyki i wielkość liter", () => {
    expect(normalizeClubText("Środkowo-Wschodniej  ŁÓDŹ")).toBe("srodkowo-wschodniej lodz");
  });

  it("tnie zapytanie na tokeny", () => {
    expect(tokenizeClubQuery("  bezp  europy-srodkowej ")).toEqual(["bezp", "europy", "srodkowej"]);
  });

  it("dopasowuje po części nazwy bez diakrytyków", () => {
    expect(scoreClubMatch(club(), tokenizeClubQuery("bezp"))).toBeGreaterThan(0);
    expect(scoreClubMatch(club(), tokenizeClubQuery("srodkowo"))).toBeGreaterThan(0);
  });

  it("wymaga trafienia KAŻDEGO tokenu", () => {
    expect(scoreClubMatch(club(), tokenizeClubQuery("bezp transport"))).toBe(0);
    expect(scoreClubMatch(club(), tokenizeClubQuery("bezp europy"))).toBeGreaterThan(0);
  });

  it("nie zależy od kolejności tokenów", () => {
    const a = scoreClubMatch(club(), tokenizeClubQuery("europy bezp"));
    const b = scoreClubMatch(club(), tokenizeClubQuery("bezp europy"));
    expect(a).toBe(b);
  });

  it("trafienie w nazwę waży więcej niż w opis", () => {
    const byName = scoreClubMatch(club(), tokenizeClubQuery("bezpieczenstwo"));
    const byTagline = scoreClubMatch(club(), tokenizeClubQuery("odpornosci"));
    expect(byName).toBeGreaterThan(byTagline);
  });

  it("sortuje wyniki według trafności", () => {
    const rows = [
      club({ slug: "energia", name_pl: "Energetyka i odporność", name_en: "Energy" }),
      club(),
    ];
    const ranked = rankClubs(rows, "energ");
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.slug).toBe("energia");

    const both = rankClubs([club(), rows[0]!], "odpornosc");
    expect(both.map((c) => c.slug)).toEqual(["energia", "bezpieczenstwo-europy"]);
  });

  it("puste zapytanie zwraca całą listę", () => {
    expect(rankClubs([club()], "   ")).toHaveLength(1);
  });
});
