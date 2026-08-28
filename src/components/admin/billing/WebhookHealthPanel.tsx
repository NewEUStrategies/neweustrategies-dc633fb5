// Organizm: zdrowie webhooków operatora płatności + ponowna wysyłka
// powiadomień dla konkretnego zgłoszenia.
//
// ALARM JEST CZĘŚCIĄ POMIARU, NIE OZDOBĄ. Sam odsetek niepowodzeń nic nie
// znaczy dla człowieka, który patrzy na ekran raz dziennie - dlatego panel
// nazywa próg wprost: powyżej 5% czerwono („napraw teraz"), powyżej 1%
// bursztynowo („obserwuj"), niżej neutralnie.
//
// PONOWNA WYSYŁKA NIE JEST PONOWIENIEM ZDARZENIA. Przycisk obok metryk woła
// `resendRegistrationNotifications`, które NIE dotyka statusu płatności ani
// miejsca - w odróżnieniu od „Ponów" w dzienniku zdarzeń.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FieldBox } from "@/components/ui/field-box";
import { fetchWebhookHealth, type HealthEnv, type WebhookHealth } from "@/lib/billing/webhookHealthApi";
import { resendRegistrationNotifications } from "@/lib/events/outcomeResend.functions";
import { ensureI18n as ensureTicketsI18n } from "@/lib/i18n-participant-tickets";

ensureTicketsI18n();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-border bg-card p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

export function WebhookHealthPanel({
  environment,
  sinceHours,
}: {
  environment: HealthEnv;
  sinceHours: number;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith("en") ? "en-GB" : "pl-PL";
  const [health, setHealth] = useState<WebhookHealth | null>(null);
  const [registrationId, setRegistrationId] = useState("");

  const load = useMutation({
    mutationFn: () => fetchWebhookHealth(environment, sinceHours),
    onSuccess: setHealth,
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : String(error)),
  });

  const resend = useMutation({
    mutationFn: () =>
      resendRegistrationNotifications({ data: { registrationId: registrationId.trim() } }),
    onSuccess: (result) =>
      toast.success(
        t("webhookHealth.resendOk", {
          email: result.emailed ? "✓" : "-",
          sms: result.smsSent ? "✓" : "-",
        }),
      ),
    onError: (error: unknown) =>
      toast.error(
        t("webhookHealth.resendFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      ),
  });

  const rate = health === null ? 0 : health.failureRate;
  const ratePct = `${(rate * 100).toFixed(2)}%`;
  const alertTone = rate > 0.05 ? "high" : rate > 0.01 ? "warn" : "ok";

  const fmtMs = (value: number | null) =>
    value === null ? "-" : `${new Intl.NumberFormat(locale).format(Math.round(value))} ms`;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("webhookHealth.title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("webhookHealth.lead")}</p>
        </div>
        <Button type="button" onClick={() => load.mutate()} disabled={load.isPending}>
          {load.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {t("webhookHealth.load")}
        </Button>
      </header>

      {health !== null && (
        <>
          <div
            role="status"
            className={
              alertTone === "high"
                ? "flex items-center gap-2 rounded-[6px] border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground"
                : alertTone === "warn"
                  ? "flex items-center gap-2 rounded-[6px] border border-primary/40 bg-primary/10 p-3 text-sm text-foreground"
                  : "flex items-center gap-2 rounded-[6px] border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
            }
          >
            {alertTone === "ok" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span>
              {alertTone === "high"
                ? t("webhookHealth.alertHigh", { rate: ratePct })
                : alertTone === "warn"
                  ? t("webhookHealth.alertWarn", { rate: ratePct })
                  : t("webhookHealth.alertOk")}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label={t("webhookHealth.total")} value={String(health.total)} />
            <Metric label={t("webhookHealth.processed")} value={String(health.processed)} />
            <Metric label={t("webhookHealth.failed")} value={String(health.failed)} />
            <Metric label={t("webhookHealth.pending")} value={String(health.pending)} />
            <Metric label={t("webhookHealth.retries")} value={String(health.retries)} />
            <Metric label={t("webhookHealth.failureRate")} value={ratePct} />
            <Metric label={t("webhookHealth.avgDuration")} value={fmtMs(health.avgDurationMs)} />
            <Metric label={t("webhookHealth.p95Duration")} value={fmtMs(health.p95DurationMs)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-[6px] border border-border bg-card p-3">
              <p className="mb-2 text-sm font-semibold text-foreground">
                {t("webhookHealth.byType")}
              </p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {health.byType.map((row) => (
                  <li key={row.eventType} className="flex items-center justify-between gap-3">
                    <span className="truncate">{row.eventType}</span>
                    <span className="shrink-0 tabular-nums">
                      {row.total} / {row.failed} · {fmtMs(row.avgDurationMs)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-[6px] border border-border bg-card p-3">
              <p className="mb-2 text-sm font-semibold text-foreground">
                {t("webhookHealth.recentFailures")}
              </p>
              {health.recentFailures.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("webhookHealth.noFailures")}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {health.recentFailures.map((row) => (
                    <li key={row.id} className="rounded-[6px] border border-border/60 p-2">
                      <p className="font-medium text-foreground">{row.eventType}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.occurredAt === null
                          ? "-"
                          : new Date(row.occurredAt).toLocaleString(locale)}{" "}
                        · {t("webhookHealth.retries")}: {row.retryCount}
                      </p>
                      {row.error !== null && (
                        <p className="mt-1 break-words text-xs text-destructive">{row.error}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      <div className="space-y-2 rounded-[6px] border border-border bg-card p-3">
        <p className="text-sm font-semibold text-foreground">{t("webhookHealth.resend")}</p>
        <p className="text-sm text-muted-foreground">{t("webhookHealth.resendHint")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <FieldBox
            label={t("webhookHealth.registrationId")}
            value={registrationId}
            onChange={(event) => setRegistrationId(event.target.value)}
            className="min-w-[280px] flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            disabled={!UUID_RE.test(registrationId.trim()) || resend.isPending}
            onClick={() => resend.mutate()}
          >
            {resend.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {resend.isPending ? t("webhookHealth.resending") : t("webhookHealth.resend")}
          </Button>
        </div>
      </div>
    </section>
  );
}
