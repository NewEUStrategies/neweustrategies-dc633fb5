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
// KOLEJKA OPRÓŻNIA SIĘ SAMA. Powrót sieci (`online`) i tykający odstęp
// próbują wysłać zaległości bez udziału człowieka - wolontariusz przy bramce
// nie ma jak zauważyć, że zasięg wrócił, a przycisk „wyślij" jest tylko
// awaryjny.
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
//     potem przyrosty co kilka minut i przy powrocie sieci). Skan bez sieci
//     albo po terminie żądania dostaje decyzję z listy (`decideOffline`) -
//     prawdziwy kolor na ekranie, podpisany jako decyzja offline - i jedzie do
//     kolejki razem z tą decyzją.
//   * WYNIK SYNCHRONIZACJI NIE GINIE. Rozbieżność decyzji offline z bazą idzie
//     na listę konfliktów, trwała odmowa na listę odrzuconych (obie trwałe).
//     Odrzucona pozycja schodzi z kolejki DOPIERO po trwałym zapisie listy
//     odrzuconych (`transferRejected`) - kolejka i lista to dwie bazy
//     IndexedDB, a lista bywa tylko w pamięci karty (prywatne okno).
//   * ZEGAR. `server_now` z konfiguracji daje przesunięcie zegara urządzenia;
//     czas skanu jest nim korygowany, a ekran ostrzega przy dużej odchyłce.
//
// POŚWIADCZENIE WYGASA TAKŻE BEZ SIECI. Termin sprawdzamy na zegarze
// skorygowanym - przy każdym skanie i co pół minuty - zamiast czekać na
// odmowę bazy: telefon bez zasięgu inaczej wpuszczałby dalej po terminie
// i trzymał listę osób.
//
// PAROWANIE MA POKOLENIE. Każde połączenie, odłączenie i utrata sesji podbija
// `pairingRef`; odpowiedź `bootstrap`, która wróciła dla starszego pokolenia,
// nie dotyka już stanu (spóźnione potwierdzenie po „Odłącz" wskrzeszałoby
// sesję i zapisywało token z powrotem).
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
import {
  appendRejected,
  dueItems,
  enqueueScanWithOverflow,
  markRejected,
  outboxCounts,
  reconcileRejected,
  rejectAll,
  withFailure,
  withoutItem,
  withoutItems,
  type OutboxCounts,
  type OutboxItem,
  type RejectedScan,
} from "@/lib/events/scannerOutbox";
import {
  clearStoredToken,
  isOutboxPersistent,
  loadOutbox,
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
  loadRejected,
  loadRoster,
  saveCachedSession,
  saveConflicts,
  saveDecisionLog,
  saveRejected,
  saveRoster,
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
  type ScannerSession,
} from "@/lib/events/scannerSession";
import {
  invalidatesSession,
  scanErrorKind,
  scannerErrorHead,
  scannerErrorText,
} from "@/lib/events/scannerErrorKind";
import {
  appendDecisionLog,
  buildRosterIndex,
  decideOffline,
  syncRosterSnapshot,
  type LocalDecisionLogEntry,
  type OfflineDecision,
  type RosterSnapshot,
} from "@/lib/events/scannerRoster";
import { appendConflict, detectConflict, type ScanConflict } from "@/lib/events/scannerSyncIssues";
import { sha256Hex } from "@/lib/events/scannerHash";
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

/** Odmowy lokalne - te same głowy `kod:` co odmowy bazy, więc ten sam słownik. */
const OUTBOX_OVERFLOW = "outbox_overflow: device queue full";
const DEVICE_MISMATCH = "device_mismatch: queued under another credential";
const EXPIRED_ON_DEVICE = "device_expired: expired on device clock";

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
  disconnect: () => void;
  online: boolean;
  outbox: OutboxItem[];
  outboxCounts: OutboxCounts;
  /** `false` = kolejka nie przeżyje zamknięcia karty (prywatne okno). */
  outboxPersistent: boolean;
  flushing: boolean;
  flush: () => void;
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

function newScanId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Awaryjnie, gdy `crypto.randomUUID` nie istnieje: identyfikator ma być
  // niepowtarzalny w obrębie JEDNEGO urządzenia, bo tylko tam służy za klucz
  // idempotencji - kolizja między urządzeniami nie ma jak wystąpić, skoro
  // baza dokłada do klucza identyfikator urządzenia.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** „Teraz" na zegarze serwera - zegar urządzenia plus zmierzone przesunięcie. */
