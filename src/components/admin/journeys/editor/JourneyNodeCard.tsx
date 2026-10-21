// Karta kroku kanwy, chip scalenia i teksty kroków wspólne dla kanwy i listy
// (S8, SPEC §6.3 „Render” i „A11y”).
//
// JEDNA NAZWA KROKU DLA OBU WIDOKÓW. Czytnik ekranu słyszy krok jako
// „Krok 3 z 7: Wyślij e-mail „Dokończ zamówienie”, 380 wysłanych” - na
// kanwie (nazwa przycisku karty) i na liście (nazwa `treeitem`) to ten sam
// napis z `useJourneyStepTexts`. Numer jest hierarchiczny (`viewModel.ts`:
// „4.2.1”), „z 7” to liczba kroków w przepływie, a opis kroku składa
// `describeNode` (S8.1) - kanwa, lista, panel i lista problemów mówią o kroku
// tym samym zdaniem. Liczby kroku (statystyki okna) też trafiają do nazwy,
// bo nakładka chipów (`JourneyStatsOverlay`, S8.2) jest `aria-hidden`.
//
// KARTA = ABSOLUTNY HTML STAŁEGO ROZMIARU. Pozycję i rozmiar (280 × 88) daje
// `layoutJourney`; karta niczego nie mierzy, więc układ nie skacze po
// wczytaniu fontów, a geometria jest identyczna w obu motywach (różnią się
// tylko tokeny kolorów). Gdy statystyki są włączone, opis kroku mieści się
// w jednym wierszu - dolny pas karty zajmuje nakładka chipów.
//
// PRZYCISK KARTY I PRZYCISK MENU SĄ RODZEŃSTWEM. Przycisk w przycisku jest
// niepoprawny (i axe go odrzuca), więc „⋯” leży obok przycisku karty, w tym
// samym pudełku. Oba poza kolejnością Tab (`tabIndex=-1` dla „⋯”): kanwa ma
// JEDEN tab stop (roving tabindex), a menu z klawiatury otwiera Shift+F10.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type Ref,
  type RefObject,
} from "react";
import {
  Bell,
  FlaskConical,
  Flag,
  GitBranch,
  ListChecks,
  LogOut,
  Mail,
  Route,
  Tag,
  Timer,
  TrendingUp,
  UserMinus,
  UserPlus,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { JourneyLayoutChip, JourneyLayoutNode } from "@/lib/admin/journeys/layout";
import { focusExists, focusKey, initialFocus, type JourneyFocus } from "@/lib/admin/journeys/nav";
import { journeyNodeStatsSummary } from "@/lib/admin/journeys/results";
import { describeNode, translateSummary } from "@/lib/admin/journeys/summaries";
import type { JourneyView } from "@/lib/admin/journeys/viewModel";
import type { ChartLang } from "@/lib/charts/format";
import { formatNumber } from "@/lib/i18n/format";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n } from "@/lib/i18n-admin-journeys-canvas";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n as ensureResultsI18n } from "@/lib/i18n-admin-journeys-results";
import type { JourneyStatsDto } from "@/lib/journeys/dto";
import type { JourneySettings } from "@/lib/journeys/graph";
import { journeyLabelKey } from "@/lib/journeys/labels";
import type { JourneyEdgeBranch, JourneyNodeType } from "@/lib/journeys/nodeTypes";
import { cn } from "@/lib/utils";

// ── Ikony kroków (lista SPEC §6.8) ───────────────────────────────────────────

const NODE_ICON: Readonly<Record<JourneyNodeType, LucideIcon>> = {
  trigger: Zap,
  wait: Timer,
  send_email: Mail,
  ab_split: FlaskConical,
  if_else: GitBranch,
  set_lifecycle_stage: TrendingUp,
  set_crm_stage: Workflow,
  create_crm_task: ListChecks,
  add_tag: Tag,
  remove_tag: Tag,
  newsletter_list: UserPlus,
  notify_staff: Bell,
  goal: Flag,
  exit: LogOut,
};

/** Ikona kroku; lista newslettera ma osobną ikonę dla wypisania. */
export function journeyNodeIcon(type: JourneyNodeType, params?: unknown): LucideIcon {
  if (type === "newsletter_list" && (params as { op?: unknown } | null)?.op === "remove") {
    return UserMinus;
  }
  return NODE_ICON[type];
}

/** Ikona chipu scalenia („→ dalej jak w kroku …”). */
export const JourneyMergeIcon = Route;

// ── Teksty kroków (wspólne dla kanwy i listy) ───────────────────────────────

