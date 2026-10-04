// JEDEN KANDYDAT LCP NA STRONĘ - czysta funkcja dokumentu buildera.
//
// PO CO. Do fali 1 (P1.4) priorytet obrazu wynikał z POZYCJI SEKCJI: każdy
// widget w trzech czołowych sekcjach dostawał `loading=eager` +
// `fetchpriority=high` dla swojego pierwszego obrazu, a slidery - zawsze,
// niezależnie od miejsca na stronie. Fixture `/` miał przez to 9 obrazów
// `fetchpriority=high`, a produkcja 7 plus 5 automatycznych preloadów Reacta
// i preload `builderHeroPreload` wskazujący kartę 25vw zamiast hero. Dziś
// wszystkie wskazują ten sam plik (0 ms), ale przy różnych okładkach leadów
// każdy dodatkowy obraz High w zbiorze przed LCP kosztuje +0,15…0,23 s LCP
// mobile (werdykt lcp-path:LP-1). Ten moduł wyznacza z SAMEGO DOKUMENTU
// (bez danych zapytań) co najwyżej dwa widgety, których pierwszy obraz jest
// kandydatem LCP; renderer daje priorytet wyłącznie im, a trasa preloaduje
// wyłącznie ich obraz (heroImage.ts).
//
// REGUŁA (PLAN.json P1.4, werdykty LP-1/LP-2):
//  * skanujemy sekcje malowane w pierwszym renderze (SSR i pierwszy render
//    klienta pokazują wariant A eksperymentu - `isSectionVisibleForAssignments`
//    bez przydziałów), w oknie `sections` (domyślnie = ABOVE_FOLD_SECTION_COUNT),
//  * bierzemy PIERWSZĄ sekcję, w której jest widget obrazowy (slider, obraz
//    jednoźródłowy nie-logo, dark-featured-card, post-lista z obrazem wiodącym),
//  * kandydat „desktop": największy udział slotu desktopowego (udział kolumny
//    x część kolumny zajmowana przez obraz wiodący widgetu); remis: slider >
//    obraz > dark-featured-card > lead listy, potem kolejność wizualna,
//  * kandydat „mobile": pierwszy widget obrazowy w kolejności malowania na
//    telefonie (kolumny ustawione wg `order.mobile`, jak reguła CSS rendera),
//  * wykluczenia jak w heroImage.ts: para jasny/ciemny, logo, brak źródła,
//    `hideOn.mobile` i `hideOn.desktop` (preload obrazu, którego jedno
//    z urządzeń nie maluje, byłby czystą stratą pasma).
//
// A/B: sekcja wariantu B nie jest malowana w SSR, więc nie istnieje dla
// kandydata. Sekcja wariantu A JEST malowana wszystkim (deterministycznie, do
// czasu przydziału po montażu) i jej obraz jest pierwszym malowaniem - werdykt
// LP-1 (blokujące 3): pominięcie jej zostawiałoby stronę z hero w eksperymencie
// bez żadnego obrazu eager. To świadome odejście od dawnej ostrożności
// heroImage.ts („wariant losuje się na kliencie"): przy jednym źródle preloadu
// (preload == obraz eager) pominięcie A dawało leniwy obraz pierwszego malowania.
//
// CZYSTOŚĆ (check:entry-purity, krytyka M4a). Moduł jest importowany przez
// BuilderRenderer (chunk wejściowy), więc NIE MOŻE ciągnąć warstwy zapytań
// (heroImage.ts:36-47). Dozwolone importy: `./imageSlot`, typy oraz dwa liście
// bez własnych importów (`contentValue`, `sanitizePure`) - te same koercje, co
// renderery i heroImage, żeby kandydat nie rozjechał się z malowanym obrazem.
// Pilnuje tego test `lcpCandidate.test.ts` (lista importów źródła).
import { columnImageSlot, type ImageSlot } from "./imageSlot";
import type { BuilderDocument, SectionChild, SectionNode, WidgetNode } from "./types";
import { asBool, asNumInRange, asStr } from "@/lib/content-model/contentValue";
import { safeImageUrl } from "@/lib/sanitizePure";

