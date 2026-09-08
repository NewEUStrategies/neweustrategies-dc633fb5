import { describe, it, expect } from "vitest";
import type {
  BuilderDocument,
  SectionNode,
  ColumnNode,
  InnerSectionNode,
  WidgetNode,
  SectionChild,
  WidgetType,
} from "../types";
import * as ops from "../operations";

// ---------- fixtures ----------
const w = (id: string, type: WidgetType = "text"): WidgetNode => ({
  id,
  kind: "widget",
  type,
  content: {},
});
const col = (id: string, children: WidgetNode[] = [], span = 12): ColumnNode => ({
  id,
  kind: "column",
  span: { desktop: span },
  children,
});
const inner = (id: string, columns: ColumnNode[]): InnerSectionNode => ({
  id,
  kind: "inner-section",
  columns,
});
const sec = (id: string, children: SectionChild[]): SectionNode => ({
  id,
  kind: "section",
  children,
});
const doc = (...sections: SectionNode[]): BuilderDocument => ({ version: 1, sections });

const ids = (c: ColumnNode) => c.children.map((x) => x.id);

describe("node factories", () => {
  it("newColumn defaults to span 12 and no children", () => {
    const c = ops.newColumn();
    expect(c.kind).toBe("column");
    expect(c.span).toEqual({ desktop: 12 });
    expect(c.children).toEqual([]);
    expect(c.id).toBeTruthy();
  });

  it("newSection(n) creates n equal columns summing to 12", () => {
    const s = ops.newSection(3);
    expect(s.children).toHaveLength(3);
    expect(s.children.every((c) => c.kind === "column" && c.span.desktop === 4)).toBe(true);
  });

  it("newSection([spans]) honours explicit spans", () => {
    const s = ops.newSection([8, 4]);
    expect((s.children as ColumnNode[]).map((c) => c.span.desktop)).toEqual([8, 4]);
  });

  it("newInnerSection has two 6-span columns", () => {
    const i = ops.newInnerSection();
    expect(i.columns).toHaveLength(2);
    expect(i.columns.map((c) => c.span.desktop)).toEqual([6, 6]);
  });
});

