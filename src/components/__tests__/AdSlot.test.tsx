/**
 * <AdZone /> + telemetria zaangażowania <AdSlotView /> - dwa fragmenty
 * `src/components/AdSlot.tsx`, których nie dotyka istniejący
 * `src/components/ads/__tests__/AdSlotView.test.tsx` (tamten pilnuje Core Web
 * Vitals pojedynczego slotu: rezerwacji miejsca, bramek odroczenia, sandboxu
 * i zgody marketingowej - i to zostaje jego zakresem).
 *
 * CO TEN PLIK PRZYPINA (i dlaczego akurat to).
 *  1. STREFA jako wrapper listy: brak danych i pusta lista mają dać PUSTKĘ
 *     (nie pusty kontener - to jest różnica między „strefa jeszcze się ładuje"
 *     a „strefa zajmuje miejsce w układzie"), lista renderuje po jednym
 *     slocie na placement, `limit` przycina od góry listy, a `className`
 *     dojeżdża do każdego zarezerwowanego pudełka.
 *  2. LICZNIK KLIKNIĘĆ. Beacon „click" jest podpięty nasłuchem na
 *     zarezerwowanym kontenerze, a nie na kreacji - i to jedyne miejsce, gdzie
 *     ta funkcja w ogóle powstaje. Osobny przypadek dowodzi, że slot
 *     ZABLOKOWANY brakiem zgody marketingowej nie melduje ani odsłony, ani
 *     kliknięcia (RODO: bez zgody nie ma pomiaru).
 *  3. ZAANGAŻOWANIE W SANDBOXIE. Kliknięcia wewnątrz `<iframe sandbox>` nie
 *     bąbelkują do strony, więc kreacje html/script raportują je własnym
 *     kanałem (`onEngage`). Oba warianty mają osobny przypadek, bo w kodzie są
 *     to dwie różne, niezależne domknięcia.
 *  4. KREACJA GRAFICZNA BEZ OPCJONALNYCH POL. Slot bez `image_link` nie ma
 *     być owinięty w odnośnik, a brak `image_alt` musi SPAŚĆ na nazwę slotu
 *     (czytnik ekranu inaczej dostaje pustkę). Tego wariantu nie dotyka
 *     `ads/__tests__/AdSlotView.test.tsx` - tam każda kreacja graficzna ma
 *     i link, i opis, i wymiary.
 *
 * CO JEST ZAATRAPOWANE I DLACZEGO.
 *  * `@/lib/ads/queries` - granica danych strefy (zapytanie do bazy).
 *  * `@/lib/ads/consent` - zgoda marketingowa jako przełącznik testu.
 *  * `@/lib/analytics/events` - `beaconAdEvent` normalnie wysyła beacon do
 *    sieci; tutaj rejestruje wywołania, żeby dało się je zaasertować.
 *  * `IntersectionObserver` i `requestIdleCallback` - bramki odroczenia; bez
 *    sterowalnych atrap kreacja nigdy by się nie zamontowała w happy-dom.
 *
 * CO ZOSTAJE PRAWDZIWE: React, `AdContainer` (rezerwacja miejsca, role i
 * atrybuty danych), `SandboxedAdFrame` (heurystyka zaangażowania na utracie
 * fokusu okna) i `useDeferredAd`.
 *
 * RODO / bezpieczeństwo: żadnych prawdziwych identyfikatorów reklamowych ani
 * adresów kreacji - wszystko na example.com.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@/lib/i18n";
import type { AdPlacementWithSlot, AdSlot as AdSlotRow } from "@/lib/ads/types";

const h = vi.hoisted(() => ({
  granted: true,
  placements: null as unknown[] | null,
  events: [] as Array<{ kind: string; slotId: string; placementId: string }>,
  /** Propsy, z jakimi `AdSlotView` wołał ramkę - do dowodu PODŁĄCZENIA. */
  frameProps: [] as Array<{ markup: string; title: string; onEngage?: () => void }>,
}));

vi.mock("@/lib/ads/consent", () => ({
  useMarketingConsent: () => ({
    granted: h.granted,
    decided: true,
    grant: () => {},
    deny: () => {},
  }),
}));

vi.mock("@/lib/ads/queries", () => ({
  useAdPlacements: () => ({ data: h.placements }),
}));

vi.mock("@/lib/analytics/events", () => ({
  beaconAdEvent: (kind: string, slotId: string, placementId: string) => {
    h.events.push({ kind, slotId, placementId });
  },
  beaconPopupEvent: () => {},
}));