/** Maksymalna liczba kandydatów: największy slot desktopowy + pierwszy na telefonie. */
export const LCP_CANDIDATE_LIMIT = 2;

/**
 * Domyślne okno skanowania. Musi być równe `ABOVE_FOLD_SECTION_COUNT`
 * z `prefetch.ts` (tamten moduł ciągnie zapytania, więc nie importujemy go
 * tutaj; równość pilnuje test).
 */
export const LCP_SCAN_SECTIONS = 3;

export type LcpCandidateKind = "slider" | "image" | "dark-featured-card" | "post-list";

/** Dla którego urządzenia widget jest kandydatem (może być dla obu). */
export type LcpCandidateViewport = "desktop" | "mobile";

export interface LcpCandidate {
  readonly sectionId: string;
  readonly widget: WidgetNode;
  readonly kind: LcpCandidateKind;
  /** Slot kolumny - ten sam, który renderer podaje przez `BuilderImageSlotContext`. */
  readonly slot: ImageSlot;
  readonly viewports: readonly LcpCandidateViewport[];
}

/**
 * Warianty post-listy, których obraz WIODĄCY renderer może oznaczyć priorytetem
 * (`PostListView`: siatka `PostCard`, `classic`, lead `flex-grid`). Warianty
 * miniaturowe (`list`, `numbered`, `ranked`, `boxed-list`) nie są kandydatami.
 * heroImage.ts typuje mapę `sizes` tym samym zbiorem - kompilator trzyma oba
 * miejsca razem.
 */
export const POST_LIST_LEAD_VARIANTS = [
  "card",
  "minimal",
  "overlay",
  "boxed-grid",
  "classic",
  "flex-grid",
] as const;
export type PostListLeadVariant = (typeof POST_LIST_LEAD_VARIANTS)[number];

const POST_LIST_LEAD_SET: ReadonlySet<string> = new Set(POST_LIST_LEAD_VARIANTS);

/** Czy wariant post-listy ma obraz wiodący z priorytetem (strażnik typu). */
export function isPostListLeadVariant(variant: string): variant is PostListLeadVariant {
  return POST_LIST_LEAD_SET.has(variant);
}

/** Remis udziału slotu: niższa ranga wygrywa (slider > obraz > karta > lead listy). */
const KIND_RANK: Readonly<Record<LcpCandidateKind, number>> = {
  slider: 0,
  image: 1,
  "dark-featured-card": 2,
  "post-list": 3,
};

/** `flex-grid`: lead zajmuje 1,35fr z siatki `1.35fr minmax(0,1fr)` (PostListView). */
const FLEX_GRID_LEAD_SHARE = 1.35 / 2.35;

/** Czy sekcja jest malowana w SSR i pierwszym renderze klienta (wariant A). */
function paintedAtFirstRender(section: SectionNode): boolean {
  const tag = section.advanced?.abTest;
  return !tag || tag.variant === "a";
}

/** Kolumny/inner-sekcje widoczne przy pierwszym malowaniu (aktywna zakładka). */
function visibleSectionChildren(section: SectionNode): SectionChild[] {
  const children = (Array.isArray(section.children) ? section.children : []).filter(
    (child): child is NonNullable<typeof child> => Boolean(child),
  );
  const tabs = section.tabs;
  if (!tabs?.enabled || !tabs.items || tabs.items.length === 0) return children;
  const initialTabId =
    tabs.defaultTabId && tabs.items.some((t) => t.id === tabs.defaultTabId)
      ? tabs.defaultTabId
      : tabs.items[0].id;
  return children.filter((child) => !child.tabId || child.tabId === initialTabId);
}