describe("section mutations", () => {
  it("addSection appends a section", () => {
    const d = doc(sec("s1", []));
    ops.addSection(d, 2);
    expect(d.sections).toHaveLength(2);
    expect(d.sections[1].children).toHaveLength(2);
  });

  it("insertSectionAt inserts at an index", () => {
    const d = doc(sec("s1", []), sec("s2", []));
    ops.insertSectionAt(d, 1, 1);
    expect(d.sections.map((s) => s.id).slice(0, 1)).toEqual(["s1"]);
    expect(d.sections).toHaveLength(3);
    expect(d.sections[2].id).toBe("s2");
  });

  it("addSectionToTab creates a structure assigned only to the selected tab", () => {
    const container = ops.newContainerSection(true);
    const tabId = container.tabs!.items[1].id;
    const d = doc(container);
    ops.addSectionToTab(d, container.id, tabId, [8, 4]);
    const added = d.sections[0].children.at(-1) as InnerSectionNode;
    expect(added.tabId).toBe(tabId);
    expect(added.columns.map((column) => column.span.desktop)).toEqual([8, 4]);
  });

  it("removeSection drops the matching section", () => {
    const d = doc(sec("s1", []), sec("s2", []));
    ops.removeSection(d, "s1");
    expect(d.sections.map((s) => s.id)).toEqual(["s2"]);
  });

  it("moveSection swaps with the neighbour in the given direction", () => {
    const d = doc(sec("a", []), sec("b", []), sec("c", []));
    ops.moveSection(d, "b", -1);
    expect(d.sections.map((s) => s.id)).toEqual(["b", "a", "c"]);
    ops.moveSection(d, "b", 1);
    expect(d.sections.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("moveSection is a no-op at the boundaries", () => {
    const d = doc(sec("a", []), sec("b", []));
    ops.moveSection(d, "a", -1);
    expect(d.sections.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("duplicateSection inserts a deep copy with fresh ids right after", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]));
    ops.duplicateSection(d, "s1");
    expect(d.sections).toHaveLength(2);
    const copy = d.sections[1];
    expect(copy.id).not.toBe("s1");
    const copyCol = copy.children[0] as ColumnNode;
    expect(copyCol.id).not.toBe("c1");
    expect(copyCol.children[0].id).not.toBe("w1");
  });

  it("moveSectionTo reorders before/after a target", () => {
    const d = doc(sec("a", []), sec("b", []), sec("c", []));
    ops.moveSectionTo(d, "a", "c", "after");
    expect(d.sections.map((s) => s.id)).toEqual(["b", "c", "a"]);
    ops.moveSectionTo(d, "a", "b", "before");
    expect(d.sections.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("moveSectionTo is a no-op when src equals target", () => {
    const d = doc(sec("a", []), sec("b", []));
    ops.moveSectionTo(d, "a", "a", "before");
    expect(d.sections.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("column mutations", () => {
  it("addColumn rebalances span for the new column count", () => {
    const d = doc(sec("s1", [col("c1")]));
    ops.addColumn(d, "s1");
    const cols = d.sections[0].children as ColumnNode[];
    expect(cols).toHaveLength(2);
    expect(cols[1].span.desktop).toBe(6); // floor(12 / 2)
  });

  it("removeColumn removes top-level and inner columns", () => {
    const d = doc(sec("s1", [col("c1"), inner("i1", [col("ic1"), col("ic2")])]));
    ops.removeColumn(d, "c1");
    ops.removeColumn(d, "ic1");
    const children = d.sections[0].children;
    expect(children.find((c) => c.kind === "column")).toBeUndefined();
    const innerNode = children.find((c) => c.kind === "inner-section") as InnerSectionNode;
    expect(innerNode.columns.map((c) => c.id)).toEqual(["ic2"]);
  });

  it("duplicateColumn clones a top-level column with fresh ids", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]));
    ops.duplicateColumn(d, "c1");
    const cols = d.sections[0].children as ColumnNode[];
    expect(cols).toHaveLength(2);
    expect(cols[1].id).not.toBe("c1");
    expect(cols[1].children[0].id).not.toBe("w1");
  });

  it("addInnerSection appends an inner-section to a section", () => {
    const d = doc(sec("s1", [col("c1")]));
    ops.addInnerSection(d, "s1");
    expect(d.sections[0].children.some((c) => c.kind === "inner-section")).toBe(true);
  });
});

describe("widget mutations", () => {
  it("removeWidget removes from any column (incl. inner)", () => {
    const d = doc(sec("s1", [col("c1", [w("w1"), w("w2")]), inner("i1", [col("ic1", [w("w3")])])]));
    ops.removeWidget(d, "w1");
    ops.removeWidget(d, "w3");
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual(["w2"]);
    const innerNode = d.sections[0].children[1] as InnerSectionNode;
    expect(ids(innerNode.columns[0])).toEqual([]);
  });

  it("duplicateWidget inserts a fresh-id copy directly after", () => {
    const d = doc(sec("s1", [col("c1", [w("w1"), w("w2")])]));
    ops.duplicateWidget(d, "w1");
    const c = d.sections[0].children[0] as ColumnNode;
    expect(c.children).toHaveLength(3);
    expect(c.children[1].id).not.toBe("w1");
    expect(c.children[2].id).toBe("w2");
  });

  it("addWidgetToColumn pushes a ready widget", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]));
    ops.addWidgetToColumn(d, "c1", w("new"));
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual(["w1", "new"]);
  });

  it("addWidgetToNewSection wraps the widget in a fresh 1-column section", () => {
    const d = doc();
    ops.addWidgetToNewSection(d, w("new"));
    expect(d.sections).toHaveLength(1);
    const c = d.sections[0].children[0] as ColumnNode;
    expect(c.span.desktop).toBe(12);
    expect(ids(c)).toEqual(["new"]);
  });

  it("insertWidgetNear inserts before/after a target widget", () => {
    const d = doc(sec("s1", [col("c1", [w("w1"), w("w2")])]));
    ops.insertWidgetNear(d, "w1", "before", w("b"));
    ops.insertWidgetNear(d, "w2", "after", w("a"));
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual(["b", "w1", "w2", "a"]);
  });

  it("appendWidgetToSection creates a column when the section has none", () => {
    const d = doc(sec("s1", []));
    ops.appendWidgetToSection(d, "s1", w("new"));
    const c = d.sections[0].children[0] as ColumnNode;
    expect(c.kind).toBe("column");
    expect(ids(c)).toEqual(["new"]);
  });

  it("appendWidgetToSection appends a new full-width column even when one exists", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]));
    ops.appendWidgetToSection(d, "s1", w("new"));
    expect(d.sections[0].children).toHaveLength(2);
    const second = d.sections[0].children[1] as ColumnNode;
    expect(second.kind).toBe("column");
    // newColumn() builds a responsive span object, not a bare number.
    expect(second.span).toEqual({ desktop: 12 });
    expect(ids(second)).toEqual(["new"]);
  });

  it("appendWidgetToSection assigns a direct drop to the active container tab", () => {
    const container = ops.newContainerSection(true);
    const tabId = container.tabs!.items[1].id;
    const d = doc(container);
    ops.appendWidgetToSection(d, container.id, w("new"), tabId);
    const added = d.sections[0].children.at(-1) as ColumnNode;
    expect(added.tabId).toBe(tabId);
    expect(ids(added)).toEqual(["new"]);
  });
});

