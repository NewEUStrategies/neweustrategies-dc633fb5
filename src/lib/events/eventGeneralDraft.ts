// Wersja robocza ekranu „Informacje ogolne" studia wydarzenia.
//
// DLACZEGO OSOBNY MODUL, A NIE STAN W KOMPONENCIE. Regula „naglowek wideo
// wymaga okladki" i regula „adres jest wymagany dla formatu stacjonarnego"
// stoja rowniez w bazie. Reguly, ktore stoja w dwoch miejscach, rozjezdzaja sie
// dokladnie wtedy, gdy nikt na to nie patrzy - a rozjazd tutaj znaczy, ze
// redaktor dostaje 23514 zamiast zdania po polsku. Reguly czyste daja sie
// przetestowac bez DOM-u i bez bazy, wiec test pilnuje obu stron kontraktu.
//
// PUSTY NAPIS ZNACZY „NIE PODANO". Tak samo jak w pozostalych wersjach roboczych
// panelu - `null` w polu formularza zmuszalby kazde pole do osobnego typu.
//
// HASHTAG TRZYMAMY BEZ KRZYZYKA. Znak `#` jest prezentacja: w polu widac go jako
// prefiks, w bazie go nie ma, a w stopce e-maila dokleja go szablon.
//
// TERMIN JEST ZEGAREM W STREFIE WYDARZENIA (klasa OPS-15). Kreator
// (`EventCreateForm`) zapisuje godzine wpisana w strefie z droplisty, a ten
// ekran czytal te sama chwile w strefie PRZEGLADARKI: organizator z Londynu
// widzial kongres warszawski godzine wczesniej niz w kreatorze, a kazda edycja
// godziny liczyla sie w jego strefie. Pola `startsAt`/`endsAt` niosa dzis napis
// `YYYY-MM-DDTHH:mm` w strefie `timezone`, a chwile liczy wspolny
// `lib/events/eventLocalInput.ts` (regula Postgresa dla luki i zakladki).
// `savedTimes` pamieta chwile, z ktorych powstaly pola: nietkniety termin
// wraca do bazy co do milisekundy (sekundy i pierwsze wystapienie jesiennej
// godziny nie gina przy zapisie samego tytulu).
//
// ZMIANA STREFY ZOSTAWIA CHWILE, NIE GODZINE (`eventGeneralWithTimeZone`).
// To swiadomie INNA regula niz w kreatorze i w klonie, i wynika z tego, co
// dzieje sie z reszta wydarzenia. Przy zapisie tego ekranu baza nie przesuwa
// NICZEGO poza wierszem `events` (`admin_event_general_save` zmienia kolumne
// `timezone` i tyle): sesje, okna sprzedazy biletow, kody, okno zapisow,
// nabor i reklamy zostaja w swoich chwilach. Gdyby pola zachowaly godzine
// („09:00" przeczytane na nowo w nowej strefie), sam poczatek i koniec
// wydarzenia odjechalyby od jego programu - sesja otwierajaca wypadlaby przed
// startem, sprzedaz konczylaby sie po nim, a przypomnienia i pliki kalendarza
// wyslane uczestnikom wskazywalyby inna chwile niz strona. Zmiana strefy jest
// wiec PRZEPISANIEM ETYKIETY calej osi czasu wydarzenia: chwile zostaja, pola
// pokazuja te same chwile w nowej strefie (podpowiedz pod droplista nazywa
// obie strefy), a przesuniecie terminu wymaga swiadomej zmiany godziny.
// Kreator nie ma jeszcze zaleznych terminow, a klon przesuwa je w bazie
// o roznice zegarow lokalnych (`_event_clone_shift`) - tam zachowanie
// godziny jest spojne, tu byloby rozjazdem.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero klienta bazy.
import { eventAddressLine, type EventAddressParts } from "@/lib/events/eventAddress";
import {
  canonicalInstant,
  eventLocalInput,
  eventLocalInputToIso,
  resolveEventLocalInput,
  type SavedInstants,
} from "@/lib/events/eventLocalInput";
import { normalizeEventLanguages } from "@/lib/events/eventLanguages";
import { asEventFormat, type EventFormat } from "@/lib/events/eventTypes";
import {
  asEventVideoPlatform,
  EVENT_VIDEO_PLATFORMS,
  parseVideoId,
  videoEmbedUrl,
  type EventVideoPlatform,
} from "@/lib/events/eventVideoHeader";

