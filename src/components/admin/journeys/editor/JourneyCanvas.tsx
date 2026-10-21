// Kanwa ścieżki (S8, SPEC §6.3 „Render”, „Interakcje”, „A11y”).
//
// BEZ BIBLIOTEKI GRAFU I BEZ POMIARU DOM. Pozycje kart, krawędzi, chipów
// scaleń i przycisków „+” liczy `layoutJourney` (S8.1) z modelu widoku
// `buildJourneyView`; kanwa tylko je rysuje: jeden `<svg aria-hidden>`
// z krawędziami (`JourneyEdge`) pod warstwą HTML (karty, etykiety gałęzi,
// chipy, „+”, nakładka statystyk S8.2). Wszystko leży w jednym układzie
// współrzędnych przeskalowanym `transform: scale(z)`, więc zoom (50-150 %)
// nie przelicza niczego, a nakładka statystyk trafia w karty bez wiedzy
// o powiększeniu.
//
// PRZEWIJANIE = ZWYKŁY `overflow-auto`, nie `ScrollArea`: natywny pasek,
// kółko, gest i klawiatura przeglądarki działają bez skryptu, a rozmiar
// przewijanej treści to rozmiar układu × z (element-rozpórka), bo `transform`
// nie zmienia wymiarów w przepływie dokumentu.
//
// JEDEN TAB STOP (roving tabindex jak `SeatMapCanvas.tsx`): w kolejności Tab
// jest wyłącznie bieżący element fokusu (karta albo chip scalenia), reszta ma
// `tabIndex=-1`. Ruch po kanwie, polecenia i ich klawisze to `nav.ts` (S8.1)
// - ta sama definicja co lista kroków. Przyciski „+” i „⋯” są dla myszy
// i dotyku (28 px), a klawiatura dostaje TE SAME działania skrótami (Insert,
// Delete, Shift+F10) - przeciąganie nie jest potrzebne do niczego.
//
// KONTROLOWANA. Szkic, historię i autozapis trzyma sesja edytora: kanwa
// dostaje graf, widok i układ, fokus/zoom (kontrolowane albo własne) i oddaje
// żądania (`onApplyOp` - zwraca wynik operacji), otwarcie panelu kroku
// (`onOpenStep`), cofnij/ponów (`onUndo`/`onRedo`, Ctrl/Cmd+Z i Shift+Z)
// oraz Esc (`onEscape`).
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import { NODE_H, NODE_W, type JourneyLayout } from "@/lib/admin/journeys/layout";
import {
  activateFocus,
  focusItems,
  focusKey,
  journeyKeyCommand,
  moveFocus,
  type JourneyFocus,
} from "@/lib/admin/journeys/nav";
import type { JourneySlotRef } from "@/lib/admin/journeys/ops";
import type { JourneyView } from "@/lib/admin/journeys/viewModel";
import { chartLangFrom } from "@/lib/charts/format";
import { formatNumber } from "@/lib/i18n/format";
import { ensureI18n } from "@/lib/i18n-admin-journeys-canvas";
import type { JourneyStatsDto } from "@/lib/journeys/dto";
import type { JourneyGraph, JourneySettings } from "@/lib/journeys/graph";
import { cn } from "@/lib/utils";
import { JourneyBranchLabel, JourneyEdge } from "./JourneyEdge";
import {
  insertKey,
  JourneyActionLayer,
  JourneyInsertButton,
  journeyInsertLabel,
  journeyOpsContext,
  useJourneyActions,
  type JourneyApplyOp,
} from "./JourneyInsertButton";
import {
  JourneyMergeChipButton,
  JourneyNodeCard,
  useJourneyRovingFocus,
  useJourneyStepTexts,
} from "./JourneyNodeCard";
import { JourneyStatsOverlay } from "./JourneyStatsOverlay";

// ── Powiększenie ─────────────────────────────────────────────────────────────

/** Zakres i krok powiększenia (SPEC §6.3: 50-150 %). */
export const JOURNEY_ZOOM = { min: 0.5, max: 1.5, step: 0.1 } as const;