function correctedNowIso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/** `btrim(code)` z bazy tnie WYŁĄCZNIE spacje - skrót musi liczyć się z tego samego. */
function btrimSpaces(value: string): string {
  return value.replace(/^ +| +$/g, "");
}

/**
 * @param initialToken Poświadczenie z adresu (`/scanner?t=…`) albo `null`.
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
  const outboxRef = useRef<OutboxItem[]>([]);
  outboxRef.current = outbox;
  const flushingRef = useRef(false);
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

  const rosterIndex = useMemo(() => buildRosterIndex(roster?.rows ?? []), [roster]);
  const rosterIndexRef = useRef(rosterIndex);
  rosterIndexRef.current = rosterIndex;

  const markOfflinePersistence = useCallback(() => {
    setOfflinePersistent(isOfflineStoragePersistent());
  }, []);

  const persist = useCallback((next: OutboxItem[]) => {
    outboxRef.current = next;
    setOutbox(next);
    void saveOutbox(next).then(() => setOutboxPersistent(isOutboxPersistent()));
  }, []);

  const commitRoster = useCallback(
    (snapshot: RosterSnapshot | null) => {
      rosterRef.current = snapshot;
      setRoster(snapshot);
      void saveRoster(snapshot).then(markOfflinePersistence);
    },
    [markOfflinePersistence],
  );

  /** Dopisuje odrzucone; obietnica mówi, czy lista przeżyje zamknięcie karty. */
  const commitRejected = useCallback(
    (added: readonly RejectedScan[]): Promise<boolean> => {
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
    (added: readonly RejectedScan[]) => {
      if (added.length === 0) return;
      void commitRejected(added).then((durable) => {
        if (!durable) return;
        const ids = added.map((entry) => entry.item.id);
        const next = withoutItems(outboxRef.current, ids);
        if (next.length !== outboxRef.current.length) persist(next);
      });
    },
    [commitRejected, persist],
  );

  const commitConflict = useCallback(
    (conflict: ScanConflict) => {
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
      void wipeOfflineSession();
      if (!ownsQueue) return;
      void (outboxLoadRef.current ?? Promise.resolve()).then(() => {
        // Nowe parowanie w międzyczasie - kolejka należy już do niego.
        if (pairingRef.current !== generation) return;
        const entries = rejectAll(outboxRef.current, message, new Date().toISOString());
        if (entries.length === 0) return;
        persist(markRejected(outboxRef.current, entries));
        transferRejected(entries);
      });
    },
    [persist, transferRejected],
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
      if (mode === "connect" && isOffline()) {
        // Bez sieci nie ma na co czekać: sesja z pamięci od razu, potwierdzenie
        // przy powrocie zasięgu.
        const cached = await cachedFor(clean);
        if (superseded()) return;
        if (cached !== null) {
          adoptSession(clean, cached.session, cached.serverOffsetMs, true);
          return;
        }
      }
      const sentAt = Date.now();
      try {
        const next = await withDeadline(bootstrapScanner(clean), BOOTSTRAP_TIMEOUT_MS);
        if (superseded()) return;
        const offset = computeClockOffset(next.serverNow, sentAt, Date.now());
        adoptSession(clean, next, offset, false);
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
              adoptSession(clean, cached.session, cached.serverOffsetMs, false);
              setStatus("expired");
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
            adoptSession(clean, cached.session, cached.serverOffsetMs, true);
            return;
          }
        }
        setStatus("idle");
        setConnectError(scannerErrorText(error));
      }
    },
    [adoptSession, cachedFor, credentialPaused, dropSession, markOfflinePersistence],
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

  const disconnect = useCallback(() => {
    pairingRef.current += 1;
    clearStoredToken();
    setToken(null);
    setSession(null);
    setSessionStale(false);
    setStatus("idle");
    setConnectError(null);
    rosterRef.current = null;
    setRoster(null);
    setRosterLoadedFor(null);
    logRef.current = [];
    void wipeOfflineSession();
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

  // Kolejka z poprzedniej zmiany - wczytujemy raz, zanim ktokolwiek zeskanuje.
  useEffect(() => {
    outboxLoadRef.current = loadOutbox().then((queue) => {
      outboxRef.current = queue;
      setOutbox(queue);
      setOutboxPersistent(isOutboxPersistent());
    });
  }, []);

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
      transferRejected(orphans);
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

  /* -------------------------------------------------------------- sieć --- */

  // Efekty biegną wyłącznie w przeglądarce (trasa ma `ssr: false`), więc
  // `window` jest tu zawsze.
  useEffect(() => {
    setOnline(!isOffline());
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

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
    void Promise.all([loadRoster(sessionDeviceId), loadDecisionLog()]).then(([snapshot, log]) => {
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

  const syncRoster = useCallback(() => {
    const activeToken = tokenRef.current;
    const current = sessionRef.current;
    if (activeToken === null || current === null || !current.offlineRoster) return;
    if (rosterSyncingRef.current || isOffline()) return;
    rosterSyncingRef.current = true;
    setRosterSyncing(true);
    void syncRosterSnapshot({
      deviceId: current.deviceId,
      previous: rosterRef.current,
      fetchPage: (input) =>
        withDeadline(fetchScannerRoster({ deviceToken: activeToken, ...input }), ROSTER_TIMEOUT_MS),
    })
      .then((snapshot) => {
        if (sessionRef.current?.deviceId === current.deviceId) commitRoster(snapshot);
      })
      .catch((error: unknown) => {
        // Odpowiedź dla urządzenia, które w międzyczasie odłączono albo
        // zamieniono na inne, nie dotyczy już tego ekranu.
        const latest = sessionRef.current;
        if (latest?.deviceId !== current.deviceId) return;
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
  }, [commitRoster, credentialFailed, credentialPaused, forgetRoster]);

  useEffect(() => {
    if (status !== "ready" || !online || !sessionOffline) return;
    if (sessionDeviceId === null || rosterLoadedFor !== sessionDeviceId) return;
    syncRoster();
    // `syncRoster` sam sprawdza sieć - odstęp nie musi tego powtarzać.
    const timer = window.setInterval(syncRoster, ROSTER_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [status, online, sessionOffline, sessionDeviceId, rosterLoadedFor, syncRoster]);

  /* ----------------------------------------------------------- kolejka --- */

  const flush = useCallback(() => {
    const activeToken = tokenRef.current;
    if (activeToken === null || flushingRef.current) return;
    const due = dueItems(outboxRef.current, new Date().toISOString());
    if (due.length === 0) return;

    flushingRef.current = true;
    setFlushing(true);
    let sent = 0;
    let conflictCount = 0;
    let rejectedCount = 0;

    const runNext = async (index: number): Promise<void> => {
      if (index >= due.length) return;
      const item = due[index];
      try {
        // Pozycja spod INNEGO poświadczenia (telefon przepięty na inne
        // urządzenie) wysłana bieżącym tokenem trafiłaby do cudzego partnera
        // albo punktu - odrzucamy ją lokalnie, bez wołania bazy.
        const queuedFor = item.deviceId ?? null;
        if (queuedFor !== null && queuedFor !== sessionRef.current?.deviceId) {
          throw new Error(DEVICE_MISMATCH);
        }
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
            }),
            FLUSH_TIMEOUT_MS,
          );
          const conflict = detectConflict(item, result, new Date().toISOString());
          if (conflict !== null) {
            conflictCount += 1;
            commitConflict(conflict);
          }
        } else {
          await withDeadline(
            recordLeadScan({
              deviceToken: activeToken,
              code: item.code,
              note: item.note,
              interestRating: item.interestRating,
              deviceScannedAt: item.deviceScannedAt,
              queued: true,
            }),
            FLUSH_TIMEOUT_MS,
          );
        }
        sent += 1;
        persist(withoutItem(outboxRef.current, item.id));
      } catch (error: unknown) {
        const message = scannerErrorText(error);
        // Wstrzymanie dotyczy całego poświadczenia i jest odwracalne: pozycje
        // zostają nietknięte (bez licznika prób - nie utkną w „wymaga uwagi"),
        // przebieg się kończy, a tykający odstęp spróbuje znowu po „Wznów".
        if (credentialPaused(error)) return;
        const expired = scannerErrorHead(error) === "device_expired";
        if (invalidatesSession(error) && !expired) {
          // Odmowa poświadczenia dotyczy WSZYSTKICH pozycji, nie tylko tej -
          // cała kolejka idzie na listę odrzuconych (z eksportem), zamiast
          // dobijać się nią dwadzieścia razy albo zniknąć po cichu.
          const all = rejectAll(outboxRef.current, message, new Date().toISOString());
          rejectedCount += all.length;
          persist(markRejected(outboxRef.current, all));
          transferRejected(all);
          credentialFailed(error);
          return;
        }
        // Termin baza liczy PER POZYCJA (`_event_scanner_device_auth_sync`
        // porównuje chwilę skanu z terminem): skan sprzed terminu przechodzi
        // jeszcze 72 h, więc odrzucamy tylko tę pozycję i jedziemy dalej.
        const failure = withFailure(outboxRef.current, item.id, message, new Date().toISOString());
        persist(failure.queue);
        if (failure.rejected !== null) {
          rejectedCount += 1;
          transferRejected([failure.rejected]);
        }
        if (expired) credentialFailed(error);
      }
      await runNext(index + 1);
    };

    void runNext(0).finally(() => {
      flushingRef.current = false;
      setFlushing(false);
      if (sent + conflictCount + rejectedCount > 0) {
        flushSeqRef.current += 1;
        setLastFlush({
          sent,
          conflicts: conflictCount,
          rejected: rejectedCount,
          seq: flushSeqRef.current,
        });
      }
    });
  }, [persist, commitConflict, transferRejected, credentialFailed, credentialPaused]);

  // Powrót sieci i tykający odstęp - patrz nagłówek. Wygasłe poświadczenie
  // też wysyła: baza przyjmuje skany sprzed terminu jeszcze przez 72 h.
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

  const queue = useCallback(
    (item: OutboxItem) => {
      const { queue: next, overflow } = enqueueScanWithOverflow(outboxRef.current, item);
      persist(next);
      // Wypchnięte przepełnieniem nie znikają - idą na listę odrzuconych.
      // Pozycja już zamrożona jest na tej liście, więc `rejectAll` ją pomija.
      if (overflow.length > 0) {
        void commitRejected(rejectAll(overflow, OUTBOX_OVERFLOW, new Date().toISOString()));
      }
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
    async (
      code: string,
      checkpointId: string | null,
      direction: CheckinDirection,
      atMs: number,
    ): Promise<OfflineDecision | null> => {
      const snapshot = rosterRef.current;
      const current = sessionRef.current;
      if (snapshot === null || current === null || !current.offlineRoster) return null;
      const checkpoint = findCheckpoint(current, checkpointId);
      if (checkpoint === null) return null;
      const hash = await sha256Hex(btrimSpaces(code));
      const decision = decideOffline({
        entry: rosterIndexRef.current.get(hash) ?? null,
        checkpoint,
        direction,
        log: logRef.current,
        nowMs: atMs,
        rosterGeneratedAt: snapshot.generatedAt,
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
      if (activeToken === null) throw new Error("invalid_device_token: no session");
      assertNotExpired();
      const id = newScanId();
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
        const local = await decideLocally(input.code, input.checkpointId, input.direction, atMs);
        queue(
          local === null
            ? item
            : {
                ...item,
                offlineAdmitted: local.admit,
                offlineOutcome: local.outcome,
                rosterGeneratedAt: local.rosterGeneratedAt,
              },
        );
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
        if (credentialPaused(error)) throw error;
        const kind = scanErrorKind(error);
        if (kind === "session") {
          credentialFailed(error);
          throw error;
        }
        // Blokada czasowa: skan czeka w kolejce, ale BEZ decyzji z listy offline -
        // baza odpowiedziała, tylko jeszcze nie przyjmuje skanów z tego urządzenia.
        if (kind === "locked") {
          queue(item);
          return { queued: true, local: null };
        }
        if (kind !== "transport") throw error;
        return queueWithDecision();
      }
    },
    [queue, decideLocally, logGrant, credentialFailed, credentialPaused, assertNotExpired],
  );

  const submitLead = useCallback(
    async (input: {
      code: string;
      note: string | null;
      interestRating: number | null;
    }): Promise<QueuedScanOutcome | SentLeadOutcome> => {
      const activeToken = tokenRef.current;
      if (activeToken === null) throw new Error("invalid_device_token: no session");
      assertNotExpired();
      const scannedAt = correctedNowIso(clockOffsetRef.current);
      const item: OutboxItem = {
        id: newScanId(),
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

      if (isOffline()) {
        queue(item);
        return { queued: true, local: null };
      }

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
        return { queued: false, result };
      } catch (error: unknown) {
        if (credentialPaused(error)) throw error;
        const kind = scanErrorKind(error);
        if (kind === "session") {
          credentialFailed(error);
          throw error;
        }
        if (kind !== "transport" && kind !== "locked") throw error;
        queue(item);
        return { queued: true, local: null };
      }
    },
    [queue, credentialFailed, credentialPaused, assertNotExpired],
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
