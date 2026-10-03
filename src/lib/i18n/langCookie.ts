// Language-preference cookie helpers, shared by the i18n resolver and the
// locale runtime. Since the language now lives in the URL path, this cookie is
// only a *preference* (used to render app/system pages in the user's language
// and to drive the homepage preference redirect) - it never makes a content
// render non-shareable.
import { normalizeLang, type AppLang } from "./localePath";

export const LANG_COOKIE = "nes_lang";
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 rok

/**
 * Poprzednia nazwa cookie preferencji języka. Czytamy ją nadal, bo cookie żyje
 * rok: bez odczytu zapasowego każdy wracający czytelnik straciłby wybrany język
 * i dostałby przekierowanie na wersję z Accept-Language. Zapis idzie WYŁĄCZNIE
 * pod nową nazwą, więc stara wygasa sama.
 */
const LEGACY_LANG_COOKIES = ["lovable_lang"] as const;

// Wzorce kompilowane raz (a nie przy każdym odczycie). Nazwa musi stać na
// początku albo zaraz po `;`, więc obce `xnes_lang=` nie pasuje. Jeden wzorzec
// dla nagłówka `Cookie:` i `document.cookie`: odstęp po `;` jest opcjonalny,
// tak jak w parserach serwerowych - dawny wariant kliencki wymagał dokładnie
// "; " i bez spacji gubił preferencję. Flaga `g` + matchAll: ta sama nazwa może
// przyjść kilka razy (ciasteczko z Domain= rodzica obok naszego host-only,
// starsze pierwsze) - zepsuty pierwszy egzemplarz nie może przesłonić
// poprawnego, bo wtedy żaden zapis klienta nie przywraca preferencji.
const LANG_COOKIE_PATTERNS: readonly RegExp[] = [LANG_COOKIE, ...LEGACY_LANG_COOKIES].map(
  (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`, "g");
  },
);

/**
 * `decodeURIComponent` rzuca URIError na zepsutej sekwencji procentowej
 * (`nes_lang=%`, `nes_lang=%E0%A4%A`). Ciasteczko przychodzi spoza naszej
 * kontroli (inna aplikacja na domenie, rozszerzenie, ręczna edycja) i żyje rok:
 * bez osłony jedna zepsuta wartość dawała 500 na "/" (homepageLangMiddleware ->
 * errorMiddleware) i wywracała ewaluację localeRuntime na stronach aplikacji.
 * Zepsuta wartość = brak preferencji, więc nazwa zapasowa nadal ma głos, a
 * klient nadpisuje ciasteczko poprawną wartością.
 */
function decodeCookieValue(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function readLangFrom(source: string): AppLang | null {
  for (const pattern of LANG_COOKIE_PATTERNS) {
    // matchAll klonuje wzorzec, więc współdzielony `lastIndex` zostaje nietknięty.
    for (const match of source.matchAll(pattern)) {
      const lang = normalizeLang(decodeCookieValue(match[1]));
      if (lang) return lang;
    }
  }
  return null;
}

/** Parse the language cookie out of a raw `Cookie:` header. Pure + testable. */
export function readLangCookieFromHeader(header: string | null | undefined): AppLang | null {
  if (!header) return null;
  return readLangFrom(header);
}

/** Read the language preference from `document.cookie` (client only). */
export function readLangCookieClient(): AppLang | null {
  if (typeof document === "undefined") return null;
  return readLangFrom(document.cookie);
}

/** Persist the language preference to `document.cookie` (client only). */
export function writeLangCookieClient(lang: AppLang): void {
  if (typeof document === "undefined") return;
  // Mark Secure on https so the cookie is never sent over a plaintext downgrade.
  // (It is a non-sensitive preference and is written from JS, so HttpOnly is not
  // possible - Secure is the applicable hardening.)
  const secure =
    typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LANG_COOKIE}=${encodeURIComponent(lang)}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

/**
 * Reguła produktu dla NAJWYŻEJ postawionej preferencji odwiedzającego: polski ->
 * "pl", każdy inny język -> "en". Jedna funkcja dla serwera (Accept-Language,
 * negocjacja gołego "/") i klienta (navigator.languages, backfill ciasteczka po
 * wejściu głębokim linkiem). Klient brał dawniej "pl", gdy polski stał
 * GDZIEKOLWIEK na liście, więc czytelnik z `en-US, pl` dostawał EN wchodząc
 * przez "/", a PL - wchodząc przez artykuł.
 */
export function langForPreferredTag(tag: string): AppLang {
  return tag.toLowerCase().split("-")[0] === "pl" ? "pl" : "en";
}

/**
 * Detect the visitor's preferred language from the browser (client only).
 * The browser's top preference decides (see `langForPreferredTag`).
 * Returns null on the server and when the browser states no preference.
 */
export function detectBrowserLang(): AppLang | null {
  // Bramka na `document`, jak w pozostałych helperach klienta: Node >= 21 i
  // workerd mają globalny `navigator` (w Node z locale PROCESU), więc sam test
  // `navigator` nie odróżnia już SSR od przeglądarki.
  if (typeof document === "undefined" || typeof navigator === "undefined") return null;
  const langs = (navigator as Navigator & { languages?: readonly string[] }).languages;
  const top = langs?.find(Boolean) ?? navigator.language;
  return top ? langForPreferredTag(top) : null;
}
