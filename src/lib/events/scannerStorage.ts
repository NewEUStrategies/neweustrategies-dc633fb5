// Trwałość skanera na urządzeniu: poświadczenie i kolejka skanów.
//
// DWA MIEJSCA, BO DWA RÓŻNE CZASY ŻYCIA. Poświadczenie ma żyć całą imprezę
// i przeżyć zamknięcie karty (wolontariusz nie będzie wpisywał tokenu po
// każdym wygaszeniu ekranu) - stąd `localStorage`. Kolejka skanów bywa liczona
// w setkach pozycji i zapisuje się przy KAŻDYM piknięciu, więc idzie do
// IndexedDB: synchroniczny zapis kilkudziesięciu kilobajtów przy bramce
// zatrzymywałby wątek dokładnie w chwili, w której człowiek patrzy na ekran.
//
// CAŁA KOLEJKA JAKO JEDEN REKORD. Osobny wiersz na skan wymagałby kursorów,
// transakcji na wielu kluczach i obsługi stanu częściowo zapisanego. Kolejka
// jest ograniczona do 500 pozycji po ~300 bajtów, czyli jeden rekord ~150 kB -
// jeden odczyt przy starcie, jeden zapis po zmianie. Prościej i bez klasy
// błędów, której nie da się przetestować przy bramce.
//
// BRAK TRWAŁOŚCI TO STAN, NIE AWARIA. Prywatne okno Safari potrafi odmówić
// IndexedDB, a wtedy skaner NADAL ma działać - tyle że kolejka żyje w pamięci
// karty. Ekran musi o tym powiedzieć, zamiast obiecywać odporność, której nie ma.
//
// KOD Z BILETU NA DYSKU TYLKO ZASZYFROWANY (OPS-06). Rekord pozycji (format 2)
// niesie metadane jawnie (czas, punkt, decyzja offline, skrót i prefiks kodu),
// a kod, notatkę i znacznik kolejki w bloku AES-GCM z kluczem wyprowadzonym
// z tokenu urządzenia (`scannerVault.ts`). Rekordy sprzed tej zmiany (jawny
// `code`) są przepisywane przy pierwszym odczycie. Bez klucza (brak tokenu,
// przeglądarka bez WebCrypto) kod NIE trafia na dysk wcale: rekord zostaje ze
// skrótem i prefiksem, kolejka z kodem żyje w pamięci karty, a ekran ostrzega
// (`isOutboxPersistent() === false`).
//
// ZAPISY IDĄ PO KOLEI. Szyfrowanie jest asynchroniczne - dwa zapisy puszczone
// jeden po drugim mogłyby trafić do bazy w odwrotnej kolejności i starsza
// kolejka nadpisałaby nowszą. Łańcuch `writeChain` zachowuje kolejność, a pamięć
// bloków (`sealCache`) nie szyfruje drugi raz pozycji, której część tajna się
// nie zmieniła.
//
// POŚWIADCZENIE W `localStorage` JEST ŚWIADOMĄ CENĄ. To ten sam kompromis, na
// którym stoi sesja Supabase w tej aplikacji. Ryzyko domyka baza, nie
// przeglądarka: token ma termin, da się go unieważnić jednym kliknięciem
// w panelu, blokuje się po serii nieznanych kodów i otwiera dokładnie jedno
// wydarzenie. Skaner pod OSOBNYM originem (`scannerLink.ts`, OPS-13) trzyma
// token poza zasięgiem treści CMS.
import { parseOutboxItem, type OutboxItem } from "@/lib/events/scannerOutbox";
import {
  codePrefixOf,
  isSealedBlob,
  openSecret,
  scanCodeHash,
  sealSecret,
  type SealedBlob,
  type VaultSecret,
} from "@/lib/events/scannerVault";

/**
 * Klucz poświadczenia w `localStorage`. `__root.tsx` ma KOPIĘ tego literału
 * (sprzątanie resztek pod originem portalu bez importu modułów skanera na
 * ścieżce bootu) - parytet pilnuje `rootRoute.test.tsx`.
 */
export const SCANNER_TOKEN_STORAGE_KEY = "nes.scanner.device-token";
const TOKEN_KEY = SCANNER_TOKEN_STORAGE_KEY;
const DB_NAME = "nes-scanner";
const DB_VERSION = 1;
const STORE = "outbox";
const OUTBOX_KEY = "queue";

/** Wersja rekordu pozycji na dysku: 2 = część tajna w bloku sejfu. */
export const OUTBOX_RECORD_VERSION = 2;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/* ------------------------------------------------------- poświadczenie --- */

export function readStoredToken(): string | null {
  if (!hasWindow()) return null;
  try {
    const value = window.localStorage.getItem(TOKEN_KEY);
    return value === null || value.trim() === "" ? null : value.trim();
  } catch {
    // Pamięć lokalna bywa odcięta polityką przeglądarki - skaner działa dalej,
    // tyle że token trzeba podać po każdym otwarciu karty.
    return null;
  }
}

export function writeStoredToken(token: string): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* patrz wyżej - brak trwałości nie może przerwać pracy przy bramce */
  }
}

