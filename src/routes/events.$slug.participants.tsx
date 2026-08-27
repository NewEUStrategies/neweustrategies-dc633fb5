// Zakładka UCZESTNICY wydarzenia: `/events/$slug/participants`.
//
// SEGMENT JEST WARTOŚCIĄ `event_pages.module`, nie nazwą wymyśloną w kodzie -
// uzasadnienie i słownik pięciu modułów: `src/lib/events/eventModules.ts`.
//
// TRASA NIE MA ANI JEDNEJ REGUŁY WIDOCZNOŚCI I NIE MOŻE JEJ DOSTAĆ. Kto wychodzi
// z `event_attendees`, rozstrzyga SQL (migracja 20260826182500): zgoda
// platformowa `profiles.discoverable`, decyzja osoby na tym wydarzeniu
// `event_registrations.directory_opt_out`, zapis wołającego oraz reguła Chatham
// House, która twardo wyłącza nazwiska. RPC ma REVOKE dla `anon`. Warunek
// dopisany tutaj byłby ozdobą - obchodzi się go jednym `supabase.rpc()`
// z konsoli przeglądarki. Zaproszenia do zalogowania i do zapisu rysuje sam
// organizm, bo to on zna trzy różne „nie ma listy” i trzy różne następne kroki.
import { createFileRoute, useParams } from "@tanstack/react-router";

import { EventModulePage } from "@/components/events/public/molecules/EventModulePage";
import { EventAttendeesList } from "@/components/events/public/organisms/EventAttendeesList";

export const Route = createFileRoute("/events/$slug/participants")({
  component: EventParticipantsTab,
});

function EventParticipantsTab() {
  const { slug } = useParams({ from: "/events/$slug/participants" });
  return (
    <EventModulePage slug={slug} module="participants">
      {/* `heading={false}`: nagłówek `h1` i zdanie wstępu daje dokument strony
          CMS nad listą - patrz `EventModulePage`. */}
      <EventAttendeesList slug={slug} heading={false} />
    </EventModulePage>
  );
}
