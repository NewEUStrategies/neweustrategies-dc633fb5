// Organizm: MOJE SPOTKANIA uczestnika - trzy kolejki (do Ciebie, od Ciebie,
// archiwum) i decyzje w miejscu.
//
// TRZY KOLEJKI, NIE JEDNA CHRONOLOGICZNA LISTA. Zaproszenie czekajace na Twoja
// odpowiedz i spotkanie, na ktore Ty czekasz, wymagaja calkowicie roznych
// dzialan - wymieszane, gina jedno w drugim, a zaproszenia wygasaja z zegarem.
//
// STOLIK POJAWIA SIE PO POTWIERDZENIU. Baza przydziela miejsce dopiero przy
// `accept`, wiec puste pole w zaproszeniu jest stanem poprawnym - i podpisujemy
// je zdaniem, a nie kreska, zeby uczestnik nie szukal stolika, ktorego nie ma.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarClock, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MeetingReasonDialog,
  MeetingRescheduleDialog,
} from "@/components/events/meetings/MeetingRespondDialogs";
import { formatEventDateTime, formatEventTime } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import { meetingErrorI18nKey } from "@/lib/events/meetingsErrors";
import type { MyMeetingRow } from "@/lib/events/meetingsApi";
import {
  bucketMeetings,
  canCancel,
  canReschedule,
  canRespond,
  counterpartLabel,
  counterpartRole,
  meetingStatusI18nKey,
  meetingStatusTone,
  tableLabel,
} from "@/lib/events/myMeetingRows";
import {
  useCancelMyMeeting,
  useRescheduleMyMeeting,
  useRespondToMeeting,
} from "@/lib/events/useMyMeetings";

type DialogState =
  | { kind: "none" }
  | { kind: "decline"; row: MyMeetingRow }
  | { kind: "cancel"; row: MyMeetingRow }
  | { kind: "reschedule"; row: MyMeetingRow };

export function MyMeetingsPanel({
  slug,
  rows,
  timezone,
}: {
  slug: string;
  rows: MyMeetingRow[];
  timezone: string | null;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

  const respond = useRespondToMeeting(slug);
  const cancel = useCancelMyMeeting(slug);
  const reschedule = useRescheduleMyMeeting(slug);

  const buckets = bucketMeetings(rows);

  function fail(error: Error): void {
    toast.error(t(meetingErrorI18nKey(error)));
  }

  function accept(row: MyMeetingRow): void {
    respond.mutate(
      { meetingId: row.id, decision: "accept" },
      { onSuccess: () => toast.success(t("eventMeetings.toasts.accepted")), onError: fail },
    );
  }

  function renderRow(row: MyMeetingRow) {
    const table = tableLabel(row);
    const role = counterpartRole(row);
    return (
      <div
        key={row.id}
        className="space-y-2 rounded-md border border-border px-3 py-3 sm:flex sm:items-start sm:justify-between sm:gap-4 sm:space-y-0"
      >
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">
              {counterpartLabel(row, t("eventMeetings.fields.counterpart"))}
            </p>
            <Badge variant={meetingStatusTone(row)}>{t(meetingStatusI18nKey(row))}</Badge>
          </div>
          {role !== null ? <p className="text-xs text-muted-foreground">{role}</p> : null}
          <p className="text-xs text-muted-foreground">
            {formatEventDateTime(row.starts_at, timezone, lang)}
            {" - "}
            {formatEventTime(row.ends_at, timezone, lang)}
          </p>
          <p className="text-xs text-muted-foreground">
            {table ?? t("eventMeetings.participant.meetings.tableUnassigned")}
            {table !== null && typeof row.table_seat === "number"
              ? ` · ${t("eventMeetings.participant.meetings.seat", { count: row.table_seat })}`
              : ""}
          </p>
          {typeof row.topic === "string" && row.topic.trim().length > 0 ? (
            <p className="text-xs">{row.topic}</p>
          ) : null}
          {canRespond(row) && typeof row.expires_at === "string" ? (
            <p className="text-xs text-muted-foreground">
              {t("eventMeetings.participant.meetings.expiresAt", {
                value: formatEventDateTime(row.expires_at, timezone, lang),
              })}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canRespond(row) ? (
            <>
              <Button size="sm" disabled={respond.isPending} onClick={() => accept(row)}>
                <Check className="mr-1.5 h-4 w-4" aria-hidden />
                {t("eventMeetings.actions.accept")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDialog({ kind: "decline", row })}
              >
                <X className="mr-1.5 h-4 w-4" aria-hidden />
                {t("eventMeetings.actions.decline")}
              </Button>
            </>
          ) : null}
          {canReschedule(row) ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialog({ kind: "reschedule", row })}
            >
              <CalendarClock className="mr-1.5 h-4 w-4" aria-hidden />
              {t("eventMeetings.actions.reschedule")}
            </Button>
          ) : null}
          {canCancel(row) ? (
            <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "cancel", row })}>
              {t("eventMeetings.actions.cancel")}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  function renderBucket(title: string, list: MyMeetingRow[]) {
    if (list.length === 0) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">{list.map(renderRow)}</CardContent>
      </Card>
    );
  }

  const active = dialog.kind === "none" ? null : dialog.row;

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("eventMeetings.empty.meetings")}</p>
      ) : null}

      {renderBucket(t("eventMeetings.participant.meetings.incoming"), buckets.incoming)}
      {renderBucket(t("eventMeetings.participant.meetings.outgoing"), buckets.outgoing)}
      {renderBucket(t("eventMeetings.status.all"), buckets.archive)}

      <MeetingReasonDialog
        open={dialog.kind === "decline" || dialog.kind === "cancel"}
        mode={dialog.kind === "cancel" ? "cancel" : "decline"}
        isPending={respond.isPending || cancel.isPending}
        onOpenChange={(next) => {
          if (!next) setDialog({ kind: "none" });
        }}
        onSubmit={(reason) => {
          if (active === null) return;
          if (dialog.kind === "cancel") {
            cancel.mutate(
              { meetingId: active.id, reason: reason.length > 0 ? reason : undefined },
              {
                onSuccess: () => {
                  toast.success(t("eventMeetings.toasts.cancelled"));
                  setDialog({ kind: "none" });
                },
                onError: fail,
              },
            );
            return;
          }
          respond.mutate(
            { meetingId: active.id, decision: "decline", declineReason: reason },
            {
              onSuccess: () => {
                toast.success(t("eventMeetings.toasts.declined"));
                setDialog({ kind: "none" });
              },
              onError: fail,
            },
          );
        }}
      />

      <MeetingRescheduleDialog
        open={dialog.kind === "reschedule"}
        slug={slug}
        counterpartRegistrationId={active?.counterpart_registration_id ?? null}
        timezone={timezone}
        isPending={reschedule.isPending}
        onOpenChange={(next) => {
          if (!next) setDialog({ kind: "none" });
        }}
        onSubmit={({ startsAt, message }) => {
          if (active === null) return;
          reschedule.mutate(
            { meetingId: active.id, startsAt, message: message ?? undefined },
            {
              onSuccess: () => {
                toast.success(t("eventMeetings.toasts.rescheduled"));
                setDialog({ kind: "none" });
              },
              onError: fail,
            },
          );
        }}
      />
    </div>
  );
}