describe("widget moves", () => {
  it("moveWidgetTo reorders within a column (before)", () => {
    const d = doc(sec("s1", [col("c1", [w("w1"), w("w2"), w("w3")])]));
    ops.moveWidgetTo(d, "w3", "w1", "before");
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual(["w3", "w1", "w2"]);
  });

  it("moveWidgetTo moves across columns (after)", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")]), col("c2", [w("w2")])]));
    ops.moveWidgetTo(d, "w1", "w2", "after");
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual([]);
    expect(ids(d.sections[0].children[1] as ColumnNode)).toEqual(["w2", "w1"]);
  });

  it("moveWidgetTo is a no-op when src equals target", () => {
    const d = doc(sec("s1", [col("c1", [w("w1"), w("w2")])]));
    ops.moveWidgetTo(d, "w1", "w1", "before");
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual(["w1", "w2"]);
  });

  it("moveWidgetToColumn appends to the target column", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")]), col("c2", [])]));
    ops.moveWidgetToColumn(d, "w1", "c2");
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual([]);
    expect(ids(d.sections[0].children[1] as ColumnNode)).toEqual(["w1"]);
  });

  it("moveWidgetToSection appends to the section's first column", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]), sec("s2", [col("c2", [])]));
    ops.moveWidgetToSection(d, "w1", "s2");
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual([]);
    expect(ids(d.sections[1].children[0] as ColumnNode)).toEqual(["w1"]);
  });

  it("moveWidgetToSection creates a column when target section has none", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]), sec("s2", []));
    ops.moveWidgetToSection(d, "w1", "s2");
    const target = d.sections[1].children[0] as ColumnNode;
    expect(target.kind).toBe("column");
    expect(ids(target)).toEqual(["w1"]);
  });
});

