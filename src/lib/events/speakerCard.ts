// Reguly KARTY PRELEGENTA rozwijanej kliknieciem - wspolne dla siatki
// prelegentow, podgladu studia, dialogu karty w panelu i programu.
//
// WARSTWA CZYSTA: zero Reacta, zero Supabase, zero importow runtime (ten sam
// wzorzec, co `lib/builder/speakerRow.ts`). Odpowiada na pytania o JUZ
// POBRANY wiersz: jakie sciezki, jaki przycisk, jaki kolor napisu na tle.
// Dzieki temu powierzchnia, ktora rysuje tylko karte, nie wciaga warstwy
// sieciowej, a reguly sprawdza test jednostkowy bez montowania czegokolwiek.
//
// SCIEZKI NIE SA WPISYWANE. `tracks` przychodzi z bazy wyprowadzone z obsady
// sesji (`_event_speaker_tracks` w 20260924120000), wiec parser nie „naprawia"
// danych - odsiewa tylko wpisy, ktorych nie da sie narysowac (bez id, bez
// nazwy) i duplikaty, zeby klucz Reacta byl jednoznaczny.

/** Sciezka, w ktorej prelegent wystepuje (co najmniej jedna sesja). */
export interface SpeakerTrack {
  id: string;
  key: string | null;
  namePl: string | null;
  nameEn: string | null;
  accentColor: string | null;
  /** Liczba sesji prelegenta w tej sciezce; 0, gdy zrodlo jej nie podaje. */
  sessionsCount: number;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const textOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** Kolor `#RRGGBB` albo `null` - to samo ograniczenie, co CHECK w bazie. */
export function hexColorOrNull(value: unknown): string | null {
  return typeof value === "string" && HEX_COLOR.test(value.trim()) ? value.trim() : null;
}

/**
 * `tracks jsonb` z RPC -> lista sciezek. Wejscie jest `unknown`, bo przychodzi
 * z `jsonb` (null, obiekt zamiast tablicy, stary wpis cache sprzed kolumny).
 */
export function parseSpeakerTracks(raw: unknown): SpeakerTrack[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SpeakerTrack[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = textOrNull(row.id);
    if (id === null || seen.has(id)) continue;
    const namePl = textOrNull(row.name_pl);
    const nameEn = textOrNull(row.name_en);
    if (namePl === null && nameEn === null) continue;
    seen.add(id);
    const count =
      typeof row.sessions_count === "number" ? row.sessions_count : Number(row.sessions_count);
    out.push({
      id,
      key: textOrNull(row.key),
      namePl,
      nameEn,
      accentColor: hexColorOrNull(row.accent_color),
      sessionsCount: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
    });
  }
  return out;
}

/** Nazwa sciezki w jezyku interfejsu, z awaryjnym drugim jezykiem. */
export function speakerTrackName(track: SpeakerTrack, lang: "pl" | "en"): string {
  const primary = lang === "en" ? track.nameEn : track.namePl;
  const secondary = lang === "en" ? track.namePl : track.nameEn;
  return primary ?? secondary ?? "";
}

/**
 * Adres przycisku, ktory wolno wstawic do `href`. Baza wymusza to samo
 * (CHECK `speaker_profiles_card_cta_url_shape`), ale karta dostaje tez wiersze
 * z podgladu i z pamieci podrecznej - druga linia obrony kosztuje jedno
 * wyrazenie i zamyka `javascript:` niezaleznie od zrodla.
 */
export function safeCardHref(value: unknown): string | null {
  const url = textOrNull(value);
  if (url === null) return null;
  if (/^https:\/\/[^\s]+$/i.test(url)) return url;
  if (/^\/[^/\s][^\s]*$/.test(url)) return url;
  return null;
}

/** Pola karty, ktorych potrzebuje rozstrzygniecie przycisku. */
export interface SpeakerCardFields {
  card_cta_label_pl?: string | null;
  card_cta_label_en?: string | null;
  card_cta_url?: string | null;
}

export type SpeakerCardAction =
  | {
      kind: "link";
      href: string;
      /** Etykieta od redakcji albo `null` = etykieta domyslna interfejsu. */
      label: string | null;
      /** Link poza serwis otwieramy w nowej karcie, wewnetrzny - w tej samej. */
      external: boolean;
    }
  | { kind: "profile"; label: string | null };

/**
 * Co robi przycisk karty.
 *
 *   1) redakcja podala adres -> link (etykieta redakcji albo domyslna);
 *   2) nie podala, ale jest co pokazac w dialogu profilu -> otwarcie profilu;
 *   3) inaczej -> przycisku NIE MA. Przycisk, ktory nic nie robi albo powtarza
 *      karte, jest gorszy niz jego brak (ta sama regula, co klikalnosc karty
 *      w `speakerHasProfileToShow`).
 *
 * Etykieta wybiera jezyk interfejsu, a w jego braku drugi jezyk - pusta
 * etykieta w jednym jezyku nie moze gasic przycisku, ktory redakcja ustawila.
 */
export function speakerCardAction(
  row: SpeakerCardFields,
  lang: "pl" | "en",
  canOpenProfile: boolean,
): SpeakerCardAction | null {
  const primary = lang === "en" ? row.card_cta_label_en : row.card_cta_label_pl;
  const secondary = lang === "en" ? row.card_cta_label_pl : row.card_cta_label_en;
  const label = textOrNull(primary) ?? textOrNull(secondary);
  const href = safeCardHref(row.card_cta_url);
  if (href !== null) return { kind: "link", href, label, external: href.startsWith("https://") };
  if (canOpenProfile) return { kind: "profile", label };
  return null;
}

/** Zdjecie rozwinietej karty: kadr od redakcji, a w jego braku zdjecie osoby. */
export function speakerCardPhoto(row: {
  card_photo_url?: string | null;
  avatar_url?: string | null;
}): string | null {
  return textOrNull(row.card_photo_url) ?? textOrNull(row.avatar_url);
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Kolor napisu na tle przycisku: czern albo biel - to, co daje WIEKSZY
 * kontrast wg WCAG 2.x. Redakcja wybiera kolor marki, a nie pare kolorow;
 * bialy napis na zoltym przycisku bylby nieczytelny, wiec pare liczy kod.
 */
export function readableInkOn(hex: string | null): "#000000" | "#ffffff" {
  const color = hexColorOrNull(hex);
  if (color === null) return "#ffffff";
  const l = luminance(color);
  const onWhite = 1.05 / (l + 0.05);
  const onBlack = (l + 0.05) / 0.05;
  return onBlack >= onWhite ? "#000000" : "#ffffff";
}

/** Limit etykiety przycisku - ten sam, co CHECK `speaker_profiles_card_cta_label_len`. */
export const SPEAKER_CARD_LABEL_MAX = 40;

/** Szkic pol karty w panelu - napisy, pusty = „brak" (baza dostaje NULL). */
export interface SpeakerCardDraft {
  photoUrl: string;
  labelPl: string;
  labelEn: string;
  url: string;
  color: string;
}

export const EMPTY_SPEAKER_CARD_DRAFT: SpeakerCardDraft = {
  photoUrl: "",
  labelPl: "",
  labelEn: "",
  url: "",
  color: "",
};

export type SpeakerCardDraftError = "labelTooLong" | "urlShape" | "photoShape" | "colorShape";

/**
 * Bledy szkicu karty - PRZED zapisem, zeby redaktor nie dostawal odmowy bazy
 * za cos, co widac od razu. Reguly sa lustrem CHECK-ow z 20260924120000;
 * baza zostaje ostatnia linia obrony, nie pierwsza.
 */
export function speakerCardDraftErrors(
  draft: SpeakerCardDraft,
): Partial<Record<keyof SpeakerCardDraft, SpeakerCardDraftError>> {
  const errors: Partial<Record<keyof SpeakerCardDraft, SpeakerCardDraftError>> = {};
  if (draft.labelPl.trim().length > SPEAKER_CARD_LABEL_MAX) errors.labelPl = "labelTooLong";
  if (draft.labelEn.trim().length > SPEAKER_CARD_LABEL_MAX) errors.labelEn = "labelTooLong";
  if (draft.url.trim() !== "" && safeCardHref(draft.url) === null) errors.url = "urlShape";
  if (draft.photoUrl.trim() !== "" && !/^https:\/\/\S+$/i.test(draft.photoUrl.trim())) {
    errors.photoUrl = "photoShape";
  }
  if (draft.color.trim() !== "" && hexColorOrNull(draft.color) === null)
    errors.color = "colorShape";
  return errors;
}

/** Szkic z wiersza panelu (pola karty moga nie przyjsc - wtedy puste). */
export function speakerCardDraftFrom(row: {
  card_photo_url?: string | null;
  card_cta_label_pl?: string | null;
  card_cta_label_en?: string | null;
  card_cta_url?: string | null;
  card_cta_color?: string | null;
}): SpeakerCardDraft {
  return {
    photoUrl: row.card_photo_url ?? "",
    labelPl: row.card_cta_label_pl ?? "",
    labelEn: row.card_cta_label_en ?? "",
    url: row.card_cta_url ?? "",
    color: row.card_cta_color ?? "",
  };
}
