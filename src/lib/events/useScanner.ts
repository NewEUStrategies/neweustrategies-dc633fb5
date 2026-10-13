// Środowisko uruchomieniowe skanera: poświadczenie, sieć, kolejka skanów
// i tryb offline.
//
// JEDEN HOOK, BO TO JEST JEDEN STAN. Poświadczenie decyduje, które tryby
// widać; sieć decyduje, czy skan leci teraz, czy do kolejki; kolejka decyduje,
// co pokazać na pasku. Rozbicie tego na trzy niezależne hooki dałoby trzy
// źródła prawdy o tym, czy skaner „działa" - a operator przy bramce musi mieć
// jedną odpowiedź.
//
// POŚWIADCZENIE NIE JEST ZAPYTANIEM REACT QUERY. `event_scanner_bootstrap`
// jest funkcją ZMIENIAJĄCĄ (stempluje `last_seen_at`), a jej odpowiedź niesie
// token w tej samej gałęzi stanu - trzymanie go w cache zapytań wpuściłoby
// poświadczenie do narzędzi deweloperskich i do każdego zrzutu stanu.
//
// KOLEJKA OPRÓŻNIA SIĘ SAMA. Powrót sieci (`online`), powrót karty na wierzch
// (`visibilitychange`) i tykający odstęp próbują wysłać zaległości bez udziału
// człowieka - wolontariusz przy bramce nie ma jak zauważyć, że zasięg wrócił,
// a przyciski „Wyślij teraz" i „Ponów" są tylko awaryjne.
//
// KOLEJKA NIE UTYKA (OPS-05). Awaria przejściowa (sieć, termin żądania, 5xx,
// blokada czasowa, dławik) przesuwa wyłącznie termin następnej próby - bez
// limitu prób, z sufitem minuty. Start aplikacji, powrót sieci i powrót karty
// na wierzch ZERUJĄ wycofanie i od razu wysyłają. Seria trzech porażek
// przejściowych z rzędu (albo blokada czasowa całego urządzenia) kończy BIEŻĄCY
// przebieg - pięćset pozycji po dziesięć sekund terminu każda trzymałoby
// przebieg ponad godzinę, a powrót sieci nie miałby jak go przyspieszyć.
//
// WYSYŁKA JEST SZEREGOWA. Dwadzieścia równoległych żądań z telefonu na słabym
// łączu kończy się dwudziestoma przekroczeniami czasu; jedno po drugim
// przechodzi. Kolejność jest chronologiczna, bo dziennik ma się zgadzać
// z tym, co działo się przy bramce.
//
// TRYB OFFLINE (20260926150000):
//   * ZIMNY START BEZ SIECI. Po udanym połączeniu sesja (bez tokenu, pod
//     skrótem tokenu) trafia do `scannerOfflineStorage`; ponowne otwarcie bez
//     zasięgu albo po przekroczeniu terminu żądania podnosi ją stamtąd jako
//     `sessionStale` i próbuje potwierdzić przy powrocie sieci.
//   * LISTA OFFLINE. Urządzenie ze zgodą administratora pobiera listę (pełną,
//     potem przyrosty co kilka minut i przy powrocie sieci). Skan bez sieci,
//     po terminie żądania ALBO przy blokadzie czasowej urządzenia (OPS-04 -
//     lista i tak leży na telefonie, więc nic nowego nie wycieka) dostaje
//     decyzję z listy (`decideOffline`) - prawdziwy kolor na ekranie, podpisany
//     jako decyzja offline - i jedzie do kolejki razem z tą decyzją.
//   * WYNIK SYNCHRONIZACJI NIE GINIE. Rozbieżność decyzji offline z bazą idzie
//     na listę konfliktów, trwała odmowa na listę odrzuconych (obie trwałe).
//     Odrzucona pozycja schodzi z kolejki DOPIERO po trwałym zapisie listy
//     odrzuconych (`transferRejected`) - kolejka i lista to dwie bazy
//     IndexedDB, a lista bywa tylko w pamięci karty (prywatne okno).
//   * ZEGAR. `server_now` z konfiguracji daje przesunięcie zegara urządzenia;
//     czas skanu jest nim korygowany, a ekran ostrzega przy dużej odchyłce.
//
// JAWNY KOD NIE LEŻY NA DYSKU (OPS-06). Kolejka jest zapisywana zaszyfrowana
// kluczem z tokenu potwierdzonego poświadczenia (`scannerVault.ts`); klucz
// powstaje przy starcie (dla tokenu z adresu albo z pamięci) i przy każdym
// przyjęciu sesji, a pozycje zaszyfrowane kluczem innego tokenu otwierają się,
// gdy ten token wróci. Lista osób dostaje termin poświadczenia i znika po nim
// przy starcie i na odstępie. ŚWIADOME ODŁĄCZENIE (ekran pyta, gdy coś nie
// zostało wysłane) kasuje kolejkę, odrzucone, konflikty, listę i token.
//
// ZNACZNIK KOLEJKI (OPS-12, `scannerQueueMarker.ts`). Najnowszy znacznik z każdej
// odpowiedzi bazy (konfiguracja, strona listy offline, zapis odprawy i leadu)
// żyje w pamięci karty i - zaszyfrowany - na dysku; każda pozycja dostaje
// znacznik aktualny W CHWILI KOLEJKOWANIA (`queue`) i odsyła go przy wysyłce.
// Tylko z nim baza przyjmie skan sprzed terminu poświadczenia po tym terminie.
//
// POLITYKA PONOWNEGO WEJŚCIA (OPS-08) dociera z konfiguracją i z każdą stroną
// listy offline (`withReentryPolicies`) - decyzja offline zna ją bez ponownego
// parowania.
//
// POŚWIADCZENIE WYGASA TAKŻE BEZ SIECI. Termin sprawdzamy na zegarze
// skorygowanym - przy każdym skanie i co pół minuty - zamiast czekać na
// odmowę bazy: telefon bez zasięgu inaczej wpuszczałby dalej po terminie
// i trzymał listę osób.
//
// PAROWANIE MA POKOLENIE. Każde połączenie, odłączenie i utrata sesji podbija
// `pairingRef`; odpowiedź `bootstrap`, która wróciła dla starszego pokolenia,
// nie dotyka już stanu (spóźnione potwierdzenie po „Odłącz" wskrzeszałoby
// sesję i zapisywało token z powrotem). To samo dotyczy KAŻDEJ kontynuacji po
// `await`: wysyłki kolejki, skanu na żywo, strony listy offline i znacznika.
// Pokolenie jest zapamiętane PRZED żądaniem, a odpowiedź spóźniona względem
// „Odłącz" albo nowego parowania nie zapisuje konfliktu (imię i nazwisko
// uczestnika), pozycji kolejki, odrzuconych, dziennika zgód ani znacznika -
// świadome odłączenie ma zostawić pusty telefon, a skan urządzenia A nie może
// trafić do kolejki urządzenia B. `queue`, `commitConflict`, `commitRejected`
// i `observeMarker` same sprawdzają pokolenie, z którym je wywołano.
//
// ZNACZNIK NALEŻY DO URZĄDZENIA, DLA KTÓREGO POSZŁO ŻĄDANIE. Odpowiedź niesie
// znacznik tego urządzenia, które ją wysłało (pozycja kolejki: `item.deviceId`),
// nie tego, które jest sparowane, gdy odpowiedź wraca - inaczej znacznik
// urządzenia A stemplowałby skany urządzenia B, a baza po terminie B odrzuciłaby
// je jako `device_expired`.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  bootstrapScanner,
  fetchScannerRoster,
  recordCheckinScan,
  recordLeadScan,
  withDeadline,
  type CheckinScanResult,
  type LeadScanResult,
} from "@/lib/events/scannerApi";
import type { RosterPage } from "@/lib/events/scannerRoster";
import {
  newerQueueMarker,
  queueMarkerFor,
  shouldPersistQueueMarker,
  type DeviceQueueMarker,
  type QueueMarker,
} from "@/lib/events/scannerQueueMarker";
import {
  appendRejected,
  dueItems,
  enqueueScanWithOverflow,
  isRejectedItem,
  markRejected,
  outboxCounts,
  outboxDisposition,
  reconcileRejected,
  rejectAll,
  resetBackoff,
  stopsFlushRun,
  withFailure,
  withoutItem,
  withoutItems,
  type OutboxCounts,
  type OutboxItem,
  type RejectedScan,
} from "@/lib/events/scannerOutbox";
import {
  clearOutbox,
  clearStoredToken,
  isOutboxPersistent,
  loadOutbox,
  openSealedItems,
  readStoredToken,
  saveOutbox,
  writeStoredToken,
} from "@/lib/events/scannerStorage";
import {
  clearSyncIssues as clearStoredSyncIssues,
  isOfflineStoragePersistent,
  loadCachedSession,
  loadConflicts,
  loadDecisionLog,
  loadQueueMarker,
  loadRejected,
  loadRoster,
  purgeExpiredRoster,
  saveCachedSession,
  saveConflicts,
  saveDecisionLog,
  saveQueueMarker,
  saveRejected,
  saveRoster,
  wipeAllOfflineData,
  wipeOfflineSession,
  wipeRoster,
  type CachedSession,
} from "@/lib/events/scannerOfflineStorage";
import {
  clockOffsetMs as computeClockOffset,
  findCheckpoint,
  isClockSkewed,
  isScannerToken,
  isSessionExpired,
  withReentryPolicies,
  type CheckpointReentryUpdate,
  type ScannerSession,
} from "@/lib/events/scannerSession";
import {
  invalidatesSession,
  scanErrorKind,
  scannerErrorHead,
  scannerErrorText,
  type ScanErrorKind,
} from "@/lib/events/scannerErrorKind";
import {
  appendDecisionLog,
  buildRosterIndex,
  decideOffline,
  isRosterExpired,
  matchRoster,
  queuedOfflineDecision,
  syncRosterSnapshot,
  type LocalDecisionLogEntry,
  type OfflineDecision,
  type RosterSnapshot,
} from "@/lib/events/scannerRoster";
import { appendConflict, detectConflict, type ScanConflict } from "@/lib/events/scannerSyncIssues";
import { sha256Hex } from "@/lib/events/scannerHash";
import { holdScannerRuntimeLock } from "@/lib/events/scannerRuntimeLock";
import { codePrefixOf, deriveVaultKey, scanCodeHash } from "@/lib/events/scannerVault";
import { newClientScanUid } from "@/lib/events/clientScanUid";
import type { CheckinDirection } from "@/lib/events/onsiteEnums";

