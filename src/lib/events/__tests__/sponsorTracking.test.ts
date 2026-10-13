// Rdzeń pomiaru ekspozycji sponsorów (`sponsorTracking.ts`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. POMIAR BEZ ZGODY - pozycja dodana albo wysłana, gdy użytkownik nie
//      zgodził się na pomiar marketingowy (albo cofnął zgodę między dodaniem
//      a wysyłką). Deklaracja banera (`sponsor_event`) mówi co innego.
//   2. SESJA BEZ ZGODY albo zostaje po jej cofnięciu - także sesja, którą
//      serwer odesłał już PO cofnięciu zgody.
//   3. KLIK GINIE PRZY NAWIGACJI - kliknięcie musi wyjść od razu (beacon
//      przeżywa przejście na stronę sponsora), a nie czekać na bezczynność.
//   4. PACZKA PRZEKRACZA LIMIT BAZY - ponad 40 pozycji w jednym beaconie baza
//      obetnie po cichu.
//   5. ZABLOKOWANY MAGAZYN WYWRACA STRONĘ - tryb prywatny ma działać.
//   6. PRZEGLĄDARKA WYMYŚLA SESJĘ (OPS-09) - tak wyglądało nabijanie
//      „unikalnych": sesję wydaje serwer w odpowiedzi na pierwszą paczkę,
//      a w trakcie tej wymiany pozycje czekają, zamiast zakładać drugą sesję.
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  consent: true,
  beacons: [] as unknown[],
  idle: [] as (() => void)[],
  consentListeners: [] as (() => void)[],
}));
vi.mock("@/lib/ads/consent", () => ({
  hasCategoryConsent: (cat: string) => cat === "marketing" && h.consent,
  subscribeConsentChange: (listener: () => void) => {
    h.consentListeners.push(listener);
    return () => undefined;
  },
}));
vi.mock("@/lib/observability/report", () => ({
  sendBeaconPayload: (endpoint: string, payload: unknown) => {
    h.beacons.push({ endpoint, payload });
    return true;
  },
}));
vi.mock("@/lib/ads/idle", () => ({
  whenIdle: (run: () => void) => {
    h.idle.push(run);
    return () => undefined;
  },
}));

import {
  clearSponsorSession,
  createSponsorTracker,
  defaultSponsorTrackerDeps,
  exchangeSponsorPayload,
  readSponsorSession,
  storeSponsorSession,
  type SponsorTrackerDeps,
} from "@/lib/events/sponsorTracking";
import type { SponsorExposureItem } from "@/lib/events/sponsorExposure";
import { classifyKey } from "@/lib/cookieBanner/registry";
import { SPONSOR_SESSION_STORAGE_KEY } from "@/lib/storageKeys";

const S = "11111111-1111-4111-8111-111111111111";
const KEY = "nes-sponsor-session";
/** Sesja w kształcie serwera: nonce (32 hex) + podpis (32 hex). */
const TOKEN = "a".repeat(32) + "b".repeat(32);
const VIEW: SponsorExposureItem = { sponsorId: S, placement: "home_strip", kind: "view" };
const CLICK: SponsorExposureItem = { sponsorId: S, placement: "home_strip", kind: "click" };
const VIEW_WIRE = { placement: "home_strip", kind: "view", sponsor_id: S };
const CLICK_WIRE = { placement: "home_strip", kind: "click", sponsor_id: S };

/** Odpowiedzi wymiany rozwiązują się w mikrozadaniach - czekamy, aż opadną. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

function harness(patch: Partial<SponsorTrackerDeps> = {}) {
  const sent: { endpoint: string; payload: Record<string, unknown> }[] = [];
  const exchanged: { endpoint: string; payload: Record<string, unknown> }[] = [];
  const answers: ((session: string | null) => void)[] = [];
  const scheduled: (() => void)[] = [];
  const cancelled: number[] = [];
  const state = { consent: true, storage: memoryStorage() as Storage | null };
  const deps: SponsorTrackerDeps = {
    hasConsent: () => state.consent,
    send: (endpoint, payload) => {
      sent.push({ endpoint, payload: payload as Record<string, unknown> });
      return true;
    },
    exchange: (endpoint, payload) => {
      exchanged.push({ endpoint, payload: payload as Record<string, unknown> });
      return new Promise<string | null>((resolve) => answers.push(resolve));
    },
    schedule: (run) => {
      scheduled.push(run);
      const index = scheduled.length;
      return () => cancelled.push(index);
    },
    storage: () => state.storage,
    ...patch,
  };
  /** Serwer odpowiada na najstarszą wymianę w locie. */
  async function answer(session: string | null): Promise<void> {
    answers.shift()?.(session);
    await settle();
  }
  return { deps, sent, exchanged, scheduled, cancelled, state, answer };
}

