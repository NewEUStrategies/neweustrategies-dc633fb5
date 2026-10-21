// Wstawianie kroków i działania na kroku (S8, SPEC §6.3 „Interakcje”):
// przycisk „+” na krawędzi (28 px), paleta kroków, „Połącz z krokiem…”,
// menu kroku (`⋯` / Shift+F10), potwierdzenie usunięcia poddrzewa i region
// `aria-live` z wynikiem operacji - wspólne dla kanwy i listy kroków.
//
// JEDNO ŹRÓDŁO MENU. Pozycje menu to `availableOps` (S8.1), a każda operacja
// kończy się w `applyOp`/`mergeInto` przez `runJourneyEditRequest` - kanwa,
// lista i klawiatura nie mają własnych reguł, więc nie mogą się rozjechać
// (parytet przypinają testy kanwy i listy). Paleta pokazuje grupy SPEC
// (`journeyPalette`: Czas, Komunikacja, Logika, CRM, Newsletter, Zakończenie)
// z opisem skutku, a pozycję, której nie da się wstawić w tym miejscu
// (krok końcowy w środku przepływu, mail przy windykacji), zostawia widoczną,
// wyłączoną i z powodem - sprawdzoną próbnym wykonaniem, nie zgadywaną.
//
// KOMPONENTY KONTROLOWANE. Graf trzyma sesja edytora (`JourneyEditor`):
// kanwa i lista składają żądanie (`JourneyEditRequest`) i oddają je
// `onApplyOp`, który wykonuje je na bieżącym szkicu (zwykle
// `runJourneyEditRequest` + zapis w historii) i ZWRACA wynik - dopiero
// z wyniku wiadomo, który krok dostaje fokus i co ogłosić czytnikowi.
//
// JEDEN POPOVER NA WIDOK. Paleta i menu otwierają się w jednym `Popover`
// zakotwiczonym (`PopoverAnchor` z `virtualRef`) przy elemencie, który go
// wywołał: przycisku „+”, przycisku „⋯”, karcie albo wierszu listy. Sześćdziesiąt
// kroków nie oznacza więc sześćdziesięciu korzeni Radix, a skrót klawiatury
// (Insert na karcie) otwiera paletę przy „+” tej samej gałęzi, którą kliknąłby
// użytkownik myszy.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { JourneyLayoutInsert } from "@/lib/admin/journeys/layout";
import {
  applyOp,
  availableOps,
  defaultParams,
  duplicateTargets,
  JOURNEY_OP_LABEL_KEY,
  mergeInto,
  mergeTargets,
  opForShortcut,
  ownedSubtree,
  type JourneyOpDescriptor,
  type JourneyOpError,
  type JourneyOpInput,
  type JourneyOpResult,
  type JourneyOpsContext,
  type JourneySlotRef,
} from "@/lib/admin/journeys/ops";
import {
  journeyPalette,
  matchesSearch,
  type JourneyPaletteItem,
  type JourneyTranslate,
} from "@/lib/admin/journeys/summaries";
import { compareStepNumbers } from "@/lib/admin/journeys/viewModel";
import { ensureI18n } from "@/lib/i18n-admin-journeys-canvas";
import type { JourneyGraph, JourneySettings } from "@/lib/journeys/graph";
import { journeyLabelKey } from "@/lib/journeys/labels";
import type { JourneyEdgeBranch, JourneyNodeType } from "@/lib/journeys/nodeTypes";
import { cn } from "@/lib/utils";
import { journeyNodeIcon, type JourneyStepTexts } from "./JourneyNodeCard";

// ── Żądania edycji (kontrakt z sesją edytora) ────────────────────────────────

/**
 * Operacja zlecona przez kanwę albo listę. `label` to nazwa operacji
 * w języku panelu - trafia do historii (`useHistory`: „Cofnięto: …”) i do
 * ogłoszenia `aria-live`.
 */
