// Atom `AdAttributionCapture` - przechwycenie atrybucji i krok "wizyta".
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. PRACA W RENDERZE - odczyt `location` w renderze rozjezdza HTML z cache
//      brzegowego (ten sam dokument dla `?gclid` i bez) z pierwszym renderem
//      klienta. Atom ma renderowac `null`, a prace robic w efektach.
//   2. ZAPIS PRZED MONTAZEM ZGODY - magazyn dotkniety, zanim zgoda jest znana.
//   3. COFNIECIE ZGODY NIE KASUJE KLUCZA - efekt zapisu nie wraca po zmianie.
//   4. WIZYTA BEZ SWIEZEGO DOTKNIECIA - beacon przed przechwyceniem albo
//      wizyta nie wysylana po pozniejszej zgodzie analytics.
//   5. SSR/HYDRATACJA - zero ostrzezen hydratacji (renderToString + hydrateRoot).
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  consent: { analytics: false, marketing: false },
  decided: false,
  listeners: new Set<() => void>(),
  order: [] as string[],
  capture: vi.fn(),
  persist: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/ads/consent", () => ({
  hasCategoryConsent: (cat: "analytics" | "marketing") => h.consent[cat],
  hasConsentDecision: () => h.decided,
  subscribeConsentChange: (listener: () => void) => {
    h.listeners.add(listener);
    return () => h.listeners.delete(listener);
  },
}));
vi.mock("@/lib/analytics/adAttributionStore", () => ({
  captureAdLanding: (input: unknown) => {
    h.order.push("capture");
    h.capture(input);
  },
  persistAdAttribution: (consent: unknown, nowMs: number) => {
    h.order.push("persist");
    h.persist(consent, nowMs);
  },
}));
vi.mock("@/lib/events/eventFunnelBeacon", () => ({
  sendEventFunnelStep: (step: string, target: unknown) => {
    h.order.push("visit");
    h.send(step, target);
  },
}));

const { AdAttributionCapture } =
  await import("@/components/events/public/atoms/AdAttributionCapture");

/** Zmiana zgody w banerze / innej karcie / GPC - to, co rozglasza consent.ts. */
function consentChanged(analytics: boolean, marketing: boolean): void {
  h.consent = { analytics, marketing };
  h.decided = true;
  act(() => {
    for (const listener of [...h.listeners]) listener();
  });
}

beforeEach(() => {
  h.consent = { analytics: false, marketing: false };
  h.decided = false;
  h.listeners.clear();
  h.order = [];
  h.capture.mockReset();
  h.persist.mockReset();
  h.send.mockReset();
  window.history.replaceState(null, "", "/events/kongres?utm_campaign=Wiosna&gclid=Cj0KCQjw-abc");
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("AdAttributionCapture", () => {
  it("nic nie rysuje; przechwycenie, potem zapis wg zgody, potem wizyta", () => {
    const { container, rerender } = render(<AdAttributionCapture eventSlug="kongres" />);

    expect(container.innerHTML).toBe("");
    expect(h.capture).toHaveBeenCalledTimes(1);
    expect(h.capture).toHaveBeenCalledWith({
      search: "?utm_campaign=Wiosna&gclid=Cj0KCQjw-abc",
      pathname: "/events/kongres",
      referrer: document.referrer,
      host: window.location.hostname,
      nowMs: expect.any(Number),
    });
    expect(h.order).toEqual(["capture", "persist", "visit"]);
    // Przed decyzja: brak zgody to "jeszcze nie wiadomo", nie odmowa.
    expect(h.persist).toHaveBeenCalledWith(
      { analytics: false, marketing: false, decided: false },
      expect.any(Number),
    );
    expect(h.send).toHaveBeenCalledWith("visit", { slug: "kongres" });

    rerender(<AdAttributionCapture eventSlug="kongres" />);
    expect(h.capture).toHaveBeenCalledTimes(1);
  });

  it("zapis wraca przy kazdej zmianie zgody (udzielenie i cofniecie), z aktualnym stanem", () => {
    render(<AdAttributionCapture eventSlug="kongres" />);
    consentChanged(true, true);
    expect(h.persist).toHaveBeenLastCalledWith(
      { analytics: true, marketing: true, decided: true },
      expect.any(Number),
    );
    consentChanged(false, false);
    expect(h.persist).toHaveBeenLastCalledWith(
      { analytics: false, marketing: false, decided: true },
      expect.any(Number),
    );
    expect(h.persist).toHaveBeenCalledTimes(3);
  });

  it("pozniejsza zgoda ponawia wizyte (powtorke odsiewa beacon)", () => {
    render(<AdAttributionCapture eventSlug="kongres" />);
    expect(h.send).toHaveBeenCalledTimes(1);
    consentChanged(true, false);
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it("odmontowanie konczy nasluch zmian zgody", () => {
    const { unmount } = render(<AdAttributionCapture eventSlug="kongres" />);
    expect(h.listeners.size).toBe(2);
    unmount();
    expect(h.listeners.size).toBe(0);
  });

  it("bez sluga wydarzenia tylko przechwytuje i zapisuje - zadnej wizyty", () => {
    render(<AdAttributionCapture />);
    expect(h.capture).toHaveBeenCalledTimes(1);
    consentChanged(true, true);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.listeners.size).toBe(1);
  });

  it("odmontowanie w trakcie prerenderu: aktywacja niczego juz nie wysyla", () => {
    Object.defineProperty(document, "prerendering", { configurable: true, value: true });
    try {
      const { unmount } = render(<AdAttributionCapture eventSlug="kongres" />);
      unmount();
      Object.defineProperty(document, "prerendering", { configurable: true, value: false });
      document.dispatchEvent(new Event("prerenderingchange"));
      expect(h.send).not.toHaveBeenCalled();
    } finally {
      delete (document as { prerendering?: boolean }).prerendering;
    }
  });

  it("prerender spekulacyjny nie strzela wizyta (ani jej ponowieniem) az do aktywacji", () => {
    Object.defineProperty(document, "prerendering", { configurable: true, value: true });
    try {
      const { unmount } = render(<AdAttributionCapture eventSlug="kongres" />);
      consentChanged(true, false);
      expect(h.send).not.toHaveBeenCalled();
      Object.defineProperty(document, "prerendering", { configurable: true, value: false });
      document.dispatchEvent(new Event("prerenderingchange"));
      expect(h.send).toHaveBeenCalledWith("visit", { slug: "kongres" });
      consentChanged(true, true);
      expect(h.send).toHaveBeenCalledTimes(2);
      unmount();
      expect(h.listeners.size).toBe(0);
    } finally {
      delete (document as { prerendering?: boolean }).prerendering;
    }
  });
});

describe("AdAttributionCapture - SSR i hydratacja", () => {
  it("serwer rysuje pustke, klient hydratuje bez ostrzezen i dopiero wtedy przechwytuje", async () => {
    const view = <AdAttributionCapture eventSlug="kongres" />;
    const html = renderToString(view);
    expect(html).toBe("");
    // Na serwerze nie ma efektow - ani przechwycenia, ani beaconu.
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();

    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(host, view, { onRecoverableError: (error) => errors.push(error) });
    });
    try {
      expect(errors).toEqual([]);
      expect(host.innerHTML).toBe("");
      expect(h.capture).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
