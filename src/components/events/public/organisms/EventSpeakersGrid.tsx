// Organizm: redakcyjna siatka prelegentów wydarzenia. Duży portret zajmuje
// niemal połowę karty, a nazwisko, rola i organizacja tworzą obok wyraźną,
// magazynową hierarchię. Na telefonie fotografia wraca nad podpis.
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
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { speakersQueryOptions, type PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import { speakerHasProfileToShow, speakerRowKey } from "@/lib/builder/speakerRow";
import { publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import { SpeakerExpertBadge } from "@/components/events/SpeakerExpertBadge";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
import { ArrowRight } from "@/lib/lucide-shim";

ensureEventFrontI18n();

const GRID_CLASS = "grid grid-cols-1 gap-px bg-border md:grid-cols-2";
const CARD_CLASS =
  "group relative grid h-full min-h-[22rem] w-full grid-rows-[minmax(17rem,1.2fr)_auto] overflow-hidden bg-background text-left sm:min-h-[25rem] lg:grid-cols-[43%_57%] lg:grid-rows-1";
const CARD_INTERACTIVE_CLASS =
  " cursor-pointer focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--brand)]";

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
            <Skeleton className="h-full min-h-[17rem] w-full rounded-none" />
            <div className="flex flex-col justify-between p-7">
              <div>
                <Skeleton className="h-3 w-20 rounded-none" />
                <Skeleton className="mt-8 h-8 w-4/5 rounded-none" />
                <Skeleton className="mt-3 h-4 w-2/3 rounded-none" />
              </div>
              <Skeleton className="mt-12 h-3 w-1/2 rounded-none" />
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
  const initials = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((_, index, parts) => index === 0 || index === parts.length - 1)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();

  const body = (
    <>
      <span className="relative block min-h-[17rem] overflow-hidden bg-muted">
        {speaker.avatar_url ? (
          <OptimizedImage
            src={speaker.avatar_url}
            alt=""
            aspectRatio={3 / 4}
            responsive
            sizes="(min-width: 1024px) 22vw, (min-width: 768px) 50vw, 100vw"
            className="h-full w-full object-cover transition-transform duration-700 ease-out motion-safe:group-hover:scale-[1.035]"
          />
        ) : (
          <span
            aria-hidden
            className="flex h-full min-h-[17rem] w-full items-center justify-center bg-muted text-5xl font-light text-muted-foreground"
          >
            {initials || "?"}
          </span>
        )}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-4 border border-background/20"
        />
      </span>

      <span className="relative flex min-w-0 flex-col justify-between p-7 sm:p-8">
        <span className="block">
          <span className="flex min-h-5 items-center justify-between gap-3">
            <span
              aria-hidden
              className="h-px w-9 bg-[color:var(--speakers-accent,var(--brand))] transition-[width] duration-500 motion-safe:group-hover:w-14"
            />
            {speaker.is_expert && <SpeakerExpertBadge />}
          </span>

          {name !== "" && (
            <span
              title={name}
              className="mt-8 block text-[clamp(1.5rem,2.2vw,2.35rem)] font-black leading-[0.95] text-foreground"
            >
              {name}
            </span>
          )}
          {role !== "" && (
            <span
              title={role}
              className="mt-4 block text-base font-light leading-snug text-muted-foreground"
            >
              {role}
            </span>
          )}
        </span>

        <span className="mt-10 flex items-end justify-between gap-4 border-t border-border/70 pt-5">
          {organization !== "" ? (
            <span
              title={organization}
              className="block min-w-0 text-[11px] font-bold uppercase leading-snug text-foreground"
            >
              {organization}
            </span>
          ) : (
            <span />
          )}
          {onSelect && speakerHasProfileToShow(speaker) ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-foreground transition-colors duration-300 group-hover:border-foreground group-hover:bg-foreground group-hover:text-background">
              <ArrowRight
                aria-hidden
                className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5"
              />
            </span>
          ) : null}
        </span>
      </span>
    </>
  );

  // KLIKALNA JEST KARTA, KTÓRA MA CO OTWORZYĆ. Dla osoby z kontem odpowiedź
  // jest zawsze twierdząca (dialog dociąga profil i listę wystąpień), dla osoby
  // BEZ konta - tylko wtedy, gdy wiersz niesie coś, czego na karcie nie ma
  // (biogram, tematy, języki, statystyki). Karta wyglądająca na klikalną,
  // która po kliknięciu powtarza to samo nazwisko i tę samą firmę, jest gorsza
  // niż martwy wpis: obiecuje więcej i tego nie dowozi. Ta sama reguła stoi
  // w zapowiedzi na przeglądzie - decyduje o niej JEDEN predykat, a nie dwie
  // kopie warunku.
  if (onSelect && speakerHasProfileToShow(speaker)) {
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
