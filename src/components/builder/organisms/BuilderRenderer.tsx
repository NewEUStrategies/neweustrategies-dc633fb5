import { columnImageSlot } from "@/lib/builder/imageSlot";
import { BuilderImageSlotContext, useBuilderImageSlot } from "@/lib/builder/imageSlotContext";
// Read-only renderer for public pages. Applies all Section settings
// (layout, background layers, overlay, border, shape dividers, typography).
import {
  Fragment,
  Suspense,
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  startTransition,
  type ComponentType,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";
import type {
  AdvancedSettings,
  BackgroundSettings,
  BuilderDocument,
  SectionNode,
  ColumnNode,
  InnerSectionNode,
  Device,
  ResponsiveValue,
} from "@/lib/builder/types";
import { BuilderWidgetNode } from "@/components/builder/organisms/BuilderWidgetNode";
// Pomocniki ramki (także w `isRenderedWidget`) czytamy z modułu źródłowego, nie przez re-eksport z
// `WidgetView`: re-eksport był statyczną krawędzią do pełnego dyspozytora
// widgetów, więc każdy dokument z nagłówkiem ciągnął go do chunku wejściowego
// nawet wtedy, gdy renderuje wyłącznie widgety chrome (audyt CWV, F17).
import {
  AUTO_SIZE_WIDGETS,
  COMPACT_WIDGET_TYPES,
} from "@/components/builder/organisms/widget-view/frame";
import { RenderErrorBoundary } from "@/components/error/RenderErrorBoundary";
import { afterPrerendering } from "@/lib/prerender";
import { sanitizeHtmlId, sanitizeCssClass, safeImageUrl, hardenStyleCss } from "@/lib/sanitizePure";
import {
  sectionWrapperStyle,
  sectionContainerStyle,
  columnsRowStyle,
  backgroundLayerStyle,
  overlayLayerStyle,
  borderStyle,
  ShapeDivider,
  typographyCss,
  typographyAlign,
  INNER_SECTION_SAFE_AREA_PX,
  COLUMN_SAFE_AREA_PX,
} from "@/lib/builder/sectionStyles";
import { UsedPostIdsProvider } from "@/lib/builder/usedPostIds";
import { SectionTabsBar } from "@/components/builder/molecules/SectionTabsBar";
import { evaluateAccess, useAccessContext } from "@/lib/builder/accessControl";
import { useInlineWidgetEdit } from "@/components/builder/inlineEditContext";

import {
  estimateChromeColumnHeight,
  estimateSectionHeight,
} from "@/lib/builder/sectionHeightEstimate";
import { useSectionPreload } from "@/lib/builder/useSectionPreload";
import { useBuilderMode } from "@/lib/content-model/editorCanvas";
import { useCurrentPostCtx } from "@/lib/content-model/postContext";
import { HydrationIsland, islandChunksFor } from "@/lib/performance/hydrationIsland";
import { firstFrameVideoSrc, useGatedVideoAutoplay } from "@/lib/performance/motionGate";
import {
  createViewportDeviceSource,
  useRendererDevice,
  type ViewportDeviceSource,
} from "@/lib/performance/viewportDevice";
import {
  LcpCandidatesProvider,
  LcpEagerSection,
  NO_LCP_CANDIDATES,
  isServerRender,
  lcpRootAttributes,
  readServerLcpCandidates,
} from "@/lib/builder/aboveFold";
import { lcpCandidateIds } from "@/lib/builder/lcpCandidate";
import { useBuilderDebug } from "@/lib/builder/builderDebug";
import { safeParseBuilderDoc } from "@/lib/builder/schema";
import { ABOVE_FOLD_SECTION_COUNT } from "@/lib/builder/prefetch";
import {
  SECTION_ISLAND_TRIGGER,
  StreamingSection,
  sectionIslandInfo,
} from "@/lib/builder/sectionStreaming";
import { initialSectionTabId, isRenderedWidget } from "@/lib/builder/sectionVisibility";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import {
  isSectionVisibleForAssignments,
  recordExperimentEvent,
  useExperimentAssignments,
  type AbVariant,
} from "@/lib/builder/experiments";
function resolveSpan(
  span: ResponsiveValue<number> | undefined,
  device: Device,
  deskDefault: number,
): number {
  if (device === "mobile") return span?.mobile ?? 12;
  if (device === "tablet") return span?.tablet ?? span?.desktop ?? deskDefault;
  return span?.desktop ?? deskDefault;
}

function resolveOrder(
  order: ResponsiveValue<number> | undefined,
  device: Device,
): number | undefined {
  if (!order) return undefined;
  if (device === "mobile") return order.mobile ?? undefined;
  if (device === "tablet") return order.tablet ?? order.desktop ?? undefined;
  return order.desktop ?? undefined;
}

/**
 * Urządzenie INLINE geometrii siatki kolumn (F13 z diagnozy P0.5, K16).
 *
 * Telefon nie ma tu własnych wartości: układ jednej kolumny (i trzy kolumny
 * kart osób) narzucają reguły `!important` z `styles.css` - zarówno
 * `@media (max-width: 767px)`, jak i `[data-builder-renderer][data-device=
 * "mobile"]` - dla KAŻDEGO `[data-columns-row]` i `[data-column-slot]`, więc
 * inline `grid-template-columns`/`grid-column` na telefonie nigdy nie
 * wygrywa. Dawniej przełączenie desktop -> telefon po hydratacji przepisywało
 * mimo to inline styl każdej kolumny (25 mutacji „Inline CSS style
 * declaration" i przeliczenie stylu ~700 elementów na fixture). Na telefonie
 * inline zostaje więc desktopowe - to samo, co w HTML serwera - i React nie
 * dotyka stylu kolumn. Tablet ma własne spany (bez reguły w CSS), więc liczy
 * się jak dotąd. Kolejność (`order`) zależy od urządzenia naprawdę i zostaje.
 */
function gridDevice(device: Device): Device {
  return device === "mobile" ? "desktop" : device;
}

import { isPeopleSectionKind } from "@/lib/builder/sectionKind";
import { childHostsSearchWidget, searchOverflowAttr } from "@/lib/builder/searchOverflow";

interface Props {
  doc: BuilderDocument;
  lang: "pl" | "en";
  device?: Device;
  /**
   * Suspense-stream unresolved data sections instead of blocking the whole
   * document into the SSR shell. Off by default (chrome / admin previews render
   * eagerly); the public content + homepage routes opt in to keep cold-render
   * TTFB flat as documents grow. See lib/builder/sectionStreaming.
   */
  stream?: boolean;
  /**
   * Okno sekcji skanowanych przez `lcpCandidates` (liczone po sekcjach
   * malowanych w pierwszym renderze). Domyślnie `ABOVE_FOLD_SECTION_COUNT` -
   * to samo okno, które rozgrzewa prefetch SSR i skanuje preload trasy.
   */
  aboveFoldCount?: number;
  /**
   * WŁAŚCICIEL KANDYDATA LCP STRONY (P1.4). Tylko główny renderer treści
   * (`HomeBuilderContent`, `ContentRenderer`) wyznacza kandydatów
   * (`lcpCandidates`): ich pierwszy obraz dostaje `eager` +
   * `fetchpriority=high` + `data-lcp-candidate`. Każdy inny renderer
   * (nagłówek, stopka, menu mobilne, popup, kanwa) zostawia WSZYSTKIE obrazy
   * leniwe - inaczej `data-lcp-candidate` nie byłby jedyny na stronie, a boot
   * po LCP (P2.1) trafiałby w obraz z nagłówka (werdykt LP-1, blokujące 1).
   */
  lcpOwner?: boolean;
  /**
   * Builder-canvas mode: show every A/B variant side by side (with badges)
   * instead of bucketing the viewer, and never record experiment events.
   */
  editorPreview?: boolean;
  /**
   * Dokument POWŁOKI (nagłówek/stopka), nie treści. Każda kolumna dostaje wtedy
   * `min-height` z tego samego szacunku, którym `HeaderSkeleton` rezerwuje
   * miejsce (`estimateChromeColumnHeight`) - patrz `ChromeReserveContext`.
   */
  chrome?: boolean;
}

// ---------------------------------------------------------------------------
// Empty-container picker: when a container has no inner sections (either at
// root level, or on the active tab in a tabbed container), the builder canvas
// exposes an inline StructurePicker via this context so the user picks the
// column layout AFTER creating the container - the container itself starts
// empty. Callback is null in the public renderer (context not provided).
// ---------------------------------------------------------------------------
export type EmptyContainerPicker = (
  sectionId: string,
  tabId: string | null,
  spans: number[],
) => void;

/**
 * Kształt boksu pickera, KTÓREGO TEN PLIK NIE IMPORTUJE - i to jest cały sens
 * tego typu.
 *
 * Poprzednia wersja trzymała tu `lazy(() => import(".../EmptyContainerPickerBox"))`
 * z komentarzem obiecującym, że „słowniki edytora nie wchodzą do bundla
 * publicznego chrome". OBIETNICA BYŁA NIEPRAWDZIWA, i to policzalnie: `lazy()`
 * zdejmuje moduł ze ścieżki startowej, ale NIE usuwa krawędzi w grafie. Bramka
 * `check:bundle` liczy do budżetu publicznego wszystko, co jest osiągalne
 * z publicznej trasy - również przez `import()` - więc `i18n-builder` (31,0 KB),
 * `StructurePicker` (1,0 KB) i sam boks (0,4 KB) siedziały w budżecie
 * CZYTELNIKA, mimo że renderują się wyłącznie w kanwie administratora.
 *
 * Odwrócenie zależności usuwa krawędź, zamiast ją odraczać: kanwa (kod adminowy)
 * PODAJE komponent, publiczny renderer zna wyłącznie jego kształt. Typ jest
 * zadeklarowany tutaj, a nie zaimportowany z katalogu `admin/`, bo import typu
 * z tamtej strony przywracałby dokładnie tę zależność, którą ta zmiana zdejmuje.
 */
export interface EmptyContainerPickerBoxProps {
  tabsEnabled: boolean;
  onPick: (spans: number[]) => void;
}

interface EmptyContainerPickerValue {
  readonly onPick: EmptyContainerPicker;
  readonly Box: ComponentType<EmptyContainerPickerBoxProps>;
}

const EmptyContainerPickerContext = createContext<EmptyContainerPickerValue | null>(null);

export function BuilderEmptyPickerProvider({
  onPick,
  box,
  children,
}: {
  onPick: EmptyContainerPicker;
  /** Komponent boksu - dostarcza go kanwa buildera, patrz `VisualCanvas`. */
  box: ComponentType<EmptyContainerPickerBoxProps>;
  children: ReactNode;
}) {
  const value = useMemo<EmptyContainerPickerValue>(() => ({ onPick, Box: box }), [onPick, box]);
  return (
    <EmptyContainerPickerContext.Provider value={value}>
      {children}
    </EmptyContainerPickerContext.Provider>
  );
}

/**
 * Czy renderujemy dokument POWŁOKI (nagłówek/stopka).
 *
 * DLACZEGO TO ISTNIEJE. Ciężkie widgety jadą przez `React.lazy`, a publiczny
 * fallback granicy Suspense to `null` (`lazySuspense.tsx`). Pilna aktualizacja
 * przed dojściem chunku POTRAFI porzucić strumieniowany HTML granicy - wtedy
 * `search-button` albo `account-link` znikają na chwilę z nagłówka, kolumna
 * zapada się do samego paddingu, a `<main>` podskakuje o kilkadziesiąt
 * pikseli. W pomiarach `first-visit` wychodziło z tego przesunięcie o 89 px
 * (nagłówek 185 -> 128 px) i CLS 0,13 przy progu 0,1 - rzadkie, bo zależne od
 * wyścigu chunku z hydratacją, ale w pełni deterministyczne co do geometrii.
 *
 * Rezerwa idzie z DOKŁADNIE tego samego szacunku, którym `HeaderSkeleton`
 * trzyma miejsce przed przyjściem powłoki, więc pusta granica, szkielet
 * i zamontowany nagłówek mają tę samą wysokość. Treść strony tego nie dostaje:
 * tam szacunek jest zgrubny, a kolumna ma prawo być dokładnie tak wysoka, jak
 * jej zawartość.
 */
const ChromeReserveContext = createContext(false);

const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

function deviceForWidth(width: number): Device {
  if (width < MOBILE_BREAKPOINT) return "mobile";
  if (width < TABLET_BREAKPOINT) return "tablet";
  return "desktop";
}

// Debug-only overlay rules. Injected ONCE per page (by the primary renderer) and
// ONLY while debug is active - everything functional/responsive now lives in the
// global stylesheet (see styles.css → "Builder public renderer"). Kept inline
// because it is a dev affordance that should add zero bytes to a normal page.
const DEBUG_OVERLAY_CSS = `
[data-builder-renderer][data-debug="1"] [data-sec-id]{outline:2px solid rgba(239,68,68,.9) !important;outline-offset:-2px;position:relative;}
[data-builder-renderer][data-debug="1"] [data-sec-id]::before{content:"SECTION " attr(data-sec-id) " · " attr(data-debug-h) "px";position:absolute;top:0;left:0;background:rgba(239,68,68,.95);color:#fff;font:600 10px/1.4 ui-monospace,monospace;padding:2px 6px;z-index:9999;pointer-events:none;}
[data-builder-renderer][data-debug="1"] [data-column-slot]{outline:1px dashed rgba(59,130,246,.9) !important;outline-offset:-1px;position:relative;}
[data-builder-renderer][data-debug="1"] [data-col-id]{outline:1px dashed rgba(16,185,129,.9) !important;outline-offset:-1px;position:relative;}
[data-builder-renderer][data-debug="1"] [data-col-id]::before{content:"COL " attr(data-col-id) " · " attr(data-debug-h) "px";position:absolute;top:0;right:0;background:rgba(16,185,129,.95);color:#fff;font:600 10px/1.4 ui-monospace,monospace;padding:1px 5px;z-index:9999;pointer-events:none;}
[data-builder-renderer][data-debug="1"] [data-widget-id]{outline:1px solid rgba(234,179,8,.95) !important;outline-offset:-1px;position:relative;}
[data-builder-renderer][data-debug="1"] [data-widget-id]::after{content:attr(data-debug-type) " · " attr(data-debug-h) "px";position:absolute;bottom:0;left:0;background:rgba(234,179,8,.95);color:#111;font:600 10px/1.4 ui-monospace,monospace;padding:1px 5px;z-index:9999;pointer-events:none;}
`;

/**
 * Odcisk dokumentu, z którym renderer utrwalił kandydatów LCP: identyfikatory
 * sekcji w kolejności. Ten sam dokument zbudowany od nowa (nowy obiekt) daje
 * ten sam odcisk, inny dokument - inny (recenzja P1.4 runda 3, m2).
 */
function sectionIdsKey(doc: BuilderDocument): string {
  return (Array.isArray(doc.sections) ? doc.sections : []).map((s) => s?.id).join(" ");
}

export function BuilderRenderer({
  doc,
  lang,
  device,
  stream = false,
  aboveFoldCount = ABOVE_FOLD_SECTION_COUNT,
  editorPreview = false,
  chrome = false,
  lcpOwner = false,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Pierwszy render MUSI byc deterministyczny (desktop-first), inaczej SSR
  // wyemituje "desktop", a pierwszy render kliencki na telefonie policzy
  // "mobile" (rozjazd hydratacji). CSS ustala pierwszy mobilny układ,
  // a pomiar kontenera aktualizuje stan po hydratacji.
  const [viewportDevice, setViewportDevice] = useState<Device>(() => device ?? "desktop");
  // Źródło urządzenia dla WYSP sekcji (P2.2): ta sama klasa, którą renderer
  // renderuje resztę sekcji, ale bez propsa przez odwodnioną granicę - wyspa
  // czyta ją lustrem (`useRendererDevice`). Stała tożsamość obiektu, więc
  // przekazanie go propsem nie porzuca HTML-u czekającej wyspy.
  const [deviceSource] = useState(() => createViewportDeviceSource(device ?? "desktop"));
  // Keep normalized node identities stable through viewport/context updates.
  // Editors replace the document immutably when its content changes.
  const safeDoc = useMemo(() => safeParseBuilderDoc(doc), [doc]);
  // Debug state is shared across every BuilderRenderer on the page; only the
  // "primary" instance renders the overlay (toggle + debug CSS) - see builderDebug.
  const { debug, isPrimary } = useBuilderDebug();
  // Kandydaci LCP (P1.4) - czysta funkcja dokumentu i kontekstu dostępu,
  // liczona WYŁĄCZNIE NA SERWERZE. Reguły `advanced.access` liczy TEN SAM
  // kontekst, którym `SectionsList`/`RenderSection`/`RenderColumn` filtrują
  // węzły (recenzja P1.4, B1). Serwer zapisuje wynik na korzeniu
  // (`lcpRootAttributes`, także pustą listę), a pierwszy render kliencki
  // (hydratacja) odczytuje go z DOM-u serwera po `useId()` - bez kodu
  // `lcpCandidates` w bundlu klienta (`isServerRender()` wycina gałąź; PROVE
  // P1.4: +1,1 KB gzip chunku wejściowego). `ids` = `null` to brak nośnika:
  // renderer bez `lcpOwner` albo render czysto kliencki (nawigacja SPA).
  // Lista jest utrwalona RAZEM Z DOKUMENTEM (recenzja P1.4 runda 3, m2): ta sama
  // instancja z innym dokumentem (trasa `$` przy przejściu /a -> /b) nie
  // przenosi kandydatów A na widget o tym samym id w B. Dokument rozpoznaje
  // odcisk z identyfikatorów sekcji, NIE tożsamość obiektu: część właścicieli
  // buduje dokument w każdym renderze (`parseBuilderDoc` w `support.tsx`,
  // `checkout.success.tsx`, `EventModulePage`; literał w sekcji wyróżnionej
  // archiwum), więc porównanie referencji zdejmowałoby znacznik przy pierwszym
  // ponownym renderze po hydratacji. Kanwa (`editorPreview`) pokazuje oba
  // warianty A/B i nie jest stroną dla czytelnika - bez kandydatów.
  const lcpRootId = useId();
  const access = useAccessContext();
  const isLcpOwner = lcpOwner && !editorPreview;
  const lcpDocKey = useMemo(() => sectionIdsKey(safeDoc), [safeDoc]);
  const [ownedLcp] = useState(() => ({
    docKey: lcpDocKey,
    ids: !isLcpOwner
      ? null
      : isServerRender()
        ? lcpCandidateIds(safeDoc, {
            sections: aboveFoldCount,
            isAccessible: (rule) => evaluateAccess(rule, access),
          })
        : readServerLcpCandidates(lcpRootId),
    // Plan `content-visibility` z HTML-u serwera (P3.3) - tylko hydratacja;
    // serwer liczy go w `SectionsList`, render czysto kliencki nie ma go wcale.
    // `isServerRender()` pierwsze - zwija się w buildzie klienta (KTO LICZY niżej).
    cv: isServerRender() || !isLcpOwner ? null : readServerCvPlan(lcpRootId),
  }));
  const ownsDoc = isLcpOwner && ownedLcp.docKey === lcpDocKey;
  const lcpIds = ownsDoc ? ownedLcp.ids : null;
  // Właściciel bez nośnika (render czysto kliencki, nowy dokument): bez
  // kandydata, ale pierwsza malowana sekcja ładuje obrazy eager (M1).
  const lcpEagerFirst = isLcpOwner && !lcpIds;

  useEffect(() => {
    if (device) {
      setViewportDevice(device);
      deviceSource.publish(device);
      return;
    }
    const el = rootRef.current;
    const updateWidth = (width: number) => {
      const next = deviceForWidth(width);
      // Wyspy sekcji dostają tę samą klasę z tego samego pomiaru; ich lustro
      // też idzie w przejściu, więc oba przejścia zatwierdzają się razem.
      deviceSource.publish(next);
      // Preserve pending SSR widget boundaries during viewport corrections.
      startTransition(() => setViewportDevice(next));
    };
    // CSS handles the first responsive paint. Reading clientWidth after
    // React's DOM writes forced layout in every nested renderer. Observe the
    // computed size instead; this also handles narrow editor preview frames.
    const onWindowResize = () => updateWidth(window.innerWidth);
    let ro: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(([entry]) => {
        // The observer supplies its initial size before paint. Reading the
        // viewport first forced layout and scheduled a second device update.
        // Hidden renderers wait for their first non-zero observation.
        if (entry && entry.contentRect.width > 0) updateWidth(entry.contentRect.width);
      });
      ro.observe(el);
    } else {
      onWindowResize();
      window.addEventListener("resize", onWindowResize);
    }
    return () => {
      window.removeEventListener("resize", onWindowResize);
      ro?.disconnect();
    };
  }, [device, deviceSource]);

  const effectiveDevice = device ?? viewportDevice;

  return (
    <UsedPostIdsProvider>
      <ChromeReserveContext.Provider value={chrome}>
        <div
          ref={rootRef}
          data-theme-typography
          data-builder-renderer
          data-debug={debug ? "1" : "0"}
          data-device={effectiveDevice}
          {...lcpRootAttributes(lcpRootId, lcpIds)}
        >
          <LcpCandidatesProvider widgetIds={lcpIds ?? NO_LCP_CANDIDATES}>
            <SectionsList
              sections={safeDoc.sections}
              lang={lang}
              device={effectiveDevice}
              deviceSource={deviceSource}
              stream={stream}
              editorPreview={editorPreview}
              lcpEagerFirst={lcpEagerFirst}
              lcpIds={lcpIds}
              serverCvPlan={ownsDoc ? ownedLcp.cv : null}
            />
          </LcpCandidatesProvider>
        </div>
      </ChromeReserveContext.Provider>
      {isPrimary && <BuilderDebugOverlay debug={debug} doc={safeDoc} />}
    </UsedPostIdsProvider>
  );
}

// Single, page-wide debug overlay owned by the primary renderer. The overlay
// is a DEV-only affordance controlled by `?debug=1` or localStorage, so
// production visitors never see it. The height-annotation loop runs once and
// labels every renderer on the page.
function BuilderDebugOverlay({ debug, doc }: { debug: boolean; doc: BuilderDocument }) {
  useEffect(() => {
    if (!import.meta.env.DEV || !debug || typeof window === "undefined") return;
    const annotate = () => {
      document
        .querySelectorAll<HTMLElement>(
          "[data-builder-renderer] [data-sec-id], [data-builder-renderer] [data-col-id], [data-builder-renderer] [data-widget-id]",
        )
        .forEach((el) => {
          el.setAttribute("data-debug-h", String(Math.round(el.getBoundingClientRect().height)));
        });
    };
    annotate();
    const id = window.setInterval(annotate, 500);
    window.addEventListener("resize", annotate);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", annotate);
    };
  }, [debug, doc]);

  // Gating the whole output behind import.meta.env.DEV means the debug CSS
  // string tree-shakes out of production builds entirely.
  if (!import.meta.env.DEV) return null;
  return debug ? <style dangerouslySetInnerHTML={{ __html: DEBUG_OVERLAY_CSS }} /> : null;
}

