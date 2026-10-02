// Pomiar czasu AKTYWNEGO czytania - źródło sygnału dwell rekomendacji.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. Liczba z tego modułu idzie wprost
// do mediany `related_posts_dwell`, a ta przestawia kolejność rekomendacji pod
// każdym artykułem. Błąd w liczeniu nie daje żadnego sygnału - rekomendacje
// po prostu układają się według czegoś innego niż czytanie:
//   1. karta w tle nabija czas (Ctrl+klik = „czytał 30 minut");
//   2. przerwa bez aktywności liczy się w całości (karta zostawiona na noc);
//   3. powrót do karty po przerwie gubi dalsze czytanie (zgłoszenie tylko raz);
//   4. wycofana w trakcie zgoda nie zatrzymuje zgłoszeń;
//   5. nasłuch zostaje po odmontowaniu i liczy czas następnego wpisu.
// Granice (zegar, DOM, zgoda, transport) są wstrzykiwane - test nie potrzebuje
// prawdziwego zegara. Osobny blok sprawdza domyślne granice przeglądarki.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ consent: true }));
vi.mock("@/lib/ads/consent", () => ({ hasAnalyticsConsent: () => h.consent }));

import { DWELL_IDLE_CUTOFF_MS, startPostDwell, type PostDwellDeps } from "@/lib/views/postDwell";
import {
  DWELL_MAX_MS,
  POST_DWELL_ENDPOINT,
  type PostDwellPayload,
} from "@/lib/views/postDwellWire";

const POST = "22222222-2222-4222-8222-222222222222";
const HASH = "0123456789abcdef0123456789abcdef";

interface Harness {
  deps: PostDwellDeps;
  sent: PostDwellPayload[];
  at: (ms: number) => void;
  activity: (type?: string) => void;
  hide: () => void;
  show: () => void;
  pagehide: () => void;
  consent: (v: boolean) => void;
}

function harness(start: "visible" | "hidden" = "visible"): Harness {
  let clock = 0;
  let consent = true;
  const sent: PostDwellPayload[] = [];
  const doc = Object.assign(new EventTarget(), {
    visibilityState: start as DocumentVisibilityState,
  });
  const win = new EventTarget();
  const deps: PostDwellDeps = {
    now: () => clock,
    doc: doc as unknown as PostDwellDeps["doc"],
    win: win as unknown as PostDwellDeps["win"],
    hasConsent: () => consent,
    send: (p) => sent.push(p),
  };
  return {
    deps,
    sent,
    at: (ms) => {
      clock = ms;
    },
    activity: (type = "scroll") => win.dispatchEvent(new Event(type)),
    hide: () => {
      doc.visibilityState = "hidden";
      doc.dispatchEvent(new Event("visibilitychange"));
    },
    show: () => {
      doc.visibilityState = "visible";
      doc.dispatchEvent(new Event("visibilitychange"));
    },
    pagehide: () => win.dispatchEvent(new Event("pagehide")),
    consent: (v) => {
      consent = v;
    },
  };
}

