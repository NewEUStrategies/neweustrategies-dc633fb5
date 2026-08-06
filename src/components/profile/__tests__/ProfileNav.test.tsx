// Nawigacja profilu: trzy nazwane grupy (tożsamość / treści / płatności),
// stan aktywny wyliczany z adresu oraz warunkowa pozycja „Organizacja".
//
// Testy pilnują dwóch rzeczy trudnych do wyłapania okiem:
//   * „Organizacja" pojawia się WYŁĄCZNIE posiadaczom miejsca w organizacji i
//     zawsze zaraz po „Członkostwie" (kolejność jest częścią IA, nie przypadkiem),
//   * dopasowanie prefiksem nie może podświetlać „Przegląd" (/profile) na
//     każdej podstronie profilu - to była klasyczna pułapka `startsWith`.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  pathname: { current: "/profile" },
  org: { current: null as { org_id: string } | null },
}));

vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    Link: RouterLinkStub,
    useLocation: () => ({ pathname: h.pathname.current }),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "pl" } }),
}));

vi.mock("@/lib/billing/membership", () => ({
  useMyOrganization: () => ({ data: h.org.current }),
}));

import { ProfileNav } from "../ProfileNav";

function linkHrefs(): string[] {
  return screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
}

beforeEach(() => {
  h.pathname.current = "/profile";
  h.org.current = null;
});

describe("ProfileNav", () => {
  it("grupuje pozycje w trzy nazwane sekcje", () => {
    render(<ProfileNav />);
    expect(screen.getByText("profile.navGroups.identity")).toBeInTheDocument();
    expect(screen.getByText("profile.navGroups.content")).toBeInTheDocument();
    expect(screen.getByText("profile.navGroups.finance")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "profile.title" })).toBeInTheDocument();
  });

  it("prowadzi do zapytań do ekspertów, sieci kontaktów i powiadomień", () => {
    render(<ProfileNav />);
    const hrefs = linkHrefs();
    expect(hrefs).toContain("/profile/expert-requests");
    expect(hrefs).toContain("/network");
    expect(hrefs).toContain("/messages");
  });

  it('„Organizacja" jest ukryta bez miejsca w organizacji', () => {
    render(<ProfileNav />);
    expect(linkHrefs()).not.toContain("/profile/organization");
  });

  it('„Organizacja" pojawia się zaraz po „Członkostwie"', () => {
    h.org.current = { org_id: "org-1" };
    render(<ProfileNav />);
    const hrefs = linkHrefs();
    expect(hrefs).toContain("/profile/organization");
    expect(hrefs.indexOf("/profile/organization")).toBe(hrefs.indexOf("/profile/membership") + 1);
  });

  it("oznacza bieżącą stronę atrybutem aria-current", () => {
    h.pathname.current = "/profile/security";
    render(<ProfileNav />);
    const active = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current"));
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute("href", "/profile/security");
  });

  it('„Przegląd" nie świeci się na podstronach profilu (pułapka startsWith)', () => {
    h.pathname.current = "/profile/orders";
    render(<ProfileNav />);
    const overview = screen.getAllByRole("link").find((a) => a.getAttribute("href") === "/profile");
    expect(overview).toBeDefined();
    expect(overview).not.toHaveAttribute("aria-current");
  });

  it("dopasowanie prefiksem obejmuje trasy zagnieżdżone", () => {
    h.pathname.current = "/profile/expert-requests/cokolwiek";
    render(<ProfileNav />);
    const active = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current"));
    expect(active.map((a) => a.getAttribute("href"))).toEqual(["/profile/expert-requests"]);
  });

  it("każda pozycja ma etykietę z i18n (żaden link nie jest pusty)", () => {
    render(<ProfileNav />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.textContent?.trim()).toMatch(/^profile\.nav\./);
    }
  });
});
