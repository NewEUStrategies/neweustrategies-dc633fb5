// Zakładka DYSKUSJE wydarzenia: `/events/$slug/discussions`.
//
// TO JEST ZAJAWKA GRUPY KLUBU, NIE DRUGI SILNIK DYSKUSJI. Odpowiadanie,
// moderacja i powiadomienia żyją w module klubów, więc każda karta jest
// odnośnikiem do wątku w klubie. Wydarzenie bez przypiętej grupy dostaje jedno
// zdanie (`state = 'not_configured'`) - strona studia do wyboru klubu jest
// ODŁOŻONA, więc ten stan jest dziś normalny, a nie awarią.
//
// DOSTĘPU NIE LICZY ANI TA TRASA, ANI ORGANIZM: `event_discussions` woła
// `club_capabilities` - jedno źródło prawdy o dostępie do grupy - i oddaje jego
// powód wprost.
import { createFileRoute, useParams } from "@tanstack/react-router";

import { EventModulePage } from "@/components/events/public/molecules/EventModulePage";
import { EventDiscussionsList } from "@/components/events/public/organisms/EventDiscussionsList";

export const Route = createFileRoute("/events/$slug/discussions")({
  component: EventDiscussionsTab,
});

function EventDiscussionsTab() {
  const { slug } = useParams({ from: "/events/$slug/discussions" });
  return (
    <EventModulePage slug={slug} module="discussions">
      {/* `heading={false}`: nagłówek `h1` i zdanie wstępu daje dokument strony
          CMS nad listą - patrz `EventModulePage`. */}
      <EventDiscussionsList slug={slug} heading={false} />
    </EventModulePage>
  );
}