// ── WYSPY SEKCJI (P2.2) ────────────────────────────────────────────────────
//
// PO CO. Commit hydratacji (K12 w księdze P0.5) uwadniał całą stronę jednym
// ciągiem: sekcje poniżej zgięcia, ich subskrypcje zapytań, efekty i leniwe
// widgety. Sekcje od drugiej (indeks w dokumencie >= 1) są teraz WYSPAMI
// HYDRATACJI (`hydrationIsland.tsx`): HTML serwera zostaje nietknięty, a
// hydratacja rusza dopiero przy widoczności (ekran zapasu w dół), pierwszej
// interakcji (potem po jednej wyspie na klatkę przez kolejkę P0.3), dotknięciu
// albo fokusie we wnętrzu sekcji, w punkcie ciszy - albo od razu przy
// zapisanej sesji (zalogowani i redaktorzy: bloki zależne od roli bez
// odroczenia, krytyka planu m10).
//
// GDZIE. Tylko renderer treści strony (`stream`: strona główna, strony z
// buildera, wsparcie, potwierdzenie zakupu). Powłoka (nagłówek ma własne
// wyspy P2.3, stopka jest jedną wyspą), popupy i szuflada renderują się jak
// dotąd. Kanwa buildera i podgląd edytora - bez wysp (dzieci wprost,
// natychmiastowa reakcja na edycję). Bez wysp w CAŁYM rendererze:
//  - dokument ze spisem treści (widget `toc` albo blok `toc` w `rich-text`,
//    w dowolnej sekcji) - AGENTS.md: aktywność spisu z geometrii nagłówków w
//    jednym nasłuchu przewijania, który ma żyć od startu; a skaner spisu
//    (`lib/content/anchorScan.ts`) dopisuje nagłówkom WSZYSTKICH sekcji `id` i
//    wstawia w nie kotwice aliasowe - HTML czekającej wyspy przestałby się
//    zgadzać z jej renderem (rozjazd hydratacji, render klienta);
//  - treść WPISU (kontekst bieżącego wpisu `kind: "post"`) - w `.article-body`
//    wpisu pracują skrypty, które przed hydratacją wysp zmieniłyby ich HTML:
//    pływający spis treści (`FloatingShareBar`, ten sam skaner), reklamy w
//    treści (`MidPostAds`) i powiązane wpisy po akapicie (wstawiane węzły).
// Sekcja bez wyspy: z testem A/B - przydział wariantu zmienia jej drzewo zaraz
// po starcie (opakowanie `ExperimentSection`), co porzuciłoby HTML czekającej
// wyspy.
// Decyzja jest czystą funkcją dokumentu (indeks w `sections`, nie w liście
// widocznych - zmiana dostępu albo wariantu nie przestawia wyspy na zwykłą
// sekcję i odwrotnie, co przemontowałoby jej drzewo), więc serwer i
// hydratacja wychodzą tak samo.
//
// KOLEJNOŚĆ: wyspa WEWNĄTRZ `StreamingSection`. Bramka danych sekcji
// zawiesza się na serwerze w granicy strumienia, nie w granicy wyspy, więc
// HTML serwera nie ma fallbacku wyspy, a kolejność strumienia jest taka jak
// bez wysp (test `builderRenderer.streamingServer`).
//
// URZĄDZENIE: treść wyspy czyta je lustrem ze źródła renderera
// (`useRendererDevice`), nie z propsów - przełączenie desktop -> telefon kończy
// się na `memo` wyspy (bailout) przed odwodnioną granicą, a uwodniona wyspa
// dostaje nową klasę we własnym przejściu.