// TE TRZY REGULY MAJA JEDNO ZRODLO, A DWA WEJSCIA. `eventAddressLine`,
// `parseVideoId` i `videoEmbedUrl` liczy modul-lisc (`eventAddress`,
// `eventVideoHeader`), bo tej samej reguly potrzebuje panel (szkic formularza)
// i strona publiczna (wiersz z bazy). Reeksport zostaje, zeby ekran panelu i
// jego test nie musialy wiedziec, ze regula sie przeniosla - druga sciezka
// importu tej samej funkcji nie jest drugim zachowaniem.
export {
  eventAddressLine,
  EVENT_VIDEO_PLATFORMS,
  parseVideoId,
  videoEmbedUrl,
  type EventAddressParts,
  type EventVideoPlatform,
};

export const EVENT_GENERAL_MAX_TITLE = 200;
export const EVENT_GENERAL_MAX_SLUG = 120;
export const EVENT_GENERAL_MAX_DESCRIPTION = 4000;
export const EVENT_GENERAL_MAX_ADDRESS = 200;
export const EVENT_GENERAL_MAX_HASHTAG = 60;
export const EVENT_GENERAL_MAX_URL = 2048;

const VALIDATION = "adminEvents.general.errors.";

export interface EventGeneralFieldError {
  field: EventGeneralField;
  messageKey: string;
}

export const EVENT_VIDEO_PLATFORM_LABEL_KEYS: Record<EventVideoPlatform, string> = {
  youtube: "adminEvents.general.videoPlatforms.youtube",
  vimeo: "adminEvents.general.videoPlatforms.vimeo",
};

/** Uklad strony glownej wydarzenia. */
export const EVENT_HOME_DESIGNS = ["standard", "advanced"] as const;
export type EventHomeDesign = (typeof EVENT_HOME_DESIGNS)[number];

/** Prezentacja podstron wydarzenia. */
export const EVENT_PAGES_DISPLAY_MODES = ["list", "grid"] as const;
export type EventPagesDisplayMode = (typeof EVENT_PAGES_DISPLAY_MODES)[number];

export interface EventGeneralDraft {
  eventTypeId: string;
  titlePl: string;
  titleEn: string;
  subtitlePl: string;
  subtitleEn: string;
  slug: string;
  /** `YYYY-MM-DDTHH:mm` - zegar w strefie `timezone` (nie przegladarki) albo `""`. */
  startsAt: string;
  endsAt: string;
  /** Nazwa IANA z wiersza; nieznana `Intl` czyta pola w strefie domyslnej serwisu. */
  timezone: string;
  coverUrl: string;
  videoPlatform: EventVideoPlatform;
  videoId: string;
  format: EventFormat;
  location: string;
  streetAddress: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  descriptionPl: string;
  descriptionEn: string;
  socialHashtag: string;
  languages: readonly string[];
  supportEmail: string;
  /**
   * Chwile, z ktorych powstaly pola terminu: z bazy, a po zmianie strefy -
   * chwile przeliczone na nowa strefe. Pole zgodne z chwila (w strefie szkicu)
   * oddaje ja bez zmian. To KONTEKST odczytu pol, nie pole zapisu - ladunek go
   * nie wysyla.
   */
  savedTimes: SavedInstants<EventGeneralTimeField>;
}

/** Pola terminu - zegar w strefie wydarzenia. */
export const EVENT_GENERAL_TIME_FIELDS = ["startsAt", "endsAt"] as const;
export type EventGeneralTimeField = (typeof EVENT_GENERAL_TIME_FIELDS)[number];