// Ramka zostaje PRAWDZIWA - ten mock wyłącznie ZAPISUJE propsy, z jakimi
// `AdSlotView` ją woła, i przekazuje je dalej bez zmian. Dzięki temu jeden
// test może dowieść PODŁĄCZENIA (czy `onEngage` niesie właściwe
// identyfikatory) bez dotykania `window.blur` ani `document.activeElement`,
// a drugi - STABILNOŚCI TOŻSAMOŚCI tego wywołania zwrotnego między renderami.
// Sama HEURYSTYKA SafeFrame ma własny dom i pięć przypadków w
// `src/components/ads/__tests__/adAtoms.test.tsx` („SandboxedAdFrame - pomiar
// interakcji (onEngage)", linie 393-455) - tutaj nie jest powtarzana.
vi.mock("@/components/ads/atoms/SandboxedAdFrame", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ads/atoms/SandboxedAdFrame")>();
  const { createElement } = await import("react");
  return {
    SandboxedAdFrame: (props: { markup: string; title: string; onEngage?: () => void }) => {
      h.frameProps.push(props);
      return createElement(real.SandboxedAdFrame, props);
    },
  };
});

import { AdZone } from "@/components/AdSlot";

/** Obserwator, który natychmiast uznaje slot za widoczny (bramka viewportu). */
class ImmediateIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];
  readonly scrollMargin: string = "";

  private readonly cb: IntersectionObserverCallback;

  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }

  observe(target: Element): void {
    this.cb([{ isIntersecting: true, target } as unknown as IntersectionObserverEntry], this);
  }

  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const ORIGINAL_IO = globalThis.IntersectionObserver;

function slot(over: Partial<AdSlotRow> = {}): AdSlotRow {
  return {
    id: "slot-1",
    tenant_id: "t1",
    name: "Slot testowy",
    kind: "image",
    status: "active",
    html: null,
    script: null,
    image_url: "https://example.com/kreacja.png",
    image_link: "https://example.com/oferta",
    image_alt: "Kreacja testowa",
    width: 300,
    height: 250,
    requires_consent: false,
    targeting: {},
    notes: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...over,
  };
}

function placement(id: string, over: Partial<AdSlotRow> = {}): AdPlacementWithSlot {
  return {
    id,
    tenant_id: "t1",
    slot_id: over.id ?? "slot-1",
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
    slot: slot(over),
  };
}

function renderZone(className?: string, limit?: number) {
  return render(
    <AdZone position="top_of_post" pageType="post" className={className} limit={limit} />,
  );
}

const boxes = (): HTMLElement[] => Array.from(document.querySelectorAll("[data-ad-slot]"));

/** Kreacja montuje się dopiero po otwarciu obu bramek odroczenia. */
async function settleGates(): Promise<void> {
  await waitFor(() => {
    expect(document.querySelector("[data-ad-state='ready']")).not.toBeNull();
  });
}

/**
 * Liczy przypięcia i odpięcia nasłuchu `blur` NA OKNIE.
 *
 * Po co licznik, a nie zwykłe `expect` na skutku: zdarzenie `blur` wysłane w
 * chwili, gdy nasłuch jest właśnie przepinany, nie trafia w nikogo. Test, który
 * sprawdza tylko skutek, jest wtedy wyścigiem - a owinięcie asercji w `waitFor`
 * albo `retry` przechodziłoby TAKŻE wtedy, gdy nasłuch przepina się w kółko,
 * czyli zamiatałoby dokładnie tę wadę, o którą tu chodzi. Dlatego najpierw
 * dowodzimy, że nasłuch ISTNIEJE, i dopiero potem wysyłamy zdarzenie.
 */
function sledzNasluchBlur(): { live: number; adds: number; removes: number } {
  const realAdd = window.addEventListener.bind(window);
  const realRemove = window.removeEventListener.bind(window);
  const stan = { live: 0, adds: 0, removes: 0 };
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    if (type === "blur") {
      stan.live += 1;
      stan.adds += 1;
    }
    return realAdd(type, listener as EventListener, options);
  });
  vi.spyOn(window, "removeEventListener").mockImplementation((type, listener, options) => {
    if (type === "blur") {
      stan.live -= 1;
      stan.removes += 1;
    }
    return realRemove(type, listener as EventListener, options);
  });
  return stan;
}

