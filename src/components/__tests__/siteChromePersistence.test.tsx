/**
 * Regression test - detects unintended remounts of the persistent Header /
 * MegaMenu when the router navigates between pages.
 *
 * The bug we are guarding against: any change in SiteChrome / __root that
 * causes <Header /> (and therefore the MegaMenu nested inside it) to be
 * unmounted and re-mounted on every route change. That manifests as the
 * menu visibly "flashing" / re-fetching on every click.
 *
 * Strategy: mock Header / Footer / RouteProgress with mount-counter probes
 * and mock `useRouterState` so we can drive the pathname imperatively, then
 * rerender SiteChrome across several routes and assert each probe mounted
 * exactly once.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React, { useEffect } from "react";

const headerMounts = { count: 0 };
const megaMenuMounts = { count: 0 };
const footerMounts = { count: 0 };

const MockMegaMenu = React.memo(function MockMegaMenu() {
  useEffect(() => {
    megaMenuMounts.count += 1;
  }, []);
  return <div data-testid="mega-menu">Mega</div>;
});

vi.mock("@/components/Header", () => ({
  Header: React.memo(function MockHeader() {
    useEffect(() => {
      headerMounts.count += 1;
    }, []);
    return (
      <header data-site-header data-testid="header">
        <MockMegaMenu />
      </header>
    );
  }),
}));

vi.mock("@/components/Footer", () => ({
  Footer: React.memo(function MockFooter() {
    useEffect(() => {
      footerMounts.count += 1;
    }, []);
    return <footer data-site-footer data-testid="footer" />;
  }),
}));

vi.mock("@/components/RouteProgress", () => ({
  RouteProgress: () => null,
}));

let currentPath = "/";

vi.mock("@tanstack/react-router", () => ({
  useRouterState: <T,>({ select }: { select: (s: unknown) => T }): T =>
    select({ location: { pathname: currentPath }, matches: [] }),
}));

// Import AFTER the mocks so SiteChrome picks up the mocked Header/Footer.
import { SiteChrome } from "@/components/SiteChrome";

describe("SiteChrome - persistent header/menu across navigation", () => {
  beforeEach(() => {
    headerMounts.count = 0;
    megaMenuMounts.count = 0;
    footerMounts.count = 0;
    currentPath = "/";
  });

  it("does not remount Header or MegaMenu when navigating between public pages", () => {
    const { rerender, getByTestId } = render(
      <SiteChrome>
        <div data-testid="page">home</div>
      </SiteChrome>,
    );

    expect(headerMounts.count).toBe(1);
    expect(megaMenuMounts.count).toBe(1);
    expect(footerMounts.count).toBe(1);
    expect(getByTestId("page").textContent).toBe("home");

    // Simulate SPA navigation: pathname + page content change, chrome stays.
    currentPath = "/blog";
    rerender(
      <SiteChrome>
        <div data-testid="page">blog</div>
      </SiteChrome>,
    );
    currentPath = "/post/abc";
    rerender(
      <SiteChrome>
        <div data-testid="page">post</div>
      </SiteChrome>,
    );
    currentPath = "/profile";
    rerender(
      <SiteChrome>
        <div data-testid="page">profile</div>
      </SiteChrome>,
    );

    expect(headerMounts.count).toBe(1);
    expect(megaMenuMounts.count).toBe(1);
    expect(footerMounts.count).toBe(1);
    expect(getByTestId("page").textContent).toBe("profile");
    expect(getByTestId("header")).toBeTruthy();
  });

  it("keeps header mounted when transitioning between two public routes back-to-back", () => {
    const { rerender } = render(
      <SiteChrome>
        <div>a</div>
      </SiteChrome>,
    );
    for (const p of ["/a", "/b", "/c", "/d", "/e"]) {
      currentPath = p;
      rerender(
        <SiteChrome>
          <div>{p}</div>
        </SiteChrome>,
      );
    }
    expect(headerMounts.count).toBe(1);
    expect(megaMenuMounts.count).toBe(1);
  });
});
