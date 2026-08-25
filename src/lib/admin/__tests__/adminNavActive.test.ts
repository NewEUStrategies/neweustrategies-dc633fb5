import { describe, expect, it } from "vitest";
import { CalendarDays } from "@/lib/lucide-shim";
import {
  navItemMatchesPath,
  resolveActiveNavTarget,
  type AdminNavGroup,
} from "@/lib/admin/adminNav";

const groups: AdminNavGroup[] = [
  {
    id: "events",
    items: [
      { to: "/admin/events", icon: CalendarDays, label: "Wydarzenia" },
      { to: "/admin/events/types", icon: CalendarDays, label: "Wydarzenia - rodzaje" },
      { to: "/admin/community", icon: CalendarDays, label: "Społeczność" },
      { to: "/admin/community/clubs", icon: CalendarDays, label: "Kluby" },
      { href: "https://example.test", icon: CalendarDays, label: "Zewnętrzny" },
    ],
  },
];

describe("resolveActiveNavTarget - jedna pomarańczowa pozycja w sidebarze", () => {
  it("na podtrasie wygrywa najdłuższe dopasowanie, nie pozycja nadrzędna", () => {
    expect(resolveActiveNavTarget(groups, "/admin/events/types")).toBe("/admin/events/types");
  });

  it("na trasie nadrzędnej świeci się pozycja nadrzędna", () => {
    expect(resolveActiveNavTarget(groups, "/admin/events")).toBe("/admin/events");
  });

  it("skrót do klubów nie podświetla Społeczności", () => {
    expect(resolveActiveNavTarget(groups, "/admin/community/clubs")).toBe("/admin/community/clubs");
    expect(navItemMatchesPath("/admin/community", "/admin/community/clubs")).toBe(false);
  });

  it("nieznana trasa nie podświetla niczego", () => {
    expect(resolveActiveNavTarget(groups, "/admin/nieistnieje")).toBeNull();
  });

  it("pulpit /admin nie podświetla się na podtrasach", () => {
    expect(navItemMatchesPath("/admin", "/admin/events")).toBe(false);
  });
});