/** Margines treści kanwy (px w układzie) - karty nie dotykają krawędzi ramki. */
export const JOURNEY_CANVAS_PADDING = 24;

export function clampJourneyZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.round(Math.min(JOURNEY_ZOOM.max, Math.max(JOURNEY_ZOOM.min, zoom)) * 100) / 100;
}

/**
 * Krok powiększenia po siatce 10 %: z „dopasuj” (np. 73 %) ↑ daje 80 %, ↓ 70 %,
 * a nie 83 % i 63 % - wartości z przycisków i klawiszy są zawsze okrągłe.
 */
export function stepJourneyZoom(zoom: number, direction: 1 | -1): number {
  const grid = Math.round(zoom * 1000) / 100;
  const next = direction > 0 ? Math.floor(grid + 1e-6) + 1 : Math.ceil(grid - 1e-6) - 1;
  return clampJourneyZoom(next * JOURNEY_ZOOM.step);
}

/** „Dopasuj”: największe powiększenie, przy którym cały układ mieści się w oknie. */
export function fitJourneyZoom(
  layout: Pick<JourneyLayout, "width" | "height">,
  viewport: { width: number; height: number },
): number {
  const width = layout.width + JOURNEY_CANVAS_PADDING * 2;
  const height = layout.height + JOURNEY_CANVAS_PADDING * 2;
  if (viewport.width <= 0 || viewport.height <= 0 || width <= 0 || height <= 0) return 1;
  return clampJourneyZoom(Math.min(viewport.width / width, viewport.height / height));
}

// ── Kanwa ────────────────────────────────────────────────────────────────────

