// Lista kroków ścieżki (S8, SPEC §6.3 „A11y” - widok Lista).
//
// TEN SAM MODEL CO KANWA. Lista czyta ten sam widok (`buildJourneyView`), te
// same numery, nazwy kroków (`useJourneyStepTexts`), menu (`availableOps`
// przez `JourneyActionLayer`) i klawisze (`nav.ts`, tryb `outline`) - różni
// się tylko rysunkiem. Kolejność elementów to `focusItems` (pre-order: krok,
// potem jego gałęzie po kolei, chip scalenia w miejscu swojej gałęzi), więc
// „Lista = te same węzły i kolejność co kanwa” wynika z konstrukcji, a test
// tylko to przypina.
//
// DRZEWO WAI-ARIA. `role="tree"`, krok = `treeitem` z `aria-level`
// (głębokość w drzewie widoku + 1), `aria-setsize`/`aria-posinset` (pozycja
// wśród wyjść rodzica: dzieci i chipów) i `aria-expanded` (krok z dalszymi
// krokami; drzewo nie zwija się - każdy krok jest widoczny). Gałęzie
// rozgałęzienia to `role="group"` z nazwą („Gałąź „Tak””), dalszy ciąg
// odcinka - grupa bez nazwy i bez wcięcia, żeby długi przepływ nie uciekał
// w prawo. ← idzie do rodzica, → do pierwszego dalszego kroku (nav.ts).
//
// JEDEN TAB STOP jak na kanwie: `tabIndex=0` ma tylko bieżący element,
// przycisk „⋯” jest poza kolejnością Tab (klawiatura: Shift+F10).
//
// Domyślny wybór widoku (Lista < 768 px i przy `prefers-reduced-motion`)
// należy do paska edytora - ten komponent tylko rysuje listę.
import {
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useTranslation } from "react-i18next";

import {
  activateFocus,
  focusItems,
  focusKey,
  journeyKeyCommand,
  moveFocus,
  type JourneyFocus,
} from "@/lib/admin/journeys/nav";
import type { JourneySlotRef } from "@/lib/admin/journeys/ops";
import type { JourneyView, JourneyViewSlot } from "@/lib/admin/journeys/viewModel";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n } from "@/lib/i18n-admin-journeys-canvas";
import type { JourneyStatsDto } from "@/lib/journeys/dto";
import type { JourneyGraph, JourneySettings } from "@/lib/journeys/graph";
import type { JourneyEdgeBranch } from "@/lib/journeys/nodeTypes";
import { cn } from "@/lib/utils";
import {
  JourneyActionLayer,
  journeyOpsContext,
  useJourneyActions,
  type JourneyActions,
  type JourneyApplyOp,
} from "./JourneyInsertButton";
import {
  journeyNodeIcon,
  JourneyMergeIcon,
  useJourneyRovingFocus,
  useJourneyStepTexts,
  type JourneyStepTexts,
} from "./JourneyNodeCard";

