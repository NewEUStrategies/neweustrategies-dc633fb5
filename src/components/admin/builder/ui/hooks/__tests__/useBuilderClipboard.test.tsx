// Schowek buildera: kopiowanie i wklejanie sekcji, sekcji wewnętrznej, kolumny
// i widgetu. Schowek żyje w `sessionStorage`, więc działa MIĘDZY KARTAMI - to
// jest jego sens i jednocześnie źródło ryzyka: wklejamy dane, których nie
// wyprodukowała ta sesja.
//
// Test przypina:
//  1. KLONOWANIE Z NOWYMI IDENTYFIKATORAMI. Wklejenie musi dać NOWE `id`,
//     inaczej dwa węzły w dokumencie mają ten sam identyfikator i każda
//     operacja (zaznaczenie, usunięcie, przesunięcie) trafia w losowy z nich.
//  2. MIEJSCE WKLEJENIA zależne od zaznaczenia: sekcja ląduje ZA zaznaczoną,
//     widget do kolumny w ognisku, kolumna do zaznaczonej sekcji (a bez
//     zaznaczenia - do nowej sekcji).
//  3. SANITYZACJĘ. Wklejenie przechodzi przez `safeParseBuilderDoc`, więc
//     dokument z uszkodzoną strukturą nie wywala kanwy.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type {
  BuilderDocument,
  ColumnNode,
  InnerSectionNode,
  SectionChild,
  SectionNode,
  WidgetNode,
} from "@/lib/builder/types";
import { copyToClipboard, readClipboard } from "@/lib/builder/clipboard";
import type { Selection } from "../../organisms/builder";
import { useBuilderClipboard } from "../useBuilderClipboard";

