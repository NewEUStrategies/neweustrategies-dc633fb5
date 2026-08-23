// Wspólny renderer slotu reklamowego (`AdSlotView`) i wrapper pozycji
// (`AdZone`). RYZYKO jest pieniężne: TU powstają liczby, które trafiają do
// raportu sprzedażowego - odsłona i kliknięcie. Zawyżona odsłona to faktura za
// emisję, której nie było; zawyżone kliknięcie to CTR sprzedawany reklamodawcy.
// Drugi koniec ryzyka jest prawny: bez zgody marketingowej slot ma pokazać
// wyłącznie zaślepkę i NIE wysłać żadnego beaconu.
//
// CO TEN PLIK DOWODZI.
//   1. Bramka zgody: `requires_consent && !granted` renderuje zaślepkę
//      `ads.consentBlocked` w stanie `blocked` i nie wysyła NICZEGO. Sam brak
//      zgody przy slocie bez flagi nie blokuje niczego - to dwa różne warunki
//      i test rozdziela je jawnie.
//   2. Odsłona leci DOKŁADNIE RAZ i dopiero po otwarciu bramek `useDeferredAd`
//      (zamknięcie i ponowne otwarcie bramki nie dokłada drugiej odsłony -
//      pilnuje tego `useRef`, którego typy nie sprawdzą).
//   3. Kotwica płatnego linku nosi `rel="sponsored noopener noreferrer"`.
//      Utrata `sponsored` to problem SEO (płatny link bez oznaczenia), utrata
//      `noopener` - dziura na `window.opener`.
//   4. Kreacje html/script idą przez sandboxowaną ramkę, a jej sygnał
//      interakcji faktycznie zamienia się w beacon `click`.
//   5. DEFEKT (`it.fails`): listener kliknięcia wisi na PUSTYM, zarezerwowanym
//      kontenerze, zanim kreacja się zamontuje.
//   6. DEFEKT (`it.fails`): slot `image` bez `image_url` melduje stan `ready`
//      i wysyła odsłonę za reklamę, której nie ma.
//   7. DEFEKT (`it.fails`): awaria zapytania w `AdZone` jest nieodróżnialna od
//      braku kampanii - jedno i drugie to pusty DOM.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Zachowania Core Web Vitals (rezerwacja pudełka,
// odroczenie payloadu na prawdziwym `useDeferredAd`) dowodzi
// `src/components/ads/__tests__/AdSlotView.test.tsx` - tamten plik jedzie na
// PRAWDZIWYM haku i prawdziwym słowniku. Tu bramki są sterowane atrapą, bo
// przedmiotem dowodu są DECYZJE renderera przy zadanym stanie bramek, a nie
// same bramki. Kontrakt sandboxu ma własny plik (`atoms/__tests__`).
//
// CO JEST ATRAPĄ I DLACZEGO. `beaconAdEvent` - to sieciowy beacon, atrapa jest
// obowiązkowa, ale każda asercja stoi na ARGUMENTACH wywołania.
// `useMarketingConsent` i `useDeferredAd` - sterowanie stanem bramek (własne
// testy w `src/lib/ads/__tests__`). `useAdPlacements` - żeby `AdZone` dostał
// listę bez sieci.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AdPlacementWithSlot, AdSlot } from "@/lib/ads/types";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const beacon = vi.hoisted(() => ({ adEvent: vi.fn() }));
vi.mock("@/lib/analytics/events", () => ({
  beaconAdEvent: beacon.adEvent,
  beaconPopupEvent: vi.fn(),
}));

const zgoda = vi.hoisted(() => ({ granted: true }));
vi.mock("@/lib/ads/consent", () => ({
  useMarketingConsent: () => ({
    granted: zgoda.granted,
    decided: true,
    grant: () => {},
    deny: () => {},
  }),
}));

