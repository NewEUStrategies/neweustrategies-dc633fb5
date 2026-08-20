// Wszystkie operacje na drzewie dokumentu buildera. Czysta logika siedzi
// w `@/lib/builder/operations` (ma własne testy); ten hak spina ją z cyklem
// „głęboka kopia -> mutacja -> sanityzacja -> wpis do historii” i z efektami,
// które dotykają stanu Reacta (zaznaczenie po wstawieniu, pytanie o nazwę
// szablonu, kolumna w ognisku).
//
// Test przypina właśnie TĘ warstwę spinającą, bo tu mieszkają realne pułapki:
//  1. KAŻDA operacja przechodzi przez `safeParseBuilderDoc`, więc uszkodzony
//     dokument nie propaguje się dalej.
//  2. WSTAWIENIE WIDGETU ZMIENIA ZAZNACZENIE - bez tego panel właściwości
//     pokazuje poprzedni widget i redaktor edytuje nie to, co dodał.
//  3. ETYKIETY OPERACJI lecą do historii, bo z nich powstaje komunikat
//     „Cofnięto: Dodano sekcję”. Brak etykiety to nieczytelne cofanie.
//  4. EDYCJE WŁAŚCIWOŚCI ZWIJAJĄ SIĘ (`coalesceKey`) - seria naciśnięć
//     w jednym polu to JEDEN krok cofnięcia, nie trzydzieści.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { BuilderDocument, ColumnNode, SectionNode, WidgetNode } from "@/lib/builder/types";
import type { History, SetOptions } from "@/hooks/useHistory";
import type { Selection } from "../../organisms/builder/types";
import { useBuilderOperations } from "../useBuilderOperations";

const prompt = vi.hoisted(() => vi.fn(async () => "Nazwa"));
const templateSave = vi.hoisted(() => vi.fn(async () => true));
const globalSave = vi.hoisted(() => vi.fn(async () => "g-new"));
const experimentCreate = vi.hoisted(() => vi.fn(async () => "exp-1"));
const experimentSetStatus = vi.hoisted(() => vi.fn(async () => true));
const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastInfo = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/lib/appDialogs", () => ({ promptDialog: prompt }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess, info: toastInfo },
}));
vi.mock("@/lib/builder/templates", () => ({
  useSectionTemplates: () => ({ items: [], loading: false, save: templateSave }),
}));
vi.mock("@/lib/builder/globalWidgets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/builder/globalWidgets")>();
  return { ...actual, useGlobalWidgets: () => ({ items: [], save: globalSave }) };
});
vi.mock("@/lib/builder/experiments", () => ({
  useExperimentsAdmin: () => ({
    items: [],
    create: experimentCreate,
    setStatus: experimentSetStatus,
  }),
}));

const w = (id: string, type: WidgetNode["type"] = "text"): WidgetNode => ({
  id,
  kind: "widget",
  type,
  content: {},
});
const col = (id: string, children: WidgetNode[] = []): ColumnNode => ({
  id,
  kind: "column",
  span: { desktop: 12 },
  children,
});
const sec = (id: string, children: SectionNode["children"]): SectionNode => ({
  id,
  kind: "section",
  children,
});

function baseDoc(): BuilderDocument {
  return {
    version: 1,
    sections: [sec("s1", [col("c1", [w("w1")])]), sec("s2", [col("c2", [])])],
  };
}

interface Recorded {
  doc: BuilderDocument;
  opts?: SetOptions;
}

/**
 * Historia w kształcie kontraktu `useHistory`, ale zapisująca wywołania -
 * dzięki temu test widzi ETYKIETY i klucze zwijania, a nie tylko wynik.
 */
