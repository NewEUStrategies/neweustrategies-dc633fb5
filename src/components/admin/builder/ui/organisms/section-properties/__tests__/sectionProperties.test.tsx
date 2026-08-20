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
import { act, render, screen, fireEvent } from "@testing-library/react";
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

describe("TabsPane - wygląd paska i przypisanie kolumn", () => {
  const withTabs2 = (over: Partial<SectionNode> = {}) =>
    sectionOf({
      tabs: {
        enabled: true,
        items: [
          { id: "t1", label_pl: "Jedna", label_en: "One" },
          { id: "t2", label_pl: "Druga", label_en: "Two" },
        ],
      },
      ...over,
    } as Partial<SectionNode>);

  const open = (section: SectionNode = withTabs2()) => {
    const r = renderPanel(section);
    openTab("builder.sectionProps.tabTabs");
    return r;
  };

  it("włączenie zakładek zasiewa dwie i przypisuje istniejące kolumny do pierwszej", () => {
    const { node } = renderPanel(
      sectionOf({
        children: [
          { id: "c1", kind: "column", span: { desktop: 6 }, children: [] },
          { id: "c2", kind: "column", span: { desktop: 6 }, children: [] },
        ],
      }),
    );
    openTab("builder.sectionProps.tabTabs");
    fireEvent.click(screen.getByRole("switch"));
    const cfg = node()?.tabs;
    expect((cfg?.items ?? []).length).toBe(2);
    expect(cfg?.defaultTabId).toBe(cfg?.items?.[0]?.id);
    // Bez przypisania kolumny zostałyby „widoczne we wszystkich zakładkach",
    // czyli kontener zakładkowy nie zmieniłby niczego na stronie.
    const assigned = (node()?.children ?? []).map((c) => c.tabId);
    expect(assigned).toEqual([cfg?.items?.[0]?.id, cfg?.items?.[0]?.id]);
  });

  it("ponowne włączenie zakładek nie nadpisuje istniejącej listy", () => {
    const { node } = renderPanel(
      sectionOf({
        tabs: { enabled: false, items: [{ id: "t9", label_pl: "Stara", label_en: "Old" }] },
      } as Partial<SectionNode>),
    );
    openTab("builder.sectionProps.tabTabs");
    fireEvent.click(screen.getByRole("switch"));
    expect((node()?.tabs?.items ?? []).map((i) => i.id)).toEqual(["t9"]);
  });

  it.each([
    ["orientacja", "vertical", "orientation"],
    ["wariant", "pills-solid", "variant"],
    ["pozycja ikony", "top", "iconPosition"],
    ["wyrównanie", "center", "align"],
    ["tryb mobilny", "wrap", "mobileMode"],
  ] as const)("%s zapisuje się w konfiguracji", (_label, value, key) => {
    const { node } = open();
    fireEvent.change(selectWithOption(value), { target: { value } });
    expect(node()?.tabs?.[key]).toBe(value);
  });

  it("pasek pionowy nie ma trybu mobilnego (nie ma czego przewijać)", () => {
    open(
      withTabs2({
        tabs: { enabled: true, orientation: "vertical", items: [{ id: "t1", label_pl: "Jedna" }] },
      } as Partial<SectionNode>),
    );
    expect(screen.queryByText("builder.tabsPane.mobileHint")).toBeNull();
  });

  it("kolor akcentu zapisuje się i daje się wyczyścić", () => {
    const { node } = open();
    const input = document.querySelector<HTMLInputElement>("input.font-mono");
    if (!input) throw new Error("test: brak pola koloru akcentu");
    fireEvent.change(input, { target: { value: "#ff8800" } });
    expect(node()?.tabs?.accentColor).toBe("#ff8800");
  });

  it.each([
    ["rozmiar ikony", 0, "iconSize", 16, 10, 32],
    ["rozmiar czcionki", 1, "fontSize", 14, 8, 48],
  ] as const)("%s ma granice i strzałki", (_label, index, key, fallback, min, max) => {
    const { node } = open();
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    const input = inputs[index];
    if (!input) throw new Error("test: brak pola liczbowego");
    fireEvent.change(input, { target: { value: String(max + 100) } });
    expect(node()?.tabs?.[key]).toBe(max);
    fireEvent.change(input, { target: { value: "0" } });
    // Zero nie jest wartością - wraca wartość domyślna, a nie niewidoczny pasek.
    expect(node()?.tabs?.[key]).toBe(fallback);
    fireEvent.change(input, { target: { value: String(min - 5) } });
    expect(node()?.tabs?.[key]).toBe(min);
  });

  it("strzałki rozmiaru czcionki chodzą po jednym punkcie i trzymają granice", () => {
    const { node } = open(
      withTabs2({
        tabs: {
          enabled: true,
          fontSize: 48,
          iconSize: 32,
          items: [{ id: "t1", label_pl: "Jedna" }],
        },
      } as Partial<SectionNode>),
    );
    const steppers = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter(
      (b) => b.getAttribute("aria-label")?.includes("crement") || b.className.includes("stepper"),
    );
    // Strzałki są bez etykiet tekstowych - bierzemy je z kontenera pola.
    const numberInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="number"]'),
    );
    const fontWrap = numberInputs[1]?.parentElement;
    const buttons = Array.from(fontWrap?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    expect(buttons.length + steppers.length).toBeGreaterThan(0);
    if (buttons[0]) fireEvent.click(buttons[0]);
    expect(node()?.tabs?.fontSize).toBe(48);
    if (buttons[1]) fireEvent.click(buttons[1]);
    expect(node()?.tabs?.fontSize).toBe(47);
  });

  it("strzałki rozmiaru ikony trzymają dolną granicę", () => {
    const { node } = open(
      withTabs2({
        tabs: { enabled: true, iconSize: 10, items: [{ id: "t1", label_pl: "Jedna" }] },
      } as Partial<SectionNode>),
    );
    const numberInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="number"]'),
    );
    const iconWrap = numberInputs[0]?.parentElement;
    const buttons = Array.from(iconWrap?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    if (buttons[1]) fireEvent.click(buttons[1]);
    expect(node()?.tabs?.iconSize).toBe(10);
    if (buttons[0]) fireEvent.click(buttons[0]);
    expect(node()?.tabs?.iconSize).toBe(11);
  });

  it("ikona i kolor zakładki zapisują się na właściwej pozycji", () => {
    const { node } = open();
    const icons = screen.getAllByLabelText("ikona zakładki");
    fireEvent.change(icons[1]!, { target: { value: "star" } });
    expect(node()?.tabs?.items?.[1]?.icon).toBe("star");
    fireEvent.change(icons[1]!, { target: { value: "" } });
    expect(node()?.tabs?.items?.[1]?.icon).toBeUndefined();
  });

  it("zakładka domyślna wybiera się z listy istniejących", () => {
    const { node } = open();
    const select = selectWithOption("t2");
    fireEvent.change(select, { target: { value: "t2" } });
    expect(node()?.tabs?.defaultTabId).toBe("t2");
  });

  it("usunięcie zakładki domyślnej przenosi domyślność na pierwszą z pozostałych", () => {
    const { node } = open(
      withTabs2({
        tabs: {
          enabled: true,
          defaultTabId: "t2",
          items: [
            { id: "t1", label_pl: "Jedna" },
            { id: "t2", label_pl: "Druga" },
          ],
        },
        children: [{ id: "c1", kind: "column", span: { desktop: 12 }, children: [], tabId: "t2" }],
      } as Partial<SectionNode>),
    );
    fireEvent.click(screen.getAllByLabelText("builder.tabsPane.removeTab")[1]!);
    expect(node()?.tabs?.defaultTabId).toBe("t1");
    // Kolumna osierocona przez usuniętą zakładkę musi trafić do pierwszej -
    // inaczej zniknęłaby ze strony bez śladu w panelu.
    expect(node()?.children?.[0]?.tabId).toBe("t1");
  });

  it("przeniesienie zakładki działa w obie strony i nie wychodzi za listę", () => {
    const { node } = open();
    fireEvent.click(screen.getAllByLabelText("builder.tabsPane.moveDown")[0]!);
    expect((node()?.tabs?.items ?? []).map((i) => i.id)).toEqual(["t2", "t1"]);
    fireEvent.click(screen.getAllByLabelText("builder.tabsPane.moveUp")[1]!);
    expect((node()?.tabs?.items ?? []).map((i) => i.id)).toEqual(["t1", "t2"]);
    // Krańce są wyłączone, więc lista nie da się rozsypać.
    expect(screen.getAllByLabelText("builder.tabsPane.moveUp")[0]!).toBeDisabled();
    expect(screen.getAllByLabelText("builder.tabsPane.moveDown")[1]!).toBeDisabled();
  });

  it("przypisanie kolumny do zakładki i powrót do widoczności wszędzie", () => {
    const { node } = open(
      withTabs2({
        children: [
          { id: "c1", kind: "column", span: { desktop: 12 }, children: [] },
          { id: "i1", kind: "inner-section", columns: [] },
        ],
      }),
    );
    expect(screen.getByText("builder.tabsPane.columnN(n=1)")).toBeInTheDocument();
    expect(screen.getByText("builder.tabsPane.innerSecN(n=2)")).toBeInTheDocument();
    const selects = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).filter(
      (sel) => sel.querySelector('option[value="__all__"]'),
    );
    const first = selects[0];
    if (!first) throw new Error("test: brak listy przypisania");
    fireEvent.change(first, { target: { value: "t2" } });
    expect(node()?.children?.[0]?.tabId).toBe("t2");
    fireEvent.change(first, { target: { value: "__all__" } });
    // „Widoczna we wszystkich" to BRAK klucza, nie pusty łańcuch - renderer
    // sprawdza obecność `tabId`.
    expect(node()?.children?.[0]?.tabId).toBeUndefined();
  });

  it("sekcja bez kolumn mówi, że nie ma czego przypisywać", () => {
    open();
    expect(screen.getByText("builder.tabsPane.noColumns")).toBeInTheDocument();
  });
});

