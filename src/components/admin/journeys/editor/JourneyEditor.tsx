// Edytor ścieżki (S8, SPEC §6.3) - złożenie części wycinka: sesja szkicu
// (S8.3a), kanwa i lista kroków (S8.3b), panele kroku, wyzwalacza i ustawień
// (S8.3c), problemy, publikacja, symulacja i test na sobie (S8.3c2), wyniki
// i statystyki na kanwie (S8.2). Ładuje go leniwie `JourneyEditorRoute`.
//
// GDZIE MIESZKA STAN. W ADRESIE to, co ma przeżyć odświeżenie i link wysłany
// koledze: widok (`?view=`), otwarty krok i jego zakładka (`?node=&tab=`),
// okno statystyk (`?stats=`) i oglądana wersja (`?version=`) - zmienia je
// `onSearchChange` trasy. W SESJI (`useJourneyEditorSession`) szkic z historią,
// autozapis 2 s z CAS, konflikt i ochrona przed utratą zmian. Lokalnie
// tylko chwila pracy: powiększenie, fokus kanwy, otwarte arkusze i dialogi,
// podświetlona ścieżka symulacji.
//
// JEDEN GRAF DLA KANWY, LISTY I PANELI. Widok (`buildJourneyView`) i układ
// (`layoutJourney`) liczymy raz z pokazywanego grafu (szkic sesji albo wersja
// w podglądzie); kanwa i lista dostają ten sam widok, ten sam fokus i tę samą
// funkcję operacji, więc „Lista = te same węzły i kolejność co kanwa”, a menu
// obu to `availableOps` (parytet przypina `JourneyEditorParity.test.tsx`).
//
// OPERACJE. Kanwa i lista składają żądanie, edytor wykonuje je czysto
// (`runJourneyEditRequest` = `applyOp`/`mergeInto`) na bieżącym szkicu
// i zapisuje wynik w historii sesji z etykietą operacji. Komunikat „Wykonano:
// …” (albo powód odmowy) ogłasza widok, który operację wykonał - sesja go nie
// powtarza (`announce: false`), za to cofnięcie mówi „Cofnięto: …”.
//
// JEDEN REGION `aria-live`. Komunikaty sesji (cofnij, ponów, zmiany z innej
// karty) i paska (powiększenie) trafiają do regionu kanwy albo listy przez
// `announcement` - czytnik nie dostaje dwóch konkurujących regionów. Widok
// „Wyniki” nie ma kanwy, więc ma własny, ukryty region.
//
// KLAWIATURA (nav.ts). Kanwa i lista obsługują swoje klawisze same; tu
// dochodzi Ctrl/Cmd+Z i Ctrl/Cmd+Shift+Z z każdego miejsca edytora poza polem
// tekstowym (tam działa natywne cofanie pola) i poza arkuszem albo dialogiem
// (portale - ich klawisze należą do nich).
//
// LENIWE CZĘŚCI. Kanwa, lista, pasek i problemy jadą z edytorem; arkusze
// (krok z edytorem maila, wyzwalacz, ustawienia), dialogi publikacji
// i symulacji, panel testu i widok wyników ładują się dopiero przy pierwszym
// otwarciu - wejście do edytora nie płaci za edytor maila ani wykresy wyników
// (D-08: każdy edytor i zakładka jako leniwy chunk). Przepisy szkicu dla
// paneli (podmiana kroku, nowe ustawienia) są tu, a nie importowane z plików
// paneli: statyczny import choćby jednej funkcji wciągnąłby cały arkusz do
// chunku edytora.
//
// STANY JAKO KARTY, NIE TOASTY: brak `aal2` -> `MfaRequiredNotice`, odmowa
// roli -> `RoleGateNotice`, silnik niewdrożony, brak ścieżki, „wybierz
// wyzwalacz”, „napraw szkic”, konflikt, podgląd wersji i archiwum - pasek
// stanu z jednym działaniem. Toast zostaje dla wyniku kliknięcia (status).
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useHydrated } from "@tanstack/react-router";
import { AlertTriangle, Info, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { recallJourneyListSearch } from "@/components/admin/journeys/list/JourneyList";
import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  isMfaRequiredError,
  journeyAccessDenial,
  type JourneyCapabilities,
} from "@/lib/admin/journeys/access";
import {
  definitionFields,
  useJourneyEditorSession,
  type JourneySessionNotice,
} from "@/lib/admin/journeys/editorSession";
import { mutationErrorText, useSetJourneyStatus } from "@/lib/admin/journeys/journeyMutations";
import { journeyVersionQueryOptions } from "@/lib/admin/journeys/journeyQueries";
import { layoutJourney } from "@/lib/admin/journeys/layout";
import { focusKey, journeyKeyCommand, type JourneyFocus } from "@/lib/admin/journeys/nav";
import { journeyStatsWindow, journeySubjects } from "@/lib/admin/journeys/results";
import {
  JOURNEY_STATUS_LABEL_KEY,
  translateSummary,
  triggerSentence,
} from "@/lib/admin/journeys/summaries";
import { buildJourneyView } from "@/lib/admin/journeys/viewModel";
import { whenIdle } from "@/lib/ads/idle";
import { chartLangFrom } from "@/lib/charts/format";
import { formatDateShort, formatNumber } from "@/lib/i18n/format";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n as ensureCanvasI18n } from "@/lib/i18n-admin-journeys-canvas";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n as ensureRevenueI18n } from "@/lib/i18n-admin-revenue";
import { ensureI18n } from "@/lib/i18n-admin-journeys-editor";
import type {
  JourneyEditorSearch,
  JourneyEditorTab,
  JourneyEditorView,
} from "@/lib/journeys/editorSearch";
import type { JourneyDraft, JourneyNode, JourneySettings } from "@/lib/journeys/graph";
import { journeyKeys } from "@/lib/journeys/keys";
import { journeyStatsQueryOptions } from "@/lib/journeys/queries";
import { clampJourneyZoom, fitJourneyZoom, JourneyCanvas } from "./JourneyCanvas";
import { JourneyConflictDialog } from "./JourneyConflictDialog";
import {
  journeyOpsContext,
  runJourneyEditRequest,
  type JourneyApplyOp,
} from "./JourneyInsertButton";
import { JourneyIssuesList, useJourneyIssues } from "./JourneyIssuesList";
import { JourneyOutline } from "./JourneyOutline";
import { JourneyToolbar, type JourneyStatsSetting } from "./JourneyToolbar";