// ── CONTENT-VISIBILITY SEKCJI (P3.3) ──────────────────────────────────────
//
// PO CO. Pierwsza klatka dokumentu to jedno zadanie Style + Layout całej
// strony (produkcja: 138-174 ms obs., Layout na 660 obiektach,
// `faza3/diagnoza/waga-dokumentu.md` §7), a sekcje spod zgięcia to około
// połowy elementów. Sekcje od TRZECIEJ w dokumencie (indeks >= 2) dostają
// opakowanie z inline `content-visibility: auto` + `contain-intrinsic-size:
// auto <szacunek>px`: przeglądarka pomija styl, układ i malowanie sekcji poza
// ~1,5 ekranu od widoku (Chromium), a w ich miejscu stawia pas o wysokości
// z szacunku (`estimateSectionHeight` - ta sama liczba, którą rezerwuje
// szkielet strumienia). `auto` zapamiętuje prawdziwą wysokość po pierwszym
// renderze, więc powrót przewijaniem w górę niczego nie przesuwa.
//
// DLACZEGO OPAKOWANIE I DLACZEGO TYLKO „OGON" DOKUMENTU (zmierzone w Chromium
// 141, e2e `e2e/content-visibility.boot-home.spec.ts`). Element z cv, który
// przy PIERWSZYM układzie leży w widoku, Chromium układa najpierw jako pas
// z szacunku, a dopiero potem z treścią. Przesunięcie, które to wywołuje,
// `layout-shift` liczy wyłącznie elementom BEZ cv (rodzeństwo z cv się nie
// liczy): sekcja z szacunkiem 468 px i treścią 24 px tuż nad zgięciem
// desktopu przesuwała szkielet strumieniowanej sekcji pod nią o 0,0094.
// Dlatego:
//  - cv siedzi na opakowaniu WOKÓŁ granicy strumienia sekcji, więc także jej
//    szkielet (fallback) jest w środku elementu z cv;
//  - cv dostaje tylko ciągły ogon sekcji kwalifikujących się do końca listy
//    (`planServerCv`) - w rendererze za elementem z cv stoi wyłącznie element
//    z cv;
//  - ogon musi mieć łącznie co najmniej `CV_MIN_RUN_PX` szacunku: to, co stoi
//    ZA rendererem (przypisy, reszta strony), leży wtedy pod zgięciem w obu
//    przebiegach układu (stopka ma własne `.cv-auto`).
// Sekcje w widoku i tak malują się w pierwszej klatce z treścią.
//
// KTO LICZY. Plan (indeks sekcji -> px) liczy WYŁĄCZNIE SERWER
// (`isServerRender()`, gałąź znika z bundla klienta jak `lcpCandidateIds` -
// budżet domknięcia bootu nie ma zapasu) i zapisuje go w opakowaniach
// (`data-cv`, `data-cv-i`). Hydratacja odczytuje plan z opakowań serwera
// w inicjalizatorze stanu renderera (`readServerCvPlan`, obok nośnika
// kandydatów LCP) - opakowania leżą poza granicami Suspense, więc są w DOM-ie
// od pierwszego bajtu powłoki. Ten sam bajt na serwerze i w kliencie.
// `isServerRender()` stoi zawsze NA POCZĄTKU warunku: Rollup zwija tylko
// wyrażenie, którego lewa strona jest znana (`isServer` = fałsz w buildzie
// przeglądarki); za nieznanym operandem (`!isLcpOwner || isServerRender()`)
// wywołanie zostaje w bundlu razem z funkcją i importem `isServer`.
//
// GDZIE. Tylko renderer treści z HTML-em serwera (`lcpIds` różne od `null`:
// SSR i hydratacja renderera-właściciela) - te same warunki co wyspy sekcji:
// bez kanwy, podglądu, treści wpisu (spis treści `FloatingShareBar` i skrypty
// `.article-body` czytają geometrię nagłówków) i dokumentu ze spisem treści
// (AGENTS.md: aktywność spisu z geometrii nagłówków; pominięta sekcja ma
// geometrię pasa zastępczego). Render czysto kliencki (nawigacja SPA, powrót
// „wstecz", sekcja odsłonięta po hydratacji) NIE dostaje cv: router przywraca
// wtedy `scrollY` zapisane na prawdziwym układzie, a nowy węzeł z cv
// malowałby się przez klatkę jako pas z szacunku.
//
// PRZYWRÓCENIE PRZEWINIĘCIA I KOTWICA PRZY WEJŚCIU. Dokument z serwera bywa
// otwierany w połowie: przeładowanie albo powrót bez bfcache (skrypt TanStacka
// na końcu `<main>` przywraca `scrollY` z `sessionStorage`) i adres z `#id`
// (ten sam skrypt i przeglądarka przewijają do celu). Pozycja liczona na pasach
// z szacunku trafiałaby wtedy obok celu, więc blok cv renderera ma strażnika
// (`CV_GUARD_SCRIPT`, inline przed sekcjami): gdy czeka przywrócenie okna albo
// adres ma fragment, ustawia `html[data-cv-off]`, a reguła z `CV_CSS` zdejmuje
// cv ze wszystkich opakowań, zanim parser do nich dojdzie - strona zachowuje
// się wtedy dokładnie jak bez P3.3. Pierwsze wejście (i przebieg Lighthouse'a)
// nie ma ani wpisu przywrócenia, ani fragmentu.
//
// KOTWICA PO WCZYTANIU (nawigacja do fragmentu w tym samym dokumencie: link
// `#id`, `location.hash`, wstecz/dalej między fragmentami). Przeglądarka
// przewija do celu na układzie z chwili skoku: sekcje z cv nad celem stoją
// wtedy na pasach z szacunku (na telefonie 1,3-3x za niskich) i dorysowują się
// dopiero kilka klatek później. Zakotwiczenie przewijania Chromium nie zawsze
// to wyrówna: kotwica bywa wybrana W pominiętej sekcji nad celem (jej poddrzewo
// ułożył już ktoś, kto czytał w nim geometrię - pomiar widgetu, snapshotter
// trace'u Playwrighta w CI), a wtedy wzrost tej sekcji pod kotwicą spycha cel
// o setki pikseli w dół (CI fali 3: cel 1240 px pod górą widoku telefonu);
// Safari zakotwiczenia nie ma wcale. Dlatego strażnik nasłuchuje też nawigacji
// do fragmentu i przy PIERWSZEJ, której cel leży w obszarze cv (w opakowaniu
// albo za pierwszym z nich - cele nad ogonem, np. link „przejdź do treści",
// nic nie kosztują), ustawia ten sam wyłącznik `html[data-cv-off]`, ZANIM
// przeglądarka policzy przewinięcie:
//  - `click` w fazie przechwytywania na oknie (przed każdym handlerem strony
//    i routera): link albo obszar mapy z `href` do fragmentu tego samego
//    dokumentu, bez modyfikatora i bez `target` innego niż `_self`;
//  - `popstate`: przychodzi synchronicznie w nawigacji do fragmentu
//    (`location.hash`, pasek adresu) i przy wstecz/dalej. Chromium wysyła je
//    PRZED przewinięciem (zmierzone), WebKit PO nim, na pasach
//    (`FrameLoader::loadInSameDocument`). Strażnik czyta więc położenie celu
//    jeszcze na pasach: cel już w widoku znaczy, że przeglądarka przewinęła
//    (WebKit). Wtedy po wyłączeniu cv przewija cel (`scrollIntoView`) na
//    prawdziwym układzie w najbliższej klatce (`requestAnimationFrame` - przed
//    jej malowaniem, ale PO nasłuchu `popstate` routera: TanStack zapamiętuje
//    w nim pozycję wpisu, z którego się wychodzi, a przewinięcie przed tym
//    zapisem psułoby powrót „wstecz" do miejsca czytania). W Chromium
//    przeglądarka umieściła już cel w tym samym miejscu. Cel poza widokiem
//    (Chromium, wstecz/dalej): tylko wyłączenie, przewinięcie zostaje
//    przeglądarce albo routerowi;
//  - `hashchange` jako siatka (silnik bez `popstate` przy fragmencie): gdy cv
//    jest jeszcze włączone - to samo.
// Strażnik przewija tylko w klatce zaraz po nawigacji, która wyłączyła cv,
// więc nie walczy z przewijaniem, które użytkownik zaczyna po skoku. Raz
// wyłączone cv zostaje wyłączone do końca życia dokumentu. Koszt: jednorazowe
// odsłonięcie sekcji w zadaniu tej nawigacji, więc INP tego jednego kliku
// wraca do poziomu sprzed P3.3; zysk przy wczytaniu i przy zwykłym
// przewijaniu zostaje. `<Link hash>` i `router.navigate({ hash })` na tej
// samej stronie w ogóle nie przewijają (`defaultHashScrollIntoView: false`
// w `src/router.tsx`), a klik w taki link i tak wyłącza cv w fazie
// przechwytywania.
//
// WYŁĄCZENIA SEKCJI (`serverSectionCv`). `content-visibility: auto` włącza na
// stałe zawieranie układu, stylu i malowania opakowania: staje się ono blokiem
// zawierającym dla potomków `position: fixed`, przycina malowanie do swojego
// pudełka i nie przepuszcza marginesów. Sekcja dostaje cv tylko wtedy, gdy:
//  - KAŻDY jej widget ma typ z `CV_SAFE_WIDGET_TYPES` (drzewo bez `fixed`/
//    `sticky` poza portalem i bez treści wylewającej się poza sekcję -
//    wyszukiwarka, menu, odtwarzacz z dokowaniem, przeglądarka relacji itd.
//    zostają poza listą; nowy typ widgetu domyślnie NIE dostaje cv), nie jest
//    globalny (`globalId`: treść z innego rekordu) i nie jest kandydatem LCP;
//  - sama sekcja nie ma klasy autora, cienia, rozciągnięcia na 100vw ani
//    pionowych marginesów (rzeczy, które wychodzą poza pudełko opakowania albo
//    zlewają się z sąsiadem);
//  - ani sekcja, ani jej kolumny/sekcje wewnętrzne/widgety nie mają klasy ani
//    CSS autora z `fixed`/`sticky` i tła/nakładki z `attachment: fixed`;
//  - nikt w sekcji nie ma autorskiej kotwicy (`advanced.htmlId`): cel linku
//    z menu (`/#kontakt`) zostaje zwykłą sekcją z dokładną geometrią, także
//    dla nasłuchów, które czytają położenie celów kotwic.
// Druk: Chromium drukuje pominięte sekcje (sprawdzone na `page.pdf()`), a dla
// pozostałych silników `CV_CSS` ma regułę `@media print` - styl inline nie ma
// zapytań o media.
//
// BLOK CV W HTML-U. `<style>` (`CV_CSS`) i `<script>` (`CV_GUARD_SCRIPT`) stoją
// w jednym ukrytym `<div>` z `dangerouslySetInnerHTML`, którego treść renderuje
// tylko serwer; klient renderuje ten sam węzeł z pustym `__html`
// i `suppressHydrationWarning` - React przy hydratacji nie dotyka `innerHTML`
// (produkcja; w DEV ten znacznik wyłącza porównanie), a `CvBlock` jest `memo`
// bez propsów, więc żaden późniejszy commit go nie przepisuje. Stałe nie
// wchodzą do bundla klienta (wzór: gniazdo powłoki zgód w `__root.tsx`).

