// PII scrubbing for telemetry ingest (client errors + web vitals).
//
// Error messages, stack traces and URLs frequently carry personal data:
// an email typed into a form and echoed in a validation error, a session
// token or recovery `code` in a query string, a JWT in an Authorization
// header logged by a fetch wrapper. Persisting those verbatim turns an
// observability table into a secondary PII/secret store. Every string that
// reaches a telemetry sink MUST pass through `redactPii` (free text) or
// `redactUrl` (URLs) first; `redactMeta` deep-scrubs structured context.
//
// The redaction is intentionally conservative: it errs toward dropping a
// value that merely looks sensitive (long hex/base64, `eyJ…` JWTs, known
// credential-bearing query keys) rather than risk leaking one. Redacted
// spans are replaced with a stable `[redacted-*]` marker so aggregated
// telemetry still groups identical errors.
//
// NUMERY TELEFONÓW (znacznik `[redacted-phone]`). Nagłówek
// `src/routes/api/public/track.ts` od dawna twierdził, że fraza z wyszukiwarki
// „bywa adresem e-mail albo numerem telefonu", a reguły na telefon tu nie było:
// zmierzone `redactPii("+48 600 123 456") === "+48 600 123 456"`, więc numery
// leżały surowe w `analytics_events.entity_id` i szły do GA4.
//
// MODUŁ JEDZIE TEŻ DO PRZEGLĄDARKI. Od redakcji kopii zdarzeń dla GA4
// (`ga4EventMap.ts`, `ga4Client.ts`) importuje go chunk startowy klienta, więc
// ma zostać czysty: bez importów serwerowych, bez zależności, a wyrażenia
// regularne bez lookbehind (patrz niżej, przy regułach telefonu).

