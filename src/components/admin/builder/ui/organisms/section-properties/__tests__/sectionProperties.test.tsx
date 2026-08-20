// Panel właściwości SEKCJI: cztery zakładki (Układ / Styl / Zakładki /
// Zaawansowane) i cztery panele pod nimi.
//
// Sekcja to najwyższy węzeł dokumentu - jej szerokość, wysokość i odstępy
// rządzą całą stroną, a „Zakładki” zamieniają ją w kontener zakładkowy.
// Test przypina reguły, w których błąd widać dopiero na publicznej stronie:
//  1. POLA ZALEŻNE OD WYBORU. Szerokość własna pojawia się tylko dla trybu
//     „boxed", odstęp własny tylko dla „custom", pola wysokości tylko dla
//     odpowiedniego trybu. Pomyłka daje ustawienie bez żadnego efektu.
//  2. ZAKŁADKI SEKCJI: limit liczby zakładek, przenoszenie w obie strony
//     z zachowaniem krańców, usuwanie po identyfikatorze (nie po indeksie)
//     i dwujęzyczne etykiety.
//  3. IDENTYFIKATORY (HTML ID / klasa CSS) zapisują się w węźle - to jedyny
//     sposób, żeby redakcja przypięła własny arkusz do konkretnej sekcji.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SectionNode } from "@/lib/builder/types";
import { selectWithOption, optionValues } from "@/test/builder/panels";
import { SectionProperties } from "../SectionProperties";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});
vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const { radixTabsStub } = await import("@/test/builder/panels");
  return radixTabsStub(React);
});
// Biblioteka ikon ma własny test (1500 ikon, leniwy katalog) - tutaj liczy się
// tylko to, że zakładka sekcji potrafi zapisać wybraną nazwę ikony.
vi.mock("../../../molecules/LucideIconPicker", () => ({
  LucideIconPicker: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string | undefined) => void;
  }) => (
    <input
      aria-label="ikona zakładki"
      value={value}
      onChange={(e) => onChange(e.target.value || undefined)}
    />
  ),
}));

function sectionOf(over: Partial<SectionNode> = {}): SectionNode {
  return { id: "s1", kind: "section", children: [], ...over };
}

function renderPanel(initial: SectionNode = sectionOf(), device: "desktop" | "mobile" = "desktop") {
  const seen: SectionNode[] = [];
  function Host() {
    const [node, setNode] = useState<SectionNode>(initial);
    return (
      <SectionProperties
        section={node}
        device={device}
        onChange={(mut) => {
          setNode((prev) => {
            const next = JSON.parse(JSON.stringify(prev)) as SectionNode;
            mut(next);
            seen.push(next);
            return next;
          });
        }}
      />
    );
  }
  const view = render(<Host />);
  return { ...view, seen, node: () => seen.at(-1) };
}

const tab = (key: string) => screen.getByRole("tab", { name: new RegExp(key) });
const openTab = (key: string) => fireEvent.click(tab(key));

describe("SectionProperties - zakładki panelu", () => {
  it("startuje na układzie i przełącza się na każdą pozostałą", () => {
    renderPanel();
    expect(tab("builder.columnProps.tabLayout")).toHaveAttribute("data-state", "active");
    for (const key of [
      "builder.columnProps.tabStyle",
      "builder.sectionProps.tabTabs",
      "builder.columnProps.tabAdvanced",
    ]) {
      openTab(key);
      expect(tab(key)).toHaveAttribute("data-state", "active");
    }
  });

  it("zakładka stylu pokazuje edytowane urządzenie", () => {
    renderPanel(sectionOf(), "mobile");
    openTab("builder.columnProps.tabStyle");
    expect(screen.getByText("builder.columnProps.editing(device=mobile)")).toBeInTheDocument();
  });
});