/** Pierwszy indeks sekcji W DOKUMENCIE z `content-visibility` (P3.3). */
const CV_FIRST_SECTION_INDEX = 2;

/**
 * Najmniejsza łączna rezerwa ogona z cv (px): dwa wysokie ekrany desktopu
 * (~1300 px). Krótszy ogon mógłby w całości zmieścić się nad zgięciem razem
 * z tym, co stoi za rendererem (DLACZEGO OPAKOWANIE... wyżej).
 */
const CV_MIN_RUN_PX = 2600;

/**
 * Typy widgetów bezpieczne dla `content-visibility: auto` na sekcji: ich drzewo
 * nie renderuje potomków `position: fixed`/`sticky` poza portalem (lightboksy,
 * listy rozwijane i okna idą portalem do `body`) i nie wylewa się poza sekcję
 * celowo. Lista dozwolonych, nie zakazanych: typ spoza listy (także nowy)
 * zostawia sekcję bez cv - tracimy wtedy tylko oszczędność, nie układ.
 */
const CV_SAFE_WIDGET_TYPES: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "heading",
  "text",
  "image",
  "button",
  "divider",
  "spacer",
  "counter",
  "icon",
  "rich-text",
  "post-list",
  "carousel",
  "progress-carousel",
  "circular-carousel",
  "categories",
  "tags",
  "newsletter",
  "cta",
  "join-us",
  "accordion",
  "timeline",
  "logo-cloud",
  "testimonial",
  "slider",
  "section-label",
  "animated-heading",
  "text-rotate",
  "tailored-must-reads",
  "news-ticker",
  "trending-now",
  "hot-topic-bar",
  "rated-list",
  "dark-featured-card",
  "cover-overlay-card",
  "promo-card",
  "event-list",
  "event-countdown",
  "event-countdown-card",
]);

