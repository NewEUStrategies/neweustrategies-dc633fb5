// Transport partii analityki: beacon dla anonima, keepalive `fetch` z bearerem
// dla zalogowanego (src/lib/analytics/track.ts).
//
// PO CO. Serwer ustala flagę `signed_in` WYŁĄCZNIE z bearera, który sam
// zweryfikował - a `sendBeacon` nagłówków nie umie. Gdyby zalogowana karta
// dalej wysyłała beacon, kafelki „Sesje zalogowanych" stałyby na zerze tak
// samo jak przez całe życie kolumny `user_id`. Ten plik pilnuje czterech rzeczy:
//   * anonim wysyła beaconem, bez nagłówków i bez dotykania `fetch`,
//   * po sesji z `onAuthStateChange` partia idzie keepalive `fetch`em
//     z `Authorization: Bearer`, a ładunek NIE niesie ani identyfikatora konta,
//     ani tokenu, ani flagi (serwer i tak by ją zignorował),
//   * wylogowanie wraca do beaconu,
//   * zepsuty klient auth (`onAuthStateChange` rzuca) nie wywraca `track()`.
//
// Atrapami są transport beaconu, `fetch` i klient Supabase; `track()`, bramka
// zgody i bufor biegną prawdziwe. Stan modułu (`queue`, `accessToken`,
// subskrypcja) przeżywa test, więc każdy test importuje świeży moduł.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AuthCallback = (
  event: string,
  session: { access_token: string; user?: unknown } | null,
) => void;

const h = vi.hoisted(() => ({
  beacons: [] as Array<{ endpoint: string; payload: unknown }>,
  callbacks: [] as AuthCallback[],
  subscribeThrows: false,
}));

vi.mock("@/lib/observability/report", () => ({
  sendBeaconPayload: (endpoint: string, payload: unknown) => {
    h.beacons.push({ endpoint, payload });
    return true;
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: (cb: AuthCallback) => {
        if (h.subscribeThrows) throw new Error("Missing Supabase environment variable(s)");
        h.callbacks.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
    rpc: async () => ({ data: [], error: null }),
    from: () => ({ update: () => ({ eq: async () => ({ data: null, error: null }) }) }),
  },
}));

const USER_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI3YzllIn0.podpis-klienta";

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

type TrackModule = typeof import("@/lib/analytics/track");

async function freshTrack(): Promise<TrackModule> {
  vi.resetModules();
  return import("@/lib/analytics/track");
}

function grantAnalyticsConsent(): void {
  window.localStorage.setItem(
    "consent:v2",
    JSON.stringify({
      version: 2,
      ts: Date.now(),
      categories: { necessary: true, functional: false, analytics: true, marketing: false },
    }),
  );
}

/** Callback ostatniej subskrypcji `onAuthStateChange` - tak klient Supabase podaje sesję. */
function emitAuth(event: string, session: { access_token: string; user?: unknown } | null): void {
  const cb = h.callbacks.at(-1);
  if (!cb) throw new Error("track() nie zasubskrybował onAuthStateChange");
  cb(event, session);
}

beforeEach(() => {
  h.beacons = [];
  h.callbacks = [];
  h.subscribeThrows = false;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  grantAnalyticsConsent();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("track - transport partii a zalogowanie", () => {
  it("ANONIM wysyła beaconem - `fetch` nie jest dotykany", async () => {
    const { flush, trackCta } = await freshTrack();

    trackCta("pricing_signup_click");
    flush(true);

    expect(h.beacons).toHaveLength(1);
    expect(h.beacons[0]!.endpoint).toBe("/api/public/track");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ZALOGOWANY wysyła keepalive `fetch`em z bearerem, bez beaconu", async () => {
    const { flush, trackCta } = await freshTrack();

    trackCta("pricing_signup_click");
    emitAuth("SIGNED_IN", { access_token: TOKEN, user: { id: USER_ID } });
    flush(true);

    expect(h.beacons).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/public/track");
    expect(init).toMatchObject({
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    });
    const body = JSON.parse(String(init?.body)) as { events: Record<string, unknown>[] };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ name: "pricing_signup_click" });
  });

  it("ładunek zalogowanego NIE niesie identyfikatora konta, tokenu ani flagi", async () => {
    // Flagę ustala serwer z nagłówka; identyfikator konta w tabeli zdarzeń to
    // dziennik lektury konkretnej osoby.
    const { flush, track } = await freshTrack();

    track({ type: "page_view", name: "page_view" });
    emitAuth("INITIAL_SESSION", { access_token: TOKEN, user: { id: USER_ID } });
    flush(true);

    const raw = String(fetchMock.mock.calls[0]![1]?.body);
    expect(raw).not.toContain(USER_ID);
    expect(raw).not.toContain(TOKEN);
    const body = JSON.parse(raw) as { events: Record<string, unknown>[] };
    for (const event of body.events) {
      expect(Object.keys(event)).not.toContain("user_id");
      expect(Object.keys(event)).not.toContain("signed_in");
    }
  });

  it("odświeżony token zastępuje stary - bearer zawsze z ostatniej sesji", async () => {
    const { flush, trackCta } = await freshTrack();

    trackCta("a");
    emitAuth("SIGNED_IN", { access_token: "stary-token" });
    emitAuth("TOKEN_REFRESHED", { access_token: TOKEN });
    flush(true);

    const init = fetchMock.mock.calls[0]![1];
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });

  it("WYLOGOWANIE wraca do beaconu", async () => {
    const { flush, trackCta } = await freshTrack();

    trackCta("a");
    emitAuth("SIGNED_IN", { access_token: TOKEN });
    emitAuth("SIGNED_OUT", null);
    flush(true);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.beacons).toHaveLength(1);
  });

  it("BEZ ZGODY nic nie wychodzi - ani beacon, ani fetch, ani subskrypcja auth", async () => {
    window.localStorage.clear();
    const { flush, trackCta } = await freshTrack();

    trackCta("a");
    flush(true);

    expect(h.beacons).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.callbacks).toHaveLength(0);
  });

  it("subskrypcja auth jest JEDNA na moduł, niezależnie od liczby zdarzeń", async () => {
    const { trackCta } = await freshTrack();

    trackCta("a");
    trackCta("b");
    trackCta("c");

    expect(h.callbacks).toHaveLength(1);
  });

  it("RZUCAJĄCE `onAuthStateChange` nie wywraca `track()` - partia idzie beaconem", async () => {
    // Pośrednik `supabase` rzuca przy braku konfiguracji klienta; analityka ma
    // wtedy zostać anonimowa, a nie zniknąć.
    h.subscribeThrows = true;
    const { flush, trackCta } = await freshTrack();

    expect(() => trackCta("a")).not.toThrow();
    flush(true);

    expect(h.beacons).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("`fetch` RZUCAJĄCY synchronicznie - partia idzie beaconem, zdarzenie nie ginie", async () => {
    fetchMock.mockImplementation(() => {
      throw new TypeError("keepalive request too large");
    });
    const { flush, trackCta } = await freshTrack();

    trackCta("a");
    emitAuth("SIGNED_IN", { access_token: TOKEN });
    expect(() => flush(true)).not.toThrow();

    expect(h.beacons).toHaveLength(1);
  });

  it("ODRZUCONA obietnica `fetch` jest połykana - zero nieobsłużonego odrzucenia", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { flush, trackCta } = await freshTrack();

    trackCta("a");
    emitAuth("SIGNED_IN", { access_token: TOKEN });
    flush(true);
    // Daje szansę `.catch` na obsłużenie odrzucenia, zanim test się skończy.
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(h.beacons).toHaveLength(0);
  });
});
