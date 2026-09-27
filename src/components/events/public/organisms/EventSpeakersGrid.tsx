// Organizm: siatka prelegentów wydarzenia - do trzech kart w wierszu na
// szerokim ekranie, każda w układzie nagłówka profilu z nagrania właściciela
// (`TelegramHeader`): wyśrodkowane okrągłe zdjęcie, pod nim imię i nazwisko
// oraz podpis „rola • organizacja”.
//
// KARTA ROZWIJA SIĘ KLIKNIĘCIEM W ZDJĘCIE. Rysunek i ruch karty mieszkają
// w `SpeakerProfileCard`: koło rośnie do pełnego kadru na całą szerokość
// karty, podpis ląduje na gradiencie, a pod zdjęciem otwierają się ścieżki
// prelegenta. Profil (dialog) otwiera PRZYCISK karty, a nie cała karta - klik
// w zdjęcie jest zarezerwowany dla rozwinięcia.
//
// SIATKA NIE RYSUJE NAGŁÓWKA - I NIE RYSUJE GO `EventPageSections`. Ta lista
// NIE JEST jego sekcją: `OWNED` w `EventPageSections.tsx` wymienia program,
// partnerów, materiały, dojazd i kontakt, a `speakers` NIE (nagłówek na
// przeglądzie stawia `EventSpeakersSection` albo trasa przy zamku). Tutaj,
// na zakładce `/events/<slug>/speakers`, nagłówkiem jest `h1` DOKUMENTU CMS
// strony modułowej, który rysuje `EventModulePage` - drugi nagłówek z kodu
// dałby dwa jeden pod drugim i unieważnił tekst redagowany w studiu.
// Konsekwencja: pusta lista znaczy „nie ma czego rysować” i komponent zwraca
// null, zamiast zostawiać ramkę z komunikatem pod nagłówkiem, który ktoś inny
// już narysował.
//
// TO SAMO ŹRÓDŁO, CO SEKCJA PRELEGENTÓW. `speakersQueryOptions` ze źródłem
// „event” woła RPC `event_speakers_public`; klucz zapytania jest pochodną
// inputu, a nie komponentu, więc siatka i `EventSpeakersSection` współdzielą
// cache oraz prefetch SSR. Drugie zapytanie o te same wiersze podwoiłoby ruch
// i rozjechało migawkę po hydratacji.
//
// PRELEGENT BEZ KONTA JEST TU KARTĄ JAK KAŻDA INNA. Poprzednia projekcja
// (`get_public_speakers`) zlewała rejestr z `profiles` przez INNER JOIN, więc
// osoba wpisana ręcznie w studiu - bez konta, z wierszem w `event_people` -
// wypadała z listy BEZWARUNKOWO i BEZ BŁĘDU: redaktor widział pięć nazwisk
// w panelu, uczestnik pustą sekcję. Skutek dla tego pliku jest dwojaki:
// klucz karty NIE MOŻE stać na `user_id` (dla takiej osoby jest pusty -
// stąd `speakerRowKey`), a klikalność nie może być bezwarunkowa (patrz
// `speakerHasProfileToShow` w `SpeakerProfileCard`). Pilnuje tego bramka
// `src/components/events/__tests__/eventSpeakerWithoutAccount.gate.test.tsx`.
//
// LINIA PODPISU ISTNIEJE TYLKO WTEDY, GDY MA TREŚĆ. Prelegent bez roli albo bez
// firmy zostawiłby inaczej puste miejsce w karcie - w siatce czterech kolumn
// taka pusta linia czyta się jak uszkodzone dane, a nie jak brak danych.
//
// UCIĘTY NAPIS ZOSTAWIA `title`. Wzorzec ucina „Szkoła Główna Handlowa…”
// wielokropkiem i dla układu jest to właściwe, ale ucięta nazwa organizacji bez
// możliwości odczytu to strata informacji - dlatego pełna wartość zostaje
// w atrybucie tytułu.
//
// GOŚĆ WIDZI TO SAMO, CO ZALOGOWANY. Siatka nie pyta o sesję ani o uprawnienia;
// o tym, czy sekcja jest w ogóle otwarta, decyduje `enabled` przekazany z zamka
// sekcji - a nie stan zalogowania sprawdzany tutaj.
//
// TEN SAM ZESTAW FAKTÓW, CO ZAPOWIEDŹ NA PRZEGLĄDZIE. Układ wolno różnić
// (`EventSpeakersSection` to poziome chipy i to decyzja właściciela), FAKTÓW nie:
// plakietka eksperta stała przez chwilę tylko tam, a organizacja tylko tutaj,
// więc ta sama osoba była na jednej powierzchni ekspertem bez afiliacji, a na
// drugiej odwrotnie. `is_expert` rysuje teraz wspólny `SpeakerExpertBadge`
// (jeden rysunek faktu, nie dwie kopie), a parytetu pilnuje bramka
// `src/components/events/__tests__/eventSpeakerFactParity.gate.test.tsx`.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/ui/skeleton";
import { uiLang } from "@/lib/i18n/format";
import { speakersQueryOptions, type PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import { speakerRowKey } from "@/lib/builder/speakerRow";
import { publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import { SpeakerProfileCard } from "@/components/events/public/molecules/SpeakerProfileCard";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

// Cztery kolumny to docelowy układ wzorca, ale karta ma pod zdjęciem trzy linie
// tekstu - przy dwóch kolumnach na telefonie każda z nich ma jeszcze szerokość
// na cokolwiek poza wielokropkiem.
const GRID_CLASS = "grid grid-cols-1 border-l border-t border-border sm:grid-cols-2 lg:grid-cols-3";
// Karta zastepcza ma TEN SAM obrys, co ZWINIETA karta prelegenta
// (`SpeakerProfileCard`: wysrodkowane kolo 80 px, imie i nazwisko, podpis),
// wiec wysokosc sekcji nie skacze w chwili, gdy przyjda dane.
const CARD_CLASS =
  "flex h-full w-full flex-col items-center border-b border-r border-border bg-background px-5 pb-5 pt-8 text-center";

// Osiem kart zastępczych: tyle, ile wchodzi w dwa wiersze docelowego układu,
// więc wysokość sekcji nie skacze w chwili, gdy przyjdą dane.
const SKELETON_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7];

export function EventSpeakersGrid({
  eventId,
  limit = 100,
  enabled = true,
  onSelect,
}: {
  eventId: string;
  /** Górny limit wierszy z RPC (zaciskany po stronie zapytania do 1..200). */
  limit?: number;
  /** `false` = sekcja zamknięta albo nieaktywna zakładka: nie pytamy bazy. */
  enabled?: boolean;
  /** Podana funkcja zamienia kartę w przycisk (np. otwarcie profilu). */
  onSelect?: (speaker: PublicSpeakerRow) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const speakersQuery = useQuery({
    ...speakersQueryOptions({ source: "event", eventId, limit }, lang),
    enabled: enabled && eventId !== "",
  });

  if (speakersQuery.isPending) {
    return (
      <div className={GRID_CLASS} aria-busy="true" aria-label={t("eventFront.speakers.loading")}>
        {SKELETON_SLOTS.map((slot) => (
          <div key={slot} className={CARD_CLASS}>
            <Skeleton className="h-20 w-20 rounded-full" />
            {/* Paski maja TE SAME pudelka linii, co napisy karty (ten sam
                krój i interlinia, twarda spacja w srodku), wiec wysokosc
                szkieletu zgadza sie z karta z definicji, a nie z rachunku. */}
            <Skeleton aria-hidden="true" className="mt-3 w-32 text-xl leading-tight">
              {"\u00a0"}
            </Skeleton>
            <Skeleton aria-hidden="true" className="mt-1 w-24 text-xs leading-snug">
              {"\u00a0"}
            </Skeleton>
          </div>
        ))}
      </div>
    );
  }

  if (speakersQuery.isError) {
    return (
      <p className="rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {publicEventErrorMessage(speakersQuery.error)}
      </p>
    );
  }

  const speakers = speakersQuery.data ?? [];
  if (speakers.length === 0) return null;

  return <EventSpeakersGridView speakers={speakers} lang={lang} onSelect={onSelect} />;
}

/**
 * SAM RYSUNEK siatki - bez zapytania.
 *
 * PO CO OSOBNO: podglad studia ma wiersze prelegentow z RPC panelu (publiczna
 * projekcja odmawia szkicowi), a mimo to musi rysowac TE SAME karty, co strona.
 * Bez tego eksportu w repozytorium stanelaby druga siatka prelegentow.
 */
export function EventSpeakersGridView({
  speakers,
  lang,
  onSelect,
}: {
  speakers: readonly PublicSpeakerRow[];
  lang: "pl" | "en";
  onSelect?: (speaker: PublicSpeakerRow) => void;
}) {
  return (
    <ul className={GRID_CLASS}>
      {speakers.map((speaker) => (
        <li key={speakerRowKey(speaker)} className="flex">
          <SpeakerProfileCard speaker={speaker} lang={lang} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}