const FIXED_OR_STICKY = /\b(?:fixed|sticky)\b/;

/** Ustawienia węzła wykluczające sekcję z cv: kotwica autora albo `fixed`/`sticky` w klasie/CSS. */
function cvBlockedBy(advanced: AdvancedSettings | undefined): boolean {
  return (
    !!advanced &&
    (!!advanced.htmlId?.trim() ||
      FIXED_OR_STICKY.test(advanced.cssClass ?? "") ||
      FIXED_OR_STICKY.test(advanced.customCss ?? ""))
  );
}

const fixedAttachment = (...layers: Array<BackgroundSettings | undefined>): boolean =>
  layers.some((layer) => layer?.attachment === "fixed");

function cvSafeColumn(column: ColumnNode | undefined, lcpIds: readonly string[]): boolean {
  if (!column) return true;
  if (cvBlockedBy(column.advanced)) return false;
  return (Array.isArray(column.children) ? column.children : []).every(
    (w) =>
      !w ||
      (CV_SAFE_WIDGET_TYPES.has(w.type) &&
        !w.globalId &&
        !lcpIds.includes(w.id) &&
        !cvBlockedBy(w.advanced)),
  );
}

/**
 * TYLKO SERWER: rezerwa `contain-intrinsic-size` sekcji (px) albo `undefined`,
 * gdy sekcja nie może dostać `content-visibility` (WYŁĄCZENIA SEKCJI wyżej).
 * Węzły czytane defensywnie - dokument z bazy (jsonb) nie zawsze trzyma się
 * typu.
 */
function serverSectionCv(section: SectionNode, lcpIds: readonly string[]): number | undefined {
  const layout = section.layout;
  if (
    cvBlockedBy(section.advanced) ||
    !!section.advanced?.cssClass?.trim() ||
    layout?.stretch ||
    !!layout?.marginTop ||
    !!layout?.marginBottom ||
    !!section.border?.boxShadow ||
    !!section.borderHover?.boxShadow ||
    fixedAttachment(
      section.background,
      section.backgroundHover,
      section.overlay,
      section.overlayHover,
    )
  ) {
    return undefined;
  }
  for (const child of Array.isArray(section.children) ? section.children : []) {
    if (!child) continue;
    if (child.kind === "inner-section") {
      if (cvBlockedBy(child.advanced) || fixedAttachment(child.background)) return undefined;
      const columns = Array.isArray(child.columns) ? child.columns : [];
      if (!columns.every((column) => cvSafeColumn(column, lcpIds))) return undefined;
    } else if (!cvSafeColumn(child, lcpIds)) {
      return undefined;
    }
  }
  return estimateSectionHeight(section);
}

/** Plan cv: indeks sekcji W DOKUMENCIE -> rezerwa (px). */
type CvPlan = ReadonlyMap<number, number>;

/**
 * TYLKO SERWER: plan cv malowanych sekcji - ciągły ogon kwalifikujących się
 * sekcji od indeksu `CV_FIRST_SECTION_INDEX`, liczony od końca listy do
 * pierwszej sekcji bez cv, o łącznej rezerwie >= `CV_MIN_RUN_PX`; inaczej
 * `null` (DLACZEGO OPAKOWANIE... wyżej).
 */
function planServerCv(
  visible: ReadonlyArray<{ s: SectionNode; docIndex: number }>,
  lcpIds: readonly string[],
): CvPlan | null {
  const plan = new Map<number, number>();
  let total = 0;
  for (let i = visible.length - 1; i >= 0; i -= 1) {
    const { s, docIndex } = visible[i];
    const px = docIndex >= CV_FIRST_SECTION_INDEX ? serverSectionCv(s, lcpIds) : undefined;
    if (px === undefined) break;
    plan.set(docIndex, px);
    total += px;
  }
  return total >= CV_MIN_RUN_PX ? plan : null;
}

/**
 * Hydratacja: plan cv z opakowań, które serwer wyrenderował bezpośrednio
 * w korzeniu renderera o tym `useId()` (`data-lcp-root`; wartość bez cudzysłowu
 * i ukośnika), albo `null` (renderer bez cv, render czysto kliencki -
 * identyfikatory klienta mają inny kształt niż serwerowe).
 */
function readServerCvPlan(rootId: string): CvPlan | null {
  const plan = new Map<number, number>();
  for (const el of document.querySelectorAll<HTMLElement>(
    `[data-lcp-root="${rootId}"] > [data-cv]`,
  )) {
    plan.set(+el.dataset.cvI!, +el.dataset.cv!);
  }
  return plan.size ? plan : null;
}

/**
 * Reguły bloku cv: druk bez pominiętych sekcji także poza Chromium (styl inline
 * nie ma `@media`) i wyłącznik strażnika `html[data-cv-off]`. `!important`
 * arkusza wygrywa ze zwykłą deklaracją inline.
 */
const CV_CSS =
  "@media print{[data-cv]{content-visibility:visible!important}}" +
  "[data-cv-off] [data-cv]{content-visibility:visible!important}";

/**
 * Strażnik cv (ES5, jedno IIFE bez zmiennych globalnych).
 *
 * 1. Wejście w połowie strony (PRZYWRÓCENIE PRZEWINIĘCIA I KOTWICA PRZY
 *    WEJŚCIU wyżej). Czyta to samo co skrypt przywracania TanStacka: wpis okna
 *    w `sessionStorage["tsr-scroll-restoration-v1_3"]` (`storageKey` z
 *    `@tanstack/router-core` - zgodność pilnuje test) pod kluczem
 *    `history.state.__TSR_key`, oraz fragment adresu.
 * 2. Nawigacja do fragmentu po wczytaniu (KOTWICA PO WCZYTANIU wyżej): `f`
 *    zamienia fragment na element w obszarze cv (`compareDocumentPosition`
 *    z pierwszym opakowaniem: bit FOLLOWING = 4 obejmuje też jego potomków)
 *    albo `null`; `o` ustawia wyłącznik raz i mówi, czy to zrobił; `g`
 *    (`popstate`, `hashchange`) czyta położenie celu jeszcze przy cv i przewija
 *    go w najbliższej klatce tylko wtedy, gdy samo wyłączyło cv, a przeglądarka
 *    już przewinęła (cel w widoku).
 *
 * Atrybut na `<html>` (`suppressHydrationWarning` w `__root.tsx`, jak skrypty
 * zgód). Literał - bramka `check:dangerous-html`.
 */
const CV_GUARD_SCRIPT =
  '(function(d,h,c){function o(e){if(!e||h.hasAttribute(c))return 0;h.setAttribute(c,"");' +
  "return 1}function f(s){try{var i=s.slice(1),e=i&&(d.getElementById(i)||d.getElementById(" +
  'decodeURIComponent(i))),w=d.querySelector("[data-cv]");return e&&w&&w.compareDocumentPosition(' +
  "e)&4?e:null}catch(x){return null}}function g(){var e=f(location.hash),t=e&&!h.hasAttribute(c)" +
  "&&e.getBoundingClientRect().top;o(e)&&t>=0&&t<innerHeight&&requestAnimationFrame(function(){" +
  "e.scrollIntoView()})}try{var k=(history.state||{}).__TSR_key,w=k&&(JSON.parse(" +
  'sessionStorage.getItem("tsr-scroll-restoration-v1_3")||"{}")[k]||{}).window;' +
  "if(location.hash.length>1||w&&w.scrollY>0)o(h)}catch(x){}" +
  'addEventListener("click",function(v){try{var a=v.target.closest("a[href],area[href]");' +
  'a&&!(v.ctrlKey||v.metaKey||v.shiftKey||v.altKey)&&(!a.target||a.target=="_self")&&' +
  'a.href.split("#")[0]==location.href.split("#")[0]&&o(f(a.hash))}catch(x){}},!0);' +
  'addEventListener("popstate",g);addEventListener("hashchange",g)})(document,' +
  'document.documentElement,"data-cv-off")';

/**
 * Treść bloku cv (serwer): reguły i strażnik w jednym ukrytym węźle - `<style>`
 * działa niezależnie od `display`, a skrypt wstawiony parserem wykonuje się
 * przy parsowaniu.
 */
