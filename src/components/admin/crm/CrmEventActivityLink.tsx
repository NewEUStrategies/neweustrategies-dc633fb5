// Odnośnik z wpisu osi czasu CRM do STUDIA wydarzenia, z którego wpis pochodzi.
//
// PO CO. Wpis „zgłosił wystąpienie na Kongres CEE" bez drogi do tego kongresu
// każe redaktorowi szukać wydarzenia na liście. Metadane wpisu (kontrakt
// w `src/lib/crm/eventActivity.ts`) niosą `event_id`, więc odnośnik powstaje
// z danych, a nie z tytułu.
//
// BRAK IDENTYFIKATORA = BRAK ODNOŚNIKA, a nie odnośnik „w ciemno": wpis
// zapisany przez starszy kod albo ręcznie nie ma `event_id` o kształcie uuid
// i wtedy komponent nie rysuje niczego.
//
// NAPIS PRZYCHODZI OD EKRANU. Trzy powierzchnie CRM (lista, karta osoby, karta
// firmy) mają własne, lokalne słowniki PL/EN; komponent nie ciągnie do nich
// osobnej nakładki i18n dla jednego napisu.
//
// STUDIO JEST TYLKO DLA ADMINA. Redaktor CRM widzi odnośnik, a po kliknięciu -
// zdanie ramy studia „tylko dla administratora"; ukrywanie odnośnika po roli
// dublowałoby bramkę, której źródłem prawdy jest baza.
import { Link } from "@tanstack/react-router";

import { eventActivityEventId } from "@/lib/crm/eventActivity";

export function CrmEventActivityLink({ meta, label }: { meta: unknown; label: string }) {
  const eventId = eventActivityEventId(meta);
  if (eventId === null) return null;
  return (
    <Link
      to="/admin/events/$eventId/overview"
      params={{ eventId }}
      className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
    >
      {label}
    </Link>
  );
}
