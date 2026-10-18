// Edytory list z treścią redakcyjną: cennik, zakładki i akordeon (FAQ).
//
// Przypinamy to, co redakcja realnie robi w tych panelach i co psuje stronę:
//  1. CENNIK - lista cech „jedna na linię". Kontrolowane pole wracało do
//     `cechy.join("\n")` przy każdym znaku, więc Enter i spacja na końcu
//     znikały, zanim redaktor napisał następny znak: drugiej cechy ani cechy
//     z dwóch słów nie dało się wpisać z klawiatury (NAPRAWIONE 2026-10-18,
//     pole idzie przez wspólne `LineListTextarea`). Tryb katalogu planów
//     chowa ręczne karty, a limit kart zapisuje się tak, jak czyta go widok
//     (bez ujemnych i ułamków).
//  2. ZAKŁADKI - układ pionowy chowa wyrównanie, wartość spoza listy pokazuje
//     wyrównanie domyślne, edycja pisze klucze języka panelu.
//  3. AKORDEON - pytanie i odpowiedź w EN nie ruszają polskiej wersji pozycji.
//
// Granice: atrapa i18n (echo klucza), atrapa pickera ikon Lucide (ciężki skan
// całej przestrzeni ikon; tu liczy się tylko to, co edytor zapisuje po
// wyborze/wyczyszczeniu - tak samo robi test menedżera menu).
import { describe, it, expect, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { PricingEditor } from "../PricingEditor";
import { TabsEditor } from "../TabsEditor";
import { AccordionEditor } from "../AccordionEditor";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/admin/builder/ui/molecules/LucideIconPicker", () => ({
  LucideIconPicker: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange: (name: string | undefined) => void;
  }) => (
    <span data-testid="ikona" data-value={value}>
      <button type="button" onClick={() => onChange("Star")}>
        wybierz Star
      </button>
      <button type="button" onClick={() => onChange(undefined)}>
        wyczyść ikonę
      </button>
    </span>
  ),
}));

type Editor = (props: {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}) => ReactNode;

function renderStateful(Editor: Editor, initial: WidgetNode["content"], lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<WidgetNode["content"]>(initial);
    return (
      <Editor
        c={content}
        lang={lang}
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  const view = renderWithQueryClient(<Host />);
  const last = (key: string) => written.filter(([k]) => k === key).at(-1)?.[1];
  return { ...view, written, last };
}

/** `PropField` nie wiąże etykiety z kontrolką - szukamy w jej opakowaniu. */
function fieldOf(label: string, index = 0): HTMLInputElement {
  const wrapper = screen.getAllByText(label, { selector: "label" })[index]?.parentElement;
  const field = wrapper?.querySelector<HTMLInputElement>("input, textarea, select");
  if (!field) throw new Error(`test: brak kontrolki „${label}"`);
  return field;
}

const selectWith = (value: string): HTMLSelectElement => {
  const found = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
    s.querySelector(`option[value="${value}"]`),
  );
  if (!found) throw new Error(`test: brak listy z opcją „${value}"`);
  return found;
};

const PLAN = {
  name_pl: "Podstawowy",
  name_en: "Basic",
  price: "49",
  currency: "zł",
  features_pl: ["Raporty"],
  features_en: ["Reports"],
  featured: false,
};

describe("PricingEditor - cechy planu, jedna na linię", () => {
  const features = () =>
    fieldOf("builder.pricingEditor.features(lang=PL)") as unknown as HTMLTextAreaElement;

  it("Enter na końcu zostaje w polu i nie zapisuje pustej cechy", () => {
    const { written } = renderStateful(PricingEditor, { plans: [PLAN] });
    fireEvent.change(features(), { target: { value: "Raporty\n" } });
    expect(features().value).toBe("Raporty\n");
    expect(written).toEqual([]);
  });

  it("druga linia dopisuje drugą cechę, a cecha z dwóch słów zachowuje spację", () => {
    const { last } = renderStateful(PricingEditor, { plans: [PLAN] });
    fireEvent.change(features(), { target: { value: "Raporty\nDostęp " } });
    expect(features().value).toBe("Raporty\nDostęp ");
    fireEvent.change(features(), { target: { value: "Raporty\nDostęp do archiwum" } });
    expect(features().value).toBe("Raporty\nDostęp do archiwum");
    const plans = last("plans") as Array<Record<string, unknown>>;
    expect(plans[0]?.features_pl).toEqual(["Raporty", "Dostęp do archiwum"]);
    // Druga wersja językowa i reszta planu bez zmian.
    expect(plans[0]).toMatchObject({
      features_en: ["Reports"],
      name_pl: "Podstawowy",
      price: "49",
    });
  });

  it("pozycje nie-napisy z uszkodzonej treści nie trafiają do pola", () => {
    renderStateful(PricingEditor, { plans: [{ ...PLAN, features_pl: ["Raporty", 3, null] }] });
    expect(features().value).toBe("Raporty");
  });
});