/** Tracker z sesją serwera już w magazynie (powracający gość). */
function withSession(patch: Partial<SponsorTrackerDeps> = {}) {
  const t = harness(patch);
  t.state.storage = memoryStorage({ [KEY]: TOKEN });
  return t;
}

describe("sesja wydawana przez serwer (OPS-09)", () => {
  it("pierwsza paczka idzie BEZ sesji przez wymianę; sesja z odpowiedzi trafia do magazynu i niosą ją kolejne beacony", async () => {
    const t = harness();
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(VIEW);
    t.scheduled[0]();
    expect(t.sent).toEqual([]);
    expect(t.exchanged).toEqual([
      {
        endpoint: "/api/public/sponsor-event",
        payload: { event_slug: "kongres", items: [VIEW_WIRE] },
      },
    ]);
    expect("session" in t.exchanged[0].payload).toBe(false);
    await t.answer(TOKEN);
    expect(t.state.storage?.getItem(KEY)).toBe(TOKEN);
    tracker.track(CLICK);
    expect(t.sent).toEqual([
      {
        endpoint: "/api/public/sponsor-event",
        payload: { event_slug: "kongres", session: TOKEN, items: [CLICK_WIRE] },
      },
    ]);
    expect(t.exchanged).toHaveLength(1);
  });

  it("w trakcie wymiany pozycje CZEKAJĄ na sesję zamiast zakładać drugą", async () => {
    const t = harness();
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(CLICK);
    tracker.track({ ...CLICK, placement: "partners_tab" });
    tracker.track(VIEW);
    t.scheduled[0]?.();
    expect(t.exchanged).toHaveLength(1);
    expect(t.sent).toEqual([]);
    await t.answer(TOKEN);
    expect(t.sent).toEqual([
      {
        endpoint: "/api/public/sponsor-event",
        payload: {
          event_slug: "kongres",
          session: TOKEN,
          items: [{ placement: "partners_tab", kind: "click", sponsor_id: S }, VIEW_WIRE],
        },
      },
    ]);
  });

  it("wysyłka pilna (ukrycie karty) w trakcie wymiany nie czeka: beacon bez sesji", () => {
    const t = harness();
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(CLICK);
    tracker.track(VIEW);
    tracker.flush();
    expect(t.exchanged).toHaveLength(1);
    expect(t.sent).toEqual([
      {
        endpoint: "/api/public/sponsor-event",
        payload: { event_slug: "kongres", items: [VIEW_WIRE] },
      },
    ]);
  });

  it("nieudana wymiana nie ponawia się w pętli; następną próbę wyzwala nowa pozycja", async () => {
    const t = harness();
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(CLICK);
    await t.answer(null);
    expect(t.exchanged).toHaveLength(1);
    expect(t.state.storage?.getItem(KEY)).toBeNull();
    tracker.track(CLICK);
    expect(t.exchanged).toHaveLength(2);
    await t.answer(TOKEN);
    expect(t.state.storage?.getItem(KEY)).toBe(TOKEN);
  });

  it("wymiana, która odrzuca albo rzuca, to po prostu brak sesji", async () => {
    const rejecting = harness({ exchange: () => Promise.reject(new Error("offline")) });
    const first = createSponsorTracker("kongres", rejecting.deps);
    first.track(CLICK);
    await settle();
    first.track(CLICK);
    expect(rejecting.state.storage?.getItem(KEY)).toBeNull();

    const throwing = harness({
      exchange: () => {
        throw new Error("fetch zablokowany");
      },
    });
    const second = createSponsorTracker("kongres", throwing.deps);
    expect(() => second.track(CLICK)).not.toThrow();
    await settle();
    expect(throwing.sent).toEqual([]);
  });

  it("zapamiętany identyfikator STAREGO klienta (32 hex) i zły kształt nie są sesją - idzie wymiana", async () => {
    for (const stored of ["c".repeat(32), "zly ksztalt!", TOKEN.toUpperCase()]) {
      const t = harness();
      t.state.storage = memoryStorage({ [KEY]: stored });
      const tracker = createSponsorTracker("kongres", t.deps);
      tracker.track(CLICK);
      expect(t.sent, stored).toEqual([]);
      expect(t.exchanged, stored).toHaveLength(1);
      await t.answer(TOKEN);
      expect(t.state.storage?.getItem(KEY)).toBe(TOKEN);
    }
  });

  it("zapamiętana sesja serwera jest używana ponownie - bez wymiany", () => {
    const t = withSession();
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(CLICK);
    expect(t.exchanged).toEqual([]);
    expect(t.sent[0].payload.session).toBe(TOKEN);
  });
});

