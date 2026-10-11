// Organizm: siatka prelegentów wydarzenia - portretowe karty
// (`SpeakerProfileCard`) po dwie w wierszu na telefonie, po cztery na szerokim
// ekranie i po pięć na bardzo szerokim, żeby portret nie urósł do plakatu.
//
// OKNA PROFILU MIESZKAJĄ W SIATCE, NIE W TRASIE. Podany `slug` owija listę
// w `EventDirectoryProvider`: klik w kartę otwiera okno osoby, klik
// w instytucję - okno instytucji, oba z katalogu wydarzenia
// (`usePublicEventDirectory`). Trasa nie składa już dialogu sama - bramka
// parytetu podglądu (`eventPreviewPublicParity`) zabrania trasom nowych
// importów z `components/events/public`, a podgląd studia dostawia własnego
// dostawcę wokół `EventSpeakersGridView`, więc rysunek zostaje jeden.
//
// WIERSZE JUŻ SĄ - KATALOG ICH NIE POBIERA DRUGI RAZ. Siatka podaje swoje
// wiersze jako `own.speakers`, więc hook wyłącza własne zapytanie
// o prelegentów, a program i partnerzy (sesje osoby, opis instytucji) śpią do
// pierwszego sygnału zamiaru - najechania albo fokusu na karcie.
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
// PEŁNA WARTOŚĆ, BEZ WIELOKROPKA. Stanowisko i instytucja łamią się na kilka
// linii zamiast ucinać się do „Szkoła Główna Handlowa…” - ucięta nazwa
// organizacji to strata informacji, a w kolumnie portretowej karty dłuższy
// podpis nie rozbija rytmu siatki (wyznacza go kadr 4:5 nad nim).
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
import { useCallback, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/ui/skeleton";
import { uiLang } from "@/lib/i18n/format";
import { speakersQueryOptions, type PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import { speakerRowKey } from "@/lib/builder/speakerRow";
import { publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import { usePublicEventDirectory } from "@/lib/events/usePublicEventDirectory";
import { EventDirectoryProvider } from "@/components/events/public/directory/EventDirectoryContext";
import { SpeakerProfileCard } from "@/components/events/public/molecules/SpeakerProfileCard";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

// Dwie kolumny już na telefonie: portret 4:5 w połowie szerokości ekranu wciąż
// czyta się jak twarz, a jedna kolumna dawała przewijanie przez pełnoekranowe
// zdjęcia. Odstęp pionowy większy niż poziomy - podpis należy do portretu nad
// nim, nie do sąsiada obok (`gap-y-6` + `pb-4` karty: klasy, które arkusz już
// ma - budżet CSS). Cztery kolumny to sufit: przy szerszej treści portret
// rośnie, ale siatka nie zamienia się w ścianę miniatur.
const GRID_CLASS = "grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4";

/** Pierwszy wiersz najszerszego układu - portrety bez `loading="lazy"`. */
const PRIORITY_CARDS = 4;

// Osiem kart zastępczych - dwa wiersze docelowego układu. Każda ma TEN SAM
// obrys, co karta: kadr 4:5 i paski w pudełkach linii nazwiska, stanowiska
// i instytucji, więc wysokość sekcji nie skacze w chwili, gdy przyjdą dane.
const SKELETON_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7];

export function EventSpeakersGrid({
  eventId,
  slug,
  limit = 100,
  enabled = true,
  onSelect,
}: {
  eventId: string;
  /** Slug wydarzenia - podany włącza okna profilu (osoba, instytucja). */
  slug?: string;
  /** Górny limit wierszy z RPC (zaciskany po stronie zapytania do 1..200). */
  limit?: number;
  /** `false` = sekcja zamknięta albo nieaktywna zakładka: nie pytamy bazy. */
  enabled?: boolean;
  /** Bez `slug`: podana funkcja zamienia kartę w przycisk wołającego. */
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
          <div key={slot}>
            <Skeleton className="aspect-[4/5] w-full rounded-[6px]" />
            <Skeleton aria-hidden="true" className="mt-4 h-6 w-4/5" />
            <Skeleton aria-hidden="true" className="mt-2 h-4 w-3/5" />
            <Skeleton aria-hidden="true" className="mt-3 h-6 w-1/2" />
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

  const view = <EventSpeakersGridView speakers={speakers} lang={lang} onSelect={onSelect} />;
  if (slug === undefined) return view;
  return (
    <SpeakersDirectory slug={slug} lang={lang} speakers={speakers}>
      {view}
    </SpeakersDirectory>
  );
}

/**
 * Dostawca okien profilu dla zakładki publicznej - osobny komponent, bo hook
 * katalogu pyta o migawkę wydarzenia po `slug`, a siatka bez `slug` (bramki,
 * widoki bez okien) nie może wołać go wcale.
 */
function SpeakersDirectory({
  slug,
  lang,
  speakers,
  children,
}: {
  slug: string;
  lang: "pl" | "en";
  speakers: readonly PublicSpeakerRow[];
  children: ReactNode;
}) {
  const [enrich, setEnrich] = useState(false);
  // Stała referencja: dostawca trzyma `prime` w `useCallback` po `onActivate`,
  // a nowa funkcja co render przerysowywałaby każdą kartę siatki.
  const activate = useCallback(() => setEnrich(true), []);
  const { directory, eventId } = usePublicEventDirectory({
    slug,
    lang,
    enrich,
    own: { speakers },
  });
  return (
    <EventDirectoryProvider
      directory={directory}
      slug={slug}
      eventId={eventId}
      onActivate={activate}
    >
      {children}
    </EventDirectoryProvider>
  );
}

/**
 * SAM RYSUNEK siatki - bez zapytania i bez dostawcy okien.
 *
 * PO CO OSOBNO: podglad studia ma wiersze prelegentow z RPC panelu (publiczna
 * projekcja odmawia szkicowi), a mimo to musi rysowac TE SAME karty, co strona.
 * Bez tego eksportu w repozytorium stanelaby druga siatka prelegentow. Okna
 * profilu daje dostawca z zewnatrz (`EventDirectoryProvider`) - pod nim karty
 * otwieraja katalog, a `onSelect` zostaje dla widokow bez dostawcy.
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
      {speakers.map((speaker, index) => (
        <li key={speakerRowKey(speaker)} className="min-w-0">
          <SpeakerProfileCard
            speaker={speaker}
            lang={lang}
            onSelect={onSelect}
            priority={index < PRIORITY_CARDS}
          />
        </li>
      ))}
    </ul>
  );
}
