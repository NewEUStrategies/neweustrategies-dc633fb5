// Logika strony zgody OAuth (`/.lovable/oauth/consent`) - czyste funkcje,
// testowane bez przeglądarki.
//
// Serwer autoryzacji Lovable Cloud wydaje tokeny, a aplikacja tylko pyta
// zalogowanego użytkownika o zgodę: pobiera szczegóły żądania po
// `authorization_id`, pokazuje klienta i zakresy, a po decyzji przekierowuje
// na adres zwrócony przez serwer autoryzacji.
import type { OAuthAuthorizationDetails, OAuthRedirect } from "@supabase/supabase-js";

/** Identyfikator żądania autoryzacji: UUID wydany przez serwer autoryzacji. */
const AUTHORIZATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OAUTH_CONSENT_PATH = "/.lovable/oauth/consent";

export interface ConsentSearch {
  authorization_id: string;
}

/** Walidacja `?authorization_id` - kształt, nie poprawność (tę sprawdza serwer). */
export function parseConsentSearch(search: Record<string, unknown>): ConsentSearch {
  const raw = search.authorization_id;
  return {
    authorization_id:
      typeof raw === "string" && AUTHORIZATION_ID.test(raw.trim()) ? raw.trim() : "",
  };
}

/** Pełny adres strony zgody - cel powrotu po zalogowaniu (`/login?next=`). */
export function consentReturnPath(authorizationId: string): string {
  return `${OAUTH_CONSENT_PATH}?authorization_id=${encodeURIComponent(authorizationId)}`;
}

/** Szczegóły wymagają decyzji użytkownika (w przeciwieństwie do gotowego przekierowania). */
export function needsConsent(
  data: OAuthAuthorizationDetails | OAuthRedirect,
): data is OAuthAuthorizationDetails {
  return "authorization_id" in data;
}

/** Schematy, które w `location.assign` wykonują kod albo czytają lokalne zasoby. */
const UNSAFE_SCHEMES: ReadonlySet<string> = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "file:",
  "blob:",
  "about:",
  "filesystem:",
]);

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * Adres powrotu do klienta OAuth (z odpowiedzi serwera autoryzacji, który
 * sprawdził go z zarejestrowanymi adresami klienta). Dozwolone: `https:`,
 * `http:` wyłącznie na pętli zwrotnej (klienci CLI) i własne schematy
 * aplikacji natywnych (RFC 8252, np. edytory kodu). Odrzucane: schematy
 * wykonujące kod (`javascript:`, `data:`) i `http:` do sieci.
 */
export function safeClientRedirect(raw: string | null | undefined): string | null {
  const url = parseUrl(raw);
  if (!url || UNSAFE_SCHEMES.has(url.protocol)) return null;
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname) ? url.href : null;
  return url.href;
}

/** Logo klienta - tylko `https:`, żeby strona zgody nie ładowała treści mieszanej. */
export function safeLogoUri(raw: string | null | undefined): string | null {
  const url = parseUrl(raw);
  return url?.protocol === "https:" ? url.href : null;
}

export type ScopeKey = "openid" | "email" | "profile" | "phone";

const KNOWN_SCOPES: readonly ScopeKey[] = ["openid", "email", "profile", "phone"];

function isKnownScope(value: string): value is ScopeKey {
  return (KNOWN_SCOPES as readonly string[]).includes(value);
}

/** Zakresy żądania: znane (z etykietą) i pozostałe (pokazywane dosłownie). */
export function describeScopes(scope: string): { known: ScopeKey[]; other: string[] } {
  const known: ScopeKey[] = [];
  const other: string[] = [];
  for (const item of scope.split(/\s+/)) {
    if (!item) continue;
    if (isKnownScope(item)) {
      if (!known.includes(item)) known.push(item);
    } else if (!other.includes(item)) {
      other.push(item);
    }
  }
  return { known, other };
}

/** Domena adresu zwrotnego klienta - czytelna informacja, dokąd wróci użytkownik. */
export function redirectHost(redirectUri: string): string | null {
  try {
    return new URL(redirectUri).host || null;
  } catch {
    return null;
  }
}
