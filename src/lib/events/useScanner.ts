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
//   * ZEGAR. `server_now` z konfiguracji daje przesunięcie zegara urządzenia;
//     czas skanu jest nim korygowany, a ekran ostrzega przy dużej odchyłce.
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
  enqueueScan,
  outboxCounts,
  rejectAll,
  withFailure,
  withoutItem,
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
  isRetryableScanError,
  scannerErrorHead,
  scannerErrorText,
} from "@/lib/events/scannerErrors";
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

  const commitRejected = useCallback(
    (added: readonly RejectedScan[]) => {
      const next = appendRejected(rejectedRef.current, added);
      rejectedRef.current = next;
      setRejected(next);
      void saveRejected(next).then(markOfflinePersistence);
    },
    [markOfflinePersistence],
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

  /** Poświadczenie odrzucone przez bazę: token, sesja i lista znikają. */
  const dropSession = useCallback((message: string) => {
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
  }, []);

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
      dropSession(scannerErrorText(error));
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
      if (mode === "connect" && isOffline()) {
        // Bez sieci nie ma na co czekać: sesja z pamięci od razu, potwierdzenie
        // przy powrocie zasięgu.
        const cached = await cachedFor(clean);
        if (cached !== null) {
          adoptSession(clean, cached.session, cached.serverOffsetMs, true);
          return;
        }
      }
      const sentAt = Date.now();
      try {
        const next = await withDeadline(bootstrapScanner(clean), BOOTSTRAP_TIMEOUT_MS);
        const offset = computeClockOffset(next.serverNow, sentAt, Date.now());
        adoptSession(clean, next, offset, false);
        const tokenHash = await sha256Hex(clean);
        await saveCachedSession({
          tokenHash,
          session: next,
          serverOffsetMs: offset,
          savedAt: new Date().toISOString(),
        });
        markOfflinePersistence();
      } catch (error: unknown) {
        if (invalidatesSession(error)) {
          if (scannerErrorHead(error) === "device_expired") {
            const cached = await cachedFor(clean);
            if (cached !== null) {
              adoptSession(clean, cached.session, cached.serverOffsetMs, false);
              setStatus("expired");
              return;
            }
          }
          // Poświadczenie odrzucone przez bazę nie ma po co zostawać na
          // urządzeniu - następne otwarcie ekranu próbowałoby go znowu.
          dropSession(scannerErrorText(error));
          return;
        }
        if (mode === "refresh") return;
        if (isRetryableScanError(error)) {
          const cached = await cachedFor(clean);
          if (cached !== null) {
            adoptSession(clean, cached.session, cached.serverOffsetMs, true);
            return;
          }
        }
        setStatus("idle");
        setConnectError(scannerErrorText(error));
      }
    },
    [adoptSession, cachedFor, dropSession, markOfflinePersistence],
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
      void runBootstrap(clean, "connect");
    },
    [runBootstrap],
  );

  const disconnect = useCallback(() => {
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
    void loadOutbox().then((queue) => {
      outboxRef.current = queue;
      setOutbox(queue);
      setOutboxPersistent(isOutboxPersistent());
    });
  }, []);

  // Odrzucone i konflikty z poprzedniej zmiany - scalone z tym, co mogło
  // przybyć, zanim odczyt wrócił.
  useEffect(() => {
    void Promise.all([loadRejected(), loadConflicts()]).then(([storedRejected, storedConflicts]) => {
      const nextRejected = appendRejected(storedRejected, rejectedRef.current);
      rejectedRef.current = nextRejected;
      setRejected(nextRejected);
      const nextConflicts = conflictsRef.current.reduce(appendConflict, storedConflicts);
      conflictsRef.current = nextConflicts;
      setConflicts(nextConflicts);
      markOfflinePersistence();
    });
  }, [markOfflinePersistence]);

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

  const sessionDeviceId = session?.deviceId ?? null;
  const sessionOffline = session?.offlineRoster ?? false;

  // Lista i dziennik zgód z pamięci urządzenia - dopiero po nich pierwsza
  // synchronizacja (przyrost od wersji z pamięci zamiast pełnej listy).
  useEffect(() => {
    if (status !== "ready" || sessionDeviceId === null) return;
    if (!sessionOffline) {
      if (rosterRef.current !== null || logRef.current.length > 0) forgetRoster();
      return;
    }
    let cancelled = false;
    void Promise.all([loadRoster(sessionDeviceId), loadDecisionLog()]).then(([snapshot, log]) => {
      if (cancelled) return;
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
        if (invalidatesSession(error)) credentialFailed(error);
        // Dławik, nowa synchronizacja, sieć: zostaje poprzednia lista.
      })
      .finally(() => {
        rosterSyncingRef.current = false;
        setRosterSyncing(false);
      });
  }, [commitRoster, credentialFailed, forgetRoster]);

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
        if (invalidatesSession(error)) {
          // Odmowa poświadczenia dotyczy WSZYSTKICH pozycji, nie tylko tej -
          // cała kolejka idzie na listę odrzuconych (z eksportem), zamiast
          // dobijać się nią dwadzieścia razy albo zniknąć po cichu.
          const all = rejectAll(outboxRef.current, message, new Date().toISOString());
          rejectedCount += all.length;
          commitRejected(all);
          persist([]);
          credentialFailed(error);
          return;
        }
        const failure = withFailure(outboxRef.current, item.id, message, new Date().toISOString());
        persist(failure.queue);
        if (failure.rejected !== null) {
          rejectedCount += 1;
          commitRejected([failure.rejected]);
        }
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
  }, [persist, commitConflict, commitRejected, credentialFailed]);

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
      persist(enqueueScan(outboxRef.current, item));
    },
    [persist],
  );

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
        if (invalidatesSession(error) || !isRetryableScanError(error)) throw error;
        return queueWithDecision();
      }
    },
    [queue, decideLocally, logGrant],
  );

  const submitLead = useCallback(
    async (input: {
      code: string;
      note: string | null;
      interestRating: number | null;
    }): Promise<QueuedScanOutcome | SentLeadOutcome> => {
      const activeToken = tokenRef.current;
      if (activeToken === null) throw new Error("invalid_device_token: no session");
      const scannedAt = new Date(Date.now() + clockOffsetRef.current).toISOString();
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
        if (invalidatesSession(error) || !isRetryableScanError(error)) throw error;
        queue(item);
        return { queued: true, local: null };
      }
    },
    [queue],
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
