// Organizm: „Raport dla sponsorów" w studiu wydarzenia
// (`/admin/events/<id>/sponsor-report`).
//
// CO POKAZUJE. Kafle (wyświetlenia i kliknięcia unikalne z sumami łącznymi,
// CTR, otwarcia materiałów, zebrane kontakty ze zgodą, spotkania), wykres
// dzień po dniu, tabelę sponsorów, rozbicie na miejsca na stronie, eksport
// CSV/XLSX, linki dla sponsorów i przeniesienie kontaktów do CRM.
//
// „NIE WIEM" TO NIE ZERO. Kafel bez danych (zapytanie w locie, błąd) pokazuje
// kreskę; CTR przy zerze wyświetleń jest kreską, nie „0%" (`sponsorCtr`).
// Nota o zgodzie stoi nad kaflami, bo liczby mówią wyłącznie o odwiedzających,
// którzy zgodzili się na pomiar marketingowy - bez tej noty sponsor porówna je
// z ruchem z analityki serwisu i uzna, że coś zginęło.
//
// FILTR MIEJSCA NIE ZAWĘŻA KONTAKTÓW. Kontakty ze stoiska i spotkania nie mają
// miejsca na stronie, więc baza liczy je bez tego filtra - zdanie pod filtrami
// mówi to wprost, zamiast zostawiać organizatora z liczbą, która się „nie
// zmienia".
//
// EKSPORT KONTAKTÓW TO ISTNIEJĄCA FUNKCJA BAZY (`admin_event_lead_scans_export`)
// z tą samą redakcją kontaktu bez zgody, co w module odprawy - raport nie ma
// drugiej reguły zgody.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ChartCard } from "@/components/admin/analytics/ChartCard";
import { SponsorReportFiltersBar } from "@/components/admin/events/molecules/SponsorReportFiltersBar";
import { SponsorReportShareDialog } from "@/components/admin/events/molecules/SponsorReportShareDialog";
import { SponsorReportLinksPanel } from "@/components/admin/events/organisms/SponsorReportLinksPanel";
import {
  EventStudioPage,
  EventStudioRow,
} from "@/components/admin/events/studio/EventStudioSection";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminMetricTile } from "@/components/admin/molecules/AdminMetricTile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { confirmDialog } from "@/lib/appDialogs";
import { Eye, FileText, Handshake, MousePointerClick, TrendingUp, Users } from "@/lib/lucide-shim";
import { adminSponsorReportErrorMessage } from "@/lib/events/adminSponsorReportErrors";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import { buildLeadExport, downloadLeadExport } from "@/lib/events/leadExport";
import { fetchLeadScansExport } from "@/lib/events/onsiteApi";
import {
  ALL,
  EMPTY_SPONSOR_REPORT_FILTERS,
  sponsorReportQuery,
  type SponsorReportFilters,
} from "@/lib/events/sponsorReportDraft";
import {
  adminMetricsRows,
  buildSponsorReportExport,
  type SponsorReportExportFormat,
} from "@/lib/events/sponsorReportExport";
import {
  ADMIN_PLACEMENT_LABEL_KEYS,
  adminSponsorRoleLabelKey,
} from "@/lib/events/sponsorReportLabels";
import {
  formatCtr,
  reportNumber,
  sponsorCtr,
  sponsorPlacementRows,
  sponsorReportChartConfig,
  sponsorReportDaily,
  sponsorReportTotals,
} from "@/lib/events/sponsorReportModel";
import { isSponsorPlacement } from "@/lib/events/sponsorExposure";
import {
  usePushLeadScansToCrm,
  useSponsorReportLeadsSeries,
  useSponsorReportSeries,
  useSponsorReportSummary,
} from "@/lib/events/useSponsorReport";
import { formatDateOnly, formatNumber, uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureSponsorReportI18n } from "@/lib/i18n-admin-event-sponsor-report";

type ExportKind = "metrics" | "leads";

