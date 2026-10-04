// Wiedza o sesji Supabase dostępna BEZ klienta Supabase (P1.7, fala 1).
//
// PO CO OSOBNY MODUŁ. Trzy miejsca potrzebują odpowiedzi „czy ta karta może
// mieć sesję" zanim (albo zamiast tego, żeby) ktokolwiek utworzy klienta SDK:
//   * `AuthProvider` (`hooks/useAuth.tsx`) - szybka ścieżka gościa: pusty
//     magazyn i adres bez parametrów auth = pewny gość, bez jednego dotknięcia
//     `supabase` (bez inicjalizacji GoTrue, bez `getSession()`);
//   * wyspy hydratacji P2.2/P2.3 - `immediateWhen: hasStoredAuthSession`
//     (zalogowany dostaje wyspy od razu, bo jego kontekst sesji i tak się
//     zmieni);
//   * skrypt startowy P2.1 w `<head>` - `STORED_SESSION_EXPR` jako fragment
//     TEKSTU skryptu inline (tryb `immediate` dla zalogowanych).
// Moduł nie importuje SDK ani Reacta, więc żadne z tych miejsc nie ciągnie
// przez niego `@supabase/supabase-js` ani modułu komponentu (eksport funkcji
// z `useAuth.tsx` psułby fast refresh: `react-refresh/only-export-components`).
// Leży obok klienta (`client.ts`, `previewAuthStorage.ts`), bo opisuje format
// JEGO magazynu: klucz `sb-<projekt>-auth-token` i broker sesji w ramce.
//
// REJESTR UTWORZENIA KLIENTA (`onSupabaseClientCreated`) mieszka tu, a nie
// w `client.ts`, z tego samego powodu: `useAuth.tsx` zapisuje się do niego
// bez importu SDK, a testy, które podmieniają `@/integrations/supabase/client`
// atrapą, nie gubią rejestru (vitest rzuca przy odczycie eksportu, którego
// atrapa nie zna). `client.ts` zgłasza utworzenie i reeksportuje zapis - to
// jest publiczne API z planu.

/**
 * Klucze, pod którymi klient Supabase trzyma sesję w `localStorage`:
 * `sb-<subdomena projektu>-auth-token` (`defaultStorageKey`
 * w `@supabase/supabase-js`), wariant dzielony na części (`...-auth-token.0`)
 * oraz historyczne `supabase.auth.token`. Ten sam wzorzec zna rejestr
 * ciasteczek (`lib/cookieBanner/registry.ts`).
 */
export const STORED_SESSION_KEY_RE = /^(?:sb-.+-auth-token(?:\.\d+)?|supabase\.auth\.token)$/;

/**
 * Czy w przeglądarce LEŻY zapisana sesja - rozstrzygane synchronicznie, bez
 * sieci i bez `getSession()`.
 *
 * PO CO. „Brak sesji" jest wiedzą LOKALNĄ: sesja Supabase mieszka w
 * `localStorage` (`persistSession: true` w `integrations/supabase/client.ts`),
 * nie w ciasteczku, więc pusty magazyn to PEWNE „to gość" - bez jednego bajtu
 * ruchu i bez czekania na klienta Supabase. Dopiero zapisana sesja wymaga
 * czekania, bo może być przeterminowana i wymagać odświeżenia w sieci.
 *
 * Na serwerze zwraca `false`. `AuthProvider` NIE zasiewa z tego wartości
 * kontekstu: serwer renderuje „nie wiemy" (`loading === true`), a pierwszy
 * render klienta musi wyjść identycznie - gość dostaje rozstrzygnięcie przez
 * warstwę per konsument w `useAuth()` (patrz `hooks/useAuth.tsx`).
 *
 * W RAMCE POŚREDNIKA (podgląd Lovable) magazynem nie jest `localStorage`, tylko
 * broker `postMessage` do edytora (`previewAuthStorage.ts`) - pusty
 * `localStorage` nie znaczy tam „brak sesji", więc w ramce odpowiedź brzmi
 * „może być" i wracamy do czekania na `getSession()`.
 */
export function hasStoredAuthSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.parent && window.parent !== window) return true;
    const store = window.localStorage;
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && STORED_SESSION_KEY_RE.test(key) && store.getItem(key)) return true;
    }
  } catch {
    // Zablokowany magazyn (tryb prywatny, zablokowane ciasteczka): klient
    // Supabase odczyta z niego dokładnie tyle samo, co my - nic.
  }
  return false;
}