export interface JourneyCanvasProps {
  /** Graf szkicu (albo wersji w podglądzie) - wejście operacji. */
  graph: JourneyGraph;
  /** `buildJourneyView(graph)` - ten sam widok dostaje lista kroków. */
  view: JourneyView;
  /** `layoutJourney(view)`. */
  layout: JourneyLayout;
  /** Ustawienia szkicu: opis wyzwalacza i kontekst operacji (zakaz maili). */
  settings?: Pick<JourneySettings, "triggerEventType" | "triggerCondition"> | null;
  /** Tematy maili (wariant A) w języku panelu - `journeySubjects` (S8.2). */
  subjects?: ReadonlyMap<string, string> | null;
  /** Statystyki okna (`journeyStatsQueryOptions`) dla nakładki i nazw kart. */
  stats?: JourneyStatsDto | null;
  /** `?stats=off` - bez nakładki i bez liczb w nazwach kart. */
  statsHidden?: boolean;
  /** Szablon ścieżki - wpisy rejestru S6 dla oceny CTOR w nakładce. */
  templateKey?: string | null;
  /** Fokus kanwy (kontrolowany); bez propsa kanwa trzyma go sama. */
  focus?: JourneyFocus | null;
  onFocusChange?: (focus: JourneyFocus) => void;
  /** Krok otwarty w panelu (`?node=`). */
  selectedNodeId?: string | null;
  /** Ścieżka symulacji (`JourneySimulateDialog.onHighlightPath`). */
  highlightedPath?: readonly string[] | null;
  /** Powiększenie (kontrolowane); bez propsa kanwa trzyma je sama. */
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  /** Przyciski powiększenia w ramce kanwy (pasek edytora może mieć własne). */
  showZoomControls?: boolean;
  /** Podgląd wersji / szkic archiwalny: bez „+”, menu i skrótów edycji. */
  readOnly?: boolean;
  /** Nazwa obszaru kanwy dla czytnika (np. z nazwą ścieżki). */
  label?: string;
  onApplyOp?: JourneyApplyOp;
  /** Enter albo klik na karcie - panel kroku. */
  onOpenStep?: (nodeId: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onEscape?: () => void;
  /** Komunikat edytora do regionu `aria-live` (cofnij/ponów). */
  announcement?: string | null;
  onAnnounce?: (message: string) => void;
  className?: string;
}

export function JourneyCanvas({
  graph,
  view,
  layout,
  settings = null,
  subjects = null,
  stats = null,
  statsHidden = false,
  templateKey = null,
  focus: focusProp,
  onFocusChange,
  selectedNodeId = null,
  highlightedPath = null,
  zoom: zoomProp,
  onZoomChange,
  showZoomControls = true,
  readOnly = false,
  label,
  onApplyOp,
  onOpenStep,
  onUndo,
  onRedo,
  onEscape,
  announcement = null,
  onAnnounce,
  className,
}: JourneyCanvasProps) {
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const instructionsId = useId();

  const statsVisible = Boolean(stats) && !statsHidden;
  const texts = useJourneyStepTexts({
    view,
    settings,
    subjects,
    stats: statsVisible ? stats : null,
    lang,
  });
  const context = useMemo(() => journeyOpsContext(settings), [settings]);

  // ── Fokus (roving tabindex) ──
  const { tabStop, tabStopKey, setFocus, restoreFocus, reducedMotion } = useJourneyRovingFocus({
    view,
    focus: focusProp,
    onFocusChange,
    containerRef: itemsRef,
  });

  const actions = useJourneyActions({
    graph,
    context,
    texts,
    readOnly,
    onApplyOp,
    announcement,
    onAnnounce,
    onFocusNode: (nodeId) => setFocus({ kind: "node", id: nodeId }, true),
    restoreFocus,
  });

  // ── Powiększenie ──
  const [ownZoom, setOwnZoom] = useState(1);
  const zoom = clampJourneyZoom(zoomProp ?? ownZoom);
  const changeZoom = useCallback(
    (next: number) => {
      const value = clampJourneyZoom(next);
      if (zoomProp === undefined) setOwnZoom(value);
      onZoomChange?.(value);
      actions.announce(
        t("adminJourneys.canvas.live.zoom", { value: formatNumber(Math.round(value * 100), lang) }),
      );
    },
    [actions, lang, onZoomChange, t, zoomProp],
  );
  const fit = useCallback(() => {
    const element = scrollRef.current;
    changeZoom(
      fitJourneyZoom(layout, {
        width: element?.clientWidth ?? 0,
        height: element?.clientHeight ?? 0,
      }),
    );
  }, [changeZoom, layout]);

  // ── Ścieżka symulacji ──
  const highlighted = useMemo(() => new Set(highlightedPath ?? []), [highlightedPath]);
  const highlightedEdges = useMemo(() => {
    const pairs = new Set<string>();
    const path = highlightedPath ?? [];
    for (let i = 1; i < path.length; i += 1) pairs.add(`${path[i - 1]}>${path[i]}`);
    return pairs;
  }, [highlightedPath]);

  const layoutById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );
  const chipByKey = useMemo(
    () => new Map(layout.chips.map((chip) => [`merge:${chip.from}:${chip.branch}`, chip])),
    [layout.chips],
  );
  const order = useMemo(() => focusItems(view), [view]);

  const insertAnchor = useCallback(
    (slot: JourneySlotRef) =>
      itemsRef.current?.parentElement?.querySelector<HTMLElement>(
        `[data-insert-key="${insertKey(slot)}"]`,
      ) ?? null,
    [],
  );

