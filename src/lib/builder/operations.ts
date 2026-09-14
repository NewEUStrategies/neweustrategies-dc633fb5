// Pure operations on a BuilderDocument tree: find / mutate / duplicate / move.
// Returns new ids on duplicate so React keys stay stable and undo/redo works.
//
// The mutation helpers in the "structural mutations" section below operate
// IN PLACE on a draft document (the Builder deep-clones before calling them,
// so they never touch the live tree). They were extracted verbatim from
// Builder.tsx so they can be unit-tested in isolation.
//
// Operacje PRZENOSZENIA zwracają `boolean`: `true` = dokument się zmienił,
// `false` = nie było czego (albo gdzie) przenosić i drzewo pozostało
// NIETKNIĘTE. Nie jest to kosmetyka sygnatury - hook buildera pomija na `false`
// wpis do historii i rewizję autozapisu, więc odrzucone upuszczenie nie dokłada
// kroku „Cofnij", który nic nie cofa, i nie zapisuje rewizji bez zmian. Reszta
// operacji nadal zwraca `void`.
import type {
  BuilderDocument,
  SectionNode,
  ColumnNode,
  InnerSectionNode,
  WidgetNode,
  Device,
} from "./types";
import { newId } from "./types";
import { isKnownWidgetType } from "./schema";

export type NodeKind = "section" | "inner-section" | "column" | "widget";

// ---------- deep clone with fresh ids ----------

export function cloneWidget(w: WidgetNode): WidgetNode {
  const copy = JSON.parse(JSON.stringify(w ?? {})) as Partial<WidgetNode>;
  return {
    ...copy,
    id: newId(),
    kind: "widget",
    type: isKnownWidgetType(copy.type) ? copy.type : "text",
    content:
      copy.content && typeof copy.content === "object" && !Array.isArray(copy.content)
        ? copy.content
        : {},
  } as WidgetNode;
}

export function cloneColumn(c: ColumnNode): ColumnNode {
  const copy = JSON.parse(JSON.stringify(c ?? {})) as ColumnNode;
  copy.id = newId();
  copy.kind = "column";
  copy.span =
    copy.span && typeof copy.span === "object" && !Array.isArray(copy.span) ? copy.span : {};
  copy.children = (Array.isArray(copy.children) ? copy.children : [])
    .filter((w): w is WidgetNode => !!w && isKnownWidgetType(w.type))
    .map(cloneWidget);
  return copy;
}

export function cloneInner(s: InnerSectionNode): InnerSectionNode {
  const copy = JSON.parse(JSON.stringify(s ?? {})) as InnerSectionNode;
  copy.id = newId();
  copy.kind = "inner-section";
  copy.columns = (Array.isArray(copy.columns) ? copy.columns : []).filter(Boolean).map(cloneColumn);
  return copy;
}

export function cloneSection(s: SectionNode): SectionNode {
  const copy = JSON.parse(JSON.stringify(s ?? {})) as SectionNode;
  copy.id = newId();
  copy.kind = "section";
  copy.children = (Array.isArray(copy.children) ? copy.children : [])
    .filter(Boolean)
    .map((c) => (c.kind === "inner-section" ? cloneInner(c) : cloneColumn(c)));
  return copy;
}

// ---------- find + remove ----------

/**
 * KAŻDA kolumna dokumentu, w kolejności dokumentu, z pominięciem dziur.
 *
 * Dziecko sekcji jest ALBO kolumną, ALBO sekcją wewnętrzną, która trzyma
 * kolumny - ten trójpoziomowy obchód był wcześniej przepisany z ręki w
 * siedmiu funkcjach tego pliku. Jedno źródło prawdy znaczy, że obrona przed
 * uszkodzonym drzewem (`null` w `sections`, `children` albo `columns` - realny
 * ślad niepełnej migracji, patrz `brokenDoc` w testach) nie może się rozjechać
 * między operacjami: dopisanie obrony w jednym miejscu było poprawką w jednej
 * operacji i pozostawało dziurą w sześciu pozostałych.
 */
