// Organizm: siatka prelegentów wydarzenia w układzie ekranu wzorcowego -
// duży portret u góry karty, pod nim imię i nazwisko, rola i organizacja,
// po trzy karty w wierszu na szerokim ekranie.
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
// `speakerHasProfileToShow` niżej). Pilnuje tego bramka
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
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { speakersQueryOptions, type PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import { speakerRowKey } from "@/lib/builder/speakerRow";
import { publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import { SpeakerAvatar } from "@/components/events/SpeakerAvatar";
import { SpeakerExpertBadge } from "@/components/events/SpeakerExpertBadge";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

// Trzy kolumny dają portretom wystarczająco dużo miejsca, a na telefonie każda
// karta zachowuje pełną szerokość bez przycinania nazwiska i afiliacji.
const GRID_CLASS = "grid grid-cols-1 border-l border-t border-border sm:grid-cols-2 lg:grid-cols-3";
const CARD_CLASS =
  "group relative flex h-full w-full flex-col items-start overflow-hidden border-b border-r border-border bg-background text-left";
const CARD_INTERACTIVE_CLASS =
  " cursor-pointer transition-[background-color,transform,box-shadow] duration-300 motion-reduce:transition-none hover:z-10 hover:-translate-y-1 hover:bg-muted/30 hover:shadow-lg motion-reduce:hover:translate-y-0 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--brand)]/50";

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
            <Skeleton className="aspect-[4/3] w-full rounded-none" />
            <div className="w-full p-5">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
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
          <SpeakerCard speaker={speaker} lang={lang} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

function SpeakerCard({
  speaker,
  lang,
  onSelect,
}: {
  speaker: PublicSpeakerRow;
  lang: "pl" | "en";
  onSelect?: (speaker: PublicSpeakerRow) => void;
}) {
  const name = speaker.display_name ?? "";
  // Rola: `headline` w języku interfejsu, a gdy prelegent go nie wypełnił -
  // stanowisko z profilu. Ta sama kolejność, co w `EventSpeakersSection`, żeby
  // ta sama osoba nie była „Prezesem” w jednym miejscu i bez roli w drugim.
  const role = pickLocalized(speaker, "headline", lang, speaker.job_title ?? "");
  const organization = speaker.company ?? "";

  // Zdjęcie idzie przez `SpeakerAvatar`, bo brak awatara ma tam już rozwiązaną
  // degradację (inicjały na tle muted), a nie ikonę zepsutego obrazka.
  const body = (
    <>
      <div className="relative w-full overflow-hidden bg-muted">
        <SpeakerAvatar
          name={name}
          photoUrl={speaker.avatar_url}
          size="card"
          className="rounded-none transition-transform duration-500 motion-reduce:transition-none group-hover:scale-[1.025] motion-reduce:group-hover:scale-100"
        />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/65 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:transition-none" />
      </div>
      <span className="flex w-full flex-1 flex-col p-5">
        {name !== "" && (
          <span
            title={name}
            className="block w-full text-xl font-semibold leading-tight text-foreground"
          >
            {name}
          </span>
        )}
        {role !== "" && (
          <span title={role} className="mt-2 block w-full text-sm leading-snug text-muted-foreground">
            {role}
          </span>
        )}
        {organization !== "" && (
          <span
            title={organization}
            className="mt-1 block w-full text-xs font-semibold uppercase leading-tight text-foreground/80"
          >
            {organization}
          </span>
        )}
        {speaker.is_expert && <SpeakerExpertBadge className="mt-2" />}
      </span>
    </>
  );

  // Gdy powierzchnia podaje `onSelect`, każdy kafelek zachowuje się jednakowo:
  // rozwija profil także dla osoby bez konta. Jej wiersz nadal zawiera zdjęcie,
  // rolę i organizację, więc powiększenie nigdy nie prowadzi do pustego widoku.
  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(speaker)}
        className={CARD_CLASS + CARD_INTERACTIVE_CLASS}
      >
        {body}
      </button>
    );
  }
  return <div className={CARD_CLASS}>{body}</div>;
}
