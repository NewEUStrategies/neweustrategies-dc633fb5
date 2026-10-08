// @vitest-environment node
// NONCE ZNACZNIKA REWALIDACJI (fala 3, P3.6a, runda 10 - bezpieczeństwo, istniejące na produkcji).
//
// `documentCache.server.ts` jest statycznie w grafie wejścia Workera, więc wyrażenie w zasięgu
// modułu liczy się w zakresie globalnym workerd: losowanie jest tam zabronione (`randomUUID`
// rzuca), a `Date.now()` zwraca 0. Dawny nonce liczony w zasięgu modułu spadał więc do
// przewidywalnego `nes-0` i każde żądanie z zewnątrz z `x-nes-revalidate: nes-0` było traktowane
// jak odświeżenie z izolatu: omijało L1 i L2, wymuszało render i nadpisywało wpis kolonii.
// Ta suita odtwarza zakres globalny workerd przy IMPORCIE modułu (losowanie rzuca, zegar = 0)
// i sprawdza, że: import niczego nie losuje, `nes-0` i pusty nagłówek nie są znacznikiem, nonce
// powstaje dopiero w zakresie żądania, a bez losowości rewalidacja jest wyłączona. Każdy test
// dostaje świeżą instancję modułu (`vi.resetModules`), czyli świeży izolat bez nonce'a. Druga
// zapora (driver w `src/server.ts`) ma osobny plik: `revalidationNonceDriver.test.ts`.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>): void => {
    void work.catch(() => undefined);
  },
}));

vi.mock("../requestHost", () => ({
  trustedPublicHost: async (request: Request) => new URL(request.url).hostname,
  currentTenantHost: async () => "tenant-a.eu",
}));

const CACHEABLE = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=60, s-maxage=900, stale-while-revalidate=86400",
};
const MINUTE = 60_000;

type CacheModule = typeof import("../documentCache.server");

/** Runtime bez losowości w tym zakresie: `randomUUID` i `getRandomValues` rzucają. */
function forbidRandomness() {
  const forbidden = () => {
    throw new Error("Disallowed operation called within global scope");
  };
  return {
    randomUUID: vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(forbidden),
    getRandomValues: vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(forbidden),
  };
}

/** Zakres globalny workerd: losowanie rzuca, zegar stoi na 0. */
function enterWorkerdGlobalScope() {
  return { ...forbidRandomness(), now: vi.spyOn(Date, "now").mockReturnValue(0) };
}

/** Świeży izolat: nowa instancja modułu, jak po zimnym starcie Workera. */
async function freshCacheModule(): Promise<CacheModule> {
  vi.resetModules();
  return import("../documentCache.server");
}

function docRequest(path: string, marker?: string): Request {
  return new Request(`https://tenant-a.eu${path}`, {
    headers: marker === undefined ? {} : { "x-nes-revalidate": marker },
  });
}

/** Wpis w L1 przez pełny cykl MISS (middleware + odroczony zapis z `src/server.ts`). */
async function seed(cache: CacheModule, path: string, body: string): Promise<void> {
  const miss = await cache.handleDocumentRequest(
    docRequest(path),
    () => new Response(body, { headers: CACHEABLE }),
  );
  await cache.applyDeferredDocumentStore(miss as Response).text();
  await vi.waitFor(async () => {
    expect((await cache.probeDocumentCache(path, "tenant-a.eu")).status).toBe("HIT");
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("nonce znacznika rewalidacji", () => {
  it("import modułu w zakresie globalnym workerd niczego nie losuje, a `nes-0` nie jest znacznikiem", async () => {
    const scope = enterWorkerdGlobalScope();
    const cache = await freshCacheModule();
    expect(scope.randomUUID).not.toHaveBeenCalled();
    expect(scope.getRandomValues).not.toHaveBeenCalled();
    // Dawny fallback z zakresu globalnego: `nes-${Date.now().toString(36)}` przy zegarze 0.
    expect(cache.isRevalidationRequest(docRequest("/", "nes-0"))).toBe(false);
    vi.restoreAllMocks();

    // Zakres żądania: losowanie dozwolone - nonce powstaje dopiero teraz i jest losowy.
    const marker = cache.revalidationHeader();
    expect(marker).not.toBeNull();
    const [name, nonce] = marker!;
    expect(name).toBe("x-nes-revalidate");
    expect(nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(nonce).not.toBe("nes-0");
    // Raz na izolat: kolejne odczyty dają ten sam nonce.
    expect(cache.revalidationHeader()![1]).toBe(nonce);
  });

  it("sprawdzenie znacznika samo niczego nie losuje (żądanie z zewnątrz nie tworzy nonce'a)", async () => {
    const cache = await freshCacheModule();
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID");
    expect(cache.isRevalidationRequest(docRequest("/", "cokolwiek"))).toBe(false);
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it("`nes-0`, pusty i obcy znacznik nie omijają cache'u - wyłącznie nonce izolatu", async () => {
    const cache = await freshCacheModule();
    await seed(cache, "/wpis", "<html>z-cache</html>");
    const [, nonce] = cache.revalidationHeader()!;

    const forgeries = [
      "nes-0",
      "",
      "0",
      "1",
      crypto.randomUUID(),
      nonce.toUpperCase(),
      nonce.slice(1),
    ];
    for (const forged of forgeries) {
      const render = vi.fn(() => new Response("<html>wymuszony</html>", { headers: CACHEABLE }));
      const response = (await cache.handleDocumentRequest(
        docRequest("/wpis", forged),
        render,
      )) as Response;
      expect(response.headers.get("x-nes-cache"), `znacznik ${JSON.stringify(forged)}`).toBe("HIT");
      expect(render).not.toHaveBeenCalled();
    }

    // Jedyny legalny przypadek: nonce wylosowany przez ten izolat - render mimo wpisu.
    const render = vi.fn(() => new Response("<html>odswiezony</html>", { headers: CACHEABLE }));
    const refreshed = (await cache.handleDocumentRequest(
      docRequest("/wpis", nonce),
      render,
    )) as Response;
    expect(refreshed.headers.get("x-nes-cache")).toBe("MISS");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("bez losowości rewalidacja jest wyłączona: brak nonce'a, driver nie rusza, nagłówek ignorowany", async () => {
    const cache = await freshCacheModule();
    vi.useFakeTimers({ toFake: ["Date"] });
    await seed(cache, "/analiza", "<html>v1</html>");
    vi.setSystemTime(Date.now() + 10 * MINUTE);

    forbidRandomness();
    expect(cache.revalidationHeader()).toBeNull();

    const revalidator = vi.fn(async () => true);
    cache.setDocumentRevalidator(revalidator);
    for (const marker of [undefined, "nes-0", ""]) {
      const render = vi.fn(() => new Response("<html>wymuszony</html>", { headers: CACHEABLE }));
      const response = (await cache.handleDocumentRequest(
        docRequest("/analiza", marker),
        render,
      )) as Response;
      expect(response.headers.get("x-nes-cache")).toBe("STALE");
      expect(await response.text()).toBe("<html>v1</html>");
      expect(render).not.toHaveBeenCalled();
    }
    expect(revalidator).not.toHaveBeenCalled();
    expect(cache.getDocumentCacheSnapshot().revalidations).toBe(0);
  });
});