describe("startPostDwell - co liczy się jako czytanie", () => {
  it("aktywność na widocznej karcie sumuje się do chwili `pagehide`", () => {
    const t = harness();
    startPostDwell(POST, HASH, t.deps);
    t.at(10_000);
    t.activity("scroll");
    t.at(20_000);
    t.activity("keydown");
    t.at(25_000);
    t.pagehide();
    expect(t.sent).toEqual([{ postId: POST, viewerHash: HASH, dwellMs: 25_000 }]);
  });

  it("przerwa bez aktywności liczy się NAJWYŻEJ do progu bezczynności", () => {
    const t = harness();
    startPostDwell(POST, HASH, t.deps);
    t.at(10 * 60_000);
    t.activity("pointermove");
    t.pagehide();
    expect(t.sent[0]?.dwellMs).toBe(DWELL_IDLE_CUTOFF_MS);
  });

  it("karta otwarta W TLE nie nabija czasu, dopóki nie stanie się widoczna", () => {
    const t = harness("hidden");
    startPostDwell(POST, HASH, t.deps);
    t.at(50_000);
    t.activity("scroll"); // zdarzenie na schowanej karcie - ignorowane
    t.show();
    t.at(60_000);
    t.activity("wheel");
    t.at(62_000);
    t.pagehide();
    expect(t.sent[0]?.dwellMs).toBe(12_000);
  });

  it("schowanie karty wysyła sumę, a powrót do niej liczy DALEJ - kolejne zgłoszenie jest większe", () => {
    const t = harness();
    startPostDwell(POST, HASH, t.deps);
    t.at(20_000);
    t.hide();
    t.at(500_000); // czas w innej karcie się nie liczy
    t.show();
    t.at(515_000);
    t.activity("touchstart");
    t.at(520_000);
    t.hide();
    expect(t.sent.map((p) => p.dwellMs)).toEqual([20_000, 40_000]);
  });

  it("zgłoszenie nie powtarza się, gdy suma nie urosła", () => {
    const t = harness();
    startPostDwell(POST, HASH, t.deps);
    t.at(5_000);
    t.hide();
    t.pagehide(); // ta sama suma - bez drugiego beaconu
    expect(t.sent).toHaveLength(1);
  });

  it("czytanie krótsze niż sekunda nie jest zgłaszane", () => {
    const t = harness();
    const stop = startPostDwell(POST, HASH, t.deps);
    t.at(900);
    stop();
    expect(t.sent).toHaveLength(0);
  });

  it("zgłoszenie jest przycięte do 30 minut", () => {
    const t = harness();
    startPostDwell(POST, HASH, t.deps);
    for (let s = 20; s <= 3 * 3600; s += 20) {
      t.at(s * 1000);
      t.activity();
    }
    t.pagehide();
    expect(t.sent.at(-1)?.dwellMs).toBe(DWELL_MAX_MS);
  });

  it("zegar cofnięty wstecz nie odejmuje czasu", () => {
    const t = harness();
    startPostDwell(POST, HASH, t.deps);
    t.at(5_000);
    t.activity();
    t.at(3_000); // np. atrapa zegara albo zmiana źródła czasu
    t.activity();
    t.at(4_000);
    t.pagehide();
    expect(t.sent[0]?.dwellMs).toBe(6_000);
  });
});

describe("startPostDwell - zgoda i cykl życia", () => {
  it("zgoda wycofana W TRAKCIE czytania zatrzymuje zgłoszenia od razu", () => {
    const t = harness();
    startPostDwell(POST, HASH, t.deps);
    t.at(10_000);
    t.consent(false);
    t.pagehide();
    expect(t.sent).toHaveLength(0);
  });

  it("zatrzymanie domyka odcinek, wysyła sumę i odpina nasłuch", () => {
    const t = harness();
    const stop = startPostDwell(POST, HASH, t.deps);
    t.at(8_000);
    stop();
    expect(t.sent).toEqual([{ postId: POST, viewerHash: HASH, dwellMs: 8_000 }]);

    // Po zatrzymaniu nic już nie liczy ani nie wysyła - także drugi `stop`.
    t.at(20_000);
    t.activity();
    t.hide();
    t.show();
    t.pagehide();
    stop();
    expect(t.sent).toHaveLength(1);
  });
});

describe("startPostDwell - domyślne granice przeglądarki", () => {
  const originalSendBeacon = navigator.sendBeacon;
  const originalFetch = globalThis.fetch;

  function setSendBeacon(value: unknown): void {
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, writable: true, value });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    h.consent = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    setSendBeacon(originalSendBeacon);
    globalThis.fetch = originalFetch;
  });

  it("wysyła `sendBeacon`em JSON na kanoniczny adres", async () => {
    const beacon = vi.fn((_url: string, _body?: BodyInit | null) => true);
    setSendBeacon(beacon);
    const stop = startPostDwell(POST, HASH);
    vi.advanceTimersByTime(4_000);
    stop();

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0]?.[0]).toBe(POST_DWELL_ENDPOINT);
    const body = beacon.mock.calls[0]?.[1] as Blob;
    expect(JSON.parse(await body.text())).toEqual({
      postId: POST,
      viewerHash: HASH,
      dwellMs: 4_000,
    });
  });

  it("bez `sendBeacon` (albo przy pełnej kolejce) leci keepalive fetch, a jego błąd jest cichy", async () => {
    setSendBeacon(() => false);
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const stop = startPostDwell(POST, HASH);
    vi.advanceTimersByTime(3_000);
    stop();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(POST_DWELL_ENDPOINT);
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body))).toMatchObject({ dwellMs: 3_000 });
  });

  it("bez zgody analitycznej domyślna granica nie wysyła nic", () => {
    h.consent = false;
    const beacon = vi.fn(() => true);
    setSendBeacon(beacon);
    const stop = startPostDwell(POST, HASH);
    vi.advanceTimersByTime(4_000);
    stop();
    expect(beacon).not.toHaveBeenCalled();
  });
});