const w = (id: string): WidgetNode => ({ id, kind: "widget", type: "text", content: {} });
const col = (id: string, children: WidgetNode[] = []): ColumnNode => ({
  id,
  kind: "column",
  span: { desktop: 12 },
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

function baseDoc(): BuilderDocument {
  return {
    version: 1,
    sections: [
      sec("s1", [col("c1", [w("w1")]), inner("i1", [col("ic1", [w("iw1")])])]),
      sec("s2", [col("c2", [])]),
    ],
  };
}

/** Gospodarz haka: trzyma dokument i stosuje mutacje jak kanwa. */
function setup(selection: Selection, focused: ColumnNode | null = null, initial = baseDoc()) {
  const state = { doc: initial };
  const update = vi.fn((mut: (d: BuilderDocument) => void) => {
    const next: BuilderDocument = JSON.parse(JSON.stringify(state.doc));
    mut(next);
    state.doc = next;
  });
  const { result } = renderHook(() =>
    useBuilderClipboard({ doc: state.doc, selection, focusedColumn: focused, update }),
  );
  return { result, state, update };
}

const allIds = (d: BuilderDocument): string[] => {
  const out: string[] = [];
  const walk = (node: { id?: string; children?: unknown[]; columns?: unknown[] }) => {
    if (node.id) out.push(node.id);
    for (const child of [...(node.children ?? []), ...(node.columns ?? [])]) {
      walk(child as { id?: string });
    }
  };
  for (const s of d.sections) walk(s);
  return out;
};

beforeEach(() => {
  sessionStorage.clear();
});

describe("useBuilderClipboard - kopiowanie", () => {
  it.each([
    ["sekcja", { kind: "section", id: "s1" }, "s1"],
    ["sekcja wewnętrzna", { kind: "inner-section", id: "i1" }, "i1"],
    ["kolumna", { kind: "column", id: "c1" }, "c1"],
    ["widget", { kind: "widget", id: "w1" }, "w1"],
  ] as const)("kopiuje %s wraz z rodzajem", (_label, selection, id) => {
    const { result } = setup(selection);
    result.current.copySelection();
    const env = readClipboard();
    expect(env?.kind).toBe(selection.kind);
    expect(env?.node.id).toBe(id);
  });

  it("bez zaznaczenia nie zapisuje niczego", () => {
    const { result } = setup({ kind: null, id: null });
    result.current.copySelection();
    expect(readClipboard()).toBeNull();
  });

  it("zaznaczenie wskazujące nieistniejący węzeł nie zapisuje niczego", () => {
    const { result } = setup({ kind: "widget", id: "nie-ma" });
    result.current.copySelection();
    // Cichy zapis `null` do schowka dałby potem wklejenie „niczego” bez
    // żadnego komunikatu.
    expect(readClipboard()).toBeNull();
  });

  it("kopiowanie widgetu zapisuje sam widget, nie kolumnę", () => {
    const { result } = setup({ kind: "widget", id: "iw1" });
    result.current.copySelection();
    expect(readClipboard()?.node.kind).toBe("widget");
  });
});

describe("useBuilderClipboard - wklejanie sekcji", () => {
  it("wkleja sekcję ZA zaznaczoną", () => {
    copyToClipboard({ kind: "section", node: sec("skopiowana", [col("kc", [])]) });
    const { result, state } = setup({ kind: "section", id: "s1" });
    result.current.pasteFromClipboard();
    expect(state.doc.sections).toHaveLength(3);
    expect(state.doc.sections[1].id).not.toBe("skopiowana");
    expect(state.doc.sections[2].id).toBe("s2");
  });

  it("bez zaznaczonej sekcji dokłada na koniec", () => {
    copyToClipboard({ kind: "section", node: sec("skopiowana", [col("kc", [])]) });
    const { result, state } = setup({ kind: "widget", id: "w1" });
    result.current.pasteFromClipboard();
    expect(state.doc.sections).toHaveLength(3);
    expect(state.doc.sections[2].children).toHaveLength(1);
  });

  it("zaznaczenie sekcji, której nie ma, dokłada na koniec", () => {
    copyToClipboard({ kind: "section", node: sec("skopiowana", [col("kc", [])]) });
    const { result, state } = setup({ kind: "section", id: "nie-ma" });
    result.current.pasteFromClipboard();
    expect(state.doc.sections).toHaveLength(3);
  });

  it("wklejona sekcja ma NOWE identyfikatory w całym poddrzewie", () => {
    const source = sec("src-s", [col("src-c", [w("src-w")])]);
    copyToClipboard({ kind: "section", node: source });
    const { result, state } = setup({ kind: "section", id: "s1" });
    result.current.pasteFromClipboard();
    const ids = allIds(state.doc);
    // Powtórzony identyfikator sprawia, że zaznaczenie i usuwanie trafiają
    // w losowy z dwóch węzłów - stąd klonowanie z nowymi `id`.
    expect(ids).not.toContain("src-s");
    expect(ids).not.toContain("src-c");
    expect(ids).not.toContain("src-w");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("useBuilderClipboard - wklejanie widgetu", () => {
  it("wkleja widget do kolumny w ognisku", () => {
    copyToClipboard({ kind: "widget", node: w("src-w") });
    const { result, state } = setup({ kind: "widget", id: "w1" }, col("c2", []));
    result.current.pasteFromClipboard();
    const target = state.doc.sections[1].children[0] as ColumnNode;
    expect(target.children).toHaveLength(1);
    expect(target.children[0].id).not.toBe("src-w");
  });

  it("bez kolumny w ognisku nie wkleja widgetu", () => {
    copyToClipboard({ kind: "widget", node: w("src-w") });
    const { result, state } = setup({ kind: "widget", id: "w1" }, null);
    result.current.pasteFromClipboard();
    // Widget nie ma gdzie wylądować - lepiej nie zrobić nic niż wstawić go
    // w losowe miejsce dokumentu.
    expect(allIds(state.doc)).toEqual(allIds(baseDoc()));
  });

  it("kolumna w ognisku, której nie ma w dokumencie, nie psuje dokumentu", () => {
    copyToClipboard({ kind: "widget", node: w("src-w") });
    const { result, state } = setup({ kind: "widget", id: "w1" }, col("nie-ma", []));
    result.current.pasteFromClipboard();
    expect(allIds(state.doc)).toEqual(allIds(baseDoc()));
  });

  it("wkleja widget do kolumny z uszkodzoną listą dzieci", () => {
    copyToClipboard({ kind: "widget", node: w("src-w") });
    const broken: BuilderDocument = {
      version: 1,
      sections: [sec("s1", [{ id: "c1", kind: "column", span: { desktop: 12 } } as ColumnNode])],
    };
    const { result, state } = setup({ kind: "widget", id: "x" }, col("c1", []), broken);
    result.current.pasteFromClipboard();
    const target = state.doc.sections[0].children[0] as ColumnNode;
    expect(target.children).toHaveLength(1);
  });
});

describe("useBuilderClipboard - wklejanie kolumny i sekcji wewnętrznej", () => {
  it("wkleja kolumnę do zaznaczonej sekcji", () => {
    copyToClipboard({ kind: "column", node: col("src-c", [w("src-w")]) });
    const { result, state } = setup({ kind: "section", id: "s2" });
    result.current.pasteFromClipboard();
    expect(state.doc.sections[1].children).toHaveLength(2);
  });

  it("bez zaznaczonej sekcji tworzy dla kolumny NOWĄ sekcję", () => {
    copyToClipboard({ kind: "column", node: col("src-c", []) });
    const { result, state } = setup({ kind: "widget", id: "w1" });
    result.current.pasteFromClipboard();
    expect(state.doc.sections).toHaveLength(3);
    expect(state.doc.sections[2].children).toHaveLength(1);
  });

  it("kolumna wklejona do sekcji, której nie ma, nie zmienia dokumentu", () => {
    copyToClipboard({ kind: "column", node: col("src-c", []) });
    const { result, state } = setup({ kind: "section", id: "nie-ma" });
    result.current.pasteFromClipboard();
    expect(allIds(state.doc)).toEqual(allIds(baseDoc()));
  });

  it("wkleja sekcję wewnętrzną do zaznaczonej sekcji", () => {
    copyToClipboard({ kind: "inner-section", node: inner("src-i", [col("src-ic", [])]) });
    const { result, state } = setup({ kind: "section", id: "s2" });
    result.current.pasteFromClipboard();
    expect(state.doc.sections[1].children).toHaveLength(2);
    expect(state.doc.sections[1].children[1].kind).toBe("inner-section");
  });

  it("sekcja wewnętrzna bez zaznaczonej sekcji nie ma gdzie wylądować", () => {
    copyToClipboard({ kind: "inner-section", node: inner("src-i", [col("src-ic", [])]) });
    const { result, state } = setup({ kind: "widget", id: "w1" });
    result.current.pasteFromClipboard();
    expect(allIds(state.doc)).toEqual(allIds(baseDoc()));
  });

  it("sekcja wewnętrzna do sekcji, której nie ma, nie zmienia dokumentu", () => {
    copyToClipboard({ kind: "inner-section", node: inner("src-i", [col("src-ic", [])]) });
    const { result, state } = setup({ kind: "section", id: "nie-ma" });
    result.current.pasteFromClipboard();
    expect(allIds(state.doc)).toEqual(allIds(baseDoc()));
  });
});

describe("useBuilderClipboard - pusty i uszkodzony schowek", () => {
  it("pusty schowek nie wywołuje zapisu dokumentu", () => {
    const { result, update } = setup({ kind: "section", id: "s1" });
    result.current.pasteFromClipboard();
    expect(update).not.toHaveBeenCalled();
  });

  it("schowek ze śmieciem jest ignorowany", () => {
    sessionStorage.setItem("builder.clipboard.v1", "{to nie jest json");
    const { result, update } = setup({ kind: "section", id: "s1" });
    result.current.pasteFromClipboard();
    expect(update).not.toHaveBeenCalled();
  });

  it("koperta bez rodzaju jest ignorowana", () => {
    sessionStorage.setItem("builder.clipboard.v1", JSON.stringify({ node: w("x") }));
    const { result, update } = setup({ kind: "section", id: "s1" });
    result.current.pasteFromClipboard();
    expect(update).not.toHaveBeenCalled();
  });

  it("wklejenie sanityzuje dokument przy okazji", () => {
    copyToClipboard({ kind: "section", node: sec("src", [col("src-c", [])]) });
    const broken: BuilderDocument = {
      version: 1,
      sections: [sec("s1", [col("c1", [])]), null as unknown as SectionNode],
    };
    const { result, state } = setup({ kind: "section", id: "s1" }, null, broken);
    result.current.pasteFromClipboard();
    // Uszkodzony wpis w dokumencie nie może przejść dalej - `safeParseBuilderDoc`
    // odsiewa go przy każdym wklejeniu.
    expect(state.doc.sections.every((s) => s !== null)).toBe(true);
  });
});