/** Klucze tekstów kroku - jawna lista (czytelnik każdego klucza). */
const K = {
  label: "adminJourneys.canvas.step.label",
  labelBranch: "adminJourneys.canvas.step.labelBranch",
  labelDetached: "adminJourneys.canvas.step.labelDetached",
  labelStats: "adminJourneys.canvas.step.labelStats",
  labelOpenNext: "adminJourneys.canvas.step.labelOpenNext",
  labelOpenBranches: "adminJourneys.canvas.step.labelOpenBranches",
  ref: "adminJourneys.canvas.step.ref",
  refDetached: "adminJourneys.canvas.step.refDetached",
  detached: "adminJourneys.canvas.step.detached",
  menu: "adminJourneys.canvas.step.menu",
  chip: "adminJourneys.canvas.merge.chip",
  chipDetached: "adminJourneys.canvas.merge.chipDetached",
  chipLabel: "adminJourneys.canvas.merge.label",
  chipLabelDetached: "adminJourneys.canvas.merge.labelDetached",
} as const;

export interface JourneyStepText {
  /** Numer hierarchiczny („4.2.1”); pusty = krok poza przepływem. */
  number: string;
  /** Krok w zdaniu („kroku 4.2”, „kroku poza przepływem”) - nazwy przycisków. */
  ref: string;
  /** Nazwa typu („Wyślij e-mail”). */
  typeLabel: string;
  /** Opis kroku (`describeNode`). */
  summary: string;
  /** Liczby kroku z okna statystyk („380 wysłanych”) albo `null`. */
  stats: string | null;
  /** Pełna nazwa dla czytnika (karta kanwy i `treeitem` listy). */
  label: string;
  /** Nazwa przycisku „⋯” i dialogu menu kroku. */
  menuLabel: string;
}

export interface JourneyMergeText {
  /** Widoczny napis chipu („dalej jak w kroku 4.2”). */
  text: string;
  /** Nazwa dla czytnika (z opisem kroku docelowego). */
  label: string;
}

export interface JourneyStepTexts {
  steps: ReadonlyMap<string, JourneyStepText>;
  /** Nazwa gałęzi w języku panelu. */
  branch: (branch: JourneyEdgeBranch) => string;
  /** Teksty chipu scalenia do kroku `to`. */
  merge: (to: string) => JourneyMergeText;
}

export interface JourneyStepTextsInput {
  view: JourneyView;
  /** Ustawienia szkicu - opis wyzwalacza („Start: gdy …”). */
  settings?: Pick<JourneySettings, "triggerEventType" | "triggerCondition"> | null;
  /** Tematy maili (wariant A) w języku panelu - `journeySubjects` (S8.2). */
  subjects?: ReadonlyMap<string, string> | null;
  /** Statystyki okna; `null` = brak albo `?stats=off`. */
  stats?: JourneyStatsDto | null;
  lang: ChartLang;
}

export function useJourneyStepTexts({
  view,
  settings = null,
  subjects = null,
  stats = null,
  lang,
}: JourneyStepTextsInput): JourneyStepTexts {
  ensureJourneysI18n();
  ensureListI18n();
  ensureResultsI18n();
  ensureI18n();
  const { t } = useTranslation();

  return useMemo(() => {
    const total = view.numbering.size;
    const branch = (code: JourneyEdgeBranch) => t(journeyLabelKey("branch", code));
    const statsById = new Map((stats?.nodes ?? []).map((node) => [node.nodeId, node]));
    const format = (value: number) => formatNumber(value, lang);

    const steps = new Map<string, JourneyStepText>();
    for (const id of view.order) {
      const node = view.nodes.get(id);
      if (!node) continue;
      const summary = translateSummary(
        t,
        describeNode(node, { subject: subjects?.get(id) ?? null, settings }),
      );
      const statsSummary = journeyNodeStatsSummary(statsById.get(id), format);
      const statsText = statsSummary ? translateSummary(t, statsSummary) : null;
      const number = node.number;

      let label =
        number === ""
          ? t(K.labelDetached, { summary })
          : node.branch !== null && node.branch !== "next"
            ? t(K.labelBranch, { number, total, branch: branch(node.branch), summary })
            : t(K.label, { number, total, summary });
      if (statsText !== null) label = t(K.labelStats, { label, stats: statsText });
      // Brakująca gałąź jest na kanwie widoczna jako samotny „+”; czytnik
      // musi ją usłyszeć w nazwie kroku, bo „+” nie jest w kolejności Tab.
      const open = node.slots.flatMap((slot) => (slot.kind === "open" ? [slot.branch] : []));
      if (open.length === 1 && open[0] === "next") {
        label = t(K.labelOpenNext, { label });
      } else if (open.length > 0) {
        label = t(K.labelOpenBranches, {
          label,
          count: open.length,
          branches: open.map(branch).join(", "),
        });
      }

      const ref = number === "" ? t(K.refDetached) : t(K.ref, { number });
      steps.set(id, {
        number,
        ref,
        typeLabel: t(journeyLabelKey("nodeType", node.type)),
        summary,
        stats: statsText,
        label,
        menuLabel: t(K.menu, { step: ref }),
      });
    }

    const merge = (to: string): JourneyMergeText => {
      const target = steps.get(to);
      const number = target?.number ?? "";
      const summary = target?.summary ?? "";
      return number === ""
        ? { text: t(K.chipDetached), label: t(K.chipLabelDetached, { summary }) }
        : { text: t(K.chip, { number }), label: t(K.chipLabel, { number, summary }) };
    };

    return { steps, branch, merge };
  }, [t, view, settings, subjects, stats, lang]);
}

