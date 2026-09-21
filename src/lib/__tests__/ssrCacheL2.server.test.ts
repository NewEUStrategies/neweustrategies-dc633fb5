// @vitest-environment node
//
// Prawdziwy adapter L2 `edgeTtlCache` na atrapie `caches.default`: adresowanie
// migawki (origin bazy, wersje, host, klucz), sprzężenie z bumpem wersji
// dokumentów i degradacja do no-op poza Workers. Polityka po stronie
// `ssrCache.ts` ma osobny plik (`ssrCacheL2.test.ts`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { edgeTtlL2Adapter, resetEdgeTtlL2ForTests } from "@/lib/ssrCacheL2.server";
import { bumpL2Version, setColoCacheForTests } from "@/lib/http/documentCacheL2.server";
import {
  EDGE_TTL_CHROME_MAX_AGE_MS,
  clearEdgeTtlCache,
  edgeTtlCache,
  invalidateEdgeTtlCache,
  setEdgeTtlL2Adapter,
} from "@/lib/ssrCache";

const state = vi.hoisted(() => ({
  host: null as string | null,
  /** Prace zarejestrowane „za odpowiedzią" przez `completeAfterResponse`. */
  background: [] as Promise<unknown>[],
}));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve(state.host),
  requestPublicHost: () => state.host,
}));

vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>) => {
    state.background.push(work);
  },
}));

// Wierny funkcjonalnie zamiennik `caches.default`: mapa URL -> Response.
const entries = new Map<string, Response>();
const put = vi.fn(async (request: Request, response: Response) => {
  entries.set(request.url, response.clone());
});
const match = vi.fn(async (request: Request) => entries.get(request.url)?.clone());

const TTL = 60_000;
const MAX_AGE = TTL * 5;

async function settleBackground(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await Promise.all(state.background.map((p) => p.catch(() => undefined)));
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2099-06-15T12:00:00Z"));
  vi.stubEnv("SUPABASE_URL", "https://project-a.supabase.co");
  entries.clear();
  vi.clearAllMocks();
  setColoCacheForTests({ match, put });
  resetEdgeTtlL2ForTests();
  clearEdgeTtlCache();
  state.host = "a.example";
  state.background.length = 0;
});

