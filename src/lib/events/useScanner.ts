// Środowisko uruchomieniowe skanera: poświadczenie, sieć, kolejka skanów.
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
import { useCallback, useEffect, useRef, useState } from "react";

import {
  bootstrapScanner,
  recordCheckinScan,
  recordLeadScan,
  type CheckinScanResult,
  type LeadScanResult,
} from "@/lib/events/scannerApi";
import {
  dueItems,
  enqueueScan,
  outboxCounts,
  withFailure,
  withoutItem,
  type OutboxCounts,
  type OutboxItem,
} from "@/lib/events/scannerOutbox";
import {
  clearStoredToken,
  isOutboxPersistent,
  loadOutbox,
  readStoredToken,
  saveOutbox,
  writeStoredToken,
} from "@/lib/events/scannerStorage";
import { isScannerToken, isSessionExpired, type ScannerSession } from "@/lib/events/scannerSession";
import { invalidatesSession, scannerErrorText } from "@/lib/events/scannerErrors";
import type { CheckinDirection } from "@/lib/events/onsiteEnums";

/** Co ile próbować opróżnić kolejkę, gdy coś w niej stoi. */
const FLUSH_INTERVAL_MS = 15_000;

export type ScannerStatus = "idle" | "connecting" | "ready" | "expired";

export interface QueuedScanOutcome {
  queued: true;
}

export interface SentCheckinOutcome {
  queued: false;
  result: CheckinScanResult;
}

export interface SentLeadOutcome {
  queued: false;
  result: LeadScanResult;
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
  const [online, setOnline] = useState(true);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [outboxPersistent, setOutboxPersistent] = useState(true);
  const [flushing, setFlushing] = useState(false);

  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;
  const outboxRef = useRef<OutboxItem[]>([]);
  outboxRef.current = outbox;
  const flushingRef = useRef(false);

  const persist = useCallback((next: OutboxItem[]) => {
    outboxRef.current = next;
    setOutbox(next);
    void saveOutbox(next).then(() => setOutboxPersistent(isOutboxPersistent()));
  }, []);

  /* ------------------------------------------------------- poświadczenie --- */

  const connect = useCallback((candidate: string) => {
    const clean = candidate.trim();
    if (!isScannerToken(clean)) {
      setConnectError("invalid_device_token: malformed");
      return;
    }
    setStatus("connecting");
    setConnectError(null);
    bootstrapScanner(clean)
      .then((next) => {
        writeStoredToken(clean);
        setToken(clean);
        setSession(next);
        setStatus(isSessionExpired(next, new Date().toISOString()) ? "expired" : "ready");
      })
      .catch((error: unknown) => {
        setStatus("idle");
        setConnectError(scannerErrorText(error));
        // Poświadczenie odrzucone przez bazę nie ma po co zostawać na
        // urządzeniu - następne otwarcie ekranu próbowałoby go znowu.
        if (invalidatesSession(error)) clearStoredToken();
      });
  }, []);

  const disconnect = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setSession(null);
    setStatus("idle");
    setConnectError(null);
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

  /* -------------------------------------------------------------- sieć --- */

  useEffect(() => {
    if (typeof window === "undefined") return;
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

  /* ----------------------------------------------------------- kolejka --- */

  const flush = useCallback(() => {
    const activeToken = tokenRef.current;
    if (activeToken === null || flushingRef.current) return;
    const due = dueItems(outboxRef.current, new Date().toISOString());
    if (due.length === 0) return;

    flushingRef.current = true;
    setFlushing(true);

    const runNext = async (index: number): Promise<void> => {
      if (index >= due.length) return;
      const item = due[index];
      try {
        if (item.kind === "checkin") {
          await recordCheckinScan({
            deviceToken: activeToken,
            code: item.code,
            checkpointId: item.checkpointId,
            direction: item.direction ?? "in",
            clientScanUid: item.id,
            deviceScannedAt: item.deviceScannedAt,
          });
        } else {
          await recordLeadScan({
            deviceToken: activeToken,
            code: item.code,
            note: item.note,
            interestRating: item.interestRating,
          });
        }
        persist(withoutItem(outboxRef.current, item.id));
      } catch (error: unknown) {
        persist(
          withFailure(
            outboxRef.current,
            item.id,
            scannerErrorText(error),
            new Date().toISOString(),
          ),
        );
        // Odmowa poświadczenia dotyczy WSZYSTKICH pozycji, nie tylko tej -
        // przerywamy przebieg, zamiast dobijać się nim dwadzieścia razy.
        if (invalidatesSession(error)) return;
      }
      await runNext(index + 1);
    };

    void runNext(0).finally(() => {
      flushingRef.current = false;
      setFlushing(false);
    });
  }, [persist]);

  // Powrót sieci i tykający odstęp - patrz nagłówek.
  useEffect(() => {
    if (status !== "ready") return;
    if (online) flush();
    const timer = window.setInterval(() => {
      if (!isOffline()) flush();
    }, FLUSH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [status, online, flush]);

  const discard = useCallback(
    (id: string) => {
      persist(withoutItem(outboxRef.current, id));
    },
    [persist],
  );

  /* -------------------------------------------------------------- skany --- */

  const queue = useCallback(
    (item: OutboxItem) => {
      persist(enqueueScan(outboxRef.current, item));
    },
    [persist],
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
      const scannedAt = new Date().toISOString();

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
        nextAttemptAt: scannedAt,
        lastError: null,
      };

      if (isOffline()) {
        queue(item);
        return { queued: true };
      }

      try {
        const result = await recordCheckinScan({
          deviceToken: activeToken,
          code: input.code,
          checkpointId: input.checkpointId,
          direction: input.direction,
          clientScanUid: id,
          deviceScannedAt: scannedAt,
        });
        return { queued: false, result };
      } catch (error: unknown) {
        // Odmowa poświadczenia albo błąd ładunku nie stanie się poprawna po
        // odczekaniu - podajemy ją operatorowi zamiast chować w kolejce.
        if (invalidatesSession(error) || !isRetryable(error)) throw error;
        queue(item);
        return { queued: true };
      }
    },
    [queue],
  );

  const submitLead = useCallback(
    async (input: {
      code: string;
      note: string | null;
      interestRating: number | null;
    }): Promise<QueuedScanOutcome | SentLeadOutcome> => {
      const activeToken = tokenRef.current;
      if (activeToken === null) throw new Error("invalid_device_token: no session");
      const scannedAt = new Date().toISOString();
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
        nextAttemptAt: scannedAt,
        lastError: null,
      };

      if (isOffline()) {
        queue(item);
        return { queued: true };
      }

      try {
        const result = await recordLeadScan({
          deviceToken: activeToken,
          code: input.code,
          note: input.note,
          interestRating: input.interestRating,
        });
        return { queued: false, result };
      } catch (error: unknown) {
        if (invalidatesSession(error) || !isRetryable(error)) throw error;
        queue(item);
        return { queued: true };
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
  };
}

/**
 * Czy warto ponowić ten błąd.
 *
 * Odmowa z bazy niesie ROZPOZNAWALNY prefiks (`invalid_payload:`,
 * `checkpoint_not_found:` …). Awaria sieci nie niesie żadnego - `fetch` rzuca
 * `TypeError: Failed to fetch`. Dlatego ponawiamy dokładnie to, czego baza nie
 * nazwała po imieniu.
 */
function isRetryable(error: unknown): boolean {
  const message = scannerErrorText(error);
  const separator = message.indexOf(":");
  if (separator === -1) return true;
  const head = message.slice(0, separator).trim();
  return !/^[a-z][a-z0-9_]*$/.test(head);
}
