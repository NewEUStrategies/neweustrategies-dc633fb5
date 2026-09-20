// Szacunek wysokości sekcji buildera - rezerwacja miejsca dla szkieletu
// sekcji strumieniowanej (`SectionStreamSkeleton`).
//
// DLACZEGO ISTNIEJE: szkielet trzymał stałe 280 px wobec realnych sekcji
// 400-900 px, więc każda sekcja spod zgięcia dokładała przesunięcie w momencie
// dostrumieniowania (audyt CWV, F29b). Wysokość liczymy z KONFIGURACJI sekcji,
// bez żadnego pomiaru DOM-u, więc serwer i klient dostają identyczną liczbę.
//
// DLACZEGO OSOBNY MODUŁ: `getWidgetFrameStyle` żyje w
// `components/builder/organisms/widget-view/frame.ts` (czysty moduł bez
// zależności od widoków), a `WidgetView.tsx` ciągnie za sobą całe drzewo
// widgetów - import z niego zamykałby cykl
// `sectionStreaming -> BuilderRenderer -> WidgetView -> sectionStreaming`.
//
// KONTRAKT DOKŁADNOŚCI: to jest SZACUNEK, nie pomiar. Przeszacowanie jest
// tańsze niż niedoszacowanie (pusty pas nic nie przesuwa, za niski pas
// przesuwa całą treść pod sekcją), a wynik jest przycinany do widełek, żeby
// błąd w danych nie zarezerwował ekranu pustki.
import type {
  ColumnNode,
  Device,
  SectionChild,
  SectionNode,
  WidgetNode,
  WidgetType,
} from "@/lib/builder/types";
import {
  getWidgetFrameStyle,
  hiddenOnDevice,
} from "@/components/builder/organisms/widget-view/frame";

/** Dolna granica - tyle rezerwował szkielet przed tą zmianą. */
export const SECTION_STREAM_MIN_HEIGHT = 280;
/** Górna granica - powyżej pustka kosztuje więcej niż przesunięcie. */
export const SECTION_STREAM_MAX_HEIGHT = 1200;
/** Nominalny wiewport dla sekcji mierzonych w `vh` (SSR nie zna ekranu). */
export const NOMINAL_VIEWPORT_HEIGHT = 800;
/** Odstęp między widgetami w kolumnie (`columnsRowStyle` używa 16 px). */
export const WIDGET_GAP_PX = 16;
/** Pionowy oddech sekcji (padding kontenera + margines paska zakładek). */
export const SECTION_VERTICAL_PADDING_PX = 48;
/** Pasek zakładek sekcji, gdy sekcja jest kontenerem zakładek. */
export const SECTION_TABS_BAR_PX = 56;
/** Widget bez wpisu w tabeli - akapit tekstu z nagłówkiem. */
export const DEFAULT_WIDGET_HEIGHT_PX = 120;

/**
 * Typowe wysokości widgetów (px, desktop) użyte, gdy autor nie podał własnej.
 * Wpisane są przede wszystkim widgety DANOWE - to one decydują o tym, czy
 * sekcja w ogóle jest strumieniowana (`shouldStreamSection`), więc to ich
 * wysokość rezerwuje szkielet. Wartości są zaokrąglone w górę do typowego
 * renderu na desktopie.
 */
export const WIDGET_HEIGHT_ESTIMATE_PX: Partial<Record<WidgetType, number>> = {
  // Listy i karuzele wpisów: siatka kart z okładką 16:9 + tytuł + meta.
  "post-list": 420,
  carousel: 420,
  "progress-carousel": 420,
  "circular-carousel": 420,
  "rated-list": 420,
  "tailored-must-reads": 420,
  "web-stories-carousel": 300,
  "dark-featured-card": 360,
  // Slider (hero strony głównej) - najwyższy widget w repertuarze.
  slider: 520,
  // Wydarzenia, kluby, ludzie.
  "event-list": 420,
  "event-schedule": 480,
  "event-sponsors": 240,
  "event-countdown": 160,
  "event-countdown-card": 300,
  "meeting-booking": 420,
  "club-card": 300,
  "club-threads": 420,
  "club-hub": 520,
  speakers: 360,
  "team-member": 320,
  "author-profile-card": 280,
  "podcast-latest": 260,
  // Taksonomie i paski - jeden rząd chipów / tekstu.
  categories: 120,
  tags: 120,
  "section-label": 48,
  "hot-topic-bar": 64,
  "news-ticker": 56,
  "trending-now": 56,
  menu: 56,
  // Podstawowe bloki treści.
  heading: 64,
  text: 96,
  "rich-text": 320,
  image: 240,
  gallery: 360,
  video: 360,
  map: 360,
  chart: 360,
  "data-map": 420,
  "world-map": 480,
  button: 48,
  divider: 24,
  spacer: 24,
  icon: 48,
  counter: 120,
  newsletter: 200,
  contact: 420,
  "contact-form": 420,
  cta: 200,
  accordion: 320,
  tabs: 360,
  timeline: 420,
  "logo-cloud": 200,
  testimonial: 280,
  pricing: 420,
};

