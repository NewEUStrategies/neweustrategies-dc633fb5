// Odnośnik z wpisu osi czasu CRM (typ „journey") do EDYTORA ścieżki komunikacji.
//
// PO CO. Wpis „Ścieżka „Porzucona kasa”: wejście” bez drogi do tej ścieżki
// każe szukać jej na liście w hubie. Metadane wpisu (kontrakt w
// `src/lib/crm/leadTimeline.ts`) niosą `journey_id` i - dla zapisu w toku -
// bieżący krok, więc odnośnik otwiera edytor DOKŁADNIE na kroku kontaktu,
// w zakładce „Kontakty” panelu (ten sam adres co karta „Ścieżki” leada).
//
// BRAK IDENTYFIKATORA = BRAK ODNOŚNIKA (jak `CrmEventActivityLink`): wpis
// spoza kontraktu nie rysuje niczego zamiast adresu „w ciemno”.
//
// NAPIS PRZYCHODZI OD EKRANU - lista i karta CRM mają własne słowniki PL/EN.
// Edytor sam pilnuje roli (admin i redaktor), więc odnośnik nie dubluje bramki.
import { Link } from "@tanstack/react-router";

import { leadJourneyTimelineTarget } from "@/lib/crm/leadTimeline";

export function CrmJourneyActivityLink({ meta, label }: { meta: unknown; label: string }) {
  const target = leadJourneyTimelineTarget(meta);
  if (target === null) return null;
  return (
    <Link
      to="/admin/revenue/journeys/$journeyId"
      params={{ journeyId: target.journeyId }}
      search={target.nodeId ? { node: target.nodeId, tab: "contacts" } : {}}
      className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
    >
      {label}
    </Link>
  );
}