describe("toggleHidden", () => {
  it("sets and clears per-device visibility on a widget", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]));
    ops.toggleHidden(d, "w1", "widget", "mobile");
    const node = (d.sections[0].children[0] as ColumnNode).children[0];
    expect(node.advanced?.hideOn?.mobile).toBe(true);
    ops.toggleHidden(d, "w1", "widget", "mobile");
    expect(node.advanced?.hideOn?.mobile).toBe(false);
  });

  it("targets sections, columns and inner-sections by kind", () => {
    const d = doc(sec("s1", [col("c1"), inner("i1", [col("ic1")])]));
    ops.toggleHidden(d, "s1", "section", "desktop");
    ops.toggleHidden(d, "c1", "column", "tablet");
    ops.toggleHidden(d, "i1", "inner-section", "desktop");
    expect(d.sections[0].advanced?.hideOn?.desktop).toBe(true);
    expect((d.sections[0].children[0] as ColumnNode).advanced?.hideOn?.tablet).toBe(true);
    expect((d.sections[0].children[1] as InnerSectionNode).advanced?.hideOn?.desktop).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ŚCIEŻKI ODMOWY I PRZYPADKI BRZEGOWE
//
// Powyższe testy sprawdzają szczęśliwe ścieżki. Poniższe biorą na warsztat to,
// co operacje robią, gdy dostaną drzewo USZKODZONE (dziury `null` w tablicach,
// brakujące tablice `children` / `columns`) albo identyfikator, którego w
// dokumencie NIE MA. Taki kształt wchodzi do operacji po odczycie starej
// rewizji, po ręcznej edycji JSON-a w bazie albo po nieudanej migracji - a
// operacje mutują żywy dokument edytora, więc każdy wyjątek to utrata pracy
// redakcji.
// ---------------------------------------------------------------------------

/**
 * Dokument z celowo uszkodzonym drzewem. Kolejność sekcji jest ISTOTNA:
 * szukane węzły (`w-cel`, `ic-cel`, `i-cel`) leżą na końcu, więc każda
 * operacja musi przejść przez wszystkie uszkodzone gałęzie po drodze.
 * Fabryka, a nie stała, bo operacje mutują dokument w miejscu.
 */
const brokenDoc = (): BuilderDocument =>
  ({
    version: 1,
    sections: [
      null,
      { id: "s-bez-children", kind: "section" },
      { id: "s-dziura", kind: "section", children: [null] },
      {
        id: "s-inner-bez-kolumn",
        kind: "section",
        children: [{ id: "i-bez-kolumn", kind: "inner-section" }],
      },
      {
        id: "s-inner-dziura",
        kind: "section",
        children: [{ id: "i-dziura", kind: "inner-section", columns: [null] }],
      },
      {
        id: "s-kolumna-bez-children",
        kind: "section",
        children: [{ id: "c-bez-children", kind: "column", span: { desktop: 12 } }],
      },
      {
        id: "s-obca",
        kind: "section",
        children: [
          {
            id: "c-obca",
            kind: "column",
            span: { desktop: 12 },
            children: [{ id: "w-obcy", kind: "widget", type: "text", content: {} }],
          },
        ],
      },
      {
        id: "s-cel",
        kind: "section",
        children: [
          {
            id: "i-cel",
            kind: "inner-section",
            columns: [
              {
                id: "ic-cel",
                kind: "column",
                span: { desktop: 6 },
                children: [{ id: "w-cel", kind: "widget", type: "text", content: {} }],
              },
            ],
          },
        ],
      },
    ],
  }) as unknown as BuilderDocument;

/** Jak `ids`, ale znosi kolumnę bez tablicy `children` (taką ma `brokenDoc`). */
const idsBezp = (c: ColumnNode | null | undefined): string[] =>
  (c?.children ?? []).map((x) => x.id);

describe("fabryki klonujące - gałęzie obronne", () => {
  it("cloneWidget z pustego wejścia daje kompletny widget tekstowy, a nie wybuch", () => {
    const kopia = ops.cloneWidget(undefined as unknown as WidgetNode);
    expect(kopia.kind).toBe("widget");
    expect(kopia.type).toBe("text");
    expect(kopia.content).toEqual({});
    expect(kopia.id).toBeTruthy();
  });

  it("cloneWidget podmienia nieznany typ na text, a tablicę w content na pusty obiekt", () => {
    const kopia = ops.cloneWidget({
      id: "w1",
      kind: "widget",
      type: "typ-ktorego-nie-ma",
      content: ["a", "b"],
    } as unknown as WidgetNode);
    expect(kopia.type).toBe("text");
    expect(kopia.content).toEqual({});
    expect(kopia.id).not.toBe("w1");
  });

  it("cloneColumn z pustego wejścia daje kolumnę bez spanu i bez dzieci", () => {
    const kopia = ops.cloneColumn(undefined as unknown as ColumnNode);
    expect(kopia.kind).toBe("column");
    expect(kopia.span).toEqual({});
    expect(kopia.children).toEqual([]);
  });

  it("cloneColumn odrzuca span będący tablicą i dzieci, które nie są tablicą", () => {
    const kopia = ops.cloneColumn({
      id: "c1",
      kind: "column",
      span: [12],
      children: { to: "nie tablica" },
    } as unknown as ColumnNode);
    expect(kopia.span).toEqual({});
    expect(kopia.children).toEqual([]);
  });

  it("cloneColumn wyrzuca widgety nieznanego typu zamiast je przepisywać", () => {
    const kopia = ops.cloneColumn({
      id: "c1",
      kind: "column",
      span: { desktop: 12 },
      children: [
        { id: "w1", kind: "widget", type: "text", content: {} },
        { id: "w2", kind: "widget", type: "widget-widmo", content: {} },
        null,
      ],
    } as unknown as ColumnNode);
    expect(kopia.children).toHaveLength(1);
    expect(kopia.children[0].type).toBe("text");
  });

  it("cloneInner klonuje sekcję wewnętrzną, nadając świeże identyfikatory całemu poddrzewu", () => {
    const zrodlo = inner("i1", [col("ic1", [w("w1")])]);
    const kopia = ops.cloneInner(zrodlo);
    expect(kopia.kind).toBe("inner-section");
    expect(kopia.id).not.toBe("i1");
    expect(kopia.columns[0].id).not.toBe("ic1");
    expect(kopia.columns[0].children[0].id).not.toBe("w1");
    // Oryginał zostaje nietknięty - klon jest głęboką kopią.
    expect(zrodlo.id).toBe("i1");
    expect(zrodlo.columns[0].children[0].id).toBe("w1");
  });

  it("cloneInner z pustego wejścia daje sekcję wewnętrzną bez kolumn", () => {
    const kopia = ops.cloneInner(undefined as unknown as InnerSectionNode);
    expect(kopia.kind).toBe("inner-section");
    expect(kopia.columns).toEqual([]);
  });

  it("cloneInner pomija dziury w liście kolumn", () => {
    const kopia = ops.cloneInner({
      id: "i1",
      kind: "inner-section",
      columns: [null, col("ic1")],
    } as unknown as InnerSectionNode);
    expect(kopia.columns).toHaveLength(1);
  });

  it("cloneSection z pustego wejścia daje sekcję bez dzieci", () => {
    const kopia = ops.cloneSection(undefined as unknown as SectionNode);
    expect(kopia.kind).toBe("section");
    expect(kopia.children).toEqual([]);
  });

  it("cloneSection klonuje sekcje wewnętrzne jako sekcje wewnętrzne, nie jako kolumny", () => {
    const kopia = ops.cloneSection(sec("s1", [inner("i1", [col("ic1")]), col("c1")]));
    expect(kopia.children[0].kind).toBe("inner-section");
    expect(kopia.children[0].id).not.toBe("i1");
    expect((kopia.children[0] as InnerSectionNode).columns[0].id).not.toBe("ic1");
    expect(kopia.children[1].kind).toBe("column");
    expect(kopia.children[1].id).not.toBe("c1");
  });

  it("cloneSection pomija dziury w liście dzieci", () => {
    const kopia = ops.cloneSection({
      id: "s1",
      kind: "section",
      children: [null, col("c1")],
    } as unknown as SectionNode);
    expect(kopia.children).toHaveLength(1);
    expect(kopia.children[0].kind).toBe("column");
  });
});

describe("wyszukiwarki węzłów", () => {
  const bezSekcji = {} as unknown as BuilderDocument;

  it("wszystkie cztery wyszukiwarki zwracają null dla dokumentu bez tablicy sekcji", () => {
    expect(ops.findWidget(bezSekcji, "x")).toBeNull();
    expect(ops.findSection(bezSekcji, "x")).toBeNull();
    expect(ops.findColumn(bezSekcji, "x")).toBeNull();
    expect(ops.findInner(bezSekcji, "x")).toBeNull();
  });

  it("findWidget przechodzi przez dziury i węzły bez tablic, i znajduje widget w sekcji wewnętrznej", () => {
    const trafienie = ops.findWidget(brokenDoc(), "w-cel");
    expect(trafienie?.widget.id).toBe("w-cel");
    // Zwraca też kolumnę-rodzica, żeby wołający wiedział, gdzie widget siedzi.
    expect(trafienie?.column.id).toBe("ic-cel");
  });

  it("findWidget zwraca null dla nieistniejącego identyfikatora, nie rzucając na uszkodzonym drzewie", () => {
    expect(ops.findWidget(brokenDoc(), "nie-ma")).toBeNull();
  });

  it("findSection zwraca null dla nieistniejącej sekcji", () => {
    expect(ops.findSection(brokenDoc(), "nie-ma")).toBeNull();
    expect(ops.findSection(brokenDoc(), "s-cel")?.id).toBe("s-cel");
  });

  it("findColumn znajduje kolumnę zagnieżdżoną w sekcji wewnętrznej", () => {
    expect(ops.findColumn(brokenDoc(), "ic-cel")?.id).toBe("ic-cel");
  });

  it("findColumn zwraca null dla nieistniejącej kolumny", () => {
    expect(ops.findColumn(brokenDoc(), "nie-ma")).toBeNull();
  });

  it("findInner znajduje sekcję wewnętrzną, ale nie myli jej z kolumną ani z sekcją", () => {
    const d = brokenDoc();
    expect(ops.findInner(d, "i-cel")?.id).toBe("i-cel");
    expect(ops.findInner(d, "ic-cel")).toBeNull();
    expect(ops.findInner(d, "s-cel")).toBeNull();
  });
});

describe("operacje na nieistniejącym celu nie ruszają dokumentu", () => {
  it("moveSection, duplicateSection i moveSectionTo milczą dla nieznanej sekcji źródłowej", () => {
    const d = doc(sec("a", []), sec("b", []));
    ops.moveSection(d, "nie-ma", 1);
    ops.duplicateSection(d, "nie-ma");
    ops.moveSectionTo(d, "nie-ma", "a", "before");
    expect(d.sections.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("moveSectionTo z nieznanym CELEM dokleja sekcję na koniec, zamiast ją zgubić", () => {
    const d = doc(sec("a", []), sec("b", []), sec("c", []));
    ops.moveSectionTo(d, "a", "nie-ma", "before");
    expect(d.sections.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("addInnerSection, addColumn i addSectionToContainer milczą dla nieznanej sekcji", () => {
    const d = doc(sec("s1", [col("c1")]));
    ops.addInnerSection(d, "nie-ma");
    ops.addColumn(d, "nie-ma");
    ops.addSectionToContainer(d, "nie-ma", 2);
    expect(d.sections).toHaveLength(1);
    expect(d.sections[0].children.map((c) => c.id)).toEqual(["c1"]);
  });

  it("addSectionToTab milczy dla nieznanej sekcji i dla nieznanej zakładki", () => {
    const kontener = ops.newContainerSection(true);
    const d = doc(kontener);
    ops.addSectionToTab(d, "nie-ma", kontener.tabs!.items[0].id, 2);
    ops.addSectionToTab(d, kontener.id, "zakladka-widmo", 2);
    expect(d.sections[0].children).toEqual([]);
  });

  it("appendWidgetToSection milczy dla nieznanej sekcji", () => {
    const d = doc(sec("s1", []));
    ops.appendWidgetToSection(d, "nie-ma", w("nowy"));
    expect(d.sections).toHaveLength(1);
    expect(d.sections[0].children).toEqual([]);
  });

  it("addWidgetToColumn milczy dla nieznanej kolumny", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]));
    ops.addWidgetToColumn(d, "nie-ma", w("nowy"));
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual(["w1"]);
  });

  it("removeWidget, duplicateWidget i insertWidgetNear milczą dla nieznanego widgetu", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]));
    ops.removeWidget(d, "nie-ma");
    ops.duplicateWidget(d, "nie-ma");
    ops.insertWidgetNear(d, "nie-ma", "after", w("nowy"));
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual(["w1"]);
  });

  it("removeColumn milczy dla nieznanej kolumny, przechodząc przez uszkodzone drzewo", () => {
    const d = brokenDoc();
    ops.removeColumn(d, "nie-ma");
    expect(ops.findColumn(d, "ic-cel")?.id).toBe("ic-cel");
    expect(ops.findColumn(d, "c-obca")?.id).toBe("c-obca");
  });

  it("duplicateColumn milczy dla nieznanej kolumny, przechodząc przez uszkodzone drzewo", () => {
    const d = brokenDoc();
    ops.duplicateColumn(d, "nie-ma");
    expect(ops.findInner(d, "i-cel")?.columns).toHaveLength(1);
    expect(ops.findSection(d, "s-obca")?.children).toHaveLength(1);
  });

  it("toggleHidden milczy dla nieznanego widgetu, zamiast tworzyć pusty węzeł", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]));
    ops.toggleHidden(d, "nie-ma", "widget", "mobile");
    const wezel = (d.sections[0].children[0] as ColumnNode).children[0];
    expect(wezel.advanced).toBeUndefined();
  });

  it("toggleHidden milczy dla nieznanej sekcji, kolumny i sekcji wewnętrznej", () => {
    const d = doc(sec("s1", [col("c1"), inner("i1", [col("ic1")])]));
    ops.toggleHidden(d, "nie-ma", "section", "desktop");
    ops.toggleHidden(d, "nie-ma", "column", "desktop");
    ops.toggleHidden(d, "nie-ma", "inner-section", "desktop");
    expect(d.sections[0].advanced).toBeUndefined();
    expect((d.sections[0].children[0] as ColumnNode).advanced).toBeUndefined();
    expect((d.sections[0].children[1] as InnerSectionNode).advanced).toBeUndefined();
  });
});