afterEach(() => {
  setEdgeTtlL2Adapter(undefined);
  setColoCacheForTests(undefined);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("adapter L2 edgeTtlCache: adresowanie migawki", () => {
  it("a cold isolate serves chrome after a quiet hour and refreshes it once", async () => {
    const key = "site_settings_public:all";
    setEdgeTtlL2Adapter(edgeTtlL2Adapter);
    await edgeTtlCache(key, TTL, async () => ({ title: "existing chrome" }));
    await settleBackground();
    const stored = [...entries.values()].find(
      (entry) => entry.headers.get("content-type") === "application/json",
    );
    expect(stored?.headers.get("cache-control")).toBe(
      `public, max-age=${EDGE_TTL_CHROME_MAX_AGE_MS / 1000}`,
    );

    vi.advanceTimersByTime(60 * 60_000);
    clearEdgeTtlCache();
    resetEdgeTtlL2ForTests();
    let release!: (value: { title: string }) => void;
    const refresh = vi.fn(
      () =>
        new Promise<{ title: string }>((resolve) => {
          release = resolve;
        }),
    );
    await expect(edgeTtlCache(key, TTL, refresh)).resolves.toEqual({ title: "existing chrome" });
    await expect(edgeTtlCache(key, TTL, refresh)).resolves.toEqual({ title: "existing chrome" });
    expect(refresh).toHaveBeenCalledTimes(1);
    release({ title: "new chrome" });
    await settleBackground();
    await expect(edgeTtlCache(key, TTL, refresh)).resolves.toEqual({ title: "new chrome" });
  });

  it("content snapshots still expire after five TTLs", async () => {
    const key = "public:resolved:article";
    setEdgeTtlL2Adapter(edgeTtlL2Adapter);
    await edgeTtlCache(key, TTL, async () => "old content");
    await settleBackground();
    vi.advanceTimersByTime(TTL * 5 + 1);
    clearEdgeTtlCache();
    const fresh = vi.fn(async () => "current content");
    await expect(edgeTtlCache(key, TTL, fresh)).resolves.toBe("current content");
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("zapis i odczyt w obrębie okna: świeży -> stale na granicy TTL -> null na granicy 5 x TTL", async () => {
    const at = Date.now();
    await edgeTtlL2Adapter.write("a.example", "k", { at, value: "v" }, TTL, MAX_AGE);
    expect([...entries.values()][0].headers.get("cache-control")).toBe(
      `public, max-age=${MAX_AGE / 1000}`,
    );
    vi.advanceTimersByTime(TTL - 1);
    await expect(edgeTtlL2Adapter.read("a.example", "k", TTL, MAX_AGE)).resolves.toEqual({
      at,
      value: "v",
      stale: false,
    });
    vi.advanceTimersByTime(1);
    await expect(edgeTtlL2Adapter.read("a.example", "k", TTL, MAX_AGE)).resolves.toEqual({
      at,
      value: "v",
      stale: true,
    });
    vi.advanceTimersByTime(MAX_AGE - TTL);
    await expect(edgeTtlL2Adapter.read("a.example", "k", TTL, MAX_AGE)).resolves.toBeNull();
  });

  it("klucz niesie host, klucz logiczny i wersje - inne wartości nie trafiają w wpis", async () => {
    await edgeTtlL2Adapter.write("a.example", "k", { at: Date.now(), value: "v" }, TTL, MAX_AGE);
    const url = [...entries.keys()].find((u) => u.includes("edge"));
    expect(url).toContain(encodeURIComponent("edge:v0.0:a.example::k"));
    await expect(edgeTtlL2Adapter.read("b.example", "k", TTL, MAX_AGE)).resolves.toBeNull();
    await expect(edgeTtlL2Adapter.read("a.example", "k2", TTL, MAX_AGE)).resolves.toBeNull();
    await expect(edgeTtlL2Adapter.read("no-host", "k", TTL, MAX_AGE)).resolves.toBeNull();
    // Inny projekt bazy dzielący kolonię nie widzi tej migawki.
    vi.stubEnv("SUPABASE_URL", "https://project-b.supabase.co");
    await expect(edgeTtlL2Adapter.read("a.example", "k", TTL, MAX_AGE)).resolves.toBeNull();
  });

  it("odrzuca migawkę z wartością null/undefined (nie ma czego serwować)", async () => {
    await edgeTtlL2Adapter.write("a.example", "k", { at: Date.now(), value: null }, TTL, MAX_AGE);
    await expect(edgeTtlL2Adapter.read("a.example", "k", TTL, MAX_AGE)).resolves.toBeNull();
  });
});

describe("adapter L2 edgeTtlCache: sprzężenie z wersją L2 dokumentów", () => {
  // To jest TEST DRYFU adresu wersji: `ssrCacheL2.server.ts` czyta wpisy
  // wersji pod adresem skopiowanym z `documentCacheL2.server.ts`. Bump PRZEZ
  // moduł dokumentów musi odciąć migawki edgeTtlCache - inaczej pełny purge
  // operatora (zapis ustawień/menu/motywu) zostawiałby kolonii stare dane.
  it("bump wersji hosta przez bumpL2Version odcina migawki TEGO hosta", async () => {
    await edgeTtlL2Adapter.write("a.example", "k", { at: Date.now(), value: "a" }, TTL, MAX_AGE);
    await edgeTtlL2Adapter.write("b.example", "k", { at: Date.now(), value: "b" }, TTL, MAX_AGE);
    await bumpL2Version("a.example");
    // Memo wersji (2 s) musi wygasnąć - jak w documentCacheL2 dla innych izolatów.
    vi.advanceTimersByTime(2_000);
    await expect(edgeTtlL2Adapter.read("a.example", "k", TTL, MAX_AGE)).resolves.toBeNull();
    await expect(edgeTtlL2Adapter.read("b.example", "k", TTL, MAX_AGE)).resolves.toMatchObject({
      value: "b",
    });
    // Nowa migawka ląduje pod NOWĄ wersją i jest czytelna.
    await edgeTtlL2Adapter.write("a.example", "k", { at: Date.now(), value: "a2" }, TTL, MAX_AGE);
    await expect(edgeTtlL2Adapter.read("a.example", "k", TTL, MAX_AGE)).resolves.toMatchObject({
      value: "a2",
    });
    // Stara migawka leży pod `v0.0`, nowa pod `v0.<bump>` - segment globalny
    // bez zmian, segment hosta podbity.
    const forA = [...entries.keys()].filter((u) => u.includes(encodeURIComponent("a.example::k")));
    expect(forA).toHaveLength(2);
    expect(forA.some((u) => u.includes(encodeURIComponent("edge:v0.0:a.example::k")))).toBe(true);
    expect(forA.some((u) => !u.includes(encodeURIComponent("edge:v0.0:")))).toBe(true);
  });

  it("bump wersji globalnej odcina migawki WSZYSTKICH hostów", async () => {
    await edgeTtlL2Adapter.write("a.example", "k", { at: Date.now(), value: "a" }, TTL, MAX_AGE);
    await edgeTtlL2Adapter.write("no-host", "k", { at: Date.now(), value: "n" }, TTL, MAX_AGE);
    await bumpL2Version(null);
    vi.advanceTimersByTime(2_000);
    await expect(edgeTtlL2Adapter.read("a.example", "k", TTL, MAX_AGE)).resolves.toBeNull();
    await expect(edgeTtlL2Adapter.read("no-host", "k", TTL, MAX_AGE)).resolves.toBeNull();
  });

  it("wersje są memoizowane 2 s: równoległe odczyty dzielą dwa match() wersji", async () => {
    await Promise.all([
      edgeTtlL2Adapter.read("a.example", "k1", TTL, MAX_AGE),
      edgeTtlL2Adapter.read("a.example", "k2", TTL, MAX_AGE),
      edgeTtlL2Adapter.read("a.example", "k3", TTL, MAX_AGE),
    ]);
    const versionReads = match.mock.calls.filter(([r]) => r.url.includes("/__nes/version/"));
    expect(versionReads).toHaveLength(2);
  });
});

describe("adapter L2 edgeTtlCache: degradacja poza Workers", () => {
  it("bez Cache API jest wyłączony, a odczyt/zapis to no-op", async () => {
    setColoCacheForTests(null);
    resetEdgeTtlL2ForTests();
    expect(edgeTtlL2Adapter.enabled()).toBe(false);
    await expect(
      edgeTtlL2Adapter.write("a.example", "k", { at: Date.now(), value: "v" }, TTL, MAX_AGE),
    ).resolves.toBeUndefined();
    await expect(edgeTtlL2Adapter.read("a.example", "k", TTL, MAX_AGE)).resolves.toBeNull();
    expect(put).not.toHaveBeenCalled();
    expect(match).not.toHaveBeenCalled();
  });

  it("bez SUPABASE_URL migawka nie ma adresu - wyłączony", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    expect(edgeTtlL2Adapter.enabled()).toBe(false);
    await expect(edgeTtlL2Adapter.read("a.example", "k", TTL, MAX_AGE)).resolves.toBeNull();
  });

  it("połyka awarię Cache API przy odczycie i zapisie", async () => {
    setColoCacheForTests({
      match: async () => {
        throw new Error("cache offline");
      },
      put: async () => {
        throw new Error("cache full");
      },
    });
    resetEdgeTtlL2ForTests();
    expect(edgeTtlL2Adapter.enabled()).toBe(true);
    await expect(
      edgeTtlL2Adapter.write("a.example", "k", { at: Date.now(), value: "v" }, TTL, MAX_AGE),
    ).resolves.toBeUndefined();
    await expect(edgeTtlL2Adapter.read("a.example", "k", TTL, MAX_AGE)).resolves.toBeNull();
  });
});

describe("edgeTtlCache + prawdziwy adapter: rotacja izolatu w ciepłej kolonii", () => {
  it("does not keep a missing chrome row for the extended snapshot lifetime", async () => {
    setEdgeTtlL2Adapter(edgeTtlL2Adapter);
    await edgeTtlCache("site_design_tokens:row", TTL, async () => null);
    vi.advanceTimersByTime(TTL * 5 + 1);
    await expect(
      edgeTtlCache("site_design_tokens:row", TTL, async () => ({ fonts: {} })),
    ).resolves.toEqual({ fonts: {} });
  });

  it("zimny izolat wstaje z migawki poprzednika bez round-tripu do bazy", async () => {
    setEdgeTtlL2Adapter(edgeTtlL2Adapter);
    const first = vi.fn().mockResolvedValue({ site_title: "NES" });
    await expect(edgeTtlCache("site_settings_public:all", TTL, first)).resolves.toEqual({
      site_title: "NES",
    });
    await settleBackground();
    expect(put.mock.calls.some(([r]) => r.url.includes(encodeURIComponent("edge:")))).toBe(true);

    // „Rotacja izolatu": L1 znika, kolonia (atrapa Cache API) zostaje.
    clearEdgeTtlCache();
    const second = vi.fn().mockResolvedValue({ site_title: "z bazy" });
    await expect(edgeTtlCache("site_settings_public:all", TTL, second)).resolves.toEqual({
      site_title: "NES",
    });
    expect(second).not.toHaveBeenCalled();
  });

  it("po ciszy dłuższej niż TTL migawka serwuje od ręki, a odświeżenie odnawia kolonię", async () => {
    setEdgeTtlL2Adapter(edgeTtlL2Adapter);
    await edgeTtlCache("menu-with-items:main", TTL, () => Promise.resolve("menu-v1"));
    await settleBackground();
    clearEdgeTtlCache();
    vi.advanceTimersByTime(TTL * 3);

    const refresher = vi.fn().mockResolvedValue("menu-v2");
    await expect(edgeTtlCache("menu-with-items:main", TTL, refresher)).resolves.toBe("menu-v1");
    expect(refresher).toHaveBeenCalledTimes(1);
    await settleBackground();
    // Trzeci izolat widzi już odświeżoną migawkę - świeżą.
    clearEdgeTtlCache();
    await expect(
      edgeTtlL2Adapter.read("a.example", "menu-with-items:main", TTL, MAX_AGE),
    ).resolves.toMatchObject({ value: "menu-v2", stale: false });
  });

  it("unieważnienie operatora nadpisuje migawkę kolonii świeżym wynikiem", async () => {
    setEdgeTtlL2Adapter(edgeTtlL2Adapter);
    await edgeTtlCache("site_design_tokens:row", TTL, () => Promise.resolve({ colors: "old" }));
    await settleBackground();
    await invalidateEdgeTtlCache("site_design_tokens:row");
    await expect(
      edgeTtlCache("site_design_tokens:row", TTL, () => Promise.resolve({ colors: "new" })),
    ).resolves.toEqual({ colors: "new" });
    await settleBackground();
    await expect(
      edgeTtlL2Adapter.read("a.example", "site_design_tokens:row", TTL, MAX_AGE),
    ).resolves.toMatchObject({ value: { colors: "new" } });
  });

  it("wartość poza białą listą nie zostawia śladu w Cache API", async () => {
    setEdgeTtlL2Adapter(edgeTtlL2Adapter);
    await edgeTtlCache("donations:config", TTL, () => Promise.resolve({ enabled: true }));
    await settleBackground();
    expect(put).not.toHaveBeenCalled();
    expect(match).not.toHaveBeenCalled();
  });
});
