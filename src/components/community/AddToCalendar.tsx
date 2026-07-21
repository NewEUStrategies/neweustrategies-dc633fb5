// "Dodaj do kalendarza" - molekuła na detalu wydarzenia. Trzy ścieżki:
// Google / Outlook (głębokie linki w nowej karcie) i pobranie pliku .ics
// (Apple/Thunderbird/import ręczny). Generacja w lib/community/calendar.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarPlus, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  buildEventIcs,
  downloadIcs,
  googleCalendarUrl,
  icsFileName,
  outlookCalendarUrl,
  type CalendarEventInput,
} from "@/lib/community/calendar";
import type { PublicEvent } from "@/lib/community/publicQueries";

function toCalendarInput(
  event: PublicEvent,
  lang: "pl" | "en",
  origin: string,
): CalendarEventInput {
  const title = lang === "en" ? event.title_en || event.title_pl : event.title_pl || event.title_en;
  const description = lang === "en" ? event.description_en : event.description_pl;
  return {
    uid: event.id,
    title,
    description,
    location: event.location,
    url: origin ? `${origin}/events/${event.slug}` : `/events/${event.slug}`,
    startsAt: new Date(event.starts_at),
    endsAt: event.ends_at ? new Date(event.ends_at) : null,
  };
}

export function AddToCalendar({ event, lang }: { event: PublicEvent; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const input = useMemo(
    () => toCalendarInput(event, lang, typeof window === "undefined" ? "" : window.location.origin),
    [event, lang],
  );
  // Wczesne zbudowanie ICS waliduje dane wejściowe zanim pokażemy opcje.
  const hasValidStart = useMemo(() => {
    if (Number.isNaN(input.startsAt.getTime())) return false;
    return buildEventIcs(input).includes("BEGIN:VEVENT");
  }, [input]);

  if (!hasValidStart) return null;

  const itemClass =
    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-label={t("community.events.calendarAdd")}>
          <CalendarPlus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("community.events.calendarAdd")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("community.events.calendarPick")}
        </p>
        <a
          href={googleCalendarUrl(input)}
          target="_blank"
          rel="noreferrer"
          className={itemClass}
          onClick={() => setOpen(false)}
        >
          <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("community.events.calendarGoogle")}
        </a>
        <a
          href={outlookCalendarUrl(input)}
          target="_blank"
          rel="noreferrer"
          className={itemClass}
          onClick={() => setOpen(false)}
        >
          <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("community.events.calendarOutlook")}
        </a>
        <button
          type="button"
          className={itemClass}
          onClick={() => {
            downloadIcs(input, icsFileName(event.slug));
            setOpen(false);
          }}
        >
          <Download className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("community.events.calendarIcs")}
        </button>
      </PopoverContent>
    </Popover>
  );
}
