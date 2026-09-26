// Publiczna strona raportu dla sponsora: `/events/<slug>/sponsor-report#t=<token>`.
//
// Link wydaje organizator w studiu („Udostępnij raport sponsorowi") i przekazuje
// sponsorowi - sponsor NIE MA konta. Poświadczenie stoi we FRAGMENCIE adresu,
// więc nie dociera do serwera, do logów ani do nagłówka `Referer`; stąd
// `ssr: false` (render serwera i tak nie widziałby tokenu, a strona z danymi
// sponsora nie powinna istnieć w żadnej kopii poza przeglądarką odbiorcy).
//
// `$slug_` (podkreślnik) wypina trasę z powłoki wydarzenia: raport nie jest
// zakładką wydarzenia, nie ma paska zakładek i - co ważne - NIE DOSTAJE
// dostawcy pomiaru ekspozycji (sponsor oglądający swój raport nie nabija sobie
// wyświetleń).
//
// `noindex, nofollow` i `no-referrer`: strona niesie poświadczenie. Nagłówek
// dokumentu tłumaczy `i18n.getFixedT(lang)` z maleńkiej nakładki nagłówka -
// `head()` jedzie w chunku startowym.
import { createFileRoute } from "@tanstack/react-router";

import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { SponsorReportPublicPanel } from "@/components/events/sponsor-report/SponsorReportPublicPanel";
import i18n from "@/lib/i18n";
import "@/lib/i18n-event-sponsor-report-head";
import { activeLang } from "@/lib/seo/head";
import { SITE_NAME } from "@/lib/seo/meta";

export const Route = createFileRoute("/events/$slug_/sponsor-report")({
  ssr: false,
  head: () => {
    const t = i18n.getFixedT(activeLang());
    return {
      meta: [
        { title: `${t("eventSponsorReportHead.title")} - ${SITE_NAME}` },
        { name: "description", content: t("eventSponsorReportHead.description") },
        { name: "robots", content: "noindex, nofollow" },
        { name: "referrer", content: "no-referrer" },
      ],
    };
  },
  errorComponent: SponsorReportRouteError,
  notFoundComponent: SponsorReportRouteError,
  component: SponsorReportRoute,
});

function SponsorReportRoute() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <SponsorReportPublicPanel />
    </main>
  );
}

function SponsorReportRouteError() {
  return <FriendlyErrorPage variant="compact" />;
}
