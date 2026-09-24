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
// sesji (`_event_speaker_tracks` w 20260924140000), wiec parser nie „naprawia"
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
 * Czy lista ma choc jedna sciezke, ktora `SpeakerTrackChips` narysuje (z nazwa
 * w ktoryms jezyku). Program pyta o to, zanim pokaze „Pokaz szczegoly" - ta
 * sama regula, co w rendererze, wiec przycisk nie obiecuje pustego rzedu.
 */
export function hasNamedSpeakerTrack(tracks: readonly SpeakerTrack[], lang: "pl" | "en"): boolean {
  return tracks.some((track) => speakerTrackName(track, lang) !== "");
}

/** Limit adresu (przycisk i zdjecie) - `char_length(...) <= 2048` w CHECK-ach. */
export const SPEAKER_CARD_URL_MAX = 2048;

/** Znaki licza sie jak `char_length` w bazie: punkty kodowe, nie jednostki UTF-16. */
const codePoints = (value: string): number => Array.from(value).length;

/** C0, DEL i C1 - to, co `[[:cntrl:]]` odrzuca w CHECK-u adresu przycisku. */
const hasControlChar = (value: string): boolean =>
  Array.from(value).some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });

/**
 * Adres przycisku, ktory wolno wstawic do `href`. Baza wymusza to samo
 * (CHECK `speaker_profiles_card_cta_url_shape`), ale karta dostaje tez wiersze
 * z podgladu i z pamieci podrecznej - druga linia obrony kosztuje jedno
 * wyrazenie i zamyka `javascript:` niezaleznie od zrodla.
 *
 * WIELKOSC LITER JAK W BAZIE. CHECK porownuje `^https://` z rozroznieniem
 * wielkosci liter, wiec tu tez - inaczej panel przepuszczalby „HTTPS://",
 * ktore baza odrzuci bez wskazania pola.
 *
 * SCIEZKA WEWNETRZNA NIE MOZE ZACZYNAC SIE OD `//` ANI `/\`. Przegladarka
 * czyta `/\evil.com` jak `//evil.com` (adres wzgledny wobec protokolu), wiec
 * drugi znak nie moze byc ani ukosnikiem, ani odwrotnym ukosnikiem. Bialych
 * znakow nie ma nigdzie: parser adresu wycina tabulatory, a `/<tab>/evil.com`
 * stalby sie `//evil.com`.
 *
 * DLUGOSC I ZNAKI STERUJACE JAK W BAZIE. CHECK odrzuca adres dluzszy niz 2048
 * znakow i kazdy znak `[[:cntrl:]]` - takze te, ktorych `\s` nie lapie
 * (U+0001..U+0008, U+007F, U+0085). Bez tego panel przepuszczalby adres,
 * ktory baza odrzuci surowym komunikatem po angielsku.
 */
export function safeCardHref(value: unknown): string | null {
  const url = textOrNull(value);
  if (url === null) return null;
  if (codePoints(url) > SPEAKER_CARD_URL_MAX || hasControlChar(url)) return null;
  if (/^https:\/\/\S+$/.test(url)) return url;
  if (/^\/[^/\\\s]\S*$/.test(url)) return url;
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

export type SpeakerCardDraftError =
  "labelTooLong" | "urlShape" | "urlTooLong" | "photoShape" | "colorShape";

/**
 * Bledy szkicu karty - PRZED zapisem, zeby redaktor nie dostawal odmowy bazy
 * za cos, co widac od razu. Reguly sa lustrem CHECK-ow z 20260924140000;
 * baza zostaje ostatnia linia obrony, nie pierwsza.
 */
export function speakerCardDraftErrors(
  draft: SpeakerCardDraft,
): Partial<Record<keyof SpeakerCardDraft, SpeakerCardDraftError>> {
  const errors: Partial<Record<keyof SpeakerCardDraft, SpeakerCardDraftError>> = {};
  // Znaki licza sie jak `char_length` w bazie (punkty kodowe, nie jednostki
  // UTF-16) - emoji nie moze byc w panelu „dwoma znakami", a w bazie jednym.
  if (codePoints(draft.labelPl.trim()) > SPEAKER_CARD_LABEL_MAX) errors.labelPl = "labelTooLong";
  if (codePoints(draft.labelEn.trim()) > SPEAKER_CARD_LABEL_MAX) errors.labelEn = "labelTooLong";
  const url = draft.url.trim();
  if (codePoints(url) > SPEAKER_CARD_URL_MAX) errors.url = "urlTooLong";
  else if (url !== "" && safeCardHref(url) === null) errors.url = "urlShape";
  const photoUrl = draft.photoUrl.trim();
  if (codePoints(photoUrl) > SPEAKER_CARD_URL_MAX) errors.photoUrl = "urlTooLong";
  else if (photoUrl !== "" && !/^https:\/\/\S+$/.test(photoUrl)) errors.photoUrl = "photoShape";
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
