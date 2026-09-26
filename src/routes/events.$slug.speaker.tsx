// Zakładka PANEL PRELEGENTA wydarzenia: `/events/$slug/speaker`.
//
// W POWŁOCE, JAK „Moje". To prywatna płaszczyzna wołającego (zgłoszenia,
// profil sceniczny, wystąpienia, materiały), więc nie ma jej w `event_menu`
// i nie ma bramki na trasie: gość dostaje zaproszenie do logowania bez utraty
// kontekstu wydarzenia (wzorzec `events.$slug.me.tsx`).
//
// `noindex, nofollow` - adres prywatny, bez kanonika i podglądu linku.
import { createFileRoute, useParams } from "@tanstack/react-router";

import { SpeakerPanelPage } from "@/components/events/cfp/organisms/SpeakerPanelPage";
import { buildEventPrivateHead } from "@/lib/events/eventTabHead";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";

export const Route = createFileRoute("/events/$slug/speaker")({
  head: ({ params }) => {
    const url = getRequestUrl() || `/events/${params.slug}/speaker`;
    return buildEventPrivateHead({ page: "speakerPanel", lang: activeLang(url) });
  },
  component: EventSpeakerPanelTab,
});

function EventSpeakerPanelTab() {
  const { slug } = useParams({ from: "/events/$slug/speaker" });
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <SpeakerPanelPage slug={slug} />
    </div>
  );
}
