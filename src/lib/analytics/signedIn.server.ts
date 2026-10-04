// Flaga „zalogowany" dla ingestu analityki - JEDYNA informacja o koncie, jaką
// `analytics_events` przechowuje.
//
// PO CO FLAGA, A NIE IDENTYFIKATOR. Pulpit chce wiedzieć, ilu z ruchu to nasi
// ludzie (`members`, `activeMembers`), a nie KTO dokładnie czytał który adres.
// Wiersz zdarzenia niesie już ścieżkę, referrer i niewygasający `anon_id`;
// dołożenie do niego identyfikatora konta zamieniłoby statystykę w dziennik
// lektury konkretnej osoby, a uzasadnienie wyłączenia tabeli z eksportu RODO
// („zdarzenia analityczne bez identyfikatora konta",
// exportManifestParity.gate.test.ts) przestałoby być prawdą. Jeden bit
// wystarcza do policzenia sesji zalogowanych i do niczego więcej.
//
// FLAGA JEST WYPROWADZANA Z ZWERYFIKOWANEGO TOKENU, nigdy z treści żądania.
// Klient wysyła bearer w nagłówku (src/lib/analytics/track.ts: keepalive
// `fetch` zamiast `sendBeacon`, który nagłówków nie umie), a podpis sprawdza
// `optionalUserIdFromRequest` (`getClaims`). Podrobiony albo przeterminowany
// token daje `false` - tak samo jak jego brak.
//
// PAMIĘĆ PER IZOLAT, BO WERYFIKACJA BYWA ROUND-TRIPEM. `getClaims` przy kluczu
// asymetrycznym sprawdza podpis lokalnie (JWKS), ale przy tokenie HS woła
// `getUser()` przez sieć - a zalogowana karta wysyła partię co 5 s. Pamięć
// trzyma WYŁĄCZNIE werdykt (bit), nigdy `sub`: identyfikator konta nie ma
// dokąd wyciec, bo nigdzie go nie zapisujemy. Kluczem jest SHA-256 tokenu, nie
// token - zrzut pamięci izolatu nie oddaje ważnych poświadczeń.
//
// Werdykt NEGATYWNY też jest pamiętany: bez tego zalew podrobionymi bearerami
// (endpoint jest publiczny) kosztowałby jeden round-trip do Auth na partię.
// Limiter trasy ogranicza żądania, nie tokeny - każdy może nieść inny.
//
// Pamięć NIE siedzi w `optionalUserIdFromRequest`: tamta funkcja służy
// darowiznom i kontekstowi sesji, gdzie świeży werdykt jest częścią kontraktu
// (sessionContext.test.ts oczekuje dwóch wywołań `getClaims` dla tego samego
// tokenu). Tu stawka to jedna kolumna statystyki, więc pięciominutowe
// opóźnienie po wylogowaniu jest akceptowalne; tam - nie.
//
// Kontrakt: NIGDY nie rzuca. Awaria weryfikacji to `false`, a nie błąd ingestu
// - beacon ma się zapisać, najwyżej jako anonimowy.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { fromBase64Url } from "@/lib/http/tenantAssertion";
import {
  optionalBearerFromRequest,
  optionalUserIdFromRequest,
} from "@/lib/auth/optionalUser.server";

/** Górna granica życia werdyktu - także pozytywnego, także dla tokenu ważnego dłużej. */
export const SIGNED_IN_VERDICT_TTL_MS = 5 * 60 * 1000;
/** Twardy limit wpisów; po jego osiągnięciu pamięć jest czyszczona w całości. */
export const SIGNED_IN_VERDICT_CACHE_LIMIT = 512;

const verdictCache = new Map<string, { expiresAt: number; signedIn: boolean }>();

const textDecoder = new TextDecoder();

function tokenKey(token: string): string {
  return bytesToHex(sha256(utf8ToBytes(token)));
}

/**
 * `exp` tokenu w milisekundach albo `null`. Odczyt BEZ weryfikacji podpisu -
 * dlatego wolno go użyć wyłącznie do SKRÓCENIA życia werdyktu pozytywnego,
 * którego podpis `getClaims` sprawdził chwilę wcześniej. Wydłużyć nie może
 * niczego: wynik i tak jest przycinany do `SIGNED_IN_VERDICT_TTL_MS`.
 */
function tokenExpiryMs(token: string): number | null {
  const segment = token.split(".")[1];
  if (!segment) return null;
  const bytes = fromBase64Url(segment);
  if (!bytes) return null;
  try {
    const payload = JSON.parse(textDecoder.decode(bytes)) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

/**
 * Weryfikacja podpisu. `optionalUserIdFromRequest` czyta TEN SAM nagłówek
 * bieżącego żądania co `optionalBearerFromRequest`, więc sprawdzany jest
 * dokładnie ten token, którego skrót staje się kluczem pamięci. Z wyniku
 * zostaje wyłącznie bit - `sub` umiera w tej funkcji.
 */
async function verify(): Promise<boolean> {
  try {
    return (await optionalUserIdFromRequest()) !== null;
  } catch {
    // `optionalUserIdFromRequest` sam nie rzuca - to pas bezpieczeństwa na
    // wypadek zmiany jego kontraktu, nie obsługa znanego przypadku.
    return false;
  }
}

/**
 * Czy bieżące żądanie niesie ZWERYFIKOWANY bearer zalogowanego użytkownika.
 * Brak nagłówka = `false` bez żadnej weryfikacji (droga anonimowego beaconu
 * nie dotyka Auth). Nigdy nie rzuca.
 */
export async function signedInFromRequest(): Promise<boolean> {
  try {
    const token = await optionalBearerFromRequest();
    if (!token) return false;

    const now = Date.now();
    const key = tokenKey(token);
    const cached = verdictCache.get(key);
    if (cached && cached.expiresAt > now) return cached.signedIn;

    const signedIn = await verify();
    let expiresAt = now + SIGNED_IN_VERDICT_TTL_MS;
    if (signedIn) {
      // Token wygasa wcześniej niż nasz TTL - werdykt nie może go przeżyć,
      // bo po `exp` ten sam bearer jest już anonimem.
      const exp = tokenExpiryMs(token);
      if (exp !== null) expiresAt = Math.min(expiresAt, exp);
    }
    if (expiresAt > now) {
      if (verdictCache.size >= SIGNED_IN_VERDICT_CACHE_LIMIT) verdictCache.clear();
      verdictCache.set(key, { expiresAt, signedIn });
    }
    return signedIn;
  } catch {
    return false;
  }
}

/** Hook testowy: czyści pamięć werdyktów per izolat. */
export function resetSignedInVerdictCacheForTests(): void {
  verdictCache.clear();
}
