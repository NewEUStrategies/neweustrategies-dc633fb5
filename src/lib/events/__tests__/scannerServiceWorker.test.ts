// Service worker skanera (`public/scanner-sw.js`, v2) - uruchamiany w piaskownicy.
//
// DLACZEGO PIASKOWNICA, A NIE IMPORT. Worker to statyczny plik z `public/`,
// serwowany przez warstwę zasobów przed aplikacją - nie przechodzi przez
// bundler i nie może niczego importować. Testujemy więc DOKŁADNIE ten plik:
// czytamy go z dysku i wykonujemy w `node:vm` z atrapami `self`, `caches`
// i `fetch`, a potem wysyłamy mu zdarzenia tak, jak zrobiłaby przeglądarka.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. STRONA BŁĘDU JAKO POWŁOKA. v1 cachował nawigację bez sprawdzenia
//      `response.ok` - jedna odpowiedź 502 w chwili wejścia na /scanner i przez
//      resztę dnia bez sieci skaner otwierał się jako strona błędu.
//   2. PIERWSZA WIZYTA BEZ CACHE. Zasoby pobrane, zanim worker przejął stronę,
//      nie trafiały do cache; wiadomość `precache` je dociąga - ale WYŁĄCZNIE
//      z tego samego źródła i tylko powłokę i zasoby budowania (worker nie
//      może stać się pośrednikiem cachującym cudze adresy albo API).
//   3. BRAK ODPOWIEDZI GOTOWOŚCI - ekran nie wiedziałby, czy skaner wstanie
//      bez sieci.
//   4. ZMIANA WERSJI CACHE bez sprzątania - stara powłoka v1 zostawałaby na
//      zawsze obok nowej.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync(join(process.cwd(), "public", "scanner-sw.js"), "utf8");
const ORIGIN = "https://nes.example";

interface FakeResponse {
  ok: boolean;
  type: string;
  body: string;
  clone: () => FakeResponse;
}

function response(body: string, over: Partial<FakeResponse> = {}): FakeResponse {
  const res: FakeResponse = {
    ok: true,
    type: "basic",
    body,
    clone: () => ({ ...res }),
    ...over,
  };
  return res;
}

type Listener = (event: Record<string, unknown>) => void;

function keyOf(input: unknown): string {
  if (typeof input === "string") return new URL(input, ORIGIN).href;
  return (input as { url: string }).url;
}

function loadWorker(fetchImpl: (input: unknown) => Promise<FakeResponse>) {
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, Map<string, FakeResponse>>();
  const store = (name: string) => {
    let found = stores.get(name);
    if (found === undefined) {
      found = new Map();
      stores.set(name, found);
    }
    return found;
  };
  const cacheApi = (name: string) => ({
    match: (input: unknown) => Promise.resolve(store(name).get(keyOf(input))),
    put: (input: unknown, res: FakeResponse) => {
      store(name).set(keyOf(input), res);
      return Promise.resolve();
    },
    addAll: vi.fn((urls: string[]) =>
      Promise.all(urls.map((url) => fetchImpl(url))).then((all) => {
        all.forEach((res, i) => store(name).set(keyOf(urls[i]), res));
      }),
    ),
  });
  const opened = new Map<string, ReturnType<typeof cacheApi>>();
  const caches = {
    open: (name: string) => {
      if (!opened.has(name)) opened.set(name, cacheApi(name));
      return Promise.resolve(opened.get(name));
    },
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
    match: (input: unknown) => {
      for (const s of stores.values()) {
        const hit = s.get(keyOf(input));
        if (hit !== undefined) return Promise.resolve(hit);
      }
      return Promise.resolve(undefined);
    },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting: vi.fn(() => Promise.resolve()),
    clients: { claim: vi.fn(() => Promise.resolve()) },
  };
  const fetchSpy = vi.fn(fetchImpl);
  vm.runInContext(
    SOURCE,
    vm.createContext({
      self,
      caches,
      fetch: fetchSpy,
      URL,
      Response: { error: () => response("", { ok: false, type: "error" }) },
    }),
  );

  const fire = async (type: string, event: Record<string, unknown>) => {
    let waited: Promise<unknown> | undefined;
    let responded: Promise<unknown> | undefined;
    listeners.get(type)?.({
      ...event,
      waitUntil: (p: Promise<unknown>) => {
        waited = p;
      },
      respondWith: (p: Promise<unknown>) => {
        responded = p;
      },
    });
    await waited;
    const res = responded === undefined ? undefined : await responded;
    // Zapisy do cache po nawigacji nie są czekane przez workera - dajemy im tik.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { waited: waited !== undefined, responded: responded !== undefined, res };
  };

  return { fire, stores, self, fetchSpy, store };
}