export type EventGeneralField = Exclude<keyof EventGeneralDraft, "savedTimes">;

/** Pola adresu - jeden zbior dla „Wyczysc lokalizacje" i dla walidacji. */
export const EVENT_LOCATION_FIELDS = [
  "location",
  "streetAddress",
  "city",
  "region",
  "postalCode",
  "country",
] as const satisfies readonly EventGeneralField[];

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Pole terminu -> chwila w UTC (`toISOString()`) albo `null` dla pola pustego
 * lub niepelnego. Pole zgodne z chwila z `savedTimes` oddaje ja co do
 * milisekundy.
 */
export function eventGeneralInstant(
  draft: EventGeneralDraft,
  field: EventGeneralTimeField,
): string | null {
  return eventLocalInputToIso(draft[field], draft.timezone, draft.savedTimes[field] ?? null);
}

/**
 * Szkic po zmianie strefy wydarzenia: CHWILE ZOSTAJA, pola pokazuja je
 * w nowej strefie (uzasadnienie w naglowku pliku). Pole puste albo niepelne
 * zostaje napisem - nie ma chwili, ktora daloby sie przeliczyc. Chwila
 * przeliczona trafia do `savedTimes`, wiec powrot do poprzedniej strefy
 * oddaje dokladnie poprzednie pola, a jesienna godzina, ktora w nowej strefie
 * wypada dwa razy, nie przeskakuje na drugie wystapienie.
 */
export function eventGeneralWithTimeZone(
  draft: EventGeneralDraft,
  timezone: string,
): EventGeneralDraft {
  const next: EventGeneralDraft = { ...draft, timezone, savedTimes: { ...draft.savedTimes } };
  for (const field of EVENT_GENERAL_TIME_FIELDS) {
    const resolved = resolveEventLocalInput(
      draft[field],
      draft.timezone,
      draft.savedTimes[field] ?? null,
    );
    if (resolved === null) continue;
    next[field] = eventLocalInput(resolved.iso, timezone);
    next.savedTimes[field] = resolved.iso;
  }
  return next;
}

/** Szkic z wiersza RPC. Nieznane pole degraduje do pustego, a nie wywraca ekranu. */
export function eventGeneralDraftFromRow(row: Record<string, unknown>): EventGeneralDraft {
  const languages = Array.isArray(row["languages"])
    ? normalizeEventLanguages(row["languages"].filter((v): v is string => typeof v === "string"))
    : [];
  const timezone = text(row["timezone"]);
  // Chwila w postaci kanonicznej: baza oddaje `+00:00`, a porownanie szkicu
  // z zapisanym idzie po ladunku - dwa zapisy tej samej chwili nie moga
  // wygladac na zmiane.
  const startsAt = canonicalInstant(text(row["starts_at"]));
  const endsAt = canonicalInstant(text(row["ends_at"]));
  return {
    eventTypeId: text(row["event_type_id"]),
    titlePl: text(row["title_pl"]),
    titleEn: text(row["title_en"]),
    subtitlePl: text(row["subtitle_pl"]),
    subtitleEn: text(row["subtitle_en"]),
    slug: text(row["slug"]),
    startsAt: eventLocalInput(startsAt, timezone),
    endsAt: eventLocalInput(endsAt, timezone),
    timezone,
    coverUrl: text(row["cover_url"]),
    videoPlatform: asEventVideoPlatform(text(row["video_header_platform"])),
    videoId: text(row["video_header_id"]),
    format: asEventFormat(text(row["format"])),
    location: text(row["location"]),
    streetAddress: text(row["street_address"]),
    city: text(row["city"]),
    region: text(row["region"]),
    postalCode: text(row["postal_code"]),
    country: text(row["country"]),
    descriptionPl: text(row["description_pl"]),
    descriptionEn: text(row["description_en"]),
    socialHashtag: text(row["social_hashtag"]),
    languages,
    supportEmail: text(row["support_email"]),
    savedTimes: { startsAt, endsAt },
  };
}

