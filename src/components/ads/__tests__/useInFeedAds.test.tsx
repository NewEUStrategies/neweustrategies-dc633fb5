// Wstawki reklamowe "co N kart" w listach wpisów (blog, strona główna,
// archiwa taksonomii, wyniki wyszukiwania). Ta jedna funkcja decyduje, ile
// reklam mija czytelnik, przewijając listę - i jest jedynym miejscem, w którym
// konfiguracja `config.every` w ogóle coś znaczy.
//
// CO TEN PLIK DOWODZI.
//   1. RYTM 'CO 5 KART' TRAFIA KARTY 4, 9, 14 (indeksy 0-based), bo warunek
//      liczy `(cardIndex + 1) % every`. Przesunięcie o jeden przechodzi przez
//      `tsc` i przez recenzję, a przesuwa KAŻDĄ reklamę w serwisie.
//   2. `every: 0` ZNACZY 'PRZY KAŻDEJ KARCIE', NIE 'NIGDY'. `Math.max(1, 0)`
//      zamienia redakcyjne "wyłącz tę kampanię" w reklamę pod każdą kartą.
//      To jest najdroższy możliwy błąd interpretacji zera w tym module.
//   3. `every` NIELICZBOWY WYCISZA KAMPANIĘ NA ZAWSZE. `x % NaN` nigdy nie
//      jest zerem, więc placement nie pokazuje się ani razu - a brak reklamy
//      wygląda dokładnie jak brak kampanii, więc nikt tego nie zgłosi.
//   4. RENDERER ZWRACA DOKŁADNIE `null`, gdy nie ma trafień. To nie jest
//      kosmetyka: `ArchivePostList` renderuje `{after && <div
//      className="col-span-full ...">}`, więc pusty (ale prawdziwy) fragment
//      wstawiłby pusty wiersz siatki pod KAŻDĄ kartą listy.
//   5. DWA PLACEMENTY TRAFIAJĄCE TĘ SAMĄ KARTĘ RENDERUJĄ SIĘ OBA - in-feed
//      nie ma sufitu takiego jak `MAX_MID_POST_ADS` w mid-post. Dwie kampanie
//      "co 2" i "co 3" dają pod szóstą kartą dwie reklamy jedna nad drugą.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Tabelka przypadków `placementsAfterCard` (typy
// wartości, ułamki, wartości ujemne) stoi w `src/lib/ads/__tests__/injection.test.ts`.
// Tutaj przedmiotem dowodu jest WPIĘCIE tej decyzji w hook: co dostaje lista.
//
// ATRAPY I DLACZEGO.
//   * `@/components/AdSlot` - znacznik z `data-placement-id`. Prawdziwy
//     `AdSlotView` ma własny plik testowy i wymaga bramek zgody oraz
//     IntersectionObserver; tutaj liczy się KTÓRE placementy trafiają do
//     renderera i ile ich jest.
//   * `@/lib/ads/queries` - `useAdPlacements` ma własne 100% pokrycia;
//     atrapa jest jedynym sposobem podania konkretnych `config.every`.
//     Sama decyzja "czy przy tej karcie leci reklama" NIE jest zamockowana.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AdPlacementWithSlot, AdSlot } from "@/lib/ads/types";

// --- Atrapy -------------------------------------------------------------

let placements: AdPlacementWithSlot[] | undefined = [];
const wywolaniaZapytania: unknown[][] = [];

vi.mock("@/lib/ads/queries", () => ({
  useAdPlacements: (...args: unknown[]) => {
    wywolaniaZapytania.push(args);
    return { data: placements };
  },
}));

vi.mock("@/components/AdSlot", () => ({
  AdSlotView: ({ placement }: { placement: AdPlacementWithSlot }) => (
    <div data-testid="reklama" data-placement-id={placement.id} data-slot-id={placement.slot.id} />
  ),
}));

import { useInFeedAds, type InFeedRenderer } from "@/components/ads/useInFeedAds";

// --- Fixtures -----------------------------------------------------------