export function clearStoredToken(): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* jw. */
  }
}

/* -------------------------------------------------------------- kolejka --- */

/** Kolejka w pamięci karty - używana, gdy IndexedDB jest niedostępne. */
let memoryQueue: OutboxItem[] = [];
let memoryOnly = false;
/** Ostatni zapis musiał pominąć kod (brak klucza) - po zamknięciu karty te pozycje nie wyjadą. */
let lastSaveRedacted = false;
let writeChain: Promise<void> = Promise.resolve();

interface SealCacheEntry {
  key: CryptoKey;
  secret: string;
  blob: SealedBlob;
}

/** Blok pozycji, której część tajna się nie zmieniła, nie jest szyfrowany drugi raz. */
const sealCache = new Map<string, SealCacheEntry>();

/**
 * Czy kolejka przeżyje zamknięcie karty RAZEM z kodami. Ekran pokazuje to
 * operatorowi: `false` także wtedy, gdy przeglądarka nie umie zaszyfrować
 * kolejki - wtedy kod nie trafia na dysk (patrz nagłówek).
 */
export function isOutboxPersistent(): boolean {
  return !memoryOnly && !lastSaveRedacted;
}

function openDb(): Promise<IDBDatabase | null> {
  if (!hasWindow() || typeof window.indexedDB === "undefined") return Promise.resolve(null);
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
    // Zablokowana baza (druga karta w trakcie migracji) nie może zawiesić
    // bramki - po prostu pracujemy z pamięci.
    request.onblocked = () => resolve(null);
  });
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function secretOf(item: OutboxItem): VaultSecret {
  return { code: item.code, note: item.note, queueMarker: item.queueMarker ?? null };
}

async function sealedFor(item: OutboxItem, key: CryptoKey): Promise<SealedBlob> {
  const secret = secretOf(item);
  const fingerprint = JSON.stringify(secret);
  const cached = sealCache.get(item.id);
  if (cached !== undefined && cached.key === key && cached.secret === fingerprint) {
    return cached.blob;
  }
  const blob = await sealSecret(key, item.id, secret);
  sealCache.set(item.id, { key, secret: fingerprint, blob });
  return blob;
}

/**
 * Pozycja -> rekord na dysk. Kod, notatka i znacznik kolejki wyłącznie
 * w bloku; bez klucza - wcale (zostają skrót i prefiks).
 */
async function toStoredRecord(
  item: OutboxItem,
  key: CryptoKey | null,
): Promise<Record<string, unknown>> {
  const { code, note: _note, queueMarker: _marker, sealed, ...meta } = item;
  let blob: SealedBlob | null = null;
  if (code !== "") {
    if (key !== null) blob = await sealedFor(item, key);
  } else {
    blob = sealed ?? null;
  }
  return {
    ...meta,
    v: OUTBOX_RECORD_VERSION,
    codeHash: item.codeHash ?? (code === "" ? null : await scanCodeHash(code)),
    codePrefix: item.codePrefix ?? (code === "" ? null : codePrefixOf(code)),
    sealed: blob,
  };
}

/**
 * Rekord z dysku -> pozycja. Blok otwarty kluczem daje kod; blok, którego ten
 * klucz nie otwiera, zostaje na pozycji (`sealed`) do zapisu bez zmian.
 */
async function fromStoredRecord(
  raw: Record<string, unknown>,
  key: CryptoKey | null,
): Promise<OutboxItem | null> {
  const { sealed: rawBlob, queueMarker: _clearMarker, ...rest } = raw;
  const meta = parseOutboxItem({ ...rest, code: "", note: null });
  if (meta === null) return null;
  const blob = isSealedBlob(rawBlob) ? rawBlob : null;
  if (blob !== null && key !== null) {
    const secret = await openSecret(key, meta.id, blob);
    if (secret !== null) {
      sealCache.set(meta.id, { key, secret: JSON.stringify(secret), blob });
      return { ...meta, code: secret.code, note: secret.note, queueMarker: secret.queueMarker };
    }
  }
  return blob === null ? meta : { ...meta, sealed: blob };
}

interface RestoredOutbox {
  items: OutboxItem[];
  /** Na dysku leżały rekordy z jawnym kodem - trzeba je przepisać. */
  legacy: boolean;
}

async function restoreOutbox(raw: unknown, key: CryptoKey | null): Promise<RestoredOutbox> {
  if (!Array.isArray(raw)) return { items: [], legacy: false };
  let legacy = false;
  const items: OutboxItem[] = [];
  for (const entry of raw) {
    if (!isRecordObject(entry)) continue;
    if (entry.v === OUTBOX_RECORD_VERSION) {
      const item = await fromStoredRecord(entry, key);
      if (item !== null) items.push(item);
      continue;
    }
    // Rekord sprzed sejfu: jawny kod. Wraca do pamięci, a zapis niżej
    // przepisuje go do formatu 2 (albo bez kodu, gdy nie ma klucza).
    const item = parseOutboxItem(entry);
    if (item === null) continue;
    legacy = true;
    items.push({
      ...item,
      codeHash: item.codeHash ?? (await scanCodeHash(item.code)),
      codePrefix: item.codePrefix ?? codePrefixOf(item.code),
    });
  }
  return { items, legacy };
}

