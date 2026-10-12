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
// Świadome ODŁĄCZENIE urządzenia (po potwierdzeniu na ekranie) kasuje
// wszystko naraz (`wipeAllOfflineData`) - telefon po wydarzeniu nie ma
// trzymać nic z tej bazy.
// TOKENU TU NIE MA: sesję rozpoznajemy po skrócie SHA-256 tokenu.
//
// LISTA OSÓB MA TERMIN (OPS-06). Rekord listy niesie termin poświadczenia,
// pod którym ją pobrano; `purgeExpiredRoster` kasuje listę i dziennik zgód po
// tym terminie przy każdym starcie i na odstępie - także na telefonie, na
// którym nikt już nie otworzy skanera tym poświadczeniem. Lista bez terminu
// (sprzed tej zmiany) bierze termin z sesji tego samego urządzenia, a lista
// bez sesji (sierota) znika od razu.
//
// ODRZUCONE BEZ JAWNEGO KODU (OPS-06). Lista odrzuconych trzyma skrót SHA-256
// i prefiks kodu (`toRejectedItem`); lista zapisana przed tą zmianą jest przy
// odczycie przeliczana (skrót z kodu) i przepisywana - jawny kod znika z dysku.
import {
  parseScannerSession,
  sessionToRecord,
  type ScannerSession,
} from "@/lib/events/scannerSession";
import {
  isRosterExpired,
  parseDecisionLog,
  parseRosterSnapshot,
  rosterSnapshotToRecord,
  type LocalDecisionLogEntry,
  type RosterSnapshot,
} from "@/lib/events/scannerRoster";
import { toRejectedItem, type RejectedScan } from "@/lib/events/scannerOutbox";
import { parseConflicts, parseRejected, type ScanConflict } from "@/lib/events/scannerSyncIssues";
import { scanCodeHash } from "@/lib/events/scannerVault";

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
  await writeRecords([
    ["roster", snapshot === null ? undefined : rosterSnapshotToRecord(snapshot)],
  ]);
}

/** Lista TEGO urządzenia - lista innego poświadczenia na tym telefonie to `null`. */
export async function loadRoster(deviceId: string): Promise<RosterSnapshot | null> {
  const snapshot = parseRosterSnapshot(await readRecord("roster"));
  return snapshot !== null && snapshot.deviceId === deviceId ? snapshot : null;
}

/**
 * Kasuje listę osób i dziennik zgód po terminie poświadczenia (patrz nagłówek).
 * `true` = lista zniknęła. Nigdy nie rzuca.
 */
export async function purgeExpiredRoster(nowMs: number): Promise<boolean> {
  const raw = await readRecord("roster");
  if (raw === undefined || raw === null) return false;
  const snapshot = parseRosterSnapshot(raw);
  let expired: boolean;
  if (snapshot === null) {
    // Uszkodzony rekord listy nikomu się nie przyda, a może nieść dane osobowe.
    expired = true;
  } else if (snapshot.expiresAt !== undefined && snapshot.expiresAt !== null) {
    expired = isRosterExpired(snapshot, nowMs);
  } else {
    const cachedRaw = await readRecord("session");
    const cached =
      typeof cachedRaw === "object" && cachedRaw !== null
        ? parseScannerSession((cachedRaw as Record<string, unknown>).session)
        : null;
    expired =
      cached === null ||
      cached.deviceId !== snapshot.deviceId ||
      isRosterExpired({ expiresAt: cached.expiresAt }, nowMs);
  }
  if (expired) await wipeRoster();
  return expired;
}

/* ------------------------------------------------- dziennik lokalnych zgód --- */

export async function saveDecisionLog(log: readonly LocalDecisionLogEntry[]): Promise<void> {
  await writeRecords([["log", [...log]]]);
}

export async function loadDecisionLog(): Promise<LocalDecisionLogEntry[]> {
  return parseDecisionLog(await readRecord("log"));
}

/* -------------------------------------------- odrzucone skany i konflikty --- */

/** Zapis listy odrzuconych - na dysk idzie wyłącznie skrót i prefiks kodu. */
export async function saveRejected(list: readonly RejectedScan[]): Promise<void> {
  await writeRecords([
    ["rejected", list.map((entry) => ({ ...entry, item: toRejectedItem(entry.item) }))],
  ]);
}

/**
 * Wpisy sprzed tej zmiany niosą jawny kod: dostają skrót liczony z kodu (ten
 * sam co w bazie), a `parseRejected` zostawia z kodu tylko prefiks.
 */
async function withLegacyHashes(raw: unknown): Promise<{ value: unknown; legacy: boolean }> {
  if (!Array.isArray(raw)) return { value: raw, legacy: false };
  let legacy = false;
  const value: unknown[] = [];
  for (const entry of raw) {
    const item =
      typeof entry === "object" && entry !== null
        ? (entry as Record<string, unknown>).item
        : undefined;
    const code =
      typeof item === "object" && item !== null
        ? (item as Record<string, unknown>).code
        : undefined;
    if (typeof code !== "string") {
      value.push(entry);
      continue;
    }
    legacy = true;
    const row = item as Record<string, unknown>;
    const codeHash =
      typeof row.codeHash === "string"
        ? row.codeHash
        : code === ""
          ? null
          : await scanCodeHash(code);
    value.push({ ...(entry as Record<string, unknown>), item: { ...row, codeHash } });
  }
  return { value, legacy };
}

export async function loadRejected(): Promise<RejectedScan[]> {
  const { value, legacy } = await withLegacyHashes(await readRecord("rejected"));
  const list = parseRejected(value);
  // Przepisanie: jawny kod sprzed tej zmiany znika z dysku przy pierwszym odczycie.
  if (legacy) await saveRejected(list);
  return list;
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

/**
 * Świadome odłączenie urządzenia (po potwierdzeniu na ekranie): sesja, lista,
 * dziennik, odrzucone i konflikty - telefon nie zatrzymuje niczego z tej bazy.
 */
export async function wipeAllOfflineData(): Promise<void> {
  await writeRecords([
    ["session", undefined],
    ["roster", undefined],
    ["log", undefined],
    ["rejected", undefined],
    ["conflicts", undefined],
  ]);
}