describe("PricingEditor - karty ręczne", () => {
  it("dodanie karty seeduje oba języki i domyślne CTA", () => {
    const { last } = renderStateful(PricingEditor, { plans: [PLAN] }, "en");
    fireEvent.click(screen.getByRole("button", { name: /common\.add/ }));
    const plans = last("plans") as Array<Record<string, unknown>>;
    expect(plans).toHaveLength(2);
    expect(plans[0]).toEqual(PLAN);
    expect(plans[1]).toEqual({
      name_pl: "Plan",
      name_en: "Plan",
      price: "0",
      currency: "zł",
      period_pl: "/mies.",
      period_en: "/mo",
      features_pl: ["Funkcja 1"],
      features_en: ["Feature 1"],
      cta_pl: "Wybierz",
      cta_en: "Choose",
      href: "#",
      featured: false,
    });
  });

  it("pola karty piszą klucze języka panelu, wspólne pola bez sufiksu", () => {
    const { last } = renderStateful(PricingEditor, { plans: [PLAN] }, "en");
    fireEvent.change(fieldOf("builder.pricingEditor.name(lang=EN)"), {
      target: { value: "Pro" },
    });
    fireEvent.change(fieldOf("builder.pricingEditor.price"), { target: { value: "99" } });
    fireEvent.change(fieldOf("builder.pricingEditor.currency"), { target: { value: "€" } });
    fireEvent.change(fieldOf("builder.pricingEditor.period(lang=EN)"), {
      target: { value: "/year" },
    });
    fireEvent.change(fieldOf("builder.pricingEditor.cta(lang=EN)"), {
      target: { value: "Buy" },
    });
    fireEvent.change(fieldOf("builder.pricingEditor.ctaLink"), { target: { value: "/kup" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "builder.pricingEditor.featured" }));
    expect(last("plans")).toEqual([
      {
        ...PLAN,
        name_en: "Pro",
        price: "99",
        currency: "€",
        period_en: "/year",
        cta_en: "Buy",
        href: "/kup",
        featured: true,
      },
    ]);
  });

  it("usunięcie zabiera wskazaną kartę", () => {
    const { last } = renderStateful(PricingEditor, {
      plans: [PLAN, { ...PLAN, name_pl: "Drugi" }, { ...PLAN, name_pl: "Trzeci" }],
    });
    fireEvent.click(screen.getAllByRole("button", { name: "builder.common.delete" })[1]!);
    const plans = last("plans") as Array<Record<string, unknown>>;
    expect(plans.map((p) => p.name_pl)).toEqual(["Podstawowy", "Trzeci"]);
  });
});

describe("PricingEditor - katalog planów", () => {
  it('przełączenie źródła zapisuje „plans" i chowa ręczne karty', () => {
    const { written } = renderStateful(PricingEditor, { plans: [PLAN] });
    expect(screen.getByRole("button", { name: /common\.add/ })).toBeInTheDocument();
    fireEvent.change(selectWith("plans"), { target: { value: "plans" } });
    expect(written).toEqual([["source", "plans"]]);
    expect(screen.queryByRole("button", { name: /common\.add/ })).toBeNull();
    expect(screen.queryByText("builder.pricingEditor.price")).toBeNull();
  });

  it("okres, warstwy i CTA zapisują się pod swoimi kluczami", () => {
    const { written } = renderStateful(PricingEditor, { source: "plans" }, "en");
    const interval = selectWith("quarter");
    // Bez zapisanej wartości lista pokazuje „wszystkie", jak widok.
    expect(interval.value).toBe("all");
    fireEvent.change(interval, { target: { value: "year" } });
    fireEvent.change(fieldOf("Tier keys (CSV)"), { target: { value: "plus,pro" } });
    fireEvent.change(fieldOf("builder.pricingEditor.cta(lang=EN)"), {
      target: { value: "Subscribe" },
    });
    expect(written).toEqual([
      ["planInterval", "year"],
      ["tierKeysCsv", "plus,pro"],
      ["cta_en", "Subscribe"],
    ]);
  });

  it.each([
    ["ujemny", "-3", 0],
    ["ułamkowy", "2.7", 2],
    ["pusty", "", 0],
    ["poprawny", "4", 4],
  ] as const)("%s limit kart zapisuje się tak, jak czyta go widok", (_l, typed, saved) => {
    const { written } = renderStateful(PricingEditor, { source: "plans", planLimit: 9 });
    fireEvent.change(fieldOf("Limit kart"), { target: { value: typed } });
    expect(written).toEqual([["planLimit", saved]]);
  });

  it("ujemny limit z dokumentu pokazuje się jako brak limitu (0)", () => {
    renderStateful(PricingEditor, { source: "plans", planLimit: -5 });
    expect(fieldOf("Limit kart").value).toBe("0");
  });
});