import { redactCredentialPath } from "@/lib/analytics/redactTrackedUrl";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// JSON Web Tokens: three base64url segments separated by dots, first "eyJ".
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
// Credential-bearing query/form parameters: redact the VALUE, keep the key.
const SENSITIVE_PARAM_RE =
  /\b(access_token|refresh_token|id_token|token|api[_-]?key|apikey|key|password|passwd|pwd|secret|client_secret|code|email|auth|session|otp|state)=([^&\s#"']+)/gi;
// Long opaque hex / base64url blobs (>=24 chars) that survive the rules above.
// Tokeny w ŚCIEŻCE (przekazanie biletu, certyfikat, kalendarz) mają 32 znaki,
// więc `LONG_B64` (>= 40) ich nie łapie - dlatego `redactUrl` najpierw maskuje
// znane segmenty sekretu (`redactCredentialPath`, wspólne z analityką).
const LONG_HEX_RE = /\b[0-9a-fA-F]{24,}\b/g;
const LONG_B64_RE = /\b[A-Za-z0-9_-]{40,}\b/g;
// IPv4 dotted-quad: a client/server address echoed into an error message or
// stack. Four decimal groups (semver is three), so false positives are rare.
// IPv6 is intentionally NOT matched here - a naive pattern also eats
// `hh:mm:ss` timestamps that are common in stack traces.
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Telefon w zapisie MIĘDZYNARODOWYM: `+` albo `00` (z niezerową cyfrą kraju za
// nim), potem 8-15 cyfr z separatorami spacja/kropka/myślnik/nawias (najwyżej
// dwa naraz: `) ` w `+1 (555) 123-4567`). Koniec numeru nie może przechodzić
// w literę, cyfrę ani myślnik - inaczej znacznik ciąłby slug w połowie.
//
// BEZ LOOKBEHIND, i to jest warunek, nie styl. Moduł ląduje w chunku startowym
// (`__root` -> stopka -> `track` -> `ga4EventMap`), a `vite.config.ts` nie
// ustawia `build.target`, więc obowiązuje domyślne `modules` z Safari 14.
// Lookbehind działa dopiero od Safari 16.4 - na starszym silniku sama
// ewaluacja modułu rzuca SyntaxError i boot staje. Lewą granicę daje `\b`.
const PHONE_INTL_RE = /(?:\+|\b00(?=[1-9]))\d(?:[ ().-]{0,2}\d){7,14}(?![\w-])/g;
// Telefon KRAJOWY (PL): komórka 3-3-3 (`600123456`, `600 123 456`,
// `600-123-456`; separator spójny dzięki odwołaniu `\1`) i stacjonarny 2-3-2-2
// (`22 123 45 67`, `(22) 123-45-67`). Celowo NIE ogólne „9-15 cyfr z dowolnymi
// separatorami": zmierzone fałszywe trafienia na `2026-10-03 12:30:00` i na
// slugach z liczbami. Świadomy koszt, przypięty testem: liczba 3-3-3 z
// separatorem tysięcy (`1 200 000 000`), `post-123456789` i 9-cyfrowe
// identyfikatory (REGON) też dostają znacznik - moduł z założenia woli zgubić
// wartość, niż wypuścić numer.
const PHONE_NATIONAL_RE =
  /(?:\b\d{3}([ -]?)\d{3}\1\d{3}|\b\d{2}[ -]\d{3}[ -]\d{2}[ -]\d{2}|\(\d{2}\)[ -]?\d{3}[ -]?\d{2}[ -]?\d{2})(?![\w-])/g;
const PHONE_MARK = "[redacted-phone]";
const EMAIL_MARK = "[redacted-email]";

/** Redact PII/secrets from a free-text string (error message, stack, note). */
export function redactPii(input: string | null | undefined): string | null {
  if (input == null) return null;
  let out = String(input);
  if (!out) return out;
  out = out.replace(JWT_RE, "[redacted-jwt]");
  out = out.replace(BEARER_RE, (_m, scheme: string) => `${scheme} [redacted]`);
  out = out.replace(SENSITIVE_PARAM_RE, (_m, key: string) => `${key}=[redacted]`);
  out = out.replace(EMAIL_RE, EMAIL_MARK);
  // KOLEJNOŚĆ JEST NOŚNA. Telefon dopiero po e-mailu i parametrach wrażliwych:
  // `600123456@x.pl` ma zostać JEDNYM znacznikiem e-maila, a `code=600123456`
  // dać `code=[redacted]`. Międzynarodowy przed krajowym - odwrotnie z
  // `+48 600 123 456` zostałoby `+48 [redacted-phone]`, czyli kod kraju.
  // Przed IPv4, bo żadna z reguł telefonu nie dopuszcza kropki między grupami
  // krajowymi, a międzynarodowa wymaga `+`/`00` - adres IP przechodzi dalej.
  out = out.replace(PHONE_INTL_RE, PHONE_MARK);
  out = out.replace(PHONE_NATIONAL_RE, PHONE_MARK);
  out = out.replace(IPV4_RE, "[redacted-ip]");
  out = out.replace(LONG_HEX_RE, "[redacted]");
  out = out.replace(LONG_B64_RE, "[redacted]");
  return out;
}

/**
 * Klucze zapytania, w które trafia tekst wpisany z klawiatury: nasze `q`
 * (`SearchOverlay.tsx`, trasa `/search`) plus domyślne klucze raportu „site
 * search" GA4. LISTA ZAMKNIĘTA: nowy parametr z wolnym tekstem dodany do
 * adresu musi się tu dopisać, inaczej dostanie wyłącznie regułę e-maila.
 */
const FREE_TEXT_QUERY_KEYS = new Set(["q", "query", "s", "search", "keyword"]);
/** Ciąg sekwencji `%XX` - dekodowany w całości, bo tak koduje się znak UTF-8. */
const PERCENT_RUN_RE = /(?:%[0-9A-Fa-f]{2})+/g;
/** E-mail w ścieżce, także z `@` zakodowanym jako `%40`. */
const EMAIL_IN_PATH_RE = /[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Wartość parametru po dekodowaniu formularzowym (`+` to spacja, tak koduje
 * `URLSearchParams`, a więc i router). Zepsuta sekwencja `%XX` zostaje
 * dosłownie, zamiast wywracać całą wartość - `decodeURIComponent` rzuca na
 * pierwszej takiej sekwencji, a wtedy e-mail obok niej przeszedłby nietknięty.
 */
function decodeQueryValue(raw: string): string {
  return raw.replace(/\+/g, " ").replace(PERCENT_RUN_RE, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/** Z powrotem do zapytania; nawiasy znacznika zostają dosłowne (jak `t=[redacted]`). */
function encodeQueryValue(value: string): string {
  return encodeURIComponent(value).replace(/%5B/g, "[").replace(/%5D/g, "]");
}

/** Zredagowana, zakodowana wartość albo `null`, gdy nie było czego zmieniać. */
function scrubQueryValue(raw: string, freeText: boolean): string | null {
  const decoded = decodeQueryValue(raw);
  const clean = freeText ? (redactPii(decoded) ?? "") : decoded.replace(EMAIL_RE, EMAIL_MARK);
  return clean === decoded ? null : encodeQueryValue(clean);
}

/**
 * Adres (ścieżka + zapytanie, opcjonalnie z originem) bez TREŚCI osobowej -
 * dla `page_location` / `page_path` wysyłanych do GA4. Wejście ma już być po
 * `redactTrackedPath` (bez fragmentu, z maską poświadczeń); ta funkcja domyka
 * to, czego tamta z założenia nie widzi: TEKST odwiedzającego w adresie.
 *
 * SKĄD TEN TEKST. Wyszukiwarka zapisuje frazę w adresie (`/search?q=<fraza>`,
 * `SearchOverlay.tsx` i `navigate` na trasie `/search`), a zaproszenie admina
 * prowadzi na `/auth?email=<adres>` (`invitations.functions.ts`). GA4 dostawało
 * jedno i drugie w `page_location`, a przez `gtag("set")` - w KAŻDYM kolejnym
 * zdarzeniu na tej stronie.
 *
 * DLACZEGO DEKODOWANIE. W adresie e-mail ma postać `jan%40example.com`, a
 * telefon `%2B48+600+123+456`; zmierzone: `redactPii` na surowym zapytaniu nie
 * łapie żadnego z nich.
 *
 * DLACZEGO TELEFON TYLKO W KLUCZACH WOLNOTEKSTOWYCH. Reguła telefonu na
 * wszystkich wartościach zamaskowałaby `gad_campaignid=987654321` i zepsuła
 * atrybucję Google Ads. Pozostałe klucze dostają wyłącznie regułę e-maila.
 *
 * DLACZEGO NIE `redactUrl`. Tamten wycina całe zapytanie, a GA4 liczy źródło,
 * medium, kampanię i `gclid` właśnie z `page_location`; do tego `LONG_B64` zjada
 * długie slugi w ścieżce. Tu wartość niezmieniona zostaje CO DO BAJTU (także
 * `utm_*`, `gclid`, `gad_*`), a kodowana od nowa jest tylko ta, która się
 * zmieniła.
 */
export function redactQueryPii(pathWithSearch: string): string {
  const cut = pathWithSearch.indexOf("?");
  const head = (cut === -1 ? pathWithSearch : pathWithSearch.slice(0, cut)).replace(
    EMAIL_IN_PATH_RE,
    EMAIL_MARK,
  );
  if (cut === -1) return head;
  const query = pathWithSearch
    .slice(cut + 1)
    .split("&")
    .map((part) => {
      const eq = part.indexOf("=");
      // Parametr bez `=` (`?jan%40example.com`) to sama wartość - reguła e-maila.
      if (eq === -1) return scrubQueryValue(part, false) ?? part;
      const key = part.slice(0, eq);
      const clean = scrubQueryValue(
        part.slice(eq + 1),
        FREE_TEXT_QUERY_KEYS.has(key.toLowerCase()),
      );
      return clean === null ? part : `${key}=${clean}`;
    })
    .join("&");
  return `${head}?${query}`;
}

/**
 * Redact a URL for storage: keep origin + path (the useful route signal),
 * drop the entire query string and fragment (the usual carriers of tokens,
 * emails and `code` params), then run free-text redaction over the remainder
 * as a backstop. Falls back to plain-text redaction if the value does not
 * parse as a URL.
 */
export function redactUrl(input: string | null | undefined): string | null {
  if (input == null) return null;
  const raw = String(input);
  if (!raw) return raw;
  try {
    // Support both absolute and root-relative URLs.
    const u = new URL(raw, "http://x");
    const hadQuery = u.search.length > 0 || u.hash.length > 0;
    const origin = u.origin === "http://x" ? "" : u.origin;
    const path = `${origin}${redactCredentialPath(u.pathname)}${hadQuery ? "?[redacted]" : ""}`;
    return redactPii(path);
  } catch {
    // Not a URL - strip anything after the first ? or # and redact the rest.
    const cut = raw.split(/[?#]/, 1)[0];
    const redacted = redactPii(redactCredentialPath(cut));
    return raw.length > cut.length ? `${redacted}?[redacted]` : redacted;
  }
}

/** Najgłębszy poziom, który scrubber jeszcze przechodzi. */
const MAX_META_DEPTH = 6;
/** Znacznik poddrzewa uciętego na limicie głębokości. */
const TOO_DEEP = "[redacted-depth]";

/**
 * Deep-scrub a bounded structured-context object (boundary label, component
 * stack, etc.): redact every string value (and key path that is itself a
 * URL/message). Arrays and nested objects are walked; non-strings pass
 * through. Depth-bounded to avoid pathological payloads.
 *
 * PONIŻEJ LIMITU GŁĘBOKOŚCI PODDRZEWO ZNIKA, nie przechodzi surowe. Wcześniej
 * `depth > 6` oddawało resztę struktury NIETKNIĘTĄ - a to jest dokładna
 * odwrotność tego, po co ten limit stoi: ładunek zagnieżdżony głębiej niż
 * siedem poziomów wjeżdżał do tabeli w całości, z adresem, tokenem albo IP
 * włącznie. `safeMeta` w /api/public/track ogranicza tylko ROZMIAR
 * serializacji i zagnieżdżenia nie pilnuje wcale, więc na tej trasie limit
 * był jedyną zaporą - i był otwarty.
 *
 * Napis na granicy nadal przechodzi przez `redactPii` (tanie, a zachowuje
 * tekst bez PII); obiekt albo tablica ustępuje znacznikowi, bo nie ma już jak
 * wejść w środek. Liczby i wartości logiczne zostają - nie ma w nich czego
 * dopasować.
 */
/** Skrub pary klucz-wartość o jeden poziom głębiej. Wydzielony, żeby gałąź
 *  obiektu miała JEDNO miejsce z rzutowaniem, nie dwa. */
function scrubEntries(value: object, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redactMeta(v, depth + 1);
  }
  return out;
}

export function redactMeta<T>(value: T, depth = 0): T {
  // Napis skrubujemy na KAŻDEJ głębokości - to jedyny kształt, w którym PII
  // realnie siedzi, a limit dotyczy schodzenia w strukturę, nie treści.
  if (typeof value === "string") return redactPii(value) as unknown as T;
  const zaGleboko = depth > MAX_META_DEPTH;
  if (Array.isArray(value)) {
    const out = zaGleboko ? TOO_DEEP : value.map((v) => redactMeta(v, depth + 1));
    return out as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: unknown = zaGleboko ? TOO_DEEP : scrubEntries(value, depth);
    return out as unknown as T;
  }
  // Liczba, wartość logiczna, null, undefined - nie ma czego dopasować.
  return value;
}
