import { describe, expect, it } from "vitest";
import {
  buildAdminNavGroups,
  searchAdminNav,
  adminNavItemKey,
  normalizeSearchText,
  type AdminNavGroup,
} from "@/lib/admin/adminNav";

type TFn = Parameters<typeof buildAdminNavGroups>[0]["t"];
const t = ((key: string) => key) as unknown as TFn;

function build(overrides: Partial<Parameters<typeof buildAdminNavGroups>[0]> = {}) {
  return buildAdminNavGroups({ t, isAdmin: true, isSuperAdmin: true, clubPending: 3, ...overrides });
}

describe("adminNav", () => {
  it("grupuje nawigację i nie duplikuje tras", () => {
    const groups = build();
    const keys = groups.flatMap((g: AdminNavGroup) => g.items.map(adminNavItemKey));
    expect(new Set(keys).size).toBe(keys.length);
    expect(groups.map((g) => g.id)).toContain("crm");
    expect(groups.every((g) => g.id === "overview" || Boolean(g.label))).toBe(true);
  });

  it("ukrywa sekcje systemowe przed nie-adminem", () => {
    const ids = build({ isAdmin: false, isSuperAdmin: false }).map((g) => g.id);
    expect(ids).not.toContain("system");
    expect(ids).not.toContain("analytics");
  });

  it("normalizuje polskie znaki w wyszukiwarce", () => {
    expect(normalizeSearchText("Płatności")).toBe("platnosci");
  });

  it("znajduje pozycje po etykiecie, ścieżce i słowach kluczowych", () => {
    const groups = build();
    expect(searchAdminNav(groups, "admin.nav.posts").length).toBeGreaterThan(0);
    expect(searchAdminNav(groups, "stripe").map((h) => adminNavItemKey(h.item))).toContain(
      "/admin/billing",
    );
    expect(searchAdminNav(groups, "   ")).toEqual([]);
    expect(searchAdminNav(groups, "zzzz-nie-istnieje")).toEqual([]);
  });
});
