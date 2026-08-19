// Kluby - CO uniewaznia KTORA mutacja. Czysty modul, zero React.
//
// DLACZEGO TO ISTNIEJE JAKO OSOBNY PLIK. Do tej pory kazdy z ~40 hookow
// mutujacych w `useClubs.ts` wypisywal swoja liste kluczy inline, w ciele
// `onSuccess`. Wygladalo to na szczegol implementacyjny, a jest REGULA
// PRODUKTOWA: decyduje o tym, czy po dolaczeniu do klubu naglowek pokaze nowy
// licznik, czy stary. Regula rozsypana po czterdziestu domknieciach ma dwie
// wady i obie juz sie zmaterializowaly w tym module:
//
//   1. NIE DA SIE JEJ SPRAWDZIC bez wyrenderowania hooka razem z klientem
//      zapytan - wiec nikt jej nie sprawdzal (0/155 funkcji pokrycia);
//   2. ROZJEZDZA SIE. Komentarz przy `invalidateClubCard` opisuje dokladnie
//      taki defekt: karta klubu (`bySlug`) wisi POZA poddrzewem
//      `club(clubId)`, bo mutacja pracuje na id, a widok czyta po slugu. Bez
//      trzeciego klucza dolaczenie do klubu zapisywalo sie w bazie, odswiezalo
//      liste i czlonkostwa, a naglowek otwartego klubu dalej pokazywal stary
//      licznik i przycisk „Dolacz" - az do wygasniecia staleTime.
//
// Tutaj kazdy skutek ma NAZWE i zwraca DANE (liste kluczy), wiec test pyta
// „co uniewaznia dolaczenie do klubu" bez renderu, a hook zostaje cienki.
//
// ZASADA DOBORU ZAKRESU. Liczniki modulu (`member_count`, `group_count`,
// `thread_count`) sa denormalizowane triggerem, wiec po KAZDEJ mutacji zmienia
// sie takze wiersz na liscie. Dlatego wiekszosc skutkow uniewaznia KORZEN
// klubu zamiast wyliczac liste dotknietych kluczy - punktowa inwalidacja
// pokazywalaby stary licznik obok nowego stanu.
import type { QueryKey } from "@tanstack/react-query";
import { pendingCounterKeys } from "@/lib/counters/keys";
import { adminClubKeys, clubKeys } from "./queryKeys";

/** Dane klubowe zmieniaja sie w rytmie dyskusji, nie sekund - 30 s wystarcza. */
export const CLUB_STALE_MS = 30_000;

/**
 * Karta klubu widziana z TRZECH stron. To jest ten zestaw, ktorego brak
 * zostawial stary licznik w naglowku: `bySlugAll()` nie jest podzbiorem
 * `club(clubId)`, bo jeden klucz niesie id, a drugi slug.
 */
export function clubCardKeys(clubId: string): readonly QueryKey[] {
  return [clubKeys.club(clubId), clubKeys.list(), clubKeys.bySlugAll()];
}

/** Zapis klubu z panelu: karta produktowa + cala lista panelu. */
export function clubUpsertedKeys(clubId: string): readonly QueryKey[] {
  return [adminClubKeys.all, clubKeys.club(clubId), clubKeys.list()];
}

/**
 * Zmiana USTAWIEN klubu albo jego dzialow z panelu. Poddrzewo klubu plus cala
 * lista panelu - kasowanie dzialu przenosi watki, wiec punktowa inwalidacja
 * samych grup zostawilaby liste tematow z martwym filtrem grupy.
 */
export function clubSettingsKeys(clubId: string): readonly QueryKey[] {
  return [clubKeys.club(clubId), adminClubKeys.all];
}

/** Sama kolejnosc dzialow - nie rusza licznikow, wiec nie rusza listy. */
export function clubGroupsKeys(clubId: string): readonly QueryKey[] {
  return [clubKeys.groups(clubId)];
}

