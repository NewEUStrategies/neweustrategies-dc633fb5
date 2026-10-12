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
import { clearOutbox, clearStoredToken, countStoredOutbox } from "@/lib/events/scannerStorage";
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