function setup(selection: Selection = { kind: null, id: null }, initial = baseDoc()) {
  const recorded: Recorded[] = [];
  const state = { doc: initial };
  const setSelection = vi.fn();
  const history: History<BuilderDocument> = {
    state: initial,
    set: (next, opts) => {
      const value = typeof next === "function" ? next(state.doc) : next;
      state.doc = value;
      recorded.push({ doc: value, opts });
    },
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    reset: vi.fn(),
    clear: vi.fn(),
    lastLabel: null,
    nextLabel: null,
  };
  const view = renderHook(
    ({ doc }: { doc: BuilderDocument }) =>
      useBuilderOperations({ history, doc, selection, setSelection, device: "desktop" }),
    { initialProps: { doc: initial } },
  );
  return {
    ...view,
    state,
    recorded,
    setSelection,
    last: () => recorded.at(-1),
  };
}

const sectionIds = (d: BuilderDocument) => d.sections.map((s) => s.id);
const widgetsIn = (d: BuilderDocument, si = 0, ci = 0): WidgetNode[] =>
  ((d.sections[si]?.children[ci] as ColumnNode | undefined)?.children ?? []) as WidgetNode[];

beforeEach(() => {
  prompt.mockClear();
  prompt.mockResolvedValue("Nazwa");
  templateSave.mockClear();
  globalSave.mockClear();
  globalSave.mockResolvedValue("g-new");
  experimentCreate.mockClear();
  experimentCreate.mockResolvedValue("exp-1");
  experimentSetStatus.mockClear();
  toastError.mockClear();
  toastSuccess.mockClear();
  toastInfo.mockClear();
});

describe("useBuilderOperations - kolumna w ognisku", () => {
  it("zaznaczona kolumna jest kolumną w ognisku", () => {
    const { result } = setup({ kind: "column", id: "c2" });
    expect(result.current.focusedColumn?.id).toBe("c2");
  });

  it("zaznaczony widget wskazuje kolumnę, w której leży", () => {
    const { result } = setup({ kind: "widget", id: "w1" });
    expect(result.current.focusedColumn?.id).toBe("c1");
  });

  it("bez zaznaczenia bierzemy pierwszą kolumnę dokumentu", () => {
    const { result } = setup({ kind: null, id: null });
    // Dzięki temu „Dodaj widget” z biblioteki zawsze ma gdzie wstawić element.
    expect(result.current.focusedColumn?.id).toBe("c1");
  });

  it("pierwszą kolumną może być kolumna sekcji wewnętrznej", () => {
    const doc: BuilderDocument = {
      version: 1,
      sections: [
        sec("s1", [{ id: "i1", kind: "inner-section", columns: [col("ic1", []), col("ic2", [])] }]),
      ],
    };
    const { result } = setup({ kind: null, id: null }, doc);
    expect(result.current.focusedColumn?.id).toBe("ic1");
  });

  it("dokument bez kolumn nie ma kolumny w ognisku", () => {
    const { result } = setup({ kind: null, id: null }, { version: 1, sections: [] });
    expect(result.current.focusedColumn).toBeNull();
  });

  it("zaznaczenie wskazujące nieistniejącą kolumnę daje brak ogniska", () => {
    const { result } = setup({ kind: "column", id: "nie-ma" });
    expect(result.current.focusedColumn).toBeNull();
  });

  it("zaznaczenie wskazujące nieistniejący widget daje brak ogniska", () => {
    const { result } = setup({ kind: "widget", id: "nie-ma" });
    // Stan realny po cofnięciu usunięcia: zaznaczenie zostało, węzła już nie ma.
    expect(result.current.focusedColumn).toBeNull();
  });

  it("sekcja wewnętrzna bez kolumn nie daje ogniska", () => {
    const doc: BuilderDocument = {
      version: 1,
      sections: [sec("s1", [{ id: "i1", kind: "inner-section", columns: [] }])],
    };
    const { result } = setup({ kind: null, id: null }, doc);
    expect(result.current.focusedColumn).toBeNull();
  });
});