describe("operacje na węzłach bez tablicy potomków", () => {
  /** Sekcja BEZ klucza `children` - tak wygląda węzeł po niepełnej migracji. */
  const sekcjaBezChildren = (): BuilderDocument =>
    ({ version: 1, sections: [{ id: "s1", kind: "section" }] }) as unknown as BuilderDocument;

  it("addInnerSection zakłada brakującą tablicę dzieci zamiast rzucać", () => {
    const d = sekcjaBezChildren();
    ops.addInnerSection(d, "s1");
    expect(d.sections[0].children).toHaveLength(1);
    expect(d.sections[0].children[0].kind).toBe("inner-section");
  });

  it("addColumn zakłada brakującą tablicę dzieci i daje pierwszej kolumnie pełną szerokość", () => {
    const d = sekcjaBezChildren();
    ops.addColumn(d, "s1");
    expect(d.sections[0].children).toHaveLength(1);
    expect((d.sections[0].children[0] as ColumnNode).span.desktop).toBe(12);
  });

  it("addSectionToContainer zakłada brakującą tablicę dzieci kontenera", () => {
    const d = sekcjaBezChildren();
    ops.addSectionToContainer(d, "s1", [8, 4]);
    const dodana = d.sections[0].children[0] as InnerSectionNode;
    expect(dodana.kind).toBe("inner-section");
    expect(dodana.columns.map((c) => c.span.desktop)).toEqual([8, 4]);
  });

  it("addSectionToTab zakłada brakującą tablicę dzieci kontenera z zakładkami", () => {
    const d = {
      version: 1,
      sections: [
        {
          id: "s1",
          kind: "section",
          tabs: { enabled: true, items: [{ id: "t1", label_pl: "Zakładka 1" }] },
        },
      ],
    } as unknown as BuilderDocument;
    ops.addSectionToTab(d, "s1", "t1", 2);
    const dodana = d.sections[0].children[0] as InnerSectionNode;
    expect(dodana.tabId).toBe("t1");
    expect(dodana.columns).toHaveLength(2);
  });

  it("appendWidgetToSection zakłada brakującą tablicę dzieci sekcji", () => {
    const d = sekcjaBezChildren();
    ops.appendWidgetToSection(d, "s1", w("nowy"));
    expect(idsBezp(d.sections[0].children[0] as ColumnNode)).toEqual(["nowy"]);
  });

  it("addWidgetToColumn zakłada brakującą tablicę dzieci kolumny", () => {
    const d = brokenDoc();
    ops.addWidgetToColumn(d, "c-bez-children", w("nowy"));
    expect(idsBezp(ops.findColumn(d, "c-bez-children"))).toEqual(["nowy"]);
  });
});

