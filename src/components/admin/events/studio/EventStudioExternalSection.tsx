// Sekcje studia, ktore NIE MAJA jeszcze wlasnej powierzchni per wydarzenie.
//
// PUSTA POZYCJA W SIDEBARZE JEST GORSZA NIZ SUCHY EKRAN. Sekcja
// `integrations` stoi w `EVENT_STUDIO_NAV`, bo nalezy do mapy studia i redaktor
// ma ja zobaczyc od razu, a nie odkrywac w kolejnym wydaniu. Klikniecie w nia
// nie moze jednak konczyc sie bialym ekranem: mowi WPROST, gdzie ta praca dzis
// mieszka.
//
// ODNOSNIK PROWADZI DO MODULU GLOBALNEGO, a nie do jego kopii w studiu.
// Kampanie, integracje i analityka sa wspolne dla calego serwisu; zduplikowanie
// ich per wydarzenie znaczyloby dwa miejsca do utrzymania i dwa zrodla prawdy
// o tym samym kluczu API.
//
// „FUNKCJI DODATKOWYCH" TU JUZ NIE MA. Ta sekcja miala wlasny wariant tego
// drogowskazu, dopoki nie istnial ekran przelacznikow modulow; dzis stoi za nia
// `EventFeaturesPanel`, ktory realnie zapisuje `events.features`. Zostawiona
// galaz klamalaby o zakresie tego komponentu - i przy nastepnej zmianie ktos
// szukalby, ktory z dwoch ekranow „Funkcji" widzi redaktor.
//
// „KOMUNIKACJI" TEZ JUZ NIE MA (F1-F5, spec B.12) - z tego samego powodu.
// Przypomnienia, eksport do kalendarza i dziennik doreczen sa ustawieniami PER
// WYDARZENIE, wiec trasa `communications` rysuje `EventCommunicationsPanel`
// (z wierszem-drogowskazem do kampanii). Nieuzywana galaz tutaj pokazywalaby
// zdanie „przypomnienia sa na tym ekranie" na ekranie, na ktorym ich nie ma.
//
// KOPIA JAKO DANE, NIE KOD. Nazwa sekcji, naglowek i zdanie to klucze i18n
// w tabeli; kolejna sekcja bez powierzchni dopisuje wiersz tabeli i galaz
// przycisku, a nie drugi, prawie identyczny plik.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import {
  EventStudioPage,
  EventStudioRow,
} from "@/components/admin/events/studio/EventStudioSection";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

/** Podzbior `EVENT_STUDIO_SECTIONS` bez wlasnej powierzchni w studiu. */
export type EventStudioExternalKey = "integrations";

interface ExternalCopy {
  /** Naglowek ekranu - TA SAMA etykieta, co pozycja w sidebarze. */
  sectionKey: string;
  /** Naglowek wiersza. */
  titleKey: string;
  /** Zdanie o tym, gdzie ta praca dzis mieszka. */
  descriptionKey: string;
}

const EXTERNAL_COPY: Record<EventStudioExternalKey, ExternalCopy> = {
  integrations: {
    sectionKey: "adminEvents.studio.sections.integrations",
    titleKey: "adminEvents.studio.external.integrationsTitle",
    descriptionKey: "adminEvents.studio.external.integrationsDescription",
  },
};

/**
 * Przycisk do modulu globalnego.
 *
 * SWITCH Z LITERALAMI, A NIE ADRES W TABELI: `to` jest typowane po zbiorze tras,
 * wiec adres podany zmienna traci sprawdzenie w czasie kompilacji - a wtedy
 * literowka w segmencie wychodzi dopiero jako 404 u redaktora.
 */
function ExternalModuleButton({
  section,
  label,
}: {
  section: EventStudioExternalKey;
  label: string;
}) {
  switch (section) {
    case "integrations":
      return (
        <Button asChild size="sm">
          <Link to="/admin/integrations">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </Link>
        </Button>
      );
  }
}

export function EventStudioExternalSection({ section }: { section: EventStudioExternalKey }) {
  ensureAdminEventsI18n();
  const { t } = useTranslation();
  const copy = EXTERNAL_COPY[section];
  return (
    <EventStudioPage title={t(copy.sectionKey)}>
      <EventStudioRow label={t(copy.titleKey)} description={t(copy.descriptionKey)}>
        <div className="flex flex-wrap justify-end gap-2">
          <ExternalModuleButton
            section={section}
            label={t("adminEvents.studio.external.openModule")}
          />
        </div>
      </EventStudioRow>
    </EventStudioPage>
  );
}
