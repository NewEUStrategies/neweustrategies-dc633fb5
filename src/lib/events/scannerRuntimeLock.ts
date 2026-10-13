// Blokada „skaner pracuje w tej przeglądarce" - wspólna dla kart jednego
// originu (Web Locks API).
//
// PO CO. Sprzątanie resztek skanera pod originem portalu (`scannerRelocation.ts`)
// pyta wyłącznie magazyn, czy coś czeka na wysłanie. Karta skanera otwarta OBOK
// (baner „Przejdź pod nowy adres", bo przy starcie miała niewysłane skany)
// mogła właśnie opróżnić kolejkę - a wtedy start dowolnej innej strony portalu
// kasował token, sesję, listę osób i znacznik POD pracującym skanerem. Skan
// zakolejkowany potem bez sieci był szyfrowany kluczem z tokenu, którego na
// telefonie już nie było, a przeładowanie karty kończyło się ekranem parowania.
//
// JAK. Środowisko skanera (`useScannerRuntime`) trzyma blokadę
// `nes-scanner-runtime` przez cały czas życia karty. Sprzątanie bierze ją
// z `ifAvailable`: gdy trzyma ją inna karta, NIC nie kasuje; gdy ją dostanie,
// trzyma ją do końca kasowania - nowa karta skanera poczeka z blokadą, aż
// kasowanie się skończy.
//
// BEZ WEB LOCKS (Safari przed 15.4) koordynacji między kartami nie ma:
// sprzątanie biegnie jak dotąd, a o niewysłanej pracy decyduje sam magazyn.
// Odmowa samego API (np. dokument w trakcie zamykania) to „nie wiadomo" -
// sprzątanie się nie odbywa.

/** Nazwa blokady - dosłowna, bo musi być ta sama w każdej karcie i wersji. */
export const SCANNER_RUNTIME_LOCK = "nes-scanner-runtime";

function lockManager(): LockManager | null {
  if (typeof navigator === "undefined") return null;
  const locks = (navigator as Navigator & { locks?: LockManager | null }).locks;
  return locks !== undefined && locks !== null && typeof locks.request === "function"
    ? locks
    : null;
}

/**
 * Środowisko skanera trzyma blokadę do wywołania zwróconej funkcji (sprzątanie
 * efektu). Bez Web Locks - nic. Nigdy nie rzuca.
 */
export function holdScannerRuntimeLock(): () => void {
  const locks = lockManager();
  if (locks === null) return () => undefined;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    // Blokada to sygnał dla innych kart, nie warunek pracy skanera - jej
    // odmowa nie może wywrócić bramki.
    void locks.request(SCANNER_RUNTIME_LOCK, () => held).catch(() => undefined);
  } catch {
    /* jw. */
  }
  return () => release();
}

/**
 * `task` pod blokadą skanera - tylko wtedy, gdy ŻADNA karta tego originu jej
 * nie trzyma; blokada trwa do końca `task`. `null` = skaner pracuje w innej
 * karcie albo API odmówiło (`task` nie biegł). Bez Web Locks `task` biegnie od
 * razu (patrz nagłówek).
 */
export async function whenScannerRuntimeIdle<T>(task: () => Promise<T>): Promise<T | null> {
  const locks = lockManager();
  if (locks === null) return task();
  try {
    return await locks.request(SCANNER_RUNTIME_LOCK, { ifAvailable: true }, (lock) =>
      lock === null ? null : task(),
    );
  } catch {
    return null;
  }
}
