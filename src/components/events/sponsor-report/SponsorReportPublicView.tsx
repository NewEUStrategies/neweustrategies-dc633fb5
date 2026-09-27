// Widok raportu dla sponsora (strona `/events/$slug/sponsor-report`) - SAM
// RYSUNEK gotowego raportu, bez wczytywania. Wczytanie po tokenie robi
// `SponsorReportPublicPanel`.
//
// TO JEST STRONA DLA SPONSORA, NIE PANEL. Nie importuje niczego z panelu
// (komponentów ani nakładek `adminEvent*`) - jedzie w publicznym chunku.
// Kafle, tabela i wykres to te same miary, co w studiu, liczone tym samym
// modelem (`sponsorReportModel.ts`), więc liczby w raporcie organizatora i u
// sponsora nie mogą się rozjechać.
//
// „NIE WIEM" TO NIE ZERO: CTR bez wyświetleń to kreska, nie „0%".
//
// KONTAKTY: lista jest tylko wtedy, gdy organizator ją dołączył do linku
// (`leads !== null`); kontakt w pliku tylko przy zgodzie na przekazanie
// partnerowi - wiersze bez zgody baza oddaje bez danych osobowych, a
// `buildLeadExport` zeruje kontakt jeszcze raz przed zapisem pliku.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Chart } from "@/components/charts/Chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { chartLangFrom } from "@/lib/charts/format";
import { buildLeadExport, downloadLeadExport } from "@/lib/events/leadExport";
import type { PublicSponsorLead, PublicSponsorReport } from "@/lib/events/sponsorReportPayload";
import {
  buildSponsorReportExport,
  publicMetricsRows,
  type SponsorReportExportFormat,
} from "@/lib/events/sponsorReportExport";
import { PUBLIC_PLACEMENT_LABEL_KEYS } from "@/lib/events/sponsorReportLabels";
import {
  fillDailyGaps,
  formatCtr,
  sponsorCtr,
  sponsorReportChartConfig,
} from "@/lib/events/sponsorReportModel";
import { formatEventDate, formatEventDateTime } from "@/lib/events/timezone";
import { formatDateOnly, formatNumber, uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { brandedMediaUrl } from "@/lib/media/publicUrl";
import { ensureEventSponsorReportI18n } from "@/lib/i18n-event-sponsor-report";

function Kpi({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value ?? "-"}</p>
        {hint === undefined ? null : (
          <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function SponsorReportPublicView({ report }: { report: PublicSponsorReport }) {
  ensureEventSponsorReportI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const count = (value: number) => formatNumber(value, lang);
  const tz = report.event.timezone;
  const totals = report.totals;
  const eventTitle = pickLocalized(
    { title_pl: report.event.titlePl, title_en: report.event.titleEn },
    "title",
    lang,
    report.event.slug,
  );
  const tier = pickLocalized(
    { name_pl: report.sponsor.tierNamePl, name_en: report.sponsor.tierNameEn },
    "name",
    lang,
  );
  const daily = useMemo(() => fillDailyGaps(report.series), [report.series]);
  const chartConfig = useMemo(
    () =>
      sponsorReportChartConfig(
        daily.map((point) => formatDateOnly(point.day, lang, { day: "numeric", month: "short" })),
        [
          { name: t("eventSponsorReport.chart.views"), values: daily.map((p) => p.viewsUnique) },
          { name: t("eventSponsorReport.chart.clicks"), values: daily.map((p) => p.clicksUnique) },
          { name: t("eventSponsorReport.chart.leads"), values: daily.map((p) => p.leadsNew) },
        ],
      ),
    [daily, lang, t],
  );

  const run = async (build: () => Promise<Parameters<typeof downloadLeadExport>[0]>) => {
    setBusy(true);
    setFailed(false);
    try {
      downloadLeadExport(await build());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const downloadMetrics = (format: SponsorReportExportFormat) =>
    run(() =>
      buildSponsorReportExport(
        [
          t("eventSponsorReport.download.columns.day"),
          t("eventSponsorReport.download.columns.viewsUnique"),
          t("eventSponsorReport.download.columns.clicksUnique"),
          t("eventSponsorReport.download.columns.ctr"),
          t("eventSponsorReport.download.columns.materialOpens"),
          t("eventSponsorReport.download.columns.leadsNew"),
        ],
        publicMetricsRows(daily),
        {
          format,
          prefix: t("eventSponsorReport.download.prefix"),
          sheetName: t("eventSponsorReport.download.sheetName"),
          nowIso: new Date().toISOString(),
        },
      ),
    );

  const downloadLeads = (rows: PublicSponsorLead[], format: SponsorReportExportFormat) =>
    run(() =>
      buildLeadExport(rows, {
        format,
        lang,
        prefix: t("eventSponsorReport.leads.prefix"),
        nowIso: new Date().toISOString(),
      }),
    );

  const ctr = formatCtr(sponsorCtr(totals.clicksUnique, totals.viewsUnique), lang);
  const leads = report.leads;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("eventSponsorReport.title")}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {report.sponsor.logoUrl === null ? null : (
            <img
              src={brandedMediaUrl(report.sponsor.logoUrl)}
              alt=""
              className="h-12 w-24 rounded-[6px] object-contain"
            />
          )}
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold text-foreground">
              {report.sponsor.name}
            </h1>
            {tier === "" ? null : <p className="text-sm text-muted-foreground">{tier}</p>}
          </div>
        </div>
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">
              {t("eventSponsorReport.eventLabel")}:
            </span>{" "}
            {eventTitle}
            {report.event.startsAt === null
              ? null
              : ` · ${formatEventDate(report.event.startsAt, tz, lang)}`}
          </p>
          {report.generatedAt === null ? null : (
            <p>
              {t("eventSponsorReport.generatedAt", {
                date: formatEventDateTime(report.generatedAt, tz, lang, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              })}
            </p>
          )}
          {report.link.expiresAt === null ? null : (
            <p>
              {t("eventSponsorReport.validUntil", {
                date: formatEventDate(report.link.expiresAt, tz, lang),
              })}
            </p>
          )}
        </div>
        <p className="rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("eventSponsorReport.consentNote")}
        </p>
      </header>

      <section aria-labelledby="sponsor-report-kpi" className="space-y-3">
        <h2 id="sponsor-report-kpi" className="text-lg font-semibold">
          {t("eventSponsorReport.kpi.label")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Kpi
            label={t("eventSponsorReport.kpi.views")}
            value={count(totals.viewsUnique)}
            hint={t("eventSponsorReport.kpi.viewsHint", { count: totals.viewsTotal })}
          />
          <Kpi
            label={t("eventSponsorReport.kpi.clicks")}
            value={count(totals.clicksUnique)}
            hint={t("eventSponsorReport.kpi.clicksHint", { count: totals.clicksTotal })}
          />
          <Kpi
            label={t("eventSponsorReport.kpi.ctr")}
            value={ctr}
            hint={t("eventSponsorReport.kpi.ctrHint")}
          />
          <Kpi
            label={t("eventSponsorReport.kpi.materialOpens")}
            value={count(totals.materialOpens)}
          />
          <Kpi
            label={t("eventSponsorReport.kpi.leads")}
            value={count(totals.leadsTotal)}
            hint={t("eventSponsorReport.kpi.leadsHint", { count: totals.leadsConsented })}
          />
          <Kpi
            label={t("eventSponsorReport.kpi.meetings")}
            value={count(totals.meetingsHeld)}
            hint={t("eventSponsorReport.kpi.meetingsHint", { count: totals.meetingsScheduled })}
          />
        </div>
      </section>

      <section aria-labelledby="sponsor-report-chart" className="space-y-3">
        <h2 id="sponsor-report-chart" className="text-lg font-semibold">
          {t("eventSponsorReport.chart.title")}
        </h2>
        {daily.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("eventSponsorReport.chart.empty")}</p>
        ) : (
          <Chart
            config={chartConfig}
            lang={chartLangFrom(lang)}
            ariaLabel={t("eventSponsorReport.chart.title")}
          />
        )}
      </section>

      <section aria-labelledby="sponsor-report-table" className="space-y-3">
        <h2 id="sponsor-report-table" className="text-lg font-semibold">
          {t("eventSponsorReport.table.title")}
        </h2>
        {report.placements.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("eventSponsorReport.table.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("eventSponsorReport.table.placement")}</TableHead>
                  <TableHead className="text-right">
                    {t("eventSponsorReport.table.views")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("eventSponsorReport.table.clicks")}
                  </TableHead>
                  <TableHead className="text-right">{t("eventSponsorReport.table.ctr")}</TableHead>
                  <TableHead className="text-right">
                    {t("eventSponsorReport.table.materialOpens")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.placements.map((row) => (
                  <TableRow key={row.placement}>
                    <TableCell>{t(PUBLIC_PLACEMENT_LABEL_KEYS[row.placement])}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(row.viewsUnique)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(row.clicksUnique)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCtr(sponsorCtr(row.clicksUnique, row.viewsUnique), lang) ?? "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(row.materialOpens)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-labelledby="sponsor-report-download" className="space-y-3">
        <h2 id="sponsor-report-download" className="text-lg font-semibold">
          {t("eventSponsorReport.download.title")}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void downloadMetrics("csv")}
          >
            {t("eventSponsorReport.download.metricsCsv")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void downloadMetrics("xlsx")}
          >
            {t("eventSponsorReport.download.metricsXlsx")}
          </Button>
        </div>
        {failed ? (
          <p role="alert" className="text-sm text-destructive">
            {t("eventSponsorReport.download.failed")}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="sponsor-report-leads" className="space-y-3">
        <h2 id="sponsor-report-leads" className="text-lg font-semibold">
          {t("eventSponsorReport.leads.title")}
        </h2>
        {leads === null ? (
          <p className="text-sm text-muted-foreground">
            {t("eventSponsorReport.leads.notIncluded")}
          </p>
        ) : leads.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("eventSponsorReport.leads.empty")}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("eventSponsorReport.leads.hint")}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void downloadLeads(leads, "csv")}
              >
                {t("eventSponsorReport.leads.downloadCsv")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void downloadLeads(leads, "xlsx")}
              >
                {t("eventSponsorReport.leads.downloadXlsx")}
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
