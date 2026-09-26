// Analityka własna bez poświadczeń w adresach (R-URL, S26).
//
// `track()` zapisuje do `analytics_events` ścieżkę bieżącej strony i referrer.
// Na trasie przekazania biletu (`/tickets/transfer/<token>`) ścieżka JEST
// sekretem, a w linku gościa sekret siedzi we fragmencie (`#t=`). Ten plik
// uruchamia PRAWDZIWE `track()` (zgoda na analitykę zapisana w localStorage)
// i sprawdza, co faktycznie wyszło beaconem - transport i klient bazy są
// jedynymi atrapami.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const beacons = vi.hoisted(() => ({
  wyslane: [] as Array<{ endpoint: string; payload: unknown }>,
}));
vi.mock("@/lib/observability/report", () => ({
  sendBeaconPayload: (endpoint: string, payload: unknown) => {
    beacons.wyslane.push({ endpoint, payload });
    return true;
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: async () => ({ data: [], error: null }),
    from: () => ({ update: () => ({ eq: async () => ({ data: null, error: null }) }) }),
  },
}));

import { flush, track } from "@/lib/analytics/track";

interface QueuedEvent {
  path: string;
  referrer: string;
}

function sentEvents(): QueuedEvent[] {
  flush(true);
  return beacons.wyslane.flatMap((b) => (b.payload as { events: QueuedEvent[] }).events);
}

let before = "";

beforeEach(() => {
  beacons.wyslane = [];
  before = `${location.pathname}${location.search}${location.hash}`;
  window.localStorage.setItem(
    "consent:v2",
    JSON.stringify({
      version: 2,
      ts: Date.now(),
      categories: { necessary: true, functional: false, analytics: true, marketing: false },
    }),
  );
});

afterEach(() => {
  history.pushState({}, "", before);
  window.localStorage.clear();
  Reflect.deleteProperty(document, "referrer");
});

describe("track - ścieżka i referrer bez poświadczeń", () => {
  it("token w ścieżce i w parametrach zamaskowany, fragment odcięty", () => {
    history.pushState(
      {},
      "",
      "/tickets/transfer/AbCdEfGhIjKlMnOpQrStUvWxYz012345?t=abc&page=2#t=x",
    );
    track({ type: "interaction", name: "cta_click" });
    const [event] = sentEvents();
    expect(event.path).toBe("/tickets/transfer/[redacted]?t=[redacted]&page=2");
    expect(event.referrer).toBe("");
  });

  it("referrer z poświadczeniem też zamaskowany", () => {
    history.pushState({}, "", "/events/forum");
    Object.defineProperty(document, "referrer", {
      configurable: true,
      get: () => "https://example.org/certificates/ABCD-EFGH-JKMN-PQRS?code=zz#frag",
    });
    track({ type: "interaction", name: "cta_click" });
    const [event] = sentEvents();
    expect(event.path).toBe("/events/forum");
    expect(event.referrer).toBe("https://example.org/certificates/[redacted]?code=[redacted]");
  });

  it("jawna ścieżka wołającego przechodzi bez zmian (odpowiada za nią wołający)", () => {
    track({ type: "interaction", name: "cta_click", path: "/custom" });
    expect(sentEvents()[0].path).toBe("/custom");
  });
});
