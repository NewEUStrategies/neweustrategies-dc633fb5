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
// jest ograniczona do 500 pozycji po ~200 bajtów, czyli jeden rekord ~100 kB -
// jeden odczyt przy starcie, jeden zapis po zmianie. Prościej i bez klasy
// błędów, której nie da się przetestować przy bramce.
//
// BRAK TRWAŁOŚCI TO STAN, NIE AWARIA. Prywatne okno Safari potrafi odmówić
// IndexedDB, a wtedy skaner NADAL ma działać - tyle że kolejka żyje w pamięci
// karty. Ekran musi o tym powiedzieć, zamiast obiecywać odporność, której nie ma.
//
// POŚWIADCZENIE W `localStorage` JEST ŚWIADOMĄ CENĄ. To ten sam kompromis, na
// którym stoi sesja Supabase w tej aplikacji. Ryzyko domyka baza, nie
// przeglądarka: token ma termin, da się go unieważnić jednym kliknięciem
// w panelu, blokuje się po serii nieznanych kodów i otwiera dokładnie jedno
// wydarzenie.
import type { OutboxItem } from "@/lib/events/scannerOutbox";

const TOKEN_KEY = "nes.scanner.device-token";
const DB_NAME = "nes-scanner";
const DB_VERSION = 1;
const STORE = "outbox";
const OUTBOX_KEY = "queue";

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

/** Czy kolejka przeżyje zamknięcie karty. Ekran pokazuje to operatorowi. */
export function isOutboxPersistent(): boolean {
  return !memoryOnly;
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

function isOutboxItem(value: unknown): value is OutboxItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.code === "string" && typeof row.kind === "string";
}

export async function loadOutbox(): Promise<OutboxItem[]> {
  const db = await openDb();
  if (db === null) {
    memoryOnly = true;
    return [...memoryQueue];
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(OUTBOX_KEY);
      request.onsuccess = () => {
        const value = request.result;
        resolve(Array.isArray(value) ? value.filter(isOutboxItem) : []);
        db.close();
      };
      request.onerror = () => {
        memoryOnly = true;
        resolve([...memoryQueue]);
        db.close();
      };
    } catch {
      memoryOnly = true;
      resolve([...memoryQueue]);
    }
  });
}

export async function saveOutbox(queue: readonly OutboxItem[]): Promise<void> {
  memoryQueue = [...queue];
  const db = await openDb();
  if (db === null) {
    memoryOnly = true;
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(memoryQueue, OUTBOX_KEY);
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