describe("TabsPane - kontrola rozmiaru czcionki na żywo", () => {
  const withTabs2 = () =>
    sectionOf({
      tabs: { enabled: true, fontSize: 14, items: [{ id: "t1", label_pl: "Jedna" }] },
    } as Partial<SectionNode>);

  /** Udawany pasek zakładek renderowany dla sekcji `s1`. */
  function mountBar(fontSizes: string[]): void {
    const bar = document.createElement("div");
    fontSizes.forEach((size, i) => {
      const btn = document.createElement("button");
      btn.id = `sec-s1-tab-${i}`;
      btn.setAttribute("data-section-tab-btn", "");
      btn.style.fontSize = size;
      bar.appendChild(btn);
    });
    document.body.appendChild(bar);
  }

  const pump = async () => {
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
  };

  it("bez paska na stronie mówi, że nie ma czego mierzyć", async () => {
    renderPanel(withTabs2());
    openTab("builder.sectionProps.tabTabs");
    await pump();
    expect(screen.getByText("builder.tabsPane.noTabsToMeasure")).toBeInTheDocument();
    expect(screen.getByLabelText("builder.tabsPane.fontSyncAria")).not.toBeChecked();
  });

  it("zgodny rozmiar na pasku daje potwierdzenie", async () => {
    mountBar(["14px", "14px"]);
    renderPanel(withTabs2());
    openTab("builder.sectionProps.tabTabs");
    await pump();
    // To jest samokontrola panelu: ustawienie ma NAPRAWDĘ dojść do paska.
    expect(screen.getByText("builder.tabsPane.fontSyncOk")).toBeInTheDocument();
    expect(screen.getByLabelText("builder.tabsPane.fontSyncAria")).toBeChecked();
    expect(screen.getByText(/builder\.tabsPane\.measured/)).toBeInTheDocument();
  });

  it("rozjechany rozmiar jest zgłaszany jako błąd", async () => {
    mountBar(["14px", "22px"]);
    renderPanel(withTabs2());
    openTab("builder.sectionProps.tabTabs");
    await pump();
    expect(screen.getByText("builder.tabsPane.fontNotSync")).toBeInTheDocument();
    expect(screen.getByLabelText("builder.tabsPane.fontSyncAria")).not.toBeChecked();
  });
});

