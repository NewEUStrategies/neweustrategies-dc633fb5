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

import { flush, track, trackCta, trackSearch } from "@/lib/analytics/track";
import { ga4SsrSnippet, resetGa4BootstrapForTests } from "@/lib/analytics/ga4Client";

interface QueuedEvent {
  path: string;
  referrer: string;
  entity_id: string | null;
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

// Kopia do GA4 wychodzi z `track()` ZANIM zadziała bramka zgody: Consent Mode
// advanced, ping bez cookies niesie parametry zdarzenia. Tu jedzie PRAWDZIWY
// snippet SSR (warstwa `dataLayer` + `gtag`), a sprawdzamy, co do niej trafiło.
describe("track - kopia do GA4 bez PII (wychodzi przed bramką zgody)", () => {
  interface Layered {
    dataLayer?: ArrayLike<unknown>[];
  }

  /** Parametry ostatniego zdarzenia GA4 o danej nazwie (wpisy to obiekty `arguments`). */
  function ga4Zdarzenie(nazwa: string): Record<string, unknown> | undefined {
    const wpisy = (window as Layered).dataLayer ?? [];
    const wpis = [...wpisy].reverse().find((w) => w[0] === "event" && w[1] === nazwa);
    return wpis?.[2] as Record<string, unknown> | undefined;
  }

  beforeEach(() => {
    // Kolejka `track()` żyje w module: zdarzenie poprzedniego testu bez flusha
    // wyjechałoby w tym - a test „bez zgody" liczy beacony co do sztuki.
    flush(true);
    beacons.wyslane = [];
    resetGa4BootstrapForTests();
    (window as Layered).dataLayer = [];
    new Function(ga4SsrSnippet("G-TEST123"))();
  });

  afterEach(() => {
    resetGa4BootstrapForTests();
    (window as Layered).dataLayer = [];
  });

  it("fraza-e-mail: GA4 i beacon własny dostają znacznik", () => {
    trackSearch("Jan.Kowalski@Example.com");
    const ga4 = ga4Zdarzenie("search");
    expect(ga4?.search_term).toBe("[redacted-email]");
    expect(ga4?.item_id).toBe("[redacted-email]");
    expect(sentEvents()[0].entity_id).toBe("[redacted-email]");
  });

  it("fraza-telefon: numer zamaskowany w GA4", () => {
    trackSearch("+48 600 123 456");
    expect(ga4Zdarzenie("search")?.search_term).toBe("[redacted-phone]");
  });

  it("BEZ zgody kopia GA4 wychodzi (Consent Mode advanced), ale już zredagowana, a beacon własny nie wychodzi", () => {
    window.localStorage.removeItem("consent:v2");
    trackSearch("jan@example.com");
    expect(ga4Zdarzenie("search")?.search_term).toBe("[redacted-email]");
    const warstwa = JSON.stringify(
      Array.from((window as Layered).dataLayer ?? [], (w) => Array.from(w)),
    );
    expect(warstwa).not.toContain("jan@example.com");
    expect(sentEvents()).toHaveLength(0);
  });

  it("e-mail na granicy 120 znaków nie przecieka połówką", () => {
    // Przed naprawą `slice(0, 120)` przed redakcją dawało `…jan.kowalski@example`
    // - bez domeny najwyższego poziomu, czyli poza zasięgiem wzorca e-maila.
    trackSearch(`${"x ".repeat(50)}jan.kowalski@example.com`);
    const entityId = sentEvents()[0].entity_id ?? "";
    expect(entityId.endsWith("[redacted-email]")).toBe(true);
    expect(entityId).not.toContain("jan.kowalski");
    const searchTerm = String(ga4Zdarzenie("search")?.search_term);
    expect(searchTerm.length).toBeLessThanOrEqual(100);
    expect(searchTerm).not.toContain("jan.kowal");
  });

  it("page_path z /search?q=<e-mail> zredagowany w GA4", () => {
    history.pushState({}, "", "/search?q=jan%40example.com&tab=all");
    trackCta("pricing_signup_click");
    expect(ga4Zdarzenie("sign_up_intent")?.page_path).toBe("/search?q=[redacted-email]&tab=all");
  });
});
