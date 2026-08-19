// Podnawigacja modułu /admin/newsletter - jedenaście zakładek.
//
// Wygląda jak dekoracja, a niesie dwie reguły, których pomyłka jest cicha:
//   1. AKTYWNA zakładka wynika z PREFIKSU ścieżki. Gdyby ścieżka jednej
//      zakładki była prefiksem innej, podświetliłyby się DWIE naraz i operator
//      nie wiedziałby, gdzie jest.
//   2. Każda zakładka ma etykietę ze słownika i cel. Zakładka bez etykiety to
//      pusty przycisk, zakładka bez celu - martwy link w środku panelu.
//
// Router jest tu atrapą: `Link` renderujemy jako zwykły odnośnik, a ścieżkę
// podajemy z testu. Sprawdzana jest reguła wyboru zakładki, nie nawigacja
// TanStack Routera (ta ma własne testy tras).
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const env = vi.hoisted(() => ({ pathname: "/admin/newsletter/overview" }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
      select({ location: { pathname: env.pathname } }),
    Link: ({ to, children, className }: Record<string, unknown>) =>
      createElement("a", { href: to as string, className: className as string }, children as never),
  };
});

import i18n from "@/lib/i18n";
import { NewsletterSubNav } from "@/components/admin/newsletter/NewsletterSubNav";

const N = (key: string) => i18n.t(`adminNewsletter.nav.${key}`);

/** Wszystkie zakładki jako pary (cel, podpis). */
function tabs(container: HTMLElement): Array<{ href: string; label: string }> {
  return Array.from(container.querySelectorAll("nav a")).map((a) => ({
    href: a.getAttribute("href") ?? "",
    label: a.textContent?.trim() ?? "",
  }));
}

function mount(pathname = "/admin/newsletter/overview") {
  env.pathname = pathname;
  return render(<NewsletterSubNav />);
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(() => {
  cleanup();
});

describe("zestaw zakładek", () => {
  it("każda zakładka ma CEL i PODPIS - bez nich jest martwym przyciskiem", () => {
    const { container } = mount();

    const list = tabs(container);
    expect(list.length).toBeGreaterThan(8);
    for (const tab of list) {
      expect(tab.href).toMatch(/^\/admin\/newsletter\//);
      expect(tab.label.length).toBeGreaterThan(0);
    }
  });

  it("cele zakładek są UNIKALNE - dwa te same prowadziłyby w to samo miejsce", () => {
    const { container } = mount();

    const hrefs = tabs(container).map((t) => t.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("ŻADNA ścieżka nie jest prefiksem innej - inaczej świecą się DWIE zakładki", () => {
    // Aktywność liczy się przez `startsWith`, więc „/x" i „/xy" zapaliłyby się
    // razem, a operator nie wiedziałby, na którym ekranie jest.
    const { container } = mount();
    const hrefs = tabs(container).map((t) => t.href);

    const kolizje = hrefs.filter((a) => hrefs.some((b) => b !== a && b.startsWith(a)));

    expect(kolizje).toEqual([]);
  });

  it("obejmuje wszystkie ekrany modułu, w tym doręczalność i logi webhooka", () => {
    const { container } = mount();
    const hrefs = tabs(container).map((t) => t.href);

    expect(hrefs).toContain("/admin/newsletter/deliverability");
    expect(hrefs).toContain("/admin/newsletter/auth-logs");
    expect(hrefs).toContain("/admin/newsletter/campaigns");
  });

  it("nawigacja ma nazwę dostępną i tytuł sekcji", () => {
    mount();

    expect(screen.getByLabelText(N("sectionsNavLabel"))).toBeTruthy();
    expect(screen.getByText(N("sectionTitle"))).toBeTruthy();
  });
});

describe("zakładka aktywna", () => {
  it("świeci się DOKŁADNIE jedna", () => {
    const { container } = mount("/admin/newsletter/subscribers");

    const active = Array.from(container.querySelectorAll("nav a")).filter((a) =>
      (a.getAttribute("class") ?? "").includes("bg-background"),
    );

    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute("href")).toBe("/admin/newsletter/subscribers");
  });

  it("podstrona ekranu też zaznacza jego zakładkę", () => {
    // Wejście w szczegóły kampanii nie może zgasić zakładki „Kampanie".
    const { container } = mount("/admin/newsletter/campaigns/abc-123");

    const active = Array.from(container.querySelectorAll("nav a")).filter((a) =>
      (a.getAttribute("class") ?? "").includes("bg-background"),
    );

    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute("href")).toBe("/admin/newsletter/campaigns");
  });

  it("ścieżka spoza modułu nie zaznacza NICZEGO", () => {
    const { container } = mount("/admin/media");

    const active = Array.from(container.querySelectorAll("nav a")).filter((a) =>
      (a.getAttribute("class") ?? "").includes("bg-background"),
    );

    expect(active).toHaveLength(0);
    expect(tabs(container).length).toBeGreaterThan(8);
  });
});

describe("tłumaczenia", () => {
  it("podpisy idą za językiem interfejsu", async () => {
    const { container } = mount();
    const polskie = tabs(container).map((t) => t.label);
    cleanup();

    await i18n.changeLanguage("en");
    try {
      const { container: en } = mount();
      const angielskie = tabs(en).map((t) => t.label);

      expect(angielskie).not.toEqual(polskie);
      expect(angielskie.every((l) => l.length > 0)).toBe(true);
    } finally {
      await i18n.changeLanguage("pl");
    }
  });
});