export type JourneyEditRequest =
  | {
      kind: "insert";
      from: string;
      branch: JourneyEdgeBranch;
      type: JourneyNodeType;
      params: unknown;
      label: string;
    }
  | { kind: "merge"; from: string; branch: JourneyEdgeBranch; targetId: string; label: string }
  | {
      kind: "op";
      nodeId: string;
      op: JourneyOpDescriptor;
      input?: JourneyOpInput;
      label: string;
    };

/** Wykonanie żądania na bieżącym szkicu - edytor zwraca wynik operacji. */
export type JourneyApplyOp = (request: JourneyEditRequest) => JourneyOpResult;

function insertDescriptor(branch: JourneyEdgeBranch): JourneyOpDescriptor {
  return {
    kind: "insert",
    label: "insert",
    labelKey: JOURNEY_OP_LABEL_KEY.insert,
    branch,
    needs: "type",
  };
}

/**
 * Wykonuje żądanie na grafie - czysto, bez stanu. Wstawienie i pozycje menu
 * idą przez `applyOp` (to samo wejście co skróty klawiatury); „Połącz
 * z krokiem…” na brakującej gałęzi nie ma kroku, na którym `applyOp` mógłby
 * działać, więc woła `mergeInto` z adresem gałęzi.
 */
export function runJourneyEditRequest(
  graph: JourneyGraph,
  request: JourneyEditRequest,
  context: JourneyOpsContext = {},
): JourneyOpResult {
  switch (request.kind) {
    case "insert":
      return applyOp(
        graph,
        request.from,
        insertDescriptor(request.branch),
        { type: request.type, params: request.params },
        context,
      );
    case "merge":
      return mergeInto(
        graph,
        { from: request.from, branch: request.branch },
        request.targetId,
        context,
      );
    case "op":
      return applyOp(graph, request.nodeId, request.op, request.input ?? {}, context);
  }
}

/** Kontekst operacji z ustawień szkicu (wyzwalacz decyduje o zakazie maili). */
export function journeyOpsContext(
  settings: Pick<JourneySettings, "triggerEventType"> | null | undefined,
): JourneyOpsContext {
  return settings?.triggerEventType ? { triggerEventType: settings.triggerEventType } : {};
}

/** Napis pozycji menu - ten sam w menu kanwy, listy i w teście parytetu. */
export function journeyOpLabel(t: JourneyTranslate, op: JourneyOpDescriptor): string {
  return op.branch
    ? t(op.labelKey, { branch: t(journeyLabelKey("branch", op.branch)) })
    : t(op.labelKey);
}

/** Klucze powodów odmowy operacji - jawna mapa (zakaz sklejania kluczy). */
const OP_ERROR_KEY: Readonly<Record<JourneyOpError, string>> = {
  node_missing: "adminJourneys.canvas.opError.node_missing",
  trigger_protected: "adminJourneys.canvas.opError.trigger_protected",
  terminal_protected: "adminJourneys.canvas.opError.terminal_protected",
  limit_nodes: "adminJourneys.canvas.opError.limit_nodes",
  branch_invalid: "adminJourneys.canvas.opError.branch_invalid",
  slot_occupied: "adminJourneys.canvas.opError.slot_occupied",
  not_movable: "adminJourneys.canvas.opError.not_movable",
  target_invalid: "adminJourneys.canvas.opError.target_invalid",
  not_split: "adminJourneys.canvas.opError.not_split",
  not_terminal: "adminJourneys.canvas.opError.not_terminal",
  would_break: "adminJourneys.canvas.opError.would_break",
};

/** Powód odmowy; `would_break` wymienia błędy grafu, które operacja by dołożyła. */
export function journeyOpErrorText(
  t: JourneyTranslate,
  result: Extract<JourneyOpResult, { ok: false }>,
): string {
  if (result.error === "would_break" && result.codes && result.codes.length > 0) {
    return t("adminJourneys.canvas.opError.wouldBreakIssues", {
      issues: result.codes.map((code) => t(journeyLabelKey("graphIssue", code))).join("; "),
    });
  }
  return t(OP_ERROR_KEY[result.error]);
}

