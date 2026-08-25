// Instalowalność i praca bez sieci aplikacji skanera.
//
// REJESTRACJA W WĘŻSZYM ZASIĘGU. `/scanner-sw.js` leży w katalogu głównym, ale
// rejestrujemy go z `scope: "/scanner"` - dzięki temu nie przejmuje kontroli
// nad resztą serwisu i nie wchodzi w drogę `push-sw.js`, który obsługuje
// powiadomienia w zasięgu całej witryny. Gdy stronę pasują dwa zasięgi,
// przeglądarka wybiera WĘŻSZY, więc /scanner obsługuje ten worker, a każda
// inna strona - tamten.
//
// SERWIS PRACUJE DALEJ, GDY REJESTRACJA SIĘ NIE UDA. Worker jest przyspieszeniem
// (powłoka bez sieci), a nie warunkiem działania: kolejka skanów i tak żyje
// w IndexedDB, a wywołania bramki idą prosto do bazy. Dlatego każdy błąd
// rejestracji kończy się cicho.
//
// PODPOWIEDŹ INSTALACJI JEST ZDARZENIEM, NIE PRZYCISKIEM NA ZAWSZE.
// `beforeinstallprompt` przychodzi tylko wtedy, gdy przeglądarka uzna
// aplikację za instalowalną i jeszcze jej nie zainstalowano - trzymamy je
// i pokazujemy własny przycisk zamiast paska przeglądarki, którego na
// telefonie i tak nikt nie zauważa.

const SW_PATH = "/scanner-sw.js";
const SW_SCOPE = "/scanner";

export function registerScannerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext) return;
  void navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE }).catch(() => {
    /* patrz nagłówek - brak workera nie wyłącza skanera */
  });
}

/** Zdarzenie instalacji nie ma jeszcze typu w lib.dom - stąd własna deklaracja. */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function isInstallPromptEvent(event: Event): event is InstallPromptEvent {
  return "prompt" in event && typeof (event as InstallPromptEvent).prompt === "function";
}
