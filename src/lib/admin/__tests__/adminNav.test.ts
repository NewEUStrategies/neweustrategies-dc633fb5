import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildAdminNavGroups,
  searchAdminNav,
  adminNavItemKey,
  normalizeSearchText,
  resolveActiveNavTarget,
  type AdminNavGroup,
  type AdminNavItem,
} from "@/lib/admin/adminNav";
import { hubTabsFor } from "@/lib/admin/revenue/hubTabs";
import { REVENUE_TABS, isRevenueTab, parseRevenueHubSearch } from "@/lib/revenue/search";

type TFn = Parameters<typeof buildAdminNavGroups>[0]["t"];
const t = ((key: string) => key) as unknown as TFn;

function build(overrides: Partial<Parameters<typeof buildAdminNavGroups>[0]> = {}) {
  return buildAdminNavGroups({
    t,
    isAdmin: true,
    isSuperAdmin: true,
    clubPending: 3,
    roles: ["super_admin", "admin"],
    ...overrides,
  });
}

/** Role sesji tak, jak podaje je `useAuth` (`isAdmin` liczy też `super_admin`). */
const SESSIONS = {
  admin: { isAdmin: true, isSuperAdmin: false, roles: ["admin"] },
  editor: { isAdmin: false, isSuperAdmin: false, roles: ["editor"] },
  author: { isAdmin: false, isSuperAdmin: false, roles: ["author"] },
  superAdminOnly: { isAdmin: true, isSuperAdmin: true, roles: ["super_admin"] },
} as const;

function itemsOf(groups: AdminNavGroup[], groupId: string): AdminNavItem[] {
  return groups.find((g) => g.id === groupId)?.items ?? [];
}

function routeItem(groups: AdminNavGroup[], to: string) {
  for (const group of groups) {
    for (const item of group.items) if ("to" in item && item.to === to) return item;
  }
  return undefined;
}

/** Pełne ścieżki tras z wygenerowanego drzewa - tekst, nie import. */
const ROUTE_PATHS: ReadonlySet<string> = new Set(
  [...readFileSync("src/routeTree.gen.ts", "utf8").matchAll(/fullPath: '([^']+)'/g)].map((m) =>
    m[1] === "/" ? "/" : m[1].replace(/\/$/, ""),
  ),
);

