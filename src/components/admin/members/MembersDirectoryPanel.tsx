// Organizm katalogu członków (/admin/members).
//
// Kolejność ekranu odpowiada pytaniom operatora:
//   1. kogo szukam (adres/nazwa/firma, filtr planu),
//   2. jaki ma plan i skąd ten plan wynika (kolumna „Podstawa"),
//   3. ile zapłacił i kiedy,
//   4. co mogę zrobić - ręczne nadanie planu bez udziału operatora płatności.
import { Fragment, useMemo, useState } from "react";
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
import { listMembers, type MemberDirectoryRow } from "@/lib/admin/membersDirectory.functions";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { uiLocale } from "@/lib/i18n/format";
import { MemberBillingDetails } from "./MemberBillingDetails";
import { MemberTierDialog } from "./MemberTierDialog";
import "@/lib/i18n-admin-members";

const ALL = "__all__";

function sourceTone(source: MemberDirectoryRow["tierSource"]): string {
  if (source === "grant") return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  if (source === "subscription") return "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400";
  return "bg-muted text-muted-foreground";
}

export function MembersDirectoryPanel() {
  const { t, i18n } = useTranslation();
  const locale = uiLocale(i18n.language);

  const [search, setSearch] = useState<string>("");
  const [tier, setTier] = useState<string>(ALL);
  const [page, setPage] = useState<number>(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemberDirectoryRow | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  const membersFn = useServerFn(listMembers);

  const params = useMemo(
    () => ({
      search: debouncedSearch.trim() ? debouncedSearch.trim() : null,
      tierKey: tier === ALL ? null : tier,
      page,
    }),
    [debouncedSearch, tier, page],
  );

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["admin-members", params],
    queryFn: () => membersFn({ data: params }),
  });

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    return tier === ALL ? all : all.filter((row) => row.tierKey === tier);
  }, [data, tier]);

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25)));

  const money = (cents: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("adminMembers.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("adminMembers.subtitle")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="rounded-[6px]"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("adminMembers.refresh")}
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="h-12 rounded-[6px] pl-9"
            placeholder={t("adminMembers.filters.search")}
            aria-label={t("adminMembers.filters.search")}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          value={tier}
          onValueChange={(value) => {
            setTier(value);
            setPage(1);
          }}
        >
          <SelectTrigger
            className="h-12 w-[220px] rounded-[6px]"
            aria-label={t("adminMembers.filters.tier")}
          >
            <SelectValue placeholder={t("adminMembers.filters.allTiers")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("adminMembers.filters.allTiers")}</SelectItem>
            {(data?.tiers ?? []).map((entry) => (
              <SelectItem key={entry.key} value={entry.key}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <p className="rounded-[6px] bg-destructive/10 p-4 text-sm text-destructive">
          {t("adminMembers.error")}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-[6px] border border-border">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">{t("adminMembers.table.member")}</th>
              <th className="px-4 py-3">{t("adminMembers.table.tier")}</th>
              <th className="px-4 py-3">{t("adminMembers.table.source")}</th>
              <th className="px-4 py-3">{t("adminMembers.table.paid")}</th>
              <th className="px-4 py-3">{t("adminMembers.table.lastPayment")}</th>
              <th className="px-4 py-3 text-right">{t("adminMembers.table.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                  {t("adminMembers.table.loading")}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                  {t("adminMembers.table.empty")}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <Fragment key={row.userId}>
                  <tr className="border-t border-border align-middle">
                    <td className="px-4 py-3">
                      <div className="font-medium">{row.displayName ?? row.email}</div>
                      <div className="text-xs text-muted-foreground">{row.email}</div>
                    </td>
                    <td className="px-4 py-3 font-medium">{row.tierName}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-[6px] px-2 py-1 text-xs font-medium ${sourceTone(row.tierSource)}`}
                      >
                        {t(`adminMembers.source.${row.tierSource}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">{money(row.paidCents, row.currency)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.lastPaymentAt
                        ? new Date(row.lastPaymentAt).toLocaleDateString(locale)
                        : t("adminMembers.table.never")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="rounded-[6px]"
                          onClick={() => setExpanded(expanded === row.userId ? null : row.userId)}
                        >
                          {expanded === row.userId
                            ? t("adminMembers.details.hide")
                            : t("adminMembers.details.show")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="rounded-[6px]"
                          onClick={() => setEditing(row)}
                        >
                          {t("adminMembers.grant.open")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {expanded === row.userId ? (
                    <tr className="border-t border-border">
                      <td colSpan={6} className="p-3">
                        <MemberBillingDetails userId={row.userId} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{t("adminMembers.table.count", { count: data?.total ?? 0 })}</span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-[6px]"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            {t("adminMembers.table.prev")}
          </Button>
          <span>{t("adminMembers.table.page", { page, pages })}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-[6px]"
            disabled={page >= pages}
            onClick={() => setPage((value) => value + 1)}
          >
            {t("adminMembers.table.next")}
          </Button>
        </div>
      </div>

      <MemberTierDialog
        member={editing}
        tiers={data?.tiers ?? []}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}
