// Organizm: /admin/newsletter/auth-logs - diagnostyka webhooka maili
// autoryzacyjnych. Układ i filtry powtarzają SystemEmailsPanel, żeby operator
// mógł przechodzić między ekranami bez zmiany nawyków.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Languages, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getAuthEmailEvents,
  type AuthEmailEventRow,
  type AuthEventStatus,
} from "@/lib/auth-email-events.functions";
import { uiLocale } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import "@/lib/i18n-auth-email-logs";
import {
  ALL_OPTION,
  PAGE_SIZE,
  RANGES,
  STATUSES,
  TYPES,
  filterOption,
  filterValue,
  langLabel,
  langSourceKey,
  rowTimestamp,
  searchValue,
  statusTone,
  totalPages as totalPagesFor,
  type Range,
} from "./authLogsView";

export function AuthEmailLogsPanel() {
  const { t, i18n } = useTranslation();
  const locale = uiLocale(i18n.language);

  const [days, setDays] = useState<Range>(7);
  const [emailType, setEmailType] = useState<string | null>(null);
  const [lang, setLang] = useState<"pl" | "en" | null>(null);
  const [status, setStatus] = useState<AuthEventStatus | null>(null);
  const [fallbackOnly, setFallbackOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const eventsFn = useServerFn(getAuthEmailEvents);
  const report = useQuery({
    queryKey: ["auth-email-events", days, emailType, lang, status, fallbackOnly, search, page],
    queryFn: () =>
      eventsFn({
        data: {
          days,
          emailType,
          lang,
          status,
          fallbackOnly,
          search: searchValue(search),
          page,
          pageSize: PAGE_SIZE,
        },
      }),
  });

  const data = report.data;
  const rows: AuthEmailEventRow[] = data?.rows ?? [];
  const totalPages = totalPagesFor(data?.rowsTotal ?? 0);

  const kpis = [
    { key: "total", value: data?.totals.total ?? 0 },
    { key: "enqueued", value: data?.totals.enqueued ?? 0 },
    { key: "failed", value: data?.totals.failed ?? 0 },
    { key: "pl", value: data?.totals.pl ?? 0 },
    { key: "en", value: data?.totals.en ?? 0 },
    { key: "fallback", value: data?.totals.fallback ?? 0 },
  ] as const;

  const resetPage = () => setPage(1);

  return (
    <div className="space-y-5 py-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <Languages className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-lg leading-tight">{t("authEmailLogs.title")}</h2>
            <p className="text-xs text-muted-foreground max-w-2xl mt-1">
              {t("authEmailLogs.subtitle")}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          onClick={() => void report.refetch()}
          disabled={report.isFetching}
        >
          <RefreshCw className={cn("w-3.5 h-3.5 mr-2", report.isFetching && "animate-spin")} />
          {t("authEmailLogs.refresh")}
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border/60">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setDays(r);
                resetPage();
              }}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                days === r
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`authEmailLogs.range.d${r}`)}
            </button>
          ))}
        </div>

        <Select
          value={filterOption(emailType)}
          onValueChange={(v) => {
            setEmailType(filterValue(v));
            resetPage();
          }}
        >
          <SelectTrigger className="h-9 w-[170px] text-xs">
            <SelectValue placeholder={t("authEmailLogs.filters.type")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_OPTION}>{t("authEmailLogs.filters.all")}</SelectItem>
            {TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filterOption(lang)}
          onValueChange={(v) => {
            setLang(filterValue(v) as "pl" | "en" | null);
            resetPage();
          }}
        >
          <SelectTrigger className="h-9 w-[130px] text-xs">
            <SelectValue placeholder={t("authEmailLogs.filters.lang")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_OPTION}>{t("authEmailLogs.filters.all")}</SelectItem>
            <SelectItem value="pl">PL</SelectItem>
            <SelectItem value="en">EN</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filterOption(status)}
          onValueChange={(v) => {
            setStatus(filterValue(v) as AuthEventStatus | null);
            resetPage();
          }}
        >
          <SelectTrigger className="h-9 w-[150px] text-xs">
            <SelectValue placeholder={t("authEmailLogs.filters.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_OPTION}>{t("authEmailLogs.filters.all")}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`authEmailLogs.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          type="button"
          onClick={() => {
            setFallbackOnly((prev) => !prev);
            resetPage();
          }}
          className={cn(
            "h-9 px-3 rounded-md border text-xs font-medium transition-colors",
            fallbackOnly
              ? "bg-primary/10 border-primary/30 text-primary"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {t("authEmailLogs.filters.fallbackOnly")}
        </button>

        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
            placeholder={t("authEmailLogs.filters.search")}
            className="h-9 pl-9 text-xs"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((kpi) => (
          <div key={kpi.key} className="rounded-lg border border-border/60 bg-card p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t(`authEmailLogs.kpi.${kpi.key}`)}
            </div>
            <div className="font-display text-xl mt-1">{kpi.value}</div>
          </div>
        ))}
      </div>

      {(data?.bySource.length ?? 0) > 0 && (
        <div className="rounded-lg border border-border/60 bg-card p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
            {t("authEmailLogs.sources.title")}
          </div>
          <div className="flex flex-wrap gap-2">
            {data?.bySource.map((entry) => (
              <span
                key={entry.source}
                className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-xs"
              >
                {t(`authEmailLogs.sources.${entry.source}`, {
                  defaultValue: entry.source,
                })}
                <span className="font-medium">{entry.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {report.isError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertTriangle className="w-3.5 h-3.5" />
          {t("authEmailLogs.error")}
        </div>
      )}

      {data && !data.infraReady && (
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
          {t("authEmailLogs.notReady")}
        </div>
      )}

      <div className="rounded-lg border border-border/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2">{t("authEmailLogs.table.date")}</th>
                <th className="text-left font-medium px-3 py-2">{t("authEmailLogs.table.type")}</th>
                <th className="text-left font-medium px-3 py-2">{t("authEmailLogs.table.lang")}</th>
                <th className="text-left font-medium px-3 py-2">
                  {t("authEmailLogs.table.source")}
                </th>
                <th className="text-left font-medium px-3 py-2">
                  {t("authEmailLogs.table.recipient")}
                </th>
                <th className="text-left font-medium px-3 py-2">
                  {t("authEmailLogs.table.sender")}
                </th>
                <th className="text-left font-medium px-3 py-2">
                  {t("authEmailLogs.table.subject")}
                </th>
                <th className="text-left font-medium px-3 py-2">
                  {t("authEmailLogs.table.redirect")}
                </th>
                <th className="text-left font-medium px-3 py-2">
                  {t("authEmailLogs.table.status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                    {t("authEmailLogs.table.empty")}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border/50 align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {rowTimestamp(row.createdAt, locale, {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.emailType}</td>
                  <td className="px-3 py-2 uppercase">{langLabel(row.lang)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-block rounded border px-1.5 py-0.5",
                        row.langFallback
                          ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {t(langSourceKey(row.langSource).key, {
                        defaultValue: langSourceKey(row.langSource).fallbackText,
                      })}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.recipientMasked ?? "-"}</td>
                  <td className="px-3 py-2">{row.sender ?? "-"}</td>
                  <td className="px-3 py-2 max-w-[260px] truncate" title={row.subject ?? ""}>
                    {row.subject ?? "-"}
                  </td>
                  <td
                    className="px-3 py-2 max-w-[220px] truncate text-muted-foreground"
                    title={row.redirectTo ?? ""}
                  >
                    {row.redirectTo ?? "-"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-block rounded border px-1.5 py-0.5",
                        statusTone(row.status),
                      )}
                      title={row.errorMessage ?? undefined}
                    >
                      {t(`authEmailLogs.status.${row.status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {t("authEmailLogs.table.showing", {
            shown: rows.length,
            total: data?.rowsTotal ?? 0,
          })}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t("authEmailLogs.table.prev")}
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("authEmailLogs.table.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