describe("useBuilderOperations - operacje strukturalne", () => {
  it.each([
    [
      "dodanie sekcji",
      (r: ReturnType<typeof setup>["result"]) => r.current.addSection(2),
      "builder.ops.addedSection",
    ],
    [
      "kontener",
      (r: ReturnType<typeof setup>["result"]) => r.current.addContainer(false),
      "builder.ops.addedContainer",
    ],
    [
      "kontener z zakładkami",
      (r: ReturnType<typeof setup>["result"]) => r.current.addContainer(true),
      "builder.ops.addedTabContainer",
    ],
    [
      "usunięcie sekcji",
      (r: ReturnType<typeof setup>["result"]) => r.current.removeSection("s1"),
      "builder.ops.removedSection",
    ],
    [
      "przesunięcie sekcji",
      (r: ReturnType<typeof setup>["result"]) => r.current.moveSection("s1", 1),
      "builder.ops.movedSection",
    ],
    [
      "duplikat sekcji",
      (r: ReturnType<typeof setup>["result"]) => r.current.duplicateSection("s1"),
      "builder.ops.duplicatedSection",
    ],
    [
      "dodanie kolumny",
      (r: ReturnType<typeof setup>["result"]) => r.current.addColumn("s1"),
      "builder.ops.addedColumn",
    ],
    [
      "usunięcie kolumny",
      (r: ReturnType<typeof setup>["result"]) => r.current.removeColumn("c1"),
      "builder.ops.removedColumn",
    ],
    [
      "duplikat kolumny",
      (r: ReturnType<typeof setup>["result"]) => r.current.duplicateColumn("c1"),
      "builder.ops.duplicatedColumn",
    ],
    [
      "sekcja wewnętrzna",
      (r: ReturnType<typeof setup>["result"]) => r.current.addInnerSection("s1"),
      "builder.ops.addedInnerSection",
    ],
    [
      "usunięcie widgetu",
      (r: ReturnType<typeof setup>["result"]) => r.current.removeWidget("w1"),
      "builder.ops.removedWidget",
    ],
    [
      "duplikat widgetu",
      (r: ReturnType<typeof setup>["result"]) => r.current.duplicateWidget("w1"),
      "builder.ops.duplicatedWidget",
    ],
  ])("%s zapisuje etykietę do historii", (_label, run, label) => {
    const s = setup({ kind: null, id: null });
    act(() => run(s.result));
    // Etykieta jest treścią komunikatu „Cofnięto: …” - bez niej redaktor nie
    // wie, co właśnie cofnął.
    expect(s.last()?.opts?.label).toBe(label);
  });

  it("dodanie sekcji z listą rozpiętości działa jak z liczbą kolumn", () => {
    const s = setup();
    act(() => s.result.current.addSection([8, 4]));
    const added = s.last()?.doc.sections.at(-1);
    expect((added?.children as ColumnNode[]).map((c) => c.span.desktop)).toEqual([8, 4]);
  });

  it("wstawienie sekcji na pozycji zachowuje kolejność", () => {
    const s = setup();
    act(() => s.result.current.insertSectionAt(1, 1));
    const ids = sectionIds(s.last()!.doc);
    expect(ids[0]).toBe("s1");
    expect(ids[2]).toBe("s2");
    expect(ids).toHaveLength(3);
  });

  it.each([
    ["z zakładkami", true, "builder.ops.addedTabContainer"],
    ["bez zakładek", false, "builder.ops.addedContainer"],
  ])("wstawienie kontenera na pozycji %s zapisuje właściwą etykietę", (_label, withTabs, label) => {
    const s = setup();
    act(() => s.result.current.insertContainerAt(0, withTabs));
    expect(s.last()?.opts?.label).toBe(label);
    expect(sectionIds(s.last()!.doc)).toHaveLength(3);
  });

  it("szablon startowy wstawia wszystkie swoje sekcje w jednym kroku historii", () => {
    const s = setup();
    act(() =>
      s.result.current.insertStarterTemplate({
        id: "t1",
        name_pl: "Trzy sekcje",
        name_en: "Three sections",
        description_pl: "opis",
        description_en: "description",
        build: () => [sec("n1", []), sec("n2", []), sec("n3", [])],
      }),
    );
    // Jeden krok, nie trzy - inaczej cofanie szablonu trzeba by klikać
    // tyle razy, ile miał sekcji.
    expect(s.recorded).toHaveLength(1);
    expect(sectionIds(s.last()!.doc)).toHaveLength(5);
  });

  it("szablon sekcji wstawia KLON, nie ten sam węzeł", () => {
    const s = setup();
    act(() =>
      s.result.current.insertTemplateSection({
        id: "tpl",
        name: "Szablon",
        data: sec("src", [col("src-c", [w("src-w")])]),
      } as Parameters<typeof s.result.current.insertTemplateSection>[0]),
    );
    const added = s.last()!.doc.sections.at(-1);
    expect(added?.id).not.toBe("src");
    expect(s.last()?.opts?.label).toBe("builder.ops.insertedTemplate");
  });

  it("strona startowa zastępuje dokument i ma własną etykietę", () => {
    const s = setup();
    act(() => s.result.current.loadHomepage());
    expect(s.last()?.opts?.label).toBe("builder.ops.loadedHomepage");
    expect(s.last()!.doc.sections.length).toBeGreaterThan(0);
  });

  it("każda operacja sanityzuje dokument", () => {
    const broken: BuilderDocument = {
      version: 1,
      sections: [sec("s1", [col("c1", [])]), null as unknown as SectionNode],
    };
    const s = setup({ kind: null, id: null }, broken);
    act(() => s.result.current.addColumn("s1"));
    expect(s.last()!.doc.sections.every((x) => x !== null)).toBe(true);
  });
});

