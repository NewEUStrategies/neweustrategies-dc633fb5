// Testy trwalosci skanera: poswiadczenie w `localStorage` i kolejka w IndexedDB.
//
// PO CO TEN PLIK ISTNIEJE. Ten modul jest jedynym miejscem, w ktorym skan
// zebrany bez sieci zamienia sie w cos, co przezyje wygaszenie ekranu. Kazda
// jego galaz „nie udalo sie" ma konczyc sie CICHYM zejsciem do pamieci karty,
// a nie wyjatkiem - bo wyjatek przy bramce zatrzymuje kolejke stu osob, a
// pominiety zapis kosztuje czyjas obecnosc na wydarzeniu.
//
// LAPIEMY TRZY KLASY BLEDOW.
//
// 1) WYJATEK ZAMIAST DEGRADACJI. Prywatne okno Safari odmawia i `localStorage`,
//    i `indexedDB`, a `open()` potrafi RZUCIC synchronicznie, zanim ktokolwiek
//    zdazy podpiac `onerror`. Kazda taka sciezka ma tu wlasny przypadek i musi
//    konczyc sie wartoscia, nie wyjatkiem.
//
// 2) ZLAMANA UMOWA Z BAZA PRZEGLADARKI. Nazwa bazy, wersja, nazwa magazynu,
//    klucz rekordu i TRYB transakcji sa czescia kontraktu z danymi juz
//    lezacymi na urzadzeniu wolontariusza. Literowka w kluczu nie wywala
//    niczego - po prostu kolejka z poprzedniej zmiany przestaje istniec.
//    Dlatego asercje ida po doslownych napisach, nie po stalych z modulu.
//
// 3) KLAMSTWO O TRWALOSCI. `isOutboxPersistent()` steruje komunikatem na
//    ekranie. Gdy zwroci `true` mimo pracy z pamieci, operator uwierzy, ze
//    moze zamknac karte - i straci kolejke.
//
// KAZDY TEST DOSTAJE SWIEZY MODUL (`vi.resetModules()`), bo `memoryQueue`
// i `memoryOnly` to stan MODULOWY: bez tego pierwsza odmowa bazy zafarbowalaby
// wszystkie kolejne przypadki w pliku.
//
// 4) JAWNY KOD NA DYSKU (OPS-06). Rekord pozycji niesie kod wyłącznie
//    w bloku sejfu; bez klucza - wcale. Rekord sprzed sejfu (jawny `code`)
//    jest przepisywany przy pierwszym odczycie.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OutboxItem } from "@/lib/events/scannerOutbox";
import { deriveVaultKey } from "@/lib/events/scannerVault";

type StorageModule = typeof import("@/lib/events/scannerStorage");

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** Pola, które parser pozycji dopisuje pustymi wartościami (kolejki sprzed trybu offline). */
const PARSED_DEFAULTS = {
  offlineAdmitted: null,
  offlineOutcome: null,
  rosterGeneratedAt: null,
  deviceId: null,
} as const;

/** Pozycja po odczycie rekordu sprzed sejfu: kod w pamięci + skrót i prefiks. */
function restored(source: OutboxItem): OutboxItem {
  return {
    ...PARSED_DEFAULTS,
    ...source,
    codeHash: sha(source.code),
    codePrefix: source.code.slice(0, 6),
  };
}

/** Doslowny klucz poswiadczenia - patrz punkt 2 naglowka. */
const TOKEN_KEY = "nes.scanner.device-token";

/** Swiezy modul = zerowy `memoryQueue` i `memoryOnly === false`. */
async function freshModule(): Promise<StorageModule> {
  vi.resetModules();
  return import("@/lib/events/scannerStorage");
}

function item(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: "scan-1",
    kind: "checkin",
    code: "TCK-1",
    checkpointId: null,
    direction: null,
    note: null,
    interestRating: null,
    deviceScannedAt: "2026-09-01T08:00:00.000Z",
    attempts: 0,
    nextAttemptAt: "2026-09-01T08:00:00.000Z",
    lastError: null,
    ...overrides,
  };
}

