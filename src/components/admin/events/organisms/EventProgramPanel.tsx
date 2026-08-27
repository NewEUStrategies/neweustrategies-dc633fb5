// Organizm: PROGRAM WYDARZENIA - jeden ekran, jedno wejscie: sciezki.
//
// SCIEZKA JEST JEDNOSTKA PLANOWANIA, nie etykieta doklejana do sesji.
// Organizator uklada pasma („Polityka", „Energia"), a sesja jest wpisem w
// pasmie - dlatego program otwiera sie lista sciezek, a caly warsztat sesji
// (dodawanie, godziny, sala, publikacja) stoi w zakladce „Sesje" na stronie
// sciezki (`EventTrackWorkspace`).
//
// GLOBALNEJ LISTY SESJI TU NIE MA. Drugi ekran z tymi samymi sesjami rozdzielal
// program na dwa niezalezne widoki; sesje bez pasma widac w oknie przypinania
// sesji do sciezki.
import { useTranslation } from "react-i18next";
import { AgendaTracksPanel } from "@/components/admin/events/organisms/AgendaTracksPanel";
import { AgendaTimelinePanel } from "@/components/admin/events/organisms/AgendaTimelinePanel";

interface EventProgramPanelProps {
  eventId: string;
  timeZoneLabel: string;
  /** Strefa wydarzenia (IANA) - siatka czasu liczy doby w niej, nie w przeglądarce. */
  timezone?: string | null;
  /** Otwarte pasmo z adresu - patrz `AgendaTracksPanel`. */
  openedTrackId?: string | null;
  onOpenTrack?: (trackId: string | null) => void;
}


export function EventProgramPanel({
  eventId,
  timeZoneLabel,
  timezone,
  openedTrackId,
  onOpenTrack,
}: EventProgramPanelProps) {
  const { t } = useTranslation();

  // Gdy pasmo jest otwarte, nagłówek programu znika: warsztat ścieżki ma własny
  // nagłówek z powrotem i tytułem, a dwa nagłówki nad sobą tylko zabierają
  // wysokość paskowi zakładek.
  const isWorkspace = openedTrackId !== null && openedTrackId !== undefined && openedTrackId !== "";

  return (
    <section className="space-y-4">
      {!isWorkspace && (
        <header className="space-y-1">
          <h2 className="font-display text-lg">{t("adminEventAgenda.program.title")}</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t("adminEventAgenda.program.subtitle")}
          </p>
        </header>
      )}

      <AgendaTracksPanel
        eventId={eventId}
        timeZoneLabel={timeZoneLabel}
        openedTrackId={openedTrackId}
        onOpenTrack={onOpenTrack}
      />

      {/* Siatka stoi POD listą pasm i tylko poza warsztatem: w warsztacie
          ścieżki uwaga jest na jednym paśmie, a siatka mówi o całym dniu. */}
      {!isWorkspace && <AgendaTimelinePanel eventId={eventId} timezone={timezone ?? null} />}
    </section>
  );

}
