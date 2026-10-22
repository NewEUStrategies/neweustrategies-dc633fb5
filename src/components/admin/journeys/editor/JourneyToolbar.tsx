// Pasek edytora ścieżki (S8, SPEC §6.3 „pasek”): Kanwa | Lista | Wyniki,
// powiększenie, okno statystyk, wersja, cofnij/ponów z autozapisem, Sprawdź (n),
// Symuluj, Testuj na sobie, Ustawienia oraz Opublikuj / Wstrzymaj / Wznów.
//
// KOMPONENT PREZENTACYJNY. Stan pokazuje i zmienia edytor (`JourneyEditor`):
// widok, okno statystyk i wersja żyją w ADRESIE (`?view=`, `?stats=`,
// `?version=` - link wysłany koledze otwiera to samo), powiększenie w stanie
// edytora, a cofnij/ponów i status zapisu to gotowe propsy `AutosaveBar`
// z sesji szkicu (S8.3a) - ten sam pasek i te same komunikaty co w innych
// edytorach panelu. Akcja, której rola nie ma albo która w danym stanie nie
// ma sensu (podgląd wersji, archiwum), przychodzi jako `undefined` i znika -
// pasek nie proponuje działań, które serwer odrzuci.
//
// KOLOR NIGDY SAM: wybrany widok to `aria-pressed` i wypełnienie, „Sprawdź”
// niesie liczbę problemów w napisie, a ikona jest dekoracją przy słowie.
// Przyciski mają 28 px (cel ≥ 24 px; na ekranach dotykowych `Button` sam
// podnosi je do 44 px). Geometria ta sama w obu motywach - różnią się tylko
// tokeny kolorów.
//
// PUBLIKACJA TYLKO DLA ADMINA (`journeyCapabilities.canPublish`). Redaktor
// widzi zdanie, kto publikuje, zamiast przycisku kończącego się odmową.
import { useId, type ComponentProps } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  GitBranch,
  ListChecks,
  Maximize2,
  Timer,
  TrendingUp,
  UserPlus,
  Zap,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { AutosaveBar } from "@/components/admin/AutosaveBar";
import { Button } from "@/components/ui/button";
import { PlatformSelect } from "@/components/ui/platform-select";
import type { JourneyVersionSummary } from "@/lib/admin/journeys/journeyEditor.functions";
import { chartLangFrom } from "@/lib/charts/format";
import { formatDateShort, formatNumber } from "@/lib/i18n/format";
import { ensureI18n as ensureRevenueI18n } from "@/lib/i18n-admin-revenue";
import { ensureI18n as ensureCanvasI18n } from "@/lib/i18n-admin-journeys-canvas";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n } from "@/lib/i18n-admin-journeys-editor";
import { JOURNEY_EDITOR_VIEWS, type JourneyEditorView } from "@/lib/journeys/editorSearch";
import { REVENUE_PERIODS, type JourneyStatus, type RevenuePeriod } from "@/lib/revenue/search";
import { JOURNEY_ZOOM, stepJourneyZoom } from "./JourneyCanvas";

/** `?stats=`: okres huba albo `off` (bez nakładki i bez liczb w nazwach kart). */
export type JourneyStatsSetting = RevenuePeriod | "off";

/**
 * Okresy do wyboru w pasku. Bez `custom`: edytor nie ma w adresie granic
 * własnego zakresu (`journeyStatsWindow` liczy go jak miesiąc), więc pozycja
 * „Własny zakres” obiecywałaby wybór, którego nie ma.
 */
export const JOURNEY_STATS_PERIODS: readonly RevenuePeriod[] = REVENUE_PERIODS.filter(
  (period) => period !== "custom",
);

const VIEW_LABEL_KEY: Readonly<Record<JourneyEditorView, string>> = {
  canvas: "adminJourneys.editor.toolbar.view.canvas",
  list: "adminJourneys.editor.toolbar.view.list",
  results: "adminJourneys.editor.toolbar.view.results",
};

const VIEW_ICON: Readonly<Record<JourneyEditorView, LucideIcon>> = {
  canvas: GitBranch,
  list: ListChecks,
  results: TrendingUp,
};

/** Klucze okresów huba - te same napisy co w filtrze huba (jedna arytmetyka okien). */
const PERIOD_LABEL_KEY: Readonly<Record<RevenuePeriod, string>> = {
  week: "adminRevenue.period.week",
  month: "adminRevenue.period.month",
  "prev-month": "adminRevenue.period.prev-month",
  quarter: "adminRevenue.period.quarter",
  "half-year": "adminRevenue.period.half-year",
  year: "adminRevenue.period.year",
  ltm: "adminRevenue.period.ltm",
  custom: "adminRevenue.period.custom",
};

