// Organizm: wyjątki licznika artykułów dla pojedynczych treści - reguły
// `content_access` z `metering_policy ≠ inherit`. Reużywa go hub S7.
//
// TO SĄ TE SAME WIERSZE, KTÓRE EDYTUJE `AccessSettingsPane` w edytorze wpisu
// i strony. Do S1 paywall zapisywał je ślepym UPDATE po `id` pod własnym
// kluczem `["metering-overrides"]`, a edytor miał blokadę wersji: zapis
// w jednym miejscu kończył się fałszywym konfliktem albo cofnięciem decyzji
// w drugim, a cache nie odświeżał się w żadną stronę (DIAGNOZA #6). Teraz oba
// ekrany piszą przez `saveContentAccessRule` (patch `metering_policy` z tokenem
// `updated_at` wiersza) i unieważniają te same klucze (`accessKeys.rule`,
// `accessKeys.overrides`).
//
// LISTA BEZ CICHEGO LIMITU (DIAGNOZA #7). Dawne `limit(200)` sprawiało, że
// wyjątek numer 201 nie istniał dla admina; teraz stronicowanie z liczbą
// i wyszukiwanie po tytule (`meteringOverridesQueryOptions`). Plik (`media`)
// ma własną etykietę - wcześniej był opisany jako „Strona".
import { useEffect, useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal } from "lucide-react";

import { SectionCard } from "@/components/admin/membership/atoms/SectionCard";
import { showSaveError } from "@/components/admin/pricing/saveErrorToast";
import { FormSelect } from "@/components/atoms/FormSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  meteringOverridesQueryOptions,
  useSetMeteringOverridePolicy,
  type MeteringOverrideRow,
} from "@/lib/access/contentAccessQueries";
import type { MeteringPolicy } from "@/lib/access/metering";
import { ensureI18n } from "@/lib/i18n-admin-paywall-sync";

const POLICIES: readonly MeteringPolicy[] = ["inherit", "metered", "exempt"];
const ACCESS_MODES = ["public", "members", "paid", "password"] as const;

/** Opóźnienie wyszukiwania: fraza trafia do klucza dopiero po przerwie w pisaniu. */
const SEARCH_DEBOUNCE_MS = 300;

export function MeteringOverridesCard({ readOnly = false }: { readOnly?: boolean }) {
  ensureI18n();
  const { t } = useTranslation();
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search);
      // Nowa fraza = inna lista; strona 3 starej frazy nie ma tu sensu.
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  const overridesQ = useQuery(meteringOverridesQueryOptions({ search: query, page }));
  const setPolicyM = useSetMeteringOverridePolicy();
  const data = overridesQ.data;
  const rows = data?.rows ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const setPolicy = async (row: MeteringOverrideRow, policy: MeteringPolicy) => {
    try {
      await setPolicyM.mutateAsync({
        entityType: row.entity_type,
        entityId: row.entity_id,
        policy,
        expectedUpdatedAt: row.updated_at,
      });
      toast.success(t("adminPaywall.overrides.saved"));
    } catch (err) {
      showSaveError(err, t, () => void overridesQ.refetch());
    }
  };

  return (
    <SectionCard
      icon={SlidersHorizontal}
      title={t("adminPaywall.overrides.title")}
      description={t("adminPaywall.overrides.subtitle")}
    >
      <div className="max-w-sm">
        <Label htmlFor={searchId}>{t("adminPaywall.overrides.search")}</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id={searchId}
            type="search"
            className="pl-8"
            placeholder={t("adminPaywall.overrides.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {overridesQ.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          {t("adminPaywall.overrides.readError")}
          <Button size="sm" variant="outline" onClick={() => void overridesQ.refetch()}>
            {t("adminPaywall.overrides.retry")}
          </Button>
        </div>
      ) : overridesQ.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("common.loading")}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query.trim()
            ? t("adminPaywall.overrides.noMatches", { query: query.trim() })
            : t("adminPaywall.overrides.empty")}
        </p>
      ) : (
        <>
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label={t("adminPaywall.overrides.caption")}
          >
            <table className="w-full text-sm">
              <caption className="sr-only">{t("adminPaywall.overrides.caption")}</caption>
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="p-2 text-left font-medium">
                    {t("adminPaywall.overrides.colEntity")}
                  </th>
                  <th scope="col" className="p-2 text-left font-medium">
                    {t("adminPaywall.overrides.colMode")}
                  </th>
                  <th scope="col" className="w-56 p-2 text-left font-medium">
                    {t("adminPaywall.overrides.colPolicy")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="p-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 rounded-[6px] bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {t(`adminPaywall.overrides.entity.${row.entity_type}`)}
                        </span>
                        <EntityTitle row={row} />
                      </div>
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {(ACCESS_MODES as readonly string[]).includes(row.mode)
                        ? t(`adminPaywall.overrides.mode.${row.mode}`)
                        : row.mode}
                    </td>
                    <td className="p-2">
                      <FormSelect
                        aria-label={t("adminPaywall.overrides.policyLabel", { title: row.title })}
                        className="h-8"
                        value={row.metering_policy}
                        disabled={readOnly || setPolicyM.isPending}
                        onValueChange={(next) => void setPolicy(row, next as MeteringPolicy)}
                        options={POLICIES.map((policy) => ({
                          value: policy,
                          label: t(`adminPaywall.overrides.policy.${policy}`),
                        }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span aria-live="polite">
              {t("adminPaywall.overrides.pageInfo", {
                page: page + 1,
                pages,
                count: data?.total ?? 0,
              })}
            </span>
            <div className="flex gap-1.5">
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                aria-label={t("adminPaywall.overrides.prev")}
                disabled={page === 0 || overridesQ.isFetching}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                aria-label={t("adminPaywall.overrides.next")}
                disabled={page + 1 >= pages || overridesQ.isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </>
      )}
    </SectionCard>
  );
}

/** Tytuł z linkiem do edytora (wpis, strona); plik nie ma edytora pod slugiem. */
function EntityTitle({ row }: { row: MeteringOverrideRow }) {
  if (row.slug && row.entity_type === "post") {
    return (
      <Link
        to="/admin/posts/$slug"
        params={{ slug: row.slug }}
        className="truncate font-medium hover:underline"
      >
        {row.title}
      </Link>
    );
  }
  if (row.slug && row.entity_type === "page") {
    return (
      <Link
        to="/admin/pages/$slug"
        params={{ slug: row.slug }}
        className="truncate font-medium hover:underline"
      >
        {row.title}
      </Link>
    );
  }
  return <span className="truncate font-medium">{row.title}</span>;
}