describe("operacje w sekcjach wewnętrznych", () => {
  const zInner = (): BuilderDocument =>
    doc(
      sec("s1", [
        col("c1", [w("w1")]),
        inner("i-pusty", []),
        inner("i1", [col("ic1", [w("wi1"), w("wi2")])]),
      ]),
    );

  it("duplicateColumn klonuje kolumnę leżącą w sekcji wewnętrznej, a nie w sekcji", () => {
    const d = zInner();
    ops.duplicateColumn(d, "ic1");
    // Sekcja nadrzędna nie dostaje nowej kolumny.
    expect(d.sections[0].children).toHaveLength(3);
    const i1 = d.sections[0].children[2] as InnerSectionNode;
    expect(i1.columns).toHaveLength(2);
    expect(i1.columns[1].id).not.toBe("ic1");
    expect(i1.columns[1].children.map((x) => x.id)).not.toContain("wi1");
  });

  it("removeWidget usuwa widget z kolumny sekcji wewnętrznej w uszkodzonym drzewie", () => {
    const d = brokenDoc();
    ops.removeWidget(d, "w-cel");
    expect(idsBezp(ops.findColumn(d, "ic-cel"))).toEqual([]);
    // Widget o innym identyfikatorze zostaje.
    expect(idsBezp(ops.findColumn(d, "c-obca"))).toEqual(["w-obcy"]);
  });

  it("duplicateWidget klonuje widget z kolumny sekcji wewnętrznej w uszkodzonym drzewie", () => {
    const d = brokenDoc();
    ops.duplicateWidget(d, "w-cel");
    const kolumna = ops.findColumn(d, "ic-cel");
    expect(kolumna?.children).toHaveLength(2);
    expect(kolumna?.children[0].id).toBe("w-cel");
    expect(kolumna?.children[1].id).not.toBe("w-cel");
  });

  it("insertWidgetNear wstawia widget obok celu leżącego w sekcji wewnętrznej", () => {
    const d = brokenDoc();
    ops.insertWidgetNear(d, "w-cel", "before", w("nowy"));
    expect(idsBezp(ops.findColumn(d, "ic-cel"))).toEqual(["nowy", "w-cel"]);
  });

  it("moveWidgetToSection celuje w pierwszą kolumnę sekcji wewnętrznej, gdy sekcja nie ma własnych kolumn", () => {
    const d = brokenDoc();
    ops.moveWidgetToSection(d, "w-obcy", "s-cel");
    expect(idsBezp(ops.findColumn(d, "c-obca"))).toEqual([]);
    expect(idsBezp(ops.findColumn(d, "ic-cel"))).toEqual(["w-cel", "w-obcy"]);
  });
});