interface PaintedWidget {
  readonly widget: WidgetNode;
  readonly slot: ImageSlot;
  /** Indeks dziecka sekcji (kolumna albo inner-sekcja) w DOM. */
  readonly childIndex: number;
  /** Kolejność wizualna dziecka: desktop (`order.desktop`) i telefon (`order.mobile`). */
  readonly desktopOrder: number;
  readonly mobileOrder: number;
  /** Indeks widgetu w kolejności DOM całej sekcji. */
  readonly domIndex: number;
}

function paintedWidgets(section: SectionNode): PaintedWidget[] {
  const out: PaintedWidget[] = [];
  const children = visibleSectionChildren(section);
  children.forEach((child, childIndex) => {
    // Renderer ustawia `order` tylko kolumnom najwyższego poziomu: inline
    // `order.desktop` (resolveOrder) i regułę `@media (max-width: 767px)`
    // z `order.mobile ?? 0` dla kolumn z obiektem `order`. Reszta ma 0.
    const desktopOrder = child.kind === "column" ? (child.order?.desktop ?? 0) : 0;
    const mobileOrder = child.kind === "column" ? (child.order?.mobile ?? 0) : 0;
    const push = (widget: WidgetNode | null | undefined, slot: ImageSlot) => {
      if (widget?.kind !== "widget") return;
      out.push({ widget, slot, childIndex, desktopOrder, mobileOrder, domIndex: out.length });
    };
    if (child.kind === "column") {
      const slot = columnImageSlot(section, child, children);
      (child.children ?? []).forEach((widget) => push(widget, slot));
    } else {
      (child.columns ?? []).forEach((column) => {
        if (!column) return;
        const slot = columnImageSlot(child, column, child.columns ?? []);
        (column.children ?? []).forEach((widget) => push(widget, slot));
      });
    }
  });
  return out;
}

/**
 * Rodzaj kandydata albo `null`, gdy widget nie może być kandydatem LCP.
 * Reguły odmowy są dokładnie te, których heroImage.ts używa przy budowie
 * preloadu - kandydat bez parytetu z malowanym obrazem byłby gorszy niż brak.
 */
export function lcpCandidateKind(widget: WidgetNode): LcpCandidateKind | null {
  const hideOn = widget.advanced?.hideOn;
  if (hideOn?.desktop || hideOn?.mobile) return null;
  const c = widget.content ?? {};
  switch (widget.type) {
    case "slider":
      return asBool(c.showCover, true) ? "slider" : null;
    case "image": {
      const src = safeImageUrl(asStr(c.src));
      const srcDark = safeImageUrl(asStr(c.srcDark));
      if (!src) return null;
      // Para jasny/ciemny: oba obrazy są w DOM (jeden schowany CSS-em).
      if (srcDark && srcDark !== src) return null;
      // Logo podmienia się na asset z ustawień - renderer czyta `alt_${lang}`
      // z fallbackiem na alt_pl, więc sprawdzamy oba alty.
      if (asStr(c.useSiteLogo) || /logo/i.test(asStr(c.alt_pl)) || /logo/i.test(asStr(c.alt_en)))
        return null;
      return "image";
    }
    case "dark-featured-card":
      return safeImageUrl(asStr(c.image)) ? "dark-featured-card" : null;
    case "post-list":
    case "carousel": {
      if (asStr(c.showCover) === "0") return null;
      // Karuzela maluje KAŻDY wariant kartą siatki (PostCard).
      if (widget.type === "carousel") return "post-list";
      return isPostListLeadVariant(asStr(c.variant) || "card") ? "post-list" : null;
    }
    default:
      return null;
  }
}

/** Część slotu kolumny zajmowana przez obraz wiodący widgetu (desktop). */
function leadShareOfSlot(widget: WidgetNode, kind: LcpCandidateKind): number {
  const c = widget.content ?? {};
  if (kind === "slider") {
    // Warianty pełnej szerokości malują jeden slajd; multi-card - N kart.
    if (asStr(c.variant) !== "multi-card") return 1;
    return 1 / Math.round(asNumInRange(c.columns, 3, 1, 4));
  }
  if (kind === "post-list") {
    const variant = asStr(c.variant) || "card";
    if (widget.type !== "carousel" && variant === "classic") return 1;
    if (widget.type !== "carousel" && variant === "flex-grid") return FLEX_GRID_LEAD_SHARE;
    return 1 / Math.round(asNumInRange(c.columns, 3, 1, 6));
  }
  return 1;
}

