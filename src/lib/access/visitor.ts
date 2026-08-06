// Pseudonimowa tożsamość gościa dla warstwy dostępu.
//
// Jedno źródło prawdy dla DWÓCH mechanik, które muszą rozpoznać "to ta sama
// przeglądarka", zanim pojawi się konto:
//   * metering ("N darmowych artykułów / miesiąc") - miękki licznik anonimów,
//   * budżet kliknięć linku "Udostępnij pełny artykuł" - dedup odbiorcy, żeby
//     odświeżenie strony nie paliło kolejnego z 5 slotów.
//
// To NIE jest identyfikator osoby: losowy uuid trzymany w localStorage tej
// przeglądarki, bez powiązania z tożsamością, kasowalny razem ze storage.
// Twardą walutą obu mechanik pozostaje serwer (RPC SECURITY DEFINER) - klucz
// gościa jedynie zawęża konsumpcję, nigdy jej nie autoryzuje.
const VISITOR_STORAGE_KEY = "nes:metering:visitor";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Trwały uuid per przeglądarka. SSR zwraca null (konsumpcja i tak startuje po
 * hydracji), tak samo tryb prywatny z zablokowanym storage - wtedy mechaniki
 * degradują się bezpiecznie: metering pokazuje ścianę rejestracji, a budżet
 * kliknięć liczy każde wejście osobno.
 */
export function getVisitorId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    if (existing && UUID_RE.test(existing)) return existing;
    const fresh = window.crypto.randomUUID();
    window.localStorage.setItem(VISITOR_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return null;
  }
}