describe("syncConsent (zmiana zgody)", () => {
  it("cofnięta zgoda od razu czyści kolejkę, zegar i sesję", async () => {
    const t = withSession();
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(CLICK);
    expect(t.sent).toHaveLength(1);
    tracker.track(VIEW);
    expect(t.scheduled).toHaveLength(1);
    t.state.consent = false;
    tracker.syncConsent();
    expect(t.cancelled).toEqual([1]);
    expect(t.state.storage?.getItem(KEY)).toBeNull();
    // Kolejka pusta: późniejsza wysyłka (po ponownej zgodzie) nie niesie starych pozycji.
    t.state.consent = true;
    tracker.flush();
    expect(t.sent).toHaveLength(1);
    // Nowa zgoda = nowa sesja z serwera, bez wznowienia starej.
    tracker.track(CLICK);
    expect(t.exchanged).toHaveLength(1);
    await t.answer("c".repeat(64));
    expect(t.state.storage?.getItem(KEY)).toBe("c".repeat(64));
  });

  it("zgoda cofnięta w trakcie wymiany: sesji z odpowiedzi NIE zapisujemy (nawet po powrocie zgody)", async () => {
    const t = harness();
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(CLICK);
    t.state.consent = false;
    tracker.syncConsent();
    t.state.consent = true;
    await t.answer(TOKEN);
    expect(t.state.storage?.getItem(KEY)).toBeNull();
    tracker.track(CLICK);
    expect(t.exchanged).toHaveLength(2);
    expect(t.sent).toEqual([]);
  });

  it("bez zaplanowanej wysyłki też czyści; przy zgodzie nic nie rusza", () => {
    const t = withSession();
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(CLICK);
    tracker.syncConsent();
    expect(t.state.storage?.getItem(KEY)).toBe(TOKEN);
    t.state.consent = false;
    tracker.syncConsent();
    expect(t.cancelled).toEqual([]);
    expect(t.state.storage?.getItem(KEY)).toBeNull();
  });
});