function* eachColumn(doc: BuilderDocument): Generator<ColumnNode> {
  for (const section of doc?.sections ?? []) {
    if (!section) continue;
    for (const child of section.children ?? []) {
      if (!child) continue;
      if (child.kind === "column") {
        yield child;
        continue;
      }
      for (const col of child.columns ?? []) if (col) yield col;
    }
  }
}

/**
 * Kolumna I INDEKS widgetu - w tej kolejności, bo przenoszenie potrzebuje
 * POZYCJI, a nie tylko węzła: bez indeksu nie da się ani wyciąć widgetu, ani
 * policzyć, gdzie ma wylądować względem celu. `index >= 0` gwarantuje, że
 * `column.children` jest tablicą, więc wołający nie musi jej już bronić.
 */
function locateWidget(
  doc: BuilderDocument,
  id: string,
): { column: ColumnNode; index: number } | null {
  for (const column of eachColumn(doc)) {
    const index = (column.children ?? []).findIndex((w) => w?.id === id);
    if (index >= 0) return { column, index };
  }
  return null;
}

export function findWidget(
  doc: BuilderDocument,
  id: string,
): { widget: WidgetNode; column: ColumnNode } | null {
  const at = locateWidget(doc, id);
  return at ? { widget: at.column.children[at.index], column: at.column } : null;
}

export function findSection(doc: BuilderDocument, id: string): SectionNode | null {
  if (!doc?.sections) return null;
  return doc.sections.find((s) => s?.id === id) ?? null;
}

export function findColumn(doc: BuilderDocument, id: string): ColumnNode | null {
  for (const column of eachColumn(doc)) if (column.id === id) return column;
  return null;
}

export function findInner(doc: BuilderDocument, id: string): InnerSectionNode | null {
  if (!doc?.sections) return null;
  for (const s of doc.sections) {
    if (!s) continue;
    const children = s.children ?? [];
    for (const c of children) {
      if (!c) continue;
      if (c.kind === "inner-section" && c.id === id) return c;
    }
  }
  return null;
}

// ---------- node factories ----------

export const newColumn = (span = 12): ColumnNode => ({
  id: newId(),
  kind: "column",
  span: { desktop: span },
  children: [],
});

export const newSection = (colsOrSpans: number | number[] = 1): SectionNode => {
  const spans = Array.isArray(colsOrSpans)
    ? colsOrSpans
    : Array.from({ length: colsOrSpans }, () => 12 / colsOrSpans);
  return {
    id: newId(),
    kind: "section",
    children: spans.map((sp) => newColumn(sp)),
  };
};

export const newInnerSection = (colsOrSpans: number | number[] = [6, 6]): InnerSectionNode => {
  const spans = Array.isArray(colsOrSpans)
    ? colsOrSpans
    : Array.from({ length: colsOrSpans }, () => 12 / colsOrSpans);
  return {
    id: newId(),
    kind: "inner-section",
    columns: spans.map((sp) => newColumn(sp)),
  };
};

/**
 * Kontener = sekcja pełniąca rolę wrappera. Startuje PUSTY - bez żadnych
 * sekcji wewnętrznych ani kolumn. Użytkownik dopiero po utworzeniu wybiera
 * strukturę (liczbę kolumn) za pomocą picker'a rysowanego w kanwasie w miejscu
 * pustego panelu (lub aktywnej zakładki w wariancie tabowanym). W wariancie
 * z zakładkami tworzone są tylko puste karty zakładek - żadnych domyślnych
 * kolumn per zakładka.
 */
export const newContainerSection = (withTabs: boolean): SectionNode => {
  if (!withTabs) {
    return {
      id: newId(),
      kind: "section",
      children: [],
    };
  }
  const tab1Id = newId();
  const tab2Id = newId();
  return {
    id: newId(),
    kind: "section",
    tabs: {
      enabled: true,
      orientation: "horizontal",
      variant: "underline",
      align: "start",
      mobileMode: "scroll",
      defaultTabId: tab1Id,
      items: [
        { id: tab1Id, label_pl: "Zakładka 1", label_en: "Tab 1" },
        { id: tab2Id, label_pl: "Zakładka 2", label_en: "Tab 2" },
      ],
    },
    children: [],
  };
};