// Arkusze kroku i wyzwalacza otwiera prawie każda edycja (panel kroku to ok.
// 28 KB gz) - dociągamy je w bezczynności po wejściu do edytora (I9, Z-S8-09),
// żeby pierwsze kliknięcie węzła nie czekało na sieć. Dialogi (publikacja,
// symulacja, test) zostają leniwe do pierwszego otwarcia: są rzadkie,
// a prefetch wszystkiego obciążyłby pierwsze wejście.
const loadStepSheet = () => import("./JourneyStepSheet");
const loadTriggerSheet = () => import("./JourneyTriggerSheet");
const JourneyStepSheet = lazy(() => loadStepSheet().then((m) => ({ default: m.JourneyStepSheet })));
const JourneyTriggerSheet = lazy(() =>
  loadTriggerSheet().then((m) => ({ default: m.JourneyTriggerSheet })),
);
const JourneySettingsSheet = lazy(() =>
  import("./JourneySettingsSheet").then((m) => ({ default: m.JourneySettingsSheet })),
);
const JourneyPublishDialog = lazy(() =>
  import("./JourneyPublishDialog").then((m) => ({ default: m.JourneyPublishDialog })),
);
const JourneySimulateDialog = lazy(() =>
  import("./JourneySimulateDialog").then((m) => ({ default: m.JourneySimulateDialog })),
);
const JourneyTestPanel = lazy(() =>
  import("./JourneyTestPanel").then((m) => ({ default: m.JourneyTestPanel })),
);
const JourneyResults = lazy(() =>
  import("@/components/admin/journeys/results/JourneyResults").then((m) => ({
    default: m.JourneyResults,
  })),
);

/** Okno statystyk bez `?stats=` - domyślny okres zakładki Ścieżki (SPEC §2.2). */
const DEFAULT_STATS_PERIOD = "month";

type StatusChange = "paused" | "active";

/** Napisy wstrzymania i wznowienia - te same klucze co akcje listy ścieżek. */
const STATUS_CHANGE_KEY: Readonly<
  Record<StatusChange, { action: string; title: string; body: string; done: string }>