describe("createSponsorTracker", () => {
  it("wyświetlenia czekają na bezczynność i wychodzą JEDNĄ paczką", () => {
    const t = withSession();
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(VIEW);
    tracker.track({ ...VIEW, placement: "partners_section" });
    expect(t.sent).toEqual([]);
    expect(t.scheduled).toHaveLength(1);
    t.scheduled[0]();
    expect(t.sent).toEqual([
      {
        endpoint: "/api/public/sponsor-event",
        payload: {
          event_slug: "kongres",
          session: TOKEN,
          items: [VIEW_WIRE, { placement: "partners_section", kind: "view", sponsor_id: S }],
        },
      },
    ]);
  });

  it("kliknięcie wychodzi od razu, razem z czekającymi wyświetleniami, i kasuje harmonogram", () => {
    const t = withSession();
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(VIEW);
    tracker.track(CLICK);
    expect(t.cancelled).toEqual([1]);
    expect((t.sent[0].payload.items as unknown[]).length).toBe(2);
    tracker.flush();
    expect(t.sent).toHaveLength(1);
  });

  it("bez zgody przy dodaniu - nic nie trafia do kolejki, wymiany ani magazynu", () => {
    const t = harness();
    t.state.consent = false;
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(CLICK);
    expect(t.sent).toEqual([]);
    expect(t.exchanged).toEqual([]);
    expect(t.scheduled).toEqual([]);
    expect(t.state.storage?.getItem(KEY)).toBeNull();
  });

  it("zgoda cofnięta przed wysyłką - kolejka przepada, sesja znika", () => {
    const t = withSession();
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(VIEW);
    t.state.consent = false;
    t.scheduled[0]();
    expect(t.sent).toEqual([]);
    expect(t.exchanged).toEqual([]);
    expect(t.state.storage?.getItem(KEY)).toBeNull();
  });

  it("pozycja skazana na odrzucenie w ogóle nie wchodzi do kolejki", () => {
    const t = harness();
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track({ sponsorId: S, placement: "agenda_track", kind: "click" });
    expect(t.sent).toEqual([]);
    expect(t.exchanged).toEqual([]);
    expect(t.scheduled).toEqual([]);
  });

  it("paczki mają najwyżej 40 pozycji - beacony i wymiana", () => {
    const t = withSession();
    const tracker = createSponsorTracker("kongres", t.deps);
    for (let i = 0; i < 45; i += 1) tracker.track(VIEW);
    tracker.flush();
    expect(t.sent.map((beacon) => (beacon.payload.items as unknown[]).length)).toEqual([40, 5]);
    expect(t.sent[0].payload.session).toBe(t.sent[1].payload.session);

    // Bez sesji: pierwsze 40 idzie wymianą, reszta (wysyłka pilna) beaconem bez sesji.
    const fresh = harness();
    const second = createSponsorTracker("kongres", fresh.deps);
    for (let i = 0; i < 45; i += 1) second.track(VIEW);
    second.flush();
    expect((fresh.exchanged[0].payload.items as unknown[]).length).toBe(40);
    expect(fresh.sent.map((beacon) => (beacon.payload.items as unknown[]).length)).toEqual([5]);
    expect("session" in fresh.sent[0].payload).toBe(false);
  });

  it("po dispose() ostatnia kolejka wychodzi, a nowe pozycje są ignorowane", () => {
    const t = withSession();
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(VIEW);
    tracker.dispose();
    expect(t.sent).toHaveLength(1);
    tracker.track(CLICK);
    expect(t.sent).toHaveLength(1);
  });

  it("pusta kolejka nie wysyła niczego", () => {
    const t = harness();
    createSponsorTracker("kongres", t.deps).flush();
    expect(t.sent).toEqual([]);
    expect(t.exchanged).toEqual([]);
  });
});

describe("magazyn sesji - brak trwałości to stan, nie awaria", () => {
  function throwing(): Storage {
    return {
      ...memoryStorage(),
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
  }

  it("dostęp do magazynu rzuca - odczyt to brak sesji, zapis i usunięcie nie wybuchają", () => {
    const t = harness({
      storage: () => {
        throw new Error("blocked");
      },
    });
    expect(readSponsorSession(t.deps)).toBeNull();
    expect(() => storeSponsorSession(t.deps, TOKEN)).not.toThrow();
    expect(() => clearSponsorSession(t.deps)).not.toThrow();
  });

  it("odczyt, zapis i usunięcie rzucają - sesja żyje w pamięci trackera", async () => {
    const t = harness({ storage: throwing });
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(CLICK);
    await t.answer(TOKEN);
    tracker.track(CLICK);
    expect(t.sent[0].payload.session).toBe(TOKEN);
    expect(t.exchanged).toHaveLength(1);
  });

  it("brak magazynu (null) - sesja w pamięci", async () => {
    const t = harness();
    t.state.storage = null;
    expect(readSponsorSession(t.deps)).toBeNull();
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(CLICK);
    await t.answer(TOKEN);
    tracker.track(CLICK);
    expect(t.sent[0].payload.session).toBe(TOKEN);
    clearSponsorSession(t.deps);
  });
});

describe("wymiana z odpowiedzią (`exchangeSponsorPayload`)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(response: Response | Error) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    });
    return calls;
  }

  it("POST z keepalive na tę samą stronę; 200 { session } oddaje sesję", async () => {
    const calls = stubFetch(new Response(JSON.stringify({ session: TOKEN }), { status: 200 }));
    await expect(exchangeSponsorPayload("/api/public/sponsor-event", { a: 1 })).resolves.toBe(
      TOKEN,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/public/sponsor-event");
    expect(calls[0].init).toMatchObject({
      method: "POST",
      keepalive: true,
      credentials: "same-origin",
      body: JSON.stringify({ a: 1 }),
    });
  });

  it("204, sesja w złym kształcie, zepsuta treść i awaria sieci - brak sesji", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(exchangeSponsorPayload("/x", {})).resolves.toBeNull();
    stubFetch(new Response(JSON.stringify({ session: "f".repeat(32) }), { status: 200 }));
    await expect(exchangeSponsorPayload("/x", {})).resolves.toBeNull();
    stubFetch(new Response("{nie-json", { status: 200 }));
    await expect(exchangeSponsorPayload("/x", {})).resolves.toBeNull();
    stubFetch(new Error("offline"));
    await expect(exchangeSponsorPayload("/x", {})).resolves.toBeNull();
    vi.stubGlobal("fetch", undefined);
    await expect(exchangeSponsorPayload("/x", {})).resolves.toBeNull();
  });
});

