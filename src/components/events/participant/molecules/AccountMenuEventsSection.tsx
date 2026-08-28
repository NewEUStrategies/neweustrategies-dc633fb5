// Molekuła: SKRÓT DO MOICH WYDARZEŃ w menu konta.
//
// DLACZEGO W MENU KONTA. Uczestnik w dniu wydarzenia wchodzi na stronę po to,
// żeby pokazać bilet albo sprawdzić swój harmonogram - dwa kliknięcia przez
// listę wydarzeń to o dwa za dużo. Menu konta jest jedynym miejscem obecnym na
// każdej podstronie, więc skrót prowadzi wprost do `/events/<slug>/me`.
//
// ZAPYTANIE STARTUJE DOPIERO PO OTWARCIU PANELU (komponent montuje się razem
// z zawartością popovera), więc nie dokłada round-tripu do renderu nagłówka.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";

import { fetchMyRegistrations } from "@/lib/events/participantTicketsApi";
import { groupMyEvents } from "@/lib/events/myEventsGrouping";
import { uiLang } from "@/lib/i18n/format";
import { ensureI18n } from "@/lib/i18n-cart";

ensureI18n();

const MAX_ITEMS = 3;

export function AccountMenuEventsSection({ onNavigate }: { onNavigate: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { data } = useQuery({
    queryKey: ["account-menu", "my-events"],
    queryFn: fetchMyRegistrations,
    staleTime: 60_000,
  });

  const upcoming = groupMyEvents(data ?? [], new Date()).upcoming;
  // Jedno wydarzenie może mieć kilka zgłoszeń (np. bilet + warsztat) - w menu
  // pokazujemy je raz, bo skrót prowadzi do panelu wydarzenia, nie do biletu.
  const seen = new Set<string>();
  const rows = upcoming
    .filter((item) => (seen.has(item.eventSlug) ? false : (seen.add(item.eventSlug), true)))
    .slice(0, MAX_ITEMS);

  if (rows.length === 0) return null;

  return (
    <>
      <div className="my-1.5 h-px bg-border/70" />
      <div className="px-2.5 pb-1 pt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {t("myEvents.title")}
      </div>
      <div className="flex flex-col gap-0.5">
        {rows.map((item) => {
          const title = (lang === "en" ? item.eventTitleEn : item.eventTitlePl) ?? item.eventSlug;
          return (
            <Link
              key={item.eventSlug}
              to="/events/$slug/me"
              params={{ slug: item.eventSlug }}
              onClick={onNavigate}
              className="group flex w-full items-center gap-3 rounded-[6px] px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted/60"
            >
              <CalendarDays
                className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[color:var(--account-accent)]"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium leading-tight">{title}</span>
                <span className="block text-xs text-muted-foreground">{t("myEvents.myPanel")}</span>
              </span>
            </Link>
          );
        })}
        <Link
          to="/profile/events"
          onClick={onNavigate}
          className="rounded-[6px] px-2.5 py-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t("myEvents.manageTickets")}
        </Link>
      </div>
    </>
  );
}