/* ------------------------------------------------ atrapa IndexedDB --- */
// happy-dom NIE ma IndexedDB w ogole, wiec caly sterownik bazy musi byc tutaj.
// Atrapa oddaje jedyna wlasnosc prawdziwego API, ktora ma znaczenie dla tego
// modulu: `open()` zwraca zadanie, a UCHWYTY podpina sie DOPIERO po jego
// powrocie - dlatego wyniki odpalamy z mikrozadania, a nie synchronicznie.

type OpenOutcome = "success" | "error" | "blocked" | "throw";
type TxOutcome = "complete" | "error" | "abort";

interface FakeIdbOptions {
  readonly open?: OpenOutcome;
  /** Czy przegladarka uzna, ze trzeba przeprowadzic migracje. */
  readonly upgradeNeeded?: boolean;
  /** Magazyny juz istniejace w bazie. */
  readonly stores?: readonly string[];
  /** `db.transaction()` rzuca (baza zamknieta, magazyn nieznany). */
  readonly transactionThrows?: boolean;
  /** Odczyt rekordu konczy sie bledem. */
  readonly getFails?: boolean;
  /** Co lezy pod kluczem rekordu. */
  readonly stored?: unknown;
  readonly tx?: TxOutcome;
}

interface FakeIdbSpy {
  readonly opens: Array<{ name: string; version: number }>;
  readonly createdStores: string[];
  readonly puts: Array<{ key: unknown; value: unknown }>;
  readonly txCalls: Array<{ store: string; mode: string }>;
  readonly gets: unknown[];
  /** Ile razy zamknieto polaczenie - niezamkniete blokuje migracje innej karty. */
  closes: number;
}

interface FakeRequest {
  result: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
  onblocked: (() => void) | null;
}

interface FakeTransaction {
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  objectStore: () => {
    get: (key: unknown) => FakeRequest;
    put: (value: unknown, key: unknown) => void;
  };
}

function installFakeIdb(options: FakeIdbOptions = {}): FakeIdbSpy {
  const spy: FakeIdbSpy = {
    opens: [],
    createdStores: [],
    puts: [],
    txCalls: [],
    gets: [],
    closes: 0,
  };
  const stores = new Set<string>(options.stores ?? ["outbox"]);

  const objectStore = {
    get: (key: unknown): FakeRequest => {
      spy.gets.push(key);
      const request: FakeRequest = {
        result: undefined,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        if (options.getFails === true) {
          request.onerror?.();
          return;
        }
        request.result = options.stored;
        request.onsuccess?.();
      });
      return request;
    },
    put: (value: unknown, key: unknown): void => {
      spy.puts.push({ key, value });
    },
  };

  const db = {
    objectStoreNames: { contains: (name: string): boolean => stores.has(name) },
    createObjectStore: (name: string): void => {
      stores.add(name);
      spy.createdStores.push(name);
    },
    close: (): void => {
      spy.closes += 1;
    },
    transaction: (store: string, mode: string): FakeTransaction => {
      spy.txCalls.push({ store, mode });
      if (options.transactionThrows === true) {
        throw new Error("InvalidStateError: polaczenie sie zamyka");
      }
      const tx: FakeTransaction = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: () => objectStore,
      };
      queueMicrotask(() => {
        const outcome = options.tx ?? "complete";
        if (outcome === "complete") tx.oncomplete?.();
        else if (outcome === "error") tx.onerror?.();
        else tx.onabort?.();
      });
      return tx;
    },
  };

  const factory = {
    open: (name: string, version: number): FakeRequest => {
      spy.opens.push({ name, version });
      if (options.open === "throw") {
        throw new Error("SecurityError: IndexedDB odciete polityka przegladarki");
      }
      const request: FakeRequest = {
        result: db,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        const outcome = options.open ?? "success";
        if (outcome === "error") {
          request.onerror?.();
          return;
        }
        if (outcome === "blocked") {
          request.onblocked?.();
          return;
        }
        if (options.upgradeNeeded === true) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };

  vi.stubGlobal("indexedDB", factory);
  return spy;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/* ------------------------------------------------------- poswiadczenie --- */

describe("odczyt poswiadczenia z pamieci urzadzenia", () => {
  it("oddaje token spod UMOWIONEGO klucza, przyciety z bialych znakow", async () => {
    // Klucz jest kontraktem z danymi lezacymi juz na telefonie wolontariusza:
    // zmiana napisu to cicha utrata sesji na wszystkich urzadzeniach.
    window.localStorage.setItem(TOKEN_KEY, "  nes-dev-abc  ");
    const storage = await freshModule();

    expect(storage.readStoredToken()).toBe("nes-dev-abc");
  });

  it("BRAK klucza to `null`, a nie pusty napis", async () => {
    const storage = await freshModule();

    expect(storage.readStoredToken()).toBeNull();
  });

  it("token pusty i zlozony z samych spacji liczy sie jak BRAK tokenu", async () => {
    // Inaczej ekran probowalby sie „polaczyc" pustym napisem i pokazal blad
    // bazy zamiast prosby o zeskanowanie poswiadczenia.
    const storage = await freshModule();

    for (const stored of ["", "   ", "\n\t"]) {
      window.localStorage.setItem(TOKEN_KEY, stored);
      expect(storage.readStoredToken()).toBeNull();
    }
  });

  it("odmowa pamieci lokalnej daje `null`, a nie wyjatek", async () => {
    // Prywatne okno potrafi rzucic z samego `getItem`. Skaner ma dzialac dalej,
    // tyle ze z tokenem wpisywanym po kazdym otwarciu karty.
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError: dostep do pamieci lokalnej odmowiony");
      },
    });
    const storage = await freshModule();

    expect(storage.readStoredToken()).toBeNull();
  });

  it("bez `window` (render na serwerze) zwraca `null` i nie siega do pamieci", async () => {
    vi.stubGlobal("window", undefined);
    const storage = await freshModule();

    expect(storage.readStoredToken()).toBeNull();
  });
});

