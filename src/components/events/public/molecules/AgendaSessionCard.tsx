// Molekuła: jedna sesja programu.
//
// TRZY OSIE, TRZY WIERSZE. Czas i miejsce stoją nad tytułem (uczestnik skanuje
// program godzinami, nie tytułami), tytuł z opisem w środku, a dostęp - stan
// i kontrolka - na dole. Kolejność jest ta sama na telefonie i na ekranie,
// zmienia się tylko szerokość: przy `sm` czas przechodzi do lewej kolumny.
//
// OPIS ZWIJA SIĘ, BO PROGRAM MA BYĆ SKANOWALNY. Dwudniowy kongres to
// kilkadziesiąt sesji; rozwinięte opisy zamieniają program w ścianę tekstu,
// w której nie da się znaleźć własnej sesji.
//
// KONTROLKA POCHODZI Z REGUŁY, NIE Z `if`-ów. `agendaSignupControl` decyduje,
// czy przycisk jest, co na nim pisze i jak wygląda - ten sam rachunek obsługuje
// „moją agendę", więc obie powierzchnie nie mogą się rozjechać.
import { useState } from "react";
import { CalendarClock, ChevronDown, DoorOpen, Loader2, Radio, Users, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { formatEventTime } from "@/lib/events/timezone";
import {
  agendaFormatKey,
  agendaSeatsLeft,
  agendaSignupControl,
  type AgendaSession,
} from "@/lib/events/agendaSurface";
import { SessionStateBadge } from "@/components/events/public/atoms/SessionStateBadge";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

export function AgendaSessionCard({
  session,
  pending,
  signedIn,
  onSignup,
  onCancel,
}: {
  session: AgendaSession;
  pending: boolean;
  signedIn: boolean;
  onSignup: (session: AgendaSession) => void;
  onCancel: (session: AgendaSession) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [open, setOpen] = useState(false);

  const title = pickLocalized(
    { title_pl: session.titlePl, title_en: session.titleEn },
    "title",
    lang,
  );
  const description = pickLocalized(
    { description_pl: session.descriptionPl, description_en: session.descriptionEn },
    "description",
    lang,
  );
  const trackName =
    session.track === null
      ? ""
      : pickLocalized(
          { name_pl: session.track.namePl, name_en: session.track.nameEn },
          "name",
          lang,
        );

  const startTime = formatEventTime(session.startsAt, session.timezone, lang);
  const endTime = formatEventTime(session.endsAt, session.timezone, lang);
  const accent = session.track?.accentColor ?? null;
  const control = agendaSignupControl(session);
  const seatsLeft = agendaSeatsLeft(session);
  const cancelled = session.status === "cancelled";

  return (
    <article
      className={cn(
        "rounded-[6px] border border-border bg-card p-4 transition-colors sm:p-5",
        cancelled && "opacity-70",
        session.mySignupStatus === "registered" && "border-primary/50",
      )}
      // Kolor nurtu jest AKCENTEM, nie tłem - kontrast tekstu nie może zależeć
      // od barwy wpisanej w panelu.
      style={accent === null ? undefined : { borderLeftColor: accent, borderLeftWidth: "3px" }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-5">
        <div className="flex shrink-0 items-center gap-2 text-sm font-medium text-foreground sm:w-28 sm:flex-col sm:items-start sm:gap-0">
          <CalendarClock className="h-4 w-4 text-muted-foreground sm:hidden" aria-hidden="true" />
          <span>{startTime}</span>
          <span className="text-muted-foreground">{endTime}</span>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {trackName !== "" && (
              <Badge variant="outline" className="whitespace-nowrap">
                {trackName}
              </Badge>
            )}
            <SessionStateBadge state={session.accessState} />
            {session.chathamHouse && (
              <Badge variant="outline">{t("eventFront.agenda.chathamHouse")}</Badge>
            )}
          </div>

          <h3 className="text-base font-semibold leading-snug text-foreground">{title}</h3>

          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div className="inline-flex items-center gap-1.5">
              <dt className="sr-only">{t("eventFront.list.formatLabel")}</dt>
              <Radio className="h-3.5 w-3.5" aria-hidden="true" />
              <dd>{t(agendaFormatKey(session.format))}</dd>
            </div>
            {session.room !== null && (
              <div className="inline-flex items-center gap-1.5">
                <dt className="sr-only">{t("eventFront.agenda.roomLabel")}</dt>
                <DoorOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <dd>
                  {session.room.name ?? ""}
                  {session.room.floor === null ? "" : ` (${session.room.floor})`}
                </dd>
              </div>
            )}
            {session.speakers.length > 0 && (
              <div className="inline-flex items-center gap-1.5">
                <dt className="sr-only">{t("eventFront.agenda.speakersLabel")}</dt>
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                <dd>{session.speakers.map((speaker) => speaker.displayName).join(", ")}</dd>
              </div>
            )}
            {session.hasStream && (
              <div className="inline-flex items-center gap-1.5">
                <dt className="sr-only">{t("eventFront.agenda.streamAvailable")}</dt>
                <Video className="h-3.5 w-3.5" aria-hidden="true" />
                <dd>{t("eventFront.agenda.streamAvailable")}</dd>
              </div>
            )}
          </dl>

          {description !== "" && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
                className="-ml-2 gap-1.5 text-xs"
              >
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
                  aria-hidden="true"
                />
                {open ? t("eventFront.agenda.closeDetails") : t("eventFront.agenda.openDetails")}
              </Button>
              {open && (
                <p className="whitespace-pre-line text-sm text-muted-foreground">{description}</p>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 sm:w-44 sm:items-end">
          {seatsLeft !== null && !cancelled && (
            <span className="text-xs text-muted-foreground">
              {t("eventFront.agenda.seatsLeft", { count: seatsLeft })}
            </span>
          )}
          {seatsLeft === null && session.requiresSignup && !cancelled && (
            <span className="text-xs text-muted-foreground">
              {t("eventFront.agenda.seatsUnlimited")}
            </span>
          )}
          {control !== null && (
            <Button
              type="button"
              size="sm"
              variant={control.variant}
              disabled={pending}
              onClick={() => (control.action === "cancel" ? onCancel(session) : onSignup(session))}
              className="w-full sm:w-auto"
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {pending
                ? t("eventFront.agenda.actions.working")
                : signedIn
                  ? t(control.labelKey)
                  : t("eventFront.agenda.actions.signIn")}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
