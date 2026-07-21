// Karta "NES Edge Cache" w /admin/performance: żywe statystyki wbudowanego
// cache'a dokumentów SSR + ręczny purge (zawężony serwerowo do hosta tenanta).
// Słownik rejestruje nakładka i18n w tym samym chunku trasy.
import "@/lib/i18n-admin-edge-cache";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { RefreshCw, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getEdgeCacheStats,
  purgeEdgeCache,
  type DocumentCacheSnapshot,
} from "@/lib/edgeCache.functions";

const STATS_QUERY_KEY = ["admin", "edge-cache", "stats"] as const;

function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toLocaleString(locale, { maximumFractionDigits: 0 })} KB`;
  const mb = kb / 1024;
  return `${mb.toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;
}

function hitRatio(snapshot: DocumentCacheSnapshot): number | null {
  const served = snapshot.hits + snapshot.stale;
  const total = served + snapshot.misses;
  if (total === 0) return null;
  return served / total;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function EdgeCacheCard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-GB" : "pl-PL";
  const queryClient = useQueryClient();
  const fetchStats = useServerFn(getEdgeCacheStats);
  const runPurge = useServerFn(purgeEdgeCache);

  const statsQuery = useQuery({
    queryKey: STATS_QUERY_KEY,
    queryFn: () => fetchStats(),
    refetchInterval: 30_000,
  });

  const purgeMutation = useMutation({
    mutationFn: () => runPurge(),
    onSuccess: (result) => {
      queryClient.setQueryData(STATS_QUERY_KEY, result.snapshot);
      toast.success(t("adminEdgeCache.purgeDone", { count: result.removed }));
    },
    onError: () => toast.error(t("adminEdgeCache.purgeError")),
  });

  const snapshot = statsQuery.data;
  const ratio = snapshot ? hitRatio(snapshot) : null;
  const number = (value: number) => value.toLocaleString(locale);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-brand" aria-hidden />
            {t("adminEdgeCache.title")}
            {snapshot && (
              <span
                className={[
                  "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  snapshot.enabled
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-border bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {snapshot.enabled ? t("adminEdgeCache.enabled") : t("adminEdgeCache.disabled")}
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void statsQuery.refetch()}
              disabled={statsQuery.isFetching}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${statsQuery.isFetching ? "animate-spin" : ""}`}
                aria-hidden
              />
              {t("adminEdgeCache.refresh")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => purgeMutation.mutate()}
              disabled={purgeMutation.isPending || !snapshot?.enabled}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t("adminEdgeCache.purge")}
            </Button>
          </div>
        </div>
        <p className="max-w-3xl text-xs text-muted-foreground">{t("adminEdgeCache.subtitle")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {statsQuery.isError && (
          <p className="text-sm text-destructive">{t("adminEdgeCache.loadError")}</p>
        )}
        {snapshot && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              <StatTile
                label={t("adminEdgeCache.tiles.hitRatio")}
                value={
                  ratio === null
                    ? "-"
                    : `${(ratio * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`
                }
              />
              <StatTile
                label={t("adminEdgeCache.tiles.entries")}
                value={number(snapshot.entries)}
              />
              <StatTile
                label={t("adminEdgeCache.tiles.memory")}
                value={`${formatBytes(snapshot.bytes, locale)} / ${formatBytes(snapshot.maxBytes, locale)}`}
              />
              <StatTile label={t("adminEdgeCache.tiles.hits")} value={number(snapshot.hits)} />
              <StatTile label={t("adminEdgeCache.tiles.stale")} value={number(snapshot.stale)} />
              <StatTile label={t("adminEdgeCache.tiles.misses")} value={number(snapshot.misses)} />
              <StatTile label={t("adminEdgeCache.tiles.bypass")} value={number(snapshot.bypass)} />
              <StatTile label={t("adminEdgeCache.tiles.stores")} value={number(snapshot.stores)} />
              <StatTile
                label={t("adminEdgeCache.tiles.evictions")}
                value={number(snapshot.evictions)}
              />
              <StatTile label={t("adminEdgeCache.tiles.purges")} value={number(snapshot.purges)} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("adminEdgeCache.since", {
                date: new Date(snapshot.startedAt).toLocaleString(locale),
              })}{" "}
              {t("adminEdgeCache.isolateNote")}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
