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
// że bez zgody nic nie wychodzi. Cofnięta zgoda czyści też sesję i kolejkę -
// od razu, w chwili zmiany zgody (`onConsentChange` -> `syncConsent`), a nie
// dopiero przy następnej wysyłce, której może nie być.
//
// SESJĘ WYDAJE SERWER (OPS-09). Przeglądarka nie wymyśla identyfikatora - taki
// identyfikator skrypt rotował przy każdym beaconie i nabijał sponsorowi
// „unikalne" wyświetlenia. Pierwsza paczka (dopiero po zgodzie) idzie BEZ
// sesji przez `exchange` - `fetch` z `keepalive`, który czyta odpowiedź - a
// serwer odpowiada podpisaną sesją (`{ session }`, HMAC kluczem najemcy).
// Kolejne paczki niosą ją beaconem. Sesja żyje w sessionStorage (umiera
// z kartą); baza dostaje wyłącznie sha256(najemca:wydarzenie:sesja:dzień).
// Zablokowany magazyn (tryb prywatny, polityka przeglądarki) to stan, nie
// awaria: sesja żyje wtedy w pamięci do przeładowania strony.
//
// UŚCISK DŁONI W LOCIE. Pozycje, które przyjdą w tym czasie, CZEKAJĄ na sesję
// (inaczej każda wysyłka bez sesji założyłaby nową). Wyjątek: wysyłka pilna
// (ukrycie karty, opuszczenie strony, odmontowanie) - wtedy czekanie znaczy
// utratę, więc paczka idzie beaconem bez sesji, a serwer zalicza ją do nowej
// sesji. Nieudany uścisk niczego nie ponawia w pętli: następną próbę wyzwala
// dopiero kolejna pozycja albo wysyłka pilna.
//
// ZALEŻNOŚCI SĄ WSTRZYKIWANE (`SponsorTrackerDeps`), bo zgoda, beacon,
// wymiana z odpowiedzią, zegar bezczynności i magazyn to granice przeglądarki
// - testy podmieniają je wprost, zamiast udawać cały `window`.
import { hasCategoryConsent, subscribeConsentChange } from "@/lib/ads/consent";
import { whenIdle, type CancelIdle } from "@/lib/ads/idle";
import { sendBeaconPayload } from "@/lib/observability/report";
import { SPONSOR_SESSION_STORAGE_KEY } from "@/lib/storageKeys";
import {
  SPONSOR_BATCH_MAX,
  SPONSOR_EVENT_ENDPOINT,
  SPONSOR_SESSION_TOKEN_PATTERN,
  exposureToWire,
  isAcceptableExposure,
  issuedSponsorSession,
  type SponsorExposureItem,
} from "@/lib/events/sponsorExposure";

export interface SponsorTrackerDeps {
  hasConsent: () => boolean;
  /** Beacon: wysyłka bez odczytu odpowiedzi (przeżywa nawigację). */
  send: (endpoint: string, payload: unknown) => boolean;
  /**
   * Wysyłka Z ODCZYTEM odpowiedzi - paczka bez sesji, na którą serwer odpowiada
   * podpisaną sesją. Sesja albo `null` (brak, awaria, zły kształt); nie odrzuca.
   */
  exchange: (endpoint: string, payload: unknown) => Promise<string | null>;
  schedule: (run: () => void) => CancelIdle;
  /** Magazyn sesji; `null` albo wyjątek = brak magazynu. */
  storage: () => Storage | null;
  /** Nasłuch zmiany zgody; zwraca wyrejestrowanie. Brak = bez nasłuchu. */
  onConsentChange?: (listener: () => void) => () => void;
}

/**
 * Domyślna wymiana: POST z `keepalive` (przeżywa nawigację jak beacon), ta
 * sama strona, odpowiedź 200 `{ session }` albo 204 bez treści.
 */
export async function exchangeSponsorPayload(
  endpoint: string,
  payload: unknown,
): Promise<string | null> {
  if (typeof fetch !== "function") return null;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin",
      keepalive: true,
    });
    if (response.status !== 200) return null;
    return issuedSponsorSession(await response.json());
  } catch {
    return null;
  }
}

export const defaultSponsorTrackerDeps: SponsorTrackerDeps = {
  hasConsent: () => hasCategoryConsent("marketing"),
  send: sendBeaconPayload,
  exchange: exchangeSponsorPayload,
  schedule: (run) => whenIdle(run),
  storage: () => window.sessionStorage,
  onConsentChange: subscribeConsentChange,
};

