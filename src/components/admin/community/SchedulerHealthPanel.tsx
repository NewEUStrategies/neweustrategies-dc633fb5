// Organizm: panel zdrowia harmonogramu doręczeń (/admin/community/notifications).
//
// Odpowiada na jedno pytanie, na które dotąd nie było odpowiedzi w produkcie:
// CZY KTOŚ WOŁA DYSPOZYTORA. Wcześniej rosnąca kolejka push wyglądała
// identycznie jak brak powiadomień do wysłania, a pg_net (fire-and-forget) nie
// zgłaszał, że puknięcia crona lecą w próżnię.
//
// Panel czyta jeden RPC (job_scheduler_health) i pokazuje trzy warstwy:
//   1. świeżość ostatniego UDANEGO przebiegu + alerty naprawcze,
//   2. stan trzech ścieżek harmonogramu (pg_cron, GitHub Actions, ręcznie),
//   3. głębokość kolejek w tenancie wołającego + log ostatnich przebiegów.
// Przycisk „Uruchom tick teraz" woła TĘ SAMĄ funkcję co cron (runJobsTick), a
// nie osobną, gorszą ścieżkę - i po drodze uzbraja runner bazy.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Gauge,
  Info,
  Mail,
  RefreshCw,
  Send,
  Smartphone,
  XCircle,
} from "@/lib/lucide-shim";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HeartbeatDot } from "@/components/admin/atoms/HeartbeatDot";
import { AdminMetricTile, type MetricTone } from "@/components/admin/molecules/AdminMetricTile";
import { useAuth } from "@/hooks/useAuth";
import { getSchedulerHealth, runSchedulerTickNow } from "@/lib/admin/scheduler.functions";
import { countTickFailures } from "@/lib/jobs/scheduler";
import { relTime } from "@/lib/chat/time";
import { ensureI18n } from "@/lib/i18n-admin-scheduler";

ensureI18n();

/** Odświeżanie co 30 s: panel jest narzędziem dyżurnym, nie dashboardem. */
const REFETCH_MS = 30_000;
/** Od tylu zadań w kolejce backlog jest sygnałem, nie normalnym ruchem. */
const BACKLOG_ALERT_THRESHOLD = 25;

type Lang = "pl" | "en";

/** relTime jest czystym formaterem czasu relatywnego (moduł chat/time). */
function ago(iso: string | null | undefined, lang: Lang, fallback: string): string {
  return iso ? relTime(iso, lang) : fallback;
}

function secondsLabel(seconds: number, lang: Lang): string {
  if (seconds <= 0) return "-";
  return relTime(new Date(Date.now() - seconds * 1000).toISOString(), lang);
}

/**
 * Kod powodu z `invoke_jobs_tick()` (`no_base_url`, `pg_net_unavailable`, ...)
 * na zdanie dla operatora. Nieznany kod pokazujemy surowo - lepiej techniczny
 * ciąg niż pusta linia w miejscu, w którym ktoś diagnozuje awarię.
 */
function tickReason(t: TFunction, code: string | null): string {
  if (!code) return "-";
  return t(`adminScheduler.runner.tickReason.${code}`, { defaultValue: code });
}