interface Scored extends PaintedWidget {
  readonly kind: LcpCandidateKind;
  readonly desktopShare: number;
}

function byDesktop(a: Scored, b: Scored): number {
  // Zaokrąglenie do setnych punktu procentowego: 100/3 i 33.33 to ten sam slot.
  const share = Math.round(b.desktopShare * 100) - Math.round(a.desktopShare * 100);
  if (share !== 0) return share;
  const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (rank !== 0) return rank;
  if (a.desktopOrder !== b.desktopOrder) return a.desktopOrder - b.desktopOrder;
  return a.domIndex - b.domIndex;
}

function byMobile(a: Scored, b: Scored): number {
  if (a.mobileOrder !== b.mobileOrder) return a.mobileOrder - b.mobileOrder;
  if (a.childIndex !== b.childIndex) return a.childIndex - b.childIndex;
  return a.domIndex - b.domIndex;
}

export interface LcpCandidatesOptions {
  /** Okno sekcji (liczone po sekcjach malowanych). Domyślnie `LCP_SCAN_SECTIONS`. */
  readonly sections?: number;
}

/**
 * Kandydaci LCP dokumentu: 0, 1 albo 2 widgety, najpierw kandydat desktopowy.
 * Funkcja dokumentu, nie danych - SSR i hydratacja liczą ją z tego samego
 * dokumentu, więc atrybuty priorytetu i znacznik `data-lcp-candidate` są
 * identyczne po obu stronach. Nigdy nie rzuca.
 */
export function lcpCandidates(
  doc: BuilderDocument | null | undefined,
  options: LcpCandidatesOptions = {},
): LcpCandidate[] {
  try {
    const sections = Array.isArray(doc?.sections) ? doc.sections : [];
    const windowSize = Math.max(0, Math.floor(options.sections ?? LCP_SCAN_SECTIONS));
    const painted = sections
      .filter((s): s is SectionNode => Boolean(s) && paintedAtFirstRender(s))
      .slice(0, windowSize);
    for (const section of painted) {
      const scored: Scored[] = [];
      for (const entry of paintedWidgets(section)) {
        const kind = lcpCandidateKind(entry.widget);
        if (!kind) continue;
        scored.push({
          ...entry,
          kind,
          desktopShare: entry.slot.desktop.vw * leadShareOfSlot(entry.widget, kind),
        });
      }
      if (scored.length === 0) continue;
      const desktop = [...scored].sort(byDesktop)[0];
      const mobile = [...scored].sort(byMobile)[0];
      const toCandidate = (
        entry: Scored,
        viewports: readonly LcpCandidateViewport[],
      ): LcpCandidate => ({
        sectionId: section.id,
        widget: entry.widget,
        kind: entry.kind,
        slot: entry.slot,
        viewports,
      });
      if (desktop.widget.id === mobile.widget.id)
        return [toCandidate(desktop, ["desktop", "mobile"])];
      return [toCandidate(desktop, ["desktop"]), toCandidate(mobile, ["mobile"])].slice(
        0,
        LCP_CANDIDATE_LIMIT,
      );
    }
    return [];
  } catch {
    // Kandydat jest optymalizacją - żaden kształt dokumentu nie może
    // wywrócić renderu ani loadera.
    return [];
  }
}

/** Identyfikatory widgetów-kandydatów (dla kontekstu renderera). */
export function lcpCandidateIds(
  doc: BuilderDocument | null | undefined,
  options: LcpCandidatesOptions = {},
): string[] {
  return lcpCandidates(doc, options).map((candidate) => candidate.widget.id);
}