// ---------- structural mutations (mutate a draft doc in place) ----------

export function addSection(d: BuilderDocument, colsOrSpans: number | number[]): void {
  d.sections.push(newSection(colsOrSpans));
}

export function insertSectionAt(
  d: BuilderDocument,
  index: number,
  colsOrSpans: number | number[],
): void {
  d.sections.splice(index, 0, newSection(colsOrSpans));
}

/** Add a column structure inside one tab of a tabbed container. */
export function addSectionToTab(
  d: BuilderDocument,
  sectionId: string,
  tabId: string,
  colsOrSpans: number | number[],
): void {
  const section = d.sections.find((candidate) => candidate?.id === sectionId);
  if (!section?.tabs?.items.some((tab) => tab.id === tabId)) return;
  if (!section.children) section.children = [];
  section.children.push({ ...newInnerSection(colsOrSpans), tabId });
}

/** Add a column structure directly inside a container-section (no tabs). */
export function addSectionToContainer(
  d: BuilderDocument,
  sectionId: string,
  colsOrSpans: number | number[],
): void {
  const section = d.sections.find((candidate) => candidate?.id === sectionId);
  if (!section) return;
  if (!section.children) section.children = [];
  section.children.push(newInnerSection(colsOrSpans));
}

export function insertSectionNode(d: BuilderDocument, section: SectionNode): void {
  d.sections.push(section);
}

export function insertContainerAt(d: BuilderDocument, index: number, withTabs: boolean): void {
  d.sections.splice(index, 0, newContainerSection(withTabs));
}

export function removeSection(d: BuilderDocument, id: string): void {
  d.sections = d.sections.filter((s) => s?.id !== id);
}

export function moveSection(d: BuilderDocument, id: string, dir: -1 | 1): void {
  const i = d.sections.findIndex((s) => s?.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= d.sections.length) return;
  [d.sections[i], d.sections[j]] = [d.sections[j], d.sections[i]];
}

export function duplicateSection(d: BuilderDocument, id: string): void {
  const i = d.sections.findIndex((s) => s?.id === id);
  if (i < 0) return;
  d.sections.splice(i + 1, 0, cloneSection(d.sections[i]));
}

/**
 * @returns czy dokument się zmienił - patrz kontrakt przy `moveWidgetTo`.
 *   Nieznany CEL nie jest tu porażką: sekcja ląduje na końcu dokumentu
 *   (zachowanie przypięte testem), więc coś się zmieniło.
 */
export function moveSectionTo(
  d: BuilderDocument,
  srcId: string,
  targetId: string,
  pos: "before" | "after",
): boolean {
  if (srcId === targetId) return false;
  const i = d.sections.findIndex((s) => s?.id === srcId);
  if (i < 0) return false;
  const [node] = d.sections.splice(i, 1);
  const j = d.sections.findIndex((s) => s?.id === targetId);
  if (j < 0) {
    d.sections.push(node);
    return true;
  }
  d.sections.splice(pos === "before" ? j : j + 1, 0, node);
  return true;
}

export function addInnerSection(d: BuilderDocument, sectionId: string): void {
  const s = d.sections.find((x) => x?.id === sectionId);
  if (s) {
    if (!s.children) s.children = [];
    s.children.push(newInnerSection());
  }
}

export function addColumn(d: BuilderDocument, sectionId: string): void {
  const s = d.sections.find((x) => x?.id === sectionId);
  if (s) {
    if (!s.children) s.children = [];
    const cols = s.children.filter((c) => c?.kind === "column").length;
    s.children.push(newColumn(Math.max(1, Math.floor(12 / (cols + 1)))));
  }
}

export function removeColumn(d: BuilderDocument, colId: string): void {
  for (const s of d.sections) {
    if (!s) continue;
    s.children = (s.children ?? []).filter((c) => !(c?.kind === "column" && c.id === colId));
    for (const c of s.children)
      if (c?.kind === "inner-section") c.columns = (c.columns ?? []).filter((x) => x?.id !== colId);
  }
}