/**
 * `hasStoredAuthSession()` jako WYRAŻENIE JavaScriptu (ES5) do wklejenia
 * w skrypt inline, np. `if (${STORED_SESSION_EXPR}) boot("immediate")`
 * w skrypcie startowym P2.1. Wartość: `true`/`false`, ta sama co funkcja
 * (test parytetu w `__tests__/sessionHint.test.ts`).
 *
 * STAŁA MODUŁU, BEZ DANYCH: sam literał, bez żadnej wstawki - także wzorzec
 * klucza jest przepisany dosłownie (test pilnuje, że to `STORED_SESSION_KEY_RE`
 * znak w znak). Czysty literał bundler usuwa z paczek, które go nie używają
 * (klient importuje ten moduł dla funkcji). Tekst nie zawiera `</`,
 * cudzysłowów ani ukośnika poza ogranicznikami wzorca, więc wklejony
 * w `<script>` nie domyka znacznika ani napisu wokół siebie (test pilnuje).
 */
export const STORED_SESSION_EXPR =
  "(function(){try{if(window.parent&&window.parent!==window)return true;" +
  "var s=window.localStorage,i=0,k;for(;i<s.length;i++){k=s.key(i);" +
  "if(k&&/^(?:sb-.+-auth-token(?:\\.\\d+)?|supabase\\.auth\\.token)$/.test(k)&&s.getItem(k))return true}" +
  "}catch(e){}return false})()";

/**
 * Parametry adresu, z którymi SDK MUSI wystartować od razu: powrót z linku
 * magicznego, OAuth, odzyskiwania hasła i potwierdzenia e-maila. Przepływ
 * niejawny (domyślny w tym repo) niesie tokeny w `#access_token=...&type=...`,
 * PKCE w `?code=`, a błąd dostawcy w `error_description`. `detectSessionInUrl`
 * klienta wymienia je na sesję dopiero przy jego utworzeniu - więc taki adres
 * nigdy nie idzie szybką ścieżką gościa.
 *
 * Nazwa parametru musi stać na granicy (`?`, `#`, `&`), żeby `?promo_code=`
 * nie udawało `code=`. `token_hash` i typy `signup|invite|email_change` są
 * nadmiarem względem planu (bezpieczny kierunek: SDK od razu).
 */
const AUTH_URL_PARAM_RE =
  /(?:^|[?#&])(?:code|access_token|refresh_token|error_description|token_hash)=|(?:^|[?#&])type=(?:recovery|magiclink|signup|invite|email_change)(?:&|$)/;

/** Fragment adresu czytany przez `urlHasAuthParams` (podzbiór `Location`). */
export interface AuthUrlParts {
  readonly search?: string | null;
  readonly hash?: string | null;
}

/**
 * Czy adres niesie parametry przepływu auth (patrz `AUTH_URL_PARAM_RE`).
 * Bez `window` (serwer) - `false`.
 */
export function urlHasAuthParams(location?: AuthUrlParts): boolean {
  const parts: AuthUrlParts | undefined =
    location ?? (typeof window === "undefined" ? undefined : window.location);
  if (!parts) return false;
  return AUTH_URL_PARAM_RE.test(parts.search ?? "") || AUTH_URL_PARAM_RE.test(parts.hash ?? "");
}

// ── REJESTR UTWORZENIA KLIENTA ──────────────────────────────────────────────

type ClientCreatedListener = () => void;

let clientCreated = false;
const createdListeners = new Set<ClientCreatedListener>();

function runListener(listener: ClientCreatedListener): void {
  try {
    listener();
  } catch (error) {
    // Słuchacz nie może przerwać dostępu, który utworzył klienta (zwykle
    // zapytania o dane) - błąd zgłaszamy głośno i idziemy dalej.
    console.error("[supabase] słuchacz utworzenia klienta rzucił wyjątek", error);
  }
}

/**
 * Wywołuje `listener` w chwili utworzenia klienta Supabase - przez
 * KOGOKOLWIEK (zapytanie o dane, formularz logowania, nasłuch `storage`).
 * Gdy klient już istnieje, słuchacz biegnie od razu (synchronicznie).
 * Słuchacz biegnie raz, PO przypisaniu klienta i PRZED zwrotem dostępu, który
 * go utworzył - więc `supabase.auth.onAuthStateChange(...)` w słuchaczu
 * zdąży przed pierwszym zdarzeniem SDK (`INITIAL_SESSION`, `SIGNED_IN`).
 * Zwraca funkcję wypisania (bez skutku po wywołaniu słuchacza).
 */
export function onSupabaseClientCreated(listener: ClientCreatedListener): () => void {
  if (clientCreated) {
    runListener(listener);
    return () => {};
  }
  createdListeners.add(listener);
  return () => {
    createdListeners.delete(listener);
  };
}

/** Zgłoszenie z `client.ts`: klient właśnie powstał (idempotentne). */
export function markSupabaseClientCreated(): void {
  if (clientCreated) return;
  clientCreated = true;
  const pending = [...createdListeners];
  createdListeners.clear();
  for (const listener of pending) runListener(listener);
}

/** Tylko testy: stan „klienta jeszcze nie ma", bez słuchaczy. */
export function __resetSupabaseClientRegistryForTests(): void {
  clientCreated = false;
  createdListeners.clear();
}