export function SponsorReportPanel({
  row,
  initialSponsorId = null,
}: {
  row: AdminEventDetailRow;
  /** Sponsor z adresu (`?sponsor=`) - np. z karty firmy w CRM. */
  initialSponsorId?: string | null;
}) {
  ensureAdminEventsI18n();
  ensureSponsorReportI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const eventId = row.id;

  const [filters, setFilters] = useState<SponsorReportFilters>(() => ({
    ...EMPTY_SPONSOR_REPORT_FILTERS,
    sponsorId: initialSponsorId ?? ALL,
  }));
  const [shareFor, setShareFor] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = useMemo(() => sponsorReportQuery(eventId, filters), [eventId, filters]);
  // Tabela sponsorów pokazuje KAŻDE przypięcie, także przy filtrze sponsora -
  // filtr zawęża kafle, wykres i rozbicie, a nie listę, z której się wybiera.
  const summaryQuery = useMemo(() => ({ ...query, sponsorId: null }), [query]);
  const summaryQ = useSponsorReportSummary(summaryQuery);
  const seriesQ = useSponsorReportSeries(query);
  const leadsSeriesQ = useSponsorReportLeadsSeries(query);
  const push = usePushLeadScansToCrm(eventId);

  const summary = summaryQ.data ?? [];
  const sponsors = summary.map((item) => ({ id: item.sponsor_id, name: item.sponsor_name }));
  const sponsorName = (id: string) => sponsors.find((item) => item.id === id)?.name ?? "";
  const placementLabel = (placement: string) =>
    isSponsorPlacement(placement) ? t(ADMIN_PLACEMENT_LABEL_KEYS[placement]) : placement;

  const totals = summaryQ.data === undefined ? null : sponsorReportTotals(summary, query.sponsorId);
  const daily = useMemo(
    () => sponsorReportDaily(seriesQ.data ?? [], leadsSeriesQ.data ?? []),
    [seriesQ.data, leadsSeriesQ.data],
  );
  const placementRows = sponsorPlacementRows(
    seriesQ.data ?? [],
    sponsors.map((item) => item.id),
  );
  const count = (value: number) => formatNumber(value, lang);

  const chartConfig = useMemo(
    () =>
      sponsorReportChartConfig(
        daily.map((point) => formatDateOnly(point.day, lang, { day: "numeric", month: "short" })),
        [
          {
            name: t("adminEventSponsorReport.chart.views"),
            values: daily.map((point) => point.viewsUnique),
          },
          {
            name: t("adminEventSponsorReport.chart.clicks"),
            values: daily.map((point) => point.clicksUnique),
          },
          {
            name: t("adminEventSponsorReport.chart.leads"),
            values: daily.map((point) => point.leadsNew),
          },
        ],
      ),
    [daily, lang, t],
  );

  const metricsHeaders = [
    t("adminEventSponsorReport.export.columns.day"),
    t("adminEventSponsorReport.export.columns.sponsor"),
    t("adminEventSponsorReport.export.columns.placement"),
    t("adminEventSponsorReport.export.columns.viewsUnique"),
    t("adminEventSponsorReport.export.columns.viewsTotal"),
    t("adminEventSponsorReport.export.columns.clicksUnique"),
    t("adminEventSponsorReport.export.columns.clicksTotal"),
    t("adminEventSponsorReport.export.columns.ctr"),
    t("adminEventSponsorReport.export.columns.materialOpens"),
  ];

  const runExport = async (kind: ExportKind, format: SponsorReportExportFormat) => {
    setExporting(true);
    try {
      const nowIso = new Date().toISOString();
      if (kind === "metrics") {
        const rows = adminMetricsRows(seriesQ.data ?? [], sponsorName, placementLabel);
        if (rows.length === 0) {
          toast.info(t("adminEventSponsorReport.export.empty"));
          return;
        }
        downloadLeadExport(
          await buildSponsorReportExport(metricsHeaders, rows, {
            format,
            prefix: t("adminEventSponsorReport.export.metricsPrefix"),
            sheetName: t("adminEventSponsorReport.export.sheetName"),
            nowIso,
          }),
        );
      } else {
        const rows = await fetchLeadScansExport(eventId, query.sponsorId ?? undefined);
        if (rows.length === 0) {
          toast.info(t("adminEventSponsorReport.export.empty"));
          return;
        }
        downloadLeadExport(
          await buildLeadExport(rows, {
            format,
            lang,
            prefix: t("adminEventSponsorReport.export.leadsPrefix"),
            nowIso,
          }),
        );
      }
      toast.success(t("adminEventSponsorReport.export.done"));
    } catch {
      toast.error(t("adminEventSponsorReport.export.failed"));
    } finally {
      setExporting(false);
    }
  };

  const pushToCrm = async () => {
    const ok = await confirmDialog({
      title: t("adminEventSponsorReport.crm.confirmTitle"),
      description: t("adminEventSponsorReport.crm.confirmBody"),
      confirmLabel: t("adminEventSponsorReport.crm.confirmAction"),
    });
    if (!ok) return;
    push.mutate(
      { eventId, sponsorId: query.sponsorId },
      {
        onSuccess: (result) => {
          toast.success(
            t("adminEventSponsorReport.crm.done", {
              created: result.created,
              updated: result.updated,
              skipped: result.skippedNoEmail + result.skippedNoConsent,
            }),
          );
          if (result.failed > 0) {
            toast.warning(t("adminEventSponsorReport.crm.failedSome", { count: result.failed }));
          }
        },
        onError: (error) => toast.error(adminSponsorReportErrorMessage(error)),
      },
    );
  };

  const ctr = totals === null ? null : sponsorCtr(totals.clicksUnique, totals.viewsUnique);

  return (
    <EventStudioPage
      title={t("adminEvents.studio.sections.sponsorReport")}
      description={t("adminEventSponsorReport.lead")}
    >
      <EventStudioRow
        label={t("adminEventSponsorReport.kpi.label")}
        description={t("adminEventSponsorReport.consentNote")}
      >
        <SponsorReportFiltersBar filters={filters} sponsors={sponsors} onChange={setFilters} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <AdminMetricTile
            icon={Eye}
            label={t("adminEventSponsorReport.kpi.views")}
            value={totals === null ? null : count(totals.viewsUnique)}
            hint={
              totals === null
                ? undefined
                : t("adminEventSponsorReport.kpi.viewsHint", { count: totals.viewsTotal })
            }
          />
          <AdminMetricTile
            icon={MousePointerClick}
            label={t("adminEventSponsorReport.kpi.clicks")}
            value={totals === null ? null : count(totals.clicksUnique)}
            hint={
              totals === null
                ? undefined
                : t("adminEventSponsorReport.kpi.clicksHint", { count: totals.clicksTotal })
            }
          />
          <AdminMetricTile
            icon={TrendingUp}
            label={t("adminEventSponsorReport.kpi.ctr")}
            value={formatCtr(ctr, lang)}
            hint={t("adminEventSponsorReport.kpi.ctrHint")}
          />
          <AdminMetricTile
            icon={FileText}
            label={t("adminEventSponsorReport.kpi.materialOpens")}
            value={totals === null ? null : count(totals.materialOpens)}
          />
          <AdminMetricTile
            icon={Users}
            label={t("adminEventSponsorReport.kpi.leads")}
            value={totals === null ? null : count(totals.leadsTotal)}
            hint={
              totals === null
                ? undefined
                : t("adminEventSponsorReport.kpi.leadsHint", { count: totals.leadsConsented })
            }
          />
          <AdminMetricTile
            icon={Handshake}
            label={t("adminEventSponsorReport.kpi.meetings")}
            value={totals === null ? null : count(totals.meetingsHeld)}
            hint={
              totals === null
                ? undefined
                : t("adminEventSponsorReport.kpi.meetingsHint", { count: totals.meetingsTotal })
            }
          />
        </div>
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEventSponsorReport.chart.title")}
        description={t("adminEventSponsorReport.chart.subtitle")}
      >
        {daily.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("adminEventSponsorReport.chart.empty")}
          </p>
        ) : (
          <ChartCard
            title={t("adminEventSponsorReport.chart.title")}
            subtitle={t("adminEventSponsorReport.chart.subtitle")}
            config={chartConfig}
            pngName={t("adminEventSponsorReport.export.metricsPrefix")}
          />
        )}
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEventSponsorReport.table.title")}
        description={t("adminEventSponsorReport.filters.placementHint")}
      >
        <AdminCatalogListState
          isLoading={summaryQ.isPending}
          loadingLabel={t("adminEventSponsorReport.loading")}
          errorMessage={summaryQ.isError ? adminSponsorReportErrorMessage(summaryQ.error) : null}
          isEmpty={summary.length === 0}
          emptyLabel={t("adminEventSponsorReport.empty")}
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("adminEventSponsorReport.table.sponsor")}</TableHead>
                  <TableHead>{t("adminEventSponsorReport.table.tier")}</TableHead>
                  <TableHead className="text-right">
                    {t("adminEventSponsorReport.table.views")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("adminEventSponsorReport.table.clicks")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("adminEventSponsorReport.table.ctr")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("adminEventSponsorReport.table.materialOpens")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("adminEventSponsorReport.table.leads")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("adminEventSponsorReport.table.meetings")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("adminEventSponsorReport.table.links")}
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">{t("adminEventSponsorReport.table.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((item) => {
                  const views = reportNumber(item.views_unique);
                  const clicks = reportNumber(item.clicks_unique);
                  const tier = pickLocalized(
                    { name_pl: item.tier_name_pl, name_en: item.tier_name_en },
                    "name",
                    lang,
                    t("adminEventSponsorReport.table.noTier"),
                  );
                  return (
                    <TableRow key={item.sponsor_id}>
                      <TableCell>
                        <div className="font-medium">{item.sponsor_name}</div>
                        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                          <span>{t(adminSponsorRoleLabelKey(item.role))}</span>
                          {item.is_published ? null : (
                            <Badge variant="outline">
                              {t("adminEventSponsorReport.table.unpublished")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{tier}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {count(views)}
                        <div className="text-[11px] text-muted-foreground">
                          {t("adminEventSponsorReport.table.totalHint", {
                            count: reportNumber(item.views_total),
                          })}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{count(clicks)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCtr(sponsorCtr(clicks, views), lang) ?? "-"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {count(reportNumber(item.material_opens))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {count(reportNumber(item.leads_total))} (
                        {count(reportNumber(item.leads_consented))})
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {count(reportNumber(item.meetings_total))} (
                        {count(reportNumber(item.meetings_held))})
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {count(reportNumber(item.active_links))}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={t("adminEventSponsorReport.table.shareFor", {
                            name: item.sponsor_name,
                          })}
                          onClick={() => setShareFor(item.sponsor_id)}
                        >
                          {t("adminEventSponsorReport.table.share")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </AdminCatalogListState>
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEventSponsorReport.placementTable.title")}
        description={t("adminEventSponsorReport.placementTable.description")}
      >
        {placementRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("adminEventSponsorReport.placementTable.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("adminEventSponsorReport.placementTable.sponsor")}</TableHead>
                  <TableHead>{t("adminEventSponsorReport.placementTable.placement")}</TableHead>
                  <TableHead className="text-right">
                    {t("adminEventSponsorReport.placementTable.views")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("adminEventSponsorReport.placementTable.clicks")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("adminEventSponsorReport.placementTable.ctr")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("adminEventSponsorReport.placementTable.materialOpens")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {placementRows.map((item) => (
                  <TableRow key={`${item.sponsorId}-${item.placement}`}>
                    <TableCell>{sponsorName(item.sponsorId)}</TableCell>
                    <TableCell>{t(ADMIN_PLACEMENT_LABEL_KEYS[item.placement])}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(item.viewsUnique)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(item.clicksUnique)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCtr(sponsorCtr(item.clicksUnique, item.viewsUnique), lang) ?? "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(item.materialOpens)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEventSponsorReport.export.title")}
        description={t("adminEventSponsorReport.export.description")}
      >
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={exporting}
            onClick={() => void runExport("metrics", "csv")}
          >
            {t("adminEventSponsorReport.export.metricsCsv")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={exporting}
            onClick={() => void runExport("metrics", "xlsx")}
          >
            {t("adminEventSponsorReport.export.metricsXlsx")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={exporting}
            onClick={() => void runExport("leads", "csv")}
          >
            {t("adminEventSponsorReport.export.leadsCsv")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={exporting}
            onClick={() => void runExport("leads", "xlsx")}
          >
            {t("adminEventSponsorReport.export.leadsXlsx")}
          </Button>
        </div>
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEventSponsorReport.links.title")}
        description={t("adminEventSponsorReport.links.description")}
      >
        <div>
          <Button type="button" onClick={() => setShareFor(query.sponsorId ?? "")}>
            {t("adminEventSponsorReport.table.share")}
          </Button>
        </div>
        <SponsorReportLinksPanel eventId={eventId} timezone={row.timezone} />
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEventSponsorReport.crm.title")}
        description={t("adminEventSponsorReport.crm.description")}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={push.isPending}
            onClick={() => void pushToCrm()}
          >
            {t("adminEventSponsorReport.crm.push")}
          </Button>
          <Link
            to="/admin/events/$eventId/onsite/leads"
            params={{ eventId }}
            className="text-sm text-primary hover:underline"
          >
            {t("adminEventSponsorReport.kpi.leads")}
          </Link>
        </div>
      </EventStudioRow>

      <SponsorReportShareDialog
        open={shareFor !== null}
        onOpenChange={(open) => {
          if (!open) setShareFor(null);
        }}
        eventId={eventId}
        eventSlug={row.slug}
        eventEndsAt={row.ends_at}
        sponsors={sponsors}
        sponsorId={shareFor ?? ""}
      />
    </EventStudioPage>
  );
}
