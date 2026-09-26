// POMIAR EKSPOZYCJI SPONSORÓW NA STRONIE WYDARZENIA - rdzeń bez Reacta.
//
// CO MIERZYMY. Wyświetlenie (element sponsora widoczny w >= 50% przez >= 1 s
// przy widocznej karcie - to liczy hak `useSponsorImpression`), kliknięcie
// (`click` i środkowy przycisk) i otwarcie materiału. Kolejka zbiera pozycje
// i wysyła je PACZKĄ przez `sendBeacon` na `/api/public/sponsor-event`:
// wyświetlenia w chwili bezczynności przeglądarki (albo przy ukryciu karty
// i opuszczeniu strony - to wiąże dostawca), kliknięcia OD RAZU, bo beacon
// przeżywa nawigację, a zwykłe żądanie urwałoby się z przejściem na stronę
// sponsora.
//
// ZGODA JEST SPRAWDZANA DWA RAZY. Przy dodaniu do kolejki (bez zgody nie ma
// pomiaru) i PRZY WYSYŁCE - użytkownik mógł cofnąć zgodę między jednym
// a drugim, a deklaracja banera (`sponsor_event`, kategoria marketing) mówi,
// że bez zgody nic nie wychodzi. Cofnięta zgoda czyści też identyfikator sesji.
//
// IDENTYFIKATOR SESJI POWSTAJE DOPIERO PO ZGODZIE, w sessionStorage (umiera
// z kartą). Baza dostaje wyłącznie sha256(najemca:wydarzenie:sesja:dzień).
// Zablokowany magazyn (tryb prywatny, polityka przeglądarki) to stan, nie
// awaria: identyfikator żyje wtedy w pamięci do przeładowania strony.
//
// ZALEŻNOŚCI SĄ WSTRZYKIWANE (`SponsorTrackerDeps`), bo zgoda, beacon, zegar
// bezczynności i magazyn to cztery granice przeglądarki - testy podmieniają je
// wprost, zamiast udawać cały `window`.
import { hasCategoryConsent } from "@/lib/ads/consent";
import { whenIdle, type CancelIdle } from "@/lib/ads/idle";
import { sendBeaconPayload } from "@/lib/observability/report";
import { SPONSOR_SESSION_STORAGE_KEY } from "@/lib/storageKeys";
import {
  SPONSOR_BATCH_MAX,
  SPONSOR_EVENT_ENDPOINT,
  SPONSOR_SESSION_PATTERN,
  exposureToWire,
  isAcceptableExposure,
  type SponsorExposureItem,
} from "@/lib/events/sponsorExposure";

export interface SponsorTrackerDeps {
  hasConsent: () => boolean;
  send: (endpoint: string, payload: unknown) => boolean;
  schedule: (run: () => void) => CancelIdle;
  /** Magazyn sesji; `null` albo wyjątek = brak magazynu. */
  storage: () => Storage | null;
  /** Nowy identyfikator sesji (32 znaki szesnastkowe). */
  randomId: () => string;
}

export const defaultSponsorTrackerDeps: SponsorTrackerDeps = {
  hasConsent: () => hasCategoryConsent("marketing"),
  send: sendBeaconPayload,
  schedule: (run) => whenIdle(run),
  storage: () => window.sessionStorage,
  randomId: () => crypto.randomUUID().replace(/-/g, ""),
};

const SESSION_KEY = SPONSOR_SESSION_STORAGE_KEY.key;

function storageOf(deps: SponsorTrackerDeps): Storage | null {
  try {
    return deps.storage();
  } catch {
    return null;
  }
}

/** Istniejący identyfikator sesji albo nowy (zapisany, gdy się da). */
export function readOrCreateSponsorSession(deps: SponsorTrackerDeps): string {
  const storage = storageOf(deps);
  try {
    const existing = storage?.getItem(SESSION_KEY) ?? null;
    if (existing !== null && SPONSOR_SESSION_PATTERN.test(existing)) return existing;
  } catch {
    // Odczyt zablokowany - identyfikator zostaje w pamięci.
  }
  const fresh = deps.randomId();
  try {
    storage?.setItem(SESSION_KEY, fresh);
  } catch {
    // Zapis zablokowany - identyfikator zostaje w pamięci.
  }
  return fresh;
}

/** Usuwa identyfikator sesji (zgoda cofnięta). Nigdy nie rzuca. */
export function clearSponsorSession(deps: SponsorTrackerDeps): void {
  try {
    storageOf(deps)?.removeItem(SESSION_KEY);
  } catch {
    // Brak magazynu - nie ma czego czyścić.
  }
}

export interface SponsorTracker {
  /** Dodaje ekspozycję do kolejki (bez zgody - nic). */
  track: (item: SponsorExposureItem) => void;
  /** Wysyła kolejkę teraz (ukrycie karty, opuszczenie strony, kliknięcie). */
  flush: () => void;
  /** Ostatnia wysyłka i koniec przyjmowania pozycji. */
  dispose: () => void;
}

export function createSponsorTracker(
  eventSlug: string,
  deps: SponsorTrackerDeps = defaultSponsorTrackerDeps,
): SponsorTracker {
  let queue: SponsorExposureItem[] = [];
  let cancel: CancelIdle | null = null;
  let session: string | null = null;
  let disposed = false;

  function flush(): void {
    if (cancel !== null) {
      cancel();
      cancel = null;
    }
    if (queue.length === 0) return;
    const items = queue;
    queue = [];
    if (!deps.hasConsent()) {
      session = null;
      clearSponsorSession(deps);
      return;
    }
    session ??= readOrCreateSponsorSession(deps);
    for (let start = 0; start < items.length; start += SPONSOR_BATCH_MAX) {
      deps.send(SPONSOR_EVENT_ENDPOINT, {
        event_slug: eventSlug,
        session,
        items: items.slice(start, start + SPONSOR_BATCH_MAX).map(exposureToWire),
      });
    }
  }

  function track(item: SponsorExposureItem): void {
    if (disposed || !isAcceptableExposure(item) || !deps.hasConsent()) return;
    queue.push(item);
    if (item.kind !== "view") {
      flush();
      return;
    }
    cancel ??= deps.schedule(flush);
  }

  function dispose(): void {
    flush();
    disposed = true;
  }

  return { track, flush, dispose };
}
