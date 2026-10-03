// /admin/i18n - nagłówek strony audytu tłumaczeń widgetów.
//
// `head()` tej trasy pilnuje `moduleTwentyHeadLang.test.ts`; tu dowodzimy
// CIAŁA strony: nagłówek idzie przez słownik panelu
// (`adminWidgetI18nAudit.*`) i ten sam `i18n.language` co panel pod nim, więc
// oba nie mogą się rozjechać. Panel jest atrapą - ma własny plik testów
// (`WidgetI18nAuditPane.test.tsx`), a tu liczy się wyłącznie to, że trasa go
// montuje.
//
// `head()` zostaje przy dwujęzycznym literale (biegnie poza Reactem, w shellu
// trasy, gdzie słownika panelu celowo nie ma) - dlatego test niżej przypina,
// że tytuł karty zaczyna się DOKŁADNIE od tytułu ze słownika: poprawka
// brzmienia w jednym miejscu bez drugiego oblewa.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import type { AnyRoute } from "@tanstack/react-router";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { routeHead } from "@/test/routeHarness";
import "@/lib/i18n-admin-widget-audit";
import { Route } from "@/routes/admin.i18n";

const h = vi.hoisted(() => ({ requestUrl: "" }));

vi.mock("@/lib/seo/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/request")>()),
  getRequestUrl: () => h.requestUrl,
}));
vi.mock("@/components/admin/i18n/WidgetI18nAuditPane", () => ({
  WidgetI18nAuditPane: () => <div data-testid="widget-i18n-audit-pane" />,
}));

function renderPage() {
  const Component = (Route as AnyRoute).options.component as () => ReactNode;
  return render(<Component />);
}

afterEach(async () => {
  // Odmontowanie PRZED zmianą języka - inaczej `languageChanged` przerysowuje
  // zamontowaną stronę poza `act`.
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("/admin/i18n - strona", () => {
  it("po polsku: nagłówek, opis i panel audytu", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Audyt tłumaczeń widgetów");
    expect(
      screen.getByText(
        "Widgety, które na wersji angielskiej pokażą polską treść lub tekst szablonowy.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("widget-i18n-audit-pane")).toBeInTheDocument();
  });

  it("po angielsku", async () => {
    await i18n.changeLanguage("en");
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Widget translation audit");
    expect(
      screen.getByText("Widgets that render Polish or template copy on the English version."),
    ).toBeInTheDocument();
  });

  it.each(["pl", "en"] as const)("%s: nagłówek i opis to napisy słownika panelu", async (lang) => {
    await i18n.changeLanguage(lang);
    const t = realT(lang);
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      t("adminWidgetI18nAudit.title"),
    );
    expect(screen.getByText(t("adminWidgetI18nAudit.lead"))).toBeInTheDocument();
  });

  it.each([
    ["pl", "/admin/i18n"],
    ["en", "/en/admin/i18n"],
  ] as const)("%s: tytuł karty (head) zaczyna się od tytułu ze słownika", (lang, url) => {
    h.requestUrl = url;
    const prefix = `${realT(lang)("adminWidgetI18nAudit.title")} | `;
    const title = routeHead(Route as AnyRoute).meta?.find((m) => typeof m.title === "string");
    expect(String(title?.title).slice(0, prefix.length)).toBe(prefix);
  });

  it("regionalny kod języka („en-US”) to też angielski nagłówek", async () => {
    // Język wybiera teraz i18next (`t()`), nie porównanie w komponencie - więc
    // przypinamy prawdziwą ścieżkę: `changeLanguage("en-US")` rozwiązuje się
    // do angielskiego słownika.
    await i18n.changeLanguage("en-US");
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Widget translation audit");
  });
});