describe("LayoutPane - szerokość i odstępy", () => {
  it("oferuje dwa tryby szerokości treści", () => {
    renderPanel();
    expect(optionValues(selectWithOption("boxed"))).toEqual(["boxed", "full"]);
  });

  it("szerokość własna pojawia się tylko w trybie boxed", () => {
    const full = renderPanel(
      sectionOf({ layout: { contentWidth: "full" } } as Partial<SectionNode>),
    );
    expect(screen.queryByText("builder.layoutPane.width")).toBeNull();
    full.unmount();
    renderPanel(sectionOf({ layout: { contentWidth: "boxed" } } as Partial<SectionNode>));
    // Szerokość w pikselach ma sens tylko dla treści „w pudełku" - w trybie
    // pełnym sekcja bierze całą szerokość okna.
    expect(screen.getByText("builder.layoutPane.width")).toBeInTheDocument();
  });

  it("zapis trybu szerokości trafia do układu sekcji", () => {
    const { node } = renderPanel();
    fireEvent.change(selectWithOption("boxed"), { target: { value: "full" } });
    expect(JSON.stringify(node()?.layout ?? {})).toContain("full");
  });

  it("odstęp własny pojawia się tylko dla wyboru „własny”", () => {
    renderPanel();
    expect(screen.queryByText("builder.layoutPane.customGap")).toBeNull();
    fireEvent.change(selectWithOption("custom"), { target: { value: "custom" } });
    expect(screen.getByText("builder.layoutPane.customGap")).toBeInTheDocument();
  });

  it("oferuje siedem wariantów odstępu kolumn", () => {
    renderPanel();
    expect(optionValues(selectWithOption("wider"))).toHaveLength(7);
  });

  it.each([
    ["dopasowanie do ekranu", "fit-screen", "builder.layoutPane.heightVh"],
    ["wysokość minimalna", "min-height", "builder.layoutPane.heightMin"],
    ["wysokość stała", "fixed", "builder.layoutPane.heightPx"],
  ])("tryb wysokości %s odsłania własne pole", (_label, value, label) => {
    renderPanel();
    expect(screen.queryByText(label)).toBeNull();
    fireEvent.change(selectWithOption("fit-screen"), { target: { value } });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("marginesy góra i dół zapisują się osobno", () => {
    const { node } = renderPanel();
    const numbers = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    expect(numbers.length).toBeGreaterThan(1);
    fireEvent.change(numbers[0], { target: { value: "40" } });
    fireEvent.change(numbers[1], { target: { value: "80" } });
    const json = JSON.stringify(node()?.layout ?? {});
    expect(json).toContain("40");
    expect(json).toContain("80");
  });

  it("wyrównanie pionowe zawartości ma własną listę", () => {
    const { node } = renderPanel();
    const select = selectWithOption("default");
    fireEvent.change(select, { target: { value: optionValues(select)[1] } });
    expect(node()).toBeDefined();
  });
});

describe("TabsPane - zakładki sekcji", () => {
  const withTabs = (items: Array<{ id: string; label_pl?: string; label_en?: string }>) =>
    sectionOf({ tabs: { enabled: true, items } } as Partial<SectionNode>);

  it("wyłączone zakładki nie pokazują żadnych ustawień", () => {
    renderPanel();
    openTab("builder.sectionProps.tabTabs");
    expect(screen.getByText("builder.tabsPane.enable")).toBeInTheDocument();
    expect(screen.queryByText("builder.tabsPane.orientation")).toBeNull();
  });

  it("włączenie zakładek odsłania ich ustawienia", () => {
    const { node } = renderPanel();
    openTab("builder.sectionProps.tabTabs");
    fireEvent.click(screen.getByRole("switch"));
    expect(JSON.stringify(node()?.tabs ?? {})).toContain("true");
  });

  it("dodanie zakładki dokłada pozycję do listy", () => {
    const { node } = renderPanel(withTabs([{ id: "t1", label_pl: "Jedna", label_en: "One" }]));
    openTab("builder.sectionProps.tabTabs");
    const add = screen.getByRole("button", { name: /builder.tabsPane.addTab/ });
    fireEvent.click(add);
    expect((node()?.tabs?.items ?? []).length).toBe(2);
  });

  it("przy limicie zakładek dodawanie jest zablokowane", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      label_pl: `Z${i}`,
      label_en: `T${i}`,
    }));
    renderPanel(withTabs(many));
    openTab("builder.sectionProps.tabTabs");
    // Dziesięć zakładek to limit - jedenasta nie zmieściłaby się na pasku
    // i psułaby układ nagłówka sekcji.
    expect(screen.getByRole("button", { name: /builder.tabsPane.addTab/ })).toBeDisabled();
  });

  it("etykiety zakładki zapisują się w obu językach", () => {
    const { node } = renderPanel(withTabs([{ id: "t1", label_pl: "Jedna", label_en: "One" }]));
    openTab("builder.sectionProps.tabTabs");
    const pl = document.querySelector<HTMLInputElement>(
      'input[placeholder="builder.tabsPane.labelPl"]',
    );
    const en = document.querySelector<HTMLInputElement>(
      'input[placeholder="builder.tabsPane.labelEn"]',
    );
    if (!pl || !en) throw new Error("test: brak pól etykiet zakładki");
    fireEvent.change(pl, { target: { value: "Program" } });
    fireEvent.change(en, { target: { value: "Programme" } });
    const items = node()?.tabs?.items ?? [];
    expect(items[0]?.label_pl).toBe("Program");
    expect(items[0]?.label_en).toBe("Programme");
  });

  it("usunięcie zakładki działa po identyfikatorze, nie po indeksie", () => {
    const { node } = renderPanel(
      withTabs([
        { id: "t1", label_pl: "Pierwsza", label_en: "First" },
        { id: "t2", label_pl: "Druga", label_en: "Second" },
      ]),
    );
    openTab("builder.sectionProps.tabTabs");
    fireEvent.click(screen.getAllByLabelText("builder.tabsPane.removeTab")[0]);
    const items = node()?.tabs?.items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("t2");
  });

  it.each([
    ["w górę", "builder.tabsPane.moveUp", 1, ["t2", "t1"]],
    ["w dół", "builder.tabsPane.moveDown", 0, ["t2", "t1"]],
  ])("przenosi zakładkę %s", (_label, aria, index, expected) => {
    const { node } = renderPanel(
      withTabs([
        { id: "t1", label_pl: "Pierwsza", label_en: "First" },
        { id: "t2", label_pl: "Druga", label_en: "Second" },
      ]),
    );
    openTab("builder.sectionProps.tabTabs");
    fireEvent.click(screen.getAllByLabelText(aria)[index]);
    expect((node()?.tabs?.items ?? []).map((t) => t.id)).toEqual(expected);
  });

  it("przeniesienie poza listę nie zmienia kolejności", () => {
    const { seen } = renderPanel(
      withTabs([
        { id: "t1", label_pl: "Pierwsza", label_en: "First" },
        { id: "t2", label_pl: "Druga", label_en: "Second" },
      ]),
    );
    openTab("builder.sectionProps.tabTabs");
    fireEvent.click(screen.getAllByLabelText("builder.tabsPane.moveUp")[0]);
    fireEvent.click(screen.getAllByLabelText("builder.tabsPane.moveDown").at(-1)!);
    for (const node of seen) {
      expect((node.tabs?.items ?? []).map((t) => t.id)).toEqual(["t1", "t2"]);
    }
  });

  it("ikona zakładki zapisuje się w jej pozycji", () => {
    const { node } = renderPanel(withTabs([{ id: "t1", label_pl: "Jedna", label_en: "One" }]));
    openTab("builder.sectionProps.tabTabs");
    fireEvent.change(screen.getByLabelText("ikona zakładki"), { target: { value: "star" } });
    expect(JSON.stringify(node()?.tabs ?? {})).toContain("star");
  });

  it("przypisanie kolumn do zakładek jest edytowalne dla każdego dziecka", () => {
    const withChildren = sectionOf({
      tabs: {
        enabled: true,
        items: [
          { id: "t1", label_pl: "Pierwsza", label_en: "First" },
          { id: "t2", label_pl: "Druga", label_en: "Second" },
        ],
      },
      children: [
        { id: "c1", kind: "column", span: { desktop: 6 }, children: [] },
        { id: "i1", kind: "inner-section", columns: [] },
      ],
    } as unknown as SectionNode);
    const { node } = renderPanel(withChildren);
    openTab("builder.sectionProps.tabTabs");
    expect(screen.getByText("builder.tabsPane.childAssign")).toBeInTheDocument();
    expect(screen.getByText("builder.tabsPane.columnN(n=1)")).toBeInTheDocument();
    expect(screen.getByText("builder.tabsPane.innerSecN(n=2)")).toBeInTheDocument();

    const assign = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).filter((s) =>
      s.querySelector('option[value="__all__"]'),
    );
    expect(assign).toHaveLength(2);
    fireEvent.change(assign[0], { target: { value: "t2" } });
    const children = (node()?.children ?? []) as Array<{ id: string; tabId?: string }>;
    expect(children[0]?.tabId).toBe("t2");
    // „Widoczne we wszystkich” USUWA przypisanie (nie zapisuje znacznika
    // `__all__` ani pustego napisu) - inaczej renderer szukałby zakładki
    // o takiej nazwie i ukrywał kolumnę wszędzie.
    fireEvent.change(assign[0], { target: { value: "__all__" } });
    const after = (node()?.children ?? []) as Array<{ id: string; tabId?: string }>;
    expect(after[0]?.tabId).toBeUndefined();
  });

  it("sekcja bez kolumn informuje, że nie ma czego przypisać", () => {
    renderPanel(
      sectionOf({
        tabs: { enabled: true, items: [{ id: "t1", label_pl: "A", label_en: "A" }] },
      } as Partial<SectionNode>),
    );
    openTab("builder.sectionProps.tabTabs");
    expect(screen.getByText("builder.tabsPane.noColumns")).toBeInTheDocument();
  });

  it("zakładka domyślna wybiera się z listy istniejących zakładek", () => {
    const { node } = renderPanel(
      sectionOf({
        tabs: {
          enabled: true,
          items: [
            { id: "t1", label_pl: "Pierwsza", label_en: "First" },
            { id: "t2", label_pl: "Druga", label_en: "Second" },
          ],
        },
      } as Partial<SectionNode>),
    );
    openTab("builder.sectionProps.tabTabs");
    const defaults = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).filter(
      (s) => s.querySelector('option[value="t2"]') && !s.querySelector('option[value="__all__"]'),
    );
    expect(defaults.length).toBeGreaterThan(0);
    fireEvent.change(defaults[0], { target: { value: "t2" } });
    expect(JSON.stringify(node()?.tabs ?? {})).toContain("t2");
  });

  it("zakładka bez etykiet pokazuje swój identyfikator", () => {
    renderPanel(
      sectionOf({
        tabs: { enabled: true, items: [{ id: "t-bez-nazwy" }] },
      } as Partial<SectionNode>),
    );
    openTab("builder.sectionProps.tabTabs");
    // Pusta pozycja na liście wyboru byłaby nieklikalna dla redakcji.
    expect(screen.getAllByText("t-bez-nazwy").length).toBeGreaterThan(0);
  });

  it("wariant, orientacja i kolor akcentu zapisują się w konfiguracji", () => {
    const { node } = renderPanel(withTabs([{ id: "t1", label_pl: "Jedna", label_en: "One" }]));
    openTab("builder.sectionProps.tabTabs");
    fireEvent.change(selectWithOption("vertical"), { target: { value: "vertical" } });
    fireEvent.change(selectWithOption("pills"), { target: { value: "pills" } });
    const json = JSON.stringify(node()?.tabs ?? {});
    expect(json).toContain("vertical");
    expect(json).toContain("pills");
  });
});

