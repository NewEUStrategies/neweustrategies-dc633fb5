// Działająca atrapa IndexedDB w pamięci - dla testów, które sprawdzają, CO
// skaner naprawdę zostawia na dysku (OPS-06), a nie tylko, jakie wywołania
// wykonał. happy-dom nie ma IndexedDB w ogóle.
//
// Odtwarza wyłącznie to, czego używają `scannerStorage` i `scannerOfflineStorage`:
// `open` z migracją, magazyny bez kluczy wbudowanych (`put(value, key)`),
// `get`, `delete`, transakcje kończone `oncomplete` po mikrozadaniu i wartości
// kopiowane przez `structuredClone` (jak prawdziwa przeglądarka - mutacja
// obiektu po zapisie nie zmienia rekordu).
//
// AWARIE NA ŻĄDANIE (`faults`): `open` rzucający albo kończący się `onerror`,
// `get` z `onerror` i transakcja zapisu przerwana (`onabort`, nic nie trafia do
// magazynu) - tak wygląda WebKit po „Connection to Indexed Database server
// lost", błąd wejścia-wyjścia albo przepełniony limit.

interface FakeRequest {
  result: unknown;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
  onblocked: (() => void) | null;
}

function request(result: unknown): FakeRequest {
  return {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    onblocked: null,
  };
}

interface FakeDatabase {
  version: number;
  stores: Map<string, Map<string, unknown>>;
}

/** Awarie wstrzykiwane w locie - zmiana działa od następnego wywołania. */
export interface MemoryIndexedDbFaults {
  /** `open` rzuca synchronicznie (`"throw"`) albo kończy się `onerror` (`"error"`). */
  open: "none" | "throw" | "error";
  /** `get` kończy się `onerror`. */
  read: boolean;
  /** Transakcja zapisu kończy się `onabort` - nic nie trafia do magazynu. */
  write: boolean;
  /** Tylko ta baza się psuje (`null` = każda). */
  scope: string | null;
}

export interface MemoryIndexedDb {
  /** Obiekt do `vi.stubGlobal("indexedDB", ...)`. */
  factory: { open: (name: string, version: number) => FakeRequest };
  /** Przełączniki awarii (domyślnie wszystko działa). */
  faults: MemoryIndexedDbFaults;
  /** Wszystkie rekordy wszystkich baz: `[baza, magazyn, klucz, wartość]`. */
  records: () => Array<[string, string, string, unknown]>;
  /** Wartość rekordu albo `undefined`. */
  read: (db: string, store: string, key: string) => unknown;
  /** Wkłada rekord „sprzed tej wersji aplikacji". */
  seed: (db: string, store: string, key: string, value: unknown) => void;
}

export function createMemoryIndexedDb(): MemoryIndexedDb {
  const databases = new Map<string, FakeDatabase>();
  const faults: MemoryIndexedDbFaults = { open: "none", read: false, write: false, scope: null };
  const hits = (name: string) => faults.scope === null || faults.scope === name;

  const handle = (name: string, database: FakeDatabase) => ({
    objectStoreNames: { contains: (name: string) => database.stores.has(name) },
    createObjectStore: (name: string) => {
      if (database.stores.has(name)) throw new Error("ConstraintError");
      database.stores.set(name, new Map());
    },
    close: () => undefined,
    transaction: (storeName: string) => {
      let aborted = false;
      const tx = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        objectStore: () => {
          const store = database.stores.get(storeName);
          if (store === undefined) throw new Error(`NotFoundError: ${storeName}`);
          return {
            get: (key: string) => {
              const req = request(undefined);
              const failed = faults.read && hits(name);
              queueMicrotask(() => {
                if (failed) {
                  req.error = new Error("UnknownError: Connection to Indexed Database server lost");
                  req.onerror?.();
                  return;
                }
                req.result = store.has(key) ? structuredClone(store.get(key)) : undefined;
                req.onsuccess?.();
              });
              return req;
            },
            put: (value: unknown, key: string) => {
              if (faults.write && hits(name)) aborted = true;
              else store.set(key, structuredClone(value));
            },
            delete: (key: string) => {
              if (faults.write && hits(name)) aborted = true;
              else store.delete(key);
            },
          };
        },
      };
      // Dwa mikrozadania: operacje magazynu (każda w swoim) kończą się przed
      // `oncomplete` - kolejność jak w przeglądarce.
      queueMicrotask(() => queueMicrotask(() => (aborted ? tx.onabort?.() : tx.oncomplete?.())));
      return tx;
    },
  });

  const factory = {
    open: (name: string, version: number) => {
      if (faults.open === "throw" && hits(name)) {
        throw new Error("UnknownError: IndexedDB unavailable");
      }
      if (faults.open === "error" && hits(name)) {
        const failed = request(null);
        queueMicrotask(() => {
          failed.error = new Error("UnknownError: Connection to Indexed Database server lost");
          failed.onerror?.();
        });
        return failed;
      }
      const existing = databases.get(name);
      const database: FakeDatabase = existing ?? { version: 0, stores: new Map() };
      databases.set(name, database);
      const req = request(handle(name, database));
      queueMicrotask(() => {
        if (database.version < version) {
          database.version = version;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  };

  return {
    factory,
    faults,
    records: () => {
      const out: Array<[string, string, string, unknown]> = [];
      for (const [dbName, database] of databases) {
        for (const [storeName, store] of database.stores) {
          for (const [key, value] of store) out.push([dbName, storeName, key, value]);
        }
      }
      return out;
    },
    read: (db, store, key) => databases.get(db)?.stores.get(store)?.get(key),
    seed: (db, store, key, value) => {
      const database = databases.get(db) ?? { version: 1, stores: new Map() };
      databases.set(db, database);
      const target = database.stores.get(store) ?? new Map<string, unknown>();
      database.stores.set(store, target);
      target.set(key, structuredClone(value));
    },
  };
}

/** Każdy napis w wartości (także klucze obiektów), rekurencyjnie. */
export function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) stringsIn(entry, out);
  } else if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    out.push(
      new TextDecoder().decode(value instanceof ArrayBuffer ? new Uint8Array(value) : value),
    );
  } else if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      out.push(key);
      stringsIn(entry, out);
    }
  }
  return out;
}

/**
 * Kształt kodu z biletu (`_event_new_qr_token()`: 24 bajty base64url = 32
 * znaki), szukany jako CAŁE słowo - UUID (36 znaków), skróty hex (64) i bloki
 * szyfrogramu (dłuższe) go nie udają.
 */
export const CODE_SHAPE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/;
