// Sygnał "coś nowego" liczy się z DWÓCH kolumn, których nikt dotąd nie
// zestawił. Najciekawsze są tu brzegi: brak wizyty, brak aktywności i klub
// pusty - bo to one decydują, czy kropka miga bez powodu.
import { describe, expect, it } from "vitest";
import { hasUnseenActivity, sortMemberships, toMembershipSignals } from "../membershipSignals";
import type { ClubMembershipRow } from "../types";

function row(over: Partial<ClubMembershipRow> & { slug: string }): ClubMembershipRow {
  return {
    accent_color: null,
    club_id: `id-${over.slug}`,
    icon: null,
    last_activity_at: null,
    last_read_at: null,
    member_count: 1,
    name_en: over.slug,
    name_pl: over.slug,
    notify_level: "all",
    role: "member",
    role_expires_at: null,
    status: "active",
    thread_count: 0,
    ...over,
  } as ClubMembershipRow;
}

describe("hasUnseenActivity", () => {
  it("aktywność po wizycie znaczy nowość", () => {
    expect(
      hasUnseenActivity({
        last_activity_at: "2026-08-05T10:00:00Z",
        last_read_at: "2026-08-04T10:00:00Z",
      }),
    ).toBe(true);
  });

  it("wizyta po aktywności znaczy przeczytane", () => {
    expect(
      hasUnseenActivity({
        last_activity_at: "2026-08-04T10:00:00Z",
        last_read_at: "2026-08-05T10:00:00Z",
      }),
    ).toBe(false);
  });

  it("ta sama chwila to NIE nowość - inaczej kropka nie gasłaby nigdy", () => {
    expect(
      hasUnseenActivity({
        last_activity_at: "2026-08-05T10:00:00Z",
        last_read_at: "2026-08-05T10:00:00Z",
      }),
    ).toBe(false);
  });

  it("pusty klub nie miga, mimo braku wizyty", () => {
    expect(hasUnseenActivity({ last_activity_at: null, last_read_at: null })).toBe(false);
  });

  it("brak wizyty przy istniejącej aktywności to nowość", () => {
    expect(
      hasUnseenActivity({ last_activity_at: "2026-08-05T10:00:00Z", last_read_at: null }),
    ).toBe(true);
  });

  it("niepoprawny znacznik czasu nie wywraca sygnału", () => {
    expect(hasUnseenActivity({ last_activity_at: "nie-data", last_read_at: null })).toBe(false);
    expect(
      hasUnseenActivity({ last_activity_at: "2026-08-05T10:00:00Z", last_read_at: "nie-data" }),
    ).toBe(true);
  });
});

describe("sortMemberships", () => {
  it("nowości na górze, potem po ostatniej aktywności", () => {
    const out = sortMemberships([
      row({
        slug: "stary",
        last_activity_at: "2026-08-01T00:00:00Z",
        last_read_at: "2026-08-02T00:00:00Z",
      }),
      row({
        slug: "nowy",
        last_activity_at: "2026-08-03T00:00:00Z",
        last_read_at: "2026-08-01T00:00:00Z",
      }),
      row({
        slug: "swiezy",
        last_activity_at: "2026-08-09T00:00:00Z",
        last_read_at: "2026-08-10T00:00:00Z",
      }),
    ]);
    expect(out.map((r) => r.slug)).toEqual(["nowy", "swiezy", "stary"]);
  });

  it("remis rozstrzyga slug - lista nie skacze między refetchami", () => {
    const same = { last_activity_at: "2026-08-05T00:00:00Z", last_read_at: "2026-08-06T00:00:00Z" };
    const out = sortMemberships([row({ slug: "beta", ...same }), row({ slug: "alfa", ...same })]);
    expect(out.map((r) => r.slug)).toEqual(["alfa", "beta"]);
  });

  it("nie mutuje wejścia", () => {
    const input = [row({ slug: "b" }), row({ slug: "a" })];
    sortMemberships(input);
    expect(input.map((r) => r.slug)).toEqual(["b", "a"]);
  });
});

describe("toMembershipSignals", () => {
  it("mapuje na trójkę id/slug/flaga", () => {
    expect(
      toMembershipSignals([row({ slug: "x", last_activity_at: "2026-08-05T00:00:00Z" })]),
    ).toEqual([{ clubId: "id-x", slug: "x", hasUnseen: true }]);
  });
});