/** Przełącznik panelu pod paskiem (problemy, test) - `aria-expanded` + `aria-controls`. */
export interface JourneyToolbarToggle {
  open: boolean;
  /** `id` regionu, który przycisk rozwija. */
  controls: string;
  onToggle: () => void;
}

export interface JourneyToolbarPublishing {
  status: JourneyStatus;
  /** Ścieżka ma opublikowaną wersję („Opublikuj zmiany” zamiast „Opublikuj”). */
  published: boolean;
  /** `journeyCapabilities(roles).canPublish`. */
  canPublish: boolean;
  /** Zmiana statusu w toku - przyciski statusu czekają. */
  busy: boolean;
  onPublish?: () => void;
  onPause?: () => void;
  onResume?: () => void;
}

export interface JourneyToolbarProps {
  view: JourneyEditorView;
  onViewChange: (view: JourneyEditorView) => void;
  /** Powiększenie kanwy (grupa widoczna tylko w widoku Kanwa). */
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onZoomFit: () => void;
  stats: JourneyStatsSetting;
  onStatsChange: (stats: JourneyStatsSetting) => void;
  /** Wersje opublikowane (malejąco); pusta lista - bez wyboru wersji. */
  versions: readonly JourneyVersionSummary[];
  /** Numer oglądanej wersji (`?version=`); `null` - szkic. */
  version: number | null;
  onVersionChange: (version: number | null) => void;
  /** Propsy `AutosaveBar` z sesji; `null` - nic do zapisania (podgląd, wczytywanie). */
  autosave: ComponentProps<typeof AutosaveBar> | null;
  /** „Sprawdź (n)”: `count` `null` - kontekst blokad jeszcze się wczytuje. */
  issues?: JourneyToolbarToggle & { count: number | null };
  test?: JourneyToolbarToggle;
  onSettings?: () => void;
  onSimulate?: () => void;
  publishing?: JourneyToolbarPublishing;
}