/** Nazwa przycisku „+” i dialogu palety dla gałęzi kroku. */
export function journeyInsertLabel(
  t: JourneyTranslate,
  texts: JourneyStepTexts,
  slot: JourneySlotRef,
): string {
  const step = texts.steps.get(slot.from)?.ref ?? "";
  return slot.branch === "next"
    ? t("adminJourneys.canvas.insert.next", { step })
    : t("adminJourneys.canvas.insert.branch", { branch: texts.branch(slot.branch), step });
}

// ── Przycisk „+” ─────────────────────────────────────────────────────────────

export interface JourneyInsertButtonProps {
  insert: JourneyLayoutInsert;
  label: string;
  open: boolean;
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * „+” na krawędzi albo w miejscu brakującej gałęzi (28 × 28 px - cel dotyku
 * ≥ 24 px). Poza kolejnością Tab: klawiatura otwiera tę samą paletę
 * klawiszem Insert albo „+” na karcie kroku, więc kanwa zostaje jednym
 * tab stopem.
 */
export function JourneyInsertButton({ insert, label, open, onOpen }: JourneyInsertButtonProps) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-insert-key={insertKey(insert)}
      onClick={onOpen}
      className={cn(
        "absolute flex items-center justify-center rounded-[6px] border border-border bg-background text-sm leading-none text-muted-foreground shadow-sm",
        "hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        open ? "border-primary text-foreground" : undefined,
      )}
      style={{ left: insert.x, top: insert.y, width: insert.size, height: insert.size }}
    >
      <span aria-hidden="true">+</span>
    </button>
  );
}

/** Klucz miejsca wstawienia (`data-insert-key`) - krok i gałąź. */
export function insertKey(slot: JourneySlotRef): string {
  return `${slot.from}:${slot.branch}`;
}

// ── Stan działań (wspólny hook kanwy i listy) ───────────────────────────────

/** Na czym otwarto popover: menu kroku albo paleta dla gałęzi. */
export type JourneyActionTarget =
  | { kind: "node"; nodeId: string }
  | { kind: "slot"; slot: JourneySlotRef };

export interface JourneyOpenAction {
  key: string;
  target: JourneyActionTarget;
}

function actionKey(target: JourneyActionTarget): string {
  return target.kind === "node" ? `menu:${target.nodeId}` : `insert:${insertKey(target.slot)}`;
}

export interface JourneyActionsInput {
  graph: JourneyGraph;
  context: JourneyOpsContext;
  texts: JourneyStepTexts;
  readOnly: boolean;
  onApplyOp?: JourneyApplyOp;
  /** Komunikat edytora (np. „Cofnięto: …”) do regionu `aria-live`. */
  announcement?: string | null;
  /** Każdy komunikat widoku (operacja, odmowa, powiększenie, przejście). */
  onAnnounce?: (message: string) => void;
  /** Krok, który po udanej operacji dostaje fokus (`focusId` z wyniku). */
  onFocusNode: (nodeId: string) => void;
  /** Fokus wraca na element kanwy albo listy po zamknięciu popovera. */
  restoreFocus: () => void;
}

export interface JourneyActions {
  live: string;
  announce: (message: string) => void;
  apply: (request: JourneyEditRequest) => JourneyOpResult | null;
  action: JourneyOpenAction | null;
  anchorRef: RefObject<HTMLElement | null>;
  /** Otwiera popover przy `anchor`; ten sam cel drugi raz - zamyka (przełącznik). */
  openAction: (target: JourneyActionTarget, anchor: HTMLElement | null) => void;
  closeAction: () => void;
  confirm: ConfirmState | null;
  dismissConfirm: () => void;
  /** Usunięcie z menu albo klawiszem Delete - z potwierdzeniem przy poddrzewie. */
  requestOp: (nodeId: string, op: JourneyOpDescriptor) => void;
  /** Skrót klawiatury kroku (`Insert` - paleta, `Delete` - usunięcie). */
  runShortcut: (
    nodeId: string,
    shortcut: "Insert" | "Delete",
    anchorFor: (slot: JourneySlotRef) => HTMLElement | null,
  ) => void;
  restoreFocus: () => void;
  input: JourneyActionsInput;
}

