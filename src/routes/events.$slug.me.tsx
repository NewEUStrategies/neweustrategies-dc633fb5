// Zakładka „Moje" wydarzenia: `/events/$slug/me`.
//
// TO NIE JEST MODUŁ Z `event_pages`. Pozostałe zakładki powłoki są stronami
// CMS organizatora (agenda, prelegenci, partnerzy); ta jest prywatną
// płaszczyzną WOŁAJĄCEGO i nie ma dokumentu do wyrenderowania - organizator nie
// może jej ani ukryć, ani przemianować, bo nie jest jego treścią.
//
// BRAMKI NA TRASIE NIE MA CELOWO: każdy element panelu pyta bazę o dane
// `auth.uid()` (RPC bez identyfikatora wołającego), a gość dostaje wprost
// zaproszenie do logowania zamiast przekierowania, które gubi kontekst
// wydarzenia.
//
// ZAKŁADKA W ADRESIE (`?tab=`, spec B.13). `validateSearch` zna wyłącznie
// zakładki z `EVENT_ME_TABS`; nieznana wartość znika z adresu (panel otwiera
// „Profil"), a obce parametry nie przeciekają dalej. Typ zwrotu ma klucz
// OPCJONALNY - bez tego każdy `<Link to="/events/$slug/me">` w serwisie musiałby
// podawać `search`.
//
// CHUNK STARTOWY. `validateSearch` i `head()` jadą w drzewie tras, czyli
// w paczce startowej każdej strony (R-ROUTE): importują WYŁĄCZNIE moduły, które
// już tam są (`@/lib/i18n`, `@/lib/i18n-event-head`, `@/lib/seo/head`) albo
// moduł bez importów (`eventMeTabs.ts`). Tytuł jest krótki i bez nazwy
// wydarzenia - trasa nie dostaje loadera (S38).
import { createFileRoute } from "@tanstack/react-router";

import i18n from "@/lib/i18n";
import "@/lib/i18n-event-head";
import { activeLang } from "@/lib/seo/head";
import { parseEventMeTab, type EventMeTab } from "@/lib/events/eventMeTabs";
import { EventMePanel } from "@/components/events/participant/organisms/EventMePanel";

export const Route = createFileRoute("/events/$slug/me")({
  validateSearch: (search: Record<string, unknown>): { tab?: EventMeTab } => ({
    tab: parseEventMeTab(search.tab),
  }),
  head: () => ({
    meta: [
      { title: i18n.getFixedT(activeLang())("eventHead.meTitle") },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: EventMeRoute,
});

function EventMeRoute() {
  const { slug } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <EventMePanel
        slug={slug}
        tab={tab}
        onTabChange={(next) => {
          void navigate({ search: { tab: next }, replace: true, resetScroll: false });
        }}
      />
    </div>
  );
}