export function duplicateColumn(d: BuilderDocument, colId: string): void {
  for (const s of d.sections) {
    if (!s) continue;
    const children = s.children ?? [];
    const i = children.findIndex((c) => c?.kind === "column" && c.id === colId);
    if (i >= 0) {
      s.children.splice(i + 1, 0, cloneColumn(children[i] as ColumnNode));
      return;
    }
    for (const c of children)
      if (c?.kind === "inner-section") {
        const columns = c.columns ?? [];
        const j = columns.findIndex((x) => x?.id === colId);
        if (j >= 0) {
          c.columns.splice(j + 1, 0, cloneColumn(columns[j]));
          return;
        }
      }
  }
}

export function removeWidget(d: BuilderDocument, wid: string): void {
  // Czyścimy WSZYSTKIE kolumny, a nie tylko pierwsze trafienie: gdyby drzewo
  // niosło ten sam identyfikator dwa razy (zduplikowana rewizja, import),
  // wyjście po pierwszym trafieniu zostawiłoby widget-widmo na stronie.
  for (const column of eachColumn(d)) {
    column.children = (column.children ?? []).filter((w) => w?.id !== wid);
  }
}

export function duplicateWidget(d: BuilderDocument, wid: string): void {
  const at = locateWidget(d, wid);
  if (!at) return;
  at.column.children.splice(at.index + 1, 0, cloneWidget(at.column.children[at.index]));
}

/**
 * Kolumna wskazana identyfikatorem, JAKI NIESIE KANWA - a ten nie zawsze jest
 * identyfikatorem kolumny.
 *
 * `data-col-id` jest stemplowane na SLOCIE dziecka sekcji, a dzieckiem sekcji
 * bywa również sekcja wewnętrzna (BuilderRenderer, `visibleCols.map`); jej
 * własne kolumny siedzą o poziom niżej i tego atrybutu NIE mają. Upuszczenie na
 * wyściółkę sekcji wewnętrznej (12 px góra/dół), na jej tło albo w przerwę
 * między jej kolumnami trafia więc tutaj z identyfikatorem SEKCJI WEWNĘTRZNEJ,
 * którego żadna kolumna nigdy nie dopasuje. Nie jest to wyścig ani uszkodzony
 * dokument - to zwykłe upuszczenie w zdrowym drzewie, a kanwa maluje tam pełną
 * zachętę „upuść tutaj" (`is-drop-into`). Odpowiedzią nie może być ani utrata
 * widgetu (tak było przed poprawką), ani cisza: celujemy w pierwszą kolumnę tej
 * sekcji wewnętrznej, a gdy nie ma ona żadnej - zakładamy pełnowymiarową,
 * dokładnie jak `moveWidgetToSection` dla sekcji bez kolumn.
 */
function columnForDrop(d: BuilderDocument, colId: string): ColumnNode | null {
  const column = findColumn(d, colId);
  if (column) return column;
  const inner = findInner(d, colId);
  if (!inner) return null;
  const existing = (inner.columns ?? []).find((c): c is ColumnNode => !!c);
  if (existing) return existing;
  if (!inner.columns) inner.columns = [];
  const created = newColumn(12);
  inner.columns.push(created);
  return created;
}

/** Push a ready-made widget node into a specific column. */
export function addWidgetToColumn(d: BuilderDocument, colId: string, widget: WidgetNode): void {
  const c = columnForDrop(d, colId);
  if (!c) return;
  if (!c.children) c.children = [];
  c.children.push(widget);
}

/** Push a ready-made widget into a brand-new 1-column section. */
export function addWidgetToNewSection(d: BuilderDocument, widget: WidgetNode): void {
  const s = newSection(1);
  const col = s.children[0] as ColumnNode;
  if (!col.children) col.children = [];
  col.children.push(widget);
  d.sections.push(s);
}

/** Insert a ready-made widget before/after an existing widget (across columns). */
export function insertWidgetNear(
  d: BuilderDocument,
  targetWidgetId: string,
  pos: "before" | "after",
  widget: WidgetNode,
): void {
  const at = locateWidget(d, targetWidgetId);
  if (!at) return;
  at.column.children.splice(pos === "before" ? at.index : at.index + 1, 0, widget);
}

