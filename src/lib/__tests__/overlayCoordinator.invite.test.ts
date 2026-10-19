// P17 (S3): odmowa zgody marketingowej (cookies) nie wygasza ZAPROSZENIA DO
// KONTA. Popup rejestracji (`newsletter-popup`, nazwa historyczna) jest
// zaproszeniem - czeka na zgłoszenie stanu banera i liczy się do budżetu
// przerw, ale odmowa marketingu go nie tłumi. Inne nakładki marketingowe -
// jak dotąd - są tłumione.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetOverlayCoordinator,
  cancelOverlayRequest,
  requestOverlaySlot,
  setMarketingConsent,
} from "@/lib/overlayCoordinator";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T10:00:00Z"));
  window.localStorage.clear();
  __resetOverlayCoordinator();
});
afterEach(() => {
  __resetOverlayCoordinator();
  vi.useRealTimers();
});

describe("overlayCoordinator - zaproszenie do konta (P17)", () => {
  it("popup rejestracji wchodzi mimo odmowy zgody marketingowej", async () => {
    setMarketingConsent(false);
    const granted = vi.fn();
    void requestOverlaySlot("newsletter-popup", { marketing: true, priority: 0 }).then(granted);
    await vi.runOnlyPendingTimersAsync();
    expect(granted).toHaveBeenCalledTimes(1);
  });

  it("jawna flaga `invite` działa dla dowolnego slotu", async () => {
    setMarketingConsent(false);
    const granted = vi.fn();
    void requestOverlaySlot("club-invite", { marketing: true, invite: true }).then(granted);
    await vi.runOnlyPendingTimersAsync();
    expect(granted).toHaveBeenCalledTimes(1);
  });

  it("inna nakładka marketingowa nadal jest tłumiona odmową", async () => {
    setMarketingConsent(false);
    const granted = vi.fn();
    void requestOverlaySlot("builder-popup", { marketing: true }).then(granted);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(granted).not.toHaveBeenCalled();
    cancelOverlayRequest("builder-popup");
  });

  it("zaproszenie czeka, aż baner zgód zgłosi stan", async () => {
    const granted = vi.fn();
    void requestOverlaySlot("newsletter-popup", { marketing: true }).then(granted);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(granted).not.toHaveBeenCalled();
    setMarketingConsent(false);
    await vi.runOnlyPendingTimersAsync();
    expect(granted).toHaveBeenCalledTimes(1);
  });

  it("zaproszenie liczy się do budżetu przerw (limit dzienny)", async () => {
    window.localStorage.setItem(
      "overlay:budget:v1",
      JSON.stringify({ day: "2026-10-19", count: 3, lastTs: 0 }),
    );
    setMarketingConsent(false);
    const granted = vi.fn();
    void requestOverlaySlot("newsletter-popup", { marketing: true }).then(granted);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(granted).not.toHaveBeenCalled();
    cancelOverlayRequest("newsletter-popup");
  });
});
