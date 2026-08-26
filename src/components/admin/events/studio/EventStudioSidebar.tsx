// Lewy pas STUDIA WYDARZENIA.
//
// TO NIE JEST SIDEBAR PANELU. Panel administracyjny ma swoja nawigacje
// (`AdminShell`), a wydarzenie ma swoja: na czas pracy nad jednym wydarzeniem
// lewy pas nalezy do TEGO wydarzenia. Dwa poziomy nawigacji naraz zabralyby
// polowe szerokosci formularzowi o osiemnastu polach, a redaktor i tak nie
// przechodzi z „Grup wydarzenia" do „Kategorii bloga" w jednym ruchu.
//
// NAGLOWEK MOWI, KTORE WYDARZENIE JEST W REKU. Wzorzec stawia nad wyszukiwarka
// CZTERY rzeczy w tej kolejnosci: powrot o poziom wyzej, NAZWE wydarzenia, jego
// TERMIN i odnosnik do widoku publicznego. Nazwa i termin sa tu, a nie w pasku
// gornym, bo to jedyne dwie rzeczy, ktore odpowiadaja na pytanie „czy na pewno
// edytuje ten kongres, a nie zeszloroczny" - a pasek gorny nalezy do akcji.
// „Powrot do listy" i „Otworz wydarzenie" to DWA ROZNE wyjscia i oba musza byc:
// pierwsze wraca do katalogu w panelu, drugie pokazuje, co widzi uczestnik.
//
// NAGLOWEK PRZEWIJA SIE RAZEM Z LISTA, nie jest przyklejony. Przy dwudziestu
// dziewieciu ekranach przyklejony naglowek zjadlby jedna trzecia wysokosci pasa
// na napisy, ktore czyta sie raz przy wejsciu. Wzorzec przewija go tak samo.
//
// WYSZUKIWARKA JEST WEWNATRZ WYDARZENIA. Dwadziescia dziewiec ekranow to za
// duzo, zeby szukac wzrokiem, a nazwy nie sa oczywiste („QR" mieszka
// w „Odprawie") - dlatego pozycje niosa slowa kluczowe, a nie tylko etykiete.
// Trafienie w nazwe GRUPY pokazuje cala grupe: naglowek bez dzieci bylby
// wynikiem, w ktory nie ma gdzie kliknac.
//
// GRUPY SA DOMYSLNIE ZWINIETE, otwiera sie ta, w ktorej stoi aktywny ekran.
// Wszystkie rozwiniete naraz to dwadziescia dziewiec wierszy do przewiniecia
// przy kazdym spojrzeniu; wzorzec trzyma otwarta jedna.
//
// GRUPY Z AKTYWNA SEKCJA NIE DA SIE ZWINAC - i dlatego nie ma tam przycisku,
// tylko sama strzalka. Kontrolka, ktora nie robi tego, co obiecuje, jest gorsza
// niz jej brak.
//
// NAZWA GRUPY JEST ODNOSNIKIEM, strzalka osobnym przyciskiem. Klikniecie
// w nazwe prowadzi na pierwszy ekran grupy (i tym samym ja rozwija), bo
// „rozwin, potem wybierz pierwsza pozycje" to dwa klikniecia po to samo.
// Przycisk strzalki stoi OBOK odnosnika, a nie w nim: przycisk w srodku
// odnosnika jest niepoprawnym HTML-em i myli czytnik ekranu. Sluzy do
// ZAJRZENIA do grupy, w ktorej sie nie stoi.
//
// POZYCJE WYLACZONYCH MODULOW SA NIEOBECNE, A NIE WYSZARZONE. Webinar nie ma
// gieldy spotkan ani odprawy na miejscu, a wyszarzona pozycja to nadal wiersz do
// przewiniecia i do przeczytania - przy dwudziestu dziewieciu ekranach to jedyna
// roznica, ktora widac. Zbior sekcji do ukrycia liczy rama z `events.features`;
// TRASY tych sekcji nadal dzialaja, patrz `EventStudioDisabledSection`.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronLeft, ChevronUp, ExternalLink, Search } from "@/lib/lucide-shim";
import { Input } from "@/components/ui/input";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { cn } from "@/lib/utils";
import {
  EVENT_STUDIO_NAV,
  EVENT_STUDIO_ROUTES,
  matchesStudioQuery,
  type EventStudioNavNode,
  type EventStudioSection,
} from "@/lib/events/eventStudioNav";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureAgendaI18n } from "@/lib/i18n-admin-event-agenda";
import { ensureI18n as ensureMeetingsI18n } from "@/lib/i18n-admin-event-meetings";
import { ensureOnsiteI18n } from "@/lib/i18n-admin-event-onsite";
import { ensureI18n as ensureRegistrationI18n } from "@/lib/i18n-admin-event-registration";

