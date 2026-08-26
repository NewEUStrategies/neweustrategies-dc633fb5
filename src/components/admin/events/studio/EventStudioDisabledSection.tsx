// Ekran sekcji, ktorej modul jest dla tego wydarzenia WYLACZONY.
//
// TRASA UKRYTEJ SEKCJI NADAL DZIALA - i to jest cala tresc tego pliku.
// Przelacznik w „Funkcjach dodatkowych" chowa POZYCJE W NAWIGACJI, a nie kasuje
// ekranu: adres `/admin/events/<id>/meetings/tables` wklejony w zgloszeniu do
// wsparcia, zapisany w zakladkach przegladarki albo wyslany wspolpracownikowi
// pol roku temu musi nadal cos pokazywac. Martwy link jest tu gorszy niz
// widoczna pozycja w sidebarze z dwoch powodow: (1) puste okno nie mowi, CZY
// dane zniknely - a nie zniknely, wylaczenie nie usuwa ani jednego zgloszenia
// czy stolika; (2) nie mowi, GDZIE to odkrecic, wiec konczy sie pytaniem do
// wsparcia zamiast jednym klikniecie w „Funkcje dodatkowe".
//
// JEDNO MIEJSCE, NIE OSIEMNASCIE TRAS. Bramka stoi w ramie studia
// (`EventStudioShell`), bo rama i tak zna aktywna sekcje i wiersz wydarzenia.
// Ten sam warunek dopisany do kazdej trasy sekcji rozjechalby sie przy pierwszym
// nowym ekranie - ktos by o nim zapomnial i dostal sekcje, ktora chowa sie
// w sidebarze, ale zyje pod adresem.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  EventStudioPage,
  EventStudioRow,
} from "@/components/admin/events/studio/EventStudioSection";
import { EVENT_STUDIO_ROUTES } from "@/lib/events/eventStudioNav";
import { EVENT_FEATURE_LABEL_KEYS, type EventFeatureKey } from "@/lib/events/eventFeatures";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

export function EventStudioDisabledSection({
  eventId,
  feature,
}: {
  eventId: string;
  /** Modul, ktory chowa te sekcje - nazywamy go, zamiast pisac „ten modul". */
  feature: EventFeatureKey;
}) {
  ensureAdminEventsI18n();
  const { t } = useTranslation();
  // NAGLOWKIEM JEST NAZWA MODULU, a nie „Sekcja wylaczona": redaktor wchodzi tu
  // z linku i pierwsze pytanie brzmi „co ja wlasciwie otwieram".
  const moduleName = t(EVENT_FEATURE_LABEL_KEYS[feature]);
  return (
    <EventStudioPage title={moduleName}>
      <EventStudioRow
        label={t("adminEvents.studio.features.disabled.title")}
        description={t("adminEvents.studio.features.disabled.description", { module: moduleName })}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button asChild size="sm">
            <Link to={EVENT_STUDIO_ROUTES.features} params={{ eventId }}>
              {t("adminEvents.studio.features.disabled.action")}
            </Link>
          </Button>
        </div>
      </EventStudioRow>
    </EventStudioPage>
  );
}
