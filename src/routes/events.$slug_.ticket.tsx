// Publiczna trasa biletu z kodem QR: `/events/<slug>/ticket#t=<kod>`.
//
// Odnośnik przychodzi mailem `event_ticket_issued`. Kod wejścia stoi we
// FRAGMENCIE adresu, więc nie dociera do serwera - stąd `ssr: false`: render
// serwerowy i tak nie miałby czego pokazać, a strona z kodem nie powinna
// istnieć w żadnej kopii poza przeglądarką uczestnika.
//
// `$slug_` (podkreślnik) daje adres dziecka BEZ zamiany `events.$slug.tsx`
// w layout - tak samo jak strona zarządzania zgłoszeniem.
//
// `noindex, nofollow` i `no-referrer`: strona niesie poświadczenie.
import { createFileRoute } from "@tanstack/react-router";

import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { EventTicketCodePanel } from "@/components/events/registration/EventTicketCodePanel";

export const Route = createFileRoute("/events/$slug_/ticket")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Twój bilet - New European Strategies" },
      { name: "description", content: "Bilet z kodem QR do okazania przy wejściu." },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  errorComponent: TicketRouteError,
  notFoundComponent: TicketRouteError,
  component: TicketRoute,
});

function TicketRoute() {
  const { slug } = Route.useParams();
  return (
    <main className="mx-auto w-full max-w-md px-4 py-8 sm:px-6">
      <EventTicketCodePanel slug={slug} />
    </main>
  );
}

function TicketRouteError() {
  return <FriendlyErrorPage variant="compact" />;
}
