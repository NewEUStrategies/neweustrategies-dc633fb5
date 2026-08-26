// Organizm: organizator umawia spotkanie 1-1 za obie strony.
//
// PO CO TO ISTNIEJE. Zobowiazania z pakietow partnerskich ("trzy rozmowy
// z decydentami") nie moga czekac, az ktos wysle zaproszenie i drugi je
// przyjmie. Ten dialog tworzy spotkanie od razu potwierdzone - ale nadal przez
// RPC, wiec siatka slotow, okna dostepnosci, kolizje i limit dzienny
// obowiazuja tak samo jak uczestnika.
//
// TERMIN WYBIERA SIE Z LISTY, NIE WPISUJE. Wolne terminy liczy baza dla PARY
// (oboje wolni + wolne miejsce przy stoliku). Recznie wpisany termin konczylby
// sie odmowa, ktorej organizator nie umialby zinterpretowac, wiec pole terminu
// aktywuje sie dopiero po wybraniu obu osob.
//
// STOLIK JEST SUGESTIA. Slot niesie ze soba stolik i numer miejsca; oddajemy je
// do RPC razem z terminem, ale baza i tak weryfikuje zajetosc pod blokada -
// dwoch organizatorow klikajacych naraz nie posadzi nikogo na jednym miejscu.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { adminMeetingFailure } from "@/lib/events/adminMeetingErrors";
import { formatDateTime } from "@/lib/i18n/format";
import type { MeetingParticipantOption } from "@/lib/events/meetingParticipants";
import type { MeetingFreeSlot } from "@/lib/events/meetingsApi";
import {
  useArrangeMeeting,
  useMeetingFreeSlots,
  useMeetingParticipants,
} from "@/lib/events/useMeetings";

interface ArrangeMeetingDialogProps {
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Klucz slotu musi objac stolik i miejsce - ten sam termin bywa wolny przy kilku. */
function slotKey(slot: MeetingFreeSlot): string {
  return [slot.starts_at, slot.table_id ?? "none", slot.table_seat ?? 0].join("|");
}

function PersonPicker(props: {
  label: string;
  eventId: string;
  value: MeetingParticipantOption | null;
  excludeId: string | null;
  onChange: (person: MeetingParticipantOption | null) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const { data, isFetching } = useMeetingParticipants(props.eventId, query);

  const options = useMemo(
    () => (data ?? []).filter((row) => row.registrationId !== props.excludeId),
    [data, props.excludeId],
  );

  if (props.value !== null) {
    return (
      <div className="space-y-1.5">
        <Label>{props.label}</Label>
        <div className="flex items-center justify-between gap-2 rounded-[6px] border border-border px-3 py-2">
          <span className="truncate text-sm">{props.value.label}</span>
          <Button size="sm" variant="ghost" onClick={() => props.onChange(null)}>
            {t("adminEventMeetings.arrange.cancelAction")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label>{props.label}</Label>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("adminEventMeetings.arrange.personPlaceholder")}
      />
      <div className="max-h-40 overflow-y-auto rounded-[6px] border border-border">
        {options.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {isFetching
              ? t("adminEventMeetings.arrange.personsLoading")
              : t("adminEventMeetings.arrange.personsEmpty")}
          </p>
        ) : (
          options.map((option) => (
            <button
              key={option.registrationId}
              type="button"
              className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => props.onChange(option)}
            >
              {option.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function ArrangeMeetingDialog({ eventId, open, onOpenChange }: ArrangeMeetingDialogProps) {
  const { t, i18n } = useTranslation();
  const [first, setFirst] = useState<MeetingParticipantOption | null>(null);
  const [second, setSecond] = useState<MeetingParticipantOption | null>(null);
  const [slot, setSlot] = useState<string>("");
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");

  // Zamkniecie dialogu ma czyscic wybor: nastepne umawianie zaczyna sie od zera,
  // inaczej organizator umowilby przypadkiem te sama pare drugi raz.
  useEffect(() => {
    if (open) return;
    setFirst(null);
    setSecond(null);
    setSlot("");
    setTopic("");
    setMessage("");
  }, [open]);

  const slots = useMeetingFreeSlots({
    eventId,
    aRegistrationId: first?.registrationId ?? null,
    bRegistrationId: second?.registrationId ?? null,
  });
  const arrange = useArrangeMeeting(eventId);

  const rows = slots.data ?? [];
  const selected = rows.find((row) => slotKey(row) === slot) ?? null;
  const canSubmit = first !== null && second !== null && selected !== null && !arrange.isPending;

  const submit = () => {
    if (first === null || second === null || selected === null) return;
    arrange.mutate(
      {
        eventId,
        requesterRegistrationId: first.registrationId,
        inviteeRegistrationId: second.registrationId,
        startsAt: selected.starts_at,
        tableId: selected.table_id,
        topic: topic.length > 0 ? topic : null,
        message: message.length > 0 ? message : null,
      },
      {
        onSuccess: () => {
          toast.success(t("adminEventMeetings.toasts.meetingArranged"));
          onOpenChange(false);
        },
        onError: (error) =>
          toast.error(t(adminMeetingFailure(error).key, adminMeetingFailure(error).params)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("adminEventMeetings.arrange.title")}</DialogTitle>
          <DialogDescription>{t("adminEventMeetings.arrange.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <PersonPicker
            label={t("adminEventMeetings.arrange.firstPersonLabel")}
            eventId={eventId}
            value={first}
            excludeId={second?.registrationId ?? null}
            onChange={(person) => {
              setFirst(person);
              setSlot("");
            }}
          />
          <PersonPicker
            label={t("adminEventMeetings.arrange.secondPersonLabel")}
            eventId={eventId}
            value={second}
            excludeId={first?.registrationId ?? null}
            onChange={(person) => {
              setSecond(person);
              setSlot("");
            }}
          />

          <div className="space-y-1.5">
            <Label>{t("adminEventMeetings.arrange.slotLabel")}</Label>
            {first === null || second === null ? (
              <p className="text-xs text-muted-foreground">
                {t("adminEventMeetings.arrange.slotPlaceholder")}
              </p>
            ) : slots.isPending ? (
              <p className="text-xs text-muted-foreground">
                {t("adminEventMeetings.slots.loading")}
              </p>
            ) : rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("adminEventMeetings.arrange.noSlots")}
              </p>
            ) : (
              <div className="max-h-44 overflow-y-auto rounded-[6px] border border-border">
                {rows.map((row) => {
                  const key = slotKey(row);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`block w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                        key === slot ? "bg-muted font-medium" : ""
                      }`}
                      onClick={() => setSlot(key)}
                    >
                      <span>{formatDateTime(row.starts_at, i18n.language)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {row.table_label !== null && row.table_label.length > 0
                          ? `${row.table_label} · ${t("adminEventMeetings.list.seatLabel", {
                              seat: row.table_seat ?? 1,
                            })}`
                          : t("adminEventMeetings.slots.tableNone")}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="arrange-topic">{t("adminEventMeetings.arrange.topicLabel")}</Label>
            <Input
              id="arrange-topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="arrange-message">{t("adminEventMeetings.arrange.messageLabel")}</Label>
            <Textarea
              id="arrange-message"
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </div>

          <p className="text-xs leading-snug text-muted-foreground">
            {t("adminEventMeetings.arrange.rulesNotice")}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("adminEventMeetings.arrange.cancelAction")}
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {t("adminEventMeetings.arrange.submitAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