describe("useBuilderOperations - sekcje w kontenerach", () => {
  it("dodanie sekcji do zakładki ma własną etykietę", () => {
    const s = setup();
    act(() => s.result.current.addSectionToTab("s1", "tab-1", 2));
    expect(s.last()?.opts?.label).toBe("builder.ops.addedSectionToTab");
  });

  it("dodanie sekcji do kontenera ma własną etykietę", () => {
    const s = setup();
    act(() => s.result.current.addSectionToContainer("s1", 2));
    expect(s.last()?.opts?.label).toBe("builder.ops.addedSectionToContainer");
  });
});

describe("useBuilderOperations - edycje właściwości", () => {
  it.each([
    ["widget", "w:w1"],
    ["sekcja", "s:s1"],
    ["kolumna", "c:c1"],
  ])("edycja %s zwija się w jeden krok historii", (kind, coalesceKey) => {
    const s = setup();
    act(() => {
      if (kind === "widget") s.result.current.updateWidget("w1", (x) => (x.content = { a: 1 }));
      else if (kind === "sekcja") s.result.current.updateSection("s1", (x) => (x.style = {}));
      else s.result.current.updateColumn("c1", (x) => (x.span = { desktop: 6 }));
    });
    // Wspólny klucz zwijania sprawia, że wpisanie „Witamy” to jeden krok
    // cofnięcia, a nie sześć.
    expect(s.last()?.opts?.coalesceKey).toBe(coalesceKey);
  });

  it("edycja widgetu zmienia jego treść", () => {
    const s = setup();
    act(() => s.result.current.updateWidget("w1", (x) => (x.content = { html_pl: "nowa" })));
    expect(widgetsIn(s.last()!.doc)[0].content).toEqual({ html_pl: "nowa" });
  });

  it.each([
    ["widget", (r: ReturnType<typeof setup>) => r.result.current.updateWidget("nie-ma", () => {})],
    ["sekcja", (r: ReturnType<typeof setup>) => r.result.current.updateSection("nie-ma", () => {})],
    ["kolumna", (r: ReturnType<typeof setup>) => r.result.current.updateColumn("nie-ma", () => {})],
  ])("edycja nieistniejącego węzła (%s) nie wywala haka", (_label, run) => {
    const s = setup();
    act(() => run(s));
    expect(s.recorded).toHaveLength(1);
  });
});