describe("AdvancedPane - identyfikatory sekcji", () => {
  it("HTML ID i klasa CSS zapisują się w węźle", () => {
    const { node } = renderPanel();
    openTab("builder.columnProps.tabAdvanced");
    const htmlId = screen.getByText("HTML ID").parentElement?.querySelector("input");
    const cssClass = screen.getByText("CSS class").parentElement?.querySelector("input");
    if (!htmlId || !cssClass) throw new Error("test: brak pól identyfikatorów");
    fireEvent.change(htmlId, { target: { value: "sekcja-hero" } });
    fireEvent.change(cssClass, { target: { value: "moja-klasa" } });
    const json = JSON.stringify(node() ?? {});
    expect(json).toContain("sekcja-hero");
    expect(json).toContain("moja-klasa");
  });

  it("wyczyszczenie identyfikatora zdejmuje go z dokumentu", () => {
    const { node } = renderPanel(
      sectionOf({ advanced: { htmlId: "sekcja-hero" } } as Partial<SectionNode>),
    );
    openTab("builder.columnProps.tabAdvanced");
    const htmlId = screen.getByText("HTML ID").parentElement?.querySelector("input");
    if (!htmlId) throw new Error("test: brak pola identyfikatora");
    fireEvent.change(htmlId, { target: { value: "" } });
    expect(JSON.stringify(node()?.advanced ?? {})).not.toContain("sekcja-hero");
  });
});

