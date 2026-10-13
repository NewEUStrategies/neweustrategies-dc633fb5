// Szkic okna reklamy strony głównej wydarzenia: wiersz bazy <-> pola <-> wejście zapisu.
//
// HARMONOGRAM EMISJI JEST ZEGAREM W STREFIE WYDARZENIA (klasa OPS-15). Okno
// czytało chwile w strefie PRZEGLĄDARKI: „emisja od 9:00" wpisana w Londynie
// dla kongresu w Warszawie startowała o 10:00 czasu kongresu, a ta sama
// reklama otwarta przez drugiego organizatora pokazywała inne godziny niż
// termin wydarzenia na „Informacjach ogólnych". Pola niosą dziś napis
// `YYYY-MM-DDTHH:mm` w strefie `timeZone`, chwile liczy wspólny
// `lib/events/eventLocalInput.ts` (reguła Postgresa dla luki i zakładki),
// a `savedTimes` oddaje nietknięte pole co do milisekundy - przełączenie
// „aktywna" albo zmiana linku nie przycina `ends_at` 23:59:59 do pełnej minuty.
//
// KONTRAKT ZAPISU SIĘ NIE ZMIENIA. `saveHomeAd` dalej przyjmuje `HomeAdInput`
// z chwilami ISO albo pustym napisem („bez ograniczenia"); szkic jest warstwą
// formularza nad nim, a `validateHomeAd` sprawdza to, co naprawdę pójdzie do bazy.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero klienta bazy.
import {
  canonicalInstant,
  eventLocalInput,
  eventLocalInputToIso,
  type SavedInstants,
} from "@/lib/events/eventLocalInput";
import type { EventHomeAdRow, HomeAdInput } from "@/lib/events/sponsorBoardApi";
import { eventTimeZone } from "@/lib/events/timezone";

export type HomeAdTimeField = "startsAt" | "endsAt";

/** `HomeAdInput`, w którym harmonogram jest zegarem strefy wydarzenia. */
export interface HomeAdDraft extends Omit<HomeAdInput, HomeAdTimeField> {
  /** `YYYY-MM-DDTHH:mm` w strefie `timeZone` albo `""` = bez ograniczenia. */
  startsAt: string;
  endsAt: string;
  /** Strefa wydarzenia (IANA, zwalidowana), w której pola harmonogramu są zegarem. */
  timeZone: string;
  /** Chwile z bazy, z których powstały pola harmonogramu (edycja); pusto dla nowej reklamy. */
  savedTimes: SavedInstants<HomeAdTimeField>;
}

/** Szkic okna: nowa reklama (`row === null`) albo edycja wiersza. */
export function homeAdDraftFromRow(
  eventId: string,
  row: EventHomeAdRow | null,
  timeZone: string | null | undefined,
): HomeAdDraft {
  const zone = eventTimeZone({ timezone: timeZone });
  const startsAt = canonicalInstant(row?.starts_at);
  const endsAt = canonicalInstant(row?.ends_at);
  return {
    id: row?.id,
    eventId,
    imageUrl: row?.image_url ?? "",
    imageMobileUrl: row?.image_mobile_url ?? "",
    linkUrl: row?.link_url ?? "",
    altText: row?.alt_text ?? "",
    groupIds: row?.group_ids ?? [],
    startsAt: eventLocalInput(startsAt, zone),
    endsAt: eventLocalInput(endsAt, zone),
    isActive: row?.is_active ?? true,
    sponsorId: row?.sponsor_id ?? "",
    timeZone: zone,
    savedTimes: { startsAt, endsAt },
  };
}

/** Pole harmonogramu -> chwila w UTC albo `""` (pole puste = bez ograniczenia). */
function instantOrEmpty(draft: HomeAdDraft, field: HomeAdTimeField): string {
  return eventLocalInputToIso(draft[field], draft.timeZone, draft.savedTimes[field] ?? null) ?? "";
}

/** Szkic -> wejście `saveHomeAd`: chwile w UTC, kontekst strefy zostaje w formularzu. */
export function homeAdInputFromDraft(draft: HomeAdDraft): HomeAdInput {
  const { timeZone: _timeZone, savedTimes: _savedTimes, ...rest } = draft;
  return {
    ...rest,
    startsAt: instantOrEmpty(draft, "startsAt"),
    endsAt: instantOrEmpty(draft, "endsAt"),
  };
}
