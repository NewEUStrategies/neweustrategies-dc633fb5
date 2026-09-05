/**
 * `DesignSubNav` - pasek zakładek obszaru „Wygląd", montowany na czterech
 * niepowiązanych trasach panelu (wygląd, opcje motywu, tokeny marki, layouty
 * wpisów), żeby czytały się jak jeden obszar mimo osobnych plików tras.
 *
 * CO PRZYPINA TEN PLIK.
 *   1. ZAZNACZENIE ZAKŁADKI IDZIE ZA TRASĄ i jest ROZŁĄCZNE - dokładnie jedna
 *      zakładka jest podświetlona na każdej z czterech tras obszaru, a poza
 *      obszarem nie świeci się żadna. To jedyne wyjście logiki tego komponentu
 *      (`pathname.startsWith(tab.match)`), więc test jest tabelaryczny.
 *   2. ADRESY ZAKŁADEK - zakładka „Nagłówek i stopka" celowo prowadzi GŁĘBIEJ
 *      (`/admin/appearance/header`) niż zakres, po którym się zaznacza
 *      (`/admin/appearance`); pomylenie tych dwóch wartości daje pasek, który
 *      albo nie świeci na trasie obszaru, albo prowadzi na pustą trasę.
 *   3. DWUJĘZYCZNOŚĆ mierzona SŁOWNIKIEM - `t` w atrapie `react-i18next` to
 *      prawdziwy `getFixedT` z `@/test/i18nReal`, więc wariant EN jest osobnym
 *      przypadkiem, a usunięcie klucza gasi asercję.
 *
 * ATRAPA: router (`Link` -> `@/test/routerLinkStub`, `useRouterState` ->
 * kontrolowana ścieżka). Reszta - łącznie z ikonami - zostaje prawdziwa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import type { RouterLinkStubProps } from "@/test/routerLinkStub";

const h = vi.hoisted(() => ({
  /** Prawdziwy `getFixedT(lang)`; wstrzykiwany niżej (fabryka nic nie importuje). */
  t: null as null | ((lang: "pl" | "en") => unknown),
  lang: "pl" as "pl" | "en",
  pathname: "/admin/appearance",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.t?.(h.lang), i18n: { language: h.lang } }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const react = await import("react");
  const { RouterLinkStub } = await import("@/test/routerLinkStub");

  return {
    ...actual,
    Link: (props: RouterLinkStubProps) => react.createElement(RouterLinkStub, props),
    useRouterState: <T,>({ select }: { select: (s: { location: { pathname: string } }) => T }) =>
      select({ location: { pathname: h.pathname } }),
  };
});

import { DesignSubNav } from "@/components/admin/DesignSubNav";
import { realT } from "@/test/i18nReal";

h.t = (lang) => realT(lang);

/** Słownik jako źródło asercji - test nie powtarza napisów z komponentu. */
const dict = (lang: "pl" | "en" = "pl"): TFunction => realT(lang);

/** Klasa, którą komponent maluje wyłącznie na zakładce aktywnej. */
const ACTIVE_CLASS = "bg-background";

function activeTabNames(): string[] {
  return screen
    .getAllByRole("link")
    .filter((link) => link.className.includes(ACTIVE_CLASS))
    .map((link) => link.textContent ?? "");
}

beforeEach(() => {
  h.lang = "pl";
  h.pathname = "/admin/appearance";
});

describe("DesignSubNav - zaznaczenie zakładki obszaru", () => {
  it.each([
    ["trasa wyglądu", "/admin/appearance", "admin.nav.appearance"],
    ["podtrasa wyglądu", "/admin/appearance/category-archive", "admin.nav.appearance"],
    ["opcje motywu", "/admin/theme-options", "admin.nav.themeOptions"],
    ["tokeny marki", "/admin/settings/design", "admin.settingsNav.design"],
    ["layouty wpisów", "/admin/post-layouts", "admin.nav.postLayouts"],
  ])("na trasie %s świeci się dokładnie jedna zakładka", (_opis, pathname, key) => {
    h.pathname = pathname;
    render(<DesignSubNav />);

    expect(activeTabNames()).toEqual([dict()(key)]);
  });

  it("poza obszarem wyglądu żadna zakładka nie jest zaznaczona", () => {
    h.pathname = "/admin/users";
    render(<DesignSubNav />);

    expect(activeTabNames()).toEqual([]);
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });
});

describe("DesignSubNav - adresy zakładek", () => {
  it("zakładka wyglądu prowadzi na nagłówek, choć zaznacza się na całym obszarze", () => {
    h.pathname = "/admin/theme-options";
    render(<DesignSubNav />);

    expect(screen.getByRole("link", { name: dict()("admin.nav.appearance") })).toHaveAttribute(
      "href",
      "/admin/appearance/header",
    );
    expect(screen.getByRole("link", { name: dict()("admin.nav.themeOptions") })).toHaveAttribute(
      "href",
      "/admin/theme-options",
    );
    expect(screen.getByRole("link", { name: dict()("admin.settingsNav.design") })).toHaveAttribute(
      "href",
      "/admin/settings/design",
    );
    expect(screen.getByRole("link", { name: dict()("admin.nav.postLayouts") })).toHaveAttribute(
      "href",
      "/admin/post-layouts",
    );
  });
});

describe("DesignSubNav - dwujęzyczność", () => {
  it.each([
    ["polskim", "pl" as const],
    ["angielskim", "en" as const],
  ])("w wariancie %s nagłówek i zakładki idą ze słownika", (_opis, lang) => {
    h.lang = lang;
    render(<DesignSubNav />);

    expect(
      screen.getByRole("heading", { name: dict(lang)("admin.navGroups.design") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: dict(lang)("admin.nav.themeOptions") }),
    ).toBeInTheDocument();
  });
});