/** Co ile próbować opróżnić kolejkę, gdy coś w niej stoi. */
const FLUSH_INTERVAL_MS = 15_000;
/** Co ile dociągać przyrost listy offline przy działającej sieci. */
const ROSTER_SYNC_INTERVAL_MS = 3 * 60_000;
/** Skan przy bramce: po tym czasie decyzja idzie ścieżką offline. */
const SCAN_TIMEOUT_MS = 3_500;
const BOOTSTRAP_TIMEOUT_MS = 8_000;
const FLUSH_TIMEOUT_MS = 10_000;
const ROSTER_TIMEOUT_MS = 20_000;
/** Co ile sprawdzać termin poświadczenia na zegarze urządzenia. */
const EXPIRY_CHECK_INTERVAL_MS = 30_000;
/** Co ile sprawdzać termin listy osób - niezależnie od stanu sesji. */
const ROSTER_EXPIRY_CHECK_INTERVAL_MS = 60_000;
/** Tyle porażek przejściowych z rzędu kończy bieżący przebieg wysyłki. */
const TRANSIENT_STREAK_LIMIT = 3;

/** Odmowy lokalne - te same głowy `kod:` co odmowy bazy, więc ten sam słownik. */
const OUTBOX_OVERFLOW = "outbox_overflow: device queue full";
const DEVICE_MISMATCH = "device_mismatch: queued under another credential";
const OUTBOX_SEALED = "outbox_sealed: queued code is not readable on this device";
const EXPIRED_ON_DEVICE = "device_expired: expired on device clock";
/**
 * Brak parowania: skan bez sesji albo skan, którego parowanie skończyło się
 * (odłączenie, nowe parowanie) przed odpowiedzią - nie jest ani zapisany
 * lokalnie, ani zakolejkowany.
 */
const NO_SESSION = "invalid_device_token: no session";

/**
 * Co skan NA ŻYWO robi z odmową - tabela, nie łańcuch warunków. Wstrzymanie
 * (`paused`) zdejmuje wcześniej listę osób i leci do operatora jak odmowa.
 */
type LiveScanFailure = "queue" | "end_session" | "rethrow";

const LIVE_SCAN_FAILURE: Readonly<Record<ScanErrorKind, LiveScanFailure>> = {
  transport: "queue",
  // OPS-04: blokada czasowa to „jeszcze nie teraz" - skan czeka w kolejce
  // z decyzją z listy offline, zamiast bez żadnej decyzji.
  locked: "queue",
  throttled: "queue",
  paused: "rethrow",
  session: "end_session",
  refused: "rethrow",
};

export type ScannerStatus = "idle" | "connecting" | "ready" | "expired";

export interface QueuedScanOutcome {
  queued: true;
  /** Decyzja z listy offline - `null`, gdy urządzenie nie ma listy. */
  local: OfflineDecision | null;
}

export interface SentCheckinOutcome {
  queued: false;
  result: CheckinScanResult;
}

export interface SentLeadOutcome {
  queued: false;
  result: LeadScanResult;
}

export interface ScannerRosterInfo {
  /** Zgoda administratora na listę offline dla tego urządzenia. */
  enabled: boolean;
  /** Wersja listy na urządzeniu (`null` = brak listy). */
  generatedAt: string | null;
  count: number;
  syncing: boolean;
}

/** Podsumowanie ostatniej wysyłki kolejki - ekran zamienia je w komunikat. */
export interface FlushReport {
  sent: number;
  conflicts: number;
  rejected: number;
  /** Rośnie z każdą wysyłką, żeby ten sam wynik dało się pokazać drugi raz. */
  seq: number;
}

export interface ScannerRuntime {
  status: ScannerStatus;
  session: ScannerSession | null;
  /** Token do wywołań płaszczyzny urządzenia. Nigdy nie trafia do cache. */
  token: string | null;
  connectError: string | null;
  connect: (token: string) => void;
  /**
   * Odłączenie: token, sesja, lista, kolejka, odrzucone i konflikty znikają
   * z urządzenia. Ekran PYTA, zanim to wywoła, gdy coś nie zostało wysłane.
   * Obietnica kończy się, gdy kasowanie dotarło na dysk.
   */
  disconnect: () => Promise<void>;
  online: boolean;
  outbox: OutboxItem[];
  outboxCounts: OutboxCounts;
  /** `false` = kolejka nie przeżyje zamknięcia karty (prywatne okno, brak szyfrowania). */
  outboxPersistent: boolean;
  flushing: boolean;
  flush: () => void;
  /** Zeruje wycofanie JEDNEJ pozycji i od razu wysyła. */
  retry: (id: string) => void;
  /** Zeruje wycofanie wszystkich pozycji i od razu wysyła. */
  retryAll: () => void;
  discard: (id: string) => void;
  submitCheckin: (input: {
    code: string;
    checkpointId: string | null;
    direction: CheckinDirection;
  }) => Promise<QueuedScanOutcome | SentCheckinOutcome>;
  submitLead: (input: {
    code: string;
    note: string | null;
    interestRating: number | null;
  }) => Promise<QueuedScanOutcome | SentLeadOutcome>;
  /** Sesja z pamięci urządzenia, jeszcze niepotwierdzona przez bazę. */
  sessionStale: boolean;
  /** Serwer − urządzenie (ms). */
  clockOffsetMs: number;
  clockSkewed: boolean;
  roster: ScannerRosterInfo;
  syncRoster: () => void;
  rejected: RejectedScan[];
  conflicts: ScanConflict[];
  clearSyncIssues: () => void;
  /** `false` = lista, konflikty i odrzucone żyją tylko w pamięci karty. */
  offlineStoragePersistent: boolean;
  lastFlush: FlushReport | null;
}

/**
 * Czy pozycja należy do poświadczenia, które właśnie pracuje (albo właśnie
 * zostało odrzucone). Pozycja zamknięta blokiem INNEGO tokenu (sejf, OPS-06)
 * nie należy - czeka na powrót swojego tokenu (albo na `device_mismatch` pod
 * cudzym), zamiast iść na listę odrzuconych z cudzym powodem.
 */
