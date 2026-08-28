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
import { createFileRoute, useParams } from "@tanstack/react-router";

import { EventMePanel } from "@/components/events/participant/organisms/EventMePanel";

export const Route = createFileRoute("/events/$slug/me")({
  component: EventMeTab,
  head: () => ({
    meta: [
      { title: "Mój panel wydarzenia" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function EventMeTab() {
  const { slug } = useParams({ from: "/events/$slug/me" });
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <EventMePanel slug={slug} />
    </div>
  );
}