describe("useBuilderOperations - dodawanie widgetów", () => {
  it("widget dodany do kolumny w ognisku ZMIENIA zaznaczenie", () => {
    const s = setup({ kind: "column", id: "c2" });
    act(() => s.result.current.addWidgetToFocused("heading"));
    const added = (s.last()!.doc.sections[1].children[0] as ColumnNode).children[0];
    // Bez tego panel właściwości pokazuje poprzedni widget, a redaktor edytuje
    // nie to, co właśnie dodał.
    expect(s.setSelection).toHaveBeenCalledWith({ kind: "widget", id: added.id });
  });

  it("bez kolumny w ognisku widget ląduje w NOWEJ sekcji", () => {
    const s = setup({ kind: null, id: null }, { version: 1, sections: [] });
    act(() => s.result.current.addWidgetToFocused("heading"));
    expect(s.last()!.doc.sections).toHaveLength(1);
    expect(s.last()?.opts?.label).toBe("builder.ops.addedWidget");
  });

  it("widget dodany wprost do kolumny trafia na jej koniec", () => {
    const s = setup();
    act(() => s.result.current.addWidgetToColumn("c1", "button"));
    const list = widgetsIn(s.last()!.doc);
    expect(list).toHaveLength(2);
    expect(list[1].type).toBe("button");
  });

  it("widget wstawiony obok innego respektuje pozycję", () => {
    const s = setup();
    act(() => s.result.current.insertWidgetNear("w1", "before", "button"));
    const list = widgetsIn(s.last()!.doc);
    expect(list[0].type).toBe("button");
    expect(list[1].id).toBe("w1");
    expect(s.last()?.opts?.label).toBe("builder.ops.insertedWidget");
  });

  it("widget dołączony do sekcji dostaje WŁASNĄ kolumnę", () => {
    const s = setup();
    act(() => s.result.current.appendWidgetToSection("s2", "button"));
    // Upuszczenie widgetu na sekcję (a nie na kolumnę) tworzy nową kolumnę na
    // pełną szerokość - inaczej trzeba by zgadywać, do której kolumny trafia.
    const section = s.last()!.doc.sections[1];
    expect(section.children).toHaveLength(2);
    expect(widgetsIn(s.last()!.doc, 1, 1)).toHaveLength(1);
  });

  it("widget dołączony do zakładki nosi jej identyfikator", () => {
    const withTabs: BuilderDocument = {
      version: 1,
      sections: [
        {
          ...sec("s1", [col("c1", [])]),
          tabs: { enabled: true, items: [{ id: "tab-1", label_pl: "Jeden", label_en: "One" }] },
        },
      ],
    };
    const s = setup({ kind: null, id: null }, withTabs);
    act(() => s.result.current.appendWidgetToSection("s1", "button", undefined, "tab-1"));
    const added = s.last()!.doc.sections[0].children.at(-1) as ColumnNode;
    expect(added.tabId).toBe("tab-1");
  });

  it.each([
    [
      "przez kolumnę w ognisku",
      (r: ReturnType<typeof setup>) =>
        r.result.current.addGlobalWidgetToFocused({
          id: "g1",
          data: { type: "text", content: {} },
        }),
      "builder.ops.addedGlobalWidget",
    ],
    [
      "przez upuszczenie w kolumnie",
      (r: ReturnType<typeof setup>) =>
        r.result.current.addWidgetToColumn("c1", "text", {
          id: "g1",
          data: { type: "text", content: {} },
        }),
      "builder.ops.addedWidget",
    ],
  ])("instancja widgetu globalnego %s nosi referencję", (_label, run, label) => {
    const s = setup({ kind: "column", id: "c1" });
    act(() => run(s));
    const added = widgetsIn(s.last()!.doc).at(-1);
    // `globalId` jest tym, co czyni instancję instancją - bez niego mamy zwykłą
    // kopię, która przestaje się synchronizować.
    expect(added?.globalId).toBe("g1");
    expect(s.last()?.opts?.label).toBe(label);
  });

  it("widget globalny bez kolumny w ognisku też ląduje w nowej sekcji", () => {
    const s = setup({ kind: null, id: null }, { version: 1, sections: [] });
    act(() =>
      s.result.current.addGlobalWidgetToFocused({ id: "g1", data: { type: "text", content: {} } }),
    );
    expect(s.last()!.doc.sections).toHaveLength(1);
  });
});

