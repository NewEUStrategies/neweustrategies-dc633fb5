// Zespół „3-20 miejsc" (cennik v6.2, decyzja właściciela 2026-10-20, I9b):
// jedna liczba dla bazy, funkcji serwerowej i panelu.
//
// Baza egzekwuje limit wyzwalaczami (20261020160300, `c_team_max`), panel
// i `setTeamSeatLimit` czytają `TEAM_TIER_MAX_SEATS`. Rozjazd = panel
// pozwala wpisać 21, a baza odrzuca (albo odwrotnie: panel blokuje to, co
// baza przyjmuje). Test czyta migrację jako tekst - bez bazy.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  TEAM_TIER_KEY,
  TEAM_TIER_MAX_SEATS,
  TEAM_TIER_MIN_SEATS,
  isTeamSeatsMaxError,
  organizationTierOptions,
  teamSeatAddBlocked,
  teamSeatLimitRejected,
  teamSeatVerdict,
} from "@/lib/organizations/teamSeats";

const MIGRACJA = "supabase/migrations/20261020160300_team_seat_cap.sql";

describe("parytet limitu Zespołu TS ⇄ SQL", () => {
  const sql = readFileSync(MIGRACJA, "utf8");

  it("oba wyzwalacze deklarują ten sam limit co TEAM_TIER_MAX_SEATS", () => {
    const limity = [...sql.matchAll(/c_team_max CONSTANT integer := (\d+);/g)].map((m) =>
      Number(m[1]),
    );
    expect(limity).toEqual([TEAM_TIER_MAX_SEATS, TEAM_TIER_MAX_SEATS]);
  });

  it("baza rozpoznaje Zespół po tym samym kluczu i odrzuca tym samym komunikatem", () => {
    expect(sql).toContain(`NEW.tier_key = '${TEAM_TIER_KEY}'`);
    expect(sql).toContain(`v_tier IS DISTINCT FROM '${TEAM_TIER_KEY}'`);
    const komunikaty = [...sql.matchAll(/RAISE EXCEPTION '([^']+)'/g)].map((m) => m[1]);
    expect(komunikaty).toEqual(["orgs: team seats max", "orgs: team seats max"]);
    expect(komunikaty.every((m) => isTeamSeatsMaxError(m))).toBe(true);
  });

  it("odrzucenie (23514), nigdy przycięcie limitu", () => {
    expect(sql).toMatch(/ERRCODE = '23514'/);
    expect(sql).not.toMatch(/LEAST\s*\(/i);
  });
});

describe("reguła Zespołu", () => {
  it("v6.2: 3-20 miejsc", () => {
    expect([TEAM_TIER_MIN_SEATS, TEAM_TIER_MAX_SEATS]).toEqual([3, 20]);
  });

  it("ocena liczby miejsc: tylko Zespół ma regułę", () => {
    expect(teamSeatVerdict("team", 20)).toBe("ok");
    expect(teamSeatVerdict("team", 3)).toBe("ok");
    expect(teamSeatVerdict("team", 21)).toBe("above_max");
    expect(teamSeatVerdict("team", 2)).toBe("below_min");
    expect(teamSeatVerdict("corporate", 400)).toBe("ok");
    expect(teamSeatVerdict(null, 1)).toBe("ok");
  });

  it("odrzucenie limitu = lustro wyzwalacza (zakładanie, wejście na Zespół, podniesienie)", () => {
    expect(teamSeatLimitRejected({ tierKey: "team", seatsLimit: 21 }, null)).toBe(true);
    expect(teamSeatLimitRejected({ tierKey: "team", seatsLimit: 20 }, null)).toBe(false);
    expect(
      teamSeatLimitRejected(
        { tierKey: "team", seatsLimit: 25 },
        { tierKey: "corporate", seatsLimit: 25 },
      ),
    ).toBe(true);
    // Organizacja ponad limitem sprzed reguły: zostaje i może obniżać.
    expect(
      teamSeatLimitRejected(
        { tierKey: "team", seatsLimit: 25 },
        { tierKey: "team", seatsLimit: 25 },
      ),
    ).toBe(false);
    expect(
      teamSeatLimitRejected(
        { tierKey: "team", seatsLimit: 22 },
        { tierKey: "team", seatsLimit: 25 },
      ),
    ).toBe(false);
    expect(
      teamSeatLimitRejected(
        { tierKey: "team", seatsLimit: 26 },
        { tierKey: "team", seatsLimit: 25 },
      ),
    ).toBe(true);
    expect(
      teamSeatLimitRejected(
        { tierKey: "corporate", seatsLimit: 60 },
        { tierKey: "team", seatsLimit: 20 },
      ),
    ).toBe(false);
  });

  it("dodawanie blokuje 20 aktywnych - także przy limicie ponad 20", () => {
    expect(teamSeatAddBlocked("team", 19)).toBe(false);
    expect(teamSeatAddBlocked("team", 20)).toBe(true);
    expect(teamSeatAddBlocked("corporate", 20)).toBe(false);
  });

  it("komunikat bazy rozpoznany także w opakowaniu błędu PostgREST", () => {
    expect(isTeamSeatsMaxError("new row violates: orgs: team seats max")).toBe(true);
    expect(isTeamSeatsMaxError("orgs: seats limit reached")).toBe(false);
    expect(isTeamSeatsMaxError(null)).toBe(false);
  });
});

describe("progi organizacyjne w panelu", () => {
  const tier = (key: string, rank: number, features: Record<string, unknown> = {}) => ({
    key,
    rank,
    features,
  });

  it("Zespół (25, corporate_seats) i NGO (40) są do wyboru; Rada (25, bez miejsc) - nie", () => {
    const options = organizationTierOptions([
      tier("member", 10),
      tier("vip", 25),
      tier("team", 25, { corporate_seats: true }),
      tier("corporate", 30, { corporate_seats: true }),
      tier("ngo", 40, { corporate_seats: true }),
      tier("partner", 40, { corporate_seats: true }),
    ]).map((t) => t.key);
    expect(options).toEqual(["team", "corporate", "ngo", "partner"]);
  });

  it("bez progów organizacyjnych (najemca bez seedu) - wszystkie", () => {
    expect(organizationTierOptions([tier("reader", 0), tier("member", 10)])).toHaveLength(2);
  });
});
