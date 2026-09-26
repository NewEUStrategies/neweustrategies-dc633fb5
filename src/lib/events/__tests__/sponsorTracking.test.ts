// Rdzeń pomiaru ekspozycji sponsorów (`sponsorTracking.ts`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. POMIAR BEZ ZGODY - pozycja dodana albo wysłana, gdy użytkownik nie
//      zgodził się na pomiar marketingowy (albo cofnął zgodę między dodaniem
//      a wysyłką). Deklaracja banera (`sponsor_event`) mówi co innego.
//   2. IDENTYFIKATOR SESJI POWSTAJE BEZ ZGODY albo zostaje po jej cofnięciu.
//   3. KLIK GINIE PRZY NAWIGACJI - kliknięcie musi wyjść od razu (beacon
//      przeżywa przejście na stronę sponsora), a nie czekać na bezczynność.
//   4. PACZKA PRZEKRACZA LIMIT BAZY - ponad 40 pozycji w jednym beaconie baza
//      obetnie po cichu.
//   5. ZABLOKOWANY MAGAZYN WYWRACA STRONĘ - tryb prywatny ma działać.
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  consent: true,
  beacons: [] as unknown[],
  idle: [] as (() => void)[],
}));
vi.mock("@/lib/ads/consent", () => ({
  hasCategoryConsent: (cat: string) => cat === "marketing" && h.consent,
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
  readOrCreateSponsorSession,
  type SponsorTrackerDeps,
} from "@/lib/events/sponsorTracking";
import type { SponsorExposureItem } from "@/lib/events/sponsorExposure";

const S = "11111111-1111-4111-8111-111111111111";
const KEY = "nes-sponsor-session";
const VIEW: SponsorExposureItem = { sponsorId: S, placement: "home_strip", kind: "view" };
const CLICK: SponsorExposureItem = { sponsorId: S, placement: "home_strip", kind: "click" };

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
  const scheduled: (() => void)[] = [];
  const cancelled: number[] = [];
  const state = { consent: true, storage: memoryStorage() as Storage | null };
  const deps: SponsorTrackerDeps = {
    hasConsent: () => state.consent,
    send: (endpoint, payload) => {
      sent.push({ endpoint, payload: payload as Record<string, unknown> });
      return true;
    },
    schedule: (run) => {
      scheduled.push(run);
      const index = scheduled.length;
      return () => cancelled.push(index);
    },
    storage: () => state.storage,
    randomId: () => "a".repeat(32),
    ...patch,
  };
  return { deps, sent, scheduled, cancelled, state };
}

describe("createSponsorTracker", () => {
  it("wyświetlenia czekają na bezczynność i wychodzą JEDNĄ paczką", () => {
    const t = harness();
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
          session: "a".repeat(32),
          items: [
            { placement: "home_strip", kind: "view", sponsor_id: S },
            { placement: "partners_section", kind: "view", sponsor_id: S },
          ],
        },
      },
    ]);
    expect(t.state.storage?.getItem(KEY)).toBe("a".repeat(32));
  });

  it("kliknięcie wychodzi od razu, razem z czekającymi wyświetleniami, i kasuje harmonogram", () => {
    const t = harness();
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(VIEW);
    tracker.track(CLICK);
    expect(t.cancelled).toEqual([1]);
    expect((t.sent[0].payload.items as unknown[]).length).toBe(2);
    tracker.flush();
    expect(t.sent).toHaveLength(1);
  });

  it("bez zgody przy dodaniu - nic nie trafia do kolejki ani do magazynu", () => {
    const t = harness();
    t.state.consent = false;
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(CLICK);
    expect(t.sent).toEqual([]);
    expect(t.scheduled).toEqual([]);
    expect(t.state.storage?.getItem(KEY)).toBeNull();
  });

  it("zgoda cofnięta przed wysyłką - kolejka przepada, identyfikator sesji znika", () => {
    const t = harness();
    t.state.storage = memoryStorage({ [KEY]: "b".repeat(32) });
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track(VIEW);
    t.state.consent = false;
    t.scheduled[0]();
    expect(t.sent).toEqual([]);
    expect(t.state.storage.getItem(KEY)).toBeNull();
  });

  it("pozycja skazana na odrzucenie w ogóle nie wchodzi do kolejki", () => {
    const t = harness();
    const tracker = createSponsorTracker("kongres", t.deps);
    tracker.track({ sponsorId: S, placement: "agenda_track", kind: "click" });
    expect(t.sent).toEqual([]);
    expect(t.scheduled).toEqual([]);
  });

  it("paczki mają najwyżej 40 pozycji", () => {
    const t = harness();
    const tracker = createSponsorTracker("kongres", t.deps);
    for (let i = 0; i < 45; i += 1) tracker.track(VIEW);
    tracker.flush();
    expect(t.sent.map((beacon) => (beacon.payload.items as unknown[]).length)).toEqual([40, 5]);
    expect(t.sent[0].payload.session).toBe(t.sent[1].payload.session);
  });

  it("istniejący identyfikator sesji jest używany ponownie; zły kształt jest wymieniany", () => {
    const ok = harness();
    ok.state.storage = memoryStorage({ [KEY]: "c".repeat(20) });
    const tracker = createSponsorTracker("kongres", ok.deps);
    tracker.track(CLICK);
    expect(ok.sent[0].payload.session).toBe("c".repeat(20));

    const bad = harness();
    bad.state.storage = memoryStorage({ [KEY]: "zly ksztalt!" });
    const tracker2 = createSponsorTracker("kongres", bad.deps);
    tracker2.track(CLICK);
    expect(bad.sent[0].payload.session).toBe("a".repeat(32));
    expect(bad.state.storage.getItem(KEY)).toBe("a".repeat(32));
  });

  it("po dispose() ostatnia kolejka wychodzi, a nowe pozycje są ignorowane", () => {
    const t = harness();
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

  it("dostęp do magazynu rzuca - identyfikator powstaje w pamięci", () => {
    const t = harness({
      storage: () => {
        throw new Error("blocked");
      },
    });
    expect(readOrCreateSponsorSession(t.deps)).toBe("a".repeat(32));
    expect(() => clearSponsorSession(t.deps)).not.toThrow();
  });

  it("odczyt, zapis i usunięcie rzucają - nic nie wybucha", () => {
    const t = harness({ storage: throwing });
    expect(readOrCreateSponsorSession(t.deps)).toBe("a".repeat(32));
    expect(() => clearSponsorSession(t.deps)).not.toThrow();
  });

  it("brak magazynu (null) - identyfikator w pamięci", () => {
    const t = harness();
    t.state.storage = null;
    expect(readOrCreateSponsorSession(t.deps)).toBe("a".repeat(32));
    clearSponsorSession(t.deps);
  });
});

