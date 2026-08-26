// Molekuła: jeden BLOK sesji programu w układzie ekranu wzorcowego.
//
// TYTUŁ, CZAS, OBSADA - W TEJ KOLEJNOŚCI. Wzorzec stawia u góry pogrubiony
// tytuł, pod nim ikonę zegara z przedziałem („27 lis 2024, 10:00 do 11:45”),
// a pod spodem rząd prelegentów - miniatura zdjęcia plus nazwisko i organizacja.
// Poprzedni układ prowadził godziną w osobnej kolumnie po lewej; zmiana jest
// PREZENTACYJNA, dane i reguła zapisu zostają te same.
//
// BLOK, NIE KARTA. Sesje rozdziela cienka linia rysowana przez listę (`divide-y`),
// więc blok nie ma własnej ramki - inaczej program byłby stosem prostokątów
// w prostokącie. Kolor nurtu zostaje jako trzypikselowy AKCENT po lewej, a wcięcie
// jest STAŁE (także bez nurtu), żeby tytuły w jednej liście trzymały jedną linię.
//
// PRZEDZIAŁ LICZY SIĘ W STREFIE WYDARZENIA. Uczestnik z Brukseli czyta „10:00”
// inaczej niż organizator w Warszawie i przychodzi o złej porze - dlatego godziny
// idą przez `formatEventDateTime` ze strefą sesji, a nie przez `Date` przeglądarki.
// Sesja przechodząca przez północ dostaje w końcówce PEŁNĄ datę: samo „01:30”
// obok „23:00” czyta się jak literówka, a nie jak nocny panel.
//
// PUSTY RZĄD TO USZKODZONE DANE. Sesja bez obsady nie zostawia nagłówka „Prelegenci”
// nad niczym, a prelegent bez nazwy do wyświetlenia nie dostaje wiersza z pogrubioną
// pustką - takie miejsca czytają się jak awaria strony, a nie jak brak informacji.
//
// KONTROLKA POCHODZI Z REGUŁY, NIE Z `if`-ów. `agendaSignupControl` decyduje,
// czy przycisk jest, co na nim pisze i jak wygląda - ten sam rachunek obsługuje
// „moją agendę", więc obie powierzchnie nie mogą się rozjechać.
import { useState } from "react";
import { ChevronDown, Clock, DoorOpen, Loader2, Radio, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { uiLang, type UiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import {
  eventDayKey,
  formatEventDate,
  formatEventDateTime,
  formatEventTime,
} from "@/lib/events/timezone";
import {
  agendaFormatKey,
  agendaSeatsLeft,
  agendaSessionTitle,
  agendaSignupControl,
  type AgendaSession,
  type AgendaSpeaker,
} from "@/lib/events/agendaSurface";
import { SessionStateBadge } from "@/components/events/public/atoms/SessionStateBadge";
import { SpeakerAvatar } from "@/components/events/SpeakerAvatar";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

/** Prefiks identyfikatora bloku - kolumna „Twój harmonogram" celuje tu odnośnikiem. */
export function agendaSessionAnchor(sessionId: string): string {
  return `event-session-${sessionId}`;
}

/**
 * Wiersz prelegenta w bloku sesji: okrągła miniatura zdjęcia (u nas promień 6px -
 * spec zdjęć profilowych zostaje) plus dwie linie tekstu.
 *
 * ORGANIZACJA POCHODZI Z `headline`, BO AGENDA NIE ODDAJE FIRMY. `event_agenda`
 * buduje obsadę z `speaker_profiles.headline_pl/en`; osobnej kolumny z organizacją
 * w tym RPC nie ma, a dołożenie jej to zmiana kontraktu bazy, nie widoku.
 */
function AgendaSpeakerRow({ speaker, lang }: { speaker: AgendaSpeaker; lang: UiLang }) {
  const headline = pickLocalized(
    { headline_pl: speaker.headlinePl, headline_en: speaker.headlineEn },
    "headline",
    lang,
  );
  return (
    <li className="flex min-w-0 items-center gap-2">
      <SpeakerAvatar name={speaker.displayName} photoUrl={speaker.avatarUrl} size="sm" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold leading-tight text-foreground">
          {speaker.displayName}
        </span>
        {headline !== "" && (
          // Ucięta nazwa organizacji zostaje w `title` - w trzech kolumnach
          // wielokropek jest właściwy dla układu, ale strata informacji nie.
          <span
            className="block truncate text-xs leading-tight text-muted-foreground"
            title={headline}
          >
            {headline}
          </span>
        )}
      </span>
    </li>
  );
}

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

  // Tytuł idzie przez wspólną regułę, bo ten sam napis pokazuje kolumna
  // „Twój harmonogram” - dwa rachunki rozjechałyby się na sesji wpisanej
  // tylko w jednym języku.
  const title = agendaSessionTitle(session, lang);
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

  const endsSameDay =
    eventDayKey(session.startsAt, session.timezone) ===
    eventDayKey(session.endsAt, session.timezone);
  const timeRange = t("eventFront.agenda.timeRange", {
    date: formatEventDate(session.startsAt, session.timezone, lang),
    start: formatEventTime(session.startsAt, session.timezone, lang),
    end: endsSameDay
      ? formatEventTime(session.endsAt, session.timezone, lang)
      : formatEventDateTime(session.endsAt, session.timezone, lang, {
          dateStyle: "medium",
          timeStyle: "short",
        }),
  });

  const accent = session.track?.accentColor ?? null;
  const control = agendaSignupControl(session);
  const seatsLeft = agendaSeatsLeft(session);
  const cancelled = session.status === "cancelled";
  const speakers = session.speakers.filter((speaker) => speaker.displayName !== "");

  return (
    <article
      id={agendaSessionAnchor(session.id)}
      className={cn(
        "scroll-mt-24 border-l-[3px] py-5 pl-4 transition-colors",
        cancelled && "opacity-70",
      )}
      // Kolor nurtu jest AKCENTEM, nie tłem - kontrast tekstu nie może zależeć
      // od barwy wpisanej w panelu.
      style={{ borderLeftColor: accent ?? "transparent" }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="text-base font-semibold leading-snug text-foreground">{title}</h3>

          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <time dateTime={session.startsAt}>{timeRange}</time>
          </p>

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

      {speakers.length > 0 && (
        <ul
          aria-label={t("eventFront.agenda.speakersLabel")}
          className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {speakers.map((speaker) => (
            <AgendaSpeakerRow key={speaker.userId} speaker={speaker} lang={lang} />
          ))}
        </ul>
      )}
    </article>
  );
}
