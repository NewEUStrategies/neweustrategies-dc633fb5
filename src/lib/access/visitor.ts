// Pseudonimowa tożsamość gościa dla budżetu kliknięć linku "Udostępnij pełny
// artykuł" - dedup odbiorcy, żeby odświeżenie strony nie paliło kolejnego
// z 5 slotów. Tu klucz z klienta jest bezpieczny: może wyłącznie ZAWĘZIĆ
// konsumpcję (nowy uuid = nowy odbiorca = kolejny slot z budżetu linku), nigdy
// dodać darmowego dostępu.
//
// METERING ("N darmowych artykułów / miesiąc") Z TEGO KLUCZA JUŻ NIE KORZYSTA
// (audyt billingowy SUB-17): tam nowy uuid oznaczał nowy, pusty licznik, czyli
// nieograniczony dostęp. Gościa meteringu identyfikuje serwer - cookie
// HttpOnly z podpisem HMAC (`src/lib/access/visitorToken.ts`,
// `src/lib/access/meteringVisitor.server.ts`).
//
// To NIE jest identyfikator osoby: losowy uuid trzymany w localStorage tej
// przeglądarki, bez powiązania z tożsamością, kasowalny razem ze storage.
// Nazwa klucza zostaje historyczna, żeby powracający odbiorcy linków nie
// dostali nowej tożsamości (i nie spalili kolejnego slotu) po wdrożeniu.
const VISITOR_STORAGE_KEY = "nes:metering:visitor";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `crypto.randomUUID` istnieje tylko w bezpiecznym kontekście (HTTPS/localhost)
// i od Safari 15.4 - bez niego gość dostawał null, czyli paywall zamiast
// darmowej puli anonima. `getRandomValues` daje te same 122 bity losowości
// (uuid v4) wszędzie indziej.
function randomUuid(source: Crypto): string {
  if (typeof source.randomUUID === "function") return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Trwały uuid per przeglądarka. SSR zwraca null (konsumpcja i tak startuje po
 * hydracji), tak samo tryb prywatny z zablokowanym storage - wtedy budżet
 * kliknięć degraduje się bezpiecznie i liczy każde wejście osobno.
 */
export function getVisitorId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    if (existing && UUID_RE.test(existing)) return existing;
    const fresh = randomUuid(window.crypto);
    window.localStorage.setItem(VISITOR_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return null;
  }
}