const SESSION_KEY = SPONSOR_SESSION_STORAGE_KEY.key;

function storageOf(deps: SponsorTrackerDeps): Storage | null {
  try {
    return deps.storage();
  } catch {
    return null;
  }
}

/**
 * Zapamiętana sesja SERWERA albo `null`. Identyfikator starego klienta (32 hex
 * wymyślone w przeglądarce) nie jest sesją - zostanie nadpisany po uścisku.
 */
export function readSponsorSession(deps: SponsorTrackerDeps): string | null {
  try {
    const stored = storageOf(deps)?.getItem(SESSION_KEY) ?? null;
    return stored !== null && SPONSOR_SESSION_TOKEN_PATTERN.test(stored) ? stored : null;
  } catch {
    // Odczyt zablokowany - sesja zostaje w pamięci trackera.
    return null;
  }
}

/** Zapamiętuje sesję wydaną przez serwer. Nigdy nie rzuca. */
export function storeSponsorSession(deps: SponsorTrackerDeps, session: string): void {
  try {
    storageOf(deps)?.setItem(SESSION_KEY, session);
  } catch {
    // Zapis zablokowany - sesja zostaje w pamięci trackera.
  }
}

/** Usuwa sesję (zgoda cofnięta). Nigdy nie rzuca. */
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
  /** Wysyła kolejkę TERAZ (ukrycie karty, opuszczenie strony) - bez czekania na sesję. */
  flush: () => void;
  /** Zgoda zmieniona: bez niej - pusta kolejka i usunięta sesja. */
  syncConsent: () => void;
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
  let handshake = false;
  // Pokolenie zgody: wynik uścisku sprzed cofnięcia zgody jest porzucany,
  // także gdy zgoda wróciła, zanim serwer odpowiedział.
  let generation = 0;
  let disposed = false;

  function cancelScheduled(): void {
    if (cancel !== null) {
      cancel();
      cancel = null;
    }
  }

  function payloadOf(items: SponsorExposureItem[], withSession: string | null) {
    return {
      event_slug: eventSlug,
      ...(withSession === null ? {} : { session: withSession }),
      items: items.map(exposureToWire),
    };
  }

  function beaconAll(withSession: string | null): void {
    const items = queue;
    queue = [];
    for (let start = 0; start < items.length; start += SPONSOR_BATCH_MAX) {
      deps.send(
        SPONSOR_EVENT_ENDPOINT,
        payloadOf(items.slice(start, start + SPONSOR_BATCH_MAX), withSession),
      );
    }
  }

  function forget(): void {
    cancelScheduled();
    generation += 1;
    handshake = false;
    queue = [];
    session = null;
    clearSponsorSession(deps);
  }

  function startHandshake(): void {
    const items = queue.slice(0, SPONSOR_BATCH_MAX);
    queue = queue.slice(SPONSOR_BATCH_MAX);
    handshake = true;
    const started = generation;
    // Wymiana startuje SYNCHRONICZNIE - przy `pagehide` nie ma na co czekać.
    let pending: Promise<string | null>;
    try {
      pending = deps.exchange(SPONSOR_EVENT_ENDPOINT, payloadOf(items, null));
    } catch {
      pending = Promise.resolve(null);
    }
    void pending
      .catch(() => null)
      .then((issued) => {
        if (started !== generation) return;
        handshake = false;
        if (issued === null || !deps.hasConsent()) return;
        session = issued;
        storeSponsorSession(deps, issued);
        if (queue.length > 0) send(false);
      });
  }

  /** `urgent` = teraz albo wcale (strona znika), bez czekania na sesję. */
  function send(urgent: boolean): void {
    cancelScheduled();
    if (queue.length === 0) return;
    if (!deps.hasConsent()) {
      forget();
      return;
    }
    session ??= readSponsorSession(deps);
    if (session !== null) {
      beaconAll(session);
      return;
    }
    if (!handshake) startHandshake();
    // Pilna wysyłka nie czeka na sesję: reszta kolejki idzie bez niej.
    if (urgent && queue.length > 0) beaconAll(null);
  }

  function syncConsent(): void {
    if (deps.hasConsent()) return;
    forget();
  }

  function track(item: SponsorExposureItem): void {
    if (disposed || !isAcceptableExposure(item) || !deps.hasConsent()) return;
    queue.push(item);
    if (item.kind !== "view") {
      send(false);
      return;
    }
    cancel ??= deps.schedule(() => send(false));
  }

  function dispose(): void {
    send(true);
    disposed = true;
  }

  return { track, flush: () => send(true), syncConsent, dispose };
}