function readQueueRecord(db: IDBDatabase): Promise<{ ok: true; value: unknown } | { ok: false }> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(OUTBOX_KEY);
      request.onsuccess = () => {
        const value: unknown = request.result;
        db.close();
        resolve({ ok: true, value });
      };
      request.onerror = () => {
        db.close();
        resolve({ ok: false });
      };
    } catch {
      resolve({ ok: false });
    }
  });
}

/**
 * Kolejka z dysku. `key` otwiera bloki zapisane pod tym poświadczeniem; bloki
 * innego zostają zamknięte na pozycjach. Rekordy z jawnym kodem (sprzed
 * sejfu) są od razu przepisywane - jawny kod znika z dysku przy starcie.
 */
export async function loadOutbox(key: CryptoKey | null = null): Promise<OutboxItem[]> {
  const db = await openDb();
  if (db === null) {
    memoryOnly = true;
    return [...memoryQueue];
  }
  const read = await readQueueRecord(db);
  if (!read.ok) {
    memoryOnly = true;
    return [...memoryQueue];
  }
  const { items, legacy } = await restoreOutbox(read.value, key);
  // Kopia w pamięci karty: ponowne wczytanie, gdy baza akurat odmówi, nie
  // może zgubić kolejki, która leży na dysku.
  memoryQueue = [...items];
  if (legacy) await saveOutbox(items, key);
  return items;
}

/**
 * Ile pozycji leży w kolejce na dysku - BEZ odczytu i przepisywania rekordów
 * (przeniesienie skanera pod osobny origin pyta o to, zanim ktokolwiek ma
 * klucz). Brak bazy = to, co jest w pamięci karty.
 */
export async function countStoredOutbox(): Promise<number> {
  const db = await openDb();
  if (db === null) return memoryQueue.length;
  const read = await readQueueRecord(db);
  if (!read.ok) return memoryQueue.length;
  return Array.isArray(read.value) ? read.value.length : 0;
}

/**
 * Otwiera pozycje zamknięte blokiem innego klucza - środowisko woła to, gdy
 * dostanie klucz potwierdzonego poświadczenia. `null` = nic się nie zmieniło.
 */
export async function openSealedItems(
  queue: readonly OutboxItem[],
  key: CryptoKey,
): Promise<OutboxItem[] | null> {
  let changed = false;
  const next: OutboxItem[] = [];
  for (const item of queue) {
    const blob = item.sealed ?? null;
    if (item.code !== "" || blob === null) {
      next.push(item);
      continue;
    }
    const secret = await openSecret(key, item.id, blob);
    if (secret === null) {
      next.push(item);
      continue;
    }
    changed = true;
    sealCache.set(item.id, { key, secret: JSON.stringify(secret), blob });
    const { sealed: _blob, ...open } = item;
    next.push({ ...open, code: secret.code, note: secret.note, queueMarker: secret.queueMarker });
  }
  return changed ? next : null;
}

async function writeQueue(queue: readonly OutboxItem[], key: CryptoKey | null): Promise<void> {
  let records: Record<string, unknown>[];
  try {
    records = await Promise.all(queue.map((item) => toStoredRecord(item, key)));
  } catch {
    // Szyfrowanie zawiodło (np. WebCrypto odmówił w trakcie) - jawnego kodu
    // nie zapisujemy; kolejka żyje w pamięci karty, ekran ostrzega.
    records = await Promise.all(queue.map((item) => toStoredRecord(item, null)));
  }
  lastSaveRedacted = queue.some(
    (item, index) => item.code !== "" && records[index]?.sealed === null,
  );
  const live = new Set(queue.map((item) => item.id));
  for (const id of sealCache.keys()) if (!live.has(id)) sealCache.delete(id);

  const db = await openDb();
  if (db === null) {
    memoryOnly = true;
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(records, OUTBOX_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        memoryOnly = true;
        db.close();
        resolve();
      };
      tx.onabort = () => {
        memoryOnly = true;
        db.close();
        resolve();
      };
    } catch {
      memoryOnly = true;
      resolve();
    }
  });
}

/**
 * Zapis kolejki (po kolei - patrz nagłówek). `key` szyfruje kody; `null`
 * oznacza zapis BEZ kodów (skrót i prefiks zostają). Nigdy nie rzuca.
 */
export function saveOutbox(
  queue: readonly OutboxItem[],
  key: CryptoKey | null = null,
): Promise<void> {
  memoryQueue = [...queue];
  const snapshot = [...queue];
  const run = writeChain.then(() => writeQueue(snapshot, key));
  writeChain = run.catch(() => undefined);
  return run;
}

/** Kolejka znika z urządzenia - z dysku, z pamięci karty i z pamięci bloków. */
export async function clearOutbox(): Promise<void> {
  sealCache.clear();
  await saveOutbox([], null);
}