describe("domyślne granice przeglądarki", () => {
  it("zgoda marketingowa, beacon, wymiana fetch, bezczynność i sessionStorage", () => {
    h.consent = true;
    expect(defaultSponsorTrackerDeps.hasConsent()).toBe(true);
    h.consent = false;
    expect(defaultSponsorTrackerDeps.hasConsent()).toBe(false);
    expect(defaultSponsorTrackerDeps.send("/x", { a: 1 })).toBe(true);
    expect(h.beacons).toEqual([{ endpoint: "/x", payload: { a: 1 } }]);
    expect(defaultSponsorTrackerDeps.exchange).toBe(exchangeSponsorPayload);
    const run = vi.fn();
    defaultSponsorTrackerDeps.schedule(run)();
    expect(h.idle).toEqual([run]);
    expect(defaultSponsorTrackerDeps.storage()).toBe(window.sessionStorage);
    const listener = vi.fn();
    defaultSponsorTrackerDeps.onConsentChange?.(listener);
    expect(h.consentListeners).toContain(listener);
  });
});

describe("tracker bez jawnych zależności", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("pierwszy klik idzie wymianą, sesja ląduje w sessionStorage, drugi klik - beaconem z sesją", async () => {
    h.consent = true;
    h.beacons = [];
    window.sessionStorage.clear();
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Promise.resolve(new Response(JSON.stringify({ session: TOKEN }), { status: 200 }));
    });
    const tracker = createSponsorTracker("kongres");
    tracker.track({ sponsorId: S, placement: "partners_tab", kind: "click" });
    expect(bodies).toEqual([
      {
        event_slug: "kongres",
        items: [{ placement: "partners_tab", kind: "click", sponsor_id: S }],
      },
    ]);
    expect(h.beacons).toEqual([]);
    await settle();
    expect(window.sessionStorage.getItem(KEY)).toBe(TOKEN);
    tracker.track(CLICK);
    expect(h.beacons).toEqual([
      {
        endpoint: "/api/public/sponsor-event",
        payload: { event_slug: "kongres", session: TOKEN, items: [CLICK_WIRE] },
      },
    ]);
    tracker.dispose();
  });
});

describe("deklaracja w banerze zgód", () => {
  it("klucz sesji pomiaru jest zadeklarowany jako sessionStorage w kategorii MARKETING", () => {
    // Deklaracja RODO musi mówić prawdę: sesja powstaje tylko po zgodzie
    // marketingowej, więc w banerze stoi pod tą kategorią, a nie jako
    // „wykryty automatycznie" element niezbędny.
    expect(SPONSOR_SESSION_STORAGE_KEY.key).toBe(KEY);
    expect(classifyKey(KEY)).toMatchObject({
      name: "sponsor_event",
      category: "marketing",
      kind: "sessionStorage",
    });
  });
});