describe("TabsEditor", () => {
  const TABS = [
    { label_pl: "Opis", label_en: "About", html_pl: "<p>PL</p>", html_en: "<p>EN</p>" },
    { label_pl: "Mapa", label_en: "Map", html_pl: "<p>Mapa</p>", html_en: "<p>Map</p>" },
  ];

  it("układ pionowy chowa wyrównanie zakładek", () => {
    const { written } = renderStateful(TabsEditor, { tabs: TABS });
    expect(selectWith("justify")).toBeInTheDocument();
    fireEvent.change(selectWith("vertical"), { target: { value: "vertical" } });
    expect(written).toEqual([["orientation", "vertical"]]);
    expect(document.querySelector('option[value="justify"]')).toBeNull();
  });

  it('wyrównanie spoza listy pokazuje domyślne „left", wybór zapisuje wartość', () => {
    const { written } = renderStateful(TabsEditor, { tabs: TABS, tabAlign: "diagonal" });
    const align = selectWith("justify");
    expect(align.value).toBe("left");
    fireEvent.change(align, { target: { value: "center" } });
    expect(written).toEqual([["tabAlign", "center"]]);
  });

  it("dodanie zakładki seeduje oba języki", () => {
    const { last } = renderStateful(TabsEditor, { tabs: TABS }, "en");
    fireEvent.click(screen.getByRole("button", { name: /common\.add/ }));
    const tabs = last("tabs") as Array<Record<string, unknown>>;
    expect(tabs.slice(0, 2)).toEqual(TABS);
    expect(tabs[2]).toEqual({
      label_pl: "Nowa",
      label_en: "New",
      html_pl: "<p>Treść…</p>",
      html_en: "<p>Content…</p>",
    });
  });

  it("etykieta i HTML w EN nie ruszają polskiej wersji ani drugiej zakładki", () => {
    const { last } = renderStateful(TabsEditor, { tabs: TABS }, "en");
    fireEvent.change(fieldOf("builder.tabsEditor.label(lang=EN)", 1), {
      target: { value: "Where" },
    });
    fireEvent.change(fieldOf("builder.tabsEditor.html(lang=EN)", 1), {
      target: { value: "<p>Brussels</p>" },
    });
    expect(last("tabs")).toEqual([
      TABS[0],
      { ...TABS[1], label_en: "Where", html_en: "<p>Brussels</p>" },
    ]);
  });

  it("wybór ikony zapisuje nazwę, wyczyszczenie - pusty napis", () => {
    const { last } = renderStateful(TabsEditor, { tabs: [TABS[0]!] });
    fireEvent.click(screen.getByRole("button", { name: "wybierz Star" }));
    expect((last("tabs") as Array<Record<string, unknown>>)[0]?.icon).toBe("Star");
    expect(screen.getByTestId("ikona")).toHaveAttribute("data-value", "Star");
    fireEvent.click(screen.getByRole("button", { name: "wyczyść ikonę" }));
    expect((last("tabs") as Array<Record<string, unknown>>)[0]?.icon).toBe("");
  });

  it("usunięcie zabiera wskazaną zakładkę", () => {
    const { last } = renderStateful(TabsEditor, { tabs: TABS });
    fireEvent.click(screen.getAllByRole("button", { name: "builder.common.delete" })[0]!);
    expect(last("tabs")).toEqual([TABS[1]]);
  });

  it("wartości nie-napisy z uszkodzonej treści nie wyciekają do pól", () => {
    renderStateful(TabsEditor, { tabs: [{ label_pl: 7, html_pl: { x: 1 } }] });
    expect(fieldOf("builder.tabsEditor.label(lang=PL)").value).toBe("");
    expect(fieldOf("builder.tabsEditor.html(lang=PL)").value).toBe("");
  });
});

describe("AccordionEditor - pytanie i odpowiedź w języku panelu", () => {
  const ITEMS = [
    { q_pl: "Ile kosztuje?", q_en: "How much?", a_pl: "<p>Nic</p>", a_en: "<p>Free</p>" },
    { q_pl: "Kiedy?", q_en: "When?", a_pl: "<p>Jutro</p>", a_en: "<p>Tomorrow</p>" },
  ];

  it("edycja w EN zmienia tylko klucze EN wskazanej pozycji", () => {
    const { last } = renderStateful(AccordionEditor, { items: ITEMS }, "en");
    fireEvent.change(fieldOf("builder.accordionEditor.question(lang=EN)", 1), {
      target: { value: "When exactly?" },
    });
    fireEvent.change(fieldOf("builder.accordionEditor.answer(lang=EN)", 1), {
      target: { value: "<p>Monday</p>" },
    });
    expect(last("items")).toEqual([
      ITEMS[0],
      { ...ITEMS[1], q_en: "When exactly?", a_en: "<p>Monday</p>" },
    ]);
  });

  it("usunięcie zabiera wskazaną pozycję", () => {
    const { last } = renderStateful(AccordionEditor, { items: ITEMS });
    fireEvent.click(screen.getAllByRole("button", { name: "builder.common.delete" })[1]!);
    expect(last("items")).toEqual([ITEMS[0]]);
  });

  it("pole bez napisu w treści pokazuje pusty tekst", () => {
    renderStateful(AccordionEditor, { items: [{ q_pl: null, a_pl: 5 }] });
    expect(fieldOf("builder.accordionEditor.question(lang=PL)").value).toBe("");
    expect(fieldOf("builder.accordionEditor.answer(lang=PL)").value).toBe("");
  });
});