export function useJourneyActions(input: JourneyActionsInput): JourneyActions {
  ensureI18n();
  const { t } = useTranslation();
  const { graph, context, texts, readOnly, onApplyOp, announcement, onFocusNode } = input;
  const [live, setLive] = useState("");
  const [action, setAction] = useState<JourneyOpenAction | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const onAnnounceRef = useRef(input.onAnnounce);
  onAnnounceRef.current = input.onAnnounce;
  const restoreRef = useRef(input.restoreFocus);
  restoreRef.current = input.restoreFocus;

  // Komunikat edytora (cofnij/ponów, autozapis) - ten sam region co operacje,
  // żeby czytnik nie dostawał dwóch konkurujących regionów `aria-live`.
  useEffect(() => {
    if (announcement) setLive(announcement);
  }, [announcement]);

  const announce = useCallback((message: string) => {
    setLive(message);
    onAnnounceRef.current?.(message);
  }, []);

  const apply = useCallback(
    (request: JourneyEditRequest): JourneyOpResult | null => {
      if (readOnly || !onApplyOp) return null;
      const result = onApplyOp(request);
      if (result.ok) {
        announce(t("adminJourneys.canvas.live.applied", { label: request.label }));
        if (result.focusId !== null) onFocusNode(result.focusId);
      } else {
        announce(
          t("adminJourneys.canvas.live.refused", {
            label: request.label,
            reason: journeyOpErrorText(t, result),
          }),
        );
      }
      return result;
    },
    [announce, onApplyOp, onFocusNode, readOnly, t],
  );

  const openAction = useCallback(
    (target: JourneyActionTarget, anchor: HTMLElement | null) => {
      if (readOnly) return;
      const key = actionKey(target);
      anchorRef.current = anchor;
      setAction((current) => (current?.key === key ? null : { key, target }));
    },
    [readOnly],
  );

  const closeAction = useCallback(() => setAction(null), []);

  const requestOp = useCallback(
    (nodeId: string, op: JourneyOpDescriptor) => {
      const label = journeyOpLabel(t, op);
      if (!op.confirm) {
        apply({ kind: "op", nodeId, op, label });
        return;
      }
      // Kroki „należące” do usuwanego (osiągalne tylko przez niego) znikną
      // razem z nim - liczba w pytaniu mówi, ile pracy kosztuje kliknięcie.
      const further = Math.max(0, ownedSubtree(graph, nodeId).size - 1);
      setConfirm({
        title: t("adminJourneys.canvas.confirm.title", {
          step: texts.steps.get(nodeId)?.ref ?? "",
        }),
        description: t("adminJourneys.canvas.confirm.description", { count: further }),
        confirmLabel: label,
        destructive: true,
        onConfirm: () => {
          apply({ kind: "op", nodeId, op, label });
        },
      });
    },
    [apply, graph, t, texts],
  );

  const runShortcut = useCallback(
    (
      nodeId: string,
      shortcut: "Insert" | "Delete",
      anchorFor: (slot: JourneySlotRef) => HTMLElement | null,
    ) => {
      if (readOnly) {
        announce(t("adminJourneys.canvas.live.readOnly"));
        return;
      }
      const op = opForShortcut(availableOps(graph, nodeId, context), shortcut);
      if (!op) {
        announce(
          t(
            shortcut === "Insert"
              ? "adminJourneys.canvas.live.noInsert"
              : "adminJourneys.canvas.live.noDelete",
            { step: texts.steps.get(nodeId)?.ref ?? "" },
          ),
        );
        return;
      }
      if (shortcut === "Delete") {
        requestOp(nodeId, op);
        return;
      }
      const slot = { from: nodeId, branch: op.branch ?? "next" };
      openAction({ kind: "slot", slot }, anchorFor(slot));
    },
    [announce, context, graph, openAction, readOnly, requestOp, t, texts],
  );

  const restoreFocus = useCallback(() => restoreRef.current(), []);

  return {
    live,
    announce,
    apply,
    action,
    anchorRef,
    openAction,
    closeAction,
    confirm,
    dismissConfirm: () => setConfirm(null),
    requestOp,
    runShortcut,
    restoreFocus,
    input,
  };
}

