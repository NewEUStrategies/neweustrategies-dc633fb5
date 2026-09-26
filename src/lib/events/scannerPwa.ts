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

/* ------------------------------------------------ gotowość do pracy offline --- */
//
// PIERWSZA WIZYTA NIE ROZGRZEWA CACHE SAMA. Zasoby pobrane zanim worker przejął
// stronę (a przejmuje ją dopiero po aktywacji) nie trafiają do cache - bez
// rozgrzania skaner wstaje bez sieci dopiero po DRUGIEJ wizycie z zasięgiem.
// Dlatego po sparowaniu strona podaje workerowi listę zasobów, które już
// pobrała (`performance`), a worker dociąga je do cache i odpowiada, ile ma.

/** Zasób, który worker skanera zgodzi się rozgrzać: to samo źródło, powłoka i budowanie. */
export function isScannerPrecacheUrl(url: URL, origin: string): boolean {
  if (url.origin !== origin) return false;
  if (url.pathname === "/scanner") return true;
  return (
    url.pathname.startsWith("/_build/") ||
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/scanner/")
  );
}

/** Lista do rozgrzania: powłoka + zasoby pobrane przez stronę, bez powtórzeń. */
export function precacheCandidates(entryNames: readonly string[], origin: string): string[] {
  const out = new Set<string>([`${origin}/scanner`]);
  for (const name of entryNames) {
    let url: URL;
    try {
      url = new URL(name);
    } catch {
      continue;
    }
    if (isScannerPrecacheUrl(url, origin)) out.add(url.href);
  }
  return [...out];
}

export interface PrecacheReport {
  cached: number;
  total: number;
}

function isPrecacheReport(value: unknown): value is PrecacheReport & { type: string } {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    row.type === "precache-done" && typeof row.cached === "number" && typeof row.total === "number"
  );
}

/**
 * Prosi aktywnego workera o rozgrzanie cache. `null` = brak workera, brak
 * odpowiedzi w terminie albo przeglądarka bez Service Workera - ekran mówi
 * wtedy „powłoka nie jest gotowa do pracy bez sieci".
 */
export async function requestScannerPrecache(timeoutMs = 10_000): Promise<PrecacheReport | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]).catch(() => null);
  const worker = registration?.active ?? null;
  if (worker === null) return null;

  const names = performance.getEntriesByType("resource").map((entry) => entry.name);
  const urls = precacheCandidates(names, window.location.origin);
  return new Promise<PrecacheReport | null>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent) => {
      if (!isPrecacheReport(event.data)) return;
      clearTimeout(timer);
      resolve({ cached: event.data.cached, total: event.data.total });
    };
    worker.postMessage({ type: "precache", urls }, [channel.port2]);
  });
}

/**
 * Trwałe przechowywanie (`navigator.storage`). Bez niego przeglądarka może
 * przy braku miejsca wyczyścić IndexedDB - razem z kolejką skanów i listą.
 * `null` = przeglądarka nie zna tego API.
 */
export async function storagePersisted(): Promise<boolean | null> {
  if (typeof navigator === "undefined" || navigator.storage?.persisted === undefined) return null;
  try {
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}

/** Prośba o trwałe przechowywanie - na gest operatora (przycisk na karcie gotowości). */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (typeof navigator === "undefined" || navigator.storage?.persist === undefined) return null;
  try {
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