  const jumpTo = useCallback(
    (nodeId: string) => {
      setFocus({ kind: "node", id: nodeId }, true);
      const step = texts.steps.get(nodeId);
      if (step) actions.announce(t("adminJourneys.canvas.live.jump", { label: step.label }));
    },
    [actions, setFocus, t, texts],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Klawisze z palety i menu (portal Radix bąbelkuje drzewem Reacta) nie
    // należą do kanwy - tylko element z kluczem fokusu.
    if (!target.dataset.focusKey || tabStop === null) return;
    const command = journeyKeyCommand(event);
    if (command === null) return;
    const current = tabStop;
    switch (command.type) {
      case "move":
        setFocus(moveFocus(view, current, command.direction, "canvas"), true);
        break;
      case "activate": {
        const activation = activateFocus(current);
        if (activation.type === "openPanel") onOpenStep?.(activation.nodeId);
        else if (activation.focus.kind === "node") jumpTo(activation.focus.id);
        break;
      }
      case "palette":
        if (current.kind !== "node") return;
        actions.runShortcut(current.id, "Insert", insertAnchor);
        break;
      case "delete":
        if (current.kind !== "node") return;
        actions.runShortcut(current.id, "Delete", insertAnchor);
        break;
      case "menu":
        if (current.kind !== "node" || readOnly) return;
        actions.openAction({ kind: "node", nodeId: current.id }, target);
        break;
      case "undo":
        if (!onUndo) return;
        onUndo();
        break;
      case "redo":
        if (!onRedo) return;
        onRedo();
        break;
      case "zoomIn":
        changeZoom(stepJourneyZoom(zoom, 1));
        break;
      case "zoomOut":
        changeZoom(stepJourneyZoom(zoom, -1));
        break;
      case "zoomReset":
        changeZoom(1);
        break;
      case "escape":
        if (!onEscape) return;
        onEscape();
        break;
    }
    event.preventDefault();
  };

  const pad = JOURNEY_CANVAS_PADDING;
  const contentWidth = Math.max(layout.width, NODE_W) + pad * 2;
  const contentHeight = Math.max(layout.height, NODE_H) + pad * 2;
  const zoomLabel = t("adminJourneys.canvas.zoom.value", {
    value: formatNumber(Math.round(zoom * 100), lang),
  });

