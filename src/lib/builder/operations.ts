// Pure operations on a BuilderDocument tree: find / mutate / duplicate / move.
// Returns new ids on duplicate so React keys stay stable and undo/redo works.
//
// The mutation helpers in the "structural mutations" section below operate
// IN PLACE on a draft document (the Builder deep-clones before calling them,
// so they never touch the live tree). They were extracted verbatim from
// Builder.tsx so they can be unit-tested in isolation.
//
// Operacje PRZENOSZENIA zwracają `MoveOutcome` (patrz niżej), a nie `void`.
// Nie jest to kosmetyka sygnatury: hook buildera zapisuje krok historii
// i rewizję autozapisu WYŁĄCZNIE dla `"moved"`, a komunikat pokazuje wyłącznie
// dla `"rejected"`. Reszta operacji nadal zwraca `void`.
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
 * Wynik operacji przenoszenia. TRZY stany, nie dwa, bo wołający musi rozróżnić
 * dwa RÓŻNE rodzaje „nic nie zrobiłem":
 *
 * - `"moved"`     - dokument się zmienił; tylko to zasługuje na krok historii
 *                   i rewizję autozapisu.
 * - `"unchanged"` - źródło i cel istnieją, ale widget (albo sekcja) już stoi
 *                   dokładnie tam, gdzie go upuszczono. Drzewo jest NIETKNIĘTE.
 *                   To najzwyklejszy gest redakcji - podniesienie węzła
 *                   i odłożenie go na miejsce, upuszczenie na siebie, na połowę
 *                   sąsiada - więc nie wolno go ani zapisywać, ani zgłaszać
 *                   jako błąd. Bez tego stanu boolean kłamał: „wykonałem ruch"
 *                   brano za „dokument się zmienił" i każde takie upuszczenie
 *                   dokładało krok „Cofnij", który nic nie cofa, oraz rewizję
 *                   autozapisu identyczną z poprzednią.
 * - `"rejected"`  - źródła albo celu NIE MA w dokumencie. Drzewo jest
 *                   NIETKNIĘTE (to jest sedno poprawki - wcześniej węzeł był
 *                   już wtedy wycięty i przepadał). O tym trzeba redakcji
 *                   powiedzieć, bo jej gest nie zadziałał.
 */
export type MoveOutcome = "moved" | "unchanged" | "rejected";

/**
 * @returns patrz `MoveOutcome`. UWAGA na nieznany CEL: sekcja ląduje wtedy na
 *   końcu dokumentu (zachowanie przypięte testem od czasu, gdy alternatywą było
 *   ZGUBIENIE sekcji), czyli wynikiem jest `"moved"`, a nie `"rejected"` -
 *   sekcja się przeniosła, tylko nie tam, gdzie ją upuszczono.
 */