> = {
  paused: {
    action: "adminJourneys.list.actions.pause",
    title: "adminJourneys.list.confirm.pauseTitle",
    body: "adminJourneys.list.confirm.pauseBody",
    done: "adminJourneys.list.done.paused",
  },
  active: {
    action: "adminJourneys.list.actions.resume",
    title: "adminJourneys.list.confirm.resumeTitle",
    body: "adminJourneys.list.confirm.resumeBody",
    done: "adminJourneys.list.done.active",
  },
};

/** Stany sesji, które są ostrzeżeniem (trzeba działać), a nie informacją. */
const WARNING_NOTICES: ReadonlySet<JourneySessionNotice> = new Set(["conflict", "draft_invalid"]);

export interface JourneyEditorProps {
  journeyId: string;
  /** Adres edytora po `parseJourneyEditorSearch` (z powłoki trasy). */
  search: JourneyEditorSearch;
  /** Widok rozstrzygnięty przez trasę: `?view=` albo domyślny (Lista < 768 px i przy ograniczonym ruchu). */
  view: JourneyEditorView;
  /** `journeyCapabilities(roles)` - dokładne role, nie `isAdmin`. */
  capabilities: JourneyCapabilities;
  tenantId: string | null;
  /** Zmiana adresu edytora (trasa: `useNavigate` na `/admin/revenue/journeys/$journeyId`). */
  onSearchChange: (patch: Partial<JourneyEditorSearch>, options?: { replace?: boolean }) => void;
}

