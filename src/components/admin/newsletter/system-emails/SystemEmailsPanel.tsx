// Organizm: /admin/newsletter/system-emails - log wysyłek maili systemowych.
//
// Układ powtarza DeliverabilityPanel (te same filtry, ta sama tabela), bo
// operator przechodzi między tymi ekranami naprzemiennie.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { uiLang, uiLocale } from "@/lib/i18n/format";
import { AlertTriangle, MailCheck, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Chart } from "@/components/charts/Chart";
import type { ChartConfig } from "@/lib/charts/types";
import {
  getSystemEmailReport,
  type SystemEmailRow,
  type SystemEmailStatus,
} from "@/lib/system-emails.functions";
import { cn } from "@/lib/utils";
import "@/lib/i18n-system-emails";

const RANGES = [1, 7, 30] as const;
type Range = (typeof RANGES)[number];

const STATUSES: readonly SystemEmailStatus[] = ["sent", "pending", "dlq", "suppressed"];

const PAGE_SIZE = 50;

function statusTone(status: SystemEmailStatus): string {
  if (status === "sent") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  if (status === "pending") return "bg-amber-500/10 text-amber-600 border-amber-500/20";
  if (status === "suppressed") return "bg-muted text-muted-foreground border-border";
  return "bg-destructive/10 text-destructive border-destructive/20";
}

