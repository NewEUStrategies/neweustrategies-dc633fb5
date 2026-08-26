// Sekcje studia, ktore NIE MAJA jeszcze wlasnej powierzchni per wydarzenie.
//
// PUSTA POZYCJA W SIDEBARZE JEST GORSZA NIZ SUCHY EKRAN. Cztery sekcje
// (`communications`, `integrations`, `features`) stoja w
// `EVENT_STUDIO_NAV`, bo naleza do mapy studia i redaktor ma je zobaczyc od
// razu, a nie odkrywac w kolejnym wydaniu. Klikniecie w nie nie moze jednak
// konczyc sie bialym ekranem: kazda mowi WPROST, gdzie ta praca dzis mieszka.
//
// ODNOSNIK PROWADZI DO MODULU GLOBALNEGO, a nie do jego kopii w studiu.
// Kampanie, integracje i analityka sa wspolne dla calego serwisu; zduplikowanie
// ich per wydarzenie znaczyloby dwa miejsca do utrzymania i dwa zrodla prawdy
// o tym samym kluczu API.
//
// „Funkcje" NIE MAJA GLOBALNEGO ODPOWIEDNIKA. Kolumna `events.features` istnieje
// od migracji `20260826090000_event_studio_general.sql`, ale ekran przelacznikow
// jeszcze nie - wiec ta jedna sekcja konczy sie na zdaniu o stanie. Przycisk
// prowadzacy donikad byloby gorszy niz jego brak.
//
// JEDEN KOMPONENT NA CZTERY SEKCJE. Cztery prawie identyczne pliki rozjechalyby
// sie na pierwszej zmianie ukladu; roznica miedzy nimi to dwa klucze i18n
// i adres docelowy, czyli DANE, a nie kod.
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
export type EventStudioExternalKey = "communications" | "integrations" | "features";

interface ExternalCopy {
  /** Naglowek ekranu - TA SAMA etykieta, co pozycja w sidebarze. */
  sectionKey: string;
  /** Naglowek wiersza. */
  titleKey: string;
  /** Zdanie o tym, gdzie ta praca dzis mieszka. */
  descriptionKey: string;
}

const EXTERNAL_COPY: Record<EventStudioExternalKey, ExternalCopy> = {
  communications: {
    sectionKey: "adminEvents.studio.sections.communications",
    titleKey: "adminEvents.studio.external.communicationsTitle",
    descriptionKey: "adminEvents.studio.external.communicationsDescription",
  },
  integrations: {
    sectionKey: "adminEvents.studio.sections.integrations",
    titleKey: "adminEvents.studio.external.integrationsTitle",
    descriptionKey: "adminEvents.studio.external.integrationsDescription",
  },
  features: {
    sectionKey: "adminEvents.studio.sections.features",
    titleKey: "adminEvents.studio.external.featuresTitle",
    descriptionKey: "adminEvents.studio.external.featuresDescription",
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
    case "communications":
      return (
        <Button asChild size="sm">
          <Link to="/admin/newsletter/campaigns">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </Link>
        </Button>
      );
    case "integrations":
      return (
        <Button asChild size="sm">
          <Link to="/admin/integrations">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </Link>
        </Button>
      );
    // „Funkcje" celowo bez przycisku - patrz naglowek pliku.
    case "features":
      return null;
  }
}

export function EventStudioExternalSection({ section }: { section: EventStudioExternalKey }) {
  ensureAdminEventsI18n();
  const { t } = useTranslation();
  const copy = EXTERNAL_COPY[section];
  return (
    <EventStudioPage title={t(copy.sectionKey)}>
      <EventStudioRow label={t(copy.titleKey)} description={t(copy.descriptionKey)}>
        {section === "features" ? null : (
          <div className="flex flex-wrap justify-end gap-2">
            <ExternalModuleButton
              section={section}
              label={t("adminEvents.studio.external.openModule")}
            />
          </div>
        )}
      </EventStudioRow>
    </EventStudioPage>
  );
}