function belongsToActiveCredential(item: OutboxItem): boolean {
  return item.code !== "" || !item.sealed;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** „Teraz" na zegarze serwera - zegar urządzenia plus zmierzone przesunięcie. */
function correctedNowIso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/**
 * @param initialToken Poświadczenie z adresu (`/scanner#t=…`) albo `null`.
 *   Ma PIERWSZEŃSTWO nad tym z pamięci urządzenia: operator, który właśnie
 *   zeskanował nowy kod z panelu, chce podłączyć TO urządzenie, a nie wrócić
 *   do poprzedniego. Bez tego pierwszeństwa dwa wywołania `bootstrap` -
 *   z adresu i z pamięci - ścigałyby się o stan sesji.
 */
export function useScannerRuntime(initialToken: string | null = null): ScannerRuntime {
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<ScannerSession | null>(null);
  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [sessionStale, setSessionStale] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [online, setOnline] = useState(true);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [outboxPersistent, setOutboxPersistent] = useState(true);
  const [flushing, setFlushing] = useState(false);
  const [roster, setRoster] = useState<RosterSnapshot | null>(null);
  const [rosterLoadedFor, setRosterLoadedFor] = useState<string | null>(null);
  const [rosterSyncing, setRosterSyncing] = useState(false);
  const [rejected, setRejected] = useState<RejectedScan[]>([]);
  const [conflicts, setConflicts] = useState<ScanConflict[]>([]);
  const [offlinePersistent, setOfflinePersistent] = useState(true);
  const [lastFlush, setLastFlush] = useState<FlushReport | null>(null);

  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;
  const sessionRef = useRef<ScannerSession | null>(null);
  sessionRef.current = session;
  const statusRef = useRef<ScannerStatus>("idle");
  statusRef.current = status;
  const outboxRef = useRef<OutboxItem[]>([]);
  outboxRef.current = outbox;
  const flushingRef = useRef(false);
  /** Ktoś poprosił o wysyłkę w trakcie przebiegu - po nim ruszy następny. */
  const flushAgainRef = useRef(false);
  const clockOffsetRef = useRef(0);
  const rosterRef = useRef<RosterSnapshot | null>(null);
  const rosterSyncingRef = useRef(false);
  const logRef = useRef<LocalDecisionLogEntry[]>([]);
  const rejectedRef = useRef<RejectedScan[]>([]);
  const conflictsRef = useRef<ScanConflict[]>([]);
  const flushSeqRef = useRef(0);
  /** Pokolenie parowania - patrz nagłówek („PAROWANIE MA POKOLENIE"). */
  const pairingRef = useRef(0);
  /** Odczyt kolejki z pamięci urządzenia - odmowa przy starcie bywa od niego szybsza. */
  const outboxLoadRef = useRef<Promise<void> | null>(null);
  /** Sprzątanie listy po terminie przy starcie - wczytanie listy czeka na nie. */
  const rosterPurgeRef = useRef<Promise<unknown> | null>(null);
  /** Klucz sejfu kolejki dla bieżącego poświadczenia (`null` = kod nie trafia na dysk). */
  const vaultKeyRef = useRef<CryptoKey | null>(null);
  const vaultMemoRef = useRef<{ token: string; key: Promise<CryptoKey | null> } | null>(null);
  /** Najnowszy znacznik kolejki (OPS-12) - stempel każdej nowej pozycji. */
  const markerRef = useRef<DeviceQueueMarker | null>(null);
  /** Znacznik, który leży na dysku (w sejfie) - zapis tylko, gdy nowy jest wyraźnie nowszy. */
  const persistedMarkerRef = useRef<DeviceQueueMarker | null>(null);

  const rosterIndex = useMemo(() => buildRosterIndex(roster?.rows ?? []), [roster]);
  const rosterIndexRef = useRef(rosterIndex);
  rosterIndexRef.current = rosterIndex;

  const markOfflinePersistence = useCallback(() => {
    setOfflinePersistent(isOfflineStoragePersistent());
  }, []);

  const persist = useCallback((next: OutboxItem[]) => {
    outboxRef.current = next;
    setOutbox(next);
    void saveOutbox(next, vaultKeyRef.current).then(() =>
      setOutboxPersistent(isOutboxPersistent()),
    );
  }, []);

  /** Klucz sejfu dla tokenu - wyprowadzany raz na token. */
  const vaultKeyFor = useCallback((value: string): Promise<CryptoKey | null> => {
    const memo = vaultMemoRef.current;
    if (memo !== null && memo.token === value) return memo.key;
    const key = deriveVaultKey(value);
    vaultMemoRef.current = { token: value, key };
    return key;
  }, []);

  /**
   * Klucz POTWIERDZONEGO poświadczenia staje się kluczem zapisu, a pozycje
   * zaszyfrowane tym kluczem (zapisane, gdy ten token był ostatnio aktywny)
   * odzyskują kod. Przed przyjęciem sesji - wysyłka startuje dopiero z kodami.
   */
  const adoptVault = useCallback(
    async (value: string, generation: number): Promise<void> => {
      const key = await vaultKeyFor(value);
      await (outboxLoadRef.current ?? Promise.resolve());
      // Odłączenie w międzyczasie wyzerowało klucz celowo - nie wraca.
      if (pairingRef.current !== generation) return;
      vaultKeyRef.current = key;
      if (key === null) return;
      const opened = await openSealedItems(outboxRef.current, key);
      if (opened === null || pairingRef.current !== generation) return;
      const byId = new Map(opened.map((item) => [item.id, item]));
      persist(
        outboxRef.current.map((item) => {
          const open = byId.get(item.id);
          return item.code === "" && open !== undefined && open.code !== "" ? open : item;
        }),
      );
    },
    [vaultKeyFor, persist],
  );

  const commitRoster = useCallback(
    (snapshot: RosterSnapshot | null) => {
      rosterRef.current = snapshot;
      setRoster(snapshot);
      void saveRoster(snapshot).then(markOfflinePersistence);
    },
    [markOfflinePersistence],
  );

  /**
   * Dopisuje odrzucone; obietnica mówi, czy lista przeżyje zamknięcie karty.
   * `generation` - pokolenie parowania, w którym zapadła odmowa: po odłączeniu
   * (albo nowym parowaniu) nic nie wraca na listę ani na dysk (`false`).
   */
  const commitRejected = useCallback(
    (added: readonly RejectedScan[], generation: number): Promise<boolean> => {
      if (pairingRef.current !== generation) return Promise.resolve(false);
      const next = appendRejected(rejectedRef.current, added);
      rejectedRef.current = next;
      setRejected(next);
      return saveRejected(next).then(() => {
        markOfflinePersistence();
        return isOfflineStoragePersistent();
      });
    },
    [markOfflinePersistence],
  );

  /**
   * Odrzucone przechodzą z kolejki na listę odrzuconych. Pozycje są już
   * ZAMROŻONE w kolejce (nie jadą do bazy) i schodzą z niej dopiero, gdy lista
   * zapisała się trwale. Lista tylko w pamięci karty = pozycje zostają
   * w kolejce jako „wymaga uwagi" z powodem i przeżywają zamknięcie karty.
   */
  const transferRejected = useCallback(
    (added: readonly RejectedScan[], generation: number) => {
      if (added.length === 0) return;
      void commitRejected(added, generation).then((durable) => {
        // Zdjęcie z kolejki NIE pyta o pokolenie: odmowa poświadczenia kończy
        // parowanie (`dropSession`) zaraz po tym wywołaniu, a pozycje mają
        // zejść z kolejki właśnie wtedy. Po odłączeniu kolejka jest pusta,
        // a po nowym parowaniu nie zawiera tych identyfikatorów - nic się nie zmienia.
        if (!durable) return;
        const ids = added.map((entry) => entry.item.id);
        const next = withoutItems(outboxRef.current, ids);
        if (next.length !== outboxRef.current.length) persist(next);
      });
    },
    [commitRejected, persist],
  );

  /** Konflikt z odpowiedzi bazy - tylko dla parowania, które ją wysłało (`generation`). */
  const commitConflict = useCallback(
    (conflict: ScanConflict, generation: number) => {
      if (pairingRef.current !== generation) return;
      const next = appendConflict(conflictsRef.current, conflict);
      conflictsRef.current = next;
      setConflicts(next);
      void saveConflicts(next).then(markOfflinePersistence);
    },
    [markOfflinePersistence],
  );

  const logGrant = useCallback((entry: LocalDecisionLogEntry) => {
    const next = appendDecisionLog(logRef.current, entry, Date.now());
    logRef.current = next;
    void saveDecisionLog(next);
  }, []);

  /* ---------------------------------------------------- znacznik kolejki --- */

  /**
   * Znacznik z odpowiedzi bazy (OPS-12): najnowszy wygrywa (`newerQueueMarker`),
   * odpowiedź bez znacznika niczego nie kasuje. Na dysk - zaszyfrowany kluczem
   * bieżącego poświadczenia - trafia co kilka minut, nie przy każdym skanie.
   * `deviceId` - urządzenie, dla którego poszło żądanie (nie to, które jest
   * sparowane teraz); `generation` - pokolenie parowania z chwili żądania:
   * odpowiedź spóźniona względem odłączenia albo nowego parowania nie zostawia
   * znacznika (patrz nagłówek). `restored` = znacznik właśnie przeczytany
   * z dysku (nie zapisujemy go z powrotem).
   */
  const observeMarker = useCallback(
    (
      deviceId: string | null | undefined,
      marker: QueueMarker | null | undefined,
      generation: number,
      restored = false,
    ) => {
      if (deviceId === null || deviceId === undefined || marker === null || marker === undefined) {
        return;
      }
      if (pairingRef.current !== generation) return;
      const current = markerRef.current;
      const held = current !== null && current.deviceId === deviceId ? current.marker : null;
      const chosen = newerQueueMarker(held, marker);
      if (chosen === null || chosen === held) return;
      const next: DeviceQueueMarker = { deviceId, marker: chosen };
      markerRef.current = next;
      if (restored) {
        persistedMarkerRef.current = next;
        return;
      }
      if (!shouldPersistQueueMarker(persistedMarkerRef.current, next)) return;
      void saveQueueMarker(
        deviceId,
        chosen,
        vaultKeyRef.current,
        // Odłączenie albo nowe parowanie w trakcie szyfrowania - nic na dysk.
        () => pairingRef.current === generation,
      ).then((saved) => {
        if (saved) persistedMarkerRef.current = next;
      });
    },
    [],
  );

  /** Znacznik z dysku dla sesji z pamięci (start bez sieci) - zanim ktoś zeskanuje. */
  const restoreMarker = useCallback(
    async (deviceId: string, generation: number): Promise<void> => {
      if (markerRef.current?.deviceId === deviceId) return;
      const stored = await loadQueueMarker(deviceId, vaultKeyRef.current);
      observeMarker(deviceId, stored, generation, true);
    },
    [observeMarker],
  );

  const forgetMarker = useCallback(() => {
    markerRef.current = null;
    persistedMarkerRef.current = null;
  }, []);

  /* ------------------------------------------------------- poświadczenie --- */

  /** Lista i dziennik zgód znikają z urządzenia; sesja zostaje. */
  const forgetRoster = useCallback(() => {
    rosterRef.current = null;
    setRoster(null);
    logRef.current = [];
    void wipeRoster();
  }, []);

  /**
   * Poświadczenie odrzucone przez bazę: token, sesja i lista znikają.
   *
   * KOLEJKA ODRZUCONEGO POŚWIADCZENIA idzie na listę odrzuconych (z eksportem),
   * zamiast zostać w pamięci niewidzialna i wyjechać później pod innym tokenem.
   * Tylko przy odmowie dla poświadczenia, które tę kolejkę NIESIE (bieżącego
   * albo - przy starcie - jedynego): nieudane parowanie NOWEGO kodu nie
   * przekreśla skanów poprzedniego urządzenia.
   */
  const dropSession = useCallback(
    (message: string, refusedToken: string | null) => {
      pairingRef.current += 1;
      const generation = pairingRef.current;
      const ownsQueue = tokenRef.current === null || tokenRef.current === refusedToken;
      clearStoredToken();
      setToken(null);
      setSession(null);
      setSessionStale(false);
      setStatus("idle");
      setConnectError(message);
      rosterRef.current = null;
      setRoster(null);
      setRosterLoadedFor(null);
      logRef.current = [];
      forgetMarker();
      void wipeOfflineSession();
      if (!ownsQueue) return;
      void (outboxLoadRef.current ?? Promise.resolve()).then(() => {
        // Nowe parowanie w międzyczasie - kolejka należy już do niego.
        if (pairingRef.current !== generation) return;
        const owned = outboxRef.current.filter(belongsToActiveCredential);
        const entries = rejectAll(owned, message, new Date().toISOString());
        if (entries.length === 0) return;
        persist(markRejected(outboxRef.current, entries));
        transferRejected(entries, generation);
      });
    },
    [persist, transferRejected, forgetMarker],
  );

  /**
   * Wstrzymanie w panelu (`device_inactive`) jest odwracalne jak blokada
   * czasowa: token, sesja i kolejka czekają na „Wznów", a lista osób znika
   * z telefonu od razu (wraca z pierwszą synchronizacją po wznowieniu).
   */
  const credentialPaused = useCallback(
    (error: unknown): boolean => {
      if (scanErrorKind(error) !== "paused") return false;
      forgetRoster();
      return true;
    },
    [forgetRoster],
  );

  /**
   * Odmowa poświadczenia W TRAKCIE pracy. Wygasłe poświadczenie zostaje na
   * ekranie „wygasło" (kolejka jeszcze się wysyła w oknie 72 h), resztę
   * odmów kończy powrót do parowania.
   */
  const credentialFailed = useCallback(
    (error: unknown) => {
      if (scannerErrorHead(error) === "device_expired") {
        setStatus("expired");
        return;
      }
      dropSession(scannerErrorText(error), tokenRef.current);
    },
    [dropSession],
  );

  const adoptSession = useCallback(
    (clean: string, next: ScannerSession, offset: number, stale: boolean) => {
      writeStoredToken(clean);
      clockOffsetRef.current = offset;
      setClockOffset(offset);
      setToken(clean);
      setSession(next);
      setSessionStale(stale);
      setConnectError(null);
      setStatus(
        isSessionExpired(next, new Date(Date.now() + offset).toISOString()) ? "expired" : "ready",
      );
    },
    [],
  );

  const cachedFor = useCallback(async (clean: string): Promise<CachedSession | null> => {
    return loadCachedSession(await sha256Hex(clean));
  }, []);

  const runBootstrap = useCallback(
    async (clean: string, mode: "connect" | "refresh"): Promise<void> => {
      // Każdy powrót z `await` sprawdza pokolenie: wynik dla parowania, które
      // w międzyczasie odłączono albo zastąpiono, nie dotyka już stanu.
      const generation = pairingRef.current;
      const superseded = () => pairingRef.current !== generation;
      /**
       * Klucz sejfu przed sesją: pierwsza wysyłka ma już otwarte kody, a skan
       * po starcie bez sieci - znacznik kolejki z dysku.
       */
      const adopt = async (next: ScannerSession, offset: number, stale: boolean) => {
        await adoptVault(clean, generation);
        if (superseded()) return false;
        await restoreMarker(next.deviceId, generation);
        if (superseded()) return false;
        adoptSession(clean, next, offset, stale);
        return true;
      };
      if (mode === "connect" && isOffline()) {
        // Bez sieci nie ma na co czekać: sesja z pamięci od razu, potwierdzenie
        // przy powrocie zasięgu.
        const cached = await cachedFor(clean);
        if (superseded()) return;
        if (cached !== null) {
          await adopt(cached.session, cached.serverOffsetMs, true);
          return;
        }
      }
      const sentAt = Date.now();
      try {
        // Znacznik kolejki NIE jest częścią sesji (ekran, pamięć podręczna
        // sesji bez szyfrowania) - zdejmujemy go od razu.
        const { queueMarker, ...next } = await withDeadline(
          bootstrapScanner(clean),
          BOOTSTRAP_TIMEOUT_MS,
        );
        if (superseded()) return;
        const offset = computeClockOffset(next.serverNow, sentAt, Date.now());
        if (!(await adopt(next, offset, false))) return;
        observeMarker(next.deviceId, queueMarker, generation);
        const tokenHash = await sha256Hex(clean);
        if (superseded()) return;
        await saveCachedSession({
          tokenHash,
          session: next,
          serverOffsetMs: offset,
          savedAt: new Date().toISOString(),
        });
        markOfflinePersistence();
      } catch (error: unknown) {
        if (superseded()) return;
        // Wstrzymane urządzenie: jak blokada czasowa (token zostaje), lista znika.
        credentialPaused(error);
        if (invalidatesSession(error)) {
          if (scannerErrorHead(error) === "device_expired") {
            const cached = await cachedFor(clean);
            if (superseded()) return;
            if (cached !== null) {
              if (await adopt(cached.session, cached.serverOffsetMs, false)) setStatus("expired");
              return;
            }
          }
          // Poświadczenie odrzucone przez bazę nie ma po co zostawać na
          // urządzeniu - następne otwarcie ekranu próbowałoby go znowu.
          dropSession(scannerErrorText(error), clean);
          return;
        }
        if (mode === "refresh") return;
        // Zimny start z sesji w pamięci wyłącznie po awarii TRANSPORTU. Blokada
        // czasowa zostawia skany do ponowienia, ale jest jawną odpowiedzią
        // bazy - nie może otwierać skanera z sesji, której baza nie potwierdziła.
        if (scanErrorKind(error) === "transport") {
          const cached = await cachedFor(clean);
          if (superseded()) return;
          if (cached !== null) {
            await adopt(cached.session, cached.serverOffsetMs, true);
            return;
          }
        }
        setStatus("idle");
        setConnectError(scannerErrorText(error));
      }
    },
    [
      adoptSession,
      adoptVault,
      cachedFor,
      credentialPaused,
      dropSession,
      markOfflinePersistence,
      observeMarker,
      restoreMarker,
    ],
  );

  const connect = useCallback(
    (candidate: string) => {
      const clean = candidate.trim();
      if (!isScannerToken(clean)) {
        setConnectError("invalid_device_token: malformed");
        return;
      }
      setStatus("connecting");
      setConnectError(null);
      pairingRef.current += 1;
      void runBootstrap(clean, "connect");
    },
    [runBootstrap],
  );

  /**
   * Świadome odłączenie (OPS-06): poświadczenie, sesja, lista osób, dziennik
   * zgód, kolejka, odrzucone i konflikty znikają z urządzenia. Ekran pyta
   * wcześniej, gdy coś nie zostało wysłane albo przekazane organizatorowi.
   */
  const disconnect = useCallback((): Promise<void> => {
    pairingRef.current += 1;
    clearStoredToken();
    vaultKeyRef.current = null;
    vaultMemoRef.current = null;
    forgetMarker();
    setToken(null);
    setSession(null);
    setSessionStale(false);
    setStatus("idle");
    setConnectError(null);
    rosterRef.current = null;
    setRoster(null);
    setRosterLoadedFor(null);
    logRef.current = [];
    outboxRef.current = [];
    setOutbox([]);
    rejectedRef.current = [];
    setRejected([]);
    conflictsRef.current = [];
    setConflicts([]);
    setLastFlush(null);
    return Promise.all([clearOutbox(), wipeAllOfflineData()]).then(() => {
      setOutboxPersistent(isOutboxPersistent());
      markOfflinePersistence();
    });
  }, [markOfflinePersistence, forgetMarker]);

  // Skaner pracuje w tej karcie - sprzątanie resztek z innej karty tego originu
  // (`scannerRelocation.ts`) nie skasuje tokenu ani danych spod niego.
  useEffect(() => holdScannerRuntimeLock(), []);

  // Kolejka z poprzedniej zmiany - wczytujemy raz, zanim ktokolwiek zeskanuje.
  // Klucz sejfu powstaje z tokenu, który zaraz będzie łączony (z adresu albo
  // z pamięci); pozycje innego tokenu zostają zaszyfrowane do jego powrotu.
  // Start ZERUJE wycofanie (OPS-05): kolejka z poprzedniej zmiany rusza od razu.
  useEffect(() => {
    rosterPurgeRef.current = purgeExpiredRoster(Date.now());
    const candidate = (initialToken ?? readStoredToken())?.trim() ?? null;
    outboxLoadRef.current = (async () => {
      const key =
        candidate !== null && isScannerToken(candidate) ? await vaultKeyFor(candidate) : null;
      if (vaultKeyRef.current === null) vaultKeyRef.current = key;
      const stored = await loadOutbox(key);
      const reset = resetBackoff(stored, new Date().toISOString());
      // Skan, który zdążył przed odczytem, zostaje obok kolejki z dysku.
      const known = new Set(reset.map((item) => item.id));
      const merged = [...reset, ...outboxRef.current.filter((item) => !known.has(item.id))];
      if (reset !== stored || merged.length !== reset.length) persist(merged);
      else {
        outboxRef.current = merged;
        setOutbox(merged);
      }
      setOutboxPersistent(isOutboxPersistent());
    })();
    // Celowo BEZ `initialToken` w zależnościach - patrz efekt połączenia niżej.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wejście: token z adresu, a gdy go nie ma - z pamięci urządzenia.
  // Jedno wywołanie, jedno źródło, żadnego wyścigu.
  useEffect(() => {
    const token = initialToken ?? readStoredToken();
    if (token !== null) connect(token);
    // Celowo BEZ `initialToken` w zależnościach: trasa czyści token z adresu
    // zaraz po pierwszym renderze, więc kolejna wartość byłaby `null`
    // i rozłączałaby dopiero co podłączone urządzenie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect]);

  // Odrzucone i konflikty z poprzedniej zmiany - scalone z tym, co mogło
  // przybyć, zanim odczyt wrócił.
  //
  // Po obu odczytach kolejka i lista są UZGADNIANE: pozycja zamrożona trwałą
  // odmową, której lista nie przechowała (karta zamknięta przed zapisem listy),
  // wraca na listę; pozycja, którą lista już ma, schodzi z kolejki.
  useEffect(() => {
    void Promise.all([
      loadRejected(),
      loadConflicts(),
      outboxLoadRef.current ?? Promise.resolve(),
    ]).then(([storedRejected, storedConflicts]) => {
      const nextRejected = appendRejected(storedRejected, rejectedRef.current);
      rejectedRef.current = nextRejected;
      setRejected(nextRejected);
      const nextConflicts = conflictsRef.current.reduce(appendConflict, storedConflicts);
      conflictsRef.current = nextConflicts;
      setConflicts(nextConflicts);
      markOfflinePersistence();

      const { orphans, settled } = reconcileRejected(outboxRef.current, nextRejected);
      if (settled.length > 0 && isOfflineStoragePersistent()) {
        persist(withoutItems(outboxRef.current, settled));
      }
      // Lista odrzuconych należy do urządzenia, nie do parowania - bieżące pokolenie.
      transferRejected(orphans, pairingRef.current);
    });
  }, [markOfflinePersistence, persist, transferRejected]);

  // Sesja podniesiona z pamięci - potwierdzamy ją w bazie przy każdej okazji
  // (powrót sieci i tykający odstęp). Nieudana próba w trybie `refresh` nic
  // nie psuje: sesja z pamięci zostaje do następnej.
  const staleToken = sessionStale ? token : null;
  useEffect(() => {
    if (staleToken === null || !online) return;
    const retry = () => void runBootstrap(staleToken, "refresh");
    retry();
    const timer = window.setInterval(retry, FLUSH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [staleToken, online, runBootstrap]);

  /* ------------------------------------------------------ lista offline --- */

  // Wygasłe poświadczenie nie skanuje - lista osób nie ma po co zostawać na
  // telefonie (kolejka i sesja zostają na wysyłkę w oknie 72 h).
  useEffect(() => {
    if (status === "expired") forgetRoster();
  }, [status, forgetRoster]);

  // Termin mija W TRAKCIE pracy, także bez sieci - wtedy nikt nie odpowie
  // odmową. Sprawdzamy go od razu i co pół minuty na zegarze skorygowanym;
  // przejście w „wygasło" zdejmuje listę osób efektem wyżej.
  const sessionExpiresAt = session?.expiresAt ?? null;
  useEffect(() => {
    if (status !== "ready" || sessionExpiresAt === null) return;
    const check = () => {
      const current = sessionRef.current;
      if (current !== null && isSessionExpired(current, correctedNowIso(clockOffsetRef.current))) {
        setStatus("expired");
      }
    };
    check();
    const timer = window.setInterval(check, EXPIRY_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [status, sessionExpiresAt]);

  // Termin LISTY OSÓB na odstępie, niezależnie od stanu sesji (OPS-06): lista
  // w pamięci znika po swoim terminie, a lista leżąca tylko na dysku (ekran
  // parowania, sesja niepotwierdzona) - przez sprzątanie magazynu.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const nowMs = Date.now() + clockOffsetRef.current;
      const current = rosterRef.current;
      if (current !== null) {
        if (isRosterExpired(current, nowMs)) forgetRoster();
        return;
      }
      void purgeExpiredRoster(nowMs);
    }, ROSTER_EXPIRY_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [forgetRoster]);

  const sessionDeviceId = session?.deviceId ?? null;
  const sessionOffline = session?.offlineRoster ?? false;

  // Lista i dziennik zgód z pamięci urządzenia - dopiero po nich pierwsza
  // synchronizacja (przyrost od wersji z pamięci zamiast pełnej listy).
  useEffect(() => {
    if (status !== "ready" || sessionDeviceId === null) return;
    if (!sessionOffline) {
      // Bezwarunkowo: lista POPRZEDNIEGO poświadczenia leży w pamięci
      // urządzenia także wtedy, gdy ta karta nigdy jej nie wczytała (świeże
      // otwarcie z nowym kodem). Kasowanie jest idempotentne.
      forgetRoster();
      return;
    }
    let cancelled = false;
    void (rosterPurgeRef.current ?? Promise.resolve())
      .then(() => Promise.all([loadRoster(sessionDeviceId), loadDecisionLog()]))
      .then(([snapshot, log]) => {
        if (cancelled) return;
        // `null` = w pamięci nie ma listy TEGO urządzenia. Lista innego (dane
        // osobowe cudzego poświadczenia) znika teraz, a nie dopiero po pierwszej
        // udanej synchronizacji - ta może się nie udać.
        if (snapshot === null) void saveRoster(null);
        logRef.current = log;
        rosterRef.current = snapshot;
        setRoster(snapshot);
        setRosterLoadedFor(sessionDeviceId);
        markOfflinePersistence();
      });
    return () => {
      cancelled = true;
    };
  }, [status, sessionDeviceId, sessionOffline, forgetRoster, markOfflinePersistence]);

  /**
   * Polityki ponownego wejścia z listy offline (OPS-08) - zmiana w panelu
   * w trakcie wydarzenia trafia do sesji (i do jej kopii na dysku, z której
   * startuje skaner bez sieci) bez ponownej konfiguracji.
   */
  const adoptReentryPolicies = useCallback(
    (deviceId: string, updates: readonly CheckpointReentryUpdate[]) => {
      const latest = sessionRef.current;
      if (latest === null || latest.deviceId !== deviceId) return;
      const next = withReentryPolicies(latest, updates);
      if (next === latest) return;
      sessionRef.current = next;
      setSession(next);
      const activeToken = tokenRef.current;
      if (activeToken === null) return;
      const generation = pairingRef.current;
      void sha256Hex(activeToken).then((tokenHash) => {
        if (pairingRef.current !== generation) return;
        void saveCachedSession({
          tokenHash,
          session: next,
          serverOffsetMs: clockOffsetRef.current,
          savedAt: new Date().toISOString(),
        }).then(markOfflinePersistence);
      });
    },
    [markOfflinePersistence],
  );

  /** Strona listy offline niesie znacznik kolejki i polityki punktów. */
  const observeRosterPage = useCallback(
    (deviceId: string, page: RosterPage, generation: number) => {
      if (pairingRef.current !== generation || sessionRef.current?.deviceId !== deviceId) return;
      observeMarker(deviceId, page.queueMarker, generation);
      if (page.checkpoints !== null && page.checkpoints !== undefined) {
        adoptReentryPolicies(deviceId, page.checkpoints);
      }
    },
    [observeMarker, adoptReentryPolicies],
  );

  const syncRoster = useCallback(() => {
    const activeToken = tokenRef.current;
    const current = sessionRef.current;
    if (activeToken === null || current === null || !current.offlineRoster) return;
    if (rosterSyncingRef.current || isOffline()) return;
    rosterSyncingRef.current = true;
    setRosterSyncing(true);
    const generation = pairingRef.current;
    const superseded = () => pairingRef.current !== generation;
    void syncRosterSnapshot({
      deviceId: current.deviceId,
      previous: rosterRef.current,
      // Lista dziedziczy termin poświadczenia - po nim znika z telefonu.
      expiresAt: current.expiresAt,
      // Odłączone parowanie nie pobiera kolejnych stron listy osób.
      fetchPage: (input) =>
        superseded()
          ? Promise.reject(new Error(NO_SESSION))
          : withDeadline(
              fetchScannerRoster({ deviceToken: activeToken, ...input }),
              ROSTER_TIMEOUT_MS,
            ).then((page) => {
              observeRosterPage(current.deviceId, page, generation);
              return page;
            }),
    })
      .then((snapshot) => {
        if (!superseded() && sessionRef.current?.deviceId === current.deviceId) {
          commitRoster(snapshot);
        }
      })
      .catch((error: unknown) => {
        // Odpowiedź dla parowania, które w międzyczasie odłączono albo
        // zamieniono na inne, nie dotyczy już tego ekranu.
        const latest = sessionRef.current;
        if (superseded() || latest?.deviceId !== current.deviceId) return;
        if (scannerErrorHead(error) === "roster_disabled") {
          // Administrator cofnął zgodę: lista znika z telefonu od razu.
          forgetRoster();
          setSession({ ...latest, offlineRoster: false });
          return;
        }
        if (credentialPaused(error)) return;
        if (invalidatesSession(error)) credentialFailed(error);
        // Dławik, nowa synchronizacja, sieć: zostaje poprzednia lista.
      })
      .finally(() => {
        rosterSyncingRef.current = false;
        setRosterSyncing(false);
      });
  }, [commitRoster, credentialFailed, credentialPaused, forgetRoster, observeRosterPage]);

  useEffect(() => {
    if (status !== "ready" || !online || !sessionOffline) return;
    if (sessionDeviceId === null || rosterLoadedFor !== sessionDeviceId) return;
    syncRoster();
    // `syncRoster` sam sprawdza sieć - odstęp nie musi tego powtarzać.
    const timer = window.setInterval(syncRoster, ROSTER_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [status, online, sessionOffline, sessionDeviceId, rosterLoadedFor, syncRoster]);

  /* ----------------------------------------------------------- kolejka --- */

  const flushRef = useRef<() => void>(() => undefined);

  const flush = useCallback(() => {
    const activeToken = tokenRef.current;
    if (activeToken === null) return;
    if (statusRef.current !== "ready" && statusRef.current !== "expired") return;
    if (flushingRef.current) {
      // Powrót sieci w trakcie przebiegu - po nim ruszy następny, od razu.
      flushAgainRef.current = true;
      return;
    }
    const due = dueItems(outboxRef.current, new Date().toISOString());
    if (due.length === 0) return;

    flushingRef.current = true;
    setFlushing(true);
    let sent = 0;
    let conflictCount = 0;
    let rejectedCount = 0;
    let transientStreak = 0;
    // Pokolenie parowania tego przebiegu - patrz nagłówek („PAROWANIE MA POKOLENIE").
    const generation = pairingRef.current;
    const superseded = () => pairingRef.current !== generation;
    /** Przebieg SAM zakończył parowanie (odmowa poświadczenia) - jego raport zostaje. */
    let endedPairing = false;

    const runNext = async (index: number): Promise<void> => {
      if (index >= due.length) return;
      // Odłączenie albo nowe parowanie w trakcie przebiegu - koniec.
      if (superseded() || tokenRef.current !== activeToken) return;
      // Najświeższa postać pozycji: mogła zostać usunięta, zamrożona albo
      // otwarta kluczem po wyliczeniu listy do wysłania.
      const item = outboxRef.current.find((row) => row.id === due[index].id);
      if (item === undefined || isRejectedItem(item)) {
        await runNext(index + 1);
        return;
      }
      try {
        // Pozycja spod INNEGO poświadczenia (telefon przepięty na inne
        // urządzenie) wysłana bieżącym tokenem trafiłaby do cudzego partnera
        // albo punktu - odrzucamy ją lokalnie, bez wołania bazy.
        const queuedFor = item.deviceId ?? null;
        const sessionDevice = sessionRef.current?.deviceId ?? null;
        if (queuedFor !== null && queuedFor !== sessionDevice) {
          throw new Error(DEVICE_MISMATCH);
        }
        // Kod niedostępny w tej karcie (blok bez klucza) - pozycja nie wyjedzie,
        // ale nie ginie: idzie na listę odrzuconych ze skrótem i prefiksem.
        if (item.code === "") throw new Error(OUTBOX_SEALED);
        const marker = item.queueMarker ?? null;
        // Znacznik z odpowiedzi należy do urządzenia, które wysłało żądanie.
        const requestDevice = queuedFor ?? sessionDevice;
        if (item.kind === "checkin") {
          const result = await withDeadline(
            recordCheckinScan({
              deviceToken: activeToken,
              code: item.code,
              checkpointId: item.checkpointId,
              direction: item.direction ?? "in",
              clientScanUid: item.id,
              deviceScannedAt: item.deviceScannedAt,
              queued: true,
              offlineAdmitted: item.offlineAdmitted,
              offlineOutcome: item.offlineOutcome,
              rosterGeneratedAt: item.rosterGeneratedAt,
              ...(marker === null ? {} : { queueMarker: marker }),
            }),
            FLUSH_TIMEOUT_MS,
          );
          // Odpowiedź spóźniona względem „Odłącz" albo nowego parowania: nic
          // nie trafia na dysk ani na ekran (konflikt niesie imię i nazwisko).
          if (superseded()) return;
          observeMarker(requestDevice, result.queueMarker, generation);
          const conflict = detectConflict(item, result, new Date().toISOString());
          if (conflict !== null) {
            conflictCount += 1;
            commitConflict(conflict, generation);
          }
        } else {
          const result = await withDeadline(
            recordLeadScan({
              deviceToken: activeToken,
              code: item.code,
              note: item.note,
              interestRating: item.interestRating,
              deviceScannedAt: item.deviceScannedAt,
              queued: true,
              ...(marker === null ? {} : { queueMarker: marker }),
            }),
            FLUSH_TIMEOUT_MS,
          );
          if (superseded()) return;
          observeMarker(requestDevice, result.queueMarker, generation);
        }
        sent += 1;
        transientStreak = 0;
        persist(withoutItem(outboxRef.current, item.id));
      } catch (error: unknown) {
        // Odmowa dla parowania, którego już nie ma, nie zamraża pozycji, nie
        // zdejmuje listy osób i nie kończy NOWEJ sesji (`dropSession` przekreśliłby
        // parowanie, które właśnie trwa).
        if (superseded()) return;
        const message = scannerErrorText(error);
        const nowIso = new Date().toISOString();
        const disposition = outboxDisposition(error);
        switch (disposition) {
          case "hold":
            // Wstrzymanie dotyczy całego poświadczenia i jest odwracalne:
            // pozycje zostają nietknięte, przebieg się kończy, a tykający odstęp
            // spróbuje znowu po „Wznów".
            credentialPaused(error);
            return;
          case "reject_all": {
            // Odmowa poświadczenia dotyczy WSZYSTKICH jego pozycji, nie tylko
            // tej - idą na listę odrzuconych (z eksportem), zamiast dobijać się
            // nimi dwadzieścia razy albo zniknąć po cichu. Pozycje zamknięte
            // blokiem innego tokenu zostają (jak przy `dropSession`).
            const all = rejectAll(
              outboxRef.current.filter(belongsToActiveCredential),
              message,
              nowIso,
            );
            rejectedCount += all.length;
            persist(markRejected(outboxRef.current, all));
            transferRejected(all, generation);
            endedPairing = true;
            credentialFailed(error);
            return;
          }
          case "retry": {
            // Przejściowe: tylko termin następnej próby, bez limitu prób.
            persist(withFailure(outboxRef.current, item.id, message, nowIso).queue);
            transientStreak += 1;
            if (stopsFlushRun(error) || transientStreak >= TRANSIENT_STREAK_LIMIT) return;
            break;
          }
          case "reject":
          case "reject_expired": {
            // Termin baza liczy PER POZYCJA (`_event_scanner_device_auth_sync`
            // porównuje chwilę skanu i znacznik kolejki z terminem): skan sprzed
            // terminu ze znacznikiem przechodzi jeszcze 72 h, więc odrzucamy
            // tylko tę pozycję i jedziemy dalej.
            const failure = withFailure(outboxRef.current, item.id, message, nowIso);
            persist(failure.queue);
            if (failure.rejected !== null) {
              rejectedCount += 1;
              transferRejected([failure.rejected], generation);
            }
            if (disposition === "reject_expired") credentialFailed(error);
            break;
          }
        }
      }
      await runNext(index + 1);
    };

    void runNext(0).finally(() => {
      flushingRef.current = false;
      setFlushing(false);
      // Raport przebiegu, którego parowanie zakończył KTOŚ INNY (odłączenie
      // wyzerowało raport celowo, nowe parowanie ma własny), nie trafia na ekran.
      const reportable = !superseded() || endedPairing;
      if (reportable && sent + conflictCount + rejectedCount > 0) {
        flushSeqRef.current += 1;
        setLastFlush({
          sent,
          conflicts: conflictCount,
          rejected: rejectedCount,
          seq: flushSeqRef.current,
        });
      }
      if (flushAgainRef.current) {
        flushAgainRef.current = false;
        flushRef.current();
      }
    });
  }, [
    persist,
    commitConflict,
    transferRejected,
    credentialFailed,
    credentialPaused,
    observeMarker,
  ]);
  flushRef.current = flush;

  /** Zeruje wycofanie (wszystkich albo wskazanych pozycji) i od razu wysyła. */
  const wakeQueue = useCallback(
    (ids?: readonly string[]) => {
      const current = outboxRef.current;
      const next = resetBackoff(current, new Date().toISOString(), ids);
      if (next !== current) persist([...next]);
      flush();
    },
    [persist, flush],
  );

  const retry = useCallback((id: string) => wakeQueue([id]), [wakeQueue]);
  const retryAll = useCallback(() => wakeQueue(), [wakeQueue]);

  /* -------------------------------------------------------------- sieć --- */

  // Efekty biegną wyłącznie w przeglądarce (trasa ma `ssr: false`), więc
  // `window` jest tu zawsze. Powrót sieci i powrót karty na wierzch zerują
  // wycofanie i od razu wysyłają kolejkę (OPS-05).
  const wakeRef = useRef(wakeQueue);
  wakeRef.current = wakeQueue;
  useEffect(() => {
    setOnline(!isOffline());
    const goOnline = () => {
      setOnline(true);
      wakeRef.current();
    };
    const goOffline = () => setOnline(false);
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !isOffline()) wakeRef.current();
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Powrót sieci i tykający odstęp - patrz nagłówek. Wygasłe poświadczenie
  // też wysyła: baza przyjmuje skany sprzed terminu jeszcze przez 72 h - te,
  // które niosą znacznik kolejki z chwili kolejkowania (OPS-12).
  const flushable = status === "ready" || status === "expired";
  useEffect(() => {
    if (!flushable) return;
    if (online) flush();
    const timer = window.setInterval(() => {
      if (!isOffline()) flush();
    }, FLUSH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [flushable, online, flush]);

  const discard = useCallback(
    (id: string) => {
      persist(withoutItem(outboxRef.current, id));
    },
    [persist],
  );

  const clearSyncIssues = useCallback(() => {
    rejectedRef.current = [];
    setRejected([]);
    conflictsRef.current = [];
    setConflicts([]);
    void clearStoredSyncIssues();
  }, []);

  /* -------------------------------------------------------------- skany --- */

  /**
   * Dokłada skan do kolejki - ze skrótem i prefiksem kodu (lista odrzuconych,
   * eksport) i ze ZNACZNIKIEM KOLEJKI aktualnym TERAZ (OPS-12): baza po terminie
   * poświadczenia przyjmie skan tylko ze znacznikiem wydanym najwyżej kwadrans
   * po skanie, więc stempel z chwili wysyłki byłby za młody.
   */
  const queue = useCallback(
    async (item: OutboxItem, generation: number): Promise<boolean> => {
      const marker = item.queueMarker ?? queueMarkerFor(markerRef.current, item.deviceId);
      const codeHash = item.codeHash ?? (await scanCodeHash(item.code));
      // `false` = parowanie skończyło się w trakcie (odłączenie, nowe parowanie):
      // skan nie trafia do kolejki, którą odłączenie właśnie skasowało, ani do
      // kolejki innego urządzenia - wołający mówi operatorowi, że nie zapisano.
      if (pairingRef.current !== generation) return false;
      const fingerprinted: OutboxItem = {
        ...item,
        codeHash,
        codePrefix: item.codePrefix ?? codePrefixOf(item.code),
        ...(marker === null ? {} : { queueMarker: marker }),
      };
      const { queue: next, overflow } = enqueueScanWithOverflow(outboxRef.current, fingerprinted);
      persist(next);
      // Wypchnięte przepełnieniem nie znikają - idą na listę odrzuconych.
      // Pozycja już zamrożona jest na tej liście, więc `rejectAll` ją pomija.
      if (overflow.length > 0) {
        void commitRejected(
          rejectAll(overflow, OUTBOX_OVERFLOW, new Date().toISOString()),
          generation,
        );
      }
      return true;
    },
    [persist, commitRejected],
  );

  /**
   * Termin poświadczenia na zegarze skorygowanym - sprawdzany PRZED skanem,
   * bo bez sieci nikt inny nie powie, że urządzenie już nie ma prawa wpuszczać.
   */
  const assertNotExpired = useCallback(() => {
    const current = sessionRef.current;
    if (current === null || !isSessionExpired(current, correctedNowIso(clockOffsetRef.current))) {
      return;
    }
    setStatus("expired");
    throw new Error(EXPIRED_ON_DEVICE);
  }, []);

  /** Decyzja z listy offline - `null`, gdy lista (albo punkt) jest nieznana. */
  const decideLocally = useCallback(
    (
      codeHash: string,
      checkpointId: string | null,
      direction: CheckinDirection,
      atMs: number,
    ): OfflineDecision | null => {
      const snapshot = rosterRef.current;
      const current = sessionRef.current;
      if (snapshot === null || current === null || !current.offlineRoster) return null;
      const checkpoint = findCheckpoint(current, checkpointId);
      if (checkpoint === null) return null;
      // Bilet ALBO identyfikator; kod zastąpiony to odmowa, nie „nieznany kod".
      const match = matchRoster(rosterIndexRef.current, codeHash);
      const decision = decideOffline({
        entry: match.entry,
        superseded: match.superseded,
        checkpoint,
        direction,
        log: logRef.current,
        nowMs: atMs,
        rosterGeneratedAt: snapshot.generatedAt,
        // Doba „w środku" (OPS-08) liczy się w strefie WYDARZENIA.
        timezone: current.event.timezone,
      });
      if (decision.outcome === "granted" && decision.entry !== null) {
        logGrant({
          checkpointId: checkpoint.id,
          registrationId: decision.entry.registrationId,
          direction,
          at: new Date(atMs).toISOString(),
        });
      }
      return decision;
    },
    [logGrant],
  );

  const submitCheckin = useCallback(
    async (input: {
      code: string;
      checkpointId: string | null;
      direction: CheckinDirection;
    }): Promise<QueuedScanOutcome | SentCheckinOutcome> => {
      const activeToken = tokenRef.current;
      if (activeToken === null) throw new Error(NO_SESSION);
      assertNotExpired();
      // Pokolenie parowania tego skanu - patrz nagłówek („PAROWANIE MA POKOLENIE").
      const generation = pairingRef.current;
      const superseded = () => pairingRef.current !== generation;
      const id = newClientScanUid();
      const atMs = Date.now() + clockOffsetRef.current;
      const scannedAt = new Date(atMs).toISOString();

      const item: OutboxItem = {
        id,
        kind: "checkin",
        code: input.code,
        checkpointId: input.checkpointId,
        direction: input.direction,
        note: null,
        interestRating: null,
        deviceScannedAt: scannedAt,
        attempts: 0,
        nextAttemptAt: new Date().toISOString(),
        lastError: null,
        deviceId: sessionRef.current?.deviceId ?? null,
      };

      const queueWithDecision = async (): Promise<QueuedScanOutcome> => {
        // Ten sam skrót, pod którym bilet zna lista offline i baza.
        const codeHash = await scanCodeHash(input.code);
        // Parowanie skończyło się w trakcie - bez zgody w dzienniku i bez kolejki.
        if (superseded()) throw new Error(NO_SESSION);
        const local = decideLocally(codeHash, input.checkpointId, input.direction, atMs);
        // Kod zastąpiony jedzie BEZ decyzji offline - baza odpowie tym samym
        // `code_superseded` i nie zapisze wiersza (`queuedOfflineDecision`).
        const offline = local === null ? null : queuedOfflineDecision(local);
        if (!(await queue({ ...item, codeHash, ...(offline ?? {}) }, generation))) {
          throw new Error(NO_SESSION);
        }
        return { queued: true, local };
      };

      if (isOffline()) return queueWithDecision();

      try {
        const result = await withDeadline(
          recordCheckinScan({
            deviceToken: activeToken,
            code: input.code,
            checkpointId: input.checkpointId,
            direction: input.direction,
            clientScanUid: id,
            deviceScannedAt: scannedAt,
          }),
          SCAN_TIMEOUT_MS,
        );
        // Baza skan przyjęła, ale parowanie już nie istnieje: znacznik i dziennik
        // zgód należały do niego - wynik wraca do ekranu bez śladu na telefonie.
        if (superseded()) return { queued: false, result };
        observeMarker(item.deviceId, result.queueMarker, generation);
        // Zgoda online też trafia do dziennika zgód - powtórne piknięcie
        // po utracie sieci ma dać „już odprawiony", a nie drugą zgodę.
        const registrationId = result.person?.registrationId ?? null;
        if (
          sessionRef.current?.offlineRoster === true &&
          result.result === "granted" &&
          registrationId !== null &&
          result.checkpoint.id !== null
        ) {
          logGrant({
            checkpointId: result.checkpoint.id,
            registrationId,
            direction: input.direction,
            at: scannedAt,
          });
        }
        return { queued: false, result };
      } catch (error: unknown) {
        // Odmowa poświadczenia albo błąd ładunku nie stanie się poprawna po
        // odczekaniu - podajemy ją operatorowi zamiast chować w kolejce.
        // Odmowa POŚWIADCZENIA dodatkowo kończy sesję: lista osób znika
        // z telefonu od razu, a nie dopiero przy następnej wysyłce kolejki.
        // Wstrzymanie zdejmuje samą listę - sesja czeka na „Wznów".
        // Parowanie skończone w trakcie: ani kolejki, ani końca NOWEJ sesji.
        if (superseded()) throw new Error(NO_SESSION);
        if (credentialPaused(error)) throw error;
        switch (LIVE_SCAN_FAILURE[scanErrorKind(error)]) {
          case "end_session":
            credentialFailed(error);
            throw error;
          case "queue":
            // Sieć, termin żądania, dławik i blokada czasowa (OPS-04): decyzja
            // z listy offline, podpisana jako offline, i skan w kolejce.
            return queueWithDecision();
          case "rethrow":
            throw error;
        }
      }
    },
    [
      queue,
      decideLocally,
      logGrant,
      credentialFailed,
      credentialPaused,
      assertNotExpired,
      observeMarker,
    ],
  );

  const submitLead = useCallback(
    async (input: {
      code: string;
      note: string | null;
      interestRating: number | null;
    }): Promise<QueuedScanOutcome | SentLeadOutcome> => {
      const activeToken = tokenRef.current;
      if (activeToken === null) throw new Error(NO_SESSION);
      assertNotExpired();
      const generation = pairingRef.current;
      const superseded = () => pairingRef.current !== generation;
      const scannedAt = correctedNowIso(clockOffsetRef.current);
      const item: OutboxItem = {
        id: newClientScanUid(),
        kind: "lead",
        code: input.code,
        checkpointId: null,
        direction: null,
        note: input.note,
        interestRating: input.interestRating,
        deviceScannedAt: scannedAt,
        attempts: 0,
        nextAttemptAt: new Date().toISOString(),
        lastError: null,
        deviceId: sessionRef.current?.deviceId ?? null,
      };

      /** Lead nie ma decyzji offline - tylko czeka w kolejce. */
      const queueLead = async (): Promise<QueuedScanOutcome> => {
        if (!(await queue(item, generation))) throw new Error(NO_SESSION);
        return { queued: true, local: null };
      };

      if (isOffline()) return queueLead();

      try {
        const result = await withDeadline(
          recordLeadScan({
            deviceToken: activeToken,
            code: input.code,
            note: input.note,
            interestRating: input.interestRating,
            deviceScannedAt: scannedAt,
          }),
          SCAN_TIMEOUT_MS,
        );
        if (superseded()) return { queued: false, result };
        observeMarker(item.deviceId, result.queueMarker, generation);
        return { queued: false, result };
      } catch (error: unknown) {
        if (superseded()) throw new Error(NO_SESSION);
        if (credentialPaused(error)) throw error;
        switch (LIVE_SCAN_FAILURE[scanErrorKind(error)]) {
          case "end_session":
            credentialFailed(error);
            throw error;
          case "queue":
            return queueLead();
          case "rethrow":
            throw error;
        }
      }
    },
    [queue, credentialFailed, credentialPaused, assertNotExpired, observeMarker],
  );

  return {
    status,
    session,
    token,
    connectError,
    connect,
    disconnect,
    online,
    outbox,
    outboxCounts: outboxCounts(outbox),
    outboxPersistent,
    flushing,
    flush,
    retry,
    retryAll,
    discard,
    submitCheckin,
    submitLead,
    sessionStale,
    clockOffsetMs: clockOffset,
    clockSkewed: isClockSkewed(clockOffset),
    roster: {
      enabled: sessionOffline,
      generatedAt: roster?.generatedAt ?? null,
      count: roster?.rows.length ?? 0,
      syncing: rosterSyncing,
    },
    syncRoster,
    rejected,
    conflicts,
    clearSyncIssues,
    offlineStoragePersistent: offlinePersistent,
    lastFlush,
  };
}