export interface JourneyOutlineProps {
  /** Graf szkicu (albo wersji w podglądzie) - wejście operacji. */
  graph: JourneyGraph;
  /** `buildJourneyView(graph)` - ten sam widok co kanwa. */
  view: JourneyView;
  settings?: Pick<JourneySettings, "triggerEventType" | "triggerCondition"> | null;
  subjects?: ReadonlyMap<string, string> | null;
  /** Statystyki okna - liczby kroku w wierszu i w nazwie (jak na kanwie). */
  stats?: JourneyStatsDto | null;
  statsHidden?: boolean;
  focus?: JourneyFocus | null;
  onFocusChange?: (focus: JourneyFocus) => void;
  selectedNodeId?: string | null;
  highlightedPath?: readonly string[] | null;
  readOnly?: boolean;
  label?: string;
  onApplyOp?: JourneyApplyOp;
  onOpenStep?: (nodeId: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onEscape?: () => void;
  announcement?: string | null;
  onAnnounce?: (message: string) => void;
  className?: string;
}

interface OutlineContext {
  view: JourneyView;
  texts: JourneyStepTexts;
  actions: JourneyActions;
  tabStopKey: string | null;
  focusedKey: string | null;
  selectedNodeId: string | null;
  highlighted: ReadonlySet<string>;
  readOnly: boolean;
  setFocus: (next: JourneyFocus, moveDom: boolean) => void;
  onOpenStep?: (nodeId: string) => void;
  jumpTo: (nodeId: string) => void;
  onItemFocus: (event: FocusEvent<HTMLLIElement>, focus: JourneyFocus) => void;
}

export function JourneyOutline({
  graph,
  view,
  settings = null,
  subjects = null,
  stats = null,
  statsHidden = false,
  focus: focusProp,
  onFocusChange,
  selectedNodeId = null,
  highlightedPath = null,
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
}: JourneyOutlineProps) {
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const treeRef = useRef<HTMLUListElement>(null);
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
  const highlighted = useMemo(() => new Set(highlightedPath ?? []), [highlightedPath]);
  const order = useMemo(() => focusItems(view), [view]);
  // Pierścień fokusu rysuje wiersz, nie `treeitem` - element drzewa obejmuje
  // całe poddrzewo, więc jego własny obrys otoczyłby pół listy.
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const { tabStop, tabStopKey, setFocus, restoreFocus, elementFor } = useJourneyRovingFocus({
    view,
    focus: focusProp,
    onFocusChange,
    containerRef: treeRef,
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

  /** Wiersz kroku - kotwica palety i menu (element drzewa obejmuje poddrzewo). */
  const rowFor = (nodeId: string): HTMLElement | null =>
    elementFor(focusKey({ kind: "node", id: nodeId }))?.querySelector<HTMLElement>(
      "[data-outline-row]",
    ) ?? null;

  const jumpTo = (nodeId: string) => {
    setFocus({ kind: "node", id: nodeId }, true);
    const step = texts.steps.get(nodeId);
    if (step) actions.announce(t("adminJourneys.canvas.live.jump", { step: step.ref }));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const target = event.target as HTMLElement;
    if (!target.dataset.focusKey) return;
    const command = journeyKeyCommand(event);
    if (command === null) return;
    // Bieżący element = ten, który ma fokus przeglądarki (jak na kanwie).
    const current = order.find((item) => focusKey(item) === target.dataset.focusKey) ?? tabStop;
    if (current === null) return;
    switch (command.type) {
      case "move":
        setFocus(moveFocus(view, current, command.direction, "outline"), true);
        break;
      case "activate": {
        const activation = activateFocus(current);
        if (activation.type === "openPanel") onOpenStep?.(activation.nodeId);
        else if (activation.focus.kind === "node") jumpTo(activation.focus.id);
        break;
      }
      case "palette":
        if (current.kind !== "node") return;
        actions.runShortcut(current.id, "Insert", (slot: JourneySlotRef) => rowFor(slot.from));
        break;
      case "delete":
        if (current.kind !== "node") return;
        actions.runShortcut(current.id, "Delete", (slot: JourneySlotRef) => rowFor(slot.from));
        break;
      case "menu":
        if (current.kind !== "node" || readOnly) return;
        actions.openAction({ kind: "node", nodeId: current.id }, rowFor(current.id));
        break;
      case "undo":
        if (!onUndo) return;
        onUndo();
        break;
      case "redo":
        if (!onRedo) return;
        onRedo();
        break;
      case "escape":
        if (!onEscape) return;
        onEscape();
        break;
      default:
        // Powiększenie dotyczy tylko kanwy - Ctrl/Cmd +/-/0 zostaje przeglądarce.
        return;
    }
    event.preventDefault();
  };

  const roots = [...(view.root ? [view.root.id] : []), ...view.detachedRoots];
  const ctx: OutlineContext = {
    view,
    texts,
    actions,
    tabStopKey,
    focusedKey,
    selectedNodeId,
    highlighted,
    readOnly,
    setFocus,
    onOpenStep,
    jumpTo,
    onItemFocus: (event, item) => {
      // `focus` bąbelkuje do przodków - liczy się tylko element, który go dostał.
      if (event.target !== event.currentTarget) return;
      setFocusedKey(focusKey(item));
      if (focusKey(item) !== tabStopKey) setFocus(item, false);
    },
  };

  return (
    <section
      aria-label={label ?? t("adminJourneys.outline.label")}
      data-testid="journey-outline"
      className={cn("flex flex-col gap-2", className)}
    >
      <p id={instructionsId} className="sr-only">
        {readOnly
          ? t("adminJourneys.outline.instructionsReadOnly")
          : t("adminJourneys.outline.instructions")}
      </p>
      {roots.length === 0 ? (
        <p className="m-0 rounded-[6px] border border-border p-6 text-sm text-muted-foreground">
          {t("adminJourneys.canvas.empty")}
        </p>
      ) : (
        <ul
          ref={treeRef}
          role="tree"
          aria-label={t("adminJourneys.canvas.steps")}
          aria-describedby={instructionsId}
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setFocusedKey(null);
            }
          }}
          className="m-0 flex list-none flex-col rounded-[6px] border border-border p-2"
        >
          {roots.map((id, index) => (
            <OutlineNode key={id} id={id} posinset={index + 1} setsize={roots.length} ctx={ctx} />
          ))}
        </ul>
      )}
      <JourneyActionLayer actions={actions} />
    </section>
  );
}

const ROW =
  "flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1 text-sm hover:bg-accent";

/** Wyjścia kroku, które są elementami drzewa (dzieci i chipy; bez braków). */
function treeSlots(slots: readonly JourneyViewSlot[]) {
  return slots.filter(
    (slot): slot is Exclude<JourneyViewSlot, { kind: "open" }> => slot.kind !== "open",
  );
}

