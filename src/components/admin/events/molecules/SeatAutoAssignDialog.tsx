// Molekula: AUTO-PRZYDZIAL miejsc - propozycja, podglad, zatwierdzenie.
//
// NAJPIERW PODGLAD, POTEM ZAPIS. Planer (`seatingPlanner.ts`) liczy propozycje
// w przegladarce na komplecie kandydatow; organizator widzi, ile osob usiadzie
// i kto zostanie bez miejsca (z powodem), zanim cokolwiek trafi do bazy.
//
// ZAPIS PACZKAMI PO 500 przez `admin_event_seat_assign_batch` - jedna blokada
// planu na paczke i jedno zdarzenie domenowe. Baza sprawdza kazda pozycje
// jeszcze raz; odrzucone wracaja z kodem, ktory pokazujemy tym samym zdaniem,
// co odmowe recznego przydzialu (`adminSeatingErrors`).
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { adminSeatingErrorMessage, adminSeatingFailure } from "@/lib/events/adminSeatingErrors";
import {
  SEAT_BATCH_LIMIT,
  type SeatBatchRejection,
  type SeatMapDetail,
} from "@/lib/events/seatingApi";
import {
  categoryTicketsOf,
  planSeating,
  plannerCandidatesFromRows,
  plannerSeatsFromDetail,
  type PlannerUnplacedReason,
} from "@/lib/events/seatingPlanner";
import { useEventTickets } from "@/lib/events/useEventRegistrations";
import { useAllSeatingCandidates, useAssignSeatsBatch } from "@/lib/events/useEventSeating";
import { useSponsors } from "@/lib/events/useEventSponsors";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureSeatingI18n } from "@/lib/i18n-admin-event-seating";

ensureSeatingI18n();

const REASON_KEYS: Record<PlannerUnplacedReason, string> = {
  no_seat: "adminEventSeating.autoDialog.reasons.no_seat",
  no_allowed_seat: "adminEventSeating.autoDialog.reasons.no_allowed_seat",
};

export interface SeatAutoAssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  detail: SeatMapDetail;
}