function slot(id: string): AdSlot {
  return {
    id,
    tenant_id: "t1",
    name: `Kreacja ${id}`,
    kind: "image",
    status: "active",
    html: null,
    script: null,
    image_url: "https://example.com/baner.png",
    image_link: "https://example.com",
    image_alt: "baner",
    width: 300,
    height: 250,
    requires_consent: false,
    targeting: {},
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function placement(id: string, config: Record<string, unknown> = {}): AdPlacementWithSlot {
  return {
    id,
    tenant_id: "t1",
    slot_id: `s-${id}`,
    position: "in_feed",
    page_type: "archive",
    page_id: null,
    config,
    sort_order: 0,
    active: true,
    starts_at: null,
    ends_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    slot: slot(`s-${id}`),
  };
}

function renderer(): InFeedRenderer {
  return renderHook(() => useInFeedAds("archive", "taksonomia-1")).result.current;
}

/** Identyfikatory kreacji wyrenderowanych PO karcie o danym indeksie. */
function reklamyPoKarcie(render_: InFeedRenderer, cardIndex: number): string[] {
  const node: ReactNode = render_(cardIndex);
  if (node === null) return [];
  const { container, unmount } = render(<div>{node}</div>);
  const out = Array.from(container.querySelectorAll("[data-placement-id]")).map(
    (el) => el.getAttribute("data-placement-id") ?? "",
  );
  unmount();
  return out;
}

beforeEach(() => {
  placements = [];
  wywolaniaZapytania.length = 0;
});

afterEach(() => {
  cleanup();
});

// --- Rytm wstawek -------------------------------------------------------

describe("useInFeedAds - przy której karcie listy pojawia się reklama", () => {
  it("domyślna konfiguracja (brak every) trafia karty 4, 9 i 14, a pierwsze cztery zostawia w spokoju", () => {
    placements = [placement("domyslny")];
    const render_ = renderer();

    for (const index of [0, 1, 2, 3, 5, 8, 10]) {
      expect(reklamyPoKarcie(render_, index)).toEqual([]);
    }
    for (const index of [4, 9, 14]) {
      expect(reklamyPoKarcie(render_, index)).toEqual(["domyslny"]);
    }
  });

  it("every: 1 wstawia reklamę pod KAŻDĄ kartą listy", () => {
    placements = [placement("co1", { every: 1 })];
    const render_ = renderer();

    for (const index of [0, 1, 2, 3, 4, 5]) {
      expect(reklamyPoKarcie(render_, index)).toEqual(["co1"]);
    }
  });

  it("every: 0 NIE wyłącza kampanii - zachowuje się identycznie jak every: 1", () => {
    placements = [placement("zero", { every: 0 })];
    const render_ = renderer();

    for (const index of [0, 1, 2, 3, 4]) {
      expect(reklamyPoKarcie(render_, index)).toEqual(["zero"]);
    }
  });

  it("every nieliczbowe ('co druga') nie pokazuje reklamy ANI RAZU na czterdziestu kartach", () => {
    placements = [placement("smiec", { every: "co druga" })];
    const render_ = renderer();

    for (let index = 0; index < 40; index += 1) {
      expect(render_(index)).toBeNull();
    }
  });

  it("dwa placementy o różnym every trafiające tę samą kartę renderują się OBA - in-feed nie ma sufitu", () => {
    placements = [placement("co2", { every: 2 }), placement("co3", { every: 3 })];
    const render_ = renderer();

    expect(reklamyPoKarcie(render_, 5)).toEqual(["co2", "co3"]);
    expect(reklamyPoKarcie(render_, 1)).toEqual(["co2"]);
    expect(reklamyPoKarcie(render_, 2)).toEqual(["co3"]);
    expect(reklamyPoKarcie(render_, 0)).toEqual([]);
  });

  it("pięć kampanii co 1 kartę daje pięć kreacji pod pierwszą kartą", () => {
    placements = Array.from({ length: 5 }, (_, i) => placement(`k${i}`, { every: 1 }));
    const render_ = renderer();

    expect(reklamyPoKarcie(render_, 0)).toEqual(["k0", "k1", "k2", "k3", "k4"]);
  });
});

// --- Kontrakt wyniku ----------------------------------------------------

describe("useInFeedAds - kontrakt zwracanej wartości", () => {
  it("brak trafień zwraca dokładnie null, a nie pusty fragment (lista renderuje wiersz na TRUTHY)", () => {
    placements = [placement("co5", { every: 5 })];
    const render_ = renderer();

    // `ArchivePostList`: {after && <div className="col-span-full ...">}.
    // Pusty fragment jest truthy i wstawiłby pusty wiersz pod każdą kartą.
    expect(render_(0)).toBeNull();
    expect(render_(3)).toBeNull();
    expect(render_(4)).not.toBeNull();
  });

  it("zapytanie w toku (data undefined) nie wywraca renderera - każda karta dostaje null", () => {
    placements = undefined;
    const render_ = renderer();

    expect(render_(0)).toBeNull();
    expect(render_(4)).toBeNull();
    expect(render_(99)).toBeNull();
  });

  it("pusta lista placementów daje null przy każdej karcie", () => {
    placements = [];
    const render_ = renderer();

    expect(render_(0)).toBeNull();
    expect(render_(4)).toBeNull();
  });

  it("do kreacji trafia CAŁY placement wraz ze slotem, nie samo id", () => {
    placements = [placement("co1", { every: 1 })];
    const render_ = renderer();

    const { container } = render(<div>{render_(0)}</div>);
    const kreacja = container.querySelector("[data-placement-id]");
    expect(kreacja?.getAttribute("data-placement-id")).toBe("co1");
    expect(kreacja?.getAttribute("data-slot-id")).toBe("s-co1");
  });

  it("hook pyta o pozycję in_feed dla przekazanego typu strony i identyfikatora", () => {
    placements = [];
    renderer();

    expect(wywolaniaZapytania[0]).toEqual(["in_feed", "archive", "taksonomia-1"]);
  });

  it("pageId jest opcjonalny - listy globalne (strona główna) wołają hook bez identyfikatora", () => {
    placements = [];
    renderHook(() => useInFeedAds("home"));

    expect(wywolaniaZapytania[0]).toEqual(["in_feed", "home", undefined]);
  });
});