const CV_BLOCK_HTML = `<style>${CV_CSS}</style><script>${CV_GUARD_SCRIPT}</script>`;

/**
 * Blok cv renderera (BLOK CV W HTML-U). `memo` bez propsów: po montażu (także
 * hydratacji) nie renderuje się ponownie, więc React nigdy nie porównuje ani nie
 * przepisuje pustego `__html` klienta - treść serwera zostaje w DOM-ie.
 */
const CvBlock = memo(function CvBlock() {
  return (
    <div
      hidden
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: isServerRender() ? CV_BLOCK_HTML : "" }}
    />
  );
});

/**
 * Treść sekcji-wyspy. Wszystkie propsy są niezależne od urządzenia i stałe
 * między renderami listy (obiekt sekcji z dokumentu, język, źródło renderera,
 * flaga eager), więc re-render listy kończy się na `memo` wyspy przed jej
 * odwodnioną granicą. Urządzenie - lustrem ze źródła renderera.
 */
const IslandSectionContent = memo(function IslandSectionContent({
  section,
  lang,
  deviceSource,
  eager,
}: {
  section: SectionNode;
  lang: "pl" | "en";
  deviceSource: ViewportDeviceSource;
  eager: boolean;
}) {
  const device = useRendererDevice(deviceSource);
  return (
    <RenderErrorBoundary label={`section:${section.id}`}>
      <LcpEagerSection eager={eager}>
        <RenderSection section={section} lang={lang} device={device} />
      </LcpEagerSection>
    </RenderErrorBoundary>
  );
});

