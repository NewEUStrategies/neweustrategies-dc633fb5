// Wstawki „co N kart" w listach wpisów: `src/components/ads/useInFeedAds.tsx`.
//
// PO CO TEN PLIK. Hak obsługuje WSZYSTKIE listy wpisów naraz (blog, strona
// główna, archiwa taksonomii, wyszukiwarka), a jego jedyną logiką jest rytm:
// po której karcie stanie reklama. Błąd o jeden w tym rachunku jest
// niewidoczny w kodzie, a na stronie oznacza reklamę jako PIERWSZĄ kartę listy
// albo ścianę reklam przy `every: 0`.
//
// Bramkę zgody dla tej ścieżki dowodzi `consentGate.test.tsx`. Tutaj
// `AdSlotView` jest znacznikiem, a `useAdPlacements` granicą danych - dowód
// dotyczy wyłącznie rytmu wstawek i ich kolejności względem kart.
import { Fragment } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AdPageType, AdPlacementWithSlot, AdSlot } from "@/lib/ads/types";

const q = vi.hoisted(() => ({
  data: undefined as AdPlacementWithSlot[] | undefined,
  useAdPlacements: vi.fn(),
}));

vi.mock("@/lib/ads/queries", () => ({
  useAdPlacements: (...args: unknown[]) => {
    q.useAdPlacements(...args);
    return { data: q.data };
  },
}));
vi.mock("@/components/AdSlot", () => ({
  AdSlotView: ({ placement }: { placement: AdPlacementWithSlot }) => (
    <li data-testid="reklama" data-placement={placement.id} />
  ),
}));

import { useInFeedAds } from "@/components/ads/useInFeedAds";

function slot(): AdSlot {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    tenant_id: "aaaaaaaa-0000-0000-0000-00000000000a",
    name: "Kreacja w liście",
    kind: "image",
    status: "active",
    html: null,
    script: null,
    image_url: "https://cdn.example.com/feed.png",
    image_link: null,
    image_alt: "Kreacja w liście",
    width: 300,
    height: 250,
    requires_consent: false,
    targeting: {},
    notes: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
}

function placement(id: string, config: Record<string, unknown>): AdPlacementWithSlot {
  return {
    id,
    tenant_id: "aaaaaaaa-0000-0000-0000-00000000000a",
    slot_id: slot().id,
    position: "in_feed",
    page_type: "all",
    page_id: null,
    config,
    sort_order: 0,
    active: true,
    starts_at: null,
    ends_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    slot: slot(),
  };
}

/** Lista N kart z wstawkami - dokładnie tak, jak woła hak każda lista wpisów. */
function Feed({
  cards,
  pageType = "archive",
  pageId,
}: {
  cards: number;
  pageType?: AdPageType;
  pageId?: string | null;
}) {
  const renderAds = useInFeedAds(pageType, pageId);
  return (
    <ol data-testid="lista">
      {Array.from({ length: cards }, (_, i) => (
        <Fragment key={i}>
          <li>{`karta ${i + 1}`}</li>
          {renderAds(i)}
        </Fragment>
      ))}
    </ol>
  );
}

/** Kolejność elementów listy: `karta N` albo `reklama:<id placementu>`. */
function sequence(): string[] {
  return Array.from(screen.getByTestId("lista").children).map((el) =>
    el.getAttribute("data-testid") === "reklama"
      ? `reklama:${el.getAttribute("data-placement")}`
      : (el.textContent ?? ""),
  );
}

/** Numery kart, PO których stanęła wstawka danego placementu. */
function adsAfterCards(id: string): number[] {
  const out: number[] = [];
  sequence().forEach((entry, i, all) => {
    if (entry === `reklama:${id}`) {
      const card = all
        .slice(0, i)
        .reverse()
        .find((e) => e.startsWith("karta "));
      out.push(Number(card?.slice("karta ".length)));
    }
  });
  return out;
}

beforeEach(() => {
  q.data = undefined;
  q.useAdPlacements.mockReset();
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
describe("useInFeedAds - rytm wstawek", () => {
  it("dopóki placementy się nie wczytały, lista nie dostaje żadnej wstawki", () => {
    q.data = undefined;

    render(<Feed cards={10} />);

    expect(screen.queryAllByTestId("reklama")).toHaveLength(0);
    expect(sequence()).toHaveLength(10);
  });

  it("bez konfiguracji wstawka staje co piątą kartę - nigdy jako pierwsza", () => {
    q.data = [placement("p-domyslny", {})];

    render(<Feed cards={12} />);

    expect(adsAfterCards("p-domyslny")).toEqual([5, 10]);
    expect(sequence()[0]).toBe("karta 1");
  });

  it("`every` z konfiguracji wyznacza rytm", () => {
    q.data = [placement("p-co-3", { every: 3 })];

    render(<Feed cards={10} />);

    expect(adsAfterCards("p-co-3")).toEqual([3, 6, 9]);
  });

  it("`every` jako napis z liczbą (jsonb) też działa", () => {
    q.data = [placement("p-napis", { every: "4" })];

    render(<Feed cards={9} />);

    expect(adsAfterCards("p-napis")).toEqual([4, 8]);
  });

  it("`every` zerowe lub ujemne ma klamrę na 1 - po każdej karcie, bez dzielenia przez zero", () => {
    q.data = [placement("p-zero", { every: 0 }), placement("p-ujemny", { every: -3 })];

    render(<Feed cards={3} />);

    expect(adsAfterCards("p-zero")).toEqual([1, 2, 3]);
    expect(adsAfterCards("p-ujemny")).toEqual([1, 2, 3]);
  });

  it("`every: null` traktuje jak brak konfiguracji (co piątą kartę)", () => {
    q.data = [placement("p-null", { every: null })];

    render(<Feed cards={10} />);

    expect(adsAfterCards("p-null")).toEqual([5, 10]);
  });

  it("dwie kampanie o różnym rytmie spotykają się na wspólnej wielokrotności, w kolejności z bazy", () => {
    q.data = [placement("p-co-2", { every: 2 }), placement("p-co-3", { every: 3 })];

    render(<Feed cards={6} />);

    expect(sequence()).toEqual([
      "karta 1",
      "karta 2",
      "reklama:p-co-2",
      "karta 3",
      "reklama:p-co-3",
      "karta 4",
      "reklama:p-co-2",
      "karta 5",
      "karta 6",
      "reklama:p-co-2",
      "reklama:p-co-3",
    ]);
  });

  it("karta bez wstawki dostaje `null`, nie pusty fragment", () => {
    q.data = [placement("p-co-2", { every: 2 })];
    let renderer: ((i: number) => unknown) | null = null;
    function Probe() {
      renderer = useInFeedAds("home");
      return null;
    }

    render(<Probe />);

    // `null` pozwala liście nie dokładać pustych komórek siatki.
    expect(renderer!(0)).toBeNull();
    expect(renderer!(1)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("useInFeedAds - zapytanie o placementy", () => {
  it("pyta o pozycję `in_feed` dla typu i identyfikatora strony", () => {
    render(<Feed cards={1} pageType="category" pageId="kategoria-1" />);

    expect(q.useAdPlacements).toHaveBeenCalledWith("in_feed", "category", "kategoria-1");
  });

  it("bez identyfikatora strony pyta tylko po typie", () => {
    render(<Feed cards={1} pageType="search" />);

    expect(q.useAdPlacements).toHaveBeenCalledWith("in_feed", "search", undefined);
  });
});
