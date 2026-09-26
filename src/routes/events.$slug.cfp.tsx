// Zakładka NABÓR PRELEGENTÓW wydarzenia: `/events/$slug/cfp`.
//
// W POWŁOCE WYDARZENIA, JAK PROGRAM I PRELEGENCI. Strona jest publiczna
// i indeksowalna (zaproszenie do zgłoszeń ma być do znalezienia), więc nagłówek
// idzie tą samą drogą, co pozostałe zakładki (`buildEventTabHead`), a nazwa
// wydarzenia przychodzi z loadera POWŁOKI - zero dodatkowych zapytań.
//
// TREŚĆ TYLKO PO STRONIE KLIENTA - faza naboru zależy od czasu, a dokument
// bywa podawany z cache krawędzi (uzasadnienie w `EventCfpPage`).
import { createFileRoute, useParams } from "@tanstack/react-router";

import { EventCfpPage } from "@/components/events/cfp/organisms/EventCfpPage";
import { buildEventTabHead } from "@/lib/events/eventTabHead";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";

export const Route = createFileRoute("/events/$slug/cfp")({
  // `await parentMatchPromise`, bo loadery łańcucha startują równolegle
  // (wzorzec `events.$slug.speakers.tsx`). Obietnica rodzica nie odrzuca.
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    return { headEvent: parent.loaderData?.headEvent ?? null };
  },
  head: ({ params, loaderData }) => {
    const url = getRequestUrl() || `/events/${params.slug}/cfp`;
    return buildEventTabHead({
      tab: "cfp",
      url,
      lang: activeLang(url),
      event: loaderData?.headEvent ?? null,
    });
  },
  component: EventCfpTab,
});

function EventCfpTab() {
  const { slug } = useParams({ from: "/events/$slug/cfp" });
  return <EventCfpPage slug={slug} />;
}
