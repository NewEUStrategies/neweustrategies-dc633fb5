// Zdjęcie w tle nagłówka archiwum (`hero_bg_style = "image"`) - JEDNA reguła
// adresu dla panelu, renderu i bazy.
//
// PRZYCZYNA ŹRÓDŁOWA. Panel ustawień archiwum oferował tło „Zdjęcie”, a
// `HeroBackground` umiał je narysować z propsu `imageUrl` - ale adresu nie
// przechowywało nic (brak kolumny, `ArchiveHeader` przekazywał sam styl), więc
// styl zawsze schodził po cichu na neutralne tło. Kolumnę
// `archive_layout_settings.hero_image_url` dodaje migracja 20261003100000.
//
// DLACZEGO OSOBNY MODUŁ. Adres trafia do CSS na KAŻDEJ publicznej stronie
// archiwum, więc ta sama reguła musi obowiązywać w trzech miejscach: panel
// pokazuje po niej komunikat przed zapisem, render odrzuca po niej wartość
// jeszcze raz (obrona w głąb - wiersz mógł wejść z pominięciem panelu albo
// sprzed migracji), a baza pilnuje jej CHECK-iem
// `archive_layout_settings_hero_image_url_shape`. Gdyby panel i baza miały dwie
// różne reguły, panel przepuszczałby wartość, którą baza odrzuca - redaktor
// zobaczyłby wtedy tylko ogólny „Nie udało się zapisać”.
//
// Moduł jest czysty (bez Supabase i bez Reacta), więc render archiwum nie
// ciągnie przez niego klienta bazy.
import { mediaRenderUrl } from "@/lib/media/publicUrl";

/** Limit długości - ten sam co w CHECK bazy i w logo instytucji prelegenta. */
export const HERO_IMAGE_URL_MAX_LENGTH = 2048;

// Początek adresu: `http(s)://` z niepustym hostem albo ścieżka w serwisie od
// POJEDYNCZEGO „/”. '//host' i 'https:///host' odpadają na drugim znaku po
// prefiksie; `javascript:`, `data:` i każdy inny schemat - na samym prefiksie.
// Lustro `~* '^(https?://|/)[^/]'` z migracji (flaga `i` = `~*`).
const HERO_IMAGE_URL_START = /^(?:https?:\/\/|\/)[^/]/i;

/**
 * Znak niedozwolony w adresie: biały znak i znak sterujący ASCII (0x00-0x20,
 * 0x7f) oraz odwrotny ukośnik. Zakres jest ASCII-owy CELOWO - baza sprawdza go
 * jawnym `[\x01-\x20\x7f\\]`, a nie klasą zależną od locale, więc obie strony
 * dają ten sam werdykt także dla znaków spoza ASCII. Odwrotny ukośnik odpada,
 * bo przeglądarka czyta '/\host' jak '//host', czyli obcy host. Sprawdzane
 * pętlą, a nie wyrażeniem regularnym: klasa znaków sterujących w regexie to
 * dokładnie to, co `no-control-regex` słusznie zgłasza jako podejrzane.
 */
function isForbiddenChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code <= 0x20 || code === 0x7f || ch === "\\";
}

/**
 * Czy wartość jest dopuszczalnym adresem zdjęcia nagłówka - 1:1 z CHECK-iem
 * `archive_layout_settings_hero_image_url_shape`. Wartość NIE jest przycinana:
 * baza odrzuca wiodącą spację, więc przycięcie należy do `normalizeHeroImageUrl`.
 */
export function isHeroImageUrl(value: string): boolean {
  // `char_length` w Postgresie liczy punkty kodowe, `.length` - jednostki
  // UTF-16; rozwinięcie napisu liczy tak samo jak baza także dla emoji.
  if ([...value].length > HERO_IMAGE_URL_MAX_LENGTH) return false;
  if (!HERO_IMAGE_URL_START.test(value)) return false;
  for (const ch of value) {
    if (isForbiddenChar(ch)) return false;
  }
  return true;
}

/** Wartość z bazy albo z pola panelu: przycięta, pusta → `null`. Bez walidacji. */
export function normalizeHeroImageUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** Wpisana wartość jest NIEPUSTA i łamie regułę adresu (komunikat w panelu). */
export function isInvalidHeroImageUrl(raw: unknown): boolean {
  const value = normalizeHeroImageUrl(raw);
  return value !== null && !isHeroImageUrl(value);
}

/**
 * Wartość do zapisu: przycięta i poprawna albo `null`. Niepoprawna wartość nie
 * może pojechać do bazy - CHECK odrzuciłby cały zapis ustawień archiwum,
 * łącznie z polami, które redaktor zmienił poprawnie.
 */
export function heroImageUrlForSave(raw: unknown): string | null {
  const value = normalizeHeroImageUrl(raw);
  return value !== null && isHeroImageUrl(value) ? value : null;
}

/**
 * Treść napisu CSS w cudzysłowie. Escapujemy znaki, które kończą napis albo
 * token `url()` (cudzysłowy, nawiasy, odwrotny ukośnik), i znaki nowej linii
 * (w napisie CSS są błędem składni, który unieważnia całą deklarację). Po
 * `\` nie stoi nigdy cyfra szesnastkowa, więc przeglądarka nie czyta escape'u
 * jako punktu kodowego - `\(` to po prostu `(`.
 */
function cssStringBody(value: string): string {
  return value.replace(/[\\"'()\n\r\f]/g, (ch) => {
    if (ch === "\n") return "\\a ";
    if (ch === "\r") return "\\d ";
    if (ch === "\f") return "\\c ";
    return `\\${ch}`;
  });
}

/**
 * Gotowa wartość `background-image` dla zdjęcia nagłówka albo `null`, gdy
 * adresu nie ma albo łamie regułę (render schodzi wtedy na neutralne tło).
 *
 * Adres NIGDY nie jest wklejany do CSS surowo: najpierw reguła adresu, potem
 * `mediaRenderUrl` (pliki z biblioteki mediów renderujemy ścieżką względną
 * `/media/…`, jak w podglądzie panelu, więc działają w każdym środowisku
 * i pod każdą domeną tenanta), na końcu cytowany i escapowany `url("…")`.
 * Bez cudzysłowów nawias w nazwie pliku („hero(1).jpg”) kończyłby token
 * `url(` w połowie, a cudzysłów w adresie pozwalałby dopisać własną deklarację.
 */
export function heroImageBackground(raw: unknown): string | null {
  const value = normalizeHeroImageUrl(raw);
  if (value === null || !isHeroImageUrl(value)) return null;
  return `url("${cssStringBody(mediaRenderUrl(value))}")`;
}