describe("zapis i kasowanie poswiadczenia", () => {
  it("zapisuje token pod umowionym kluczem", async () => {
    const storage = await freshModule();

    storage.writeStoredToken("nes-dev-xyz");

    expect(window.localStorage.getItem(TOKEN_KEY)).toBe("nes-dev-xyz");
  });

  it("zapisuje wartosc DOSLOWNIE - przycinanie jest po stronie odczytu", async () => {
    // Nie jest to usterka, tylko podzial rol: `readStoredToken` przycina,
    // wiec token zapisany ze spacja i tak wraca czysty. Test trzyma ten
    // podzial w miejscu, zeby nikt nie dodal drugiego, sprzecznego przycinania.
    const storage = await freshModule();

    storage.writeStoredToken(" nes-dev-xyz ");

    expect(window.localStorage.getItem(TOKEN_KEY)).toBe(" nes-dev-xyz ");
    expect(storage.readStoredToken()).toBe("nes-dev-xyz");
  });

  it("odmowa zapisu NIE przerywa pracy przy bramce", async () => {
    const setItem = vi.fn(() => {
      throw new Error("QuotaExceededError");
    });
    vi.stubGlobal("localStorage", { setItem });
    const storage = await freshModule();

    expect(() => storage.writeStoredToken("nes-dev-xyz")).not.toThrow();
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("bez `window` zapis jest bezczynny", async () => {
    vi.stubGlobal("window", undefined);
    const storage = await freshModule();

    storage.writeStoredToken("nes-dev-xyz");

    // `localStorage` nadal istnieje w tym srodowisku - modul po prostu go nie tknal.
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("kasowanie usuwa WYLACZNIE klucz skanera", async () => {
    window.localStorage.setItem(TOKEN_KEY, "nes-dev-xyz");
    window.localStorage.setItem("nes.other", "zostaje");
    const storage = await freshModule();

    storage.clearStoredToken();

    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(window.localStorage.getItem("nes.other")).toBe("zostaje");
  });

  it("odmowa kasowania nie rzuca - rozlaczenie ma sie udac zawsze", async () => {
    const removeItem = vi.fn(() => {
      throw new Error("SecurityError");
    });
    vi.stubGlobal("localStorage", { removeItem });
    const storage = await freshModule();

    expect(() => storage.clearStoredToken()).not.toThrow();
    expect(removeItem).toHaveBeenCalledTimes(1);
  });

  it("bez `window` kasowanie jest bezczynne", async () => {
    const removeItem = vi.fn();
    vi.stubGlobal("localStorage", { removeItem });
    vi.stubGlobal("window", undefined);
    const storage = await freshModule();

    storage.clearStoredToken();

    expect(removeItem).not.toHaveBeenCalled();
  });
});

/* --------------------------------------------------- otwarcie bazy --- */

describe("otwarcie bazy kolejki", () => {
  it("siega po UMOWIONA baze i wersje", async () => {
    // Nazwa i wersja decyduja o tym, czy zobaczymy kolejke z poprzedniej zmiany.
    const idb = installFakeIdb();
    const storage = await freshModule();

    await storage.loadOutbox();

    expect(idb.opens).toEqual([{ name: "nes-scanner", version: 1 }]);
  });

  it("migracja TWORZY magazyn `outbox`, gdy baza jest pusta", async () => {
    const idb = installFakeIdb({ upgradeNeeded: true, stores: [] });
    const storage = await freshModule();

    await storage.loadOutbox();

    expect(idb.createdStores).toEqual(["outbox"]);
  });

  it("migracja NIE tworzy magazynu drugi raz", async () => {
    // Powtorne `createObjectStore` rzuca `ConstraintError` i wywraca otwarcie
    // bazy razem z cala kolejka.
    const idb = installFakeIdb({ upgradeNeeded: true, stores: ["outbox"] });
    const storage = await freshModule();

    await storage.loadOutbox();

    expect(idb.createdStores).toEqual([]);
  });

  it("blad otwarcia zsyla kolejke do pamieci karty, zamiast rzucac", async () => {
    installFakeIdb({ open: "error" });
    const storage = await freshModule();

    await expect(storage.loadOutbox()).resolves.toEqual([]);
    expect(storage.isOutboxPersistent()).toBe(false);
  });

  it("ZABLOKOWANA baza (druga karta w migracji) nie zawiesza bramki", async () => {
    // Bez uchwytu `onblocked` obietnica nigdy by sie nie rozwiazala, a ekran
    // staby na wczytywaniu kolejki - to najgorszy mozliwy wynik przy wejsciu.
    installFakeIdb({ open: "blocked" });
    const storage = await freshModule();

    await expect(storage.loadOutbox()).resolves.toEqual([]);
    expect(storage.isOutboxPersistent()).toBe(false);
  });

  it("SYNCHRONICZNY wyjatek z `open()` tez konczy sie praca z pamieci", async () => {
    // Safari w oknie prywatnym rzuca z samego `open`, zanim da zadanie.
    installFakeIdb({ open: "throw" });
    const storage = await freshModule();

    await expect(storage.loadOutbox()).resolves.toEqual([]);
    expect(storage.isOutboxPersistent()).toBe(false);
  });

  it("brak IndexedDB w przegladarce to stan, nie awaria", async () => {
    // Zadnej atrapy nie instalujemy: `window.indexedDB` jest `undefined`.
    const storage = await freshModule();

    await expect(storage.loadOutbox()).resolves.toEqual([]);
    expect(storage.isOutboxPersistent()).toBe(false);
  });

  it("bez `window` kolejka od razu jest pamieciowa", async () => {
    vi.stubGlobal("window", undefined);
    const storage = await freshModule();

    await expect(storage.loadOutbox()).resolves.toEqual([]);
    expect(storage.isOutboxPersistent()).toBe(false);
  });
});

/* -------------------------------------------------- wczytanie kolejki --- */

describe("wczytanie kolejki", () => {
  it("czyta rekord spod umowionego klucza w trybie TYLKO DO ODCZYTU i zamyka baze", async () => {
    // Tryb `readonly` przy odczycie nie blokuje rownoleglego zapisu piknieciem,
    // a zamkniecie polaczenia zwalnia baze pod przyszla migracje. Rekord w
    // formacie sejfu (bez bloku - zapisany bez klucza) nie wymaga przepisania.
    const { code: _code, note: _note, ...meta } = item({ id: "a" });
    const stored = [{ ...meta, v: 2, codeHash: sha("TCK-1"), codePrefix: "TCK-1", sealed: null }];
    const idb = installFakeIdb({ stored });
    const storage = await freshModule();

    await expect(storage.loadOutbox()).resolves.toEqual([
      {
        ...PARSED_DEFAULTS,
        ...meta,
        code: "",
        note: null,
        codeHash: sha("TCK-1"),
        codePrefix: "TCK-1",
      },
    ]);
    expect(idb.txCalls).toEqual([{ store: "outbox", mode: "readonly" }]);
    expect(idb.gets).toEqual(["queue"]);
    expect(idb.closes).toBe(1);
  });

  it("OPS-06: rekord z JAWNYM kodem (sprzed sejfu) jest od razu przepisywany - z blokiem albo bez kodu", async () => {
    const stored = [item({ id: "a", code: "TCK-JAWNY-1" })];
    const key = await deriveVaultKey("nes-dev-token-0123456789");
    const idb = installFakeIdb({ stored });
    const storage = await freshModule();

    // W pamięci karty kod jest (pozycja ma wyjechać), na dysku - już nie.
    await expect(storage.loadOutbox(key)).resolves.toEqual([restored(stored[0])]);
    expect(idb.txCalls).toEqual([
      { store: "outbox", mode: "readonly" },
      { store: "outbox", mode: "readwrite" },
    ]);
    const [rewrite] = idb.puts;
    expect(JSON.stringify(rewrite.value)).not.toContain("TCK-JAWNY-1");
    expect(rewrite.value).toEqual([
      expect.objectContaining({
        v: 2,
        id: "a",
        codeHash: sha("TCK-JAWNY-1"),
        codePrefix: "TCK-JA",
        sealed: { iv: expect.any(String), data: expect.any(String) },
      }),
    ]);
  });

  it("PUSTA baza daje pusta kolejke, a trwalosc pozostaje obiecana", async () => {
    // Pierwsze uruchomienie na nowym urzadzeniu: rekordu nie ma, ale zapis
    // dziala - ekran nie moze straszyc utrata kolejki.
    installFakeIdb({ stored: undefined });
    const storage = await freshModule();

    await expect(storage.loadOutbox()).resolves.toEqual([]);
    expect(storage.isOutboxPersistent()).toBe(true);
  });

  it("rekord, ktory NIE jest tablica, daje pusta kolejke", async () => {
    // Kazdy taki ksztalt to slad po innej wersji aplikacji albo po recznym
    // grzebaniu w bazie; wywolanie `.filter` na nim wywaliloby ekran.
    for (const stored of [null, 42, "queue", { queue: [] }, true]) {
      installFakeIdb({ stored });
      const storage = await freshModule();

      await expect(storage.loadOutbox()).resolves.toEqual([]);
      vi.unstubAllGlobals();
    }
  });

  it("odsiewa pozycje o zlym ksztalcie, zachowujac kolejnosc pozostalych", async () => {
    const first = item({ id: "a", code: "TCK-A" });
    const last = item({ id: "z", code: "TCK-Z" });
    installFakeIdb({
      stored: [
        first,
        null, // rekord skasowany „w polowie"
        "TCK-B", // napis zamiast obiektu
        7,
        undefined,
        [item({ id: "b" })], // tablica jest obiektem, ale nie pozycja
        { ...item({ id: "c" }), id: 7 }, // identyfikator nie jest napisem
        { ...item({ id: "d" }), code: null }, // brak kodu
        { ...item({ id: "e" }), kind: undefined }, // brak rodzaju
        last,
      ],
    });
    const storage = await freshModule();

    await expect(storage.loadOutbox()).resolves.toEqual([restored(first), restored(last)]);
  });

  it("pozycja z nieznanym rodzajem wypada, a pozycja bez licznika prob dostaje wartosci domyslne", async () => {
    // ZMIANA SWIADOMA (OPS-06): odczyt idzie teraz przez `parseOutboxItem`
    // (ten sam parser co lista odrzuconych). Dawny straznik sprawdzal tylko
    // `id`, `code` i `kind` jako NAPISY - pozycja z rodzajem spoza zbioru
    // trafiala u wysylajacego do RPC leadu zamiast odprawy, a pozycja bez
    // `attempts` nigdy nie stawala sie „do wyslania”. Ten test opisywal tamta
    // usterke; teraz pilnuje naprawy.
    const alien = { ...item({ id: "obcy" }), kind: "wydruk" };
    const partial = { id: "kaleki", code: "TCK-K", kind: "checkin" };
    installFakeIdb({ stored: [alien, partial] });
    const storage = await freshModule();

    await expect(storage.loadOutbox()).resolves.toEqual([
      expect.objectContaining({ id: "kaleki", code: "TCK-K", attempts: 0, nextAttemptAt: "" }),
    ]);
  });

  it("blad ODCZYTU rekordu schodzi do pamieci i mimo to zamyka baze", async () => {
    installFakeIdb({ getFails: true });
    const storage = await freshModule();

    await expect(storage.loadOutbox()).resolves.toEqual([]);
    expect(storage.isOutboxPersistent()).toBe(false);
  });

  it("blad odczytu oddaje to, co zdazylo trafic do pamieci karty", async () => {
    const queued = [item({ id: "a" }), item({ id: "b" })];
    const idb = installFakeIdb({ getFails: true });
    const storage = await freshModule();

    await storage.saveOutbox(queued); // zapis sie udal, odczyt juz nie
    const loaded = await storage.loadOutbox();

    expect(loaded).toEqual(queued);
    expect(loaded).not.toBe(queued); // KOPIA - mutacja wyniku nie tknie pamieci
    expect(idb.closes).toBe(2); // po zapisie i po nieudanym odczycie
  });

  it("wyjatek z `transaction()` konczy sie kolejka z pamieci, ale baza ZOSTAJE OTWARTA (usterka)", async () => {
    // `db.transaction()` rzuca `InvalidStateError`, gdy polaczenie sie zamyka.
    // Modul lapie wyjatek i schodzi do pamieci - to jest dobre. NIE zamyka
    // jednak polaczenia, wiec zwisajacy uchwyt bedzie blokowal przyszla
    // migracje i wpadnie w `onblocked`, czyli w trwale „bez trwalosci".
    const idb = installFakeIdb({ transactionThrows: true });
    const storage = await freshModule();

    await expect(storage.loadOutbox()).resolves.toEqual([]);
    expect(storage.isOutboxPersistent()).toBe(false);
    expect(idb.closes).toBe(0); // stan obecny; poprawka powinna dac 1
  });
});

/* ------------------------------------------------------ zapis kolejki --- */

describe("zapis kolejki", () => {
  it("zapisuje CALA kolejke pod jednym kluczem w trybie DO ZAPISU i zamyka baze", async () => {
    const queue = [
      item({ id: "a", code: "TCK-A-0001", note: "notatka a" }),
      item({ id: "b", code: "TCK-B-0002" }),
    ];
    const key = await deriveVaultKey("nes-dev-token-0123456789");
    const idb = installFakeIdb();
    const storage = await freshModule();

    // `true` = transakcja zakończona, kolejka na dysku.
    await expect(storage.saveOutbox(queue, key)).resolves.toBe(true);

    expect(idb.txCalls).toEqual([{ store: "outbox", mode: "readwrite" }]);
    expect(idb.puts).toHaveLength(1);
    expect(idb.puts[0].key).toBe("queue");
    // OPS-06: rekord niesie metadane, skrót i prefiks - kod i notatka tylko w bloku.
    const records = idb.puts[0].value as Array<Record<string, unknown>>;
    expect(records.map((record) => [record.id, record.codeHash, record.codePrefix])).toEqual([
      ["a", sha("TCK-A-0001"), "TCK-A-"],
      ["b", sha("TCK-B-0002"), "TCK-B-"],
    ]);
    for (const record of records) {
      expect(record).not.toHaveProperty("code");
      expect(record).not.toHaveProperty("note");
      expect(record.sealed).toEqual({ iv: expect.any(String), data: expect.any(String) });
    }
    expect(JSON.stringify(records)).not.toMatch(/TCK-A-0001|TCK-B-0002|notatka a/);
    expect(idb.closes).toBe(1);
    expect(storage.isOutboxPersistent()).toBe(true);
  });

  it("OPS-06: blok otwiera się TYM SAMYM kluczem - innym nie", async () => {
    const queue = [item({ id: "a", code: "TCK-A-0001", note: "n", queueMarker: "m-1" })];
    const key = await deriveVaultKey("nes-dev-token-0123456789");
    const other = await deriveVaultKey("nes-dev-token-9876543210");
    const write = installFakeIdb();
    const storage = await freshModule();
    await storage.saveOutbox(queue, key);
    const stored = write.puts[0].value;

    vi.unstubAllGlobals();
    installFakeIdb({ stored });
    const reader = await freshModule();
    await expect(reader.loadOutbox(key)).resolves.toEqual([
      expect.objectContaining({ id: "a", code: "TCK-A-0001", note: "n", queueMarker: "m-1" }),
    ]);

    vi.unstubAllGlobals();
    installFakeIdb({ stored });
    const stranger = await freshModule();
    const [locked] = await stranger.loadOutbox(other);
    // Obcy klucz: kod niedostępny, blok zostaje na pozycji do zapisu bez zmian.
    expect(locked).toMatchObject({ id: "a", code: "", note: null });
    expect(locked.sealed).toEqual((stored as Array<{ sealed: unknown }>)[0].sealed);
    if (key === null) throw new Error("test: brak WebCrypto w środowisku testowym");
    const reopened = await stranger.openSealedItems([locked], key);
    expect(reopened?.[0]).toMatchObject({ code: "TCK-A-0001", note: "n" });
  });

  it("OPS-06: zapis BEZ klucza nie zapisuje kodu wcale - i nie obiecuje trwałości", async () => {
    const idb = installFakeIdb();
    const storage = await freshModule();

    await storage.saveOutbox([item({ id: "a", code: "TCK-BEZ-KLUCZA" })]);

    const [record] = idb.puts[0].value as Array<Record<string, unknown>>;
    expect(record).toMatchObject({ id: "a", sealed: null, codeHash: sha("TCK-BEZ-KLUCZA") });
    expect(JSON.stringify(record)).not.toContain("TCK-BEZ-KLUCZA");
    expect(storage.isOutboxPersistent()).toBe(false);
  });

  it("PUSTA kolejka tez jest zapisywana - inaczej wyslane skany wracalyby po restarcie", async () => {
    const idb = installFakeIdb();
    const storage = await freshModule();

    await storage.saveOutbox([]);

    expect(idb.puts).toEqual([{ key: "queue", value: [] }]);
  });

  it("do bazy idzie KOPIA - pozniejsza mutacja tablicy wywolujacego nie zmienia rekordu", async () => {
    const queue = [item({ id: "a" })];
    const idb = installFakeIdb();
    const storage = await freshModule();

    await storage.saveOutbox(queue);
    queue.push(item({ id: "podrzucony" }));

    expect(idb.puts[0].value).toHaveLength(1);
  });

  it("blad transakcji zapisu odbiera obietnice trwalosci, ale nie rzuca", async () => {
    const idb = installFakeIdb({ tx: "error" });
    const storage = await freshModule();

    // `false` = zapis nie trafil na dysk (sprzatanie pod originem portalu
    // nie kasuje wtedy tokenu - `purgeScannerData`).
    await expect(storage.saveOutbox([item()])).resolves.toBe(false);
    expect(storage.isOutboxPersistent()).toBe(false);
    expect(idb.closes).toBe(1);
  });

  it("PRZERWANA transakcja (brak miejsca, wyczyszczenie danych) tez znaczy brak trwalosci", async () => {
    const idb = installFakeIdb({ tx: "abort" });
    const storage = await freshModule();

    await storage.saveOutbox([item()]);

    expect(storage.isOutboxPersistent()).toBe(false);
    expect(idb.closes).toBe(1);
  });

  it("wyjatek z `transaction()` przy zapisie schodzi do pamieci i ZAMYKA polaczenie", async () => {
    const idb = installFakeIdb({ transactionThrows: true });
    const storage = await freshModule();

    await expect(storage.saveOutbox([item()])).resolves.toBe(false);
    expect(storage.isOutboxPersistent()).toBe(false);
    // Wspolna sciezka porazki zapisu (`done(false)`) zamyka uchwyt - zwisajace
    // polaczenie blokowaloby przyszla migracje (`onblocked`).
    expect(idb.closes).toBe(1);
  });

  it("bez bazy zapis trafia do pamieci karty i tam DA sie go odczytac", async () => {
    // To jest cala obiecana degradacja: bez IndexedDB kolejka nadal dziala
    // w obrebie jednej karty, tyle ze nie przezyje jej zamkniecia.
    const queue = [item({ id: "a" }), item({ id: "b" })];
    const storage = await freshModule();

    await storage.saveOutbox(queue);

    expect(storage.isOutboxPersistent()).toBe(false);
    await expect(storage.loadOutbox()).resolves.toEqual(queue);
  });
});

/* ------------------------------------------------- sygnal trwalosci --- */

describe("sygnal trwalosci pokazywany operatorowi", () => {
  it("przed pierwsza operacja kolejka jest uznana za trwala", async () => {
    // Domysl musi byc optymistyczny: ostrzezenie „kolejka nie przezyje karty"
    // pokazane bez powodu uczy operatora ignorowac ostrzezenia.
    const storage = await freshModule();

    expect(storage.isOutboxPersistent()).toBe(true);
  });

  it("udany odczyt i zapis NIE odbieraja trwalosci", async () => {
    const key = await deriveVaultKey("nes-dev-token-0123456789");
    installFakeIdb({ stored: [item()] });
    const storage = await freshModule();

    await storage.loadOutbox(key);
    await storage.saveOutbox([item()], key);

    expect(storage.isOutboxPersistent()).toBe(true);
  });

  it("raz utracona trwalosc NIE wraca po udanym zapisie", async () => {
    // Stan obecny i swiadomie zachowawczy: jedna odmowa bazy zostawia
    // ostrzezenie do konca zycia karty, nawet gdy kolejny zapis sie uda.
    // Odwrotny blad - schowanie ostrzezenia - kosztowalby kolejke.
    installFakeIdb({ open: "error" });
    const storage = await freshModule();
    await storage.loadOutbox();
    expect(storage.isOutboxPersistent()).toBe(false);

    vi.unstubAllGlobals();
    installFakeIdb();
    await storage.saveOutbox([item()]);

    expect(storage.isOutboxPersistent()).toBe(false);
  });
});

/* ------------------------------------------------------- zgloszona usterka --- */

describe("pamiec podreczna po udanym odczycie (usterka naprawiona przy OPS-05)", () => {
  it("DRUGIE wczytanie bez bazy oddaje kolejke wczytana za pierwszym razem", async () => {
    // ZMIANA SWIADOMA. Dawniej `loadOutbox` NIE przepisywal odczytu do
    // `memoryQueue`: gdy ekran skanera wmontowal sie ponownie, a baza akurat
    // odmowila, awaryjna kolejka byla PUSTA - mimo ze skany lezaly w IndexedDB,
    // a pierwsze nastepne pikniecie zapisywalo kolejke jednoelementowa NA
    // WIERZCHU tamtych. Ten test opisywal tamta usterke; teraz pilnuje naprawy
    // (kolejka nie moze „zniknac” - OPS-05).
    const stored = [item({ id: "a" }), item({ id: "b" })];
    installFakeIdb({ stored });
    const storage = await freshModule();

    const first = await storage.loadOutbox();
    expect(first).toEqual(stored.map(restored));

    vi.unstubAllGlobals(); // baza znika miedzy jednym a drugim wczytaniem
    await expect(storage.loadOutbox()).resolves.toEqual(first);
  });
});