// ── Warstwa: popover działań, potwierdzenie, region aria-live ────────────────

export function JourneyActionLayer({ actions }: { actions: JourneyActions }) {
  ensureI18n();
  const { t } = useTranslation();
  const { action } = actions;
  const { texts } = actions.input;
  const label =
    action === null
      ? ""
      : action.target.kind === "node"
        ? (texts.steps.get(action.target.nodeId)?.menuLabel ?? "")
        : journeyInsertLabel(t, texts, action.target.slot);

  return (
    <>
      <Popover
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) actions.closeAction();
        }}
      >
        <PopoverAnchor virtualRef={actions.anchorRef} />
        {action === null ? null : (
          <PopoverContent
            key={action.key}
            align="start"
            aria-label={label}
            data-testid="journey-action-popover"
            className="w-80 p-2"
            // Fokus ustawia panel (pierwsza pozycja menu albo pole szukania).
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              actions.restoreFocus();
            }}
            onInteractOutside={(event) => {
              // Klik w ten sam „+”/„⋯” zamyka popover jego własnym onClick
              // (przełącznik) - bez tego zamknąłby go `pointerdown`, a klik
              // otworzyłby ponownie.
              const anchor = actions.anchorRef.current;
              if (anchor && event.target instanceof Node && anchor.contains(event.target)) {
                event.preventDefault();
              }
            }}
          >
            <JourneyActionPanel actions={actions} target={action.target} />
          </PopoverContent>
        )}
      </Popover>
      <ConfirmDialog
        state={actions.confirm}
        onOpenChange={(open) => {
          if (!open) actions.dismissConfirm();
        }}
      />
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="journey-live">
        {actions.live}
      </div>
    </>
  );
}

// ── Panel działań: menu, paleta, wybór kroku i miejsca ──────────────────────

type PanelView =
  | { mode: "menu"; nodeId: string }
  | { mode: "palette"; slot: JourneySlotRef }
  | { mode: "merge"; slot: JourneySlotRef; via?: { nodeId: string; op: JourneyOpDescriptor } }
  | { mode: "slots"; nodeId: string; op: JourneyOpDescriptor };

/** Strzałki, Home i End po pozycjach panelu (wzorzec menu WAI-ARIA). */
function onItemsKeyDown(event: KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const target = event.target as HTMLElement;
  // Pole szukania: tylko ↓ przenosi do listy, reszta klawiszy edytuje tekst.
  if (target.tagName === "INPUT" && event.key !== "ArrowDown") return;
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>("[data-action-item]"),
  );
  if (items.length === 0) return;
  event.preventDefault();
  const index = items.indexOf(target);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? Math.min(items.length - 1, index + 1)
          : Math.max(0, index - 1);
  items[next]?.focus();
}

