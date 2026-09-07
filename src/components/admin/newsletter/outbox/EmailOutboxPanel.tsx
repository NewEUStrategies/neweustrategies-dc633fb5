// Organizm skrzynki wysyłek (/admin/newsletter/outbox).
//
// Kolejność ekranu odpowiada kolejności pytań operatora:
//   1. jaki wycinek czasu oglądam (presety + własny zakres),
//   2. czego szukam (typ wiadomości, status, adres),
//   3. ile tego jest i ile się nie udało (kafle),
//   4. konkretna wiadomość i powód niepowodzenia (tabela).
//
// Liczby i wiersze pochodzą z JEDNEJ, zdeduplikowanej odpowiedzi serwera - kafel
// nigdy nie pokaże innej sumy niż tabela pod nim.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getEmailOutbox, OUTBOX_STATUSES } from "@/lib/admin/emailOutbox.functions";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { uiLocale } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import "@/lib/i18n-admin-email-outbox";

const PRESETS = [
  { days: 1, key: "h24" },
  { days: 7, key: "d7" },
  { days: 30, key: "d30" },
] as const;

const ALL = "__all__";

/** Kolor statusu: zielony = doszło, czerwony = nie doszło, żółty = wstrzymane. */
function statusTone(status: string): string {
  if (status === "sent") return "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400";
  if (status === "pending") return "bg-sky-500/12 text-sky-600 dark:text-sky-400";
  if (status === "suppressed" || status === "complained")
    return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-destructive/12 text-destructive";
}

