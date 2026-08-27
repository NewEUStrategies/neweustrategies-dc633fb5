// Reguly WIERSZA prelegenta wspolne dla obu publicznych powierzchni listy:
// siatki na zakladce `/events/<slug>/speakers` (`EventSpeakersGrid`) i zapowiedzi
// na przegladzie (`EventSpeakersSection`).
//
// DLACZEGO OSOBNY PLIK, A NIE `speakersQuery.ts`. Tam mieszka WARSTWA DANYCH:
// klient Supabase, react-query i cache SSR. Te dwie funkcje nie potrzebuja
// niczego z tego grafu - odpowiadaja na pytania o JUZ POBRANY wiersz, wiec
// warstwa jest czysta: zero importow runtime, zero Reacta, zero Supabase
// (ten sam wzorzec, co `lib/content-model/json.ts`). Skutek praktyczny jest
// dwojaki: komponent, ktory pyta tylko „jaki klucz" i „czy klikalna", nie
// wciaga po to warstwy sieciowej, a same reguly da sie sprawdzic testem
// jednostkowym bez montowania czegokolwiek.
//
// OBIE FUNKCJE ISTNIEJA Z JEDNEGO POWODU: publiczna lista wydarzenia
// (`event_speakers_public`) niesie od teraz PRELEGENTOW BEZ KONTA - osoby
// wpisane recznie w studiu, z wierszem w kartotece `event_people`. Dla nich
// `user_id` jest PUSTY, a to lamie dwa zalozenia, ktore poprzednia projekcja
// (INNER JOIN na `profiles`) czynila milczaco prawdziwymi.
import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";

/**
 * Klucz karty prelegenta - JEDEN dla obu rodzajow wiersza.
 *
 * `user_id` byl kluczem list publicznych do chwili, w ktorej weszli prelegenci
 * bez konta: dla nich jest pusty, wiec pieciu takich prelegentow dostaloby PIEC
 * IDENTYCZNYCH kluczy - React sklejalby ich w jeden wpis i przestawial zdjecia
 * przy kazdym refetchu. Kolejnosc prob idzie od tego, co istnieje najstabilniej:
 * wpis rejestru (`event_speaker_entries` -> `speaker_profiles.id`), potem konto
 * (wiersz legacy `event_speakers` bez profilu scenicznego wpisu rejestru nie ma),
 * na koncu kartoteka osoby.
 *
 * Pusty napis nie wyjdzie: warstwa danych odsiewa wiersze bez ZADNEJ tozsamosci,
 * dokladnie tak jak baza (`WHERE p.id IS NOT NULL OR pe.id IS NOT NULL`).
 */
export function speakerRowKey(row: PublicSpeakerRow): string {
  return row.speaker_profile_id || row.user_id || row.person_id || "";
}

/**
 * Czy klik w prelegenta ma co pokazac w dialogu profilu.
 *
 * KARTA, KTORA WYGLADA NA KLIKALNA I NIC NIE ROBI, JEST GORSZA NIZ MARTWA -
 * obiecuje wiecej, niz dowozi. Odpowiedz zalezy od tego, czy osoba ma KONTO,
 * i to nie jest niekonsekwencja, tylko roznica w tym, co da sie wiedziec:
 *
 *   * osoba Z KONTEM - zawsze `true`. Dialog dociaga profil sceniczny i liste
 *     wystapien PO `user_id`; z samego wiersza listy nie da sie przewidziec,
 *     co przyjdzie, a okno bez tresci jest tu wykluczone z innego powodu
 *     (dane awaryjne + wiersz listy zawsze cos niosa).
 *   * osoba BEZ KONTA - `true` tylko wtedy, gdy wiersz niesie cos PONAD to,
 *     co juz stoi na karcie (nazwisko, rola, firma, plakietka eksperta). Nie ma
 *     czego dociagac: `speakerProfileQueryOptions` pyta po `user_id`, ktorego
 *     ta osoba nie ma. Wiec jesli nie ma biogramu, tematow, jezykow ani
 *     statystyk, dialog byl by doslownym powtorzeniem karty.
 */
export function speakerHasProfileToShow(row: PublicSpeakerRow): boolean {
  if (row.user_id !== "") return true;
  const hasText = (value: string | null): boolean => (value ?? "").trim() !== "";
  // `Array.isArray`, a nie samo `.length`: wiersz przychodzi z `jsonb`, wiec
  // tablica moze przyjsc nullem. Mapper (`mapSpeakerRow`) to normalizuje, ale
  // predykat nie zaklada, ze kazdy wolajacy przez niego przeszedl.
  const hasItems = (value: readonly string[] | null | undefined): boolean =>
    Array.isArray(value) && value.length > 0;
  return (
    hasText(row.bio_pl) ||
    hasText(row.bio_en) ||
    hasItems(row.topics_pl) ||
    hasItems(row.topics_en) ||
    hasItems(row.languages) ||
    row.talks_count > 0 ||
    row.rating > 0 ||
    row.reviews_count > 0
  );
}