describe("useBuilderOperations - przenoszenie", () => {
  it.each([
    [
      "widget obok widgetu",
      (r: ReturnType<typeof setup>) => r.result.current.moveWidgetTo("w1", "w2", "after"),
      "builder.ops.movedWidget",
    ],
    [
      "widget do kolumny",
      (r: ReturnType<typeof setup>) => r.result.current.moveWidgetToColumn("w1", "c2"),
      "builder.ops.movedWidgetToColumn",
    ],
    [
      "widget do sekcji",
      (r: ReturnType<typeof setup>) => r.result.current.moveWidgetToSection("w1", "s2"),
      "builder.ops.movedWidgetToSection",
    ],
    [
      "sekcja obok sekcji",
      (r: ReturnType<typeof setup>) => r.result.current.moveSectionTo("s1", "s2", "after"),
      "builder.ops.movedSection",
    ],
  ])("%s zapisuje własną etykietę", (_label, run, label) => {
    const s = setup();
    act(() => run(s));
    expect(s.last()?.opts?.label).toBe(label);
  });

  it("przeniesienie widgetu do innej kolumny naprawdę go przenosi", () => {
    const s = setup();
    act(() => s.result.current.moveWidgetToColumn("w1", "c2"));
    expect(widgetsIn(s.last()!.doc, 0)).toHaveLength(0);
    expect(widgetsIn(s.last()!.doc, 1)).toHaveLength(1);
  });

  it("ukrycie elementu zapisuje się bez etykiety historii", () => {
    const s = setup();
    act(() => s.result.current.toggleHidden("w1", "widget"));
    // Ukrycie jest zmianą podglądu, nie operacją strukturalną - świadomie bez
    // etykiety w komunikacie cofania.
    expect(s.last()?.opts).toBeUndefined();
    expect(widgetsIn(s.last()!.doc)[0].advanced?.hideOn?.desktop).toBe(true);
  });
});

