import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import type { AdPlacementWithSlot, AdSlot } from "@/lib/ads/types";

// --- Mocks --------------------------------------------------------------

let mockGranted = true;
vi.mock("@/lib/ads/consent", () => ({
  useMarketingConsent: () => ({
    granted: mockGranted,
    decided: true,
    grant: () => {},
    deny: () => {},
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl" },
  }),
}));

import { AdSlotView } from "@/components/AdSlot";

// Controllable IntersectionObserver: drives the viewport gate deterministically.
let ioShouldIntersect = true;
class MockIntersectionObserver {
  private readonly cb: IntersectionObserverCallback;
  root: Element | null = null;
  rootMargin = "";
  thresholds: ReadonlyArray<number> = [];
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element): void {
    if (!ioShouldIntersect) return;
    this.cb(
      [{ isIntersecting: true, target } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

type MutableGlobal = Record<string, unknown>;

// --- Fixtures -----------------------------------------------------------

function makeSlot(overrides: Partial<AdSlot> = {}): AdSlot {
  return {
    id: "slot-1",
    tenant_id: "t1",
    name: "Test slot",
    kind: "image",
    status: "active",
    html: null,
    script: null,
    image_url: "https://example.com/ad.png",
    image_link: "https://example.com",
    image_alt: "Ad",
    width: 300,
    height: 250,
    requires_consent: false,
    targeting: {},
    notes: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

function makePlacement(slot: AdSlot): AdPlacementWithSlot {
  return {
    id: "p1",
    tenant_id: "t1",
    slot_id: slot.id,
    position: "top_of_post",
    page_type: "post",
    page_id: null,
    config: {},
    sort_order: 0,
    active: true,
    starts_at: null,
    ends_at: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    slot,
  };
}

const box = () => document.querySelector<HTMLElement>("[data-ad-slot='slot-1']");

// --- Tests --------------------------------------------------------------

describe("AdSlotView - Core Web Vitals", () => {
  beforeEach(() => {
    mockGranted = true;
    ioShouldIntersect = true;
    (globalThis as MutableGlobal).requestIdleCallback = (
      cb: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
    ) => {
      cb({ didTimeout: false, timeRemaining: () => 50 });
      return 1;
    };
    (globalThis as MutableGlobal).cancelIdleCallback = () => {};
    (globalThis as MutableGlobal).IntersectionObserver = MockIntersectionObserver;
  });

  afterEach(() => {
    cleanup();
    delete (globalThis as MutableGlobal).requestIdleCallback;
    delete (globalThis as MutableGlobal).cancelIdleCallback;
  });

  it("reserves the slot box from first paint and defers the payload (zero CLS, LCP-safe)", () => {
    ioShouldIntersect = false; // keep the viewport gate closed
    const { container } = render(<AdSlotView placement={makePlacement(makeSlot())} />);

    const el = box();
    expect(el).toBeTruthy();
    expect(el?.getAttribute("data-ad-state")).toBe("loading");
    // Space is reserved proportionally so nothing shifts when the ad arrives.
    expect(el?.style.aspectRatio).toBe("300 / 250");
    // No creative in the DOM during the critical paint window.
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders an image creative once both gates open, lazily and async-decoded", async () => {
    render(<AdSlotView placement={makePlacement(makeSlot())} />);

    const img = await waitFor(() => screen.getByRole("img"));
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("src")).toBe("https://example.com/ad.png");
    expect(box()?.getAttribute("data-ad-state")).toBe("ready");
  });

  it("shows a localized, space-reserving placeholder when marketing consent is missing", () => {
    mockGranted = false;
    const { container } = render(
      <AdSlotView placement={makePlacement(makeSlot({ requires_consent: true }))} />,
    );

    const el = box();
    expect(el?.getAttribute("data-ad-state")).toBe("blocked");
    // The blocked placeholder still holds the slot's space to avoid a later shift.
    expect(el?.style.aspectRatio).toBe("300 / 250");
    expect(el?.textContent).toContain("wymaga zgody marketingowej");
    expect(container.querySelector("img")).toBeNull();
  });

  it("injects a third-party script only after the gates open", async () => {
    const slot = makeSlot({
      kind: "script",
      image_url: null,
      image_link: null,
      script: "<script>window.__adRan = true;</script>",
      width: 728,
      height: 90,
    });
    const { container } = render(<AdSlotView placement={makePlacement(slot)} />);

    await waitFor(() => expect(box()?.getAttribute("data-ad-state")).toBe("ready"));
    await waitFor(() => expect(container.querySelector("script")).toBeTruthy());
  });
});
