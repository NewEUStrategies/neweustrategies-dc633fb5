// Lewy pas STUDIA WYDARZENIA.
//
// TO NIE JEST SIDEBAR PANELU. Panel administracyjny ma swoja nawigacje
// (`AdminShell`), a wydarzenie ma swoja: na czas pracy nad jednym wydarzeniem
// lewy pas nalezy do TEGO wydarzenia. Dwa poziomy nawigacji naraz zabralyby
// polowe szerokosci formularzowi o osiemnastu polach, a redaktor i tak nie
// przechodzi z „Grup wydarzenia" do „Kategorii bloga" w jednym ruchu.
//
// WYSZUKIWARKA JEST WEWNATRZ WYDARZENIA. Pietnascie sekcji to za duzo, zeby
// szukac wzrokiem, a nazwy sekcji nie sa oczywiste („bilety" mieszkaja
// w „Zapisach", „QR" w „Odprawie") - dlatego pozycje niosa slowa kluczowe,
// a nie tylko etykiete.
//
// GRUPA Z AKTYWNA SEKCJA JEST ZAWSZE ROZWINIETA. Zwiniecie grupy, w ktorej
// stoi otwarty ekran, znaczyloby, ze sidebar nie mowi, gdzie jestem.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, ExternalLink, Search } from "@/lib/lucide-shim";
import { Input } from "@/components/ui/input";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { cn } from "@/lib/utils";
import {
  EVENT_STUDIO_NAV,
  EVENT_STUDIO_ROUTES,
  matchesStudioQuery,
  type EventStudioSection,
} from "@/lib/events/eventStudioNav";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

export function EventStudioSidebar({
  eventId,
  activeSection,
  publicHref,
}: {
  eventId: string;
  activeSection: EventStudioSection | null;
  /** Adres strony publicznej albo `null` dla szkicu - nie ma czego otwierac. */
  publicHref: string | null;
}) {
  ensureAdminEventsI18n();
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);

  const groups = useMemo(
    () =>
      EVENT_STUDIO_NAV.map((group) => ({
        ...group,
        entries: group.entries.filter((entry) =>
          matchesStudioQuery(
            query,
            t(entry.labelKey),
            (entry.keywordKeys ?? []).map((key) => t(key)),
          ),
        ),
      })).filter((group) => group.entries.length > 0),
    [query, t],
  );

  return (
    <aside
      data-sidebar="sidebar"
      aria-label={t("adminEvents.studio.nav.label")}
      className="sticky top-[3.25rem] flex h-[calc(100vh-3.25rem)] w-64 shrink-0 flex-col self-start border-r border-border bg-card"
    >
      <div className="space-y-2 border-b border-border p-3">
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

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {t("adminEvents.studio.nav.searchEmpty")}
          </p>
        ) : null}

        {groups.map((group) => {
          const hasActive = group.entries.some((entry) => entry.key === activeSection);
          // Grupa z aktywna sekcja jest zawsze otwarta, niezaleznie od klikniec.
          const isOpen = hasActive || query.trim() !== "" || !collapsed.includes(group.key);

          if (group.labelKey === null) {
            return group.entries.map((entry) => (
              <StudioLink
                key={entry.key}
                eventId={eventId}
                section={entry.key}
                icon={entry.icon}
                label={t(entry.labelKey)}
                active={activeSection === entry.key}
              />
            ));
          }

          return (
            <div key={group.key} className="pt-1">
              <button
                type="button"
                onClick={() =>
                  setCollapsed((previous) =>
                    previous.includes(group.key)
                      ? previous.filter((key) => key !== group.key)
                      : [...previous, group.key],
                  )
                }
                aria-expanded={isOpen}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-[13px] font-semibold text-foreground hover:bg-muted"
              >
                <DynamicIcon name={group.icon} size={16} />
                <span className="flex-1 text-left">{t(group.labelKey)}</span>
                {isOpen ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                )}
              </button>
              {isOpen ? (
                <div className="mt-0.5 space-y-0.5 pl-4">
                  {group.entries.map((entry) => (
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