describe("useBuilderOperations - szablon sekcji", () => {
  it("zapisuje szablon pod podaną nazwą", async () => {
    const s = setup();
    await act(async () => {
      await s.result.current.saveSectionAsTemplate("s1");
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(templateSave).toHaveBeenCalledWith("Nazwa", expect.objectContaining({ id: "s1" }));
  });

  it("nazwa z samych spacji anuluje zapis", async () => {
    prompt.mockResolvedValue("   ");
    const s = setup();
    await act(async () => {
      await s.result.current.saveSectionAsTemplate("s1");
    });
    expect(templateSave).not.toHaveBeenCalled();
  });

  it("anulowanie okna anuluje zapis", async () => {
    prompt.mockResolvedValue(null as unknown as string);
    const s = setup();
    await act(async () => {
      await s.result.current.saveSectionAsTemplate("s1");
    });
    expect(templateSave).not.toHaveBeenCalled();
  });

  it("nieistniejąca sekcja nie otwiera nawet okna", async () => {
    const s = setup();
    await act(async () => {
      await s.result.current.saveSectionAsTemplate("nie-ma");
    });
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe("useBuilderOperations - widgety globalne", () => {
  it("zapis widgetu jako globalnego dopisuje referencję do dokumentu", async () => {
    const s = setup();
    await act(async () => {
      await s.result.current.saveWidgetAsGlobal("w1");
    });
    expect(globalSave).toHaveBeenCalledWith("Nazwa", expect.objectContaining({ id: "w1" }));
    expect(widgetsIn(s.last()!.doc)[0].globalId).toBe("g-new");
    expect(toastSuccess).toHaveBeenCalledWith("builder.ops.saveGlobalOk");
  });

  it("błąd zapisu pokazuje komunikat i NIE dopisuje referencji", async () => {
    globalSave.mockResolvedValue("");
    const s = setup();
    await act(async () => {
      await s.result.current.saveWidgetAsGlobal("w1");
    });
    // Referencja do widgetu, którego nie ma w bazie, dawałaby na kanwie pustkę
    // przy każdym przeładowaniu.
    expect(toastError).toHaveBeenCalledWith("builder.ops.saveGlobalErr");
    expect(s.recorded).toHaveLength(0);
  });

  it("anulowanie nazwy nie zapisuje niczego", async () => {
    prompt.mockResolvedValue("");
    const s = setup();
    await act(async () => {
      await s.result.current.saveWidgetAsGlobal("w1");
    });
    expect(globalSave).not.toHaveBeenCalled();
  });

  it("nieistniejący widget nie otwiera okna", async () => {
    const s = setup();
    await act(async () => {
      await s.result.current.saveWidgetAsGlobal("nie-ma");
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("odłączenie instancji zdejmuje referencję i informuje", () => {
    const doc: BuilderDocument = {
      version: 1,
      sections: [sec("s1", [col("c1", [{ ...w("w1"), globalId: "g1" }])])],
    };
    const s = setup({ kind: null, id: null }, doc);
    act(() => s.result.current.unlinkGlobalWidget("w1"));
    expect(widgetsIn(s.last()!.doc)[0].globalId).toBeUndefined();
    expect(toastInfo).toHaveBeenCalledWith("builder.ops.unlinkedGlobal");
  });
});

describe("useBuilderOperations - testy A/B", () => {
  it("start testu tworzy eksperyment i przypina go do sekcji", async () => {
    const s = setup();
    await act(async () => {
      await s.result.current.startAbTest("s1");
    });
    expect(experimentCreate).toHaveBeenCalledWith("Nazwa");
    expect(toastSuccess).toHaveBeenCalledWith("builder.ops.abCreateOk");
    expect(s.recorded).toHaveLength(1);
  });

  it("błąd tworzenia eksperymentu nie rusza dokumentu", async () => {
    experimentCreate.mockResolvedValue("");
    const s = setup();
    await act(async () => {
      await s.result.current.startAbTest("s1");
    });
    expect(toastError).toHaveBeenCalledWith("builder.ops.abCreateErr");
    expect(s.recorded).toHaveLength(0);
  });

  it("anulowanie nazwy nie tworzy eksperymentu", async () => {
    prompt.mockResolvedValue("  ");
    const s = setup();
    await act(async () => {
      await s.result.current.startAbTest("s1");
    });
    expect(experimentCreate).not.toHaveBeenCalled();
  });

  it("nieistniejąca sekcja nie otwiera okna", async () => {
    const s = setup();
    await act(async () => {
      await s.result.current.startAbTest("nie-ma");
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  it.each([["a"], ["b"], ["both"]] as const)(
    "zakończenie testu (%s) domyka eksperyment w bazie",
    (keep) => {
      const s = setup();
      act(() => s.result.current.endAbTest("exp-1", keep));
      expect(experimentSetStatus).toHaveBeenCalledWith("exp-1", "completed");
      expect(toastSuccess).toHaveBeenCalledWith("builder.ops.abEnded");
      expect(s.recorded).toHaveLength(1);
    },
  );
});