const SLUG_PATTERN = /^[a-z0-9-]{3,120}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HASHTAG_PATTERN = /^[A-Za-z0-9_]{1,60}$/;

/**
 * Powody odrzucenia wersji roboczej. Kolejnosc jest kolejnoscia CZYTANIA
 * ekranu - pierwszy blad, na ktory redaktor natrafi wzrokiem, ma byc pierwszy
 * na liscie.
 */
export function validateEventGeneralDraft(
  draft: EventGeneralDraft,
): readonly EventGeneralFieldError[] {
  const errors: EventGeneralFieldError[] = [];

  if (draft.eventTypeId.trim() === "") {
    errors.push({ field: "eventTypeId", messageKey: `${VALIDATION}eventTypeRequired` });
  }
  if (draft.titlePl.trim() === "") {
    errors.push({ field: "titlePl", messageKey: `${VALIDATION}titleRequired` });
  }
  if (draft.titleEn.trim() === "") {
    errors.push({ field: "titleEn", messageKey: `${VALIDATION}titleRequired` });
  }
  if (!SLUG_PATTERN.test(draft.slug.trim())) {
    errors.push({ field: "slug", messageKey: `${VALIDATION}slugInvalid` });
  }
  // Chwile w strefie WYDARZENIA - te same, ktore pojda do bazy. Pole niepelne
  // nie daje chwili; pusty poczatek i poczatek nieczytelny to ten sam brak.
  const start = eventGeneralInstant(draft, "startsAt");
  if (start === null) {
    errors.push({ field: "startsAt", messageKey: `${VALIDATION}startsAtRequired` });
  }
  // Porownujemy CHWILE, nie napisy: w jesiennej zakladce 02:30 po 02:59 bywa
  // pozniejsze. Koniec podany, ale nieczytelny, tez jest odrzucany - ladunek
  // wyslalby wtedy pusty napis, czyli SKASOWALBY koniec po cichu.
  if (draft.endsAt.trim() !== "") {
    const end = eventGeneralInstant(draft, "endsAt");
    if (end === null || (start !== null && Date.parse(end) <= Date.parse(start))) {
      errors.push({ field: "endsAt", messageKey: `${VALIDATION}endsBeforeStart` });
    }
  }
  if (draft.timezone.trim() === "") {
    errors.push({ field: "timezone", messageKey: `${VALIDATION}timezoneRequired` });
  }
  // Naglowek wideo NIE ZWALNIA Z OKLADKI: miniatura w katalogu, w karcie
  // spolecznosciowej i w e-mailu nadal bierze sie z obrazu. Ten sam warunek
  // stoi w bazie (`events_video_header_requires_cover`).
  if (draft.videoId.trim() !== "" && draft.coverUrl.trim() === "") {
    errors.push({ field: "coverUrl", messageKey: `${VALIDATION}coverRequiredForVideo` });
  }
  // Krzyzyk jest PREZENTACJA, nie trescia: pole go nie przechowuje, a wklejenie
  // „#Kongres2026" z paska adresu ma sie udac, a nie zapalac blad. Walidacja
  // patrzy wiec na to samo, co zapisze `eventGeneralPayload`.
  const hashtag = draft.socialHashtag.trim().replace(/^#+/, "");
  if (hashtag !== "" && !HASHTAG_PATTERN.test(hashtag)) {
    errors.push({ field: "socialHashtag", messageKey: `${VALIDATION}hashtagInvalid` });
  }
  if (draft.supportEmail.trim() !== "" && !EMAIL_PATTERN.test(draft.supportEmail.trim())) {
    errors.push({ field: "supportEmail", messageKey: `${VALIDATION}supportEmailInvalid` });
  }
  if (draft.languages.length === 0) {
    errors.push({ field: "languages", messageKey: `${VALIDATION}languagesRequired` });
  }
  return errors;
}

/**
 * Ostrzezenia - rzeczy, ktore NIE blokuja zapisu, ale zmieniaja to, co zobaczy
 * uczestnik. Blokada zapisu przy braku adresu zmuszalaby do wpisania adresu
 * zanim organizator zna miejsce; milczenie kosztowaloby wydarzenie stacjonarne
 * bez adresu na stronie.
 */
export function eventGeneralWarnings(draft: EventGeneralDraft): readonly string[] {
  const warnings: string[] = [];
  const hasAddress = draft.city.trim() !== "" || draft.streetAddress.trim() !== "";
  if ((draft.format === "onsite" || draft.format === "hybrid") && !hasAddress) {
    warnings.push("adminEvents.general.warnings.addressMissing");
  }
  if (draft.coverUrl.trim() === "") {
    warnings.push("adminEvents.general.warnings.coverMissing");
  }
  const start = eventGeneralInstant(draft, "startsAt");
  const end = eventGeneralInstant(draft, "endsAt");
  if (start !== null && end !== null) {
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    // Literowka w dacie konca („2027" zamiast „2026") kosztuje przypomnienia
    // wyslane do wszystkich zapisanych. Ostrzezenie, nie blokada - kongres
    // trwajacy miesiac jest dziwny, ale mozliwy.
    if (Number.isFinite(days) && days > 30) {
      warnings.push("adminEvents.general.warnings.veryLong");
    }
  }
  return warnings;
}

/** Czy wersja robocza rozni sie od zapisanej - warunek aktywnosci „Zapisz". */
export function eventGeneralDirty(a: EventGeneralDraft, b: EventGeneralDraft): boolean {
  return JSON.stringify(eventGeneralPayload("", a)) !== JSON.stringify(eventGeneralPayload("", b));
}

/** Wyczyszczenie calego adresu - odpowiednik „Reset location". */
export function clearEventLocation(draft: EventGeneralDraft): EventGeneralDraft {
  return {
    ...draft,
    location: "",
    streetAddress: "",
    city: "",
    region: "",
    postalCode: "",
    country: "",
  };
}

/**
 * Payload dla `admin_event_general_save`. Wysylamy KOMPLET pol ekranu, bo ekran
 * zapisuje sie w calosci - RPC obsluguje pominiecie klucza po to, zeby ten sam
 * kontrakt uniósł pozniej zapisy czastkowe z innych ekranow.
 */
export function eventGeneralPayload(
  eventId: string,
  draft: EventGeneralDraft,
): Record<string, string | string[]> {
  const videoId = draft.videoId.trim();
  return {
    id: eventId,
    event_type_id: draft.eventTypeId.trim(),
    title_pl: draft.titlePl.trim(),
    title_en: draft.titleEn.trim(),
    subtitle_pl: draft.subtitlePl.trim(),
    subtitle_en: draft.subtitleEn.trim(),
    slug: draft.slug.trim().toLowerCase(),
    // Chwile w UTC liczone w strefie szkicu; pusty napis = NULL po stronie RPC
    // (dla konca: „bez konca", poczatek pusty odcina walidacja).
    starts_at: eventGeneralInstant(draft, "startsAt") ?? "",
    ends_at: eventGeneralInstant(draft, "endsAt") ?? "",
    timezone: draft.timezone.trim(),
    cover_url: draft.coverUrl.trim(),
    video_header_platform: videoId === "" ? "" : draft.videoPlatform,
    video_header_id: videoId,
    format: draft.format,
    location: draft.location.trim(),
    street_address: draft.streetAddress.trim(),
    city: draft.city.trim(),
    region: draft.region.trim(),
    postal_code: draft.postalCode.trim(),
    country: draft.country.trim(),
    description_pl: draft.descriptionPl.trim(),
    description_en: draft.descriptionEn.trim(),
    social_hashtag: draft.socialHashtag.trim().replace(/^#+/, ""),
    languages: normalizeEventLanguages(draft.languages),
    support_email: draft.supportEmail.trim().toLowerCase(),
  };
}