function JourneyActionPanel({
  actions,
  target,
}: {
  actions: JourneyActions;
  target: JourneyActionTarget;
}) {
  const { t } = useTranslation();
  const [stack, setStack] = useState<PanelView[]>(() => [
    target.kind === "node"
      ? { mode: "menu", nodeId: target.nodeId }
      : { mode: "palette", slot: target.slot },
  ]);
  const view = stack[stack.length - 1];
  const rootRef = useRef<HTMLDivElement>(null);
  const push = (next: PanelView) => setStack((current) => [...current, next]);
  const back = () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));

  // Fokus na pierwszy element bieżącego widoku panelu (pole szukania palety
  // albo pierwsza pozycja menu) - po otwarciu i po każdym przejściu.
  useEffect(() => {
    const root = rootRef.current;
    const first =
      root?.querySelector<HTMLElement>("[data-action-autofocus]") ??
      root?.querySelector<HTMLElement>("[data-action-item]");
    first?.focus();
  }, [stack.length]);

  const done = (request: JourneyEditRequest) => {
    actions.closeAction();
    actions.apply(request);
  };

  return (
    <div ref={rootRef} onKeyDown={onItemsKeyDown} className="flex flex-col gap-2">
      {stack.length > 1 ? (
        <button
          type="button"
          onClick={back}
          className="self-start rounded-[6px] px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("adminJourneys.canvas.palette.back")}
        </button>
      ) : null}
      {view.mode === "menu" ? (
        <StepMenu
          actions={actions}
          nodeId={view.nodeId}
          onPick={(op) => {
            if (op.needs === "type" && op.branch) {
              push({ mode: "palette", slot: { from: view.nodeId, branch: op.branch } });
            } else if (op.needs === "target") {
              const incoming = actions.input.graph.edges.find((edge) => edge.to === view.nodeId);
              if (incoming) {
                push({
                  mode: "merge",
                  slot: { from: incoming.from, branch: incoming.branch },
                  via: { nodeId: view.nodeId, op },
                });
              }
            } else if (op.needs === "slot") {
              push({ mode: "slots", nodeId: view.nodeId, op });
            } else {
              actions.closeAction();
              actions.requestOp(view.nodeId, op);
            }
          }}
        />
      ) : null}
      {view.mode === "palette" ? (
        <StepPalette
          actions={actions}
          slot={view.slot}
          onInsert={done}
          onMerge={() => push({ mode: "merge", slot: view.slot })}
        />
      ) : null}
      {view.mode === "merge" ? (
        <MergePicker
          actions={actions}
          slot={view.slot}
          onPick={(targetId, number) => {
            const label = t("adminJourneys.canvas.request.merge", { number });
            done(
              view.via
                ? { kind: "op", ...view.via, input: { targetId }, label }
                : { kind: "merge", ...view.slot, targetId, label },
            );
          }}
        />
      ) : null}
      {view.mode === "slots" ? (
        <SlotPicker
          actions={actions}
          nodeId={view.nodeId}
          onPick={(slot) =>
            done({
              kind: "op",
              nodeId: view.nodeId,
              op: view.op,
              input: { slot },
              label: journeyOpLabel(t, view.op),
            })
          }
        />
      ) : null}
    </div>
  );
}

const ITEM =
  "flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function StepMenu({
  actions,
  nodeId,
  onPick,
}: {
  actions: JourneyActions;
  nodeId: string;
  onPick: (op: JourneyOpDescriptor) => void;
}) {
  const { t } = useTranslation();
  const { graph, context, texts } = actions.input;
  const ops = useMemo(() => availableOps(graph, nodeId, context), [graph, nodeId, context]);
  if (ops.length === 0) {
    return <p className="m-0 px-2 py-1.5 text-sm text-muted-foreground">{t("adminJourneys.canvas.menu.empty")}</p>;
  }
  return (
    <div role="menu" aria-label={texts.steps.get(nodeId)?.menuLabel} className="flex flex-col">
      {ops.map((op, index) => (
        <button
          key={`${op.label}:${op.branch ?? ""}:${op.value ?? ""}`}
          type="button"
          role="menuitem"
          tabIndex={-1}
          data-action-item
          data-op={op.label}
          aria-keyshortcuts={op.shortcut}
          {...(index === 0 ? { "data-action-autofocus": true } : {})}
          onClick={() => onPick(op)}
          className={cn(ITEM, op.destructive ? "text-destructive" : undefined)}
        >
          <span className="min-w-0 flex-1">{journeyOpLabel(t, op)}</span>
          {op.shortcut ? (
            <kbd aria-hidden="true" className="text-[11px] text-muted-foreground">
              {op.shortcut}
            </kbd>
          ) : null}
        </button>
      ))}
    </div>
  );
}

interface PaletteEntry {
  item: JourneyPaletteItem;
  label: string;
  effect: string;
  request: JourneyEditRequest;
  /** Powód niedostępności w tym miejscu albo `null`. */
  reason: string | null;
}

