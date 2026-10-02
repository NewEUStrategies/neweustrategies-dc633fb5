// /admin/settings/cookie-banner - panel w JĘZYKU INTERFEJSU (prawdziwe i18n).
//
// `adminSettingsRoutes.test.tsx` montuje tę trasę z atrapą `react-i18next`,
// która oddaje KLUCZE - dowodzi więc sklejenia, ale nie tego, co administrator
// czyta. Do 2026-10-02 panel był w całości po polsku (47 napisów w JSX), więc
// przy interfejsie angielskim pokazywał polszczyznę. Ten plik montuje trasę
// z PRAWDZIWYM słownikiem i sprawdza dwie reguły naraz:
//   1. etykiety panelu idą za językiem INTERFEJSU,
//   2. przykłady w polach treści idą za edytowaną WERSJĄ banera - administrator
//      z interfejsem po polsku edytujący wersję angielską ma widzieć angielskie
//      przykłady, bo to angielski baner.
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { COOKIE_BANNER_DEFAULTS } from "@/lib/cookieBanner/config";

const h = vi.hoisted(() => ({ requestUrl: "" }));

vi.mock("@/lib/seo/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/request")>()),
  getRequestUrl: () => h.requestUrl,
}));
vi.mock("@/lib/i18n/localeRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n/localeRuntime")>()),
  // Ścieżka bez prefiksu = język domyślny; ciasteczko języka nie wchodzi w grę.
  currentLang: () => "pl",
}));

vi.mock("@/lib/admin/useSettings", () => ({
  useSettings: () => ({
    query: { data: COOKIE_BANNER_DEFAULTS },
    save: { isPending: false, mutate: vi.fn() },
  }),
  useDraft: (loaded: unknown) => {
    // Stan jak w produkcji, bez zapytania do bazy.
    return useDraftState(loaded);
  },
}));
vi.mock("@/components/ConsentBanner", () => ({ ConsentBanner: () => null }));
vi.mock("@/components/admin/blocks/AdminColorPicker", () => ({
  AdminColorPicker: ({ ariaLabel }: { ariaLabel: string }) => (
    <button type="button" aria-label={ariaLabel} />
  ),
}));
vi.mock("@/components/admin/CoverImagePicker", () => ({
  CoverImagePicker: ({ label }: { label: string }) => <input aria-label={label} />,
}));
vi.mock("@/lib/ads/consent", () => ({ requestConsentPreferences: () => {} }));
vi.mock("@/components/atoms/AppLink", () => ({
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { useState } from "react";
import i18n from "@/lib/i18n";
import { Route } from "@/routes/admin.settings.cookie-banner";

function useDraftState(loaded: unknown) {
  return useState(loaded);
}

function renderPage() {
  const Page = Route.options.component;
  if (!Page) throw new Error("trasa bez komponentu");
  return render(<Page />);
}

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("pl");
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("/admin/settings/cookie-banner - język interfejsu", () => {
  it("interfejs PL: etykiety po polsku (brzmienia sprzed zmiany, znak w znak)", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Cookie banner" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mechanizmy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kolory (puste = motyw)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Podgląd" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Przywróć domyślne" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Powierzchnia - wybierz kolor" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Pokazuj cookie banner")).toBeInTheDocument();
  });

  it("interfejs EN: cały panel po angielsku - trasa i obie sekcje", async () => {
    await i18n.changeLanguage("en");
    localStorage.clear();
    renderPage();
    expect(screen.getByRole("heading", { name: "Cookie consent banner" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mechanisms" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Colours (empty = theme)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Banner logo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Detected items" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore defaults" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Surface - pick a colour" })).toBeInTheDocument();
    expect(screen.getByText("Show the cookie banner")).toBeInTheDocument();
    expect(screen.getByText("Title")).toBeInTheDocument();
    // Żadnego napisu panelu po polsku (treści banera w polach to dane, nie etykiety).
    const labels = Array.from(document.querySelectorAll("h2, h3, label, button, p"))
      .map((node) => node.textContent ?? "")
      .join(" | ");
    expect(labels).not.toMatch(
      /Mechanizmy|Kolory|Treści|Podgląd|Przywróć|Powierzchnia|Pokazuj|Tytuł|Wykryte|Odnośniki/,
    );
  });

  it("potwierdzenie przywrócenia domyślnych jest w języku interfejsu", async () => {
    await i18n.changeLanguage("en");
    const confirm = vi.fn(() => false);
    const original = Reflect.get(window, "confirm");
    Reflect.set(window, "confirm", confirm);
    try {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));
      expect(confirm).toHaveBeenCalledWith("Restore the default values (colours + copy)?");
    } finally {
      Reflect.set(window, "confirm", original);
    }
  });

  it("tytuł karty: język z ŻĄDANIA (activeLang), nie z singletonu i18next", async () => {
    const head = Route.options.head;
    if (!head) throw new Error("trasa bez head()");
    const title = () => {
      const meta = (head as () => { meta: Record<string, unknown>[] })().meta;
      return meta.find((item) => "title" in item)?.title;
    };
    h.requestUrl = "/admin/settings/cookie-banner";
    expect(title()).toBe("Cookie banner - Ustawienia");
    h.requestUrl = "/en/admin/settings/cookie-banner";
    expect(title()).toBe("Cookie banner - Settings");
    // Zmiana języka instancji i18next NIE przestawia tytułu - na serwerze ta
    // instancja jest wspólna dla równoległych żądań.
    h.requestUrl = "/admin/settings/cookie-banner";
    await i18n.changeLanguage("en");
    expect(title()).toBe("Cookie banner - Ustawienia");
  });
});

describe("/admin/settings/cookie-banner - przykłady w polach treści wg WERSJI banera", () => {
  it("interfejs PL, zakładka EN: etykiety polskie, przykłady angielskie", () => {
    renderPage();
    const [, enTab] = screen.getAllByRole("tab");
    fireEvent.click(enTab);
    expect(screen.getByText("Wersja angielska")).toBeInTheDocument();
    expect(screen.getByText("Tytuł")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(COOKIE_BANNER_DEFAULTS.copy.en.acceptAll),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(COOKIE_BANNER_DEFAULTS.copy.pl.acceptAll),
    ).not.toBeInTheDocument();
  });

  it("zakładki niosą nazwę wersji i etykietę grupy w języku interfejsu", async () => {
    await i18n.changeLanguage("en");
    renderPage();
    expect(
      screen.getByRole("tablist", { name: "Banner copy language version" }),
    ).toBeInTheDocument();
    const [plTab, enTab] = screen.getAllByRole("tab");
    expect(plTab).toHaveAttribute("title", "Polish version");
    expect(enTab).toHaveAttribute("title", "English version");
    expect(
      screen.getByPlaceholderText(COOKIE_BANNER_DEFAULTS.copy.pl.acceptAll),
    ).toBeInTheDocument();
  });
});