// ── Fokus (roving tabindex, wspólny dla kanwy i listy) ──────────────────────

export interface JourneyRovingFocusInput {
  view: JourneyView;
  /** Fokus kontrolowany; `undefined` - widok trzyma go sam. */
  focus: JourneyFocus | null | undefined;
  onFocusChange?: (focus: JourneyFocus) => void;
  /** Kontener elementów z `data-focus-key`. */
  containerRef: RefObject<HTMLElement | null>;
}

export interface JourneyRovingFocus {
  /** Element w kolejności Tab: bieżący fokus albo (gdy zniknął) wyzwalacz. */
  tabStop: JourneyFocus | null;
  tabStopKey: string | null;
  /** `moveDom` - przenieś też fokus przeglądarki (klawisz, operacja, chip). */
  setFocus: (next: JourneyFocus | null, moveDom: boolean) => void;
  /** Fokus z powrotem na element w kolejności Tab (po zamknięciu popovera). */
  restoreFocus: () => void;
  elementFor: (key: string) => HTMLElement | null;
  reducedMotion: boolean;
}

/**
 * Jeden tab stop (wzorzec `SeatMapCanvas.tsx`): w kolejności Tab jest tylko
 * bieżący element fokusu, a fokus, który zniknął z widoku (krok usunięty,
 * cofnięcie), wraca na wyzwalacz - Tab nigdy nie gubi kanwy ani listy.
 * Fokus przeglądarki przenosimy wyłącznie po działaniu użytkownika - nie przy
 * pierwszym renderze ani przy zmianie szkicu z zewnątrz (autozapis, szyna).
 */
export function useJourneyRovingFocus({
  view,
  focus: focusProp,
  onFocusChange,
  containerRef,
}: JourneyRovingFocusInput): JourneyRovingFocus {
  const reducedMotion = usePrefersReducedMotion();
  const [ownFocus, setOwnFocus] = useState<JourneyFocus | null>(null);
  const focus = focusProp !== undefined ? focusProp : ownFocus;
  const tabStop = focus !== null && focusExists(view, focus) ? focus : initialFocus(view);
  const tabStopKey = tabStop === null ? null : focusKey(tabStop);
  const pendingDomFocus = useRef(false);

  const elementFor = useCallback(
    (key: string): HTMLElement | null => {
      const items = containerRef.current?.querySelectorAll<HTMLElement>("[data-focus-key]") ?? [];
      for (const item of items) if (item.dataset.focusKey === key) return item;
      return null;
    },
    [containerRef],
  );

  const setFocus = useCallback(
    (next: JourneyFocus | null, moveDom: boolean) => {
      if (next === null) return;
      if (moveDom) {
        // Ten sam element (koniec przepływu, powrót z popovera) - fokus od
        // razu; inny - po renderze, gdy element (np. nowy krok) już istnieje.
        if (focusKey(next) === tabStopKey) elementFor(focusKey(next))?.focus();
        else pendingDomFocus.current = true;
      }
      if (focusProp === undefined) setOwnFocus(next);
      onFocusChange?.(next);
    },
    [elementFor, focusProp, onFocusChange, tabStopKey],
  );

  useEffect(() => {
    if (!pendingDomFocus.current || focus === null || !focusExists(view, focus)) return;
    const element = elementFor(focusKey(focus));
    if (!element) return;
    pendingDomFocus.current = false;
    element.focus({ preventScroll: true });
    element.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }, [elementFor, focus, reducedMotion, view]);

  const restoreFocus = useCallback(() => {
    if (pendingDomFocus.current || tabStopKey === null) return;
    elementFor(tabStopKey)?.focus({ preventScroll: true });
  }, [elementFor, tabStopKey]);

  return { tabStop, tabStopKey, setFocus, restoreFocus, elementFor, reducedMotion };
}

// ── Karta kroku ──────────────────────────────────────────────────────────────