/**
 * Ingerencja MODERATORSKA w tresc. Uniewaznia KORZEN calego modulu: redakcja
 * cudzego wpisu zmienia jednoczesnie liste tematow, dziennik moderacji i widok
 * watku, a te wisza w roznych poddrzewach klucza.
 *
 * Piec wolajacych wypisywalo tu wczesniej DWA klucze - `club(clubId)`, a po
 * nim `all`. Drugi jest PREFIKSEM pierwszego, wiec `invalidateQueries` na
 * `["clubs"]` i tak obejmuje `["clubs","club",<id>]`: pierwsze wywolanie nie
 * mialo zadnego skutku poza wlasnym kosztem. Zostaje jeden klucz - zakres
 * uniewaznienia jest identyczny co do zapytania.
 *
 * Parametr zostaje w sygnaturze, bo nazywa INTENCJE wolajacego (moderujemy
 * konkretny klub) i pozwala kiedys zawezic ten skutek bez przepisywania
 * pieciu hookow.
 */
export function clubModerationKeys(_clubId: string): readonly QueryKey[] {
  return [clubKeys.all];
}

/** Skutek widoczny wylacznie wewnatrz jednego klubu (zaproszenie, blokada). */
export function clubOnlyKeys(clubId: string): readonly QueryKey[] {
  return [clubKeys.club(clubId)];
}

/** Lista zaproszen klubu. */
export function clubInvitationsKeys(clubId: string): readonly QueryKey[] {
  return [clubKeys.invitations(clubId)];
}

/** Katalog linkow zapraszajacych. */
export function clubInviteLinksKeys(clubId: string): readonly QueryKey[] {
  return [clubKeys.inviteLinks(clubId)];
}

/**
 * Zmiana WLASNEGO czlonkostwa (dolaczenie, wyjscie). Karta klubu ORAZ lista
 * czlonkostw - bez tej drugiej „Moje kluby" zostawaly bez nowego wpisu.
 */
export function clubMembershipKeys(clubId: string): readonly QueryKey[] {
  return [...clubCardKeys(clubId), clubKeys.memberships()];
}

/** Sama lista czlonkostw (poziom powiadomien). */
export function clubMembershipsOnlyKeys(): readonly QueryKey[] {
  return [clubKeys.memberships()];
}

/**
 * Odpowiedz na zaproszenie i realizacja linku. Inwalidacja OD KORZENIA jest
 * tu tansza niz trzy klucze: zmienia sie lista zaproszen, lista klubow
 * i czlonkostwa naraz.
 */
export function clubTreeKeys(): readonly QueryKey[] {
  return [clubKeys.all];
}

/**
 * Nowa odpowiedz w watku. Dwa klucze:
 *
 *   * prefiks odpowiedzi BEZ sortu - wariantow jest kilka, a wyliczanie ich
 *     z reki gwarantuje, ze kolejny zostanie kiedys pominiety (tak wczesniej
 *     zniknal sort 'stance');
 *   * poddrzewo klubu - odpowiedz zmienia licznik na liscie tematow, a karta
 *     watku (`thread`) wisi POD tym kluczem, wiec jest nim objeta.
 *
 * `threadSlug` zostaje w sygnaturze: nazywa intencje wolajacego i pozwala
 * kiedys zawezic ten skutek do jednego watku bez zmiany hookow.
 */
export function threadReplyKeys(
  clubId: string,
  _threadSlug: string,
  threadId: string,
): readonly QueryKey[] {
  return [clubKeys.repliesAll(threadId), clubKeys.club(clubId)];
}

/**
 * Redakcja tematu. Tytul i tresc sa PROJEKCJA listy tematow (`title` plus
 * `left(body, 280)` jako fragment) i wynikow wyszukiwania, wiec redakcja
 * zmienia trzy widoki, nie jeden - punktowa inwalidacja zostawiala w katalogu
 * stary tytul obok poprawionego watku.
 */
export function threadEditedKeys(clubId: string, _threadSlug: string): readonly QueryKey[] {
  // Karta watku wisi POD `club(clubId)`, wiec wystarczy poddrzewo klubu.
  // `searchAll()` jest osobnym poddrzewem i musi byc wymienione jawnie.
  return [clubKeys.club(clubId), clubKeys.searchAll()];
}

/** Redakcja odpowiedzi - caly prefiks odpowiedzi watku. */
export function replyEditedKeys(threadId: string): readonly QueryKey[] {
  return [clubKeys.repliesAll(threadId)];
}

