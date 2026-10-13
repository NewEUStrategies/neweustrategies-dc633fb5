// Uzbrojenie sprzątania resztek skanera pod originem PORTALU (OPS-13) - wołane
// z bootu każdej strony (`__root.tsx`).
//
// OSOBNY MODUŁ, BO `__root.tsx` EKSPORTUJE TYLKO KOMPONENTY. Funkcja i stała
// eksportowane z pliku trasy łamią szybkie odświeżanie (`react-refresh/
// only-export-components`), a test musi je wołać z atrapami. Ten moduł jest
// celowo LEKKI: statycznie importuje wyłącznie harmonogram po załadowaniu
// strony (i tak obecny na ścieżce bootu) - moduł przeniesienia z kolejką
// i IndexedDB przychodzi dynamicznym `import()` dopiero, gdy jest co sprzątać.
import type { createBackgroundScope } from "@/lib/backgroundScope";
import { afterPageLoad } from "@/lib/performance/afterPageLoad";

/**
 * Klucz poświadczenia skanera w `localStorage` - KOPIA `SCANNER_TOKEN_STORAGE_KEY`
 * z `scannerStorage.ts` (import tamtego modułu wciągnąłby kolejkę skanera do
 * zamknięcia bootu). Parytet: `rootRoute.test.tsx`.
 */
export const PORTAL_SCANNER_TOKEN_KEY = "nes.scanner.device-token";

type ScannerRelocationModule = Pick<
  typeof import("@/lib/events/scannerRelocation"),
  "purgeLeftoverScannerData"
>;

/**
 * Resztki skanera pod originem PORTALU (OPS-13). Gdy wdrożenie ma osobny origin
 * skanera (`VITE_SCANNER_ORIGIN`), telefon sparowany wcześniej pod originem
 * portalu może trzymać tu token urządzenia obok treści CMS - także wtedy, gdy
 * nigdy już nie otworzy `/scanner` pod tym adresem (trasa sama przenosi
 * i sprząta). Start KAŻDEJ innej strony sprząta je po bezczynności, jeśli nic
 * nie czeka na wysłanie (`holdsScannerWork`).
 *
 * ZERO WAGI NA ŚCIEŻCE BOOTU. Trzy tanie warunki liczone tutaj - origin
 * skonfigurowany i inny niż bieżący, trasa inna niż `/scanner` (ona ma własną
 * logikę przeniesienia), token w `localStorage` - a moduł przeniesienia (z kolejką
 * i IndexedDB) przychodzi dynamicznym `import()` dopiero po załadowaniu strony
 * i bezczynności (`afterPageLoad`). Zwykły czytelnik bez tokenu nie pobiera
 * ani bajtu skanera.
 *
 * `configured`/`load`/`schedule` - wyłącznie dla testu; domyślnie zmienna
 * środowiska, dosłowne `import()` i harmonogram po załadowaniu strony.
 */
export function armScannerLeftoverPurge(
  background: { run: ReturnType<typeof createBackgroundScope>["run"] },
  configured: string | undefined = import.meta.env.VITE_SCANNER_ORIGIN,
  load: () => Promise<ScannerRelocationModule> = () => import("@/lib/events/scannerRelocation"),
  schedule: (callback: () => void) => () => void = afterPageLoad,
): () => void {
  const target = typeof configured === "string" ? configured.trim().replace(/\/+$/, "") : "";
  const { origin, pathname } = window.location;
  if (target === "" || target === origin) return () => {};
  if (pathname === "/scanner" || pathname.startsWith("/scanner/")) return () => {};
  let stored = false;
  try {
    stored = window.localStorage.getItem(PORTAL_SCANNER_TOKEN_KEY) !== null;
  } catch {
    // Pamięć odcięta polityką przeglądarki - nie ma czego sprzątać.
    stored = false;
  }
  if (!stored) return () => {};
  return schedule(() => {
    void background.run(load(), (m) => {
      void m.purgeLeftoverScannerData(window.location.origin);
    });
  });
}