export function SystemEmailsPanel() {
  const { t, i18n } = useTranslation();
  const locale = uiLocale(i18n.language);

  const [days, setDays] = useState<Range>(7);
  const [template, setTemplate] = useState<string | null>(null);
  const [status, setStatus] = useState<SystemEmailStatus | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const reportFn = useServerFn(getSystemEmailReport);
  const report = useQuery({
    queryKey: ["system-emails", days, template, status, search, page],
    queryFn: () =>
      reportFn({
        data: {
          days,
          template,
          status,
          search: search.trim() ? search.trim() : null,
          page,
          pageSize: PAGE_SIZE,
        },
      }),
  });

  const data = report.data;

  const chart: ChartConfig | null = useMemo(() => {
    const series = data?.series ?? [];
    if (series.length === 0) return null;
    const label = (day: string) =>
      new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
      });
    return {
      kind: "line",
      title: t("systemEmails.chart.title"),
      description: "",
      categories: series.map((p) => label(p.day)),
      series: [
        { name: t("systemEmails.chart.sent"), values: series.map((p) => p.sent), colorSlot: 1 },
        { name: t("systemEmails.chart.failed"), values: series.map((p) => p.failed), colorSlot: 2 },
        {
          name: t("systemEmails.chart.suppressed"),
          values: series.map((p) => p.suppressed),
          colorSlot: 3,
        },
      ],
      stacked: false,
      unit: "",
      height: 220,
      showLegend: true,
      showGrid: true,
      showValues: false,
      animate: false,
      source: "",
    };
  }, [data?.series, locale, t]);

  const rows: SystemEmailRow[] = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.rowsTotal ?? 0) / PAGE_SIZE));

  const kpis = [
    { key: "total", value: data?.totals.total ?? 0 },
    { key: "sent", value: data?.totals.sent ?? 0 },
    { key: "failed", value: data?.totals.failed ?? 0 },
    { key: "suppressed", value: data?.totals.suppressed ?? 0 },
    { key: "pending", value: data?.totals.pending ?? 0 },
  ] as const;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="font-display text-xl flex items-center gap-2">
            <MailCheck className="w-5 h-5 text-primary" aria-hidden />
            {t("systemEmails.title")}
          </h2>
          <p className="text-[0.8125rem] text-muted-foreground mt-1">
            {t("systemEmails.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-md bg-muted/60 border border-border/60">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setDays(r);
                  setPage(1);
                }}
                className={cn(
                  "px-3 py-1.5 rounded-[6px] text-xs font-medium transition-colors",
                  days === r
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`systemEmails.range.d${r}`)}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            className="h-9 rounded-[6px]"
            onClick={() => report.refetch()}
            disabled={report.isFetching}
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", report.isFetching && "animate-spin")} />
            {t("systemEmails.refresh")}
          </Button>
        </div>
      </header>

      {data && !data.infraReady ? (
        <div className="flex items-start gap-2 rounded-[6px] border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[0.8125rem] text-amber-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
          <span>{t("systemEmails.notReady")}</span>
        </div>
      ) : null}

      {report.isError ? (
        <p className="text-[0.8125rem] text-destructive">{t("systemEmails.error")}</p>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((kpi) => (
          <div key={kpi.key} className="rounded-[6px] border border-border bg-card p-4">
            <p className="text-[0.75rem] text-muted-foreground">
              {t(`systemEmails.kpi.${kpi.key}`)}
            </p>
            <p className="font-display text-2xl mt-1 tabular-nums">{kpi.value}</p>
          </div>
        ))}
        <div className="rounded-[6px] border border-border bg-card p-4">
          <p className="text-[0.75rem] text-muted-foreground">{t("systemEmails.kpi.rate")}</p>
          <p className="font-display text-2xl mt-1 tabular-nums">
            {data?.deliveryRate === null || data?.deliveryRate === undefined
              ? "-"
              : `${(data.deliveryRate * 100).toFixed(1)}%`}
          </p>
        </div>
      </div>

      {chart ? (
        <div className="rounded-[6px] border border-border bg-card p-4">
          <Chart config={chart} lang={uiLang(i18n.language)} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("systemEmails.filters.search")}
            className="pl-9 h-9 rounded-[6px] text-[0.8125rem]"
          />
        </div>
        <Select
          value={template ?? "all"}
          onValueChange={(value) => {
            setTemplate(value === "all" ? null : value);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-9 w-[180px] rounded-[6px] text-[0.8125rem]">
            <SelectValue placeholder={t("systemEmails.filters.template")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("systemEmails.filters.all")}</SelectItem>
            {(data?.templates ?? []).map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status ?? "all"}
          onValueChange={(value) => {
            setStatus(value === "all" ? null : (value as SystemEmailStatus));
            setPage(1);
          }}
        >
          <SelectTrigger className="h-9 w-[180px] rounded-[6px] text-[0.8125rem]">
            <SelectValue placeholder={t("systemEmails.filters.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("systemEmails.filters.all")}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`systemEmails.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[0.75rem] text-muted-foreground ml-auto">
          {t("systemEmails.suppressed", { count: data?.suppressedRecipients ?? 0 })}
        </span>
      </div>

      <div className="rounded-[6px] border border-border overflow-hidden">
        <table className="w-full text-[0.8125rem]">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2">
                {t("systemEmails.table.template")}
              </th>
              <th className="text-left font-medium px-4 py-2">
                {t("systemEmails.table.recipient")}
              </th>
              <th className="text-left font-medium px-4 py-2">{t("systemEmails.table.status")}</th>
              <th className="text-left font-medium px-4 py-2">{t("systemEmails.table.date")}</th>
              <th className="text-left font-medium px-4 py-2">{t("systemEmails.table.error")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  {t("systemEmails.table.empty")}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.messageId} className="border-t border-border/60">
                  <td className="px-4 py-2">{row.templateName}</td>
                  <td className="px-4 py-2">{row.recipientEmail}</td>
                  <td className="px-4 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-[6px] border px-2 py-0.5 text-[0.6875rem] font-medium",
                        statusTone(row.status),
                      )}
                    >
                      {t(`systemEmails.status.${row.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-2 tabular-nums text-muted-foreground">
                    {row.createdAt
                      ? new Date(row.createdAt).toLocaleString(locale, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : "-"}
                  </td>
                  <td className="px-4 py-2 text-destructive max-w-[280px] truncate">
                    {row.errorMessage ?? ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.75rem] text-muted-foreground">
          {t("systemEmails.table.showing", { shown: rows.length, total: data?.rowsTotal ?? 0 })}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-9 rounded-[6px]"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t("systemEmails.table.prev")}
          </Button>
          <Button
            variant="outline"
            className="h-9 rounded-[6px]"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("systemEmails.table.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