const SectionsList = memo(function SectionsList({
  sections,
  lang,
  device,
  deviceSource,
  stream,
  editorPreview,
  lcpEagerFirst,
  lcpIds,
  serverCvPlan,
}: {
  sections: SectionNode[];
  lang: "pl" | "en";
  device: Device;
  /** Źródło urządzenia renderera dla treści wysp (P2.2). */
  deviceSource: ViewportDeviceSource;
  stream: boolean;
  editorPreview: boolean;
  /** Render czysto kliencki właściciela: pierwsza malowana sekcja ładuje obrazy eager (`LcpImage`). */
  lcpEagerFirst: boolean;
  /** Kandydaci LCP z nośnika serwera; `null` = brak nośnika. Czyta tylko serwer (plan cv, P3.3). */
  lcpIds: readonly string[] | null;
  /** Plan cv odczytany z HTML-u serwera przy hydratacji (P3.3); `null` poza nią. */
  serverCvPlan: CvPlan | null;
}) {
  const accessCtx = useAccessContext();
  const builderMode = useBuilderMode();
  const post = useCurrentPostCtx();
  const safeSections = Array.isArray(sections) ? sections : [];
  // A/B: bucket the visitor deterministically per experiment (client-side, so
  // SSR + first client render always show variant A - no hydration mismatch).
  // The builder canvas keeps every variant visible instead.
  const assignments = useExperimentAssignments(safeSections, !editorPreview);
  // Wyspy (P2.2) tylko w rendererze treści strony, poza kanwą, podglądem,
  // treścią wpisu i dokumentem ze spisem treści (WYSPY SEKCJI wyżej).
  const islands =
    stream &&
    !editorPreview &&
    builderMode === null &&
    post?.kind !== "post" &&
    !safeSections.some((s) => !!s && sectionIslandInfo(s).toc);
  const visible = safeSections.flatMap((s, docIndex) =>
    !!s &&
    evaluateAccess(s.advanced?.access, accessCtx) &&
    (editorPreview || isSectionVisibleForAssignments(s, assignments))
      ? [{ s, docIndex }]
      : [],
  );
  // `content-visibility` (P3.3): warunki wysp + HTML serwera (nośnik kandydatów
  // LCP). Plan liczy serwer; hydratacja bierze go z opakowań serwera tego
  // samego dokumentu - są tylko tam, gdzie serwer miał wyspy i nośnik, więc
  // klient nie sprawdza warunków drugi raz (krótsza ścieżka w bundlu bootu).
  const cvPlan = isServerRender()
    ? islands && lcpIds
      ? planServerCv(visible, lcpIds)
      : null
    : serverCvPlan;
  return (
    <>
      {cvPlan && <CvBlock />}
      {visible.map(({ s, docIndex }, index) => {
        const abTag = s.advanced?.abTest;
        // Priorytet obrazów NIE wynika już z indeksu sekcji: kandydatów LCP
        // wyznacza renderer-właściciel (`lcpOwner`) i podaje kontekstem
        // `LcpCandidatesProvider` nad listą sekcji. Indeks liczy się wyłącznie
        // w renderze czysto klienckim właściciela (`lcpEagerFirst`, bez
        // znacznika i preloadu); `LcpEagerSection` owija KAŻDĄ sekcję, więc
        // drzewo jest identyczne w SSR i przy hydratacji.
        const eager = lcpEagerFirst && index === 0;
        const island = islands && docIndex >= 1 ? sectionIslandInfo(s) : null;
        let entry: ReactNode;
        if (island?.eligible) {
          entry = (
            <StreamingSection key={s.id} section={s} lang={lang} device={device} enabled={stream}>
              <HydrationIsland
                id={`sec-${s.id}`}
                trigger={SECTION_ISLAND_TRIGGER}
                chunks={islandChunksFor(island.widgetTypes)}
                fallbackMinHeight={island.fallbackMinHeight}
              >
                <IslandSectionContent
                  section={s}
                  lang={lang}
                  deviceSource={deviceSource}
                  eager={eager}
                />
              </HydrationIsland>
            </StreamingSection>
          );
        } else {
          const rendered = (
            <RenderErrorBoundary label={`section:${s.id}`}>
              <LcpEagerSection eager={eager}>
                <RenderSection section={s} lang={lang} device={device} />
              </LcpEagerSection>
            </RenderErrorBoundary>
          );
          entry = (
            <StreamingSection key={s.id} section={s} lang={lang} device={device} enabled={stream}>
              {abTag && !editorPreview && assignments ? (
                <ExperimentSection experimentId={abTag.experimentId} variant={abTag.variant}>
                  {rendered}
                </ExperimentSection>
              ) : (
                rendered
              )}
            </StreamingSection>
          );
        }
        // Opakowanie cv (P3.3) poza granicą strumienia: szkielet sekcji też jest
        // w środku, a opakowanie leży w powłoce HTML-u (odczyt planu przy hydratacji).
        const cvPx = cvPlan?.get(docIndex);
        return cvPx ? (
          <div
            key={s.id}
            data-cv={cvPx}
            data-cv-i={docIndex}
            style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${cvPx}px` }}
          >
            {entry}
          </div>
        ) : (
          entry
        );
      })}
    </>
  );
});

SectionsList.displayName = "SectionsList";

/**
 * Tracking envelope for the A/B variant actually shown to this visitor:
 * exposure once per session on mount, conversion once per session on any
 * click inside the variant. `display: contents` keeps it out of layout.
 */
function ExperimentSection({
  experimentId,
  variant,
  children,
}: {
  experimentId: string;
  variant: AbVariant;
  children: React.ReactNode;
}) {
  // Ekspozycja liczy się dopiero, gdy odwiedzający NAPRAWDĘ jest na stronie.
  // Strona wyrenderowana spekulacyjnie (Speculation Rules `prerender`) montuje
  // ten efekt w tle - bez tej osłony sam najazd kursora na link w treści
  // podbijałby MIANOWNIK współczynnika konwersji, czyli zaniżał wynik
  // eksperymentu tym mocniej, im lepiej działa prefetch. Ta sama zasada, co
  // w `useRecordPostView` i w telemetrii RUM z `__root.tsx`.
  useEffect(
    () => afterPrerendering(() => recordExperimentEvent(experimentId, variant, "exposure")),
    [experimentId, variant],
  );
  return (
    <div
      style={{ display: "contents" }}
      onClickCapture={() => recordExperimentEvent(experimentId, variant, "conversion")}
    >
      {children}
    </div>
  );
}

/**
 * Decorative section background video. Preloads only metadata and pauses
 * playback whenever the section leaves the viewport - offscreen background
 * videos were silently burning bandwidth, decode time and battery on long
 * builder pages.
 *
 * BRAMKA RUCHU (P3.5, `useGatedVideoAutoplay`): HTML z serwera nie ma atrybutu
 * `autoplay`, więc wideo nie rusza przy pierwszym malowaniu (w środku śladu
 * Lighthouse'a). Odtwarzanie zaczyna się po pierwszej interakcji albo w
 * punkcie ciszy strony - nadal tylko wtedy, gdy sekcja jest przy viewporcie.
 * Do tego czasu stoi pierwsza klatka, także na iOS (`firstFrameVideoSrc`:
 * sekcja nie ma plakatu, a bez fragmentu `#t=` tło byłoby puste).
 */
function SectionBackgroundVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useGatedVideoAutoplay(ref, true, src, true);

  return (
    <video
      ref={ref}
      src={firstFrameVideoSrc(src)}
      muted
      loop
      playsInline
      preload="metadata"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        zIndex: 0,
      }}
    />
  );
}

const RenderSection = memo(function RenderSection({
  section,
  lang,
  device,
}: {
  section: SectionNode;
  lang: "pl" | "en";
  device: Device;
}) {
  const parentSlot = useBuilderImageSlot();
  const accessCtx = useAccessContext();
  const tabsCfg = section.tabs;
  const tabsEnabled = !!(tabsCfg?.enabled && tabsCfg.items && tabsCfg.items.length > 0);
  const initialTabId = initialSectionTabId(section) ?? "";
  const [activeTabId, setActiveTabId] = useState<string>(initialTabId);
  // Tab-switch animation: krótkie fade-out starej treści, podmiana, fade-in
  // nowej. `activeTabId` steruje paskiem zakładek (natychmiast), a
  // `displayTabId` zawartością panelu (po zakończeniu fade-out).
  const [displayTabId, setDisplayTabId] = useState<string>(initialTabId);
  const [tabPhase, setTabPhase] = useState<"in" | "out">("in");
  const TAB_FADE_MS = 180;
  const prefersReducedMotion = usePrefersReducedMotion(tabsEnabled);
  const tabTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTabSelect = (id: string) => {
    if (id === activeTabId) return;
    if (tabTransitionTimerRef.current) clearTimeout(tabTransitionTimerRef.current);
    setActiveTabId(id);
    if (prefersReducedMotion) {
      setDisplayTabId(id);
      setTabPhase("in");
      return;
    }
    setTabPhase("out");
    tabTransitionTimerRef.current = setTimeout(() => {
      setDisplayTabId(id);
      setTabPhase("in");
      tabTransitionTimerRef.current = null;
    }, TAB_FADE_MS);
  };
  useEffect(
    () => () => {
      if (tabTransitionTimerRef.current) clearTimeout(tabTransitionTimerRef.current);
    },
    [],
  );
  // If tab list changes (add/remove/rename), keep active id valid.
  useEffect(() => {
    if (!tabsEnabled) return;
    const ids = tabsCfg!.items.map((t) => t.id);
    if (!ids.includes(activeTabId)) {
      setActiveTabId(ids[0] ?? "");
      setDisplayTabId(ids[0] ?? "");
      setTabPhase("in");
    }
  }, [tabsEnabled, tabsCfg, activeTabId]);

  const emptyPicker = useContext(EmptyContainerPickerContext);
  const allChildren = (Array.isArray(section.children) ? section.children : []).filter(
    (c): c is ColumnNode | InnerSectionNode => !!c && evaluateAccess(c.advanced?.access, accessCtx),
  );
  const visibleCols = tabsEnabled
    ? allChildren.filter((c) => !c.tabId || c.tabId === displayTabId)
    : allChildren;
  const showEmptyPicker = !!emptyPicker && visibleCols.length === 0;
  const layoutDevice = gridDevice(device);
  const colsSum =
    visibleCols.reduce(
      (a, c) => a + (c.kind === "column" ? resolveSpan(c.span, layoutDevice, 12) : 12),
      0,
    ) || 12;
  const Tag = (section.layout?.htmlTag ?? "section") as ElementType;
  const bgStyle = backgroundLayerStyle(section.background);
  const wrapStyle: CSSProperties = {
    ...sectionWrapperStyle(section),
    ...bgStyle,
    ...borderStyle(section.border),
    ...typographyAlign(section.typography, device),
  };
  const typoCss = typographyCss(section.id, section.typography);
  const sectionKind = useMemo(
    () => (isPeopleSectionKind(allChildren) ? "people" : ""),
    [allChildren],
  );
  // Opakowania z `overflow-hidden` nad widgetem wyszukiwarki dostają znacznik
  // już w HTML-u SSR (`@/lib/builder/searchOverflow`) - zamiast `:has()`.
  // `visibleCols`: kolumna nieaktywnej zakładki nie renderuje widgetu.
  const searchScope = { device, accessCtx };
  const hostsSearch = visibleCols.some((c) => childHostsSearchWidget(c, searchScope));
  const videoUrl =
    section.background?.type === "video"
      ? safeImageUrl(section.background.videoUrl) || section.background.videoUrl
      : "";

  const preloadRef = useSectionPreload(section, lang);

  return (
    <Tag
      ref={preloadRef as React.Ref<HTMLElement>}
      id={sanitizeHtmlId(section.advanced?.htmlId)}
      data-sec-id={section.id}
      data-section-kind={sectionKind || undefined}
      data-search-overflow={searchOverflowAttr(hostsSearch)}
      data-ab-experiment={section.advanced?.abTest?.experimentId}
      data-ab-variant={section.advanced?.abTest?.variant}
      className={`min-w-0 max-w-full overflow-hidden ${sanitizeCssClass(section.advanced?.cssClass) ?? ""}`.trim()}
      style={wrapStyle}
    >
      {/* Style sekcji PRZED jej dziećmi: przy strumieniowanym HTML parser
          maluje kolumny od razu po wczytaniu, a bloki na końcu sekcji docierały
          dopiero po nich - pierwsza klatka szła bez typografii sekcji i bez
          mobilnej kolejności kolumn, czyli z przesunięciem układu. */}
      {typoCss && <style dangerouslySetInnerHTML={{ __html: hardenStyleCss(typoCss) }} />}
      {(() => {
        const mobileOrderCss = visibleCols
          .filter((c): c is ColumnNode => c.kind === "column" && !!c.order)
          .map(
            (c) =>
              `[data-sec-id="${section.id}"] [data-col-id="${c.id}"]{order:${c.order?.mobile ?? 0} !important;}`,
          )
          .join("");
        return mobileOrderCss ? (
          <style
            dangerouslySetInnerHTML={{
              __html: hardenStyleCss(`@media (max-width: 767px){${mobileOrderCss}}`),
            }}
          />
        ) : null;
      })()}
      {section.background?.type === "video" && videoUrl && (
        <SectionBackgroundVideo src={videoUrl} />
      )}
      <div style={overlayLayerStyle(section.overlay)} aria-hidden />
      <ShapeDivider s={section.shapeDividerTop} position="top" />
      <ShapeDivider s={section.shapeDividerBottom} position="bottom" />
      <div
        data-search-overflow={searchOverflowAttr(hostsSearch)}
        style={sectionContainerStyle(section)}
      >
        {tabsEnabled && (tabsCfg!.orientation ?? "horizontal") === "horizontal" && (
          <div style={{ marginBottom: 16 }}>
            <SectionTabsBar
              sectionId={section.id}
              tabs={tabsCfg!}
              lang={lang}
              activeId={activeTabId}
              onSelect={handleTabSelect}
            />
          </div>
        )}
        <div
          style={
            tabsEnabled && (tabsCfg!.orientation ?? "horizontal") === "vertical"
              ? { display: "flex", gap: 20, alignItems: "flex-start" }
              : undefined
          }
        >
          {tabsEnabled && (tabsCfg!.orientation ?? "horizontal") === "vertical" && (
            <SectionTabsBar
              sectionId={section.id}
              tabs={tabsCfg!}
              lang={lang}
              activeId={activeTabId}
              onSelect={handleTabSelect}
            />
          )}
          <div
            data-columns-row
            data-section-tab-panel={tabsEnabled ? displayTabId : undefined}
            data-tab-phase={tabsEnabled ? tabPhase : undefined}
            role={tabsEnabled ? "tabpanel" : undefined}
            id={tabsEnabled ? `sec-${section.id}-panel-${displayTabId}` : undefined}
            aria-labelledby={tabsEnabled ? `sec-${section.id}-tab-${displayTabId}` : undefined}
            data-search-overflow={searchOverflowAttr(hostsSearch)}
            className="min-w-0 max-w-full overflow-hidden"
            style={{
              ...columnsRowStyle(section, colsSum),
              flex:
                tabsEnabled && (tabsCfg!.orientation ?? "horizontal") === "vertical"
                  ? 1
                  : undefined,
              ...(tabsEnabled && !prefersReducedMotion
                ? {
                    transition: `opacity ${TAB_FADE_MS}ms ease, transform ${TAB_FADE_MS}ms ease`,
                    opacity: tabPhase === "out" ? 0 : 1,
                    transform: tabPhase === "out" ? "translateY(4px)" : "translateY(0)",
                    willChange: "opacity, transform",
                  }
                : null),
            }}
          >
            {showEmptyPicker ? (
              // Edit-mode-only: i komponent, i callback pochodzą z kontekstu,
              // który wypełnia WYŁĄCZNIE kanwa buildera. Ten plik nie zna boksu
              // ani jego słowników - patrz `EmptyContainerPickerBoxProps` wyżej.
              // `Suspense` zostaje, bo kanwa podaje komponent leniwy.
              <Suspense fallback={null}>
                <emptyPicker.Box
                  tabsEnabled={tabsEnabled}
                  onPick={(spans) =>
                    emptyPicker.onPick(section.id, tabsEnabled ? activeTabId : null, spans)
                  }
                />
              </Suspense>
            ) : (
              visibleCols.map((c) => {
                const span = c.kind === "column" ? resolveSpan(c.span, layoutDevice, 12) : 12;
                const gridColumn = `span ${span}`;
                const order = c.kind === "column" ? resolveOrder(c.order, device) : undefined;
                return (
                  <div
                    key={c.id}
                    data-column-slot
                    data-col-id={c.id}
                    data-search-overflow={searchOverflowAttr(
                      childHostsSearchWidget(c, searchScope),
                    )}
                    className="min-w-0 max-w-full overflow-hidden"
                    style={{ gridColumn, ...(order !== undefined ? { order } : {}) }}
                  >
                    {c.kind === "inner-section" ? (
                      <RenderInner inner={c} lang={lang} device={device} />
                    ) : (
                      <BuilderImageSlotContext.Provider
                        value={columnImageSlot(section, c, visibleCols, parentSlot)}
                      >
                        <RenderColumn column={c} lang={lang} device={device} />
                      </BuilderImageSlotContext.Provider>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </Tag>
  );
});

RenderSection.displayName = "RenderSection";

const RenderInner = memo(function RenderInner({
  inner,
  lang,
  device,
}: {
  inner: InnerSectionNode;
  lang: "pl" | "en";
  device: Device;
}) {
  const parentSlot = useBuilderImageSlot();
  const accessCtx = useAccessContext();
  // Ten poziom był jedynym, który pomijał advanced.access - sekcje (318),
  // kolumny najwyższego poziomu (494) i widgety (733) bramkują od dawna, więc
  // reguła na kolumnie WEWNĄTRZ sekcji zagnieżdżonej nie działała po nawigacji
  // SPA. Serwerowy strip w lib/queries/public.ts zdejmuje ten węzeł już przy
  // SSR; to domyka tę samą regułę na ścieżce klienckiej.
  const columns = (Array.isArray(inner.columns) ? inner.columns : []).filter(
    (c): c is ColumnNode => !!c && evaluateAccess(c.advanced?.access, accessCtx),
  );
  const layoutDevice = gridDevice(device);
  const colsSum = columns.reduce((a, c) => a + resolveSpan(c.span, layoutDevice, 6), 0) || 12;
  const innerKind = isPeopleSectionKind(columns) ? "people" : "";
  const searchScope = { device, accessCtx };
  const hostsSearch = columns.some((c) => childHostsSearchWidget(c, searchScope));
  return (
    <div
      data-section-kind={innerKind || undefined}
      data-search-overflow={searchOverflowAttr(hostsSearch)}
      className={`min-w-0 max-w-full overflow-hidden ${sanitizeCssClass(inner.advanced?.cssClass) ?? ""}`.trim()}
      style={{
        ...sectionWrapperStyle(inner),
        ...backgroundLayerStyle(inner.background),
        ...borderStyle(inner.border),
        paddingTop: `${INNER_SECTION_SAFE_AREA_PX}px`,
        paddingBottom: `${INNER_SECTION_SAFE_AREA_PX}px`,
      }}
    >
      {/* Boxed/full toggle applies here too - inner sections cap their columns
          row exactly like top-level sections, so widget widths follow layout. */}
      <div
        data-search-overflow={searchOverflowAttr(hostsSearch)}
        style={sectionContainerStyle(inner)}
      >
        <div
          data-columns-row
          data-search-overflow={searchOverflowAttr(hostsSearch)}
          className="min-w-0 max-w-full overflow-hidden"
          style={columnsRowStyle(inner, colsSum)}
        >
          {columns.map((c) => (
            <div
              key={c.id}
              data-column-slot
              data-search-overflow={searchOverflowAttr(childHostsSearchWidget(c, searchScope))}
              className="min-w-0 max-w-full overflow-hidden"
              style={{ gridColumn: `span ${resolveSpan(c.span, layoutDevice, 6)}` }}
            >
              <BuilderImageSlotContext.Provider
                value={columnImageSlot(inner, c, columns, parentSlot)}
              >
                <RenderColumn column={c} lang={lang} device={device} />
              </BuilderImageSlotContext.Provider>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

RenderInner.displayName = "RenderInner";

const RenderColumn = memo(function RenderColumn({
  column,
  lang,
  device,
}: {
  column: ColumnNode;
  lang: "pl" | "en";
  device: Device;
}) {
  const va = column.verticalAlign ?? "start";
  const accessCtx = useAccessContext();
  const inlineEdit = useInlineWidgetEdit();
  const chromeReserve = useContext(ChromeReserveContext);

  const visibleChildren = useMemo(
    () =>
      (Array.isArray(column.children) ? column.children : []).filter(
        (w): w is NonNullable<typeof w> => !!w && isRenderedWidget(w, device, accessCtx),
      ),
    [column.children, device, accessCtx],
  );
  const isToolbar =
    visibleChildren.length > 1 &&
    visibleChildren.every((w) => COMPACT_WIDGET_TYPES.has(w.type) || AUTO_SIZE_WIDGETS.has(w.type));
  const axisClass = isToolbar
    ? column.contentAlign === "center"
      ? "justify-center"
      : column.contentAlign === "end"
        ? "justify-end"
        : column.contentAlign === "start"
          ? "justify-start"
          : "justify-between"
    : column.contentAlign === "center"
      ? "items-center"
      : column.contentAlign === "end"
        ? "items-end"
        : column.contentAlign === "start"
          ? "items-start"
          : "items-stretch";
  const vClass = isToolbar
    ? va === "center"
      ? "content-center items-center"
      : va === "end"
        ? "content-end items-end"
        : va === "stretch"
          ? "content-stretch items-stretch"
          : "content-start items-center"
    : va === "center"
      ? "justify-center"
      : va === "end"
        ? "justify-end"
        : va === "stretch"
          ? "justify-stretch"
          : "justify-start";

  // Group consecutive widgets sharing inline flow into one row.
  const groups = useMemo(() => {
    const result: Array<{ inline: boolean; items: typeof visibleChildren }> = [];
    if (isToolbar) {
      result.push({ inline: true, items: visibleChildren });
    } else {
      for (const w of visibleChildren) {
        const inline = w.advanced?.layout === "inline";
        const last = result[result.length - 1];
        if (inline && last && last.inline) last.items.push(w);
        else result.push({ inline, items: [w] });
      }
    }
    return result;
  }, [visibleChildren, isToolbar]);
  const onlyOneBlock =
    !isToolbar && groups.length === 1 && !groups[0].inline && groups[0].items.length === 1;

  const handleWidgetContentChange = useCallback(
    (widgetId: string, key: string, value: string | number) => {
      inlineEdit?.(widgetId, key, value);
    },
    [inlineEdit],
  );
  const onContentChange = inlineEdit ? handleWidgetContentChange : undefined;

  return (
    <div
      data-col-id={column.id}
      className={`flex flex-col gap-2 min-w-0 max-w-full overflow-visible ${axisClass} ${vClass} ${sanitizeCssClass(column.advanced?.cssClass) ?? ""}`.trim()}
      style={{
        padding: `${COLUMN_SAFE_AREA_PX}px`,
        boxSizing: "border-box",
        // Powłoka: kolumna nigdy nie jest niższa niż rezerwa szkieletu, więc
        // pusta granica Suspense leniwego widgetu nie zapada nagłówka.
        minHeight:
          column.style?.minHeight ??
          (chromeReserve ? estimateChromeColumnHeight(column, device) : undefined),
        background: column.style?.bgColor,
        color: column.style?.textColor,
        borderRadius: column.style?.borderRadius,
      }}
    >
      {groups.map((g, gi) => {
        if (g.inline) {
          return (
            <div
              key={gi}
              // PASEK NARZĘDZI POWŁOKI TO JEDEN RZĄD - I MA NIM ZOSTAĆ.
              //
              // `isToolbar` scala CAŁĄ kolumnę kompaktowych widgetów w jeden
              // wiersz, a rezerwa szkieletu nagłówka liczy go dokładnie tak
              // samo (`estimateChromeColumnHeight`: wysokość = najwyższy
              // widget, nie suma). Przy `flex-wrap` ta obietnica zależała od
              // SZEROKOŚCI TEKSTU: ten sam nagłówek mieścił się w jednej linii
              // lokalnie (fallback `local("Arial")` + `size-adjust`), a na
              // runnerze CI - gdzie ten fallback nie ma czym się rozwiązać i
              // tekst mierzy szerszym krojem - przeskakiwał do dwóch linii.
              // Wiersz rósł wtedy z 30 na 66 px, nagłówek za nim, a całe
              // `<main>` zjeżdżało w dół (CLS 0,1348 w „first visit pl, cold").
              // Nie zawijamy więc paska powłoki: przy ciasnej kolumnie widgety
              // ścieśniają się (`min-w-0` z ramki widgetu), a nadmiar przycina
              // kontener sekcji - wysokość zostaje STAŁA przy każdym kroju.
              //
              // DLACZEGO WARUNEK `chromeReserve`, A NIE SAM `isToolbar`.
              // Brak zawijania kupujemy PRZYCIĘCIEM nadmiaru (`data-column-slot`
              // / kontener sekcji), więc płacimy nim tylko tam, gdzie coś za to
              // dostajemy: powłoka ma zarezerwowaną wysokość wiersza i pasek
              // jest w niej jednym rzędem Z DEFINICJI. Treść redakcyjna rezerwy
              // NIE MA - jej kolumna ma prawo urosnąć, a przycięcie odbierałoby
              // czytelnikowi etykiety i kontrolki. Na wąskiej stronie CMS
              // kolumna kilku kompaktowych widgetów (np. paru przycisków) była
              // wciskana w jeden rząd i wychodziła poza krawędź - recenzja
              // PR #383. Poza powłoką zawijamy więc tak jak przed rezerwą CLS.
              //
              // Grupy inline ZADEKLAROWANE przez autora (`advanced.layout`)
              // zachowują zawijanie zawsze - tam wiersz jest treścią, nie paskiem.
              className={`flex flex-row ${isToolbar && chromeReserve ? "flex-nowrap" : "flex-wrap"} items-center gap-2 min-w-0 max-w-full ${axisClass}`}
            >
              {g.items.map((w) => (
                <BuilderWidgetNode
                  key={w.id}
                  widget={w}
                  lang={lang}
                  device={device}
                  inRow
                  onlyOneBlock={false}
                  onContentChange={onContentChange}
                />
              ))}
            </div>
          );
        }
        return (
          <Fragment key={gi}>
            {g.items.map((w) => (
              <BuilderWidgetNode
                key={w.id}
                widget={w}
                lang={lang}
                device={device}
                inRow={false}
                onlyOneBlock={onlyOneBlock}
                onContentChange={onContentChange}
              />
            ))}
          </Fragment>
        );
      })}
    </div>
  );
});

RenderColumn.displayName = "RenderColumn";
