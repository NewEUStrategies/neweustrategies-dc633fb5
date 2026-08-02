// Regresja: ręczne pozycje TOC wpisane w panelu NIGDY się nie renderowały.
//
// Schemat deklarował pole `items` jako `stringArray`, więc kontrolka panelu
// commitowała `content.items`, a widget czytał wyłącznie `items_pl` /
// `items_${lang}`. Klasyczny key-mismatch: dane zapisane, render pusty.
//
// Ten plik pilnuje OBU stron kontraktu naraz:
//  1. schemat pola (`WIDGET_SCHEMAS.toc.items`) ma typ zapisujący `_pl`/`_en`,
//  2. renderer czyta `items_pl`, `items_en` ORAZ stary, bezjęzykowy `items`
//     (treść zapisana przez zepsutą kontrolkę musi ożyć, a nie przepaść).
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TocWidget } from "../TocWidget";
import { MANUAL_TOC_ITEMS_KEY } from "@/lib/toc/manualItems";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";
import type { WidgetContent } from "@/lib/builder/types";
import type { Lang } from "../frame";

function renderWidget(content: WidgetContent, lang: Lang = "pl") {
  return render(<TocWidget content={content} lang={lang} />);
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("TocWidget - ręczne pozycje a klucze zapisu", () => {
  it("declares the manual items field as an i18n list (schema side of the bug)", () => {
    const field = WIDGET_SCHEMAS.toc?.find((f) => f.key === MANUAL_TOC_ITEMS_KEY);
    expect(field, "brak pola pozycji ręcznych w schemacie TOC").toBeDefined();
    // `stringArray` zapisywałby goły `items`, którego renderer nie czyta.
    expect(field?.type).toBe("i18nStringArray");
  });

  it("renders items saved as items_pl", () => {
    renderWidget({ items_pl: ["Wprowadzenie", "-- Szczegóły"] }, "pl");
    expect(screen.getByRole("link", { name: /Wprowadzenie/ })).toHaveAttribute(
      "href",
      "#wprowadzenie",
    );
    expect(screen.getByRole("link", { name: /Szczegóły/ })).toHaveAttribute("href", "#szczegoly");
  });

  it("renders items saved as items_en for the English preview", () => {
    renderWidget({ items_pl: ["Wprowadzenie"], items_en: ["Introduction"] }, "en");
    expect(screen.getByRole("link", { name: /Introduction/ })).toHaveAttribute(
      "href",
      "#introduction",
    );
    expect(screen.queryByRole("link", { name: /Wprowadzenie/ })).toBeNull();
  });

  it("revives content written by the broken control under the language-less `items`", () => {
    // Dokładnie to, co zapisała kontrolka `stringArray`: klucz bez języka.
    for (const lang of ["pl", "en"] as const) {
      renderWidget({ items: ["Stara pozycja"] }, lang);
      expect(screen.getByRole("link", { name: /Stara pozycja/ })).toHaveAttribute(
        "href",
        "#stara-pozycja",
      );
      cleanup();
    }
  });

  it("prefers the language list over the legacy one", () => {
    renderWidget({ items: ["Stara pozycja"], items_pl: ["Nowa pozycja"] }, "pl");
    expect(screen.getByRole("link", { name: /Nowa pozycja/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Stara pozycja/ })).toBeNull();
  });

  it("shows the empty state when no manual items and no headings exist", () => {
    renderWidget({ items_pl: [] }, "pl");
    expect(screen.getByText("Brak nagłówków na tej stronie.")).toBeInTheDocument();
  });
});

describe("TocWidget - przełączniki po migracji na boolean", () => {
  const items: WidgetContent = { items_pl: ["Alfa", "Beta"] };

  it("honours real booleans from the new Switch control", () => {
    renderWidget({ ...items, showProgress: true, showNumbers: false, sticky: true });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("01.")).toBeNull();
    expect(document.querySelector("[data-widget-toc]")?.className).toContain("lg:sticky");
  });

  it("still honours the legacy '0' / '1' strings", () => {
    renderWidget({ ...items, showProgress: "1", showNumbers: "0", sticky: "0" });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("01.")).toBeNull();
    expect(document.querySelector("[data-widget-toc]")?.className).not.toContain("lg:sticky");
  });

  it("numbers items by default and drops the progress bar by default", () => {
    renderWidget(items);
    expect(screen.getByText("01.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("falls back to the list variant for an unknown variant value", () => {
    renderWidget({ ...items, variant: "kosmiczny" });
    expect(document.querySelector("[data-widget-toc]")?.getAttribute("data-variant")).toBe("list");
  });

  it("uses the English title when only title_en is filled", () => {
    // pickI18n domyka łańcuch _lang -> _pl -> _en; wcześniej brak title_pl
    // dawał wbudowany napis mimo wypełnionego EN.
    renderWidget({ ...items, title_en: "Article map" }, "pl");
    expect(screen.getAllByText("Article map").length).toBeGreaterThan(0);
  });
});
