// Katalog osób i instytucji dla zakładki PUBLICZNEJ - źródła własne zakładki
// plus publiczne listy wzbogacające (prelegenci, program, partnerzy).
//
// WZBOGACENIE DOPIERO NA SYGNAŁ. Lista uczestników nie potrzebuje programu do
// narysowania kart, ale okno profilu prelegenta-uczestnika chce pokazać jego
// sesje, a okno firmy - jej prelegentów. Zapytania wzbogacające śpią do
// pierwszego sygnału zamiaru (najechanie albo fokus na wyzwalaczu, otwarcie
// okna - `onActivate` dostawcy), więc wejście na zakładkę nie płaci ani jednym
// dodatkowym wywołaniem RPC. Każde z trzech to ten sam klucz cache, którego
// używa zakładka-właściciel danych: na zakładce „Prelegenci" lista prelegentów
// już jest w pamięci i nic nie leci drugi raz.
//
// WŁASNE ŹRÓDŁA WYGRYWAJĄ. Zakładka podaje to, co już narysowała (np. program
// na zakładce „Agenda" - z zapisami wołającego), a hook nie nadpisuje tego
// odpowiedzią publiczną.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { publicEventBySlugQueryOptions } from "@/lib/community/publicQueries";
import { speakersQueryOptions } from "@/lib/builder/speakersQuery";
import {
  buildEventDirectory,
  type DirectoryLang,
  type EventDirectory,
  type EventDirectorySources,
} from "@/lib/events/eventDirectory";
import { useEventAgenda, usePublicEventSponsors } from "@/lib/events/usePublicEvent";

/** Limit wierszy prelegentów - TEN SAM, co siatka zakładki (wspólny klucz cache). */
export const DIRECTORY_SPEAKERS_LIMIT = 100;

export function usePublicEventDirectory({
  slug,
  lang,
  enrich,
  own,
}: {
  slug: string;
  lang: DirectoryLang;
  /** Sygnał zamiaru - patrz nagłówek pliku. */
  enrich: boolean;
  /** Źródła, które zakładka już ma; podane pole wyłącza odpowiadające zapytanie. */
  own: EventDirectorySources;
}): { directory: EventDirectory; eventId: string | null } {
  const eventQuery = useQuery({ ...publicEventBySlugQueryOptions(slug), retry: false });
  const eventId = eventQuery.data?.id ?? "";

  const speakersQuery = useQuery({
    ...speakersQueryOptions({ source: "event", eventId, limit: DIRECTORY_SPEAKERS_LIMIT }, lang),
    enabled: enrich && own.speakers === undefined && eventId !== "",
  });
  const agendaQuery = useEventAgenda(slug, enrich && own.sessions === undefined);
  const sponsorsQuery = usePublicEventSponsors(slug, enrich && own.sponsorTiers === undefined);

  const speakers = own.speakers ?? speakersQuery.data;
  const sessions = own.sessions ?? agendaQuery.data;
  const sponsorTiers = own.sponsorTiers ?? sponsorsQuery.data;
  const { attendees, attendeeSessions, extraPeople, noTierLabel } = own;

  const directory = useMemo(
    () =>
      buildEventDirectory(
        { speakers, sessions, sponsorTiers, attendees, attendeeSessions, extraPeople, noTierLabel },
        lang,
      ),
    [speakers, sessions, sponsorTiers, attendees, attendeeSessions, extraPeople, noTierLabel, lang],
  );

  return { directory, eventId: eventId === "" ? null : eventId };
}