/**
 * Append a ready-made widget to a section. The widget is always placed in a
 * full-width (span 12) column so that dropping a widget directly onto a
 * section background gives it its own full-width row, rather than squeezing
 * it into an existing narrow column.
 *
 * - Empty section → create a span-12 column.
 * - Section with existing children → append a new span-12 column at the end
 *   (the grid wraps so it lands on its own row underneath).
 */
export function appendWidgetToSection(
  d: BuilderDocument,
  sectionId: string,
  widget: WidgetNode,
  tabId?: string,
): void {
  const s = d.sections.find((x) => x?.id === sectionId);
  if (!s) return;
  if (!s.children) s.children = [];
  const newCol = newColumn(12);
  newCol.children = [widget];
  if (tabId && s.tabs?.items.some((tab) => tab.id === tabId)) newCol.tabId = tabId;
  s.children.push(newCol);
}

/**
 * Przenieś widget przed/za inny widget - także między kolumnami i sekcjami.
 *
 * KOLEJNOŚĆ DZIAŁAŃ JEST CZĘŚCIĄ KONTRAKTU: najpierw namierzamy ŹRÓDŁO ORAZ
 * CEL, i tylko gdy OBA istnieją, cokolwiek wycinamy. Wcześniej było odwrotnie -
 * widget wypadał ze swojej kolumny pierwszym `splice`, a gdy cel się nie
 * znalazł, pętla szukania po prostu się kończyła i węzeł przepadał z dokumentu
 * BEZ ŚLADU. Upuszczenie na cel, którego już nie ma, nie jest teoretyczne:
 * identyfikator celu czytamy z atrybutu DOM w chwili `drop`, a między ostatnim
 * rysowaniem a upuszczeniem druga karta redakcji może usunąć kolumnę, redaktor
 * cofnąć zmianę (Ctrl+Z), a sekcja przebudować się pod kursorem. Dokument leci
 * zaraz do autozapisu, więc taka utrata byłaby cicha i nieodwracalna. Ta sama
 * gałąź brzegowa, którą `moveSectionTo` obsługiwało poprawnie od początku.
 *
 * @returns czy dokument się zmienił. `false` znaczy „nie było czego albo gdzie
 *   przenosić" i DOKUMENT POZOSTAJE NIETKNIĘTY - wołający (hook buildera)
 *   pomija wtedy wpis do historii i rewizję autozapisu, zamiast dokładać krok
 *   `undo`, który nic nie cofa.
 */
export function moveWidgetTo(
  d: BuilderDocument,
  srcId: string,
  targetId: string,
  pos: "before" | "after",
): boolean {
  if (srcId === targetId) return false;
  const from = locateWidget(d, srcId);
  const to = locateWidget(d, targetId);
  if (!from || !to) return false;

  const [node] = from.column.children.splice(from.index, 1);
  // Wycięcie źródła przesuwa cel o jedno miejsce w lewo, ale TYLKO gdy oba
  // leżały w tej samej kolumnie, a źródło było wcześniej. Dokładnie tę
  // arytmetykę dawał stary kod (szukał celu już po wycięciu) - tutaj jest
  // policzona jawnie, więc nie wymaga mutowania drzewa na próbę.
  const at = to.index - (from.column === to.column && from.index < to.index ? 1 : 0);
  to.column.children.splice(pos === "before" ? at : at + 1, 0, node);
  return true;
}

/**
 * Przenieś widget na KONIEC wskazanej kolumny. Cel namierzamy przed wycięciem
 * źródła - uzasadnienie i kontrakt zwracanej wartości jak w `moveWidgetTo`.
 * `targetColId` przechodzi przez `columnForDrop`, bo kanwa podaje tu również
 * identyfikatory sekcji wewnętrznych (patrz komentarz tej funkcji).
 */
export function moveWidgetToColumn(
  d: BuilderDocument,
  srcId: string,
  targetColId: string,
): boolean {
  // Źródło sprawdzamy PIERWSZE: `columnForDrop` potrafi założyć kolumnę
  // w pustej sekcji wewnętrznej, a nie ma po co jej zakładać dla przeniesienia,
  // które i tak się nie wykona.
  const from = locateWidget(d, srcId);
  if (!from) return false;
  const target = columnForDrop(d, targetColId);
  if (!target) return false;

  const [node] = from.column.children.splice(from.index, 1);
  if (!target.children) target.children = [];
  target.children.push(node);
  return true;
}

