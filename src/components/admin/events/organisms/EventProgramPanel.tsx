// Organizm: PROGRAM WYDARZENIA - jeden ekran, dwa spojrzenia.
//
// ŚCIEŻKA JEST PUNKTEM WYJŚCIA, nie etykietą doklejaną do sesji. Organizator
// planuje pasmami („Polityka", „Energia"), a sesja jest wpisem w paśmie -
// dlatego domyślną zakładką są ścieżki, a sesje planuje się po wejściu w pasmo
// (`EventTrackWorkspace` → zakładka „Sesje").
//
// PEŁNA LISTA SESJI ZOSTAJE jako druga zakładka: sesje bez ścieżki, szukanie po
// całym programie i porządki masowe muszą mieć swoje miejsce - ale nie są
// pierwszym ekranem, bo to nie tak buduje się agendę.
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgendaSessionsPanel } from "@/components/admin/events/organisms/AgendaSessionsPanel";
import { AgendaTracksPanel } from "@/components/admin/events/organisms/AgendaTracksPanel";

interface EventProgramPanelProps {
  eventId: string;
  timeZoneLabel: string;
  /** Który widok otwiera się pierwszy - wejście z nawigacji decyduje. */
  defaultTab?: "tracks" | "sessions";
}

export function EventProgramPanel({
  eventId,
  timeZoneLabel,
  defaultTab = "tracks",
}: EventProgramPanelProps) {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="font-display text-lg">{t("adminEventAgenda.program.title")}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("adminEventAgenda.program.subtitle")}
        </p>
      </header>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="tracks">{t("adminEventAgenda.program.tabTracks")}</TabsTrigger>
          <TabsTrigger value="sessions">{t("adminEventAgenda.program.tabSessions")}</TabsTrigger>
        </TabsList>

        <TabsContent value="tracks" className="pt-4">
          <AgendaTracksPanel eventId={eventId} timeZoneLabel={timeZoneLabel} />
        </TabsContent>

        <TabsContent value="sessions" className="pt-4">
          <AgendaSessionsPanel eventId={eventId} timeZoneLabel={timeZoneLabel} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