export function moveSectionTo(
  d: BuilderDocument,
  srcId: string,
  targetId: string,
  pos: "before" | "after",
): MoveOutcome {
  if (srcId === targetId) return "unchanged";
  const i = d.sections.findIndex((s) => s?.id === srcId);
  if (i < 0) return "rejected";
  const t = d.sections.findIndex((s) => s?.id === targetId);
  // Pozycję docelową liczymy PRZED wycięciem - inaczej nie da się stwierdzić,
  // że sekcja już tam stoi. `t` to indeks celu w tablicy sprzed wycięcia, `j`
  // po wycięciu (źródło przed celem przesuwa go o jedno miejsce w lewo).
  const j = t < 0 ? -1 : t - (i < t ? 1 : 0);
  const insertAt = j < 0 ? d.sections.length - 1 : pos === "before" ? j : j + 1;
  if (insertAt === i) return "unchanged";
  const [node] = d.sections.splice(i, 1);
  d.sections.splice(insertAt, 0, node);
  return "moved";
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
 * Kolumna, którą upuszczający NA PEWNO widzi na kanwie.
 *
 * Renderer filtruje kolumny przez `evaluateAccess` - i sekcje wewnętrzne, i
 * kolumny najwyższego poziomu - więc kolumna z regułą dostępu może w ogóle nie
 * być narysowana. Wrzucenie tam widgetu daje DWIE szkody naraz: widget znika
 * redaktorowi z oczu (czyli znów „upuszczenie skasowało treść", tylko innym
 * mechanizmem) i dziedziczy cudzą regułę dostępu, więc trafia do innej
 * publiczności niż ta, dla której go dodano.
 *
 * Nie pytamy tu `evaluateAccess`, kto patrzy, i nie importujemy
 * `accessControl` - ten moduł ciągnie `useAuth`, a to jest czysty moduł
 * drzewa, który jedzie w lekkim chunku. Zamiast tego reguła jest ZACHOWAWCZA
 * w jedną stronę: KAŻDA obecna reguła znaczy „może być niewidoczna", więc
 * celujemy tylko w kolumny bez reguły (te renderer pokazuje zawsze, bo
 * `evaluateAccess(undefined)` to `true`). Może to kosztować jedną kolumnę
 * dołożoną niepotrzebnie; nigdy nie kosztuje zniknięcia treści ani zmiany
 * publiczności - a drugi kierunek pomyłki kosztowałby oba.
 */
const isColumnVisibleToEditor = (c: ColumnNode | null | undefined): c is ColumnNode =>
  !!c && !c.advanced?.access;

/**
 * Kolumna wskazana identyfikatorem, JAKI NIESIE KANWA - CZYSTO, bez tworzenia
 * czegokolwiek. Rozwiązuje ten sam rozjazd co `columnForDrop` (patrz jego opis:
 * `data-col-id` bywa identyfikatorem SEKCJI WEWNĘTRZNEJ, nie kolumny), ale
 * zatrzymuje się na tym, co w dokumencie JUŻ JEST.
 *
 * Czystość nie jest tu ozdobnikiem, tylko warunkiem użycia: `focusedColumn`
 * w `useBuilderOperations` to `useMemo` liczony na ŻYWYM dokumencie, poza
 * cyklem „głęboka kopia -> mutacja -> historia". Dołożenie kolumny stamtąd
 * dopisałoby węzeł do dokumentu, którego nikt nie zapisał do historii - zmiana
 * bez kroku „Cofnij", niewidoczna dla autozapisu i gubiona przy następnym
 * renderze. Dlatego sekcja wewnętrzna BEZ ANI JEDNEJ kolumny daje tutaj `null`;
 * zakładanie kolumny zostaje wyłącznie po stronie upuszczeń (`columnForDrop`),
 * które i tak mutują kopię roboczą.
 */
export function columnForCanvasId(d: BuilderDocument, colId: string): ColumnNode | null {
  const column = findColumn(d, colId);
  if (column) return column;
  const inner = findInner(d, colId);
  if (!inner) return null;
  // Pierwsza kolumna, którą redaktor NA PEWNO widzi - identycznie jak
  // `columnForDrop` i `moveWidgetToSection` (patrz `isColumnVisibleToEditor`):
  // ani dziura na pozycji zerowej, ani cudza reguła dostępu nie może przesłonić
  // dobrej kolumny. Kliknięcie i upuszczenie MUSZĄ celować w to samo miejsce -
  // rozjazd między nimi jest dokładnie tym, co ta zmiana likwiduje.
  return (inner.columns ?? []).find(isColumnVisibleToEditor) ?? null;
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
 *
 * OGRANICZENIE, ŚWIADOME: to PIERWSZA kolumna, a nie ta pod kursorem - w
 * kilkukolumnowej sekcji wewnętrznej widget wyląduje więc po lewej, niezależnie
 * od tego, w którą przerwę go upuszczono - w pierwszej, którą redaktor NA PEWNO
 * widzi (kolumny z regułą dostępu omijamy, patrz `isColumnVisibleToEditor`).
 * Wybór najbliższej kolumny wymagałby geometrii wskaźnika, której ta warstwa nie zna
 * i znać nie powinna; `moveWidgetToSection` bierze pierwszą kolumnę od zawsze.
 *
 * TYLKO DLA UPUSZCZEŃ - bo MUTUJE (zakłada kolumnę). Ścieżki, które jedynie
 * odczytują dokument (kolumna w ognisku, panel właściwości, wklejanie), biorą
 * czysty `columnForCanvasId` powyżej.
 */
function columnForDrop(d: BuilderDocument, colId: string): ColumnNode | null {
  const existing = columnForCanvasId(d, colId);
  if (existing) return existing;
  const inner = findInner(d, colId);
  if (!inner) return null;
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
 * @returns patrz `MoveOutcome`. `"rejected"` i `"unchanged"` ZOSTAWIAJĄ
 *   dokument nietknięty; hook buildera zapisuje historię i rewizję tylko dla
 *   `"moved"`, a komunikat pokazuje tylko dla `"rejected"`.
 */
export function moveWidgetTo(
  d: BuilderDocument,
  srcId: string,
  targetId: string,
  pos: "before" | "after",
): MoveOutcome {
  if (srcId === targetId) return "unchanged";
  const from = locateWidget(d, srcId);
  const to = locateWidget(d, targetId);
  if (!from || !to) return "rejected";

  // Wycięcie źródła przesuwa cel o jedno miejsce w lewo, ale TYLKO gdy oba
  // leżą w tej samej kolumnie, a źródło jest wcześniej. Dokładnie tę arytmetykę
  // dawał stary kod (szukał celu już po wycięciu) - tutaj jest policzona
  // jawnie, PRZED mutacją, więc widać z niej również przypadek „widget już tam
  // stoi": upuszczenie na połowę sąsiada, od której jest bliżej.
  const at = to.index - (from.column === to.column && from.index < to.index ? 1 : 0);
  const insertAt = pos === "before" ? at : at + 1;
  if (from.column === to.column && insertAt === from.index) return "unchanged";

  const [node] = from.column.children.splice(from.index, 1);
  to.column.children.splice(insertAt, 0, node);
  return "moved";
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
): MoveOutcome {
  // Źródło sprawdzamy PIERWSZE: `columnForDrop` potrafi założyć kolumnę
  // w pustej sekcji wewnętrznej, a nie ma po co jej zakładać dla przeniesienia,
  // które i tak się nie wykona.
  const from = locateWidget(d, srcId);
  if (!from) return "rejected";
  const target = columnForDrop(d, targetColId);
  if (!target) return "rejected";
  // Widget już stoi na końcu tej kolumny - wycięcie i dołożenie dałoby dokument
  // bajt w bajt identyczny. TĘDY przychodzi upuszczenie widgetu na SAMEGO
  // SIEBIE: kanwa odfiltrowuje je z gałęzi „obok widgetu" i zrzuca o poziom
  // niżej, na kolumnę, w której ten widget leży (patrz test kanwy „widget
  // upuszczony na SIEBIE"). Gest jest codzienny, więc nie wolno go ani
  // zapisywać jako zmiany, ani zgłaszać jako błędu.
  if (target === from.column && from.index === from.column.children.length - 1) {
    return "unchanged";
  }

  const [node] = from.column.children.splice(from.index, 1);
  if (!target.children) target.children = [];
  target.children.push(node);
  return "moved";
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
): MoveOutcome {
  const from = locateWidget(d, srcId);
  const targetSection = findSection(d, targetSectionId);
  if (!from || !targetSection) return "rejected";

  // Pierwsza kolumna celu - szukana PRZED wycięciem, żeby cała funkcja trzymała
  // się schematu „sprawdź wszystko, potem zmieniaj". Dziury i sekcje wewnętrzne
  // bez ANI JEDNEJ kolumny przeskakujemy; węzeł kolumny zostaje ważny po
  // wycięciu źródła. Kolumnę wybieramy tak samo jak `columnForDrop`: pierwszą,
  // którą redaktor NA PEWNO widzi (patrz `isColumnVisibleToEditor`) - inaczej
  // dziura albo cudza reguła dostępu na pozycji zerowej przesłaniałaby dobrą
  // kolumnę, a widget lądowałby poza kanwą.
  let targetColumn: ColumnNode | null = null;
  for (const child of targetSection.children ?? []) {
    if (!child) continue;
    if (child.kind === "column") {
      if (isColumnVisibleToEditor(child)) {
        targetColumn = child;
        break;
      }
      continue;
    }
    const firstInner = (child.columns ?? []).find(isColumnVisibleToEditor);
    if (firstInner) {
      targetColumn = firstInner;
      break;
    }
  }

  // Jak w `moveWidgetToColumn`: widget już stoi na końcu kolumny, w którą
  // celuje to upuszczenie.
  if (targetColumn === from.column && from.index === from.column.children.length - 1) {
    return "unchanged";
  }

  const [node] = from.column.children.splice(from.index, 1);
  if (!targetColumn) {
    targetColumn = newColumn(12);
    if (!targetSection.children) targetSection.children = [];
    targetSection.children.push(targetColumn);
  }
  if (!targetColumn.children) targetColumn.children = [];
  targetColumn.children.push(node);
  return "moved";
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