beforeEach(() => {
  h.granted = true;
  h.placements = null;
  h.events.length = 0;
  h.frameProps.length = 0;
  globalThis.IntersectionObserver = ImmediateIntersectionObserver;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.IntersectionObserver = ORIGINAL_IO;
});

describe("AdZone - strefa reklamowa", () => {
  it("bez danych i przy pustej liście nie zostawia w układzie żadnego pudełka", () => {
    h.placements = null;
    const empty = renderZone();
    expect(empty.container).toBeEmptyDOMElement();
    empty.unmount();

    h.placements = [];
    const none = renderZone();
    expect(none.container).toBeEmptyDOMElement();
  });

  it("renderuje po jednym zarezerwowanym pudełku na placement i przekazuje im klasę strefy", async () => {
    h.placements = [
      placement("p1", { id: "slot-1", name: "Pierwszy" }),
      placement("p2", { id: "slot-2", name: "Drugi" }),
    ];

    renderZone("moja-strefa");
    await settleGates();

    expect(boxes().map((b) => b.dataset.adSlot)).toEqual(["slot-1", "slot-2"]);
    for (const b of boxes()) expect(b.className).toContain("moja-strefa");
    expect(screen.getAllByRole("complementary")).toHaveLength(2);
  });

  it("limit przycina listę od góry, nie wybiera losowo", async () => {
    h.placements = [
      placement("p1", { id: "slot-1" }),
      placement("p2", { id: "slot-2" }),
      placement("p3", { id: "slot-3" }),
    ];

    renderZone(undefined, 2);
    await settleGates();

    expect(boxes().map((b) => b.dataset.adSlot)).toEqual(["slot-1", "slot-2"]);
  });
});

