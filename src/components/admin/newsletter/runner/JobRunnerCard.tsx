// Organizm: kafel automatu wysyłki (runner zadań tła) na liście kampanii.
//
// Odpowiada na pytanie, którego panel wcześniej nie umiał zadać: nie „czy
// przełącznik jest włączony", ale „czy poczta wychodzi". Runner startował z
// `enabled = false` i pustym adresem, więc świeże wdrożenie nie wysyłało w tle
// NICZEGO - ani zaplanowanych kampanii, ani digestów, ani kolejki
// transakcyjnej - a jedynym śladem była rosnąca kolejka, której panel nie
// pokazywał. Teraz automat jest domyślnie włączony (migracja 20260731120000),
// a kafel pokazuje rozstrzygnięty stan, moment ostatniego ticku i głębokość
// kolejek pocztowych.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FloatingInput } from "@/components/ui/floating-input";
import { Switch } from "@/components/ui/switch";
import { QueueDepthStat } from "@/components/atoms/QueueDepthStat";
import { RunnerStateBadge } from "@/components/atoms/RunnerStateBadge";
import { resolveRunnerState, type RunnerState } from "@/lib/email/runnerHealth";
import {
  getJobRunnerSettings,
  updateJobRunnerSettings,
} from "@/lib/newsletter-admin.functions";
import "@/lib/i18n-newsletter-runner";

/** Zaległość, od której kolejka przestaje być „chwilowa" i wymaga uwagi. */
const BACKLOG_WARN_THRESHOLD = 25;

export function JobRunnerCard() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const getSettings = useServerFn(getJobRunnerSettings);
  const saveSettings = useServerFn(updateJobRunnerSettings);

  const { data } = useQuery({
    queryKey: ["admin", "job-runner-settings"],
    queryFn: () => getSettings(),
    // Kafel jest miernikiem stanu bieżącego: minuta odświeżenia odpowiada
    // rytmowi ticku, więc operator widzi skutek zmiany bez przeładowania strony.
    refetchInterval: 60_000,
  });

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const effEnabled = enabled ?? data?.enabled ?? false;
  const effBaseUrl = baseUrl ?? data?.base_url ?? "";
  const state = resolveRunnerState(data);

  const saveMut = useMutation({
    mutationFn: () => saveSettings({ data: { enabled: effEnabled, base_url: effBaseUrl } }),
    onSuccess: () => {
      toast.success(t("adminRunner.fields.saved"));
      setEnabled(null);
      setBaseUrl(null);
      qc.invalidateQueries({ queryKey: ["admin", "job-runner-settings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const queues = data?.queues ?? null;
  const backlog = queues ? queues.auth + queues.transactional : 0;
  const dlq = queues ? queues.authDlq + queues.transactionalDlq : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle className="text-base">{t("adminRunner.title")}</CardTitle>
          <RunnerStateBadge state={state} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="m-0 text-sm text-muted-foreground">{t("adminRunner.subtitle")}</p>

        {state !== "running" && (
          <p
            className={cnHint(state)}
            // Hint jest treścią, nie dekoracją: czytnik ekranu ma go ogłosić po
            // zmianie stanu (np. po zapisaniu adresu).
            role="status"
          >
            {t(`adminRunner.stateHint.${state}`)}
          </p>
        )}

        {data?.last_tick_status === "error" && data.last_tick_error && (
          <p className="m-0 flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <code className="min-w-0 break-words font-mono">{data.last_tick_error}</code>
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[320px] max-w-full">
            <FloatingInput
              id="runner-url"
              type="url"
              label={t("adminRunner.fields.urlLabel")}
              value={effBaseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>

          <label className="flex h-10 items-center gap-2 text-sm">
            <Switch checked={effEnabled} onCheckedChange={(v) => setEnabled(v)} />
            {t("adminRunner.fields.enabled")}
          </label>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {t("adminRunner.fields.save")}
          </Button>
          {typeof window !== "undefined" && !effBaseUrl && (
            <Button variant="ghost" size="sm" onClick={() => setBaseUrl(window.location.origin)}>
              {t("adminRunner.fields.useCurrentDomain")}
            </Button>
          )}
        </div>

        {!effBaseUrl && (
          <p className="m-0 text-xs text-muted-foreground">
            {data?.effective_base_url
              ? t("adminRunner.fields.urlHint", { url: data.effective_base_url })
              : t("adminRunner.fields.urlHintMissing")}
          </p>
        )}

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("adminRunner.queues.title")}
          </div>
          {queues ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <QueueDepthStat
                label={t("adminRunner.queues.auth")}
                value={queues.auth}
                tone={queues.auth > BACKLOG_WARN_THRESHOLD ? "warn" : "neutral"}
              />
              <QueueDepthStat
                label={t("adminRunner.queues.transactional")}
                value={queues.transactional}
                tone={queues.transactional > BACKLOG_WARN_THRESHOLD ? "warn" : "neutral"}
              />
              <QueueDepthStat
                label={t("adminRunner.queues.dlq")}
                value={dlq}
                tone={dlq > 0 ? "danger" : "neutral"}
              />
            </div>
          ) : (
            <p className="m-0 text-xs text-muted-foreground">
              {t("adminRunner.queues.unavailable")}
            </p>
          )}
          {backlog > BACKLOG_WARN_THRESHOLD && (
            <p className="m-0 text-xs text-amber-700 dark:text-amber-400">
              {t("adminRunner.queues.backlogWarning", { count: backlog })}
            </p>
          )}
          {dlq > 0 && (
            <p className="m-0 text-xs text-destructive">
              {t("adminRunner.queues.dlqWarning", { count: dlq })}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {data?.last_tick_at
              ? t("adminRunner.tick.lastAt", {
                  when: new Date(data.last_tick_at).toLocaleString(i18n.language),
                })
              : t("adminRunner.tick.never")}
          </span>
          {(data?.tick_count ?? 0) > 0 && (
            <span>{t("adminRunner.tick.count", { count: data?.tick_count ?? 0 })}</span>
          )}
        </div>

        {data?.secret_preview && (
          <p className="m-0 text-xs text-muted-foreground">
            {t("adminRunner.tick.secret")} <code>{data.secret_preview}</code>
            {" · "}
            {t("adminRunner.tick.endpoint")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Ton podpowiedzi zależy od powagi stanu (błąd czerwono, reszta ostrzegawczo). */
function cnHint(state: RunnerState): string {
  return state === "error"
    ? "m-0 text-xs leading-relaxed text-destructive"
    : "m-0 text-xs leading-relaxed text-amber-700 dark:text-amber-400";
}
