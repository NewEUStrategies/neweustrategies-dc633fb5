// Trwałość TRYBU OFFLINE skanera: sesja bez tokenu, lista offline, dziennik
// zgód, odrzucone skany i konflikty.
//
// OSOBNA BAZA, NIE NOWA WERSJA STAREJ. Kolejka skanów siedzi w `nes-scanner`
// (wersja 1), a jej test pilnuje dosłownych nazw i numeru wersji: podbicie
// wersji zmusiłoby każdą kartę z otwartą kolejką do migracji w chwili, w której
// wolontariusz skanuje. Nowa baza `nes-scanner-offline` nie dotyka kolejki
// w ogóle - a awaria jednej nie gasi drugiej.
//
// JEDEN MAGAZYN, REKORD NA RODZAJ. Każdy rodzaj (sesja, lista, dziennik,
// odrzucone, konflikty) to JEDEN rekord zapisywany w całości - ta sama decyzja
// co w `scannerStorage.ts`: jeden odczyt przy starcie, jeden zapis po zmianie,
// bez kursorów i bez stanu zapisanego w połowie.
//
// BRAK TRWAŁOŚCI TO STAN, NIE AWARIA. Gdy IndexedDB odmawia (prywatne okno,
// zablokowana baza), wszystko żyje w pamięci karty, a `isOfflineStoragePersistent()`
// mówi o tym ekranowi gotowości.
//
// CO KASUJEMY I KIEDY. Lista offline to dane osobowe na cudzym telefonie:
// `wipeOfflineSession()` (sesja, lista, dziennik) biegnie przy odłączeniu
// urządzenia i przy każdej odmowie unieważniającej poświadczenie. ODRZUCONE
// i KONFLIKTY zostają do świadomego wyczyszczenia (`clearSyncIssues()`), bo to
// jedyny ślad skanów, których baza nie przyjęła - skasowanie ich razem
// z sesją byłoby dokładnie tą cichą utratą, którą ten moduł ma zamknąć.
// TOKENU TU NIE MA: sesję rozpoznajemy po skrócie SHA-256 tokenu.
import { parseScannerSession, sessionToRecord, type ScannerSession } from "@/lib/events/scannerSession";
import {
  parseDecisionLog,
  parseRosterSnapshot,
  rosterSnapshotToRecord,
  type LocalDecisionLogEntry,
  type RosterSnapshot,
} from "@/lib/events/scannerRoster";
import type { RejectedScan } from "@/lib/events/scannerOutbox";
import { parseConflicts, parseRejected, type ScanConflict } from "@/lib/events/scannerSyncIssues";

const DB_NAME = "nes-scanner-offline";
const DB_VERSION = 1;
const STORE = "records";

type RecordKey = "session" | "roster" | "log" | "rejected" | "conflicts";

const memory: Partial<Record<RecordKey, unknown>> = {};
let memoryOnly = false;

/** Czy tryb offline przeżyje zamknięcie karty. Ekran gotowości to pokazuje. */
export function isOfflineStoragePersistent(): boolean {
  return !memoryOnly;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = window.indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function readRecord(key: RecordKey): Promise<unknown> {
  const db = await openDb();
  if (db === null) {
    memoryOnly = true;
    return memory[key];
  }
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => {
        db.close();
        resolve(request.result);
      };
      request.onerror = () => {
        memoryOnly = true;
        db.close();
        resolve(memory[key]);
      };
    } catch {
      memoryOnly = true;
      db.close();
      resolve(memory[key]);
    }
  });
}

/** Zapis (`value` = `undefined` kasuje rekord). Nigdy nie rzuca. */
async function writeRecords(entries: ReadonlyArray<readonly [RecordKey, unknown]>): Promise<void> {
  for (const [key, value] of entries) {
    if (value === undefined) delete memory[key];
    else memory[key] = value;
  }
  const db = await openDb();
  if (db === null) {
    memoryOnly = true;
    return;
  }
  await new Promise<void>((resolve) => {
    const done = (failed: boolean) => {
      if (failed) memoryOnly = true;
      db.close();
      resolve();
    };
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const [key, value] of entries) {
        if (value === undefined) store.delete(key);
        else store.put(value, key);
      }
      tx.oncomplete = () => done(false);
      tx.onerror = () => done(true);
      tx.onabort = () => done(true);
    } catch {
      done(true);
    }
  });
}

