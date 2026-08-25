// Dialog ZAPROSZENIA na rozmowę 1-1.
//
// TERMINY LICZY BAZA, NIE EKRAN. `event_meeting_free_slots` przecina siatkę
// giełdy z dostępnością OBU stron i ze stanem stolików - front nie ma jak
// odtworzyć tego rachunku i nie próbuje. Lista pusta znaczy „nie ma wspólnego
// terminu", a nie „coś się zepsuło", i tak też o tym mówimy.
//
// ZAPYTANIE STARTUJE Z OTWARTYM DIALOGIEM. Katalog uczestników ma kilkadziesiąt
// wierszy; odpytywanie wolnych terminów dla każdego z góry to kilkadziesiąt
// wywołań po nic - a terminy i tak zdążą się zmienić, zanim ktokolwiek kliknie.
import { useState } from "react";
import { Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { uiLang } from "@/lib/i18n/format";
import { formatEventDateTime, formatEventTime } from "@/lib/events/timezone";
import { useMyFreeSlots } from "@/lib/events/useMyMeetings";
import { ensureI18n as ensureEventMeetingsI18n } from "@/lib/i18n-event-meetings";

ensureEventMeetingsI18n();

export function MeetingInviteDialog({
  open,
  slug,
  counterpartRegistrationId,
  counterpartName,
  timezone,
  isPending,
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  slug: string;
  counterpartRegistrationId: string | null;
  counterpartName: string;
  timezone: string | null;
  isPending: boolean;
  onSubmit: (input: { startsAt: string; topic: string | null; message: string | null }) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");

  const slots = useMyFreeSlots({
    slug: open ? slug : null,
    counterpartRegistrationId: open ? counterpartRegistrationId : null,
  });

  const reset = () => {
    setStartsAt(null);
    setTopic("");
    setMessage("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("eventMeetings.participant.directory.inviteTitle")}</DialogTitle>
          <DialogDescription>{counterpartName !== "" ? counterpartName : null}</DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t("eventMeetings.participant.directory.inviteHint")}
        </p>

        {slots.isPending ? (
          <p className="text-sm text-muted-foreground">
            {t("eventMeetings.participant.meetings.loadingSlots")}
          </p>
        ) : slots.data === undefined || slots.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("eventMeetings.hints.noSlots")}</p>
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
          <Label htmlFor="invite-topic">{t("eventMeetings.fields.topic")}</Label>
          <Input
            id="invite-topic"
            value={topic}
            maxLength={200}
            onChange={(event) => setTopic(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-message">{t("eventMeetings.fields.message")}</Label>
          <Textarea
            id="invite-message"
            rows={3}
            value={message}
            maxLength={1000}
            onChange={(event) => setMessage(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            disabled={startsAt === null || isPending}
            onClick={() => {
              if (startsAt === null) return;
              onSubmit({
                startsAt,
                topic: topic.trim() === "" ? null : topic.trim(),
                message: message.trim() === "" ? null : message.trim(),
              });
            }}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {isPending
              ? t("eventMeetings.participant.directory.inviteSending")
              : t("eventMeetings.participant.directory.inviteSend")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
