// PODSTRONY MODULOWE W PODGLADZIE STUDIA - PRAWDZIWE DANE, RYSUNEK Z PRODUKCJI.
//
// PROBLEM, KTORY TO ZAMYKA. Zakladki „Program", „Prelegenci" i „Uczestnicy"
// stoja na projekcjach publicznych z bramka `AND e.status = 'published'`
// (albo na tozsamosci wolajacego), wiec w podgladzie SZKICU oddawaly pustke -
// redaktor widzial sam dokument CMS bez ani jednej sesji, ktora wlasnie wpisal.
//
// CZEGO TU NIE MA. WLASNEGO UKLADU. Karty rysuja komponenty produkcyjne:
// `AgendaSessionCard`, `EventSpeakersGridView`, `EventAttendeesGridView` - te
// same, ktorych uzywaja `EventAgendaSection`, `EventSpeakersGrid`
// i `EventAttendeesList`. Ten plik wnosi wylacznie ZRODLO DANYCH (RPC panelu
// zamiast projekcji publicznej) i martwe przyciski zapisu: organizator ma
// zobaczyc program, a nie zapisac sie na sesje z ekranu panelu.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { AgendaSessionCard } from "@/components/events/public/molecules/AgendaSessionCard";
import { EventSpeakersGridView } from "@/components/events/public/organisms/EventSpeakersGrid";
import { EventAttendeesGridView } from "@/components/events/public/organisms/EventAttendeesList";
import { groupAgendaByDay, type AgendaSession } from "@/lib/events/agendaSurface";
import { formatEventDate } from "@/lib/events/timezone";
import type { AttendeeEntry } from "@/lib/events/publicEventApi";
import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import { uiLang } from "@/lib/i18n/format";

/** Fakty modulowe, ktore nakladka podgladu dociaga RPC panelu. */
export interface EventPreviewLiveData {
  sessions: AgendaSession[];
  speakers: PublicSpeakerRow[];
  attendees: AttendeeEntry[];
}

export const EMPTY_PREVIEW_LIVE_DATA: EventPreviewLiveData = {
  sessions: [],
  speakers: [],
  attendees: [],
};

function EmptyNote({ text }: { text: string }) {
  return (
    <p className="rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
      {text}
    </p>
  );
}

/** Program dnia po dniu - ta sama kolejnosc i ten sam podzial, co na stronie. */
function PreviewAgenda({ sessions }: { sessions: readonly AgendaSession[] }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const days = useMemo(() => groupAgendaByDay(sessions), [sessions]);

  if (days.length === 0) return <EmptyNote text={t("adminEvents.studio.preview.moduleEmptyAgenda")} />;

  return (
    <div className="space-y-6">
      {days.map((day) => (
        <section key={day.key} className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            {formatEventDate(day.startsAt, day.timezone, lang)}
          </h2>
          <ul className="space-y-3">
            {day.sessions.map((session) => (
              <li key={session.id}>
                <AgendaSessionCard
                  session={session}
                  pending={false}
                  // Podglad NIE zapisuje na sesje: „niezalogowany" wygasza
                  // przycisk zapisu bez dokladania warunku do karty.
                  signedIn={false}
                  onSignup={() => undefined}
                  onCancel={() => undefined}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Tresc podstrony modulowej w podgladzie - albo `null`, gdy modul nie ma
 * wlasnej powierzchni danych (materialy, dyskusje, partnerzy rysuja sie gdzie
 * indziej).
 */
export function EventPreviewLiveModule({
  module,
  data,
}: {
  module: string;
  data: EventPreviewLiveData;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  if (module === "agenda") return <PreviewAgenda sessions={data.sessions} />;

  if (module === "speakers") {
    if (data.speakers.length === 0)
      return <EmptyNote text={t("adminEvents.studio.preview.moduleEmptySpeakers")} />;
    return <EventSpeakersGridView speakers={data.speakers} lang={lang} />;
  }

  if (module === "participants") {
    if (data.attendees.length === 0)
      return <EmptyNote text={t("adminEvents.studio.preview.moduleEmptyAttendees")} />;
    return <EventAttendeesGridView entries={data.attendees} lang={lang} />;
  }

  return null;
}