export function EmailOutboxPanel() {
  const { t, i18n } = useTranslation();
  const locale = uiLocale(i18n.language);

  const [days, setDays] = useState<number>(7);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [template, setTemplate] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const debouncedSearch = useDebouncedValue(search, 300);

  const outboxFn = useServerFn(getEmailOutbox);
  const customRange = Boolean(from && to);

  const params = useMemo(
    () => ({
      days: customRange ? null : days,
      from: customRange ? new Date(`${from}T00:00:00`).toISOString() : null,
      to: customRange ? new Date(`${to}T23:59:59`).toISOString() : null,
      template: template === ALL ? null : template,
      status: status === ALL ? null : status,
      search: debouncedSearch.trim() || null,
      page,
    }),
    [customRange, days, from, to, template, status, debouncedSearch, page],
  );

  const query = useQuery({
    queryKey: ["admin-email-outbox", params],
    queryFn: () => outboxFn({ data: params }),
  });

  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const resetPage = <T,>(setter: (value: T) => void) => {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  };

  const stats = [
    { key: "total", value: data?.stats.total ?? 0, tone: "text-foreground" },
    { key: "sent", value: data?.stats.sent ?? 0, tone: "text-emerald-600 dark:text-emerald-400" },
    { key: "failed", value: data?.stats.failed ?? 0, tone: "text-destructive" },
    {
      key: "suppressed",
      value: data?.stats.suppressed ?? 0,
      tone: "text-amber-600 dark:text-amber-400",
    },
    { key: "pending", value: data?.stats.pending ?? 0, tone: "text-sky-600 dark:text-sky-400" },
  ] as const;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-xl">{t("adminOutbox.title")}</h2>
          <p className="text-sm text-muted-foreground max-w-3xl">{t("adminOutbox.subtitle")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-[6px] gap-2"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={cn("w-4 h-4", query.isFetching && "animate-spin")} />
          {t("adminOutbox.refresh")}
        </Button>
      </header>

      {/* 1. Zakres czasu */}
      <div className="flex flex-wrap items-end gap-3 rounded-[6px] border border-border bg-card p-3">
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">{t("adminOutbox.range.label")}</span>
          <div className="flex items-center gap-1 p-1 rounded-[6px] bg-muted/60 border border-border/60">
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => {
                  setDays(preset.days);
                  setFrom("");
                  setTo("");
                  setPage(1);
                }}
                className={cn(
                  "px-3 h-8 rounded-[6px] text-xs font-medium transition-colors",
                  !customRange && days === preset.days
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`adminOutbox.range.${preset.key}`)}
              </button>
            ))}
          </div>
        </div>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t("adminOutbox.range.from")}</span>
          <Input
            type="date"
            value={from}
            onChange={(e) => resetPage(setFrom)(e.target.value)}
            className="h-10 rounded-[6px] w-[10.5rem]"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t("adminOutbox.range.to")}</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => resetPage(setTo)(e.target.value)}
            className="h-10 rounded-[6px] w-[10.5rem]"
          />
        </label>
        {customRange && (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-[6px] h-10"
            onClick={() => {
              setFrom("");
              setTo("");
              setPage(1);
            }}
          >
            {t("adminOutbox.range.clear")}
          </Button>
        )}
      </div>

      {/* 2. Filtry treści */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Select value={template} onValueChange={resetPage(setTemplate)}>
          <SelectTrigger className="h-10 rounded-[6px]">
            <SelectValue placeholder={t("adminOutbox.filters.template")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("adminOutbox.filters.allTemplates")}</SelectItem>
            {(data?.templates ?? []).map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={resetPage(setStatus)}>
          <SelectTrigger className="h-10 rounded-[6px]">
            <SelectValue placeholder={t("adminOutbox.filters.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("adminOutbox.filters.allStatuses")}</SelectItem>
            {OUTBOX_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`adminOutbox.status.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => resetPage(setSearch)(e.target.value)}
            placeholder={t("adminOutbox.filters.search")}
            className="h-10 rounded-[6px] pl-9"
          />
        </div>
      </div>

      {/* 3. Podsumowanie */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.key} className="rounded-[6px] border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">{t(`adminOutbox.stats.${stat.key}`)}</div>
            <div className={cn("text-2xl font-display leading-tight", stat.tone)}>{stat.value}</div>
          </div>
        ))}
      </div>

      {data?.truncated && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{t("adminOutbox.truncated")}</p>
      )}
      {query.isError && <p className="text-sm text-destructive">{t("adminOutbox.error")}</p>}

      {/* 4. Dziennik */}
      <div className="rounded-[6px] border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2">{t("adminOutbox.table.template")}</th>
                <th className="text-left font-medium px-3 py-2">
                  {t("adminOutbox.table.recipient")}
                </th>
                <th className="text-left font-medium px-3 py-2">{t("adminOutbox.table.status")}</th>
                <th className="text-left font-medium px-3 py-2">
                  {t("adminOutbox.table.createdAt")}
                </th>
                <th className="text-left font-medium px-3 py-2">{t("adminOutbox.table.error")}</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    {t("adminOutbox.table.loading")}
                  </td>
                </tr>
              )}
              {!query.isLoading && (data?.rows.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    {t("adminOutbox.table.empty")}
                  </td>
                </tr>
              )}
              {(data?.rows ?? []).map((row) => (
                <tr key={row.id} className="border-t border-border/60 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{row.templateName}</td>
                  <td className="px-3 py-2 break-all">{row.recipientEmail}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center h-6 px-2 rounded-[6px] text-xs font-medium",
                        statusTone(row.status),
                      )}
                    >
                      {t(`adminOutbox.status.${row.status}`, { defaultValue: row.status })}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString(locale, {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[24rem] break-words">
                    {row.errorMessage ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
          <span>{t("adminOutbox.table.count", { count: data?.total ?? 0 })}</span>
          <div className="flex items-center gap-2">
            <span>{t("adminOutbox.table.page", { page: data?.page ?? 1, pages })}</span>
            <Button
              variant="outline"
              size="sm"
              className="rounded-[6px] h-8"
              disabled={(data?.page ?? 1) <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t("adminOutbox.table.prev")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-[6px] h-8"
              disabled={(data?.page ?? 1) >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("adminOutbox.table.next")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