export function SchedulerHealthPanel() {
  const { t, i18n } = useTranslation();
  const lang: Lang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const qc = useQueryClient();
  const { isAdmin, roles } = useAuth();
  const loadHealth = useServerFn(getSchedulerHealth);
  const runTick = useServerFn(runSchedulerTickNow);

  // Diagnostyka infrastruktury i wymuszanie ticku to zakres admin/edytor - tak
  // samo jak bramka RPC (has_role admin|super_admin|editor) i middleware
  // requireAdminEditor. Autor jest staffem dla RESZTY panelu, więc bez tej
  // bramki widziałby wyłącznie komunikat błędu i odpytywał zablokowane RPC.
  const maySeeScheduler = isAdmin || roles.includes("editor");

  const health = useQuery({
    queryKey: ["admin", "scheduler-health"],
    queryFn: () => loadHealth(),
    // Odpytywanie w tle NIE wraca po błędzie: nieudany odczyt (brak roli,
    // padnięte RPC) nie ma prawa młócić serwera co 30 s.
    refetchInterval: (query) => (query.state.error ? false : REFETCH_MS),
    retry: false,
    staleTime: 10_000,
    enabled: maySeeScheduler,
  });

  const tick = useMutation({
    mutationFn: () => runTick({ data: undefined }),
    onSuccess: (result) => {
      const failures = countTickFailures(result);
      if (failures.length > 0) {
        toast.error(t("adminScheduler.actions.ranFailed", { message: failures.join("; ") }));
      } else {
        toast.success(t("adminScheduler.actions.ranOk"));
      }
      qc.invalidateQueries({ queryKey: ["admin", "scheduler-health"] });
      qc.invalidateQueries({ queryKey: ["admin-notification-stats"] });
    },
    onError: (err: Error) =>
      toast.error(t("adminScheduler.actions.ranFailed", { message: err.message })),
  });

  // Bez uprawnień panel po prostu nie istnieje - żadnego "błędu ładowania".
  if (!maySeeScheduler) return null;

  if (health.isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="w-4 h-4" />
        <AlertDescription>{t("adminScheduler.actions.loadFailed")}</AlertDescription>
      </Alert>
    );
  }

  const data = health.data;
  const freshness = data?.freshness ?? "never";
  const queue = data?.queue;
  const runner = data?.runner;
  const env = data?.env;

  const lastOk = ago(runner?.lastAppOkAt, lang, "-");
  const backlogAlarming = (queue?.pushPending ?? 0) >= BACKLOG_ALERT_THRESHOLD;
  const pendingTone: MetricTone = backlogAlarming ? "warn" : "neutral";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <Gauge className="w-4 h-4 shrink-0" aria-hidden="true" />
                {t("adminScheduler.title")}
                <HeartbeatDot freshness={freshness} />
              </CardTitle>
              <p className="m-0 text-sm text-muted-foreground">{t("adminScheduler.subtitle")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => health.refetch()}
                disabled={health.isFetching}
              >
                <RefreshCw
                  className={`w-4 h-4 mr-2 ${health.isFetching ? "motion-safe:animate-spin" : ""}`}
                  aria-hidden="true"
                />
                {t("adminScheduler.actions.refresh")}
              </Button>
              <Button size="sm" onClick={() => tick.mutate()} disabled={tick.isPending}>
                <Send className="w-4 h-4 mr-2" aria-hidden="true" />
                {tick.isPending
                  ? t("adminScheduler.actions.running")
                  : t("adminScheduler.actions.runNow")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="m-0 text-sm">
            {data
              ? t(`adminScheduler.headline.${freshness}`, { ago: lastOk })
              : t("adminScheduler.loading")}
          </p>

          {data?.appUnreachable ? (
            <Alert variant="destructive">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription>{t("adminScheduler.alerts.appUnreachable")}</AlertDescription>
            </Alert>
          ) : null}

          {data && (freshness === "stale" || freshness === "never") ? (
            <Alert variant="destructive">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription>{t("adminScheduler.alerts.stale")}</AlertDescription>
            </Alert>
          ) : null}

          {env && !env.vapidConfigured ? (
            <Alert variant="destructive">
              <Smartphone className="w-4 h-4" />
              <AlertDescription>{t("adminScheduler.env.vapidMissing")}</AlertDescription>
            </Alert>
          ) : null}

          {env && !env.emailGatewayConfigured ? (
            <Alert variant="destructive">
              <Mail className="w-4 h-4" />
              <AlertDescription>{t("adminScheduler.env.emailMissing")}</AlertDescription>
            </Alert>
          ) : null}

          {runner && !runner.enabled ? (
            <Alert>
              <Info className="w-4 h-4" />
              <AlertDescription>{t("adminScheduler.runner.notArmed")}</AlertDescription>
            </Alert>
          ) : null}

          {backlogAlarming && queue ? (
            <Alert>
              <Clock className="w-4 h-4" />
              <AlertDescription>
                {t("adminScheduler.alerts.backlog", {
                  count: queue.pushPending,
                  ago: secondsLabel(queue.pushOldestPendingSeconds, lang),
                })}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8">
        <AdminMetricTile
          icon={Clock}
          label={t("adminScheduler.metrics.pushPending")}
          value={queue?.pushPending}
          hint={t("adminScheduler.metrics.pendingHint")}
          tone={pendingTone}
        />
        <AdminMetricTile
          icon={Send}
          label={t("adminScheduler.metrics.pushDueNow")}
          value={queue?.pushDueNow}
          tone={pendingTone}
        />
        <AdminMetricTile
          icon={CheckCircle2}
          label={t("adminScheduler.metrics.pushSent24h")}
          value={queue?.pushSent24h}
          tone="ok"
        />
        <AdminMetricTile
          icon={XCircle}
          label={t("adminScheduler.metrics.pushDead")}
          value={queue?.pushDead}
          tone={(queue?.pushDead ?? 0) > 0 ? "danger" : "neutral"}
        />
        <AdminMetricTile
          icon={CalendarClock}
          label={t("adminScheduler.metrics.oldestPending")}
          value={queue ? secondsLabel(queue.pushOldestPendingSeconds, lang) : undefined}
          hint={t("adminScheduler.metrics.oldestPendingHint")}
          tone={backlogAlarming ? "warn" : "neutral"}
        />
        <AdminMetricTile
          icon={Smartphone}
          label={t("adminScheduler.metrics.subscriptions")}
          value={queue?.pushSubscriptionsActive}
        />
        <AdminMetricTile
          icon={Mail}
          label={t("adminScheduler.metrics.digestDaily")}
          value={queue?.digestDueDaily}
        />
        <AdminMetricTile
          icon={Mail}
          label={t("adminScheduler.metrics.digestWeekly")}
          value={queue?.digestDueWeekly}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("adminScheduler.runner.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={runner?.enabled ? "default" : "destructive"}>
                {runner?.enabled
                  ? t("adminScheduler.runner.enabled")
                  : t("adminScheduler.runner.disabled")}
              </Badge>
              <Badge variant={runner?.secretSet ? "secondary" : "destructive"}>
                {runner?.secretSet
                  ? t("adminScheduler.runner.secretSet")
                  : t("adminScheduler.runner.secretMissing")}
              </Badge>
              <Badge variant={data?.capabilities.pgCron ? "secondary" : "outline"}>
                {data?.capabilities.pgCron
                  ? t("adminScheduler.capabilities.pgCronOn")
                  : t("adminScheduler.capabilities.pgCronOff")}
              </Badge>
              <Badge variant={data?.capabilities.pgNet ? "secondary" : "outline"}>
                {data?.capabilities.pgNet
                  ? t("adminScheduler.capabilities.pgNetOn")
                  : t("adminScheduler.capabilities.pgNetOff")}
              </Badge>
            </div>
            {data && (!data.capabilities.pgCron || !data.capabilities.pgNet) ? (
              <p className="m-0 text-xs text-muted-foreground">
                {t("adminScheduler.capabilities.offHint")}
              </p>
            ) : null}
            <p className="m-0 break-words">
              <span className="text-muted-foreground">{t("adminScheduler.runner.baseUrl")}: </span>
              <code className="text-xs">
                {runner?.baseUrl ||
                  runner?.resolvedBaseUrl ||
                  t("adminScheduler.runner.baseUrlEmpty")}
              </code>
            </p>
            <p className="m-0 text-muted-foreground">
              {runner?.lastInvokedAt
                ? t("adminScheduler.runner.lastInvoke", {
                    ago: ago(runner.lastInvokedAt, lang, "-"),
                    count: runner.tickCount,
                  })
                : t("adminScheduler.runner.lastInvokeNever")}
            </p>
            {/* Telemetria samego crona: gdy puknięcia nie ma, to ona podaje
                przyczynę (wyłączony runner, brak adresu, brak pg_net) - bez
                niej panel mówiłby tylko „brak ticku". */}
            {runner?.lastTickStatus ? (
              <p
                className={
                  runner.lastTickStatus === "dispatched"
                    ? "m-0 text-muted-foreground"
                    : "m-0 text-amber-600 dark:text-amber-400"
                }
              >
                {t(`adminScheduler.runner.tickStatus.${runner.lastTickStatus}`, {
                  reason: tickReason(t, runner.lastTickError),
                  defaultValue: runner.lastTickError ?? runner.lastTickStatus,
                })}
              </p>
            ) : null}
            {/* Puknięcie siatki społeczności (community-cron co 5 min): status
                stoi OSOBNO od minutowego jobs-tick, bo rozjazd tych dwóch linii
                wskazuje, KTÓRA ścieżka bazy wymaga naprawy. */}
            {runner ? (
              runner.communityCron.lastTickStatus ? (
                <p
                  className={
                    runner.communityCron.lastTickStatus === "dispatched"
                      ? "m-0 text-muted-foreground"
                      : "m-0 text-amber-600 dark:text-amber-400"
                  }
                >
                  {t(`adminScheduler.runner.communityTick.${runner.communityCron.lastTickStatus}`, {
                    ago: ago(runner.communityCron.lastTickAt, lang, "-"),
                    count: runner.communityCron.tickCount,
                    reason: tickReason(t, runner.communityCron.lastTickError),
                    defaultValue:
                      runner.communityCron.lastTickError ?? runner.communityCron.lastTickStatus,
                  })}
                </p>
              ) : (
                <p className="m-0 text-muted-foreground">
                  {t("adminScheduler.runner.communityTick.never")}
                </p>
              )
            ) : null}
            {runner?.autoArmedAt ? (
              <p className="m-0 text-muted-foreground">
                {t("adminScheduler.runner.autoArmed", {
                  ago: ago(runner.autoArmedAt, lang, "-"),
                })}
              </p>
            ) : null}
            {runner && runner.failureStreak > 0 ? (
              <p className="m-0 text-destructive">
                {t("adminScheduler.runner.failureStreak", { count: runner.failureStreak })}
              </p>
            ) : null}
            {runner?.lastAppError ? (
              <p className="m-0 break-words text-destructive">
                {t("adminScheduler.runner.lastError", { message: runner.lastAppError })}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge variant={env?.communityCronSecretSet ? "secondary" : "outline"}>
                {env?.communityCronSecretSet
                  ? t("adminScheduler.env.cronSecretOk")
                  : t("adminScheduler.env.cronSecretMissing")}
              </Badge>
              <Badge variant={env?.vapidConfigured ? "secondary" : "destructive"}>
                {env?.vapidConfigured
                  ? t("adminScheduler.env.vapidOk")
                  : t("adminScheduler.env.vapidMissing")}
              </Badge>
              <Badge variant={env?.emailGatewayConfigured ? "secondary" : "destructive"}>
                {env?.emailGatewayConfigured
                  ? t("adminScheduler.env.emailOk")
                  : t("adminScheduler.env.emailMissing")}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("adminScheduler.cron.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data && data.cronJobs.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">{t("adminScheduler.cron.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("adminScheduler.cron.name")}</TableHead>
                      <TableHead>{t("adminScheduler.cron.schedule")}</TableHead>
                      <TableHead>{t("adminScheduler.cron.state")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.cronJobs ?? []).map((job) => (
                      <TableRow key={job.name}>
                        <TableCell className="font-medium">{job.name}</TableCell>
                        <TableCell>
                          <code className="text-xs">{job.schedule}</code>
                        </TableCell>
                        <TableCell>
                          <Badge variant={job.active ? "secondary" : "destructive"}>
                            {job.active
                              ? t("adminScheduler.cron.active")
                              : t("adminScheduler.cron.inactive")}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {(data?.sources ?? []).length > 0 ? (
              <ul className="m-0 list-none space-y-1 p-0 text-xs text-muted-foreground">
                {(data?.sources ?? []).map((stat) => (
                  <li key={stat.source} className="flex flex-wrap items-center gap-2">
                    <HeartbeatDot freshness={stat.lastOkAt ? "fresh" : "never"} withLabel={false} />
                    <span>{t(`adminScheduler.sources.${stat.source}`)}</span>
                    <span className="tabular-nums">
                      {ago(stat.lastOkAt ?? stat.lastAt, lang, "-")}
                    </span>
                    <span className="tabular-nums">
                      {stat.runs24h}/24h
                      {stat.failures24h > 0 ? ` · ${stat.failures24h} ✕` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("adminScheduler.runs.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {data && data.recentRuns.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">{t("adminScheduler.runs.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("adminScheduler.runs.when")}</TableHead>
                    <TableHead>{t("adminScheduler.runs.source")}</TableHead>
                    <TableHead>{t("adminScheduler.runs.job")}</TableHead>
                    <TableHead className="text-right">
                      {t("adminScheduler.runs.duration")}
                    </TableHead>
                    <TableHead>{t("adminScheduler.runs.outcome")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.recentRuns ?? []).map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {ago(run.createdAt, lang, "-")}
                      </TableCell>
                      <TableCell>{t(`adminScheduler.sources.${run.source}`)}</TableCell>
                      <TableCell>
                        <code className="text-xs">{run.job}</code>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{run.durationMs} ms</TableCell>
                      <TableCell>
                        {run.ok ? (
                          <Badge variant="secondary">{t("adminScheduler.runs.ok")}</Badge>
                        ) : (
                          <span className="flex flex-col gap-1">
                            <Badge variant="destructive" className="w-fit">
                              {t("adminScheduler.runs.failed")}
                            </Badge>
                            {run.error ? (
                              <span className="text-xs text-muted-foreground break-words">
                                {run.error}
                              </span>
                            ) : null}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
