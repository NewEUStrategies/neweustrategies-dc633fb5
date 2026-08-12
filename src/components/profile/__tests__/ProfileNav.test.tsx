// Nawigacja profilu: cztery nazwane grupy (tożsamość / treści / finanse /
// prywatność i bezpieczeństwo), stan aktywny wyliczany z adresu oraz warunkowa
// pozycja „Organizacja".
//
// Testy pilnują rzeczy trudnych do wyłapania okiem:
//   * „Organizacja" pojawia się WYŁĄCZNIE posiadaczom miejsca w organizacji i
//     zawsze zaraz po „Członkostwie" (kolejność jest częścią IA, nie przypadkiem),
//   * dopasowanie prefiksem nie może podświetlać „Przegląd" (/profile) na
//     każdej podstronie profilu - to była klasyczna pułapka `startsWith`,
//   * konsolidacja IA (§10/§11): prywatność i bezpieczeństwo NIE wiszą już
//     w grupie finansów, a trasy scalone (/profile/orders,
//     /profile/subscription) nie mają własnych pozycji - są przekierowaniami,
//     więc pozycja nawigacji prowadziłaby do przeskoku.
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
  it("grupuje pozycje w cztery nazwane sekcje", () => {
    render(<ProfileNav />);
    expect(screen.getByText("profile.navGroups.identity")).toBeInTheDocument();
    expect(screen.getByText("profile.navGroups.content")).toBeInTheDocument();
    expect(screen.getByText("profile.navGroups.finance")).toBeInTheDocument();
    expect(screen.getByText("profile.navGroups.privacy")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "profile.title" })).toBeInTheDocument();
  });

  it("prywatność i bezpieczeństwo mają własną grupę, nie grupę finansów", () => {
    render(<ProfileNav />);
    const hrefs = linkHrefs();
    // Obie pozycje istnieją...
    expect(hrefs).toContain("/profile/privacy");
    expect(hrefs).toContain("/profile/security");
    // ...i stoją PO ostatniej pozycji finansowej, czyli w kolejnej grupie.
    expect(hrefs.indexOf("/profile/privacy")).toBeGreaterThan(hrefs.indexOf("/profile/billing"));
  });

  it("nie prowadzi do tras scalonych - nawigacja nie celuje w przekierowania", () => {
    render(<ProfileNav />);
    const hrefs = linkHrefs();
    expect(hrefs).not.toContain("/profile/orders");
    expect(hrefs).not.toContain("/profile/subscription");
    expect(hrefs).toContain("/profile/payments");
    expect(hrefs).toContain("/profile/plan");
  });

  it("prowadzi do zapytań do ekspertów, sieci kontaktów i powiadomień", () => {
    render(<ProfileNav />);
    const hrefs = linkHrefs();
    expect(hrefs).toContain("/profile/expert-requests");
    expect(hrefs).toContain("/network");
    expect(hrefs).toContain("/messages");
  });

  it("prowadzi do ustawień powiadomień, osobno od skrzynki", () => {
    // Do 12.08 nawigacja miała TYLKO wejście do skrzynki (/messages), a zakładka
    // preferencji w NotificationsCenter była nieosiągalna, bo montowały ją
    // wyłącznie tryby, które ją ukrywają. Te dwie pozycje muszą istnieć obok
    // siebie i prowadzić w RÓŻNE miejsca - inaczej wracamy do stanu, w którym
    // opt-in Web Push i digest są zaimplementowane i niedostępne.
    render(<ProfileNav />);
    const hrefs = linkHrefs();
    expect(hrefs).toContain("/profile/notifications");
    expect(hrefs).toContain("/messages");
    expect(hrefs.indexOf("/profile/notifications")).not.toBe(hrefs.indexOf("/messages"));
  });

  it("ustawienia powiadomień stoją w grupie prywatności, nie w treściach", () => {
    // Miejsce w IA jest decyzją, nie przypadkiem: użytkownik szukający „jak
    // wyłączyć te maile" idzie do ustawień konta. Pozycja musi więc stać po
    // ostatniej pozycji finansowej (czyli w grupie prywatności), obok /profile/privacy.
    render(<ProfileNav />);
    const hrefs = linkHrefs();
    expect(hrefs.indexOf("/profile/notifications")).toBeGreaterThan(
      hrefs.indexOf("/profile/billing"),
    );
    expect(hrefs.indexOf("/profile/notifications")).toBeGreaterThan(
      hrefs.indexOf("/profile/privacy"),
    );
  });

  it("etykieta ustawień powiadomień idzie ze słownika, nie z literału", () => {
    render(<ProfileNav />);
    expect(screen.getByText("profile.nav.notificationSettings")).toBeInTheDocument();
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
    h.pathname.current = "/profile/payments";
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
