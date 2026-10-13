// Molekuła: dziennik zwrotów zgłoszeń wydarzenia (REG-03).
//
// KAŻDE ZAMKNIĘCIE OPŁACONEGO ZGŁOSZENIA STOI TU Z POWODEM. Organizator widzi,
// kto zamknął zgłoszenie (odrzucenie, anulowanie, rezygnacja uczestnika,
// zamknięcie bez decyzji), co stało się z pieniędzmi i - przy `needs_review` -
// DLACZEGO zwrot czeka na niego (po terminie, bez samodzielnych zwrotów,
// wspólna wpłata grupy, wpłata poza operatorem).
//
// DECYZJA W TYM SAMYM MIEJSCU. Wiersz w przeglądzie (albo po ostatecznej
// porażce operatora) ma przyciski: zwrot przez operatora, oznaczenie zwrotu
// zrobionego poza systemem, albo „nie zwracaj" z wymaganą notatką. Każda
// decyzja wymaga drugiego kliknięcia - to pieniądze uczestnika.
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/billing/types";
import { adminRegistrationErrorMessage } from "@/lib/events/adminRegistrationErrors";
import {
  REFUND_DISMISS_NOTE_MIN_LENGTH,
  REFUND_NOTE_MAX_LENGTH,
  decideRefundJob,
  fetchRegistrationRefundJournal,
  refundJobDecisions,
  type RefundJobDecision,
  type RefundJournalRow,
} from "@/lib/events/registrationRefundJournal";
import { registrationKeys } from "@/lib/events/useEventRegistrations";
import { uiLang } from "@/lib/i18n/format";
import { ensureI18n } from "@/lib/i18n-admin-event-registration";

ensureI18n();
const base = "adminEventRegistration.refundJournal";

const DECISION_KEYS: Record<RefundJobDecision, string> = {
  refund: "adminEventRegistration.refundJournal.actions.refund",
  mark_refunded: "adminEventRegistration.refundJournal.actions.markRefunded",
  dismiss: "adminEventRegistration.refundJournal.actions.dismiss",
};

const DECISION_TOAST_KEYS: Record<RefundJobDecision, string> = {
  refund: "adminEventRegistration.refundJournal.toasts.refund",
  mark_refunded: "adminEventRegistration.refundJournal.toasts.markRefunded",
  dismiss: "adminEventRegistration.refundJournal.toasts.dismiss",
};

export function RegistrationRefundJournal({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deciding, setDeciding] = useState<{ jobId: string; action: RefundJobDecision } | null>(
    null,
  );
  const [note, setNote] = useState("");
  const id = useId();
  const queryKey = [...registrationKeys.event(eventId), "refund-journal"];
  const query = useQuery({
    queryKey,
    queryFn: () => fetchRegistrationRefundJournal(eventId),
    enabled: open,
    retry: false,
    refetchInterval: open ? 30_000 : false,
  });
  const decide = useMutation({
    mutationFn: decideRefundJob,
    onSuccess: (_data, input) => {
      toast.success(t(DECISION_TOAST_KEYS[input.action]));
      setDeciding(null);
      setNote("");
      void queryClient.invalidateQueries({ queryKey: registrationKeys.event(eventId) });
    },
    onError: (error: unknown) => toast.error(adminRegistrationErrorMessage(error)),
  });

  const startDecision = (row: RefundJournalRow, action: RefundJobDecision) => {
    setDeciding({ jobId: row.id, action });
    setNote("");
  };

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
                const decisions = refundJobDecisions(row);
                const active = deciding !== null && deciding.jobId === row.id ? deciding : null;
                const noteTrimmed = note.trim();
                const blocked =
                  active !== null &&
                  ((active.action === "dismiss" &&
                    noteTrimmed.length < REFUND_DISMISS_NOTE_MIN_LENGTH) ||
                    note.length > REFUND_NOTE_MAX_LENGTH);
                return (
                  <li key={row.id} className="space-y-1 rounded-md border p-3 text-sm">
                    <p className="font-medium">{row.person_name || t(`${base}.unnamed`)}</p>
                    <p>
                      {t(`${base}.states.${row.state}`)}
                      {" · "}
                      {t(`${base}.origin.${row.origin}`)}
                    </p>
                    {row.amount_cents !== null && row.currency !== null && (
                      <p>
                        {t(`${base}.amount`, {
                          amount: formatMoney(row.amount_cents, row.currency, lang),
                        })}
                      </p>
                    )}
                    <p className="break-all text-muted-foreground">
                      {row.payment_order_id === null
                        ? t(`${base}.manualOrder`)
                        : t(`${base}.order`, { id: row.payment_order_id })}
                    </p>
                    <p>{t(`${base}.attempts`, { count: row.attempts })}</p>
                    {row.review_reason !== null && (
                      <p>{t(`${base}.reason.${row.review_reason}`)}</p>
                    )}
                    {row.state === "failed" && <p>{t(`${base}.failedHint`)}</p>}
                    {row.review_note !== null && row.review_note !== "" && (
                      <p className="text-muted-foreground">
                        {t(`${base}.reviewNote`, { note: row.review_note })}
                      </p>
                    )}
                    {decisions.length > 0 && active === null && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {decisions.map((action) => (
                          <Button
                            key={action}
                            size="sm"
                            variant={action === "dismiss" ? "outline" : "default"}
                            disabled={decide.isPending}
                            onClick={() => startDecision(row, action)}
                          >
                            {t(DECISION_KEYS[action])}
                          </Button>
                        ))}
                      </div>
                    )}
                    {active !== null && (
                      <div className="space-y-2 rounded-md border border-border bg-muted/40 p-2">
                        <Label htmlFor={`${id}-${row.id}-note`}>
                          {active.action === "dismiss"
                            ? t(`${base}.noteRequiredLabel`)
                            : t(`${base}.noteLabel`)}
                        </Label>
                        <Textarea
                          id={`${id}-${row.id}-note`}
                          value={note}
                          rows={2}
                          onChange={(event) => setNote(event.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">{t(`${base}.noteHint`)}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            disabled={blocked || decide.isPending}
                            onClick={() =>
                              decide.mutate({ jobId: row.id, action: active.action, note })
                            }
                          >
                            {t(`${base}.actions.confirm`)}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={decide.isPending}
                            onClick={() => setDeciding(null)}
                          >
                            {t(`${base}.actions.back`)}
                          </Button>
                        </div>
                      </div>
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
