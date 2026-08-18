// Karta "NES Edge Cache" w /admin/performance: żywe statystyki wbudowanego
// cache'a dokumentów SSR + ręczny purge (zawężony serwerowo do hosta tenanta).
// Słownik rejestruje nakładka i18n w tym samym chunku trasy.
import "@/lib/i18n-admin-edge-cache";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { RefreshCw, Search, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FloatingInput } from "@/components/ui/floating-input";
import {
  getEdgeCacheStats,
  probeEdgeCache,
  purgeEdgeCache,
  type DocumentCacheProbe,
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

const STATUS_TONE: Record<string, string> = {
  HIT: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  STALE: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  MISS: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  BYPASS: "border-border bg-muted text-muted-foreground",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[status] ?? STATUS_TONE.BYPASS}`}
    >
      {status}
    </span>
  );
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

  const runProbe = useServerFn(probeEdgeCache);
  const [probePath, setProbePath] = useState("/");
  const [probe, setProbe] = useState<DocumentCacheProbe | null>(null);

  const probeMutation = useMutation({
    mutationFn: (path: string) => runProbe({ data: { path } }),
    onSuccess: (result) => setProbe(result),
    onError: () => toast.error(t("adminEdgeCache.diag.probeError")),
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
              <StatTile
                label={t("adminEdgeCache.tiles.revalidations")}
                value={number(snapshot.revalidations)}
              />
              <StatTile
                label={t("adminEdgeCache.tiles.revalidationFailures")}
                value={number(snapshot.revalidationFailures)}
              />
              {/* Rosnące odrzuty rozmiarowe = trasa wypada z cache'a NA STAŁE
                  i każdy czytelnik płaci pełny render SSR (diagnoza 2026-08-18). */}
              <StatTile
                label={t("adminEdgeCache.tiles.oversize")}
                value={number(snapshot.oversize ?? 0)}
              />
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium">{t("adminEdgeCache.l2.title")}</span>
                <span
                  className={[
                    "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    snapshot.l2.enabled
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "border-border bg-muted text-muted-foreground",
                  ].join(" ")}
                >
                  {snapshot.l2.enabled
                    ? t("adminEdgeCache.l2.active")
                    : t("adminEdgeCache.l2.inactive")}
                </span>
              </div>
              {snapshot.l2.enabled && (
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatTile
                    label={t("adminEdgeCache.l2.tiles.hits")}
                    value={number(snapshot.l2.hits)}
                  />
                  <StatTile
                    label={t("adminEdgeCache.l2.tiles.stale")}
                    value={number(snapshot.l2.stale)}
                  />
                  <StatTile
                    label={t("adminEdgeCache.l2.tiles.stores")}
                    value={number(snapshot.l2.stores)}
                  />
                  <StatTile
                    label={t("adminEdgeCache.l2.tiles.bumps")}
                    value={number(snapshot.l2.bumps)}
                  />
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">{t("adminEdgeCache.l2.note")}</p>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
              <div className="text-xs font-medium">{t("adminEdgeCache.diag.title")}</div>
              <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
                {t("adminEdgeCache.diag.note")}
              </p>
              <form
                className="mt-3 flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const path = probePath.trim();
                  if (path.startsWith("/")) probeMutation.mutate(path);
                }}
              >
                <div className="min-w-[220px] flex-1">
                  <FloatingInput
                    label={t("adminEdgeCache.diag.probeLabel")}
                    value={probePath}
                    onChange={(event) => setProbePath(event.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={probeMutation.isPending}
                >
                  <Search className="h-3.5 w-3.5" aria-hidden />
                  {t("adminEdgeCache.diag.probeRun")}
                </Button>
              </form>
              {probe && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <StatusPill status={probe.status} />
                  <span className="font-mono">{probe.path}</span>
                  <span className="text-muted-foreground">
                    {!probe.cacheable
                      ? t("adminEdgeCache.diag.probeBypass", { reason: probe.bypassReason ?? "-" })
                      : probe.cached
                        ? t("adminEdgeCache.diag.probeCached", {
                            status: probe.status,
                            age: probe.ageS ?? 0,
                            fresh: Math.max(0, probe.freshForS ?? 0),
                          })
                        : t("adminEdgeCache.diag.probeMiss")}
                  </span>
                </div>
              )}

              <div className="mt-4 text-xs font-medium">{t("adminEdgeCache.diag.recentTitle")}</div>
              {snapshot.recent.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("adminEdgeCache.diag.recentEmpty")}
                </p>
              ) : (
                <div className="mt-2 max-h-64 overflow-auto rounded-md border border-border/70">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-card">
                      <tr className="text-muted-foreground">
                        <th className="px-2 py-1 font-medium">
                          {t("adminEdgeCache.diag.colTime")}
                        </th>
                        <th className="px-2 py-1 font-medium">
                          {t("adminEdgeCache.diag.colPath")}
                        </th>
                        <th className="px-2 py-1 font-medium">
                          {t("adminEdgeCache.diag.colStatus")}
                        </th>
                        <th className="px-2 py-1 font-medium">
                          {t("adminEdgeCache.diag.colDetail")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.recent.map((decision, index) => (
                        <tr
                          key={`${decision.at}-${decision.path}-${index}`}
                          className="border-t border-border/60"
                        >
                          <td className="px-2 py-1 tabular-nums text-muted-foreground">
                            {new Date(decision.at).toLocaleTimeString(locale)}
                          </td>
                          <td className="max-w-[240px] truncate px-2 py-1 font-mono">
                            {decision.path}
                          </td>
                          <td className="px-2 py-1">
                            <StatusPill status={decision.status} />
                          </td>
                          <td className="px-2 py-1 text-muted-foreground">
                            {[
                              decision.ageS === undefined ? null : `age ${decision.ageS}s`,
                              decision.renderMs === undefined ? null : `ssr ${decision.renderMs}ms`,
                              decision.cacheControl ?? null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