/** Adres huba trafia w trasę: indeks albo `$tab` ze ZNANĄ zakładką (inaczej 404). */
function hubPathResolves(path: string): boolean {
  if (ROUTE_PATHS.has(path)) return true;
  const tab = /^\/admin\/revenue\/([^/]+)$/.exec(path)?.[1];
  return (
    tab !== undefined &&
    ROUTE_PATHS.has("/admin/revenue/$tab") &&
    isRevenueTab(tab) &&
    tab !== "overview"
  );
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
    const ids = build(SESSIONS.editor).map((g) => g.id);
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

// ---------------------------------------------------------------------------
// Hub „Przychód i lejek" w nawigacji (I9a, 2026-10-20; SPEC §2.4, §2.5)
// ---------------------------------------------------------------------------

describe("hub „Przychód i lejek” - pozycje paska bocznego", () => {
  it.each(["admin", "editor"] as const)(
    "%s: hub jest PIERWSZĄ pozycją monetyzacji, Ścieżki stoją w CRM zaraz po automatyzacjach",
    (session) => {
      const groups = build(SESSIONS[session]);
      expect(itemsOf(groups, "monetization")[0]).toMatchObject({
        to: "/admin/revenue",
        label: "admin.nav.revenueHub",
      });
      const crm = itemsOf(groups, "crm").map(adminNavItemKey);
      expect(crm.indexOf("/admin/revenue/journeys")).toBe(crm.indexOf("/admin/workflows") + 1);
      expect(routeItem(groups, "/admin/revenue/journeys")?.label).toBe("admin.nav.journeys");
    },
  );

  it.each(["author", "superAdminOnly"] as const)(
    "%s: brak pozycji huba - pozycja = dostęp do trasy (hub dałby RoleGateNotice)",
    (session) => {
      const groups = build(SESSIONS[session]);
      expect(routeItem(groups, "/admin/revenue")).toBeUndefined();
      expect(routeItem(groups, "/admin/revenue/journeys")).toBeUndefined();
      // Reszta monetyzacji zostaje - zmienia się wyłącznie hub.
      expect(routeItem(groups, "/admin/paywall")).toBeDefined();
    },
  );

  it("ikony huba, ścieżek i automatyzacji są różne (zwinięty pasek pokazuje tylko ikonę)", () => {
    const groups = build(SESSIONS.admin);
    const icons = ["/admin/revenue", "/admin/revenue/journeys", "/admin/workflows"].map(
      (to) => routeItem(groups, to)?.icon,
    );
    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(3);
  });

  it("podświetla dokładnie jedną pozycję: zakładki → hub, ścieżki i edytor → Ścieżki", () => {
    const groups = build(SESSIONS.admin);
    expect(resolveActiveNavTarget(groups, "/admin/revenue")).toBe("/admin/revenue");
    expect(resolveActiveNavTarget(groups, "/admin/revenue/mrr")).toBe("/admin/revenue");
    expect(resolveActiveNavTarget(groups, "/admin/revenue/journeys")).toBe(
      "/admin/revenue/journeys",
    );
    expect(resolveActiveNavTarget(groups, "/admin/revenue/journeys/abc")).toBe(
      "/admin/revenue/journeys",
    );
  });
});

describe("hub „Przychód i lejek” - skróty ⌘K do zakładek", () => {
  const tabPath = (tab: string) =>
    tab === "overview" ? "/admin/revenue" : `/admin/revenue/${tab}`;

  /** Skróty do zakładek - bez akcji z parametrem (`?new=1`), które idą osobno. */
  const tabEntries = (groups: AdminNavGroup[]) =>
    (routeItem(groups, "/admin/revenue")?.searchEntries ?? []).filter((e) => !e.search);
  const newJourneyEntries = (groups: AdminNavGroup[]) =>
    (routeItem(groups, "/admin/revenue")?.searchEntries ?? []).filter(
      (e) => e.search?.new === "1",
    );

  it("admin: skrót do KAŻDEJ z 11 zakładek (kokpit = indeks huba), w kolejności paska", () => {
    const entries = tabEntries(build(SESSIONS.admin));
    expect(entries.map((e) => e.to)).toEqual(REVENUE_TABS.map(tabPath));
    expect(entries.map((e) => e.label)).toEqual(
      REVENUE_TABS.map((tab) => `admin.nav.revenueTabs.${tab}`),
    );
    expect(entries.every((e) => (e.keywords ?? []).length > 0)).toBe(true);
  });

  it("redaktor: te same zakładki co pasek huba - bez Przychodu, Retencji i Danych wejściowych", () => {
    const entries = tabEntries(build(SESSIONS.editor));
    const targets = entries.map((e) => e.to);
    expect(targets).toEqual(hubTabsFor(["editor"]).map((spec) => tabPath(spec.id)));
    for (const tab of ["mrr", "retention", "inputs"]) {
      expect(targets).not.toContain(tabPath(tab));
    }
  });

  it("każdy skrót i pozycja huba trafiają w istniejącą trasę (bez 404)", () => {
    const groups = build(SESSIONS.admin);
    const targets = [
      ...(routeItem(groups, "/admin/revenue")?.searchEntries ?? []).map((e) => e.to),
      "/admin/revenue",
      "/admin/revenue/journeys",
    ];
    for (const to of targets) expect(hubPathResolves(to), to).toBe(true);
  });

  it("„churn” prowadzi admina do Retencji, z nazwą huba jako etykietą trafienia", () => {
    const hits = searchAdminNav(build(SESSIONS.admin), "churn");
    const retention = hits.find((h) => adminNavItemKey(h.item) === "/admin/revenue/retention");
    expect(retention?.groupLabel).toBe("admin.nav.revenueHub");
    expect(retention?.item.label).toBe("admin.nav.revenueTabs.retention");
  });

  it("redaktor nie dostaje skrótu do zakładek z kwotami, ale znajduje hub", () => {
    const keys = searchAdminNav(build(SESSIONS.editor), "churn").map((h) =>
      adminNavItemKey(h.item),
    );
    expect(keys).not.toContain("/admin/revenue/retention");
    expect(keys).toContain("/admin/revenue");
  });

  it("autor nie dostaje żadnego trafienia w hubie", () => {
    const keys = searchAdminNav(build(SESSIONS.author), "churn").map((h) =>
      adminNavItemKey(h.item),
    );
    expect(keys.filter((k) => k.startsWith("/admin/revenue"))).toEqual([]);
  });

  it("skróty nie dopasowują się po nazwie grupy (brak zalewu jedenastoma zakładkami)", () => {
    const hubTabHits = searchAdminNav(build(SESSIONS.admin), "admin.navGroups.monetization").filter(
      (h) => adminNavItemKey(h.item).startsWith("/admin/revenue/"),
    );
    expect(hubTabHits).toEqual([]);
  });

  it("jeden cel = jedno trafienie (Ścieżki z huba i z CRM to ten sam adres)", () => {
    const keys = searchAdminNav(build(SESSIONS.admin), "journeys").map((h) =>
      adminNavItemKey(h.item),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k === "/admin/revenue/journeys")).toHaveLength(1);
  });

  // Integrator S8 (2026-10-22): zakładka Ścieżek obsługuje `?new=1` (galeria
  // szablonów z kreatorem - RevenueJourneysTab.test), więc skrót nie obiecuje
  // już martwej akcji. Ta sama bramka co zakładka: admin i redaktor, autor nie.
  it.each(["admin", "editor"] as const)(
    "%s: „Nowa ścieżka” prowadzi do galerii szablonów (`?new=1`)",
    (session) => {
      const entries = newJourneyEntries(build(SESSIONS[session]));
      expect(entries).toEqual([
        {
          to: "/admin/revenue/journeys",
          search: { new: "1" },
          label: "admin.nav.newJourney",
          keywords: ["nowa sciezka", "new journey", "szablon"],
        },
      ]);
      // Parametr przechodzi walidację adresu huba (ten sam parser co trasa).
      expect(parseRevenueHubSearch({ ...entries[0].search }).new).toBe("1");
      expect(hubPathResolves(entries[0].to)).toBe(true);
    },
  );

  it("autor i sam super_admin nie dostają skrótu „Nowa ścieżka”", () => {
    expect(newJourneyEntries(build(SESSIONS.author))).toEqual([]);
    expect(newJourneyEntries(build(SESSIONS.superAdminOnly))).toEqual([]);
  });

  it("„nowa sciezka” w ⌘K trafia w akcję, a „journeys” dalej w jedną zakładkę", () => {
    const groups = build(SESSIONS.editor);
    const keys = searchAdminNav(groups, "nowa sciezka").map((h) => adminNavItemKey(h.item));
    expect(keys).toContain("/admin/revenue/journeys?new=1");
    const tabHits = searchAdminNav(groups, "journeys")
      .map((h) => adminNavItemKey(h.item))
      .filter((k) => k === "/admin/revenue/journeys");
    expect(tabHits).toHaveLength(1);
  });

  it("klucz pozycji rozróżnia ten sam adres z innym `search`", () => {
    const icon = routeItem(build(SESSIONS.admin), "/admin/revenue")!.icon;
    expect(adminNavItemKey({ to: "/admin/paywall", icon, label: "x" })).toBe("/admin/paywall");
    expect(
      adminNavItemKey({ to: "/admin/paywall", search: { tab: "checkout" }, icon, label: "x" }),
    ).toBe("/admin/paywall?tab=checkout");
  });
});
