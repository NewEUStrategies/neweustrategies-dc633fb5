// Przeniesienie skanera z originu portalu pod jego własny origin (OPS-13).
//
// NIC NIE ZOSTAJE W TYLE. Telefon, który pracował pod originem portalu, może
// mieć tam niewysłane skany albo listę do wyjaśnienia z organizatorem. Przeniesienie
// od razu porzuciłoby je pod originem, którego skaner już nie otworzy - dlatego
// trasa przenosi urządzenie OD RAZU tylko wtedy, gdy pod starym originem nie ma
// niczego do wysłania ani do przekazania (`holdsScannerWork`). W przeciwnym
// razie skaner pracuje tam dalej z banerem i przyciskiem „Przejdź pod nowy
// adres", aż kolejka się opróżni.
//
// PO PRZENIESIENIU POD STARYM ORIGINEM NIE MA NIC. Token (`nes.scanner.device-token`),
// kolejka, lista osób, sesja i listy do wyjaśnienia znikają z originu portalu
// (`purgeScannerData`) - przed przekierowaniem, z czekaniem na zapis na dysk.
// Token jedzie pod nowy origin we FRAGMENCIE (`scannerUrl`), więc urządzenie
// nie wymaga ponownego parowania, a poświadczenie nie trafia do żadnego logu.
//
// RESZTKI POD ORIGINEM PORTALU SPRZĄTA TEŻ START PORTALU. Telefon sparowany
// przed wdrożeniem osobnego originu, który nigdy już nie otworzy `/scanner`
// pod originem portalu, trzymałby tam token na zawsze - obok treści CMS.
// `__root.tsx` (bez wagi na ścieżce bootu: dynamiczny import po bezczynności,
// tylko gdy origin skanera jest skonfigurowany, inny niż bieżący, a token leży
// w `localStorage`) woła `purgeLeftoverScannerData` - ta sama reguła co trasa:
// niewysłane skany albo lista do wyjaśnienia zatrzymują sprzątanie.
import {
  clearOutbox,
  clearStoredToken,
  countStoredOutbox,
  readStoredToken,
} from "@/lib/events/scannerStorage";
import { SCANNER_ORIGIN, scannerRelocationTarget } from "@/lib/events/scannerLink";
import {
  loadConflicts,
  loadRejected,
  wipeAllOfflineData,
} from "@/lib/events/scannerOfflineStorage";

/** Czy pod tym originem leży cokolwiek, czego przeniesienie nie może porzucić. */
export async function holdsScannerWork(): Promise<boolean> {
  const [queued, rejected, conflicts] = await Promise.all([
    countStoredOutbox(),
    loadRejected(),
    loadConflicts(),
  ]);
  return queued > 0 || rejected.length > 0 || conflicts.length > 0;
}

/** Wszystko, co skaner zostawił pod tym originem, znika - token też. */
export async function purgeScannerData(): Promise<void> {
  clearStoredToken();
  await Promise.all([clearOutbox(), wipeAllOfflineData()]);
}

/**
 * Sprzątanie resztek skanera pod originem PORTALU przy starcie dowolnej
 * strony (patrz nagłówek). `true` = token i dane zniknęły; `false` = nie ma
 * czego sprzątać (origin skanera nieskonfigurowany albo jesteśmy pod nim, brak
 * tokenu) albo pod tym originem leży niewysłana praca.
 */
export async function purgeLeftoverScannerData(
  current: string,
  configured: string | null = SCANNER_ORIGIN,
): Promise<boolean> {
  if (scannerRelocationTarget(current, configured) === null) return false;
  if (readStoredToken() === null) return false;
  if (await holdsScannerWork()) return false;
  await purgeScannerData();
  return true;
}
