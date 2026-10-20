// Nakładka `i18n-admin-revenue-community` (S4): identyczne drzewo PL/EN, brak
// napisów identycznych w obu językach (prefiks `adminRevenue` jest pod twardą
// bramką parytetu) i etykieta z definicją dla każdej liczby przekrojów.
import { describe, expect, it } from "vitest";
import { revenueCommunityEn, revenueCommunityPl } from "@/lib/i18n-admin-revenue-community";

function leaves(value: unknown, prefix = ""): Array<[string, string]> {
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      leaves(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [[prefix, String(value)]];
}

describe("nakładka społeczności huba", () => {
  it("PL i EN mają identyczne drzewo kluczy", () => {
    expect(
      leaves(revenueCommunityEn)
        .map(([k]) => k)
        .sort(),
    ).toEqual(
      leaves(revenueCommunityPl)
        .map(([k]) => k)
        .sort(),
    );
  });

  it("żaden napis nie jest identyczny w PL i EN (bramka parytetu adminRevenue)", () => {
    const en = new Map(leaves(revenueCommunityEn));
    const same = leaves(revenueCommunityPl).filter(([k, v]) => en.get(k) === v);
    expect(same).toEqual([]);
  });

  it("każda liczba przekrojów ma etykietę i definicję", () => {
    const c = revenueCommunityPl.adminRevenue.community;
    for (const metric of [
      c.events.eventsCount,
      c.events.registrations,
      c.events.attended,
      c.events.noShow,
      c.events.attendanceRate,
      c.events.noShowRate,
      c.events.paid,
      c.events.planPool,
      c.events.revenue,
      c.clubs.clubsCount,
      c.clubs.members,
      c.clubs.activeMembers,
      c.clubs.contributors,
      c.clubs.applications.submitted,
      c.clubs.applications.accepted,
      c.clubs.applications.rejected,
      c.clubs.applications.pending,
      c.clubs.decisionHours,
    ]) {
      expect(metric.label.length).toBeGreaterThan(0);
      expect(metric.hint.length).toBeGreaterThan(10);
    }
  });
});