const bramki = vi.hoisted(() => ({ otwarte: true }));
vi.mock("@/lib/ads/useDeferredAd", async () => {
  const { useRef } = await import("react");
  return {
    useDeferredAd: (opts?: { disabled?: boolean }) => ({
      containerRef: useRef<HTMLDivElement | null>(null),
      // Wierne odwzorowanie prawdziwego haka: `disabled` twardo zamyka bramkę.
      shouldRender: !opts?.disabled && bramki.otwarte,
    }),
  };
});

const zapytania = vi.hoisted(() => ({
  wynik: { data: undefined as AdPlacementWithSlot[] | undefined },
}));
vi.mock("@/lib/ads/queries", () => ({
  useAdPlacements: () => zapytania.wynik,
}));

import { AdSlotView, AdZone } from "@/components/AdSlot";

// --- Fixtures -------------------------------------------------------------

function slot(overrides: Partial<AdSlot> = {}): AdSlot {
  return {
    id: "slot-1",
    tenant_id: "t1",
    name: "Baner stopki",
    kind: "image",
    status: "active",
    html: null,
    script: null,
    image_url: "https://example.com/kreacja.png",
    image_link: "https://example.com/oferta",
    image_alt: "Kreacja",
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

function placement(s: AdSlot, id = "p1"): AdPlacementWithSlot {
  return {
    id,
    tenant_id: "t1",
    slot_id: s.id,
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
    slot: s,
  };
}

const pudelko = () => document.querySelector<HTMLElement>("[data-ad-slot='slot-1']");
const odslony = () => beacon.adEvent.mock.calls.filter((c) => c[0] === "impression");
const klikniecia = () => beacon.adEvent.mock.calls.filter((c) => c[0] === "click");

beforeEach(() => {
  beacon.adEvent.mockClear();
  zgoda.granted = true;
  bramki.otwarte = true;
  zapytania.wynik = { data: undefined };
});

afterEach(cleanup);

// --- Bramka zgody ---------------------------------------------------------

describe("AdSlotView - bramka zgody marketingowej", () => {
  it("requires_consent bez zgody: zaślepka ads.consentBlocked, stan blocked, ZERO beaconów", () => {
    zgoda.granted = false;
    const { container } = render(
      <AdSlotView placement={placement(slot({ requires_consent: true }))} />,
    );

    expect(pudelko()?.getAttribute("data-ad-state")).toBe("blocked");
    expect(pudelko()?.textContent).toContain("ads.consentBlocked");
    expect(container.querySelector("img")).toBeNull();
    expect(beacon.adEvent).not.toHaveBeenCalled();
  });

  it("zaślepka bez zgody nadal trzyma zarezerwowane miejsce (zero CLS po zgodzie)", () => {
    zgoda.granted = false;
    render(<AdSlotView placement={placement(slot({ requires_consent: true }))} />);
    expect(pudelko()?.style.aspectRatio).toBe("300 / 250");
  });

  it("ten sam slot ZE zgodą emituje kreację i odsłonę", () => {
    zgoda.granted = true;
    render(<AdSlotView placement={placement(slot({ requires_consent: true }))} />);

    expect(pudelko()?.getAttribute("data-ad-state")).toBe("ready");
    expect(odslony()).toHaveLength(1);
  });

  it("slot BEZ requires_consent emituje mimo braku zgody - to dwa różne warunki", () => {
    zgoda.granted = false;
    render(<AdSlotView placement={placement(slot({ requires_consent: false }))} />);

    expect(pudelko()?.getAttribute("data-ad-state")).toBe("ready");
    expect(odslony()).toHaveLength(1);
  });

  it("kliknięcie w zablokowany kontener nie wysyła beaconu click", () => {
    zgoda.granted = false;
    render(<AdSlotView placement={placement(slot({ requires_consent: true }))} />);

    fireEvent.click(pudelko()!);
    expect(beacon.adEvent).not.toHaveBeenCalled();
  });
});

// --- Odsłona --------------------------------------------------------------

describe("AdSlotView - beacon odsłony", () => {
  it("odsłona niesie rodzaj, id slotu i id placementu", () => {
    render(<AdSlotView placement={placement(slot(), "p-7")} />);
    expect(beacon.adEvent).toHaveBeenCalledWith("impression", "slot-1", "p-7");
  });

  it("przy zamkniętych bramkach odsłona NIE leci (slot poza ekranem nie jest odsłoną)", () => {
    bramki.otwarte = false;
    render(<AdSlotView placement={placement(slot())} />);

    expect(pudelko()?.getAttribute("data-ad-state")).toBe("loading");
    expect(odslony()).toHaveLength(0);
  });

  it("zamknięcie i ponowne otwarcie bramek nie dokłada drugiej odsłony", () => {
    const widok = render(<AdSlotView placement={placement(slot())} />);
    expect(odslony()).toHaveLength(1);

    bramki.otwarte = false;
    widok.rerender(<AdSlotView placement={placement(slot())} />);
    bramki.otwarte = true;
    widok.rerender(<AdSlotView placement={placement(slot())} />);

    expect(odslony()).toHaveLength(1);
  });
});

// --- Listener kliknięcia --------------------------------------------------

describe("AdSlotView - listener kliknięcia na zarezerwowanym kontenerze", () => {
  it("kliknięcie w wyemitowaną kreację wysyła beacon click z id slotu i placementu", () => {
    render(<AdSlotView placement={placement(slot(), "p-7")} />);

    fireEvent.click(pudelko()!);
    expect(beacon.adEvent).toHaveBeenCalledWith("click", "slot-1", "p-7");
  });

  it("listener wisi na PUSTYM kontenerze już przy zamkniętych bramkach - stan faktyczny", () => {
    bramki.otwarte = false;
    render(<AdSlotView placement={placement(slot())} />);

    expect(pudelko()?.querySelector("img")).toBeNull();
    fireEvent.click(pudelko()!);
    expect(klikniecia()).toHaveLength(1);
  });

  // DEFEKT. Efekt ma `shouldRender` w tablicy zależności, ale w ciele sprawdza
  // wyłącznie `!node || blocked` - podpina się więc do pudełka, które jest
  // jeszcze PUSTE (kreacja czeka na bramki idle + viewport). Czytelnik, który
  // zaznacza tekst obok albo trafia palcem w zarezerwowaną, pustą przestrzeń,
  // generuje kliknięcie reklamy, której w tym momencie nie ma na ekranie.
  // Widoczny skutek: CTR w raporcie sprzedażowym jest zawyżony o kliknięcia
  // w pustkę - i to systematycznie, bo pudełko jest zarezerwowane od pierwszego
  // paintu. OCZEKIWANE: listener podpina się dopiero, gdy `shouldRender` jest
  // prawdą (czyli gdy w pudełku faktycznie stoi kreacja).
  it.fails(
    "kliknięcie w pusty, zarezerwowany kontener NIE POWINNO liczyć się jako kliknięcie reklamy",
    () => {
      bramki.otwarte = false;
      render(<AdSlotView placement={placement(slot())} />);

      fireEvent.click(pudelko()!);
      expect(klikniecia()).toHaveLength(0);
    },
  );

  it("po odmontowaniu slotu kliknięcie w odpięty węzeł nie liczy się już nigdzie", () => {
    const widok = render(<AdSlotView placement={placement(slot())} />);
    const wezel = pudelko()!;
    widok.unmount();

    fireEvent.click(wezel);
    expect(klikniecia()).toHaveLength(0);
  });
});

// --- Kreacja obrazkowa ----------------------------------------------------

describe("AdSlotView - kreacja obrazkowa", () => {
  it("płatny link nosi rel='sponsored noopener noreferrer' i otwiera się w nowej karcie", () => {
    const { container } = render(<AdSlotView placement={placement(slot())} />);

    const kotwica = container.querySelector("a");
    expect(kotwica?.getAttribute("rel")).toBe("sponsored noopener noreferrer");
    expect(kotwica?.getAttribute("target")).toBe("_blank");
    expect(kotwica?.getAttribute("href")).toBe("https://example.com/oferta");
  });

  it("bez image_link kreacja jest samym obrazkiem, bez kotwicy", () => {
    const { container } = render(<AdSlotView placement={placement(slot({ image_link: null }))} />);

    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("brak image_alt spada na nazwę slotu - obrazek nie zostaje bez tekstu alternatywnego", () => {
    render(<AdSlotView placement={placement(slot({ image_alt: null }))} />);
    expect(screen.getByRole("img").getAttribute("alt")).toBe("Baner stopki");
  });

  it("brak wymiarów nie wypisuje atrybutów width/height jako 'null'", () => {
    render(<AdSlotView placement={placement(slot({ width: null, height: null }))} />);

    const img = screen.getByRole("img");
    expect(img.hasAttribute("width")).toBe(false);
    expect(img.hasAttribute("height")).toBe(false);
  });

  it("slot image BEZ image_url melduje 'ready' z pustym pudełkiem - stan faktyczny", () => {
    const { container } = render(<AdSlotView placement={placement(slot({ image_url: null }))} />);

    expect(container.querySelector("img")).toBeNull();
    expect(pudelko()?.getAttribute("data-ad-state")).toBe("ready");
  });

  // DEFEKT. `slot.kind === "image" && slot.image_url` daje `payload = null`,
  // ale `state` liczy się WYŁĄCZNIE z `shouldRender`, więc pudełko melduje
  // "ready", a efekt odsłony (który patrzy tylko na `blocked` i `shouldRender`)
  // wysyła beacon `impression`. Widoczny skutek: reklamodawca dostaje raport
  // z odsłonami slotu, w którym redakcja nie wgrała jeszcze grafiki - liczba
  // odsłon jest zawyżona i nie da się jej odróżnić od realnej emisji.
  // OCZEKIWANE: slot bez treści do pokazania nie zgłasza odsłony.
  it.fails("slot image bez image_url NIE POWINIEN wysyłać odsłony (pusta emisja)", () => {
    render(<AdSlotView placement={placement(slot({ image_url: null }))} />);
    expect(odslony()).toHaveLength(0);
  });
});

// --- Kreacje html / script ------------------------------------------------

describe("AdSlotView - kreacje html i script", () => {
  it("kreacja html idzie do sandboxowanej ramki, a nie do DOM strony", () => {
    const { container } = render(
      <AdSlotView
        placement={placement(
          slot({ kind: "html", image_url: null, html: '<div id="kreacja">x</div>' }),
        )}
      />,
    );

    const ramka = container.querySelector("iframe");
    expect(ramka?.getAttribute("srcdoc")).toContain('<div id="kreacja">x</div>');
    expect(container.querySelector("#kreacja")).toBeNull();
    expect(ramka?.getAttribute("title")).toBe("ads.label: Baner stopki");
  });

  it("kreacja script też idzie przez ramkę - <script> nie ląduje w dokumencie strony", () => {
    const { container } = render(
      <AdSlotView
        placement={placement(
          slot({ kind: "script", image_url: null, script: "<script>var a=1</script>" }),
        )}
      />,
    );

    expect(container.querySelector("iframe")?.getAttribute("srcdoc")).toContain("var a=1");
    expect(container.querySelector("script")).toBeNull();
  });

  it("sygnał interakcji z ramki zamienia się w beacon click z id slotu i placementu", () => {
    const { container } = render(
      <AdSlotView
        placement={placement(slot({ kind: "html", image_url: null, html: "<b>x</b>" }), "p-9")}
      />,
    );

    // Heurystyka ramki: fokus na ramce + utrata fokusu okna.
    container.querySelector("iframe")!.focus();
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(beacon.adEvent).toHaveBeenCalledWith("click", "slot-1", "p-9");
  });

  it("interakcja z ramką kreacji SCRIPT też trafia do beaconu click (osobne podpięcie)", () => {
    const { container } = render(
      <AdSlotView
        placement={placement(
          slot({ kind: "script", image_url: null, script: "<script>var a=1</script>" }),
          "p-11",
        )}
      />,
    );

    container.querySelector("iframe")!.focus();
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(beacon.adEvent).toHaveBeenCalledWith("click", "slot-1", "p-11");
  });

  it("kreacja html z pustą treścią nie montuje ramki, ale nadal melduje 'ready'", () => {
    const { container } = render(
      <AdSlotView placement={placement(slot({ kind: "html", image_url: null, html: null }))} />,
    );

    expect(container.querySelector("iframe")).toBeNull();
    expect(pudelko()?.getAttribute("data-ad-state")).toBe("ready");
  });

  it("kreacja script z pustą treścią nie montuje ramki", () => {
    const { container } = render(
      <AdSlotView placement={placement(slot({ kind: "script", image_url: null, script: null }))} />,
    );

    expect(container.querySelector("iframe")).toBeNull();
  });
});

// --- AdZone ---------------------------------------------------------------

describe("AdZone - wrapper pozycji", () => {
  it("renderuje wszystkie placementy pozycji, gdy limitu nie podano", () => {
    zapytania.wynik = { data: [placement(slot(), "a"), placement(slot(), "b")] };
    const { container } = render(<AdZone position="sidebar" pageType="post" />);

    expect(container.querySelectorAll("[data-ad-slot='slot-1']")).toHaveLength(2);
  });

  it("limit przycina listę do N pierwszych placementów", () => {
    zapytania.wynik = {
      data: [placement(slot(), "a"), placement(slot(), "b"), placement(slot(), "c")],
    };
    const { container } = render(<AdZone position="sidebar" pageType="post" limit={2} />);

    expect(container.querySelectorAll("[data-ad-slot='slot-1']")).toHaveLength(2);
  });

  it("limit === 0 emituje ZERO kreacji - nie jest mylony z 'bez limitu'", () => {
    zapytania.wynik = { data: [placement(slot(), "a"), placement(slot(), "b")] };
    const { container } = render(<AdZone position="sidebar" pageType="post" limit={0} />);

    expect(container.querySelectorAll("[data-ad-slot='slot-1']")).toHaveLength(0);
    expect(beacon.adEvent).not.toHaveBeenCalled();
  });

  it("pusta lista kampanii nie renderuje niczego", () => {
    zapytania.wynik = { data: [] };
    const { container } = render(<AdZone position="sidebar" pageType="post" />);
    expect(container.innerHTML).toBe("");
  });

  // DEFEKT. `if (!data || data.length === 0) return null` skleja dwa zupełnie
  // różne stany: "zapytanie padło" i "nie ma dziś kampanii na tej pozycji".
  // Widoczny skutek: awaria odczytu `ad_placements` (RLS, 500 z PostgREST,
  // offline) wygląda dla wydawcy identycznie jak brak sprzedanej emisji -
  // sloty milkną, nic tego nie zgłasza, a straconej emisji nie da się nawet
  // policzyć po fakcie. OCZEKIWANE: stan awarii jest odróżnialny w DOM
  // (np. atrybut/znacznik diagnostyczny), żeby dało się go wychwycić.
  it.fails("awaria zapytania POWINNA być odróżnialna od braku kampanii", () => {
    zapytania.wynik = { data: undefined };
    const awaria = render(<AdZone position="sidebar" pageType="post" />).container.innerHTML;
    cleanup();

    zapytania.wynik = { data: [] };
    const brakKampanii = render(<AdZone position="sidebar" pageType="post" />).container.innerHTML;

    expect(awaria).not.toBe(brakKampanii);
  });

  it("className z pozycji trafia do zarezerwowanego pudełka każdej kreacji", () => {
    zapytania.wynik = { data: [placement(slot(), "a")] };
    render(<AdZone position="sidebar" pageType="post" className="moja-klasa" />);

    expect(pudelko()?.className).toContain("moja-klasa");
  });
});