const navigate = (path: string) => ({
  request: { method: "GET", mode: "navigate", url: `${ORIGIN}${path}` },
});
const asset = (url: string, method = "GET") => ({ request: { method, mode: "cors", url } });

describe("instalacja i aktywacja", () => {
  it("instalacja zapisuje powłokę w cache v2 i od razu przejmuje rolę", async () => {
    const worker = loadWorker((url) => Promise.resolve(response(String(url))));

    await worker.fire("install", {});

    expect([...worker.store("nes-scanner-v2").keys()].sort()).toEqual([
      `${ORIGIN}/scanner`,
      `${ORIGIN}/scanner/icon-192.png`,
      `${ORIGIN}/scanner/icon-512.png`,
    ]);
    expect(worker.self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("brak sieci przy instalacji nie blokuje rejestracji", async () => {
    const worker = loadWorker(() => Promise.reject(new Error("offline")));

    await worker.fire("install", {});

    expect(worker.self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("aktywacja usuwa STARE wersje cache (v1) i przejmuje otwarte karty", async () => {
    const worker = loadWorker((url) => Promise.resolve(response(String(url))));
    worker.store("nes-scanner-v1").set("x", response("stara"));
    worker.store("nes-scanner-v2").set("y", response("nowa"));

    await worker.fire("activate", {});

    expect([...worker.stores.keys()]).toEqual(["nes-scanner-v2"]);
    expect(worker.self.clients.claim).toHaveBeenCalledTimes(1);
  });
});

describe("nawigacja /scanner", () => {
  it("udana odpowiedź sieci trafia do cache jako powłoka", async () => {
    const worker = loadWorker(() => Promise.resolve(response("swieza")));

    const { res } = await worker.fire("fetch", navigate("/scanner"));

    expect((res as FakeResponse).body).toBe("swieza");
    expect(worker.store("nes-scanner-v2").get(`${ORIGIN}/scanner`)?.body).toBe("swieza");
  });

  it("odpowiedź 5xx NIE zostaje powłoką - wraca do przeglądarki, ale cache jest nietknięty", async () => {
    const worker = loadWorker(() => Promise.resolve(response("blad", { ok: false })));
    worker.store("nes-scanner-v2").set(`${ORIGIN}/scanner`, response("dobra"));

    const { res } = await worker.fire("fetch", navigate("/scanner?t=x"));

    expect((res as FakeResponse).body).toBe("blad");
    expect(worker.store("nes-scanner-v2").get(`${ORIGIN}/scanner`)?.body).toBe("dobra");
  });

  it("bez sieci oddaje powłokę z cache", async () => {
    const worker = loadWorker(() => Promise.reject(new Error("offline")));
    worker.store("nes-scanner-v2").set(`${ORIGIN}/scanner`, response("z-cache"));

    const { res } = await worker.fire("fetch", navigate("/scanner"));

    expect((res as FakeResponse).body).toBe("z-cache");
  });

  it("bez sieci i bez powłoki oddaje błąd sieci, a nie pustą stronę", async () => {
    const worker = loadWorker(() => Promise.reject(new Error("offline")));

    const { res } = await worker.fire("fetch", navigate("/scanner"));

    expect((res as FakeResponse).type).toBe("error");
  });

  it("nawigacja poza /scanner zostaje przeglądarce", async () => {
    const worker = loadWorker(() => Promise.resolve(response("x")));

    const { responded } = await worker.fire("fetch", navigate("/events/kongres"));

    expect(responded).toBe(false);
  });

  it("żądanie inne niż GET (zapis do bazy) nigdy nie przechodzi przez cache", async () => {
    const worker = loadWorker(() => Promise.resolve(response("x")));

    const { responded } = await worker.fire("fetch", asset(`${ORIGIN}/assets/a.js`, "POST"));

    expect(responded).toBe(false);
  });
});

describe("zasoby budowania", () => {
  it("trafienie w cache oddaje zasób bez sieci", async () => {
    const worker = loadWorker(() => Promise.reject(new Error("offline")));
    worker.store("nes-scanner-v2").set(`${ORIGIN}/assets/a.js`, response("kod"));

    const { res } = await worker.fire("fetch", asset(`${ORIGIN}/assets/a.js`));

    expect((res as FakeResponse).body).toBe("kod");
    expect(worker.fetchSpy).not.toHaveBeenCalled();
  });

  it("chybienie pobiera z sieci i zapisuje TYLKO udaną odpowiedź z tego samego źródła", async () => {
    const worker = loadWorker((input) =>
      Promise.resolve(
        keyOf(input).endsWith("ok.js") ? response("ok") : response("zle", { ok: false }),
      ),
    );

    await worker.fire("fetch", asset(`${ORIGIN}/_build/ok.js`));
    await worker.fire("fetch", asset(`${ORIGIN}/_build/zle.js`));

    expect(worker.store("nes-scanner-v2").has(`${ORIGIN}/_build/ok.js`)).toBe(true);
    expect(worker.store("nes-scanner-v2").has(`${ORIGIN}/_build/zle.js`)).toBe(false);
  });

  it("zasób z innego źródła (baza, CDN) zostaje przeglądarce", async () => {
    const worker = loadWorker(() => Promise.resolve(response("x")));

    const { responded } = await worker.fire("fetch", asset("https://db.example/rest/v1/rpc/x"));

    expect(responded).toBe(false);
  });
});

describe("rozgrzanie cache na prośbę strony", () => {
  function channel() {
    const messages: unknown[] = [];
    return { port: { postMessage: (m: unknown) => messages.push(m) }, messages };
  }

  it("dociąga zasoby strony, liczy zapisane i odpowiada na porcie kanału", async () => {
    const worker = loadWorker((input) =>
      Promise.resolve(
        keyOf(input).includes("zle") ? response("x", { ok: false }) : response(keyOf(input)),
      ),
    );
    worker.store("nes-scanner-v2").set(`${ORIGIN}/assets/juz.js`, response("juz"));
    const { port, messages } = channel();

    await worker.fire("message", {
      data: {
        type: "precache",
        urls: [
          `${ORIGIN}/scanner`,
          `${ORIGIN}/assets/juz.js`,
          `${ORIGIN}/assets/nowy.js`,
          `${ORIGIN}/assets/zle.js`,
          `${ORIGIN}/api/public/cos`,
          "https://obce.example/assets/a.js",
          "http://[zly-adres",
          42,
        ],
      },
      ports: [port],
    });

    expect(messages).toEqual([{ type: "precache-done", cached: 3, total: 4 }]);
    expect(worker.store("nes-scanner-v2").has(`${ORIGIN}/assets/nowy.js`)).toBe(true);
    // Adres spoza powłoki i budowania (API, obce źródło) nie był nawet pobierany.
    expect(worker.fetchSpy.mock.calls.map((call) => keyOf(call[0]))).not.toContain(
      `${ORIGIN}/api/public/cos`,
    );
  });

  it("zasób, którego nie da się pobrać, liczy się jako NIEzapisany", async () => {
    const worker = loadWorker(() => Promise.reject(new Error("offline")));
    const { port, messages } = channel();

    await worker.fire("message", {
      data: { type: "precache", urls: [`${ORIGIN}/assets/a.js`] },
      ports: [port],
    });

    expect(messages).toEqual([{ type: "precache-done", cached: 0, total: 1 }]);
  });

  it("odpowiedź z innego źródła po przekierowaniu (`opaque`) nie trafia do cache", async () => {
    const worker = loadWorker(() => Promise.resolve(response("x", { type: "opaque" })));
    const { port, messages } = channel();

    await worker.fire("message", {
      data: { type: "precache", urls: [`${ORIGIN}/assets/a.js`] },
      ports: [port],
    });

    expect(messages).toEqual([{ type: "precache-done", cached: 0, total: 1 }]);
  });

  it("prośba bez portu nadal rozgrzewa cache, tylko nie odpowiada", async () => {
    const worker = loadWorker(() => Promise.resolve(response("x")));

    const { waited } = await worker.fire("message", {
      data: { type: "precache", urls: [`${ORIGIN}/assets/a.js`] },
    });

    expect(waited).toBe(true);
    expect(worker.store("nes-scanner-v2").has(`${ORIGIN}/assets/a.js`)).toBe(true);
  });

  it("obce wiadomości i prośba bez listy są ignorowane", async () => {
    const worker = loadWorker(() => Promise.resolve(response("x")));

    for (const data of [null, { type: "push" }, { type: "precache", urls: "a.js" }]) {
      const { waited } = await worker.fire("message", { data, ports: [] });
      expect(waited).toBe(false);
    }
  });
});
