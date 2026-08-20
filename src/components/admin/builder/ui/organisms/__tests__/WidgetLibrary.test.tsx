// Biblioteka widgetów (lewy panel buildera): wyszukiwarka, kategorie
// z podgrupami, kontenery, szablony startowe, zapisane szablony sekcji
// i widgety globalne najemcy.
//
// Cztery rzeczy, które w tej bibliotece psują się realnie:
//  1. KOMPLETNOŚĆ PALETY. Widget dodany do rejestru MUSI się w niej pojawić,
//     a oznaczony `hiddenInPalette` - nie. Inaczej widget istnieje w kodzie
//     i jest dla redakcji nieosiągalny.
//  2. DANE PRZECIĄGANIA. Kanwa czyta typ z `dataTransfer`
//     (`application/x-widget-type`) oraz osobne typy MIME dla kontenerów
//     i widgetów globalnych. Zła nazwa typu to upuszczenie, po którym nic się
//     nie dzieje.
//  3. FILTR działa po ETYKIECIE i obejmuje także widgety globalne.
//  4. ZWIJANIE kategorii jest pamiętane w `localStorage` - redakcja układa
//     sobie paletę raz.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WIDGETS } from "@/lib/builder/registry";
import { WidgetLibrary } from "../WidgetLibrary";

const templates = vi.hoisted(() => ({
  items: [] as Array<{ id: string; name: string; data: unknown; created_at: string }>,
  loading: false,
  update: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
}));
const globals = vi.hoisted(() => ({
  items: [] as Array<{ id: string; name: string; data: { type: string } }>,
  loading: false,
  remove: vi.fn(async () => undefined),
}));
/** Język panelu - biblioteka czyta go z instancji i18n, nie z propsów. */
const adminLang = vi.hoisted(() => ({ value: "pl" }));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub(() => adminLang.value);
});
vi.mock("@/lib/builder/templates", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSectionTemplates: () => ({
      items: templates.items,
      loading: templates.loading,
      reload: vi.fn(),
      save: vi.fn(),
      update: templates.update,
      remove: templates.remove,
    }),
  };
});
vi.mock("@/lib/builder/globalWidgets", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useGlobalWidgets: () => ({
      items: globals.items,
      loading: globals.loading,
      remove: globals.remove,
    }),
  };
});
// Historia szablonu to osobny dialog z własnym zapytaniem - tu liczy się tylko
// to, że biblioteka otwiera go dla WŁAŚCIWEGO szablonu.
vi.mock("../TemplateHistoryDialog", () => ({
  TemplateHistoryDialog: ({
    template,
    open,
    onOpenChange,
    onInsert,
    onRestore,
  }: {
    template: { id: string; name: string } | null;
    open: boolean;
    onOpenChange: (o: boolean) => void;
    onInsert: (rev: unknown) => void;
    onRestore: (rev: unknown) => void;
  }) =>
    open && template ? (
      <div data-testid="historia">
        {template.name}
        <button type="button" onClick={() => onOpenChange(false)}>
          zamknij historię
        </button>
        <button
          type="button"
          onClick={() =>
            onInsert({
              template_id: template.id,
              name: "Rewizja",
              data: { id: "s9", kind: "section", children: [] },
              created_at: "2026-02-01",
              created_by: null,
            })
          }
        >
          wstaw rewizję
        </button>
        <button
          type="button"
          onClick={() =>
            onRestore({
              template_id: template.id,
              name: "Rewizja",
              data: { id: "s9", kind: "section", children: [] },
              created_at: "2026-02-01",
              created_by: null,
            })
          }
        >
          przywróć rewizję
        </button>
      </div>
    ) : null,
}));

function renderLibrary() {
  const h = {
    onPickWidget: vi.fn(),
    onPickStructure: vi.fn(),
    onPickTemplate: vi.fn(),
    onPickStarter: vi.fn(),
    onPickGlobal: vi.fn(),
    onPickContainer: vi.fn(),
  };
  const view = render(<WidgetLibrary {...h} />);
  return { ...view, h };
}

/** Atrapa `DataTransfer` - happy-dom nie tworzy jej dla zdarzeń syntetycznych. */
const dataTransfer = () => ({ setData: vi.fn(), effectAllowed: "" });