/**
 * Przenieś widget do sekcji: ląduje na końcu jej PIERWSZEJ kolumny (własnej
 * albo pierwszej kolumny sekcji wewnętrznej), a gdy sekcja nie ma żadnej -
 * zakładamy pełnowymiarową. Cel namierzamy przed wycięciem źródła -
 * uzasadnienie i kontrakt zwracanej wartości jak w `moveWidgetTo`.
 */
export function moveWidgetToSection(
  d: BuilderDocument,
  srcId: string,
  targetSectionId: string,
): boolean {
  const from = locateWidget(d, srcId);
  const targetSection = findSection(d, targetSectionId);
  if (!from || !targetSection) return false;

  // Pierwsza kolumna celu - szukana PRZED wycięciem, żeby cała funkcja trzymała
  // się schematu „sprawdź wszystko, potem zmieniaj". Dziury i sekcje wewnętrzne
  // bez kolumn przeskakujemy; węzeł kolumny zostaje ważny po wycięciu źródła.
  let targetColumn: ColumnNode | null = null;
  for (const child of targetSection.children ?? []) {
    if (!child) continue;
    if (child.kind === "column") {
      targetColumn = child;
      break;
    }
    const firstInner = (child.columns ?? [])[0];
    if (firstInner) {
      targetColumn = firstInner;
      break;
    }
  }

  const [node] = from.column.children.splice(from.index, 1);
  if (!targetColumn) {
    targetColumn = newColumn(12);
    if (!targetSection.children) targetSection.children = [];
    targetSection.children.push(targetColumn);
  }
  if (!targetColumn.children) targetColumn.children = [];
  targetColumn.children.push(node);
  return true;
}

/** Detach a global-widget instance: the local snapshot becomes a plain widget. */
export function unlinkGlobalWidget(d: BuilderDocument, wid: string): void {
  const f = findWidget(d, wid);
  if (f?.widget.globalId) delete f.widget.globalId;
}

/**
 * Start a section A/B test: duplicate the section right below the original and
 * tag both with the experiment id (original = variant A, copy = variant B).
 */
export function startAbTest(d: BuilderDocument, sectionId: string, experimentId: string): void {
  const i = d.sections.findIndex((s) => s?.id === sectionId);
  if (i < 0) return;
  const original = d.sections[i];
  const copy = cloneSection(original);
  original.advanced = { ...(original.advanced ?? {}), abTest: { experimentId, variant: "a" } };
  copy.advanced = { ...(copy.advanced ?? {}), abTest: { experimentId, variant: "b" } };
  d.sections.splice(i + 1, 0, copy);
}

/**
 * End a section A/B test. `keep` decides which variant survives:
 * "both" only removes the tags (sections stay as regular siblings), "a"/"b"
 * additionally deletes the losing variant.
 */
export function endAbTest(
  d: BuilderDocument,
  experimentId: string,
  keep: "a" | "b" | "both",
): void {
  if (keep !== "both") {
    d.sections = d.sections.filter(
      (s) =>
        !(s?.advanced?.abTest?.experimentId === experimentId && s.advanced.abTest.variant !== keep),
    );
  }
  for (const s of d.sections) {
    if (s?.advanced?.abTest?.experimentId === experimentId) delete s.advanced.abTest;
  }
}

/** Toggle a node's per-device visibility flag. */
export function toggleHidden(d: BuilderDocument, id: string, kind: NodeKind, device: Device): void {
  const target =
    kind === "section"
      ? findSection(d, id)
      : kind === "inner-section"
        ? findInner(d, id)
        : kind === "column"
          ? findColumn(d, id)
          : (findWidget(d, id)?.widget ?? null);
  if (!target) return;
  target.advanced = target.advanced ?? {};
  target.advanced.hideOn = {
    ...(target.advanced.hideOn ?? {}),
    [device]: !target.advanced.hideOn?.[device],
  };
}
