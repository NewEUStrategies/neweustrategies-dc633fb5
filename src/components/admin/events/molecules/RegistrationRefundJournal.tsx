import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { fetchRegistrationRefundJournal } from "@/lib/events/registrationRefundJournal";
import { registrationKeys } from "@/lib/events/useEventRegistrations";
import { ensureI18n } from "@/lib/i18n-admin-event-registration";

ensureI18n();
const base = "adminEventRegistration.refundJournal";

export function RegistrationRefundJournal({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  const query = useQuery({
    queryKey: [...registrationKeys.event(eventId), "refund-journal"],
    queryFn: () => fetchRegistrationRefundJournal(eventId),
    enabled: open,
    retry: false,
    refetchInterval: open ? 30_000 : false,
  });
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
              {query.data.map((row) => (
                <li key={row.id} className="rounded-md border p-3 text-sm">
                  <p className="font-medium">{row.person_name || t(`${base}.unnamed`)}</p>
                  <p>{t(`${base}.states.${row.state}`)}</p>
                  <p className="break-all text-muted-foreground">
                    {t(`${base}.order`, { id: row.payment_order_id })}
                  </p>
                  <p>{t(`${base}.attempts`, { count: row.attempts })}</p>
                  {row.state === "needs_review" && <p>{t(`${base}.reviewHint`)}</p>}
                  {row.state === "failed" && <p>{t(`${base}.failedHint`)}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