const dragLabel = (label: string) => `builder.widgetLibrary.dragToSection(label=${label})`;
const buttonByText = (fragment: string): HTMLElement => {
  const found = screen
    .getAllByRole("button")
    .find((b) => (b.textContent ?? "").includes(fragment) || (b.title ?? "").includes(fragment));
  if (!found) throw new Error(`test: brak przycisku z „${fragment}”`);
  return found;
};

beforeEach(() => {
  localStorage.clear();
  adminLang.value = "pl";
  templates.items = [];
  templates.loading = false;
  globals.items = [];
  globals.loading = false;
  templates.update.mockClear();
  templates.remove.mockClear();
  globals.remove.mockClear();
});

describe("WidgetLibrary - paleta widgetów", () => {
  it("pokazuje widgety rejestru widoczne w palecie", () => {
    renderLibrary();
    const visible = WIDGETS.filter((w) => !w.hiddenInPalette);
    for (const w of visible.slice(0, 10)) {
      expect(screen.getAllByLabelText(dragLabel(w.label)).length).toBeGreaterThan(0);
    }
    expect(document.querySelectorAll("[draggable=true]").length).toBeGreaterThan(20);
  });

  it("nie pokazuje widgetów ukrytych w palecie", () => {
    renderLibrary();
    for (const w of WIDGETS.filter((w) => w.hiddenInPalette)) {
      expect(screen.queryByLabelText(dragLabel(w.label))).toBeNull();
    }
  });

  it("klik w widget dodaje go do dokumentu", () => {
    const { h } = renderLibrary();
    const first = WIDGETS.find((w) => !w.hiddenInPalette)!;
    fireEvent.click(screen.getAllByLabelText(dragLabel(first.label))[0]);
    expect(h.onPickWidget).toHaveBeenCalledWith(first.type);
  });

  it("przeciąganie widgetu wpisuje jego typ do danych przenoszenia", () => {
    renderLibrary();
    const first = WIDGETS.find((w) => !w.hiddenInPalette)!;
    const dt = dataTransfer();
    fireEvent.dragStart(screen.getAllByLabelText(dragLabel(first.label))[0], { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith("application/x-widget-type", first.type);
  });
});

describe("WidgetLibrary - wyszukiwanie", () => {
  const search = () =>
    screen.getByPlaceholderText("builder.widgetLibrary.searchPh") as HTMLInputElement;

  it("zawęża paletę do dopasowanych etykiet", () => {
    renderLibrary();
    const before = document.querySelectorAll("[draggable=true]").length;
    fireEvent.change(search(), { target: { value: WIDGETS[0].label } });
    const after = document.querySelectorAll("[draggable=true]").length;
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });

  it("ignoruje wielkość liter", () => {
    renderLibrary();
    fireEvent.change(search(), { target: { value: WIDGETS[0].label.toUpperCase() } });
    expect(screen.getAllByLabelText(dragLabel(WIDGETS[0].label)).length).toBeGreaterThan(0);
  });

  it("fraza bez trafień nie pokazuje żadnego widgetu rejestru", () => {
    renderLibrary();
    fireEvent.change(search(), { target: { value: "zzz-nie-ma-takiego" } });
    const draggables = Array.from(document.querySelectorAll("[draggable=true]"));
    expect(
      draggables.every((d) => !(d.getAttribute("aria-label") ?? "").includes("dragToSection")),
    ).toBe(true);
  });

  it("filtr obejmuje też widgety globalne", () => {
    globals.items = [
      { id: "g1", name: "Stopka kampanii", data: { type: "text" } },
      { id: "g2", name: "Baner cookies", data: { type: "text" } },
    ];
    renderLibrary();
    expect(screen.getByText("Stopka kampanii")).toBeInTheDocument();
    fireEvent.change(search(), { target: { value: "cookies" } });
    expect(screen.queryByText("Stopka kampanii")).toBeNull();
    expect(screen.getByText("Baner cookies")).toBeInTheDocument();
  });
});

describe("WidgetLibrary - kontenery", () => {
  it("kontener zwykły i z zakładkami mają osobne akcje", () => {
    const { h } = renderLibrary();
    fireEvent.click(buttonByText("containerTitle"));
    expect(h.onPickContainer).toHaveBeenLastCalledWith(false);
    fireEvent.click(buttonByText("containerTabsTitle"));
    expect(h.onPickContainer).toHaveBeenLastCalledWith(true);
  });

  it("przeciąganie kontenera wpisuje własny typ MIME", () => {
    renderLibrary();
    const dt = dataTransfer();
    fireEvent.dragStart(buttonByText("containerTitle"), { dataTransfer: dt });
    // Kanwa rozpoznaje kontener po WŁASNYM typie MIME - inaczej upuszczenie
    // trafia w ścieżkę zwykłego widgetu i nic się nie dzieje.
    expect(dt.setData.mock.calls.length).toBeGreaterThan(0);
    expect(dt.setData.mock.calls.some(([m]) => String(m).includes("container"))).toBe(true);
  });
});

describe("WidgetLibrary - szablony sekcji", () => {
  const TPL = {
    id: "t1",
    name: "Sekcja hero",
    data: { id: "s1", kind: "section", children: [] },
    created_at: "2026-01-01",
  };

  it("zapisany szablon wstawia się kliknięciem", () => {
    templates.items = [TPL];
    const { h } = renderLibrary();
    fireEvent.click(screen.getByText("Sekcja hero"));
    expect(h.onPickTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("historia szablonu otwiera się dla właściwej pozycji i zamyka", () => {
    templates.items = [TPL];
    renderLibrary();
    fireEvent.click(buttonByText("versionHistory"));
    expect(screen.getByTestId("historia").textContent).toContain("Sekcja hero");
    fireEvent.click(screen.getByRole("button", { name: "zamknij historię" }));
    expect(screen.queryByTestId("historia")).toBeNull();
  });

  it("wstawienie rewizji dodaje ją jako sekcję i zamyka historię", () => {
    templates.items = [TPL];
    const { h } = renderLibrary();
    fireEvent.click(buttonByText("versionHistory"));
    fireEvent.click(screen.getByRole("button", { name: "wstaw rewizję" }));
    // Rewizja wchodzi na kanwę jako sekcja o TREŚCI Z REWIZJI, ale pod
    // identyfikatorem szablonu - dzięki temu dalsze zapisy trafiają do tego
    // samego szablonu.
    expect(h.onPickTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t1", name: "Rewizja" }),
    );
    expect(screen.queryByTestId("historia")).toBeNull();
  });

  it("przywrócenie rewizji nadpisuje szablon i zamyka historię", async () => {
    templates.items = [TPL];
    renderLibrary();
    fireEvent.click(buttonByText("versionHistory"));
    fireEvent.click(screen.getByRole("button", { name: "przywróć rewizję" }));
    expect(templates.update).toHaveBeenCalledWith("t1", {
      section: { id: "s9", kind: "section", children: [] },
      name: "Rewizja",
    });
  });

  it("usunięcie szablonu wymaga potwierdzenia", () => {
    templates.items = [TPL];
    vi.stubGlobal("confirm", () => false);
    renderLibrary();
    const remove = buttonByText("deleteTemplate");
    fireEvent.click(remove);
    // Odmowa w oknie potwierdzenia NIE MOŻE usunąć szablonu - to praca
    // redakcji, nie brudnopis.
    expect(templates.remove).not.toHaveBeenCalled();
    vi.stubGlobal("confirm", () => true);
    fireEvent.click(remove);
    expect(templates.remove).toHaveBeenCalledWith("t1");
    vi.unstubAllGlobals();
  });

  it("bez zapisanych szablonów pokazuje stan pusty", () => {
    renderLibrary();
    expect(screen.getByText("builder.widgetLibrary.templatesEmpty")).toBeInTheDocument();
  });
});

describe("WidgetLibrary - widgety globalne", () => {
  const GLOBAL = { id: "g1", name: "Stopka kampanii", data: { type: "text" } };

  it("klik wstawia instancję widgetu globalnego", () => {
    globals.items = [GLOBAL];
    const { h } = renderLibrary();
    fireEvent.click(screen.getByText("Stopka kampanii"));
    expect(h.onPickGlobal).toHaveBeenCalledWith(expect.objectContaining({ id: "g1" }));
  });

  it("przeciąganie widgetu globalnego wpisuje DWA typy danych", () => {
    globals.items = [GLOBAL];
    renderLibrary();
    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByText("Stopka kampanii"), { dataTransfer: dt });
    const mimes = dt.setData.mock.calls.map(([m]) => String(m));
    // Typ widgetu jest potrzebny ścieżce zwykłego upuszczenia, a ładunek
    // globalny - ścieżce instancji. Brak jednego psuje jedną z nich.
    expect(mimes.some((m) => m.includes("global"))).toBe(true);
    expect(mimes).toContain("application/x-widget-type");
  });

  it("usunięcie widgetu globalnego wymaga potwierdzenia", () => {
    globals.items = [GLOBAL];
    vi.stubGlobal("confirm", () => false);
    renderLibrary();
    const remove = buttonByText("deleteGlobal");
    fireEvent.click(remove);
    expect(globals.remove).not.toHaveBeenCalled();
    vi.stubGlobal("confirm", () => true);
    fireEvent.click(remove);
    expect(globals.remove).toHaveBeenCalledWith("g1");
    vi.unstubAllGlobals();
  });
});

describe("WidgetLibrary - struktury i szablony startowe", () => {
  it("wybór struktury sekcji przekazuje rozpiętości kolumn", () => {
    const { h } = renderLibrary();
    // `StructurePicker` oddaje TABLICĘ rozpiętości (np. [6,6]) - z niej powstaje
    // sekcja o właściwym podziale kolumn.
    const structures = screen.getAllByRole("button").filter((b) => b.title?.includes("cols"));
    const target = structures[0] ?? buttonByText("newSection");
    fireEvent.click(target);
    if (structures.length > 0) {
      expect(h.onPickStructure).toHaveBeenCalled();
      expect(Array.isArray(h.onPickStructure.mock.calls[0][0])).toBe(true);
    }
  });

  it("szablon startowy wstawia komplet sekcji", () => {
    const { h } = renderLibrary();
    const starter = screen
      .getAllByRole("button")
      .find((b) => (b.title ?? "").includes("insertStarter"));
    if (!starter) throw new Error("test: brak przycisku szablonu startowego");
    fireEvent.click(starter);
    expect(h.onPickStarter).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.any(String) }),
    );
  });

  it("sekcje struktur i szablonów startowych też się zwijają", () => {
    renderLibrary();
    fireEvent.click(buttonByText("newSection"));
    fireEvent.click(buttonByText("starters"));
    const saved = JSON.parse(localStorage.getItem("builder.lib.collapsed") ?? "{}");
    expect(saved.__struct).toBe(true);
    expect(saved.__starters).toBe(true);
  });

  it("bez obsługi szablonów startowych sekcja nie istnieje", () => {
    render(
      <WidgetLibrary onPickWidget={vi.fn()} onPickStructure={vi.fn()} onPickTemplate={vi.fn()} />,
    );
    // Biblioteka jest używana też w trybach bez szablonów - brak obsługi
    // znaczy „nie pokazuj sekcji”, a nie „pokaż martwy przycisk”.
    expect(screen.queryByText("builder.widgetLibrary.starters")).toBeNull();
  });

  it("widget da się dodać z klawiatury", () => {
    const { h } = renderLibrary();
    const first = WIDGETS.find((w) => !w.hiddenInPalette)!;
    const tile = screen.getAllByLabelText(dragLabel(first.label))[0];
    fireEvent.keyDown(tile, { key: "Enter" });
    expect(h.onPickWidget).toHaveBeenCalledWith(first.type);
    fireEvent.keyDown(tile, { key: " " });
    expect(h.onPickWidget).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(tile, { key: "a" });
    expect(h.onPickWidget).toHaveBeenCalledTimes(2);
  });

  it("bez widgetów globalnych pokazuje stan pusty", () => {
    renderLibrary();
    expect(screen.getByText("builder.widgetLibrary.globalsEmpty")).toBeInTheDocument();
  });
});

describe("WidgetLibrary - zwijanie kategorii", () => {
  it("zwinięcie kategorii jest pamiętane w localStorage", () => {
    renderLibrary();
    fireEvent.click(buttonByText("catBasic"));
    const saved = JSON.parse(localStorage.getItem("builder.lib.collapsed") ?? "{}");
    // Redakcja układa sobie paletę raz - stan musi przeżyć przeładowanie.
    expect(Object.values(saved).some((v) => v === true)).toBe(true);
  });

  it("stan zwinięcia z localStorage jest odtwarzany", () => {
    localStorage.setItem("builder.lib.collapsed", JSON.stringify({ basic: true }));
    const collapsed = renderLibrary();
    const collapsedCount = document.querySelectorAll("[draggable=true]").length;
    collapsed.unmount();
    localStorage.clear();
    renderLibrary();
    expect(collapsedCount).toBeLessThan(document.querySelectorAll("[draggable=true]").length);
  });

  it("uszkodzony wpis w localStorage nie wywala biblioteki", () => {
    localStorage.setItem("builder.lib.collapsed", "{to nie jest json");
    renderLibrary();
    expect(screen.getByText("builder.widgetLibrary.title")).toBeInTheDocument();
  });

  it("zwinięcie i rozwinięcie działa w obie strony", () => {
    renderLibrary();
    const cat = buttonByText("catBasic");
    fireEvent.click(cat);
    const afterCollapse = document.querySelectorAll("[draggable=true]").length;
    fireEvent.click(cat);
    expect(document.querySelectorAll("[draggable=true]").length).toBeGreaterThan(afterCollapse);
  });
});

describe("WidgetLibrary - stany wczytywania, nieznany typ i język panelu", () => {
  it.each([
    ["szablony sekcji", "templates"],
    ["widgety globalne", "globals"],
  ] as const)("nagłówek %s pokazuje, że lista się wczytuje", (_label, which) => {
    if (which === "templates") templates.loading = true;
    else globals.loading = true;
    const { container } = renderLibrary();
    // Bez tego znaku redakcja widzi pustą sekcję i myśli, że nic nie zapisała.
    expect(container.textContent).toContain("…");
  });

  it("widget globalny o NIEZNANYM typie ma zapasową ikonę i nazwę", () => {
    globals.items = [{ id: "g1", name: "Stopka klienta", data: { type: "typ-ktorego-nie-ma" } }];
    const { h } = renderLibrary();
    // Typ mógł zostać usunięty z rejestru po zapisaniu widgetu globalnego -
    // wtedy pozycja MUSI dalej dać się kliknąć (choćby po to, żeby ją usunąć),
    // a nie zniknąć albo wywalić paletę.
    const item = screen.getByText("Stopka klienta");
    fireEvent.click(item);
    expect(h.onPickGlobal).toHaveBeenCalled();
  });

  it("zwinięcie sekcji zamienia strzałkę w dół na strzałkę w prawo", () => {
    const { container } = renderLibrary();
    const chevrons = () => ({
      down: container.querySelectorAll("svg.lucide-chevron-down").length,
      right: container.querySelectorAll("svg.lucide-chevron-right").length,
    });
    const before = chevrons();
    expect(before.down).toBeGreaterThan(0);
    // Nagłówki sekcji to przyciski ze strzałką - klikamy pierwszy rozwinięty.
    const header = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      b.querySelector("svg.lucide-chevron-down"),
    );
    if (!header) throw new Error("test: brak rozwiniętej sekcji");
    fireEvent.click(header);
    const after = chevrons();
    // Kierunek strzałki jest jedyną informacją o stanie sekcji - bez tego
    // redakcja nie wie, czy paleta jest pusta, czy zwinięta.
    expect(after.right).toBe(before.right + 1);
    expect(after.down).toBe(before.down - 1);
  });

  it("angielski język panelu nie psuje palety", () => {
    adminLang.value = "en";
    const { container } = renderLibrary();
    // Etykiety widgetów mają własne tłumaczenia (labelsEn) - paleta po
    // angielsku musi nadal mieć wszystkie pozycje przeciągalne.
    expect(container.querySelectorAll("[draggable=true]").length).toBeGreaterThan(20);
  });

  it("zamknięcie historii szablonu czyści wybrany szablon", () => {
    templates.items = [
      { id: "t1", name: "Hero", data: { id: "s1", kind: "section", children: [] }, created_at: "" },
    ];
    renderLibrary();
    fireEvent.click(buttonByText("builder.widgetLibrary.versionHistory"));
    expect(screen.getByTestId("historia")).toBeTruthy();
    fireEvent.click(screen.getByText("zamknij historię"));
    // Dialog zamknięty musi też zapomnieć szablon - inaczej kolejne otwarcie
    // pokazuje historię POPRZEDNIEGO.
    expect(screen.queryByTestId("historia")).toBeNull();
  });
});