/** Pole, w którym Ctrl+Z należy do przeglądarki (cofanie wpisanego tekstu). */
function isTextEntry(target: HTMLElement): boolean {
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** Szkic z podmienionym krokiem (ten sam `id`) - przepis zmiany z panelu kroku. */
function withNode(draft: JourneyDraft, node: JourneyNode): JourneyDraft {
  return {
    ...draft,
    graph: {
      ...draft.graph,
      nodes: draft.graph.nodes.map((current) => (current.id === node.id ? node : current)),
    },
  };
}

/** Szkic z nowymi ustawieniami - przepis zmiany z arkuszy wyzwalacza i ustawień. */
function withSettings(draft: JourneyDraft, settings: JourneySettings): JourneyDraft {
  return { ...draft, settings };
}

export function JourneyEditor({
  journeyId,
  search,
  view,
  capabilities,
  tenantId,
  onSearchChange,
}: JourneyEditorProps) {
  ensureRevenueI18n();
  ensureJourneysI18n();
  ensureListI18n();
  ensureCanvasI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const issuesId = useId();
  const testId = useId();
  const enabled = hydrated && tenantId !== null && capabilities.canEdit;

  // ── Szkic i wersja ──
  const versionNumber = search.version ?? null;
  const previewing = versionNumber !== null;
  const session = useJourneyEditorSession({
    journeyId,
    enabled,
    capabilities,
    versionPreview: previewing,
  });
  const detail = session.detail;
  const versionSummary =
    versionNumber === null
      ? null
      : (detail?.versions.find((entry) => entry.version === versionNumber) ?? null);
  const versionQuery = useQuery({
    ...journeyVersionQueryOptions(journeyId, versionSummary?.id ?? ""),
    enabled: enabled && versionSummary !== null,
  });
  const version = versionQuery.data?.state === "ready" ? versionQuery.data.data : null;
  const versionDraft = useMemo<JourneyDraft | null>(
    () =>
      version?.graph && version.settings
        ? { graph: version.graph, settings: version.settings }
        : null,
    [version],
  );
  /** Pokazywany graf: szkic sesji albo (podgląd) opublikowana wersja. */
  const shown = previewing ? versionDraft : session.draft;
  const contents = useMemo(
    () => (previewing ? (version?.contents ?? []) : (detail?.contents ?? [])),
    [detail, previewing, version],
  );
  const graphView = useMemo(() => buildJourneyView(shown?.graph ?? null), [shown?.graph]);
  const layout = useMemo(() => layoutJourney(graphView), [graphView]);
  const subjects = useMemo(() => journeySubjects(contents, lang), [contents, lang]);
  const editable = session.editable && !previewing;

  // ── Statystyki na kanwie (ten sam klucz co panel kroku i widok „Wyniki”) ──
  const statsSetting: JourneyStatsSetting = search.stats ?? DEFAULT_STATS_PERIOD;
  const [nowMs] = useState(() => Date.now());
  const statsWindow = useMemo(
    () => (statsSetting === "off" ? null : journeyStatsWindow(statsSetting, nowMs)),
    [nowMs, statsSetting],
  );
  const statsVersionId = previewing ? (versionSummary?.id ?? null) : null;
  const statsQuery = useQuery({
    ...journeyStatsQueryOptions(
      journeyId,
      statsVersionId,
      statsWindow?.sinceIso ?? null,
      statsWindow?.untilIso ?? null,
    ),
    // Szkic, który nigdy nie był opublikowany, nie ma czego liczyć.
    enabled:
      enabled && statsWindow !== null && view !== "results" && (detail?.versions.length ?? 0) > 0,
  });
  const stats = statsQuery.data?.state === "ready" ? statsQuery.data.data : null;

  // ── Problemy (ten sam hook co dialog publikacji - licznik nie kłamie) ──
  const issues = useJourneyIssues({
    tenantId,
    journeyId,
    detail,
    draft: session.value ? session.draft : null,
    definition: session.value
      ? {
          category: session.value.definition.category,
          legalBasis: session.value.definition.legalBasis,
        }
      : undefined,
    enabled: enabled && !previewing && session.mode === "edit",
  });

  // ── Stan chwili pracy ──
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState<JourneyFocus | null>(null);
  const [highlightedPath, setHighlightedPath] = useState<readonly string[] | null>(null);
  const [sheet, setSheet] = useState<"trigger" | "settings" | null>(null);
  const [dialog, setDialog] = useState<"publish" | "simulate" | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [statusMfa, setStatusMfa] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const setStatus = useSetJourneyStatus(tenantId);

  // Konflikt otwiera dialog różnic sam; zamknięty (Esc) zostawia pasek
  // z powrotem do dialogu - autozapis i tak czeka na decyzję.
  const hasConflict = session.conflict !== null;
  useEffect(() => {
    setConflictOpen(hasConflict);
  }, [hasConflict]);

  // Prefetch arkuszy w bezczynności (Z-S8-09); błąd sieci nie przeszkadza -
  // `lazy` spróbuje ponownie przy otwarciu. Odmontowanie anuluje zaplanowane.
  useEffect(
    () =>
      whenIdle(() => {
        void loadStepSheet().catch(() => undefined);
        void loadTriggerSheet().catch(() => undefined);
      }, 4000),
    [],
  );

  // ── Region aria-live (kanwa, lista albo ukryty region wyników) ──
  const [live, setLive] = useState({ text: "", count: 0 });
  const say = useCallback(
    (text: string) => setLive((current) => ({ text, count: current.count + 1 })),
    [],
  );
  useEffect(() => {
    if (session.announcement) say(session.announcement.text);
  }, [say, session.announcement]);
  // Twarda spacja na przemian: ten sam napis dwa razy z rzędu też się ogłosi.
  const announcement =
    live.text === "" ? null : live.count % 2 === 0 ? live.text : `${live.text}\u00a0`;

  // ── Operacje kanwy i listy ──
  const draftRef = useRef(session.draft);
  draftRef.current = session.draft;
  const updateDraft = session.updateDraft;
  const applyOp = useCallback<JourneyApplyOp>(
    (request) => {
      const draft = draftRef.current;
      if (!draft) return { ok: false, error: "node_missing" };
      const result = runJourneyEditRequest(draft.graph, request, journeyOpsContext(draft.settings));
      if (result.ok) {
        updateDraft(
          (current) => {
            if (current.graph === draft.graph) return { ...current, graph: result.graph };
            // Szkic zmienił się pod operacją (np. wersja z innej karty) - ta
            // sama operacja na bieżącym grafie (identyfikatory są deterministyczne).
            const again = runJourneyEditRequest(
              current.graph,
              request,
              journeyOpsContext(current.settings),
            );
            return again.ok ? { ...current, graph: again.graph } : current;
          },
          { label: request.label, announce: false },
        );
      }
      return result;
    },
    [updateDraft],
  );

  // ── Adres: widok, krok, okno statystyk, wersja ──
  const changeView = (next: JourneyEditorView) => {
    if (next === view) return;
    setLive((current) => ({ text: "", count: current.count }));
    onSearchChange({ view: next });
  };
  const openStep = useCallback(
    (nodeId: string) => onSearchChange({ node: nodeId, tab: undefined }),
    [onSearchChange],
  );
  const closeStep = () => onSearchChange({ node: undefined, tab: undefined });

  const changeZoom = (next: number) => {
    const value = clampJourneyZoom(next);
    setZoom(value);
    say(
      t("adminJourneys.canvas.live.zoom", { value: formatNumber(Math.round(value * 100), lang) }),
    );
  };
  const fitZoom = () => {
    const viewport = rootRef.current?.querySelector<HTMLElement>(
      '[data-testid="journey-canvas-viewport"]',
    );
    changeZoom(
      fitJourneyZoom(layout, {
        width: viewport?.clientWidth ?? 0,
        height: viewport?.clientHeight ?? 0,
      }),
    );
  };

  // ── Skok do kroku (problemy, publikacja, symulacja) ──
  const jumpToNode = useCallback(
    (nodeId: string) => {
      setFocus({ kind: "node", id: nodeId });
      setPendingJump(nodeId);
      if (view === "results") onSearchChange({ view: undefined });
    },
    [onSearchChange, view],
  );
  useEffect(() => {
    if (pendingJump === null || dialog !== null || view === "results") return;
    // Po zamknięciu dialogu Radix oddaje fokus przyciskowi, który go otworzył
    // (też zadaniem w kolejce) - nasz fokus na karcie idzie po nim.
    const handle = window.setTimeout(() => {
      const key = focusKey({ kind: "node", id: pendingJump });
      const element = rootRef.current?.querySelector<HTMLElement>(`[data-focus-key="${key}"]`);
      element?.focus();
      element?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      setPendingJump(null);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [dialog, pendingJump, view]);

  // ── Status ścieżki (admin) ──
  const runStatus = async (next: StatusChange) => {
    // Status ma CAS na tym samym `updated_at` co szkic: najpierw zapis
    // lokalnych zmian, potem zmiana statusu z tokenem z TEGO zapisu.
    const token = await session.flush();
    if (token === null) {
      toast.error(t("adminJourneys.list.statusError"));
      return;
    }
    try {
      const result = await setStatus.mutateAsync({
        journeyId,
        status: next,
        expectedUpdatedAt: token,
      });
      if (result.ok) {
        session.adoptToken(result.data.updatedAt);
        toast.success(t(STATUS_CHANGE_KEY[next].done));
        return;
      }
      if (result.error === "conflict") session.reportConflict();
      toast.error(mutationErrorText(t, result));
    } catch (error) {
      if (isMfaRequiredError(error)) setStatusMfa(true);
      else toast.error(t("adminJourneys.list.statusError"));
    }
  };
  const askStatus = (next: StatusChange) => {
    const keys = STATUS_CHANGE_KEY[next];
    setConfirm({
      title: t(keys.title, { name: detail?.definition.name ?? "" }),
      description: t(keys.body),
      confirmLabel: t(keys.action),
      cancelLabel: t("adminJourneys.common.cancel"),
      onConfirm: () => runStatus(next),
    });
  };

  // ── Klawiatura edytora: cofnij/ponów poza kanwą i listą ──
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (!event.currentTarget.contains(target) || isTextEntry(target)) return;
    const command = journeyKeyCommand(event);
    if (command?.type === "undo") session.undo();
    else if (command?.type === "redo") session.redo();
    else return;
    event.preventDefault();
  };

  // ── Nagłówek i okruszki ──
  const name =
    session.value?.definition.name.trim() ||
    detail?.definition.name ||
    (session.read === null && !session.error
      ? t("adminJourneys.editor.route.loadingName")
      : t("adminJourneys.editor.route.untitled"));
  // Odczyt po hydratacji: `sessionStorage` nie istnieje na serwerze.
  const listSearch = useMemo(() => (hydrated ? recallJourneyListSearch() : {}), [hydrated]);
  const publishedNumber =
    detail?.versions.find((entry) => entry.id === detail.definition.publishedVersionId)?.version ??
    null;

  const denial = journeyAccessDenial(session.error);
  const read = session.read;

  const backToList = (
    <Button asChild size="sm" variant="outline">
      <Link to="/admin/revenue/$tab" params={{ tab: "journeys" }} search={listSearch}>
        {t("adminJourneys.editor.route.backToList")}
      </Link>
    </Button>
  );

  const body = (): ReactNode => {
    if (read === null) {
      if (denial === "mfa_required") return <MfaRequiredNotice />;
      if (denial === "role") return <RoleGateNotice requiredRole="admin_or_editor" />;
      if (session.error) {
        return (
          <EditorNotice
            tone="warning"
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  void queryClient.refetchQueries({ queryKey: journeyKeys.detail(journeyId) })
                }
              >
                {t("adminJourneys.common.retry")}
              </Button>
            }
          >
            {t("adminJourneys.editor.route.loadFailed")}
          </EditorNotice>
        );
      }
      return <RevenueTabPending />;
    }
    if (read.state === "forbidden") return <RoleGateNotice requiredRole="admin_or_editor" />;
    if (read.state === "unavailable") {
      return (
        <EditorNotice tone="warning">{t("adminJourneys.editor.route.unavailable")}</EditorNotice>
      );
    }
    if (read.state === "not_found") {
      return (
        <EditorNotice tone="warning" action={backToList}>
          {t("adminJourneys.editor.route.notFound")}
        </EditorNotice>
      );
    }
    if (session.mode === "loading") return <RevenueTabPending />;
    return workspace();
  };

  const sessionNotice = (): ReactNode => {
    const notice = session.notice;
    if (!notice) return null;
    const action = (() => {
      switch (notice.code) {
        case "conflict":
          return (
            <Button type="button" size="sm" variant="outline" onClick={() => setConflictOpen(true)}>
              {t("adminJourneys.editor.notice.showConflict")}
            </Button>
          );
        case "needs_trigger":
          return (
            <Button type="button" size="sm" onClick={() => setSheet("trigger")}>
              {t("adminJourneys.editor.notice.chooseTrigger")}
            </Button>
          );
        case "draft_invalid":
          return (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setRepairError(null);
                void session.repairDraft().then((result) => {
                  if (!result.ok) setRepairError(result.message);
                });
              }}
            >
              {t("adminJourneys.editor.notice.repair")}
            </Button>
          );
        case "version":
          return (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onSearchChange({ version: undefined })}
            >
              {t("adminJourneys.editor.notice.backToDraft")}
            </Button>
          );
        default:
          return null;
      }
    })();
    return (
      <EditorNotice
        tone={WARNING_NOTICES.has(notice.code) ? "warning" : "info"}
        locked={notice.code === "archived" || notice.code === "role"}
        action={action}
      >
        {notice.text}
      </EditorNotice>
    );
  };

  const main = (): ReactNode => {
    if (view === "results") {
      return (
        <>
          <Suspense fallback={<RevenueTabPending />}>
            <JourneyResults
              journeyId={journeyId}
              versionId={statsVersionId}
              period={statsWindow?.period ?? DEFAULT_STATS_PERIOD}
            />
          </Suspense>
          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
        </>
      );
    }
    if (previewing) {
      const versionRead = versionQuery.data;
      if (isMfaRequiredError(versionQuery.error)) return <MfaRequiredNotice />;
      if (
        (detail && versionSummary === null) ||
        (versionRead !== undefined && versionRead.state === "not_found")
      ) {
        return (
          <EditorNotice tone="warning">
            {t("adminJourneys.editor.notice.versionMissing", { version: versionNumber })}
          </EditorNotice>
        );
      }
      if (version && !versionDraft) {
        return (
          <EditorNotice tone="warning">
            {t("adminJourneys.editor.notice.versionInvalid")}
          </EditorNotice>
        );
      }
      if (versionQuery.error || (versionRead !== undefined && versionRead.state !== "ready")) {
        return (
          <EditorNotice tone="warning">{t("adminJourneys.editor.route.loadFailed")}</EditorNotice>
        );
      }
    }
    if (!shown) return previewing ? <RevenueTabPending /> : null;
    const common = {
      graph: shown.graph,
      view: graphView,
      settings: shown.settings,
      subjects,
      stats,
      statsHidden: statsSetting === "off",
      focus,
      onFocusChange: setFocus,
      selectedNodeId: search.node ?? null,
      highlightedPath,
      readOnly: !editable,
      onApplyOp: applyOp,
      onOpenStep: openStep,
      onUndo: session.undo,
      onRedo: session.redo,
      onEscape: highlightedPath ? () => setHighlightedPath(null) : undefined,
      announcement,
    };
    return view === "list" ? (
      <JourneyOutline {...common} />
    ) : (
      <JourneyCanvas
        {...common}
        layout={layout}
        templateKey={detail?.definition.templateKey ?? null}
        zoom={zoom}
        onZoomChange={setZoom}
        showZoomControls={false}
      />
    );
  };

  const hasGraph = session.mode === "edit" || session.mode === "readonly";
  const status = detail?.definition.status ?? "draft";
  const workspace = (): ReactNode => (
    <>
      {hasGraph ? (
        <JourneyToolbar
          view={view}
          onViewChange={changeView}
          zoom={zoom}
          onZoomChange={changeZoom}
          onZoomFit={fitZoom}
          stats={statsSetting}
          onStatsChange={(next) =>
            onSearchChange(
              { stats: next === DEFAULT_STATS_PERIOD ? undefined : next },
              { replace: true },
            )
          }
          versions={detail?.versions ?? []}
          version={versionNumber}
          onVersionChange={(next) => onSearchChange({ version: next ?? undefined })}
          autosave={session.mode === "edit" && !previewing ? session.autosaveBar : null}
          issues={
            session.mode === "edit" && !previewing
              ? {
                  count: issues.ready ? issues.counts.blocker + issues.counts.warning : null,
                  open: issuesOpen,
                  controls: issuesId,
                  onToggle: () => setIssuesOpen((open) => !open),
                }
              : undefined
          }
          test={
            capabilities.canTest && !previewing
              ? { open: testOpen, controls: testId, onToggle: () => setTestOpen((open) => !open) }
              : undefined
          }
          onSettings={shown ? () => setSheet("settings") : undefined}
          onSimulate={shown && !previewing ? () => setDialog("simulate") : undefined}
          publishing={
            !previewing && status !== "archived"
              ? {
                  status,
                  published: (detail?.definition.publishedVersionId ?? null) !== null,
                  canPublish: capabilities.canPublish,
                  busy: setStatus.isPending,
                  onPublish:
                    session.mode === "edit" && session.token !== null
                      ? () => setDialog("publish")
                      : undefined,
                  onPause: () => askStatus("paused"),
                  onResume: () => askStatus("active"),
                }
              : undefined
          }
        />
      ) : null}

      {sessionNotice()}
      {repairError ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {repairError}
        </p>
      ) : null}
      {statusMfa || (denial === "mfa_required" && read !== null) ? <MfaRequiredNotice /> : null}

      {issuesOpen && session.mode === "edit" && !previewing ? (
        <div id={issuesId} className="rounded-[6px] border border-border bg-card p-4">
          {issues.mfaRequired ? (
            <MfaRequiredNotice />
          ) : (
            <JourneyIssuesList
              issues={issues.issues}
              loading={!issues.ready}
              onFocusNode={jumpToNode}
            />
          )}
          {issues.failed ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={issues.retry}
            >
              {t("adminJourneys.common.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {testOpen && capabilities.canTest && !previewing && detail ? (
        <div id={testId}>
          <Suspense fallback={<RevenueTabPending />}>
            <JourneyTestPanel
              tenantId={tenantId}
              journeyId={journeyId}
              definition={detail.definition}
              versions={detail.versions}
              capabilities={capabilities}
            />
          </Suspense>
        </div>
      ) : null}

      {main()}
    </>
  );

  return (
    <div
      ref={rootRef}
      data-testid="journey-editor-workspace"
      data-mode={session.mode}
      className="space-y-4"
      onKeyDown={onKeyDown}
    >
      <header className="space-y-2">
        <Breadcrumb aria-label={t("adminJourneys.editor.breadcrumbs.label")}>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/admin/revenue">{t("adminRevenue.title")}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/admin/revenue/$tab" params={{ tab: "journeys" }} search={listSearch}>
                  {t("adminRevenue.tab.journeys")}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="max-w-[260px] truncate">{name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold">{name}</h1>
          {detail ? (
            <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{t(JOURNEY_STATUS_LABEL_KEY[detail.definition.status])}</span>
              <span>
                {publishedNumber !== null
                  ? t("adminJourneys.editor.header.published", { version: publishedNumber })
                  : t("adminJourneys.editor.header.unpublished")}
              </span>
              {session.draft ? (
                <span>{translateSummary(t, triggerSentence(session.draft.settings))}</span>
              ) : null}
              {versionSummary ? (
                <span>
                  {t("adminJourneys.editor.header.previewing", {
                    version: versionSummary.version,
                    date: formatDateShort(versionSummary.publishedAt, i18n.language),
                  })}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </header>

      {body()}

      {/* Arkusze i dialogi montują się przy otwarciu (leniwe chunki). */}
      {search.node !== undefined && shown ? (
        <Suspense fallback={null}>
          <JourneyStepSheet
            open
            onOpenChange={(open) => {
              if (!open) closeStep();
            }}
            journeyId={journeyId}
            tenantId={tenantId}
            draft={shown}
            nodeId={search.node}
            tab={search.tab ?? "settings"}
            onTabChange={(tab: JourneyEditorTab) =>
              onSearchChange({ tab: tab === "settings" ? undefined : tab }, { replace: true })
            }
            capabilities={capabilities}
            editable={editable}
            contents={contents}
            templateMatches={previewing ? undefined : detail?.templateMatches}
            ensureNodeSaved={session.ensureNodeSaved}
            onChangeNode={(node, options) =>
              session.updateDraft((draft) => withNode(draft, node), options)
            }
            onOpenTrigger={
              previewing
                ? undefined
                : () => {
                    closeStep();
                    setSheet("trigger");
                  }
            }
            statsPeriod={statsWindow?.period}
            versionId={statsVersionId}
          />
        </Suspense>
      ) : null}
      {sheet === "trigger" && detail && !previewing ? (
        <Suspense fallback={null}>
          <JourneyTriggerSheet
            open
            onOpenChange={(open) => {
              if (!open) setSheet(null);
            }}
            tenantId={tenantId}
            draft={session.mode === "needs_trigger" ? null : session.draft}
            contents={contents}
            capabilities={capabilities}
            editable={session.mode === "needs_trigger" || editable}
            onChangeSettings={(settings, options) =>
              session.updateDraft((draft) => withSettings(draft, settings), options)
            }
            onChooseTrigger={session.chooseTrigger}
          />
        </Suspense>
      ) : null}
      {sheet === "settings" && detail && shown ? (
        <Suspense fallback={null}>
          <JourneySettingsSheet
            open
            onOpenChange={(open) => {
              if (!open) setSheet(null);
            }}
            tenantId={tenantId}
            definition={
              previewing || !session.value
                ? definitionFields(detail.definition)
                : session.value.definition
            }
            settings={shown.settings}
            capabilities={capabilities}
            editable={editable}
            onChangeDefinition={session.updateDefinition}
            onChangeSettings={(settings, options) =>
              session.updateDraft((draft) => withSettings(draft, settings), options)
            }
          />
        </Suspense>
      ) : null}
      {dialog === "publish" && detail && session.token !== null ? (
        <Suspense fallback={null}>
          <JourneyPublishDialog
            open
            onOpenChange={(open) => {
              if (!open) setDialog(null);
            }}
            tenantId={tenantId}
            journeyId={journeyId}
            detail={detail}
            draft={session.draft}
            definition={
              session.value
                ? {
                    category: session.value.definition.category,
                    legalBasis: session.value.definition.legalBasis,
                  }
                : undefined
            }
            expectedUpdatedAt={session.token}
            capabilities={capabilities}
            flushDraft={session.flush}
            onPublished={(result) => session.adoptToken(result.updatedAt)}
            onConflict={session.reportConflict}
            onFocusNode={jumpToNode}
          />
        </Suspense>
      ) : null}
      {dialog === "simulate" ? (
        <Suspense fallback={null}>
          <JourneySimulateDialog
            open
            onOpenChange={(open) => {
              if (!open) setDialog(null);
            }}
            journeyId={journeyId}
            draft={session.draft}
            subjects={Object.fromEntries(subjects)}
            onHighlightPath={setHighlightedPath}
            onFocusNode={jumpToNode}
          />
        </Suspense>
      ) : null}
      <JourneyConflictDialog
        open={conflictOpen && hasConflict}
        onOpenChange={setConflictOpen}
        conflict={session.conflict}
        onKeepMine={session.keepMine}
        onTakeServer={session.takeServer}
      />
      <ConfirmDialog
        state={confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      />
    </div>
  );
}

function EditorNotice({
  tone,
  locked = false,
  action,
  children,
}: {
  tone: "info" | "warning";
  locked?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  const Icon = locked ? Lock : tone === "warning" ? AlertTriangle : Info;
  return (
    <div
      role="status"
      data-tone={tone}
      className="flex flex-wrap items-center gap-2 rounded-[6px] border border-border bg-muted/30 p-3"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="m-0 min-w-0 flex-1 text-sm">{children}</p>
      {action}
    </div>
  );
}