export function JourneyToolbar(props: JourneyToolbarProps) {
  ensureRevenueI18n();
  ensureListI18n();
  ensureCanvasI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const id = useId();
  const { view, zoom, publishing } = props;
  const zoomLabel = t("adminJourneys.canvas.zoom.value", {
    value: formatNumber(Math.round(zoom * 100), lang),
  });

  return (
    <div
      role="group"
      aria-label={t("adminJourneys.editor.toolbar.label")}
      data-testid="journey-toolbar"
      className="flex flex-wrap items-center gap-2"
    >
      <div
        role="group"
        aria-label={t("adminJourneys.editor.toolbar.view.label")}
        className="inline-flex items-center gap-0.5 rounded-[6px] border border-border p-0.5"
      >
        {JOURNEY_EDITOR_VIEWS.map((value) => {
          const Icon = VIEW_ICON[value];
          const active = value === view;
          return (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={active ? "secondary" : "ghost"}
              aria-pressed={active}
              data-view-option={value}
              onClick={() => props.onViewChange(value)}
            >
              <Icon aria-hidden="true" />
              {t(VIEW_LABEL_KEY[value])}
            </Button>
          );
        })}
      </div>

      {view === "canvas" ? (
        <div
          role="group"
          aria-label={t("adminJourneys.canvas.zoom.toolbar")}
          className="inline-flex items-center gap-0.5"
        >
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t("adminJourneys.canvas.zoom.out")}
            disabled={zoom <= JOURNEY_ZOOM.min}
            onClick={() => props.onZoomChange(stepJourneyZoom(zoom, -1))}
          >
            <ZoomOut aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-w-10 tabular-nums"
            aria-label={t("adminJourneys.canvas.zoom.reset", { value: zoomLabel })}
            onClick={() => props.onZoomChange(1)}
          >
            {zoomLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t("adminJourneys.canvas.zoom.in")}
            disabled={zoom >= JOURNEY_ZOOM.max}
            onClick={() => props.onZoomChange(stepJourneyZoom(zoom, 1))}
          >
            <ZoomIn aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t("adminJourneys.canvas.zoom.fit")}
            onClick={props.onZoomFit}
          >
            <Maximize2 aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {view !== "results" ? (
        <div className="inline-flex items-center gap-2">
          <label htmlFor={`${id}-stats`} className="text-xs text-muted-foreground">
            {t("adminJourneys.editor.toolbar.stats.label")}
          </label>
          <PlatformSelect
            id={`${id}-stats`}
            value={props.stats}
            className="h-7 w-auto text-xs"
            onChange={(event) => {
              const value = event.target.value;
              if (value === "off") props.onStatsChange("off");
              else if ((JOURNEY_STATS_PERIODS as readonly string[]).includes(value)) {
                props.onStatsChange(value as RevenuePeriod);
              }
            }}
          >
            {JOURNEY_STATS_PERIODS.map((period) => (
              <option key={period} value={period}>
                {t(PERIOD_LABEL_KEY[period])}
              </option>
            ))}
            <option value="off">{t("adminJourneys.editor.toolbar.stats.off")}</option>
          </PlatformSelect>
        </div>
      ) : null}

      {props.versions.length > 0 ? (
        <div className="inline-flex items-center gap-2">
          <label htmlFor={`${id}-version`} className="text-xs text-muted-foreground">
            {t("adminJourneys.editor.toolbar.version.label")}
          </label>
          <PlatformSelect
            id={`${id}-version`}
            value={props.version === null ? "" : String(props.version)}
            className="h-7 w-auto text-xs"
            onChange={(event) => {
              const value = Number(event.target.value);
              props.onVersionChange(Number.isSafeInteger(value) && value >= 1 ? value : null);
            }}
          >
            <option value="">{t("adminJourneys.editor.toolbar.version.draft")}</option>
            {props.versions.map((entry) => (
              <option key={entry.id} value={String(entry.version)}>
                {t("adminJourneys.editor.toolbar.version.item", {
                  version: entry.version,
                  date: formatDateShort(entry.publishedAt, i18n.language),
                })}
              </option>
            ))}
          </PlatformSelect>
        </div>
      ) : null}

      {props.autosave ? <AutosaveBar {...props.autosave} /> : null}

      <div
        role="group"
        aria-label={t("adminJourneys.editor.toolbar.actions")}
        className="ml-auto flex flex-wrap items-center gap-2"
      >
        {props.issues ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={props.issues.open}
            aria-controls={props.issues.controls}
            onClick={props.issues.onToggle}
          >
            {props.issues.count !== null && props.issues.count > 0 ? (
              <AlertTriangle aria-hidden="true" />
            ) : (
              <CheckCircle2 aria-hidden="true" />
            )}
            {props.issues.count === null
              ? t("adminJourneys.editor.toolbar.checkLoading")
              : t("adminJourneys.editor.toolbar.check", { n: props.issues.count })}
          </Button>
        ) : null}
        {props.onSimulate ? (
          <Button type="button" size="sm" variant="outline" onClick={props.onSimulate}>
            <FlaskConical aria-hidden="true" />
            {t("adminJourneys.editor.toolbar.simulate")}
          </Button>
        ) : null}
        {props.test ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={props.test.open}
            aria-controls={props.test.controls}
            onClick={props.test.onToggle}
          >
            <UserPlus aria-hidden="true" />
            {t("adminJourneys.editor.toolbar.test")}
          </Button>
        ) : null}
        {props.onSettings ? (
          <Button type="button" size="sm" variant="outline" onClick={props.onSettings}>
            {t("adminJourneys.editor.toolbar.settings")}
          </Button>
        ) : null}
        {publishing ? <PublishingActions publishing={publishing} /> : null}
      </div>
    </div>
  );
}

function PublishingActions({ publishing }: { publishing: JourneyToolbarPublishing }) {
  const { t } = useTranslation();
  if (!publishing.canPublish) {
    return (
      <p className="m-0 text-xs text-muted-foreground">
        {t("adminJourneys.editor.toolbar.publishAdminOnly")}
      </p>
    );
  }
  return (
    <>
      {publishing.onPause && publishing.status === "active" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={publishing.busy}
          onClick={publishing.onPause}
        >
          <Timer aria-hidden="true" />
          {t("adminJourneys.list.actions.pause")}
        </Button>
      ) : null}
      {publishing.onResume && publishing.status === "paused" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={publishing.busy}
          onClick={publishing.onResume}
        >
          <Zap aria-hidden="true" />
          {t("adminJourneys.list.actions.resume")}
        </Button>
      ) : null}
      {publishing.onPublish ? (
        <Button
          type="button"
          size="sm"
          data-tour="journey-publish"
          disabled={publishing.busy}
          onClick={publishing.onPublish}
        >
          <CheckCircle2 aria-hidden="true" />
          {publishing.published
            ? t("adminJourneys.editor.toolbar.publishChanges")
            : t("adminJourneys.editor.toolbar.publish")}
        </Button>
      ) : null}
    </>
  );
}