/* ------------------------------------------------------------- sesja --- */

export interface CachedSession {
  /** sha256 tokenu - rozpoznanie sesji BEZ trzymania tokenu. */
  tokenHash: string;
  session: ScannerSession;
  serverOffsetMs: number;
  savedAt: string;
}

export async function saveCachedSession(value: CachedSession): Promise<void> {
  await writeRecords([
    [
      "session",
      {
        tokenHash: value.tokenHash,
        session: sessionToRecord(value.session),
        serverOffsetMs: value.serverOffsetMs,
        savedAt: value.savedAt,
      },
    ],
  ]);
}

/** Sesja z pamięci - wyłącznie dla TEGO tokenu; inaczej `null`. */
export async function loadCachedSession(tokenHash: string): Promise<CachedSession | null> {
  const raw = await readRecord("session");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (row.tokenHash !== tokenHash) return null;
  const session = parseScannerSession(row.session);
  if (session === null) return null;
  return {
    tokenHash,
    session,
    serverOffsetMs:
      typeof row.serverOffsetMs === "number" && Number.isFinite(row.serverOffsetMs)
        ? row.serverOffsetMs
        : 0,
    savedAt: typeof row.savedAt === "string" ? row.savedAt : "",
  };
}

/* ------------------------------------------------------ lista offline --- */

export async function saveRoster(snapshot: RosterSnapshot | null): Promise<void> {
  await writeRecords([["roster", snapshot === null ? undefined : rosterSnapshotToRecord(snapshot)]]);
}

/** Lista TEGO urządzenia - lista innego poświadczenia na tym telefonie to `null`. */
export async function loadRoster(deviceId: string): Promise<RosterSnapshot | null> {
  const snapshot = parseRosterSnapshot(await readRecord("roster"));
  return snapshot !== null && snapshot.deviceId === deviceId ? snapshot : null;
}

/* ------------------------------------------------- dziennik lokalnych zgód --- */

export async function saveDecisionLog(log: readonly LocalDecisionLogEntry[]): Promise<void> {
  await writeRecords([["log", [...log]]]);
}

export async function loadDecisionLog(): Promise<LocalDecisionLogEntry[]> {
  return parseDecisionLog(await readRecord("log"));
}

/* -------------------------------------------- odrzucone skany i konflikty --- */

export async function saveRejected(list: readonly RejectedScan[]): Promise<void> {
  await writeRecords([["rejected", [...list]]]);
}

export async function loadRejected(): Promise<RejectedScan[]> {
  return parseRejected(await readRecord("rejected"));
}

export async function saveConflicts(list: readonly ScanConflict[]): Promise<void> {
  await writeRecords([["conflicts", [...list]]]);
}

export async function loadConflicts(): Promise<ScanConflict[]> {
  return parseConflicts(await readRecord("conflicts"));
}

/* ------------------------------------------------------------- kasowanie --- */

/** Sesja, lista offline i dziennik zgód - dane osobowe znikają z urządzenia. */
export async function wipeOfflineSession(): Promise<void> {
  await writeRecords([
    ["session", undefined],
    ["roster", undefined],
    ["log", undefined],
  ]);
}

/** Lista offline i dziennik zgód - sesja zostaje (np. wygasłe poświadczenie w oknie). */
export async function wipeRoster(): Promise<void> {
  await writeRecords([
    ["roster", undefined],
    ["log", undefined],
  ]);
}

/** Świadome wyczyszczenie przez operatora - po przekazaniu listy organizatorowi. */
export async function clearSyncIssues(): Promise<void> {
  await writeRecords([
    ["rejected", undefined],
    ["conflicts", undefined],
  ]);
}
