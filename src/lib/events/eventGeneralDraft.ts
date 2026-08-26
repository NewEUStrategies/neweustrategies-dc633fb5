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
// GRANICA WARSTW: zero Reacta, zero i18next, zero klienta bazy.
import { normalizeEventLanguages } from "@/lib/events/eventLanguages";
import { asEventFormat, type EventFormat } from "@/lib/events/eventTypes";

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

/** Platformy naglowka wideo. Pusty napis = brak naglowka wideo. */
export const EVENT_VIDEO_PLATFORMS = ["youtube", "vimeo"] as const;
export type EventVideoPlatform = (typeof EVENT_VIDEO_PLATFORMS)[number];

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
  titlePl: string;
  titleEn: string;
  slug: string;
  startsAt: string;
  endsAt: string;
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
}

export type EventGeneralField = keyof EventGeneralDraft;

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

/** Szkic z wiersza RPC. Nieznane pole degraduje do pustego, a nie wywraca ekranu. */
export function eventGeneralDraftFromRow(row: Record<string, unknown>): EventGeneralDraft {
  const platform = text(row["video_header_platform"]);
  const languages = Array.isArray(row["languages"])
    ? normalizeEventLanguages(row["languages"].filter((v): v is string => typeof v === "string"))
    : [];
  return {
    titlePl: text(row["title_pl"]),
    titleEn: text(row["title_en"]),
    slug: text(row["slug"]),
    startsAt: text(row["starts_at"]),
    endsAt: text(row["ends_at"]),
    timezone: text(row["timezone"]),
    coverUrl: text(row["cover_url"]),
    videoPlatform: (EVENT_VIDEO_PLATFORMS as readonly string[]).includes(platform)
      ? (platform as EventVideoPlatform)
      : "youtube",
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

  if (draft.titlePl.trim() === "") {
    errors.push({ field: "titlePl", messageKey: `${VALIDATION}titleRequired` });
  }
  if (draft.titleEn.trim() === "") {
    errors.push({ field: "titleEn", messageKey: `${VALIDATION}titleRequired` });
  }
  if (!SLUG_PATTERN.test(draft.slug.trim())) {
    errors.push({ field: "slug", messageKey: `${VALIDATION}slugInvalid` });
  }
  if (draft.startsAt.trim() === "") {
    errors.push({ field: "startsAt", messageKey: `${VALIDATION}startsAtRequired` });
  }
  if (draft.endsAt.trim() !== "" && draft.startsAt.trim() !== "") {
    const start = new Date(draft.startsAt).getTime();
    const end = new Date(draft.endsAt).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
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
  if (draft.endsAt.trim() !== "" && draft.startsAt.trim() !== "") {
    const days =
      (new Date(draft.endsAt).getTime() - new Date(draft.startsAt).getTime()) / 86_400_000;
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

/** Adres strukturalny w jednej linii - podglad i `schema.org/Event`. */
export function eventAddressLine(draft: EventGeneralDraft): string {
  const cityLine = [draft.postalCode.trim(), draft.city.trim()].filter((p) => p !== "").join(" ");
  return [draft.streetAddress.trim(), cityLine, draft.region.trim(), draft.country.trim()]
    .filter((part) => part !== "")
    .join(", ");
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
    title_pl: draft.titlePl.trim(),
    title_en: draft.titleEn.trim(),
    slug: draft.slug.trim().toLowerCase(),
    starts_at: draft.startsAt.trim(),
    ends_at: draft.endsAt.trim(),
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

/**
 * Identyfikator materialu z adresu albo z samego identyfikatora.
 *
 * Redaktor wkleja CALY adres z paska przegladarki - i to jest zachowanie,
 * ktorego nie da sie oduczyc etykieta. Pole przyjmuje jedno i drugie.
 */
export function parseVideoId(input: string, platform: EventVideoPlatform): string {
  const value = input.trim();
  if (value === "") return "";
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    if (platform === "youtube") {
      const fromQuery = url.searchParams.get("v");
      if (fromQuery !== null && fromQuery !== "") return fromQuery;
      const segments = url.pathname.split("/").filter((part) => part !== "");
      return segments[segments.length - 1] ?? "";
    }
    const segments = url.pathname.split("/").filter((part) => part !== "");
    return segments[segments.length - 1] ?? "";
  } catch {
    return value;
  }
}

/** Adres osadzenia naglowka wideo albo `null`, gdy naglowka nie ma. */
export function videoEmbedUrl(platform: EventVideoPlatform, videoId: string): string | null {
  const id = videoId.trim();
  if (id === "") return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return platform === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${id}`
    : `https://player.vimeo.com/video/${id}`;
}
