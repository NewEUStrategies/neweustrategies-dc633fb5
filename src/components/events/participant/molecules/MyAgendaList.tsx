// Molekuła: MÓJ HARMONOGRAM - sesje, na które uczestnik jest zapisany.
//
// TO NIE JEST PROGRAM WYDARZENIA. Program mieszka w zakładce „Agenda"; tutaj
// pokazujemy wyłącznie własne zapisy (`event_session_signups`), posortowane po
// czasie rozpoczęcia, żeby ekran odpowiadał na pytanie „gdzie mam teraz być".
import { useTranslation } from "react-i18next";
import { CalendarDays, MapPin, Video } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { uiLang } from "@/lib/i18n/format";
import type { MyAgendaSession } from "@/lib/events/myEventProfileApi";
import { ensureI18n as ensureCartI18n } from "@/lib/i18n-cart";

ensureCartI18n();

function fmt(value: string | null, locale: string): string | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(ms),
  );
}

export function MyAgendaList({
  sessions,
  loading,
}: {
  sessions: MyAgendaSession[];
  loading: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const locale = lang === "en" ? "en-GB" : "pl-PL";

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
        const room = lang === "en" ? item.roomNameEn : item.roomNamePl;
        const track = lang === "en" ? item.trackNameEn : item.trackNamePl;
        const when = fmt(item.startsAt, locale);
        return (
          <li
            key={item.sessionId}
            className="flex flex-col gap-2 rounded-[6px] border border-border bg-card p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</p>
              {track !== null && (
                <Badge variant="secondary" className="rounded-[6px]">
                  {track}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                {when ?? t("eventMe.noTime")}
              </span>
              {room !== null && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {room}
                </span>
              )}
              {item.streamUrl !== null && (
                <a
                  href={item.streamUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 underline-offset-2 hover:text-foreground hover:underline"
                >
                  <Video className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("eventMe.joinStream")}
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