export function SeatAutoAssignDialog({
  open,
  onOpenChange,
  eventId,
  detail,
}: SeatAutoAssignDialogProps) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const mapId = detail.map.id;
  const candidates = useAllSeatingCandidates(eventId, mapId, open);
  const sponsors = useSponsors({ eventId }, open);
  const tickets = useEventTickets(open ? eventId : null);
  const batch = useAssignSeatsBatch(eventId);

  const [keepTogether, setKeepTogether] = useState(true);
  const [holdsFirst, setHoldsFirst] = useState(true);
  const [ticketIds, setTicketIds] = useState<string[]>([]);
  const [rejected, setRejected] = useState<SeatBatchRejection[]>([]);

  useEffect(() => {
    if (open) setRejected([]);
  }, [open]);

  const rows = useMemo(() => candidates.data ?? [], [candidates.data]);
  const names = useMemo(
    () =>
      new Map(
        rows.map((row) => [row.registration_id, `${row.first_name} ${row.last_name}`.trim()]),
      ),
    [rows],
  );

  const plan = useMemo(() => {
    const sponsorCompany = new Map((sponsors.data ?? []).map((row) => [row.id, row.company_id]));
    return planSeating(
      plannerSeatsFromDetail(detail, sponsorCompany),
      plannerCandidatesFromRows(rows),
      {
        categoryTickets: categoryTicketsOf(detail),
        keepTogether,
        holdsFirst,
        ticketTypeIds: ticketIds.length === 0 ? null : ticketIds,
      },
    );
  }, [detail, rows, sponsors.data, keepTogether, holdsFirst, ticketIds]);

  const toggleTicket = (ticketId: string, checked: boolean) =>
    setTicketIds((previous) =>
      checked ? [...previous, ticketId] : previous.filter((id) => id !== ticketId),
    );

  const apply = async () => {
    let applied = 0;
    const refused: SeatBatchRejection[] = [];
    try {
      for (let start = 0; start < plan.proposals.length; start += SEAT_BATCH_LIMIT) {
        const result = await batch.mutateAsync({
          mapId,
          source: "auto",
          items: plan.proposals.slice(start, start + SEAT_BATCH_LIMIT),
        });
        applied += result.applied;
        refused.push(...result.rejected);
      }
    } catch (error: unknown) {
      toast.error(adminSeatingErrorMessage(error));
    }
    if (applied > 0) toast.success(t("adminEventSeating.autoDialog.applied", { count: applied }));
    setRejected(refused);
    if (refused.length === 0 && applied > 0) onOpenChange(false);
  };

  const loading = candidates.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("adminEventSeating.autoDialog.title")}</DialogTitle>
          <DialogDescription>{t("adminEventSeating.autoDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <AdminFormSwitchRow
            label={t("adminEventSeating.autoDialog.keepTogether")}
            hint={t("adminEventSeating.autoDialog.keepTogetherHint")}
            checked={keepTogether}
            onCheckedChange={setKeepTogether}
          />
          <AdminFormSwitchRow
            label={t("adminEventSeating.autoDialog.holdsFirst")}
            hint={t("adminEventSeating.autoDialog.holdsFirstHint")}
            checked={holdsFirst}
            onCheckedChange={setHoldsFirst}
          />
          {(tickets.data ?? []).length === 0 ? null : (
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">
                {t("adminEventSeating.autoDialog.tickets")}
              </legend>
              <p className="text-xs text-muted-foreground">
                {t("adminEventSeating.autoDialog.allTickets")}
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {(tickets.data ?? []).map((ticket) => {
                  const id = `seat-auto-ticket-${ticket.id}`;
                  return (
                    <li key={ticket.id} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={ticketIds.includes(ticket.id)}
                        onCheckedChange={(checked) => toggleTicket(ticket.id, checked === true)}
                      />
                      <Label htmlFor={id} className="font-normal">
                        {pickLocalized(ticket, "name", lang)}
                      </Label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}

          <section aria-live="polite" className="space-y-2 rounded-[6px] border border-border p-3">
            {loading ? (
              <p className="text-sm text-muted-foreground">
                {t("adminEventSeating.autoDialog.loading")}
              </p>
            ) : plan.proposals.length === 0 && plan.unplaced.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("adminEventSeating.autoDialog.nothing")}
              </p>
            ) : (
              <>
                <p className="text-sm font-medium">
                  {t("adminEventSeating.autoDialog.proposed", { count: plan.proposals.length })}
                </p>
                {plan.unplaced.length === 0 ? null : (
                  <>
                    <p className="text-sm">
                      {t("adminEventSeating.autoDialog.unplaced", { count: plan.unplaced.length })}
                    </p>
                    <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-sm text-muted-foreground">
                      {plan.unplaced.map((entry) => (
                        <li key={entry.registrationId}>
                          {t("adminEventSeating.autoDialog.unplacedItem", {
                            name: names.get(entry.registrationId) ?? entry.registrationId,
                            reason: t(REASON_KEYS[entry.reason]),
                          })}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </section>

          {rejected.length === 0 ? null : (
            <section
              role="alert"
              className="space-y-2 rounded-[6px] border border-destructive/40 p-3"
            >
              <p className="text-sm font-medium">
                {t("adminEventSeating.autoDialog.rejected", { count: rejected.length })}
              </p>
              <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-sm">
                {rejected.map((entry) => {
                  const failure = adminSeatingFailure(`${entry.code}: batch item`);
                  return (
                    <li key={`${entry.seatId}-${entry.registrationId}`}>
                      {t("adminEventSeating.autoDialog.rejectedItem", {
                        name: names.get(entry.registrationId) ?? entry.registrationId,
                        reason: t(failure.key, failure.params),
                      })}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={batch.isPending}>
            {t("adminEventSeating.autoDialog.cancel")}
          </Button>
          <Button
            onClick={() => void apply()}
            disabled={loading || batch.isPending || plan.proposals.length === 0}
          >
            {t("adminEventSeating.autoDialog.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