describe("domyślne granice przeglądarki", () => {
  it("zgoda marketingowa, beacon, bezczynność, sessionStorage i identyfikator 32 znaków", () => {
    h.consent = true;
    expect(defaultSponsorTrackerDeps.hasConsent()).toBe(true);
    h.consent = false;
    expect(defaultSponsorTrackerDeps.hasConsent()).toBe(false);
    expect(defaultSponsorTrackerDeps.send("/x", { a: 1 })).toBe(true);
    expect(h.beacons).toEqual([{ endpoint: "/x", payload: { a: 1 } }]);
    const run = vi.fn();
    defaultSponsorTrackerDeps.schedule(run)();
    expect(h.idle).toEqual([run]);
    expect(defaultSponsorTrackerDeps.storage()).toBe(window.sessionStorage);
    expect(defaultSponsorTrackerDeps.randomId()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("tracker bez jawnych zależności", () => {
  it("używa domyślnych granic: klik po zgodzie wychodzi beaconem na endpoint pomiaru", () => {
    h.consent = true;
    h.beacons = [];
    window.sessionStorage.clear();
    const tracker = createSponsorTracker("kongres");
    tracker.track({ sponsorId: S, placement: "partners_tab", kind: "click" });
    expect(h.beacons).toEqual([
      {
        endpoint: "/api/public/sponsor-event",
        payload: {
          event_slug: "kongres",
          session: expect.stringMatching(/^[0-9a-f]{32}$/),
          items: [{ sponsor_id: S, placement: "partners_tab", kind: "click" }],
        },
      },
    ]);
    tracker.dispose();
    window.sessionStorage.clear();
  });
});
