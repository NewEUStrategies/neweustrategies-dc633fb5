// Sticky podnawigacja modułu /admin/events/*.
//
// DLACZEGO PODNAWIGACJA, A NIE POZYCJE W SIDEBARZE. Moduł wydarzeń ma docelowo
// czternaście ekranów (pulpit, lista, rodzaje, prelegenci, rejestracja, agenda,
// bilety, sponsorzy, spotkania, komunikacja, onsite, regulaminy, integracje,
// analityka). Czternaście pozycji w sidebarze utopiłoby resztę panelu; sekcja
// z własnym paskiem trzyma je razem i mówi redaktorowi, GDZIE jest.
//
// LISTA ZAKŁADEK JEST DANYMI, nie JSX-em. Kolejne etapy dopisują JEDNĄ linię do
// `EVENT_TABS`, a nie kolejny blok `<Link>` - i wtedy nie da się dodać zakładki
// bez etykiety w obu językach ani zapomnieć o stanie aktywnym.
//
// ZAKŁADKA POJAWIA SIĘ TU DOPIERO Z TRASĄ. Pasek z odnośnikami do ekranów,
// których nie ma, uczy redaktora, że część panelu jest zepsuta - a to jest
// dokładnie ta klasa antywzorca, którą moduł ma nie powtarzać
// (`ANALIZA_BRAKUJACYCH_EKRANOW` §9.1: element bez rzeczywistego źródła nie
// wchodzi na ekran).
import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  Shapes,
  Handshake,
  Ticket,
  ListOrdered,
  CalendarCheck,
  ShieldCheck,
} from "@/lib/lucide-shim";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureI18n as ensureMeetingsI18n } from "@/lib/i18n-admin-event-meetings";
import { ensureI18n as ensureRegistrationI18n } from "@/lib/i18n-admin-event-registration";
import { ensureAgendaI18n } from "@/lib/i18n-admin-event-agenda";
import { ensureSponsorsI18n } from "@/lib/i18n-admin-event-sponsors";
import { ensureOnsiteI18n } from "@/lib/i18n-admin-event-onsite";
import { ensureTermsI18n } from "@/lib/i18n-admin-event-terms";

const EVENT_TABS = [
  {
    to: "/admin/events/list" as const,
    key: "list",
    icon: CalendarDays,
    labelKey: "adminEvents.nav.list",
  },
  {
    to: "/admin/events/types" as const,
    key: "types",
    icon: Shapes,
    labelKey: "adminEvents.nav.types",
  },
  {
    // Etykieta z własnego słownika zapisów - `adminEvents` nie musi znać jego kluczy.
    to: "/admin/events/registrations" as const,
    key: "registrations",
    icon: Ticket,
    labelKey: "adminEventRegistration.nav.sectionTitle",
  },
  {
    // Etykieta z własnego słownika agendy - program wydarzenia wozi swoje teksty.
    to: "/admin/events/agenda" as const,
    key: "agenda",
    icon: ListOrdered,
    labelKey: "adminEventAgenda.nav.sectionTitle",
  },
  {
    // Etykieta z własnego słownika sponsorów - moduł sponsorów wozi swoje teksty.
    to: "/admin/events/sponsors" as const,
    key: "sponsors",
    icon: Handshake,
    labelKey: "adminEventSponsors.nav.sectionTitle",
  },
  {
    // Etykieta z własnego słownika modułu na miejscu - odprawa wozi swoje teksty.
    to: "/admin/events/onsite" as const,
    key: "onsite",
    icon: CalendarCheck,
    labelKey: "adminEventOnsite.nav.sectionTitle",
  },
  {
    // Etykieta z własnego słownika grup i zgód - katalog uprawnień i dowodów
    // akceptacji wozi swoje teksty.
    to: "/admin/events/terms" as const,
    key: "terms",
    icon: ShieldCheck,
    labelKey: "adminEventTerms.nav.sectionTitle",
  },
  {
    // Etykieta z własnego słownika giełdy - moduł spotkań wozi swoje teksty,
    // a `adminEvents` nie musi wiedzieć, że giełda w ogóle istnieje.
    to: "/admin/events/meetings" as const,
    key: "meetings",
    icon: Handshake,
    labelKey: "adminEventMeetings.nav.section",
  },
] as const;

export function EventsSubNav() {
  ensureAdminEventsI18n();
  // Etykiety zakladek gieldy i zapisow mieszkaja we wlasnych slownikach modulow -
  // bez tych rejestracji pasek pokazalby surowe klucze zamiast nazw.
  ensureMeetingsI18n();
  ensureRegistrationI18n();
  ensureAgendaI18n();
  ensureSponsorsI18n();
  ensureTermsI18n();
  ensureOnsiteI18n();
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="sticky top-0 z-30 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-1 flex items-center gap-2 border-r border-border/60 pr-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
            <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
          <h1 className="font-display text-base leading-none sm:text-lg">
            {t("adminEvents.nav.sectionTitle")}
          </h1>
        </div>
        <nav
          className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/60 p-1"
          aria-label={t("adminEvents.nav.sectionsNavLabel")}
        >
          {EVENT_TABS.map((tab) => {
            const active = pathname.startsWith(tab.to);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.key}
                to={tab.to}
                aria-current={active ? "page" : undefined}
                className={
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm " +
                  (active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {t(tab.labelKey)}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
