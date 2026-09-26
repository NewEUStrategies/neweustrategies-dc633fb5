// Hooki "moje miejsce na sali" - panel uczestnika i strona biletu.
//
// PANEL "MOJE" dzieli galaz cache `["event-me", slug, ...]` z profilem i
// agenda (`useMyEventPanel.ts`), wiec przelaczanie zakladek nie pyta sieci
// ponownie, a wylogowanie czysci jedna galaz.
//
// STRONA BILETU TRZYMA KOD POZA KLUCZEM. Kod z fragmentu adresu jest
// poswiadczeniem przy bramce: w kluczu zapytania trafilby do narzedzi
// deweloperskich i do kazdego zrzutu cache. Klucz niesie sam slug, a `gcTime: 0`
// usuwa odpowiedz z pamieci, gdy tylko karta zniknie z ekranu.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { TicketFragment } from "@/lib/events/manageToken";
import { fetchMySeats, fetchTicketSeats, type MySeatCard } from "@/lib/events/mySeatsApi";

export function mySeatsKey(slug: string): readonly unknown[] {
  return ["event-me", slug, "seats"] as const;
}

export function ticketSeatsKey(slug: string): readonly unknown[] {
  return ["event-ticket-seats", slug] as const;
}

export function useMySeats(slug: string, enabled: boolean): UseQueryResult<MySeatCard[], Error> {
  return useQuery({
    queryKey: mySeatsKey(slug),
    queryFn: () => fetchMySeats(slug),
    enabled: enabled && slug.length > 0,
    staleTime: 30_000,
  });
}

export function useTicketSeats(
  slug: string,
  fragment: TicketFragment | null,
): UseQueryResult<MySeatCard[], Error> {
  return useQuery({
    queryKey: ticketSeatsKey(slug),
    queryFn: () => fetchTicketSeats(slug, fragment as TicketFragment),
    enabled: fragment !== null && slug.length > 0,
    staleTime: 60_000,
    gcTime: 0,
  });
}
