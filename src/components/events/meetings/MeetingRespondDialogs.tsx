// Molekuly: TRZY decyzje uczestnika, ktore wymagaja slowa od czlowieka -
// odmowa, odwolanie i propozycja nowego terminu.
//
// ODMOWA WYMAGA POWODU, BO BAZA GO WYMAGA (`decline_reason_required`). Gdyby
// pole bylo opcjonalne w UI, jedyna informacja zwrotna byloby wywolanie RPC
// zakonczone bledem po klikniecu "Odrzuc" - i uczestnik uczylby sie kontraktu
// bazy z komunikatu o awarii.
//
// NOWY TERMIN WYBIERAMY Z LISTY OD BAZY, NIGDY Z KALENDARZA. Wolny termin to
// czesc wspolna: siatki gieldy, okien dostepnosci OBU stron i wolnych miejsc
// przy stolikach. Przegladarka nie zna zadnego z tych trzech zbiorow, wiec
// swobodne pole daty produkowalaby wylacznie odmowy `slot_not_in_grid`.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatEventDateTime, formatEventTime } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import { useMyFreeSlots } from "@/lib/events/useMyMeetings";

/** Dialog z jednym polem tekstowym - odmowa (powod wymagany) i odwolanie (opcjonalny). */
export function MeetingReasonDialog({
  open,
  mode,
  isPending,
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  mode: "decline" | "cancel";
  isPending: boolean;
  onSubmit: (reason: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const required = mode === "decline";
  const trimmed = reason.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {required
              ? t("eventMeetings.participant.meetings.declineTitle")
              : t("eventMeetings.participant.meetings.cancelTitle")}
          </DialogTitle>
          {required ? (
            <DialogDescription>
              {t("eventMeetings.hints.declineReasonRequired")}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="meeting-reason">
            {required
              ? t("eventMeetings.fields.declineReason")
              : t("eventMeetings.fields.cancelReason")}
          </Label>
          <Textarea
            id="meeting-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("eventMeetings.participant.form.dismiss")}
          </Button>
          <Button
            variant={required ? "destructive" : "default"}
            disabled={isPending || (required && trimmed.length === 0)}
            onClick={() => onSubmit(trimmed)}
          >
            {t("eventMeetings.participant.form.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Dialog przelozenia: lista wspolnych wolnych terminow + krotka wiadomosc. */
export function MeetingRescheduleDialog({
  open,
  slug,
  counterpartRegistrationId,
  timezone,
  isPending,
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  slug: string;
  counterpartRegistrationId: string | null;
  timezone: string | null;
  isPending: boolean;
  onSubmit: (input: { startsAt: string; message: string | null }) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  // Zapytanie startuje dopiero z otwartym dialogiem: wolne terminy zmieniaja
  // sie co chwile, a lista spotkan moze miec ich kilkanascie - odpytywanie
  // kazdego wiersza z gory oznaczaloby kilkanascie zapytan po nic.
  const slots = useMyFreeSlots({
    slug: open ? slug : null,
    counterpartRegistrationId: open ? counterpartRegistrationId : null,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setStartsAt(null);
          setMessage("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("eventMeetings.participant.meetings.rescheduleTitle")}</DialogTitle>
          <DialogDescription>
            {t("eventMeetings.participant.meetings.rescheduleHint")}
          </DialogDescription>
        </DialogHeader>

        {slots.isPending ? (
          <p className="text-sm text-muted-foreground">
            {t("eventMeetings.participant.meetings.loadingSlots")}
          </p>
        ) : slots.data === undefined || slots.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("eventMeetings.participant.meetings.noSlots")}
          </p>
        ) : (
          <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {slots.data.map((slot) => (
              <button
                key={`${slot.starts_at}-${slot.table_id}-${slot.table_seat}`}
                type="button"
                onClick={() => setStartsAt(slot.starts_at)}
                aria-pressed={startsAt === slot.starts_at}
                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  startsAt === slot.starts_at
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted"
                }`}
              >
                <span>
                  {formatEventDateTime(slot.starts_at, timezone, lang)}
                  {" - "}
                  {formatEventTime(slot.ends_at, timezone, lang)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {slot.table_label}
                  {slot.table_zone !== null && slot.table_zone !== ""
                    ? ` · ${slot.table_zone}`
                    : ""}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="reschedule-message">{t("eventMeetings.fields.message")}</Label>
          <Textarea
            id="reschedule-message"
            rows={2}
            maxLength={500}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("eventMeetings.participant.form.dismiss")}
          </Button>
          <Button
            disabled={isPending || startsAt === null}
            onClick={() => {
              if (startsAt === null) return;
              const trimmed = message.trim();
              onSubmit({ startsAt, message: trimmed.length > 0 ? trimmed : null });
            }}
          >
            {t("eventMeetings.actions.reschedule")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