function OutlineNode({
  id,
  posinset,
  setsize,
  ctx,
}: {
  id: string;
  posinset: number;
  setsize: number;
  ctx: OutlineContext;
}) {
  const { t } = useTranslation();
  const node = ctx.view.nodes.get(id);
  const text = ctx.texts.steps.get(id);
  if (!node || !text) return null;
  const item: JourneyFocus = { kind: "node", id };
  const key = focusKey(item);
  const outputs = treeSlots(node.slots);
  const branching = node.slots.some((slot) => slot.branch !== "next");
  const Icon = journeyNodeIcon(node.type, node.params);
  const menuOpen = ctx.actions.action?.key === `menu:${id}`;

  const renderOutput = (slot: (typeof outputs)[number]) => {
    const position = outputs.indexOf(slot) + 1;
    return slot.kind === "child" ? (
      <OutlineNode
        key={slot.id}
        id={slot.id}
        posinset={position}
        setsize={outputs.length}
        ctx={ctx}
      />
    ) : (
      <OutlineMerge
        key={`merge:${slot.branch}`}
        from={id}
        branch={slot.branch}
        to={slot.to}
        level={node.depth + 2}
        posinset={position}
        setsize={outputs.length}
        ctx={ctx}
      />
    );
  };

  return (
    <li
      role="treeitem"
      data-focus-key={key}
      data-node-id={id}
      tabIndex={key === ctx.tabStopKey ? 0 : -1}
      aria-level={node.depth + 1}
      aria-setsize={setsize}
      aria-posinset={posinset}
      aria-expanded={outputs.length > 0 ? true : undefined}
      aria-label={text.label}
      aria-current={ctx.selectedNodeId === id ? "true" : undefined}
      onFocus={(event) => ctx.onItemFocus(event, item)}
      className="outline-none"
    >
      <div
        data-outline-row
        onClick={() => {
          ctx.setFocus(item, true);
          ctx.onOpenStep?.(id);
        }}
        className={cn(
          ROW,
          ctx.focusedKey === key ? "ring-2 ring-ring" : undefined,
          ctx.selectedNodeId === id ? "bg-accent" : undefined,
          ctx.highlighted.has(id) ? "bg-primary/5" : undefined,
        )}
      >
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        {text.number === "" ? null : (
          <span className="shrink-0 font-semibold tabular-nums">{text.number}</span>
        )}
        <span className="min-w-0 flex-1 truncate">{text.summary}</span>
        {text.stats ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{text.stats}</span>
        ) : null}
        {node.reachable ? null : (
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("adminJourneys.canvas.step.detached")}
          </span>
        )}
        {ctx.readOnly ? null : (
          <button
            type="button"
            tabIndex={-1}
            aria-label={text.menuLabel}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            data-menu-for={id}
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              ctx.setFocus(item, false);
              ctx.actions.openAction({ kind: "node", nodeId: id }, event.currentTarget);
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <span aria-hidden="true">⋯</span>
          </button>
        )}
      </div>
      {branching ? (
        node.slots.map((slot) =>
          slot.kind === "open" ? (
            <p
              key={`open:${slot.branch}`}
              aria-hidden="true"
              className="m-0 ml-4 border-l border-border py-1 pl-3 text-xs text-muted-foreground"
            >
              {t("adminJourneys.outline.openBranch", { branch: ctx.texts.branch(slot.branch) })}
            </p>
          ) : (
            <div key={`branch:${slot.branch}`} className="ml-4 border-l border-border pl-3">
              <p aria-hidden="true" className="m-0 pt-1 text-xs font-medium text-muted-foreground">
                {ctx.texts.branch(slot.branch)}
              </p>
              <ul
                role="group"
                aria-label={t("adminJourneys.outline.branch", {
                  branch: ctx.texts.branch(slot.branch),
                })}
                className="m-0 list-none p-0"
              >
                {renderOutput(slot)}
              </ul>
            </div>
          ),
        )
      ) : outputs.length > 0 ? (
        <ul role="group" className="m-0 list-none p-0">
          {outputs.map(renderOutput)}
        </ul>
      ) : null}
    </li>
  );
}

function OutlineMerge({
  from,
  branch,
  to,
  level,
  posinset,
  setsize,
  ctx,
}: {
  from: string;
  branch: JourneyEdgeBranch;
  to: string;
  level: number;
  posinset: number;
  setsize: number;
  ctx: OutlineContext;
}) {
  const item: JourneyFocus = { kind: "merge", from, branch, to };
  const key = focusKey(item);
  const text = ctx.texts.merge(to);
  return (
    <li
      role="treeitem"
      data-focus-key={key}
      data-merge-from={from}
      data-merge-to={to}
      tabIndex={key === ctx.tabStopKey ? 0 : -1}
      aria-level={level}
      aria-setsize={setsize}
      aria-posinset={posinset}
      aria-label={text.label}
      onFocus={(event) => ctx.onItemFocus(event, item)}
      className="outline-none"
    >
      <div
        data-outline-row
        onClick={() => ctx.jumpTo(to)}
        className={cn(
          ROW,
          "text-muted-foreground",
          ctx.focusedKey === key ? "ring-2 ring-ring" : undefined,
        )}
      >
        <JourneyMergeIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{text.text}</span>
      </div>
    </li>
  );
}
