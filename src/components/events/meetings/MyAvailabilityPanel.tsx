// Organizm: WLASNE OKNA DOSTEPNOSCI uczestnika.
//
// TA ZAKLADKA DZIALA TAKZE PRZY ZAMKNIETYCH ZAPISACH. Deklaracja dostepnosci
// jest warunkiem wstepnym giełdy, nie jej czescia: organizator otwiera
// zaproszenia na tydzien przed kongresem, a terminarz uczestnik uklada wczesniej.
// Dlatego blokada `closed` wycisza przyciski zaproszen, ale NIE ten ekran.
//
// OKNO ZAMKNIETE JEST OSOBNYM STANEM, NIE BRAKIEM OKNA. "Jestem na miejscu
// 14:00-16:00, ale prowadze wtedy panel" to inna informacja niz "nie ma mnie",
// i baza tez ja tak trzyma (`is_open`). Lista pokazuje ja odznaka, bo bez niej
// dwa wiersze wygladaja identycznie i roznia sie skutkiem.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AvailabilityWindowDialog } from "@/components/events/meetings/AvailabilityWindowDialog";
import { formatEventDateTime, formatEventTime } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import { meetingErrorI18nKey } from "@/lib/events/meetingsErrors";
import {
  draftFromWindow,
  type WindowDraft,
  type WindowPayload,
} from "@/lib/events/meetingWindowDraft";
import { useDeleteMyAvailability, useSaveMyAvailability } from "@/lib/events/useMyMeetings";
import type { MyAvailabilityWindow } from "@/lib/events/meetingExchange";

export function MyAvailabilityPanel({
  slug,
  windows,
  timezone,
  canEdit,
}: {
  slug: string;
  windows: MyAvailabilityWindow[];
  timezone: string | null;
  /** `false`, gdy wolajacy nie jest zapisany albo gielda nie jest wlaczona. */
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [draft, setDraft] = useState<WindowDraft | null>(null);
  const [open, setOpen] = useState(false);

  const save = useSaveMyAvailability(slug);
  const remove = useDeleteMyAvailability(slug);

  function submit(payload: WindowPayload): void {
    save.mutate(
      { ...payload, eventSlug: slug },
      {
        onSuccess: () => {
          toast.success(t("eventMeetings.toasts.availabilitySaved"));
          setOpen(false);
        },
        onError: (error) => toast.error(t(meetingErrorI18nKey(error))),
      },
    );
  }

  function drop(id: string): void {
    if (!window.confirm(t("eventMeetings.participant.availability.removeConfirm"))) return;
    remove.mutate(id, {
      onSuccess: () => toast.success(t("eventMeetings.toasts.availabilityRemoved")),
      onError: (error) => toast.error(t(meetingErrorI18nKey(error))),
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-lg">
            {t("eventMeetings.participant.availability.title")}
          </CardTitle>
          <CardDescription>
            {t("eventMeetings.participant.availability.description")}
          </CardDescription>
        </div>
        {canEdit ? (
          <Button
            size="sm"
            onClick={() => {
              setDraft(null);
              setOpen(true);
            }}
          >
            <CalendarPlus className="mr-2 h-4 w-4" aria-hidden />
            {t("eventMeetings.actions.addAvailability")}
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-2">
        {windows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("eventMeetings.empty.availability")}</p>
        ) : (
          windows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {formatEventDateTime(row.startsAt, timezone, lang)}
                  {" - "}
                  {formatEventTime(row.endsAt, timezone, lang)}
                </p>
                {row.note !== null ? (
                  <p className="truncate text-xs text-muted-foreground">{row.note}</p>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <Badge variant={row.isOpen ? "default" : "secondary"}>
                  {row.isOpen
                    ? t("eventMeetings.participant.availability.open")
                    : t("eventMeetings.participant.availability.closed")}
                </Badge>
                {canEdit ? (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("eventMeetings.participant.availability.dialogEdit")}
                      onClick={() => {
                        setDraft(draftFromWindow(row));
                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("eventMeetings.actions.removeAvailability")}
                      disabled={remove.isPending}
                      onClick={() => drop(row.id)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ))
        )}
      </CardContent>

      <AvailabilityWindowDialog
        open={open}
        draft={draft}
        timezone={timezone}
        isSaving={save.isPending}
        onSubmit={submit}
        onOpenChange={setOpen}
      />
    </Card>
  );
}
