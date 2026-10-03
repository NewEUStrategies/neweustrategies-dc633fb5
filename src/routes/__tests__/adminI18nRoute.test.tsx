// /admin/i18n - nagłówek strony audytu tłumaczeń widgetów.
//
// `head()` tej trasy pilnuje `moduleTwentyHeadLang.test.ts`; tu dowodzimy
// CIAŁA strony: nagłówek wybiera język tą samą regułą (`uiLang`) co panel pod
// nim, więc oba nie mogą się rozjechać dla tego samego `i18n.language`.
// Panel jest atrapą - ma własny plik testów (`WidgetI18nAuditPane.test.tsx`),
// a tu liczy się wyłącznie to, że trasa go montuje.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import type { AnyRoute } from "@tanstack/react-router";
import i18n from "@/lib/i18n";
import { Route } from "@/routes/admin.i18n";

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

  it("regionalny kod języka („en-US”) to też angielski nagłówek", () => {
    // i18next przy `supportedLngs: ["pl","en"]` sam sprowadza „en-US" do „en",
    // więc test przypina normalizację `uiLang`, nie odtwarza dzisiejszej awarii.
    const previous = i18n.language;
    i18n.language = "en-US";
    try {
      renderPage();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Widget translation audit",
      );
    } finally {
      i18n.language = previous;
    }
  });
});