export interface JourneyNodeCardProps {
  node: JourneyLayoutNode;
  type: JourneyNodeType;
  params: unknown;
  text: JourneyStepText;
  /** Klucz fokusu (`focusKey`) - `data-focus-key`. */
  focusKey: string;
  /** Jedyny element kanwy w kolejności Tab. */
  tabStop: boolean;
  /** Krok otwarty w panelu (`?node=`). */
  selected?: boolean;
  /** Krok na podświetlonej ścieżce symulacji. */
  highlighted?: boolean;
  /** Krok osiągalny z wyzwalacza. */
  reachable?: boolean;
  /** Nakładka statystyk zajmuje dolny pas karty. */
  statsVisible?: boolean;
  /** Bez menu „⋯” (podgląd wersji, szkic archiwalny). */
  readOnly?: boolean;
  /** Element przycisku „⋯” - kotwica menu kroku. */
  menuButtonRef?: Ref<HTMLButtonElement>;
  menuOpen?: boolean;
  onActivate: (event: MouseEvent<HTMLButtonElement>) => void;
  onFocus: (event: FocusEvent<HTMLButtonElement>) => void;
  onMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
}

export function JourneyNodeCard({
  node,
  type,
  params,
  text,
  focusKey,
  tabStop,
  selected = false,
  highlighted = false,
  reachable = true,
  statsVisible = false,
  readOnly = false,
  menuButtonRef,
  menuOpen = false,
  onActivate,
  onFocus,
  onMenu,
}: JourneyNodeCardProps) {
  ensureI18n();
  const { t } = useTranslation();
  const Icon = journeyNodeIcon(type, params);
  const withMenu = !readOnly && onMenu !== undefined;
  return (
    <div
      className="absolute"
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      data-node-id={node.id}
      data-node-type={type}
    >
      <button
        type="button"
        data-focus-key={focusKey}
        tabIndex={tabStop ? 0 : -1}
        aria-label={text.label}
        aria-current={selected ? "true" : undefined}
        aria-haspopup="dialog"
        data-highlighted={highlighted ? "true" : undefined}
        onClick={onActivate}
        onFocus={onFocus}
        className={cn(
          "flex h-full w-full flex-col items-start gap-1 overflow-hidden rounded-[6px] border bg-card p-2 text-left text-card-foreground shadow-sm",
          "transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected || highlighted ? "border-primary" : "border-border",
          selected ? "ring-1 ring-primary" : undefined,
          highlighted ? "bg-primary/5" : undefined,
          reachable ? undefined : "border-dashed",
        )}
      >
        <span
          className={cn("flex w-full min-w-0 items-center gap-1.5 text-xs", withMenu && "pr-7")}
        >
          <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          {text.number === "" ? null : (
            <span className="shrink-0 font-semibold tabular-nums">{text.number}</span>
          )}
          <span className="truncate text-muted-foreground">{text.typeLabel}</span>
        </span>
        <span
          className={cn(
            "w-full text-sm leading-5",
            statsVisible || !reachable ? "line-clamp-1" : "line-clamp-2",
          )}
        >
          {text.summary}
        </span>
        {reachable ? null : (
          <span className="text-[11px] text-muted-foreground">{t(K.detached)}</span>
        )}
      </button>
      {withMenu ? (
        <button
          ref={menuButtonRef}
          type="button"
          tabIndex={-1}
          aria-label={text.menuLabel}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          data-menu-for={node.id}
          onClick={onMenu}
          className={cn(
            "absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-[6px] text-muted-foreground",
            "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <span aria-hidden="true">⋯</span>
        </button>
      ) : null}
    </div>
  );
}

// ── Chip scalenia ────────────────────────────────────────────────────────────

export interface JourneyMergeChipButtonProps {
  chip: JourneyLayoutChip;
  text: JourneyMergeText;
  focusKey: string;
  tabStop: boolean;
  onActivate: (event: MouseEvent<HTMLButtonElement>) => void;
  onFocus: (event: FocusEvent<HTMLButtonElement>) => void;
}

/**
 * „→ dalej jak w kroku 4.2” - krok docelowy stoi pod swoim pierwszym rodzicem,
 * a tu jest odnośnik. Element fokusu jak karta: Enter (i klik) przenosi fokus
 * do kroku docelowego, zamiast otwierać panel.
 */
export function JourneyMergeChipButton({
  chip,
  text,
  focusKey,
  tabStop,
  onActivate,
  onFocus,
}: JourneyMergeChipButtonProps) {
  return (
    <button
      type="button"
      data-focus-key={focusKey}
      tabIndex={tabStop ? 0 : -1}
      aria-label={text.label}
      data-merge-from={chip.from}
      data-merge-to={chip.to}
      onClick={onActivate}
      onFocus={onFocus}
      className={cn(
        "absolute flex items-center gap-1.5 overflow-hidden rounded-[6px] border border-dashed border-border bg-background px-2 text-xs text-muted-foreground",
        "hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      style={{ left: chip.x, top: chip.y, width: chip.width, height: chip.height }}
    >
      <JourneyMergeIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="truncate">{text.text}</span>
    </button>
  );
}