describe("AdSlotView - pomiar zaangażowania", () => {
  it("kliknięcie w zarezerwowany kontener melduje kliknięcie slotu i placementu", async () => {
    h.placements = [placement("p1")];

    renderZone();
    await settleGates();

    expect(h.events).toEqual([{ kind: "impression", slotId: "slot-1", placementId: "p1" }]);

    fireEvent.click(boxes()[0]);

    expect(h.events.at(-1)).toEqual({ kind: "click", slotId: "slot-1", placementId: "p1" });
  });

  it("kreacja bez linku i bez wymiarów renderuje samą grafikę, a opis spada na nazwę slotu", async () => {
    h.placements = [
      placement("p1", {
        name: "Slot bez linku",
        image_link: null,
        image_alt: null,
        width: null,
        height: null,
      }),
    ];

    renderZone();
    await settleGates();

    const img = document.querySelector<HTMLImageElement>("[data-ad-slot] img");
    expect(img).not.toBeNull();
    // Brak `image_alt` = opis z nazwy slotu (inaczej czytnik ekranu dostaje
    // pustkę), brak wymiarów = brak atrybutów width/height na grafice.
    expect(img?.getAttribute("alt")).toBe("Slot bez linku");
    expect(img?.hasAttribute("width")).toBe(false);
    expect(img?.hasAttribute("height")).toBe(false);
    // Bez `image_link` kreacja NIE jest owinięta w odnośnik.
    expect(document.querySelector("[data-ad-slot] a")).toBeNull();
  });

  it("slot zablokowany brakiem zgody marketingowej nie melduje ani odsłony, ani kliknięcia", () => {
    h.granted = false;
    h.placements = [placement("p1", { requires_consent: true })];

    renderZone();

    const box = boxes()[0];
    expect(box.dataset.adState).toBe("blocked");
    fireEvent.click(box);

    expect(h.events).toEqual([]);
  });

  it("kreacja HTML w sandboxie melduje kliknięcie DOKŁADNIE raz, mimo przerenderowań slotu", async () => {
    // Ten przypadek pilnuje trzech rzeczy naraz i każda z nich była wcześniej
    // niesprawdzona:
    //  1. nasłuch `blur` JEST przypięty, zanim poleci zdarzenie (asercja na
    //     obecność, nie na skutek - bez `waitFor` wokół `expect` na zdarzeniu);
    //  2. przerenderowanie slotu NIE przepina tego nasłuchu (to jest dowód
    //     neutralności `useCallback` z `AdSlot.tsx` - przed tą zmianą każdy
    //     render wykonywał parę remove/add, więc `adds` rosło z każdym
    //     przerenderowaniem i ten przypadek był CZERWONY);
    //  3. jedno zdarzenie `blur` daje DOKŁADNIE jedno zgłoszenie kliknięcia,
    //     czyli stabilizacja tożsamości niczego nie zdublowała.
    const nasluch = sledzNasluchBlur();
    h.placements = [
      placement("p1", { kind: "html", html: "<b>kreacja</b>", image_url: null, image_link: null }),
    ];

    const { rerender } = renderZone();
    await settleGates();
    await waitFor(() => {
      expect(nasluch.live).toBe(1);
    });

    // Dwa wymuszone przerenderowania rodzica. `AdSlotView` jest `memo`, więc
    // zmiana klasy strefy jest tu najkrótszą drogą do renderu, który W
    // PRODUKCJI wywołuje dowolna zmiana kontekstu zgody albo bramek odroczenia.
    rerender(<AdZone position="top_of_post" pageType="post" className="strefa-a" />);
    rerender(<AdZone position="top_of_post" pageType="post" className="strefa-b" />);

    expect({ adds: nasluch.adds, removes: nasluch.removes }).toEqual({ adds: 1, removes: 0 });

    const frame = document.querySelector<HTMLIFrameElement>("iframe");
    expect(frame).not.toBeNull();
    if (!frame) return;
    // Heurystyka SafeFrame: fokus wchodzi w ramkę, a okno traci swój.
    act(() => {
      frame.focus();
      window.dispatchEvent(new Event("blur"));
    });

    expect(h.events.filter((zdarzenie) => zdarzenie.kind === "click")).toEqual([
      { kind: "click", slotId: "slot-1", placementId: "p1" },
    ]);
  });

  it("kreacja skryptowa dostaje ten sam kanał zgłoszeń co HTML - z właściwymi identyfikatorami", async () => {
    // PODŁĄCZENIE, nie heurystyka: tu sprawdzamy wyłącznie, że `AdSlotView`
    // przekazuje ramce wywołanie zwrotne, które melduje kliknięcie WŁAŚCIWEGO
    // slotu i placementu. Żadnego `window.blur`, żadnego `activeElement` -
    // czym jest sygnał zaangażowania i kiedy wypada, dowodzi
    // `adAtoms.test.tsx`. Rozdzielenie tych dwóch rzeczy jest całym sensem
    // zmiany: wcześniej jeden przypadek zakładał naraz, że efekt ramki się
    // wykonał, że fokus jest dokładnie na niej i że nic się między tym nie
    // przerenderowało.
    h.placements = [
      placement("p1", {
        kind: "script",
        script: "<script>void 0;</" + "script>",
        image_url: null,
        image_link: null,
      }),
    ];

    renderZone();
    await settleGates();

    const przekazane = h.frameProps.at(-1);
    expect(przekazane?.markup).toBe("<script>void 0;</" + "script>");
    expect(typeof przekazane?.onEngage).toBe("function");

    act(() => {
      przekazane?.onEngage?.();
    });

    expect(h.events.filter((zdarzenie) => zdarzenie.kind === "click")).toEqual([
      { kind: "click", slotId: "slot-1", placementId: "p1" },
    ]);
    // Skrypt kreacji nigdy nie ląduje w drzewie strony - tylko w srcdoc ramki.
    expect(document.querySelectorAll("script[src]")).toHaveLength(0);
  });

  it("wywołanie zwrotne ramki ma STAŁĄ tożsamość między renderami slotu", async () => {
    // Druga połowa dowodu neutralności z `AdSlot.tsx`: to `useCallback` trzyma
    // tożsamość, a nie przypadek. Bez niego każdy render tworzył nową strzałkę,
    // co unieważniało `memo` ramki I przepinało nasłuch `blur` na oknie. Test
    // patrzy wprost na props, więc nie zależy od żadnego zdarzenia ani zegara.
    h.placements = [
      placement("p1", { kind: "html", html: "<b>kreacja</b>", image_url: null, image_link: null }),
    ];

    const { rerender } = renderZone();
    await settleGates();

    const pierwsze = h.frameProps.at(-1)?.onEngage;
    rerender(<AdZone position="top_of_post" pageType="post" className="strefa-a" />);
    rerender(<AdZone position="top_of_post" pageType="post" className="strefa-b" />);
    const ostatnie = h.frameProps.at(-1)?.onEngage;

    expect(h.frameProps.length).toBeGreaterThan(1);
    expect(typeof pierwsze).toBe("function");
    expect(ostatnie).toBe(pierwsze);
  });
});
