// Bramka zgody na WSZYSTKICH sciezkach renderowania reklamy.
//
// PO CO. `AdSlot.tsx:38` liczy `blocked = slot.requires_consent && !granted` i
// jest to JEDYNE miejsce, w ktorym zgoda marketingowa zatrzymuje kreacje.
// `useInFeedAds` i `AdSlotById` renderuja przez `AdSlotView`, wiec bramke
// DZIEDZICZA - i wlasnie dlatego kazdy z nich potrzebuje wlasnego, jawnego
// testu: dziedziczenie jest niewidoczne w diffie. Gdyby ktos przepial ktoras z
// tych sciezek na wlasny render (albo na `AdContainer` wprost), bramka
// zniknelaby BEZ ZADNEGO SYGNALU - kreacja sledzaca poszlaby do czytelnika,
// ktory zgody nie dal.
//
// ATRAPUJEMY GRANICE: zapytania o placementy/slot (warstwa danych na granicy
// sieci), beacon analityczny i i18n. Sama bramka zgody biegnie PRAWDZIWA -
// przez `useMarketingConsent` i prawdziwy localStorage.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const beacons = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@/lib/analytics/events", () => ({
  beaconAdEvent: (...args: unknown[]) => {
    beacons.calls.push(args);
  },
}));

const q = vi.hoisted(() => ({ placements: [] as unknown[], slot: null as unknown }));
vi.mock("@/lib/ads/queries", () => ({
  useAdPlacements: () => ({ data: q.placements }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    // Granica sesji - bramka zgody subskrybuje zmiany auth, zeby dociagnac
    // decyzje z profilu po zalogowaniu.
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: async () => ({ data: [], error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: q.slot, error: null }) }),
        }),
      }),
    }),
  },
}));

// Bramki odroczonego ladowania (idle + bliskosc viewportu) nie sa przedmiotem
// tego dowodu - otwieramy je, zeby test mowil WYLACZNIE o zgodzie.
vi.mock("@/lib/ads/useDeferredAd", () => ({
  useDeferredAd: ({ disabled }: { disabled?: boolean }) => ({
    containerRef: { current: null },
    shouldRender: !disabled,
  }),
}));

import { AdSlotById } from "@/components/ads/AdSlotById";
import { useInFeedAds } from "@/components/ads/useInFeedAds";
import type { AdPlacementWithSlot, AdSlot } from "@/lib/ads/types";

const STORAGE_KEY = "consent:v2";

function slot(over: Partial<AdSlot> = {}): AdSlot {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    tenant_id: "aaaaaaaa-0000-0000-0000-00000000000a",
    name: "Kreacja testowa",
    kind: "image",
    status: "active",
    requires_consent: true,
    html: null,
    script: null,
    image_url: "https://cdn.example.com/kreacja.png",
    image_link: null,
    image_alt: "Kreacja testowa",
    width: 300,
    height: 250,
    notes: null,
    targeting: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...over,
  } as AdSlot;
}

function placement(over: Partial<AdPlacementWithSlot> = {}): AdPlacementWithSlot {
  return {
    id: "66666666-7777-8888-9999-000000000000",
    tenant_id: "aaaaaaaa-0000-0000-0000-00000000000a",
    slot_id: slot().id,
    position: "in_feed",
    page_type: "all",
    page_id: null,
    config: { every: 1 },
    sort_order: 0,
    active: true,
    starts_at: null,
    ends_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    slot: slot(),
    ...over,
  } as AdPlacementWithSlot;
}

function grantMarketing(granted: boolean) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 2,
      ts: Date.now(),
      categories: { necessary: true, functional: true, analytics: granted, marketing: granted },
    }),
  );
}

/** Komponent-nosnik: hook `useInFeedAds` zwraca renderer, nie element. */
function InFeed() {
  const render = useInFeedAds("all");
  return <div data-testid="feed">{render(0)}</div>;
}

beforeEach(() => {
  window.localStorage.clear();
  beacons.calls = [];
  q.placements = [placement()];
  q.slot = slot();
});

// ---------------------------------------------------------------------------
describe("useInFeedAds - bramka zgody", () => {
  it("BEZ zgody marketingowej nie renderuje kreacji", () => {
    grantMarketing(false);

    renderWithQueryClient(<InFeed />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(document.querySelector('[data-ad-state="blocked"]')).not.toBeNull();
  });

  it("BEZ zgody nie wysyla beaconu impresji - zablokowany slot nie jest liczony", () => {
    grantMarketing(false);

    renderWithQueryClient(<InFeed />);

    expect(beacons.calls).toEqual([]);
  });

  it("ZE zgoda renderuje kreacje", async () => {
    grantMarketing(true);

    renderWithQueryClient(<InFeed />);

    expect(await screen.findByRole("img")).toHaveAttribute(
      "src",
      "https://cdn.example.com/kreacja.png",
    );
  });

  it("slot, ktory zgody NIE wymaga, renderuje sie takze bez zgody", async () => {
    grantMarketing(false);
    q.placements = [placement({ slot: slot({ requires_consent: false }) })];

    renderWithQueryClient(<InFeed />);

    expect(await screen.findByRole("img")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("AdSlotById - bramka zgody", () => {
  it("BEZ zgody marketingowej nie renderuje kreacji", async () => {
    grantMarketing(false);

    renderWithQueryClient(<AdSlotById slotId={slot().id} />);

    await screen.findByText(/./, { selector: '[data-ad-state="blocked"]' });
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("BEZ zgody nie wysyla beaconu impresji", async () => {
    grantMarketing(false);

    renderWithQueryClient(<AdSlotById slotId={slot().id} />);

    await screen.findByText(/./, { selector: '[data-ad-state="blocked"]' });
    expect(beacons.calls).toEqual([]);
  });

  it("ZE zgoda renderuje kreacje", async () => {
    grantMarketing(true);

    renderWithQueryClient(<AdSlotById slotId={slot().id} />);

    expect(await screen.findByRole("img")).toHaveAttribute(
      "src",
      "https://cdn.example.com/kreacja.png",
    );
  });

  it("brak slotu w bazie nie renderuje niczego", () => {
    grantMarketing(true);
    q.slot = null;

    const { container } = renderWithQueryClient(<AdSlotById slotId={slot().id} />);

    expect(container.querySelector("[data-ad-slot]")).toBeNull();
  });
});