function StepPalette({
  actions,
  slot,
  onInsert,
  onMerge,
}: {
  actions: JourneyActions;
  slot: JourneySlotRef;
  onInsert: (request: JourneyEditRequest) => void;
  onMerge: () => void;
}) {
  const { t } = useTranslation();
  const { graph, context } = actions.input;
  const [query, setQuery] = useState("");
  const searchId = `journey-palette-search-${insertKey(slot)}`;

  const groups = useMemo(() => {
    // Teksty domyślne nowych kroków w języku panelu (tytuł zadania, treść
    // powiadomienia, tag) - paleta S8.1 ma parametry bez tłumaczeń.
    const text = {
      taskTitle: t("adminJourneys.canvas.defaults.taskTitle"),
      staffMessage: t("adminJourneys.canvas.defaults.staffMessage"),
      tag: t("adminJourneys.canvas.defaults.tag"),
    };
    const localized = new Set<JourneyNodeType>([
      "create_crm_task",
      "notify_staff",
      "add_tag",
      "remove_tag",
    ]);
    return journeyPalette(context).map((group) => ({
      id: group.group,
      label: t(group.labelKey),
      entries: group.items.map((item): PaletteEntry => {
        const label = t(item.labelKey);
        const params = localized.has(item.type) ? defaultParams(item.type, text) : item.params;
        const request: JourneyEditRequest = {
          kind: "insert",
          ...slot,
          type: item.type,
          params,
          label: t("adminJourneys.canvas.request.insert", { step: label }),
        };
        // Próba na sucho: paleta nie proponuje kroku, który operacja odrzuci.
        let reason: string | null = item.disabledReasonKey ? t(item.disabledReasonKey) : null;
        if (reason === null) {
          const result = runJourneyEditRequest(graph, request, context);
          if (!result.ok) reason = journeyOpErrorText(t, result);
        }
        return { item, label, effect: t(item.effectKey), request, reason };
      }),
    }));
  }, [context, graph, slot, t]);

  const targets = useMemo(() => mergeTargets(graph, slot), [graph, slot]);
  const visible = groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter((entry) =>
        matchesSearch(query, entry.label, entry.effect, group.label),
      ),
    }))
    .filter((group) => group.entries.length > 0);

  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor={searchId} className="text-xs font-medium text-muted-foreground">
          {t("adminJourneys.canvas.palette.search")}
        </label>
        <Input
          id={searchId}
          type="search"
          value={query}
          autoComplete="off"
          placeholder={t("adminJourneys.canvas.palette.searchPlaceholder")}
          data-action-autofocus
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto" data-testid="journey-palette">
        {visible.length === 0 ? (
          <p className="m-0 px-2 py-1.5 text-sm text-muted-foreground">
            {t("adminJourneys.canvas.palette.empty", { query })}
          </p>
        ) : null}
        {visible.map((group) => {
          const groupId = `${searchId}-${group.id}`;
          return (
            <div key={group.id} role="group" aria-labelledby={groupId} className="flex flex-col">
              <p id={groupId} className="m-0 px-2 text-xs font-medium text-muted-foreground">
                {group.label}
              </p>
              {group.entries.map((entry) => {
                const Icon = journeyNodeIcon(entry.item.type, entry.item.params);
                const base = `${groupId}-${entry.item.id}`;
                return (
                  <button
                    key={entry.item.id}
                    type="button"
                    data-action-item
                    data-palette-item={entry.item.id}
                    aria-labelledby={`${base}-label`}
                    aria-describedby={
                      entry.reason === null ? `${base}-effect` : `${base}-effect ${base}-reason`
                    }
                    aria-disabled={entry.reason === null ? undefined : true}
                    onClick={() => {
                      if (entry.reason === null) onInsert(entry.request);
                    }}
                    className={cn(
                      ITEM,
                      "items-start",
                      entry.reason === null ? undefined : "cursor-not-allowed opacity-60",
                    )}
                  >
                    <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col">
                      <span id={`${base}-label`} className="font-medium">
                        {entry.label}
                      </span>
                      <span id={`${base}-effect`} className="text-xs text-muted-foreground">
                        {entry.effect}
                      </span>
                      {entry.reason === null ? null : (
                        <span id={`${base}-reason`} className="text-xs text-muted-foreground">
                          {entry.reason}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {targets.length > 0 ? (
        <button
          type="button"
          data-action-item
          data-merge-into
          aria-describedby={`${searchId}-merge-hint`}
          onClick={onMerge}
          className={cn(ITEM, "border-t border-border")}
        >
          <span className="min-w-0 flex-1">{t(JOURNEY_OP_LABEL_KEY.mergeInto)}</span>
          <span id={`${searchId}-merge-hint`} className="sr-only">
            {t("adminJourneys.canvas.palette.mergeHint")}
          </span>
        </button>
      ) : null}
    </>
  );
}

function MergePicker({
  actions,
  slot,
  onPick,
}: {
  actions: JourneyActions;
  slot: JourneySlotRef;
  onPick: (targetId: string, number: string) => void;
}) {
  const { t } = useTranslation();
  const { graph, texts } = actions.input;
  const targets = useMemo(
    () =>
      mergeTargets(graph, slot)
        .map((id) => ({ id, text: texts.steps.get(id) }))
        .sort((a, b) => compareStepNumbers(a.text?.number ?? "", b.text?.number ?? "")),
    [graph, slot, texts],
  );
  const hintId = `journey-merge-hint-${insertKey(slot)}`;
  return (
    <>
      <p id={hintId} className="m-0 px-2 text-xs text-muted-foreground">
        {t("adminJourneys.canvas.palette.mergeHint")}
      </p>
      {targets.length === 0 ? (
        <p className="m-0 px-2 py-1.5 text-sm text-muted-foreground">
          {t("adminJourneys.canvas.palette.mergeEmpty")}
        </p>
      ) : (
        <div
          role="menu"
          aria-label={t(JOURNEY_OP_LABEL_KEY.mergeInto)}
          aria-describedby={hintId}
          className="flex max-h-72 flex-col overflow-y-auto"
        >
          {targets.map(({ id, text }, index) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-action-item
              data-merge-target={id}
              {...(index === 0 ? { "data-action-autofocus": true } : {})}
              onClick={() => onPick(id, text?.number ?? "")}
              className={ITEM}
            >
              {t("adminJourneys.canvas.palette.mergeTarget", {
                number: text?.number ?? "",
                summary: text?.summary ?? "",
              })}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function SlotPicker({
  actions,
  nodeId,
  onPick,
}: {
  actions: JourneyActions;
  nodeId: string;
  onPick: (slot: JourneySlotRef) => void;
}) {
  const { t } = useTranslation();
  const { graph, context, texts } = actions.input;
  const slots = useMemo(
    () =>
      duplicateTargets(graph, nodeId, context).sort((a, b) =>
        compareStepNumbers(texts.steps.get(a.from)?.number ?? "", texts.steps.get(b.from)?.number ?? ""),
      ),
    [context, graph, nodeId, texts],
  );
  if (slots.length === 0) {
    return (
      <p className="m-0 px-2 py-1.5 text-sm text-muted-foreground">
        {t("adminJourneys.canvas.slots.empty")}
      </p>
    );
  }
  return (
    <div role="menu" aria-label={t("adminJourneys.canvas.slots.title")} className="flex max-h-72 flex-col overflow-y-auto">
      {slots.map((slot, index) => {
        const step = texts.steps.get(slot.from)?.ref ?? "";
        return (
          <button
            key={insertKey(slot)}
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-action-item
            data-slot={insertKey(slot)}
            {...(index === 0 ? { "data-action-autofocus": true } : {})}
            onClick={() => onPick(slot)}
            className={ITEM}
          >
            {slot.branch === "next"
              ? t("adminJourneys.canvas.slots.after", { step })
              : t("adminJourneys.canvas.slots.branch", { branch: texts.branch(slot.branch), step })}
          </button>
        );
      })}
    </div>
  );
}