describe("przenoszenie widgetu przez uszkodzone drzewo", () => {
  it("moveWidgetTo przenosi widget z sekcji wewnętrznej obok widgetu w innej sekcji", () => {
    const d = brokenDoc();
    ops.moveWidgetTo(d, "w-cel", "w-obcy", "after");
    expect(idsBezp(ops.findColumn(d, "ic-cel"))).toEqual([]);
    expect(idsBezp(ops.findColumn(d, "c-obca"))).toEqual(["w-obcy", "w-cel"]);
  });

  it("moveWidgetTo z nieznanym ŹRÓDŁEM zostawia dokument bez zmian", () => {
    const d = brokenDoc();
    ops.moveWidgetTo(d, "nie-ma", "w-obcy", "after");
    expect(idsBezp(ops.findColumn(d, "c-obca"))).toEqual(["w-obcy"]);
    expect(idsBezp(ops.findColumn(d, "ic-cel"))).toEqual(["w-cel"]);
  });

  it("moveWidgetToColumn dokłada widget do kolumny bez tablicy dzieci", () => {
    const d = brokenDoc();
    ops.moveWidgetToColumn(d, "w-cel", "c-bez-children");
    expect(idsBezp(ops.findColumn(d, "ic-cel"))).toEqual([]);
    expect(idsBezp(ops.findColumn(d, "c-bez-children"))).toEqual(["w-cel"]);
  });

  it("moveWidgetToColumn z nieznanym ŹRÓDŁEM zostawia dokument bez zmian", () => {
    const d = brokenDoc();
    ops.moveWidgetToColumn(d, "nie-ma", "c-obca");
    expect(idsBezp(ops.findColumn(d, "c-obca"))).toEqual(["w-obcy"]);
    expect(idsBezp(ops.findColumn(d, "ic-cel"))).toEqual(["w-cel"]);
  });

  it("moveWidgetToSection z nieznanym ŹRÓDŁEM zostawia dokument bez zmian", () => {
    const d = brokenDoc();
    ops.moveWidgetToSection(d, "nie-ma", "s-obca");
    expect(idsBezp(ops.findColumn(d, "c-obca"))).toEqual(["w-obcy"]);
    expect(idsBezp(ops.findColumn(d, "ic-cel"))).toEqual(["w-cel"]);
  });

  it("moveWidgetToSection zakłada kolumnę, gdy sekcja docelowa nie ma tablicy dzieci", () => {
    const d = brokenDoc();
    ops.moveWidgetToSection(d, "w-cel", "s-bez-children");
    const cel = ops.findSection(d, "s-bez-children");
    expect(cel?.children).toHaveLength(1);
    expect(idsBezp(cel?.children[0] as ColumnNode)).toEqual(["w-cel"]);
  });

  it("moveWidgetToSection zakłada kolumnę, gdy sekcja docelowa ma tylko dziurę w dzieciach", () => {
    const d = brokenDoc();
    ops.moveWidgetToSection(d, "w-cel", "s-dziura");
    const cel = ops.findSection(d, "s-dziura");
    // Dziura zostaje na miejscu, nowa kolumna dochodzi na koniec.
    expect(cel?.children).toHaveLength(2);
    expect(idsBezp(cel?.children[1] as ColumnNode)).toEqual(["w-cel"]);
  });

  it("moveWidgetToSection zakłada kolumnę, gdy sekcja wewnętrzna celu nie ma żadnej kolumny", () => {
    const d = brokenDoc();
    ops.moveWidgetToSection(d, "w-cel", "s-inner-bez-kolumn");
    const cel = ops.findSection(d, "s-inner-bez-kolumn");
    expect(cel?.children).toHaveLength(2);
    expect(cel?.children[1].kind).toBe("column");
    expect(idsBezp(cel?.children[1] as ColumnNode)).toEqual(["w-cel"]);
  });

  it("moveWidgetToSection używa istniejącej kolumny celu, nawet gdy nie ma ona tablicy dzieci", () => {
    const d = brokenDoc();
    ops.moveWidgetToSection(d, "w-cel", "s-kolumna-bez-children");
    const cel = ops.findSection(d, "s-kolumna-bez-children");
    // Żadnej nowej kolumny - widget ląduje w tej, która już tam była.
    expect(cel?.children).toHaveLength(1);
    expect(idsBezp(ops.findColumn(d, "c-bez-children"))).toEqual(["w-cel"]);
  });
});