/**
 * Oznaczenie rozstrzygniecia. Zmienia i znacznik przy odpowiedzi, i jej
 * POZYCJE (SQL wynosi rozstrzygajaca na gore w KAZDYM sorcie), wiec idzie caly
 * prefiks, nie sam wariant chronologiczny.
 */
export function threadResolvedKeys(
  clubId: string,
  threadSlug: string,
  threadId: string,
): readonly QueryKey[] {
  return [clubKeys.thread(clubId, threadSlug), clubKeys.repliesAll(threadId)];
}

/** Stanowiska w watku. */
export function threadStanceKeys(threadId: string): readonly QueryKey[] {
  return [clubKeys.stances(threadId)];
}

/**
 * Reakcja. Twarze MUSZA pojsc za licznikiem - inaczej po wlasnej reakcji widac
 * „+1" bez wlasnego awatara.
 */
export function reactionKeys(
  targetType: string,
  targetIds: readonly string[],
): readonly QueryKey[] {
  return [
    clubKeys.reactions(targetType, targetIds),
    clubKeys.reactionActors(targetType, targetIds),
  ];
}

/**
 * Oznaczenie klubu jako przeczytanego. Plakietka licznika zyje POZA drzewem
 * klubow (`pendingCounterKeys`), wiec bez niej kropka przy zakladce zostawala
 * po wyczyszczeniu nieprzeczytanych.
 */
export function clubReadKeys(): readonly QueryKey[] {
  return [pendingCounterKeys.all, clubKeys.memberships()];
}

/**
 * Skrót wywołania: uniewaznia po kolei wszystkie klucze skutku.
 *
 * Parametr jest zawezony do JEDNEJ metody, ktorej ten modul uzywa - dzieki
 * temu test podaje trywialna atrape zamiast budowac prawdziwego
 * `QueryClient`, a modul nie zaczyna zalezec od calego kontraktu biblioteki.
 */
export function invalidateKeys(
  qc: { invalidateQueries: (filters: { queryKey: QueryKey }) => unknown },
  keys: readonly QueryKey[],
): void {
  for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
}

/**
 * Katalog WSZYSTKICH skutkow tego modulu - jedno miejsce, przez ktore
 * przechodza inwarianty (kazdy skutek cos uniewaznia, zaden nie duplikuje
 * klucza, zaden nie miesza prefiksu z jego potomkiem w tym samym zestawie).
 *
 * Rejestr jest JAWNY, a nie zbierany refleksją po eksportach, bo funkcje maja
 * rozne sygnatury - a przede wszystkim dlatego, ze dopisanie skutku ma
 * wymagac swiadomego dopisania go tutaj. Skutek pominiety w rejestrze omija
 * wszystkie trzy inwarianty naraz.
 */
export function clubInvalidationsForTest(
  clubId: string,
  threadSlug: string,
  threadId: string,
): Record<string, readonly QueryKey[]> {
  return {
    clubCardKeys: clubCardKeys(clubId),
    clubUpsertedKeys: clubUpsertedKeys(clubId),
    clubSettingsKeys: clubSettingsKeys(clubId),
    clubGroupsKeys: clubGroupsKeys(clubId),
    clubModerationKeys: clubModerationKeys(clubId),
    clubOnlyKeys: clubOnlyKeys(clubId),
    clubInvitationsKeys: clubInvitationsKeys(clubId),
    clubInviteLinksKeys: clubInviteLinksKeys(clubId),
    clubMembershipKeys: clubMembershipKeys(clubId),
    clubMembershipsOnlyKeys: clubMembershipsOnlyKeys(),
    clubTreeKeys: clubTreeKeys(),
    threadReplyKeys: threadReplyKeys(clubId, threadSlug, threadId),
    threadEditedKeys: threadEditedKeys(clubId, threadSlug),
    replyEditedKeys: replyEditedKeys(threadId),
    threadResolvedKeys: threadResolvedKeys(clubId, threadSlug, threadId),
    threadStanceKeys: threadStanceKeys(threadId),
    reactionKeys: reactionKeys("thread", [threadId]),
    clubReadKeys: clubReadKeys(),
  };
}
