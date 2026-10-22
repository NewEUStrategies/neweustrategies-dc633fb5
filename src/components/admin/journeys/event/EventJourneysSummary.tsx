// Aktywne ścieżki wydarzeń na Pulpicie studia wydarzenia (SPEC §2.7, montaż
// I9) - leniwy chunk ładowany dopiero, gdy rola widzi zakładkę Ścieżki.
//
// UCZCIWA SKALA: WSZYSTKIE WYDARZENIA, NIE TO JEDNO. Lista ścieżek
// (`admin_journey_list`) zna typ zdarzenia wyzwalacza, ale nie jego warunki
// (filtr `event_id` żyje w definicji wersji) - więc karta liczy aktywne
// ścieżki uruchamiane zdarzeniem wydarzenia (`event.*`: zapis, obecność)
// i mówi wprost, że działają dla wszystkich wydarzeń. Liczba „dla tego
// wydarzenia" bez warunku byłaby zgadywaniem.
//
// ZERO DODATKOWYCH ZAPYTAŃ W PANELU. Ten sam klucz i `queryFn` co licznik
// Ścieżek w hubie (`journeyListQueryOptions(tenantId, null)`) z `select` -
// admin, który przyszedł z huba, nie wysyła żadnego żądania.
//
// ODMOWA I BRAK MFA NIE SĄ BŁĘDEM MODUŁU. Lista ścieżek wymaga aal2: bez niej
// karta pokazuje sam odnośnik do zakładki (tam hub poprosi o drugi składnik),
// a nie komunikat o błędzie w studiu wydarzenia.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { RevenueHubLink } from "@/components/admin/revenue/molecules/RevenueHubLink";
import type { JourneyListItem, JourneyRead } from "@/lib/journeys/dto";
import { journeyListQueryOptions } from "@/lib/journeys/queries";
import { ensureI18n } from "@/lib/i18n-admin-revenue-links";

/** Prefiks typów zdarzeń wydarzeń (`event.registration.created.v1`, `…attended.v1`). */
const EVENT_TRIGGER_PREFIX = "event.";
/** Tyle nazw mieści się w wierszu studia; resztę pokazuje lista w hubie. */
const NAMES_SHOWN = 3;

interface EventJourneyItem {
  id: string;
  name: string;
}

/** Aktywne ścieżki z wyzwalaczem wydarzenia albo `null` (odmowa, niewdrożone). */
function selectEventJourneys(read: JourneyRead<JourneyListItem[]>): EventJourneyItem[] | null {
  if (read.state !== "ready") return null;
  return read.data
    .filter(
      (item) =>
        item.status === "active" && (item.triggerEventType ?? "").startsWith(EVENT_TRIGGER_PREFIX),
    )
    .map((item) => ({ id: item.id, name: item.name }));
}

export default function EventJourneysSummary({ tenantId }: { tenantId: string }) {
  ensureI18n();
  const { t } = useTranslation();
  const query = useQuery({
    ...journeyListQueryOptions(tenantId, null),
    select: selectEventJourneys,
  });
  const items = query.data ?? null;
  const openList = (
    <RevenueHubLink tab="journeys" search={{ status: "active" }}>
      {t("adminRevenue.moduleLinks.events.journeysOpen")}
    </RevenueHubLink>
  );

  // Przed odpowiedzią, przy odmowie (MFA) i niewdrożeniu - sam odnośnik.
  if (items === null) {
    return <div data-testid="event-journeys-summary">{openList}</div>;
  }

  if (items.length === 0) {
    return (
      <div data-testid="event-journeys-summary" className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {t("adminRevenue.moduleLinks.events.journeysNone")}
        </p>
        <RevenueHubLink
          tab="journeys"
          search={{ new: "1", template: "event_registration_nurture" }}
        >
          {t("adminRevenue.moduleLinks.events.automateAction")}
        </RevenueHubLink>
      </div>
    );
  }

  return (
    <div data-testid="event-journeys-summary" className="space-y-2">
      <p className="text-sm font-medium">
        {t("adminRevenue.moduleLinks.events.journeysCount", { count: items.length })}
      </p>
      <ul className="space-y-1 text-sm">
        {items.slice(0, NAMES_SHOWN).map((item) => (
          <li key={item.id}>
            <Link
              to="/admin/revenue/journeys/$journeyId"
              params={{ journeyId: item.id }}
              className="underline-offset-2 hover:underline focus-visible:underline"
            >
              {item.name}
            </Link>
          </li>
        ))}
      </ul>
      {openList}
    </div>
  );
}
