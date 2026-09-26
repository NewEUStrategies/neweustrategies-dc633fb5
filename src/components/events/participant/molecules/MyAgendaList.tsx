// Molekuła: MÓJ HARMONOGRAM - sesje, na które uczestnik jest zapisany.
//
// TO NIE JEST PROGRAM WYDARZENIA. Program mieszka w zakładce „Agenda"; tutaj
// pokazujemy wyłącznie własne zapisy (`event_session_signups`), posortowane po
// czasie rozpoczęcia, żeby ekran odpowiadał na pytanie „gdzie mam teraz być".
//
// GODZINA W STREFIE WYDARZENIA, NIE PRZEGLĄDARKI (EB-912). `event_my_agenda`
// oddaje strefę wydarzenia przy każdej sesji; godzina liczona w strefie
// urządzenia pokazywała uczestnikowi z innej strefy godzinę, o której sesja
// się NIE zaczyna - i tę samą różnicę między HTML-em serwera a klientem.
//
// STAN ZAPISU I STAN SESJI SĄ NA EKRANIE (D0-4). Sesja z listy rezerwowej
// i sesja odwołana dostają plakietkę: bez niej uczestnik z listy rezerwowej
// przychodził pod salę, do której nie zostanie wpuszczony, a odwołana sesja
// wyglądała jak aktualna. Adresu transmisji tu nie ma - osobisty plan nigdy
// go nie oddaje (D7).
import { useTranslation } from "react-i18next";
import { CalendarDays, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { uiLang } from "@/lib/i18n/format";
import { formatEventDateTime } from "@/lib/events/timezone";
import type { MyAgendaSession } from "@/lib/events/myEventProfileApi";
import { ensureI18n as ensureCartI18n } from "@/lib/i18n-cart";
import { ensureI18n as ensureEventParticipantI18n } from "@/lib/i18n-event-participant";

ensureCartI18n();
ensureEventParticipantI18n();

/** Data i godzina sesji - krótsza forma niż nagłówek wydarzenia, bo to lista. */
const AGENDA_MOMENT: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

export function MyAgendaList({
  sessions,
  loading,
}: {
  sessions: MyAgendaSession[];
  loading: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-20 w-full rounded-[6px]" />
        <Skeleton className="h-20 w-full rounded-[6px]" />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <p className="rounded-[6px] border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        {t("eventMe.agendaEmpty")}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {sessions.map((item) => {
        const title =
          (lang === "en" ? item.titleEn : item.titlePl) ?? t("eventMe.sessionFallbackTitle");
        const track = lang === "en" ? item.trackNameEn : item.trackNamePl;
        const when = formatEventDateTime(item.startsAt, item.timezone, lang, AGENDA_MOMENT);
        const cancelled = item.sessionStatus === "cancelled";
        return (
          <li
            key={item.sessionId}
            id={`event-session-${item.sessionId}`}
            className="flex flex-col gap-2 rounded-[6px] border border-border bg-card p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</p>
              {cancelled && (
                <Badge variant="destructive">{t("eventParticipant.agenda.cancelled")}</Badge>
              )}
              {item.signupStatus === "waitlist" && (
                <Badge variant="outline">{t("eventParticipant.agenda.waitlist")}</Badge>
              )}
              {track !== null && (
                <Badge variant="secondary" className="rounded-[6px]">
                  {track}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                {when === "" ? t("eventMe.noTime") : when}
              </span>
              {item.roomName !== null && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {item.roomName}
                </span>
              )}
              {item.roomFloor !== null && (
                <span>{t("eventParticipant.agenda.floor", { floor: item.roomFloor })}</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
