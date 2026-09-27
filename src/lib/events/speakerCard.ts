// Reguly KARTY PRELEGENTA rozwijanej kliknieciem - wspolne dla siatki
// prelegentow, podgladu studia, dialogu karty w panelu i programu.
//
// WARSTWA CZYSTA: zero Reacta, zero Supabase, zero importow runtime (ten sam
// wzorzec, co `lib/builder/speakerRow.ts`). Odpowiada na pytania o JUZ
// POBRANY wiersz: jakie sciezki, jaki przycisk, jaki kolor napisu na tle.
// Dzieki temu powierzchnia, ktora rysuje tylko karte, nie wciaga warstwy
// sieciowej, a reguly sprawdza test jednostkowy bez montowania czegokolwiek.
//
// SCIEZKI (typ, parser, nazwa) zyja w lisciu `speakerTracks.ts` - ten plik je
// re-eksportuje; tam tez uzasadnienie podzialu (chunk startowy).

import { hexColorOrNull, textOrNull } from "@/lib/events/speakerTracks";

export {
  hasNamedSpeakerTrack,
  hexColorOrNull,
  parseSpeakerTracks,
  speakerTrackName,
  type SpeakerTrack,
} from "@/lib/events/speakerTracks";

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

/**
 * Slowa napisu do porownania. Najpierw NFKC (tekst wklejony z PDF-u albo
 * z macOS bywa rozlozony - „a" + ogonek to jedna litera, nie dwie) i bez znakow
 * formatujacych (miekki dywiz, spacja zerowej szerokosci rozcinaly slowo).
 * Znaki laczace (`\p{M}`) naleza do slowa; reszta - interpunkcja, cudzyslowy,
 * myslniki, twarde spacje - to granica slow.
 */
const wordsOf = (value: string): string[] =>
  value
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((word) => word !== "");

const folded = (word: string): string => word.toLocaleLowerCase("pl");

/** Nazwa wlasna albo skrot: wielka litera lub cyfra („Polityka", „CPK", „3M"). */
const looksLikeName = (word: string): boolean => /[\p{Lu}\p{N}]/u.test(word);

/**
 * Organizacja do pokazania OBOK roli - albo `null`, gdy tylko ja powtarza.
 *
 * DANE POWTARZAJA ROLE W POLU FIRMY. Projekcja bierze `company` z konta albo
 * z `event_people.company_text`, a import prelegentow wpisywal tam czesto to
 * samo, co w stanowisku - karta pokazywala wtedy „Prezes CPK" dwa razy, raz
 * wersalikami. Powtorzenie nie jest drugim faktem, wiec znika z podpisu:
 *   * ten sam napis (wielkosc liter, interpunkcja i spacje sie nie licza),
 *   * nazwa organizacji zawarta w roli jako cale slowa („Prezes WiseEuropa"
 *     i „WiseEuropa") - ale TYLKO jako nazwa: slowo organizacji pisane wielka
 *     litera (albo z cyfra) musi tez w roli stac wielka litera. Rzeczownik
 *     „polityka zagraniczna" w roli nie jest tygodnikiem „Polityka", wiec
 *     tygodnik zostaje. Kopia wersalikami („PREZES CPK") nadal znika.
 * Odwrotnie NIE: rola zawarta w organizacji to zwykle dwa rozne fakty
 * („Ekspert" i „Ekspert sektora energetycznego" to nadal rola i nazwa).
 *
 * `contained: false` wylacza drugi przypadek. Powierzchnia, ktora ucina role do
 * jednej linii (chip zapowiedzi na przegladzie), nie moze chowac organizacji
 * „zawartej w roli" - koniec roli, w ktorym ta nazwa stoi, jest wlasnie ucinany.
 *
 * JEDNA REGULA DLA KAZDEJ POWIERZCHNI. Siatka, zapowiedz na przegladzie,
 * dialog profilu i widget prelegentow w builderze pytaja tutaj - gdyby dedupe
 * mialo tylko jedno miejsce, ta sama osoba mialaby na dwoch powierzchniach
 * rozne podpisy.
 */
export function speakerOrganizationLine(
  role: string | null | undefined,
  organization: string | null | undefined,
  { contained = true }: { contained?: boolean } = {},
): string | null {
  const org = textOrNull(organization);
  if (org === null) return null;
  const orgWords = wordsOf(org);
  if (orgWords.length === 0) return org;
  const roleWords = wordsOf(role ?? "");
  if (roleWords.length === 0) return org;
  if (roleWords.map(folded).join(" ") === orgWords.map(folded).join(" ")) return null;
  if (!contained) return org;
  for (let start = 0; start + orgWords.length <= roleWords.length; start += 1) {
    const repeated = orgWords.every((word, offset) => {
      const inRole = roleWords[start + offset] ?? "";
      return folded(inRole) === folded(word) && (!looksLikeName(word) || looksLikeName(inRole));
    });
    if (repeated) return null;
  }
  return org;
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