// DEFEKT: PRZENIESIENIE WIDGETU NA NIEISTNIEJĄCY CEL KASUJE WIDGET.
//
// WEJŚCIE: dokument z jednym widgetem `w1` i wywołanie przenoszenia, w którym
//   CEL nie istnieje w dokumencie - `moveWidgetTo(d, "w1", "widget-widmo")`,
//   `moveWidgetToColumn(d, "w1", "kolumna-widmo")` albo
//   `moveWidgetToSection(d, "w1", "sekcja-widmo")`. W edytorze taki stan
//   powstaje realnie: przeciągnięcie trwa, a w tym czasie druga zakładka
//   redakcji (albo cofnięcie/undo) usuwa kolumnę lub sekcję pod kursorem, więc
//   identyfikator celu z zdarzenia drop wskazuje węzeł, którego już nie ma.
// CO PSUJE: wszystkie trzy funkcje (src/lib/builder/operations.ts:427-472,
//   :474-510 i :512-564) najpierw WYCINAJĄ węzeł ze źródłowej kolumny
//   (`col.children.splice(i, 1)`), a dopiero potem szukają celu. Gdy cel się
//   nie znajdzie, `moveWidgetTo` po prostu kończy pętlę (:471), a
//   `moveWidgetToColumn` (:509) i `moveWidgetToSection` (:539 `if
//   (!targetSection) return;`) wychodzą wcześniej - i w żadnej z nich nie ma
//   ścieżki, która wstawiłaby wycięty węzeł z powrotem.
// KONSEKWENCJA: widget znika z dokumentu bezpowrotnie. Operacje mutują
//   roboczy dokument, który zaraz idzie do zapisu rewizji, więc redakcja traci
//   treść bez żadnego komunikatu - a jedynym śladem jest to, że po nieudanym
//   upuszczeniu widget przestaje istnieć. To ten sam przypadek brzegowy, który
//   `moveSectionTo` (:269-272) obsługuje POPRAWNIE: przy nieznanym celu
//   dokleja wyciętą sekcję na koniec dokumentu zamiast ją zgubić.
// WYMAGANA POPRAWKA: każda z trzech funkcji musi na ścieżce "cel nie
//   znaleziony" przywrócić węzeł - albo wstawiając go z powrotem na
//   zapamiętaną pozycję w kolumnie źródłowej, albo, wzorem `moveSectionTo`,
//   doklejając go na koniec. Alternatywnie: znaleźć cel PRZED wycięciem
//   źródła i wyjść bez żadnej mutacji, gdy celu nie ma.
describe("DEFEKT: przeniesienie na nieistniejący cel gubi widget", () => {
  it.fails("DEFEKT: moveWidgetTo z nieznanym CELEM nie moze usunac widgetu z dokumentu", () => {
    const d = doc(sec("s1", [col("c1", [w("w1"), w("w2")])]));
    ops.moveWidgetTo(d, "w1", "widget-widmo", "after");
    expect(ops.findWidget(d, "w1")).not.toBeNull();
  });

  it.fails(
    "DEFEKT: moveWidgetToColumn z nieznanym CELEM nie moze usunac widgetu z dokumentu",
    () => {
      const d = doc(sec("s1", [col("c1", [w("w1")])]));
      ops.moveWidgetToColumn(d, "w1", "kolumna-widmo");
      expect(ops.findWidget(d, "w1")).not.toBeNull();
    },
  );

  it.fails(
    "DEFEKT: moveWidgetToSection z nieznanym CELEM nie moze usunac widgetu z dokumentu",
    () => {
      const d = doc(sec("s1", [col("c1", [w("w1")])]));
      ops.moveWidgetToSection(d, "w1", "sekcja-widmo");
      expect(ops.findWidget(d, "w1")).not.toBeNull();
    },
  );
});