export function EventStudioSidebar({
  eventId,
  eventTitle,
  startsAtLabel,
  activeSection,
  hiddenSections,
  publicHref,
}: {
  eventId: string;
  /** Nazwa wydarzenia w jezyku interfejsu - gotowy napis, sidebar nie wybiera. */
  eventTitle: string;
  /** Termin w strefie WYDARZENIA albo zdanie „bez terminu" - liczy rama. */
  startsAtLabel: string;
  activeSection: EventStudioSection | null;
  /**
   * Sekcje wylaczonych modulow - GOTOWY ZBIOR, liczy go rama z `events.features`.
   * Sidebar nie zna kolumny wydarzenia ani mapy „funkcja -> sekcje": jego
   * zadaniem jest nie narysowac tych pozycji.
   */
  hiddenSections: ReadonlySet<EventStudioSection>;
  /** Adres strony publicznej albo `null` dla szkicu - nie ma czego otwierac. */
  publicHref: string | null;
}) {
  // ETYKIETY PODPOZYCJI POCHODZA ZE SLOWNIKOW MODULOW („Sesje", „Stoliki",
  // „Odprawa"), wiec sidebar musi je zarejestrowac sam. Bez tego pierwsze
  // rozwiniecie grupy pokazuje gole klucze - sidebar jest w RAMIE, montuje sie
  // przed ekranem modulu i nie moze liczyc na to, ze ekran zdazyl je dolozyc.
  ensureAdminEventsI18n();
  ensureRegistrationI18n();
  ensureAgendaI18n();
  ensureMeetingsI18n();
  ensureOnsiteI18n();
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<readonly string[]>([]);

  const nodes = useMemo<readonly EventStudioNavNode[]>(() => {
    const words = (keys: readonly string[] | undefined): string[] =>
      (keys ?? []).map((key) => t(key));

    return EVENT_STUDIO_NAV.flatMap<EventStudioNavNode>((node) => {
      if (node.kind === "item") {
        if (hiddenSections.has(node.key)) return [];
        return matchesStudioQuery(query, t(node.labelKey), words(node.keywordKeys)) ? [node] : [];
      }
      // WYLACZONE MODULY ODPADAJA PRZED WYSZUKIWANIEM. Odwrotna kolejnosc
      // dawalaby wynik na haslo „stoliki" w wydarzeniu, ktore gieldy spotkan
      // nie ma - a wynik, ktory nie prowadzi do pracy, jest gorszy niz jego brak.
      const visible = node.entries.filter((entry) => !hiddenSections.has(entry.key));
      // GRUPA BEZ WIDOCZNYCH DZIECI ZNIKA CALA: sam naglowek jest wierszem,
      // ktory po rozwinieciu nic nie pokazuje, a po klikniecie prowadzi na ekran
      // wylaczonego modulu.
      if (visible.length === 0) return [];
      // Naglowek grupy prowadzi na pierwsze WIDOCZNE dziecko. Adres domyslny
      // wypisany w modelu moze byc wlasnie tym, ktory schowal przelacznik.
      const defaultSection = visible.some((entry) => entry.key === node.defaultSection)
        ? node.defaultSection
        : visible[0].key;
      // Trafienie w nazwe grupy przepuszcza WSZYSTKIE jej widoczne dzieci.
      const wholeGroup = matchesStudioQuery(query, t(node.labelKey), words(node.keywordKeys));
      const entries = wholeGroup
        ? visible
        : visible.filter((entry) =>
            matchesStudioQuery(query, t(entry.labelKey), words(entry.keywordKeys)),
          );
      return entries.length === 0 ? [] : [{ ...node, defaultSection, entries }];
    });
  }, [hiddenSections, query, t]);

  const searching = query.trim() !== "";

  return (
    <aside
      data-sidebar="sidebar"
      aria-label={t("adminEvents.studio.nav.label")}
      className="sticky top-[3.25rem] flex h-[calc(100vh-3.25rem)] w-64 shrink-0 flex-col self-start overflow-y-auto border-r border-border bg-card"
    >
      <div className="space-y-2 border-b border-border p-3">
        <Link
          to="/admin/events/list"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" aria-hidden="true" />
          {t("adminEvents.studio.nav.backToList")}
        </Link>

        {/* Nazwa ZAWIJA sie, nie jest ucinana: „II Kongres…" i „III Kongres…"
            roznia sie na koncu, wiec ucieta nazwa nie rozroznia wydarzen. */}
        <p className="text-sm font-semibold leading-snug text-foreground">{eventTitle}</p>
        <p className="text-xs text-muted-foreground">{startsAtLabel}</p>

        {publicHref === null ? (
          <span className="block text-xs text-muted-foreground">
            {t("adminEvents.studio.nav.openEventDraft")}
          </span>
        ) : (
          <a
            href={publicHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-brand underline underline-offset-2"
          >
            {t("adminEvents.studio.nav.openEvent")}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("adminEvents.studio.nav.searchPlaceholder")}
            aria-label={t("adminEvents.studio.nav.searchPlaceholder")}
            className="h-9 pl-8 text-[13px]"
          />
        </div>
      </div>

      <nav className="space-y-0.5 p-2">
        {nodes.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {t("adminEvents.studio.nav.searchEmpty")}
          </p>
        ) : null}

        {nodes.map((node) => {
          if (node.kind === "item") {
            return (
              <StudioLink
                key={node.key}
                eventId={eventId}
                section={node.key}
                icon={node.icon}
                label={t(node.labelKey)}
                active={activeSection === node.key}
              />
            );
          }

          const hasActive = node.entries.some((entry) => entry.key === activeSection);
          const isOpen = hasActive || searching || expanded.includes(node.key);

          return (
            <div key={node.key} className="pt-1">
              <div className="flex items-center">
                {/* Klik w nazwe grupy nie musi nic „rozwijac" recznie: prowadzi
                    na pierwsze dziecko, a grupa z aktywnym ekranem jest otwarta
                    z definicji. Efekt uboczny jest tu zaleta - poprzednia grupa
                    zwija sie sama, wiec otwarta zostaje jedna, tak jak we wzorcu. */}
                <Link
                  to={EVENT_STUDIO_ROUTES[node.defaultSection]}
                  params={{ eventId }}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-[13px] font-semibold text-foreground hover:bg-muted"
                >
                  <DynamicIcon name={node.icon} size={16} />
                  <span className="min-w-0 flex-1 truncate text-left">{t(node.labelKey)}</span>
                </Link>
                {hasActive ? (
                  <span className="px-1.5 py-1.5">
                    <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((previous) =>
                        previous.includes(node.key)
                          ? previous.filter((key) => key !== node.key)
                          : [...previous, node.key],
                      )
                    }
                    aria-expanded={isOpen}
                    aria-label={
                      isOpen
                        ? t("adminEvents.studio.nav.collapseGroup")
                        : t("adminEvents.studio.nav.expandGroup")
                    }
                    className="rounded-md px-1.5 py-1.5 hover:bg-muted"
                  >
                    {isOpen ? (
                      <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    ) : (
                      <ChevronDown
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                )}
              </div>
              {isOpen ? (
                <div className="mt-0.5 space-y-0.5 pl-6">
                  {node.entries.map((entry) => (
                    <StudioLink
                      key={entry.key}
                      eventId={eventId}
                      section={entry.key}
                      label={t(entry.labelKey)}
                      active={activeSection === entry.key}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function StudioLink({
  eventId,
  section,
  label,
  icon,
  active,
}: {
  eventId: string;
  section: EventStudioSection;
  label: string;
  /** Tylko pozycje NAJWYZSZEGO poziomu maja ikone - tak jak we wzorcu. */
  icon?: string;
  active: boolean;
}) {
  return (
    <Link
      to={EVENT_STUDIO_ROUTES[section]}
      params={{ eventId }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-2 text-[13px] transition-colors",
        active
          ? "bg-brand/10 font-medium text-brand"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {icon === undefined ? null : <DynamicIcon name={icon} size={16} />}
      <span className="truncate">{label}</span>
    </Link>
  );
}