describe("StylePane - edytory stylu sekcji", () => {
  it("pokazuje tło, nakładkę, ramkę, przerywniki i typografię", () => {
    renderPanel();
    openTab("builder.columnProps.tabStyle");
    // Wszystkie pięć edytorów ma własne testy - tutaj pilnujemy, że panel
    // sekcji faktycznie je wpina (i to dla właściwego urządzenia).
    expect(screen.getAllByText(/builder.background.type/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/builder.border.type/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/builder.shape.style/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/builder.typography.headingColor/).length).toBeGreaterThan(0);
  });

  it("zapis w edytorze tła trafia do TŁA sekcji, nie do stylu", () => {
    const { node } = renderPanel();
    openTab("builder.columnProps.tabStyle");
    fireEvent.change(selectWithOption("slideshow"), { target: { value: "classic" } });
    // Tło sekcji to osobne pole węzła (`background`), a nie część `style` -
    // renderer czyta je oddzielnie razem z wariantem `backgroundHover`.
    expect(node()?.background?.type).toBe("classic");
  });
});

describe("panele sekcji - przejazd po wszystkich kontrolkach", () => {
  /**
   * Panele sekcji mają dziesiątki pól rozłożonych po zakładkach i sekcjach
   * zwijanych. Ten przejazd otwiera wszystko, co da się otworzyć, i zmienia
   * KAŻDĄ kontrolkę - kontrakt jest jeden: żaden zapis nie może wstawić do
   * dokumentu `undefined` ani zostawić w panelu wycieku „undefined”/„NaN”.
   * Dzięki temu pola rzadko używane (odstęp własny, wysokość w vh, wariant
   * zakładek) też mają pokrycie, zamiast czekać na zgłoszenie z redakcji.
   */
  function exercise(container: HTMLElement): void {
    for (const toggle of container.querySelectorAll<HTMLButtonElement>(
      'button[aria-expanded="false"]',
    )) {
      fireEvent.click(toggle);
    }
    for (const select of container.querySelectorAll<HTMLSelectElement>("select")) {
      for (const option of Array.from(select.querySelectorAll("option")).slice(0, 4)) {
        fireEvent.change(select, { target: { value: option.value } });
      }
    }
    for (const field of container.querySelectorAll<HTMLInputElement>("input, textarea")) {
      if (field.type === "file") continue;
      if (field.type === "checkbox" || field.type === "radio") {
        fireEvent.click(field);
        continue;
      }
      fireEvent.change(field, { target: { value: field.type === "number" ? "24" : "wartość" } });
    }
  }

  const SECTION_WITH_TABS = sectionOf({
    tabs: {
      enabled: true,
      items: [
        { id: "t1", label_pl: "Pierwsza", label_en: "First" },
        { id: "t2", label_pl: "Druga", label_en: "Second" },
      ],
    },
  } as Partial<SectionNode>);

  it.each([
    ["układ", "builder.columnProps.tabLayout"],
    ["styl", "builder.columnProps.tabStyle"],
    ["zakładki", "builder.sectionProps.tabTabs"],
    ["zaawansowane", "builder.columnProps.tabAdvanced"],
  ])("zakładka %s: każda kontrolka zapisuje wartość zdefiniowaną", (_label, key) => {
    const { container, seen } = renderPanel(SECTION_WITH_TABS);
    openTab(key);
    exercise(container);
    expect(container.textContent).not.toContain("undefined");
    expect(container.textContent).not.toContain("NaN");
    for (const node of seen) {
      expect(JSON.stringify(node)).not.toContain("undefined");
    }
  });

  it("wewnętrzne zakładki stylu (zwykły / hover) mają osobne zapisy", () => {
    const { container, node } = renderPanel();
    openTab("builder.columnProps.tabStyle");
    // Tło „hover” jest osobnym polem węzła - bez przejścia na tę zakładkę
    // połowa edytora tła nie istnieje w DOM.
    const inner = screen
      .getAllByRole("tab")
      .filter((t) => /builder.stylePane.hover/.test(t.textContent ?? ""));
    expect(inner.length).toBeGreaterThan(0);
    fireEvent.click(inner[0]);
    fireEvent.change(selectWithOption("slideshow"), { target: { value: "gradient" } });
    expect(node()?.backgroundHover?.type).toBe("gradient");
    expect(container.textContent).not.toContain("undefined");
  });

  it("przerywnik górny i dolny zapisują się osobno", () => {
    const { node, container } = renderPanel();
    openTab("builder.columnProps.tabStyle");
    const shapes = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).filter((s) =>
      s.querySelector('option[value="waves"]'),
    );
    expect(shapes.length).toBe(2);
    fireEvent.change(shapes[0], { target: { value: "waves" } });
    fireEvent.change(shapes[1], { target: { value: "tilt" } });
    // Dwa przerywniki, dwa pola - wspólny zapis dawałby ten sam kształt
    // na górze i na dole sekcji.
    expect(JSON.stringify(node() ?? {})).toContain("waves");
    expect(JSON.stringify(node() ?? {})).toContain("tilt");
  });
});