  return (
    <section
      aria-label={label ?? t("adminJourneys.canvas.label")}
      data-testid="journey-canvas"
      data-tour="journey-canvas"
      className={cn("flex flex-col gap-2", className)}
    >
      {showZoomControls ? (
        <div
          role="toolbar"
          aria-label={t("adminJourneys.canvas.zoom.toolbar")}
          className="flex items-center justify-end gap-1"
        >
          <ZoomButton
            label={t("adminJourneys.canvas.zoom.out")}
            disabled={zoom <= JOURNEY_ZOOM.min}
            onClick={() => changeZoom(stepJourneyZoom(zoom, -1))}
          >
            <ZoomOut aria-hidden="true" className="h-4 w-4" />
          </ZoomButton>
          <button
            type="button"
            onClick={() => changeZoom(1)}
            aria-label={t("adminJourneys.canvas.zoom.reset", { value: zoomLabel })}
            className="h-7 min-w-14 rounded-[6px] px-2 text-xs tabular-nums text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {zoomLabel}
          </button>
          <ZoomButton
            label={t("adminJourneys.canvas.zoom.in")}
            disabled={zoom >= JOURNEY_ZOOM.max}
            onClick={() => changeZoom(stepJourneyZoom(zoom, 1))}
          >
            <ZoomIn aria-hidden="true" className="h-4 w-4" />
          </ZoomButton>
          <ZoomButton label={t("adminJourneys.canvas.zoom.fit")} onClick={fit}>
            <Maximize2 aria-hidden="true" className="h-4 w-4" />
          </ZoomButton>
        </div>
      ) : null}
      <p id={instructionsId} className="sr-only">
        {readOnly
          ? t("adminJourneys.canvas.instructionsReadOnly")
          : t("adminJourneys.canvas.instructions")}
      </p>
      <div
        ref={scrollRef}
        data-testid="journey-canvas-viewport"
        className="relative max-h-[70vh] min-h-64 overflow-auto rounded-[6px] border border-border bg-muted/30"
      >
        {view.order.length === 0 ? (
          <p className="m-0 p-6 text-sm text-muted-foreground">{t("adminJourneys.canvas.empty")}</p>
        ) : (
          <div
            className="relative mx-auto"
            style={{ width: contentWidth * zoom, height: contentHeight * zoom }}
          >
            <div
              data-testid="journey-canvas-content"
              className={cn(
                "absolute left-0 top-0 origin-top-left",
                reducedMotion ? undefined : "transition-transform duration-150",
              )}
              style={{
                width: contentWidth,
                height: contentHeight,
                transform: `scale(${zoom})`,
              }}
            >
              <div
                className="absolute"
                style={{ left: pad, top: pad, width: layout.width, height: layout.height }}
              >
                <svg
                  aria-hidden="true"
                  focusable="false"
                  className="pointer-events-none absolute left-0 top-0 overflow-visible text-border"
                  width={layout.width}
                  height={layout.height}
                  viewBox={`0 0 ${layout.width} ${layout.height}`}
                >
                  {layout.edges.map((edge) => (
                    <JourneyEdge
                      key={`${edge.from}:${edge.branch}`}
                      edge={edge}
                      highlighted={
                        edge.to !== null && highlightedEdges.has(`${edge.from}>${edge.to}`)
                      }
                    />
                  ))}
                </svg>
                {layout.edges.map((edge) => (
                  <JourneyBranchLabel
                    key={`label:${edge.from}:${edge.branch}`}
                    edge={edge}
                    text={texts.branch(edge.branch)}
                  />
                ))}
                <div
                  ref={itemsRef}
                  role="group"
                  aria-label={t("adminJourneys.canvas.steps")}
                  aria-describedby={instructionsId}
                  onKeyDown={onKeyDown}
                >
                  {order.map((item) => {
                    const key = focusKey(item);
                    if (item.kind === "merge") {
                      const chip = chipByKey.get(key);
                      if (!chip) return null;
                      return (
                        <JourneyMergeChipButton
                          key={key}
                          chip={chip}
                          text={texts.merge(chip.to)}
                          focusKey={key}
                          tabStop={key === tabStopKey}
                          onActivate={() => jumpTo(chip.to)}
                          onFocus={(event) => {
                            if (event.target === event.currentTarget && key !== tabStopKey) {
                              setFocus(item, false);
                            }
                          }}
                        />
                      );
                    }
                    const node = view.nodes.get(item.id);
                    const position = layoutById.get(item.id);
                    const text = texts.steps.get(item.id);
                    if (!node || !position || !text) return null;
                    const menuOpen = actions.action?.key === `menu:${item.id}`;
                    return (
                      <JourneyNodeCard
                        key={key}
                        node={position}
                        type={node.type}
                        params={node.params}
                        text={text}
                        focusKey={key}
                        tabStop={key === tabStopKey}
                        selected={selectedNodeId === item.id}
                        highlighted={highlighted.has(item.id)}
                        reachable={node.reachable}
                        statsVisible={statsVisible}
                        readOnly={readOnly}
                        menuOpen={menuOpen}
                        onActivate={() => {
                          setFocus(item, false);
                          onOpenStep?.(item.id);
                        }}
                        onFocus={(event) => {
                          if (event.target === event.currentTarget && key !== tabStopKey) {
                            setFocus(item, false);
                          }
                        }}
                        onMenu={(event) => {
                          setFocus(item, false);
                          actions.openAction({ kind: "node", nodeId: item.id }, event.currentTarget);
                        }}
                      />
                    );
                  })}
                </div>
                {readOnly
                  ? null
                  : layout.inserts.map((insert) => (
                      <JourneyInsertButton
                        key={insertKey(insert)}
                        insert={insert}
                        label={journeyInsertLabel(t, texts, insert)}
                        open={actions.action?.key === `insert:${insertKey(insert)}`}
                        onOpen={(event) =>
                          actions.openAction(
                            { kind: "slot", slot: { from: insert.from, branch: insert.branch } },
                            event.currentTarget,
                          )
                        }
                      />
                    ))}
                {statsVisible ? (
                  <JourneyStatsOverlay
                    stats={stats}
                    layout={layout}
                    templateKey={templateKey}
                    lang={lang}
                    onSelectNode={(nodeId) => {
                      setFocus({ kind: "node", id: nodeId }, true);
                      onOpenStep?.(nodeId);
                    }}
                  />
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
      <JourneyActionLayer actions={actions} />
    </section>
  );
}

function ZoomButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      {children}
    </button>
  );
}