function pxOf(value: string | number | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
  if (!match) return undefined;
  const px = Number(match[1]);
  return Number.isFinite(px) && px > 0 ? px : undefined;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Wysokość jednego widgetu. Wysokość podana przez autora (ramka widgetu z
 * `getWidgetFrameStyle`) zawsze bije tabelę - to jedyne miejsce, w którym
 * znamy prawdę zamiast ją zgadywać.
 */
export function estimateWidgetHeight(node: WidgetNode, device: Device = "desktop"): number {
  if (hiddenOnDevice(node.advanced, device)) return 0;
  const frame = getWidgetFrameStyle(node, device);
  const authored = pxOf(frame.height) ?? pxOf(frame.minHeight);
  if (authored !== undefined) return authored;
  return WIDGET_HEIGHT_ESTIMATE_PX[node.type] ?? DEFAULT_WIDGET_HEIGHT_PX;
}

/** Kolumna układa widgety pionowo, więc wysokości się SUMUJĄ (plus odstępy). */
export function estimateColumnHeight(column: ColumnNode, device: Device = "desktop"): number {
  if (hiddenOnDevice(column.advanced, device)) return 0;
  const children = Array.isArray(column.children) ? column.children : [];
  const heights = children
    .filter((child): child is WidgetNode => !!child && child.kind === "widget")
    .map((child) => estimateWidgetHeight(child, device))
    .filter((height) => height > 0);
  if (heights.length === 0) return 0;
  const sum = heights.reduce((total, height) => total + height, 0);
  return sum + (heights.length - 1) * WIDGET_GAP_PX;
}

function estimateChildHeight(child: SectionChild, device: Device): number {
  if (child.kind === "inner-section") {
    if (hiddenOnDevice(child.advanced, device)) return 0;
    const columns = Array.isArray(child.columns) ? child.columns : [];
    // Kolumny stoją OBOK siebie - decyduje najwyższa, nie suma.
    return columns.reduce((tallest, column) => {
      return Math.max(tallest, estimateColumnHeight(column, device));
    }, 0);
  }
  return estimateColumnHeight(child, device);
}

/** Wysokość narzucona przez autora w ustawieniach układu sekcji, jeśli jest. */
function authoredSectionHeight(section: SectionNode): number | undefined {
  const layout = section.layout;
  if (!layout) return undefined;
  if (layout.height === "fixed" || layout.height === "min-height") {
    const px = layout.heightValue;
    return typeof px === "number" && px > 0 ? px : undefined;
  }
  if (layout.height === "fit-screen") {
    const vh = typeof layout.heightValue === "number" ? layout.heightValue : 100;
    return (NOMINAL_VIEWPORT_HEIGHT * vh) / 100;
  }
  return undefined;
}

/**
 * Wysokość sekcji do rezerwacji w szkielecie. Kolumny najwyższego poziomu
 * stoją obok siebie (siatka 12 kolumn), więc bierzemy najwyższą z nich.
 */
export function estimateSectionHeight(section: SectionNode, device: Device = "desktop"): number {
  const children = Array.isArray(section.children) ? section.children : [];
  const content = children.reduce((tallest, child) => {
    return Math.max(tallest, estimateChildHeight(child, device));
  }, 0);
  const authored = authoredSectionHeight(section);
  const base = authored !== undefined ? Math.max(authored, content) : content;
  const tabsBar = section.tabs?.enabled ? SECTION_TABS_BAR_PX : 0;
  return clamp(
    Math.round(base + tabsBar + SECTION_VERTICAL_PADDING_PX),
    SECTION_STREAM_MIN_HEIGHT,
    SECTION_STREAM_MAX_HEIGHT,
  );
}
