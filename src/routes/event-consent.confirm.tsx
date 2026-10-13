// Publiczna trasa potwierdzenia zgód linkiem z maila (double opt-in,
// REG-02 / REG-14): `/event-consent/confirm#token=<token>`.
//
// Mail wysyła ścieżka zapisu (B1b, `event_consent_confirm`), gdy zgody
// marketingu albo partnerów zaznaczył ktoś, kto nie jest zweryfikowanym
// właścicielem adresu. Token stoi we FRAGMENCIE adresu, więc nie dociera do
// serwera - stąd `ssr: false`: render serwerowy i tak nie miałby czego
// pokazać, a strona z poświadczeniem nie powinna istnieć w żadnej kopii poza
// przeglądarką właściciela skrzynki.
//
// POZA `/events`: trasa nie zależy od wydarzenia (link potwierdza zgody osoby),
// a statyczny segment pod `/events/` kolidowałby z `$slug`.
//
// GET = podgląd, przycisk = POST potwierdzenia (`EventConsentConfirmPanel`).
//
// `noindex, nofollow` i `no-referrer`: strona niesie poświadczenie. Ścieżka
// jest na liście `NOINDEX_CODE_ROUTE_PATHS` (mapa strony jej nie ogłasza).
import { createFileRoute } from "@tanstack/react-router";

import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { EventConsentConfirmPanel } from "@/components/events/registration/EventConsentConfirmPanel";

export const Route = createFileRoute("/event-consent/confirm")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Potwierdzenie zgód - New European Strategies" },
      {
        name: "description",
        content: "Potwierdzenie zgód zaznaczonych przy zapisie na wydarzenie.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  errorComponent: ConsentConfirmRouteError,
  notFoundComponent: ConsentConfirmRouteError,
  component: ConsentConfirmRoute,
});

function ConsentConfirmRoute() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <EventConsentConfirmPanel />
    </main>
  );
}

function ConsentConfirmRouteError() {
  return <FriendlyErrorPage variant="compact" />;
}