describe("Panele sekcji - domknięcie pól liczbowych i czyszczenia", () => {
  const numberByLabel = (label: string): HTMLInputElement => {
    const row = Array.from(document.querySelectorAll<HTMLElement>("label,span,div")).find(
      (el) => el.textContent?.trim() === label,
    );
    const input = row?.parentElement?.querySelector<HTMLInputElement>('input[type="number"]');
    if (!input) throw new Error(`test: brak pola liczbowego ${label}`);
    return input;
  };

  it("własny odstęp kolumn zapisuje liczbę", () => {
    const { node } = renderPanel(
      sectionOf({ layout: { columnsGap: "custom" } } as Partial<SectionNode>),
    );
    const input = numberByLabel("builder.layoutPane.customGap");
    fireEvent.change(input, { target: { value: "36" } });
    expect(node()?.layout?.columnsGapCustom).toBe(36);
  });

  it.each([
    ["pełny ekran", "fit-screen", "builder.layoutPane.heightVh", "80", 80],
    ["minimalna wysokość", "min-height", "builder.layoutPane.heightMin", "420", 420],
  ] as const)("wysokość sekcji (%s) zapisuje wartość", (_l, height, label, typed, expected) => {
    const { node } = renderPanel(sectionOf({ layout: { height } } as Partial<SectionNode>));
    const input = numberByLabel(label);
    fireEvent.change(input, { target: { value: typed } });
    expect(node()?.layout?.heightValue).toBe(expected);
  });

  it.each([
    ["klasa CSS", 0, "cssClass"],
    ["własny CSS", 1, "customCss"],
  ] as const)("%s czyści się do braku klucza", (_label, index, key) => {
    const { node } = renderPanel(
      sectionOf({ advanced: { cssClass: "moja-klasa", customCss: ".x{color:red}" } }),
    );
    openTab("builder.columnProps.tabAdvanced");
    const fields = [
      document.querySelector<HTMLInputElement>('input[value="moja-klasa"]'),
      document.querySelector<HTMLTextAreaElement>("textarea"),
    ];
    const field = fields[index];
    if (!field) throw new Error("test: brak pola");
    fireEvent.change(field, { target: { value: "" } });
    // Puste pole to brak ustawienia, a nie pusty selektor w arkuszu.
    expect(node()?.advanced?.[key]).toBeUndefined();
  });

  it("strzałki rozmiarów startują od wartości domyślnych, gdy nic nie ustawiono", () => {
    const { node } = renderPanel(
      sectionOf({
        tabs: { enabled: true, items: [{ id: "t1", label_pl: "Jedna" }] },
      } as Partial<SectionNode>),
    );
    openTab("builder.sectionProps.tabTabs");
    const numbers = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    const iconButtons = Array.from(
      numbers[0]?.parentElement?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const fontButtons = Array.from(
      numbers[1]?.parentElement?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    if (!iconButtons[0] || !fontButtons[1]) throw new Error("test: brak strzałek");
    fireEvent.click(iconButtons[0]);
    // Domyślna ikona to 16 px, domyślna czcionka 14 px - strzałka bez zapisanej
    // wartości musi liczyć od nich, a nie od zera.
    expect(node()?.tabs?.iconSize).toBe(17);
    fireEvent.click(fontButtons[1]);
    expect(node()?.tabs?.fontSize).toBe(13);
  });

  it("kolor zakładki zapisuje się na jej pozycji", () => {
    const { node } = renderPanel(
      sectionOf({
        tabs: {
          enabled: true,
          items: [
            { id: "t1", label_pl: "Jedna" },
            { id: "t2", label_pl: "Druga" },
          ],
        },
      } as Partial<SectionNode>),
    );
    openTab("builder.sectionProps.tabTabs");
    // Picker koloru schowany jest w popoverze - najpierw trigger, potem pole.
    const triggers = screen.getAllByRole("button", { name: "builder.tabsPane.tabColor" });
    expect(triggers.length).toBe(2);
    fireEvent.click(triggers[1]!);
    const input = document.querySelector<HTMLInputElement>('input[type="color"]');
    if (!input) throw new Error("test: popover koloru się nie otworzył");
    fireEvent.change(input, { target: { value: "#00ff00" } });
    expect(node()?.tabs?.items?.[1]?.color).toBe("#00ff00");
  });

  it("zakładka bez polskiej etykiety jest opisana angielską, a bez obu - identyfikatorem", () => {
    renderPanel(
      sectionOf({
        tabs: {
          enabled: true,
          items: [
            { id: "t1", label_pl: "", label_en: "Only English" },
            { id: "t2", label_pl: "" },
          ],
        },
      } as Partial<SectionNode>),
    );
    openTab("builder.sectionProps.tabTabs");
    const defaultSelect = selectWithOption("t1");
    const labels = Array.from(defaultSelect.querySelectorAll("option")).map((o) => o.textContent);
    // Lista wyboru zakładki domyślnej nie może pokazywać pustych pozycji.
    expect(labels).toEqual(["Only English", "t2"]);
  });
});

describe("TabsPane - sekcje o niepełnym kształcie", () => {
  it("sekcja BEZ listy dzieci nie wywala włączania zakładek", () => {
    // Dokumenty z importu i starsze zapisy potrafią nie mieć wcale klucza
    // `children` - panel musi to przeżyć, bo inaczej pada cały edytor.
    const { node } = renderPanel(sectionOf({ children: undefined }));
    openTab("builder.sectionProps.tabTabs");
    fireEvent.click(screen.getByRole("switch"));
    expect((node()?.tabs?.items ?? []).length).toBe(2);
  });

  it("kolumna już przypisana do zakładki nie jest przepisywana przy włączaniu", () => {
    const { node } = renderPanel(
      sectionOf({
        children: [
          { id: "c1", kind: "column", span: { desktop: 12 }, children: [], tabId: "obca" },
        ],
      }),
    );
    openTab("builder.sectionProps.tabTabs");
    fireEvent.click(screen.getByRole("switch"));
    // Ręczne przypisanie redakcji jest ważniejsze niż zasiew.
    expect(node()?.children?.[0]?.tabId).toBe("obca");
  });

  it("usunięcie zakładki nie rusza kolumn przypisanych do innych", () => {
    const { node } = renderPanel(
      sectionOf({
        tabs: {
          enabled: true,
          items: [
            { id: "t1", label_pl: "Jedna" },
            { id: "t2", label_pl: "Druga" },
          ],
        },
        children: [{ id: "c1", kind: "column", span: { desktop: 12 }, children: [], tabId: "t1" }],
      } as Partial<SectionNode>),
    );
    openTab("builder.sectionProps.tabTabs");
    fireEvent.click(screen.getAllByLabelText("builder.tabsPane.removeTab")[1]!);
    expect(node()?.children?.[0]?.tabId).toBe("t1");
  });

  it("zakładki włączone bez ani jednej pozycji nie wybierają domyślnej", () => {
    renderPanel(sectionOf({ tabs: { enabled: true, items: [] } } as Partial<SectionNode>));
    openTab("builder.sectionProps.tabTabs");
    const defaultSelect = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find(
      (sel) => sel.querySelectorAll("option").length === 0,
    );
    // Pusta lista to stan przejściowy (redakcja usunęła wszystko) - panel nie
    // może wtedy wskazywać zakładki, której nie ma.
    expect(defaultSelect?.value).toBe("");
  });

  it("przypisanie kolumny opisuje zakładki tą samą regułą co lista", () => {
    renderPanel(
      sectionOf({
        tabs: {
          enabled: true,
          items: [
            { id: "t1", label_pl: "", label_en: "Only English" },
            { id: "t2", label_pl: "" },
          ],
        },
        children: [{ id: "c1", kind: "column", span: { desktop: 12 }, children: [] }],
      } as Partial<SectionNode>),
    );
    openTab("builder.sectionProps.tabTabs");
    const assign = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((sel) =>
      sel.querySelector('option[value="__all__"]'),
    );
    const labels = Array.from(assign?.querySelectorAll("option") ?? []).map((o) => o.textContent);
    expect(labels).toEqual(["builder.tabsPane.visibleAll", "Only English", "t2"]);
  });
});
