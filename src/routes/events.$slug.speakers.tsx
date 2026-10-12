// Zakładka PRELEGENCI wydarzenia: `/events/$slug/speakers`.
//
// WZORZEC: portretowy katalog prelegentów (kadr 4:5, pod nim nazwisko,
// stanowisko i instytucja). Rysuje go `EventSpeakersGrid`.
//
// KLIK W KARTĘ OTWIERA OKNO, NIE OSOBNĄ STRONĘ - decyzja właściciela. Okno nie
// powstaje tutaj: `slug` przekazany siatce włącza w niej okna katalogu
// wydarzenia (osoba -> jej instytucja -> inne osoby z tej instytucji), te same,
// co na zakładkach Uczestnicy, Partnerzy, Agenda i Dyskusje. Trasa trzymała
// wcześniej własny stan dialogu - drugi rysunek profilu, który nie znał sesji
// osoby z programu ani okna instytucji.
//
// SIATKA CHCE `eventId`, A TRASA MA `slug`. Identyfikator bierzemy z tej samej
// migawki wydarzenia, co powłoka (`publicEventBySlugQueryOptions`), więc to nie
// jest drugie zapytanie - react-query oddaje wynik z cache, rozgrzany przez
// loader powłoki jeszcze przed renderem SSR.
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { publicEventBySlugQueryOptions } from "@/lib/community/publicQueries";
import { EVENT_PORTAL_CONTENT_WIDE_CLASS } from "@/components/events/public/atoms/EventPortalContent";
import { EventModulePage } from "@/components/events/public/molecules/EventModulePage";
import { EventSpeakersGrid } from "@/components/events/public/organisms/EventSpeakersGrid";
import { buildEventTabHead } from "@/lib/events/eventTabHead";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";

export const Route = createFileRoute("/events/$slug/speakers")({
  // Nazwa wydarzenia do nagłówka przychodzi z loadera POWŁOKI - zero
  // round-tripów. `await parentMatchPromise`, bo loadery łańcucha startują
  // równolegle i bez oczekiwania dane rodzica nie istnieją (wzorzec
  // `clubHeadLoader`). Obietnica rodzica nie odrzuca.
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    return { headEvent: parent.loaderData?.headEvent ?? null };
  },
  head: ({ params, loaderData }) => {
    const url = getRequestUrl() || `/events/${params.slug}/speakers`;
    return buildEventTabHead({
      tab: "speakers",
      url,
      lang: activeLang(url),
      event: loaderData?.headEvent ?? null,
    });
  },
  component: EventSpeakersTab,
});

function EventSpeakersTab() {
  const { slug } = useParams({ from: "/events/$slug/speakers" });
  // TA SAMA FABRYKA, CO W POWŁOCE - jedno źródło klucza. Loader powłoki grzeje
  // ten klucz, więc `eventId` jest znany już w SSR (wcześniej siatka dostawała
  // pusty string i jej własne zapytanie było na serwerze trwale wyłączone).
  const eventQ = useQuery(publicEventBySlugQueryOptions(slug));
  const eventId = eventQ.data?.id ?? "";

  return (
    <EventModulePage
      slug={slug}
      module="speakers"
      contentClassName={EVENT_PORTAL_CONTENT_WIDE_CLASS}
    >
      <EventSpeakersGrid eventId={eventId} slug={slug} />
    </EventModulePage>
  );
}
