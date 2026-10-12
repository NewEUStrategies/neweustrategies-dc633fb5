import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  REFUND_ATTEMPT_BUDGET,
  REFUND_UNCONFIRMED_DAYS,
  fetchRegistrationRefundJournal,
} from "@/lib/events/registrationRefundJournal";
import { registrationKeys } from "@/lib/events/useEventRegistrations";
import { ensureI18n } from "@/lib/i18n-admin-event-registration";
import { formatDateTime } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";

ensureI18n();
const base = "adminEventRegistration.refundJournal";
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Zlecenie wskazane przez alarm dla administratorów (`?refund_job=<id>`,
 * href z `_event_refund_job_escalate`). Kształt bramkujemy, bo wartość
 * trafia do selektora DOM. Czytane po zamontowaniu - SSR nie zna adresu
 * z przeglądarki, a pierwszy render ma być identyczny po obu stronach.
 */
function focusedJobFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("refund_job");
  return value && UUID_SHAPE.test(value) ? value.toLowerCase() : null;
}

export function RegistrationRefundJournal({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [focusedJob, setFocusedJob] = useState<string | null>(null);
  const id = useId();
  const query = useQuery({
    queryKey: [...registrationKeys.event(eventId), "refund-journal"],
    queryFn: () => fetchRegistrationRefundJournal(eventId),
    enabled: open,
    retry: false,
    refetchInterval: open ? 30_000 : false,
  });

  // Wejście z powiadomienia: dziennik otwiera się sam, bez szukania sekcji.
  useEffect(() => {
    const job = focusedJobFromUrl();
    if (!job) return;
    setFocusedJob(job);
    setOpen(true);
  }, []);

  const focusedLoaded = Boolean(focusedJob && query.data?.some((row) => row.id === focusedJob));
  useEffect(() => {
    if (!focusedLoaded || !focusedJob) return;
    document
      .getElementById(`${id}-job-${focusedJob}`)
      ?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [focusedLoaded, focusedJob, id]);

  return (
    <div className="space-y-3 rounded-md border p-3">
      <Button
        variant="ghost"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {t(`${base}.title`)}
      </Button>
      {open && (
        <div id={id} className="space-y-3">
          <p className="text-sm text-muted-foreground">{t(`${base}.description`)}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t(`${base}.refresh`)}
          </Button>
          {query.isError ? (
            <p role="alert">{t(`${base}.loadError`)}</p>
          ) : query.isPending ? (
            <p role="status">{t(`${base}.loading`)}</p>
          ) : query.data.length === 0 ? (
            <p>{t(`${base}.empty`)}</p>
          ) : (
            <ul className="space-y-3">
              {query.data.map((row) => {
                const focused = row.id === focusedJob;
                return (
                  <li
                    key={row.id}
                    id={`${id}-job-${row.id}`}
                    aria-current={focused ? "true" : undefined}
                    className={cn(
                      "rounded-md border p-3 text-sm",
                      focused && "border-primary ring-2 ring-primary/40",
                    )}
                  >
                    <p className="font-medium">{row.person_name || t(`${base}.unnamed`)}</p>
                    <p>{t(`${base}.states.${row.state}`)}</p>
                    {row.review_reason && (
                      <p className="font-medium">
                        {t(`${base}.reasons.${row.review_reason}.label`)}
                      </p>
                    )}
                    <p className="break-all text-muted-foreground">
                      {t(`${base}.order`, { id: row.payment_order_id })}
                    </p>
                    <p>{t(`${base}.attempts`, { count: row.attempts })}</p>
                    {row.state === "needs_review" && (
                      <p>
                        {row.review_reason
                          ? t(`${base}.reasons.${row.review_reason}.hint`, {
                              days: REFUND_UNCONFIRMED_DAYS,
                            })
                          : t(`${base}.reviewHint`)}
                      </p>
                    )}
                    {row.state === "failed" && (
                      <p>{t(`${base}.failedHint`, { budget: REFUND_ATTEMPT_BUDGET })}</p>
                    )}
                    {row.last_error && (
                      <p className="break-all text-muted-foreground">
                        {t(`${base}.lastError`, { error: row.last_error })}
                      </p>
                    )}
                    {row.escalated_at && (
                      <p className="text-muted-foreground">
                        {t(`${base}.escalated`, {
                          date: formatDateTime(row.escalated_at, i18n.language),
                        })}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
