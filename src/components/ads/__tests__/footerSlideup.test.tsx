// Pasek reklamowy przyklejony do dołu ekranu: `src/components/ads/FooterSlideup.tsx`.
//
// PO CO TEN PLIK ISTNIEJE. To NAJBARDZIEJ inwazyjna strefa reklamowa serwisu:
// zasłania dolną krawędź okna na każdej stronie artykułu, archiwum, wyszukiwarki
// i strony głównej. Miała 2,6% pokrycia linii, a odpowiada za trzy rzeczy, które
// psują się cicho i boleśnie:
//
//   * OPÓŹNIENIE - pasek wjeżdżający natychmiast po wejściu na stronę to
//     dokładnie ten wzorzec, za który Google karze interstitialami na mobile;
//   * ZAMYKALNOŚĆ I PAMIĘĆ ZAMKNIĘCIA - pasek, który wraca po każdym kliknięciu
//     w link, jest w praktyce nieusuwalny, a zamknięcie ma być decyzją
//     czytelnika honorowaną przez całą sesję;
//   * KOORDYNACJA NAKŁADEK - pasek na wierzchu popupu newslettera to dwie
//     przeszkody naraz na jednym ekranie.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: klienta Supabase (sieć/baza) i beacon
// analityczny (sieć). `useAdPlacements`, `AdSlotView`, koordynator nakładek,
// prawdziwy `sessionStorage` i prawdziwy słownik i18n biegną NIEATRAPOWANE -
// bo to ich zachowanie jest przedmiotem dowodu.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { realT } from "@/test/i18nReal";

const beacons = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@/lib/analytics/events", () => ({
  beaconAdEvent: (...args: unknown[]) => {
    beacons.calls.push(args);
  },
  beaconPopupEvent: () => {},
}));

const stubs = vi.hoisted(() => ({ from: null as unknown }));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return {
    supabase: {
      from: from.from,
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      rpc: async () => ({ data: [], error: null }),
    },
  };
});

import { FooterSlideup } from "@/components/ads/FooterSlideup";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import { ok, type SupabaseFromStub } from "@/test/supabaseChain";
import {
  __resetOverlayCoordinator,
  isOverlayActive,
  requestOverlaySlot,
} from "@/lib/overlayCoordinator";
import type { AdPlacementWithSlot, AdSlot } from "@/lib/ads/types";

const from = () => stubs.from as SupabaseFromStub;
const t = realT("pl");

const TENANT = "aaaaaaaa-0000-0000-0000-00000000000a";
const STORAGE_PREFIX = "ad_slideup_dismissed:";

function slot(over: Partial<AdSlot> = {}): AdSlot {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    tenant_id: TENANT,
    name: "Kampania paskowa",
    kind: "image",
    status: "active",
    html: null,
    script: null,
    image_url: "https://cdn.example.com/pasek.png",
    image_link: null,
    image_alt: "Kreacja paskowa",
    width: 728,
    height: 90,
    // Bramka zgody ma własny plik dowodowy (`consentGate.test.tsx`); tutaj
    // przedmiotem dowodu jest sam pasek, więc slot nie wymaga zgody.
    requires_consent: false,
    targeting: {},
    notes: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

let seq = 0;
function placement(over: Partial<AdPlacementWithSlot> = {}): AdPlacementWithSlot {
  seq += 1;
  return {
    id: `77777777-8888-9999-aaaa-${String(seq).padStart(12, "0")}`,
    tenant_id: TENANT,
    slot_id: slot().id,
    position: "footer_slideup",
    page_type: "all",
    page_id: null,
    config: {},
    sort_order: 0,
    active: true,
    starts_at: null,
    ends_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    slot: slot(),
    ...over,
  };
}

function respondWith(rows: AdPlacementWithSlot[]): void {
  from().setResponse("ad_placements", ok(rows));
}

/** Renderuje pasek i czeka, aż warstwa danych odpowie (efekt paska już ruszył). */
async function renderSlideup() {
  const view = renderWithQueryClient(<FooterSlideup pageType="post" pageId="post-1" />);
  await waitFor(() => expect(from().chainsFor("ad_placements").length).toBeGreaterThan(0));
  return view;
}

/** Przesuwa zegar tak, jak zrobiłby to czytelnik czekający na pasek. */
async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

/**
 * Bramka viewportu z `useDeferredAd` jest GRANICĄ przeglądarki: happy-dom ma
 * `IntersectionObserver`, ale bez silnika układu nigdy nie zgłasza przecięcia,
 * więc kreacja nie doszłaby do DOM-u i test milczałby o rzeczach, które chce
 * udowodnić. Atrapa zgłasza przecięcie od razu - jak slot widoczny na ekranie.
 */
class ImmediateIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];
  private readonly cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element): void {
    this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/**
 * Zewnętrzny pasek, a NIE wewnętrzne pudełko slotu. Oba są punktami
 * orientacyjnymi `complementary` i w polskim słowniku mają tę samą nazwę
 * („Reklama"), więc samo `queryByRole` z nazwą trafiałoby na dwa elementy -
 * to jest dokładnie defekt opisany niżej przy teście dostępności.
 */
function slideup(): HTMLElement | null {
  return (
    screen
      .queryAllByRole("complementary", { name: t("ads.slideupLabel") })
      .find((el) => el.querySelector("[data-ad-slot]") !== null) ?? null
  );
}

/** Pudełka slotów wyrenderowane wewnątrz paska. */
function adBoxes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-ad-slot]"));
}

const realIntersectionObserver = globalThis.IntersectionObserver;

beforeEach(() => {
  // `shouldAdvanceTime` zostawia obietnice react-query przy prawdziwym zegarze,
  // a `setTimeout` opóźnienia paska pod kontrolą testu.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  globalThis.IntersectionObserver = ImmediateIntersectionObserver;
  from().reset();
  __resetOverlayCoordinator();
  window.sessionStorage.clear();
  window.localStorage.clear();
  beacons.calls = [];
  respondWith([placement()]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  globalThis.IntersectionObserver = realIntersectionObserver;
  __resetOverlayCoordinator();
});

// ---------------------------------------------------------------------------
describe("brak placementu", () => {
  it("bez kampanii na tę pozycję nie renderuje NICZEGO", async () => {
    respondWith([]);

    const { container } = await renderSlideup();
    await tick(10_000);

    expect(container).toBeEmptyDOMElement();
    expect(slideup()).toBeNull();
  });

  it("bez kampanii nie zajmuje slotu koordynatora nakładek", async () => {
    respondWith([]);

    await renderSlideup();
    await tick(10_000);

    // Pasek, który rezerwuje slot „na wszelki wypadek", blokowałby popup
    // newslettera na stronie, gdzie żadnej reklamy paskowej nie ma.
    expect(isOverlayActive()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("opóźnienie pojawienia się (delay_ms)", () => {
  it("NIE pokazuje się natychmiast - domyślnie czeka trzy sekundy", async () => {
    respondWith([placement({ config: {} })]);

    await renderSlideup();
    await tick(2_900);

    // Nakładka wjeżdżająca w pierwszej sekundzie to interstitial w rozumieniu
    // wytycznych Google dla mobile - kara rankingowa, nie tylko zła UX.
    expect(slideup()).toBeNull();
  });

  it("pokazuje się po upływie domyślnego opóźnienia", async () => {
    respondWith([placement({ config: {} })]);

    await renderSlideup();
    await tick(3_100);

    expect(slideup()).not.toBeNull();
  });

  it("honoruje opóźnienie z konfiguracji placementu", async () => {
    respondWith([placement({ config: { delay_ms: 8000 } })]);

    await renderSlideup();
    await tick(3_500);
    expect(slideup()).toBeNull();

    await tick(5_000);
    expect(slideup()).not.toBeNull();
  });

  it("opóźnienie zerowe pokazuje pasek od razu", async () => {
    respondWith([placement({ config: { delay_ms: 0 } })]);

    await renderSlideup();
    await tick(0);

    expect(slideup()).not.toBeNull();
  });

  it("opóźnienie ujemne jest przycinane do zera, a nie do przeszłości", async () => {
    respondWith([placement({ config: { delay_ms: -5000 } })]);

    await renderSlideup();
    await tick(0);

    expect(slideup()).not.toBeNull();
  });

  it("odmontowanie DOKŁADNIE w chwili przyznania slotu i tak go zwalnia", async () => {
    respondWith([placement({ config: { delay_ms: 1000 } })]);
    const { unmount } = await renderSlideup();

    // Wyścig, którego nie da się złapać przypadkiem: licznik odpala i pasek
    // prosi koordynatora o slot, ale czytelnik klika w link, ZANIM obietnica
    // przyznania zdąży się rozwiązać. Bez zwolnienia slotu w tej gałęzi
    // koordynator zostaje na zawsze „zajęty" przez komponent, którego już nie
    // ma - i do końca sesji nie otworzy się ŻADNA nakładka: ani popup
    // newslettera, ani żadna inna reklama paskowa.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(isOverlayActive()).toBe(false);
    expect(slideup()).toBeNull();
  });

  it("odmontowanie PRZED upływem opóźnienia anuluje pasek i zwalnia kolejkę", async () => {
    respondWith([placement({ config: { delay_ms: 5000 } })]);
    const { unmount } = await renderSlideup();

    unmount();
    await tick(6_000);

    // Nawigacja w trakcie odliczania to normalny przebieg czytania serwisu;
    // niezanulowany timer dorysowałby pasek na następnej stronie.
    expect(slideup()).toBeNull();
    expect(isOverlayActive()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("zamykanie i pamięć zamknięcia", () => {
  it("domyślnie jest zamykalny - przycisk ma etykietę ze słownika", async () => {
    respondWith([placement({ config: { delay_ms: 0 } })]);

    await renderSlideup();
    await tick(0);

    expect(screen.getByRole("button", { name: t("ads.dismiss") })).toBeInTheDocument();
  });

  it("dismissible=false zdejmuje przycisk zamknięcia", async () => {
    respondWith([placement({ config: { delay_ms: 0, dismissible: false } })]);

    await renderSlideup();
    await tick(0);

    expect(slideup()).not.toBeNull();
    expect(screen.queryByRole("button", { name: t("ads.dismiss") })).toBeNull();
  });

  it("kliknięcie zamknięcia usuwa pasek z ekranu", async () => {
    const p = placement({ config: { delay_ms: 0 } });
    respondWith([p]);
    await renderSlideup();
    await tick(0);

    fireEvent.click(screen.getByRole("button", { name: t("ads.dismiss") }));

    expect(slideup()).toBeNull();
  });

  it("zamknięcie zapisuje decyzję na CAŁĄ SESJĘ przeglądarki", async () => {
    const p = placement({ config: { delay_ms: 0 } });
    respondWith([p]);
    await renderSlideup();
    await tick(0);

    fireEvent.click(screen.getByRole("button", { name: t("ads.dismiss") }));

    expect(window.sessionStorage.getItem(STORAGE_PREFIX + p.id)).toBe("1");
  });

  it("po zamknięciu nie wraca przy wejściu na kolejną stronę", async () => {
    const p = placement({ config: { delay_ms: 0 } });
    window.sessionStorage.setItem(STORAGE_PREFIX + p.id, "1");
    respondWith([p]);

    await renderSlideup();
    await tick(10_000);

    // To jest sedno „zamykalności": decyzja czytelnika przeżywa nawigację.
    // Bez tego pasek wracałby przy każdym kliknięciu w link.
    expect(slideup()).toBeNull();
  });

  it("zamknięcie JEDNEJ kampanii nie wycisza innej", async () => {
    const stara = placement({ config: { delay_ms: 0 } });
    window.sessionStorage.setItem(STORAGE_PREFIX + stara.id, "1");
    const nowa = placement({ config: { delay_ms: 0 } });
    respondWith([nowa]);

    await renderSlideup();
    await tick(0);

    expect(slideup()).not.toBeNull();
  });

  it("pasek NIEzamykalny ignoruje zapisane zamknięcie", async () => {
    // Świadoma asymetria: skoro nie da się go zamknąć, nie ma czego pamiętać.
    // Test utrwala tę decyzję, żeby nikt jej nie „poprawił" w drugą stronę.
    const p = placement({ config: { delay_ms: 0, dismissible: false } });
    window.sessionStorage.setItem(STORAGE_PREFIX + p.id, "1");
    respondWith([p]);

    await renderSlideup();
    await tick(0);

    expect(slideup()).not.toBeNull();
  });

  it("niedostępny sessionStorage nie wywraca strony", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation((): string | null => {
      throw new Error("SecurityError: storage disabled");
    });
    respondWith([placement({ config: { delay_ms: 0 } })]);

    try {
      await renderSlideup();
      await tick(0);

      // Tryb prywatny Safari i polityki firmowe potrafią rzucać na dostępie do
      // storage. Pasek ma się wtedy pokazać, a nie zabić render całej strony.
      expect(slideup()).not.toBeNull();
    } finally {
      getItem.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
describe("koordynacja z innymi nakładkami", () => {
  it("nie wchodzi na wierzch nakładki, która już trzyma slot", async () => {
    await requestOverlaySlot("popup-newslettera", { priority: 5 });
    respondWith([placement({ config: { delay_ms: 0 } })]);

    await renderSlideup();
    await tick(1_000);

    // Dwie przeszkody naraz na jednym ekranie to najgorszy możliwy pierwszy
    // kontakt z serwisem - koordynator ma je szeregować, nie stapiać.
    expect(slideup()).toBeNull();
  });

  it("po pokazaniu paska slot koordynatora jest zajęty", async () => {
    respondWith([placement({ config: { delay_ms: 0 } })]);

    await renderSlideup();
    await tick(0);

    expect(isOverlayActive()).toBe(true);
  });

  it("zamknięcie paska zwalnia slot dla kolejnych nakładek", async () => {
    respondWith([placement({ config: { delay_ms: 0 } })]);
    await renderSlideup();
    await tick(0);

    fireEvent.click(screen.getByRole("button", { name: t("ads.dismiss") }));

    expect(isOverlayActive()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("wybór kampanii i dostępność", () => {
  it("bierze PIERWSZĄ kampanię z listy - kolejność ustala sort_order", async () => {
    const pierwsza = placement({ config: { delay_ms: 0 }, sort_order: 0 });
    const druga = placement({
      config: { delay_ms: 0 },
      sort_order: 1,
      slot: slot({ image_alt: "Kreacja rezerwowa" }),
    });
    respondWith([pierwsza, druga]);

    await renderSlideup();
    await tick(0);

    // Jedna kreacja, nie stos kreacji: pasek bierze `data[0]`, resztę pomija.
    expect(adBoxes()).toHaveLength(1);
    expect(screen.queryByAltText("Kreacja rezerwowa")).toBeNull();
  });

  it("pasek jest opisanym punktem orientacyjnym, a nie anonimowym div-em", async () => {
    respondWith([placement({ config: { delay_ms: 0 } })]);

    await renderSlideup();
    await tick(0);

    expect(slideup()).toHaveAttribute("aria-label", t("ads.slideupLabel"));
  });

  it("nie łamie reguł axe poza unikalnością punktów orientacyjnych", async () => {
    respondWith([placement({ config: { delay_ms: 0 } })]);
    const { container } = await renderSlideup();
    await tick(0);

    // Obie reguły o punktach orientacyjnych są tu WYŁĄCZONE świadomie i mają
    // własny, nazwany test niżej - reszta (tekst alternatywny kreacji, nazwa
    // przycisku zamknięcia, poprawność ARIA) ma dalej pilnować paska.
    const violations = await axeViolations(container, {
      "landmark-unique": { enabled: false },
      "landmark-complementary-is-top-level": { enabled: false },
    });
    expect(violations, summarize(violations)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // DEFEKT - test celowo oznaczony `it.fails`, kod produkcyjny NIE jest zmieniany.
  //
  // CO JEST ZŁE. `FooterSlideup` opakowuje kreację własnym punktem orientacyjnym
  // `role="complementary"` z etykietą `t("ads.slideupLabel")`, a renderowany
  // w środku `AdSlotView` -> `AdContainer` dokłada DRUGI, zagnieżdżony punkt
  // orientacyjny `role="complementary"` z etykietą `t("ads.label")`. W polskim
  // słowniku obie wartości to dosłownie „Reklama" (w angielskim - dwa razy
  // „Advertisement"), więc jeden pasek reklamowy produkuje dwa nierozróżnialne,
  // zagnieżdżone punkty orientacyjne. axe-core zgłasza tu `landmark-unique`.
  //
  // DLACZEGO TO RYZYKO. Użytkownik czytnika ekranu, przechodząc po punktach
  // orientacyjnych, wchodzi w „Reklama", a w środku znajduje kolejną „Reklama" -
  // i nie ma jak stwierdzić, czy to ta sama rzecz, czy druga reklama. Zagnieżdżenie
  // dwóch identycznie nazwanych regionów jest gorsze niż brak regionu: sugeruje
  // strukturę, której nie ma. Dotyczy KAŻDEJ strony serwisu, bo pasek renderuje
  // się na wpisach, archiwum, wyszukiwarce i stronie głównej.
  //
  // DLACZEGO NIE NAPRAWIAM. Poprawka wymaga rozstrzygnięcia, KTÓRY z dwóch
  // regionów jest tym właściwym: albo pasek przestaje być punktem orientacyjnym
  // (wtedy `role`/`aria-label` schodzą z `FooterSlideup`, a etykieta paska staje
  // się martwym kluczem i18n do usunięcia z PL i EN), albo zostaje, a slot
  // w środku traci rolę - co zmienia zachowanie WSZYSTKICH stref, nie tylko tej.
  // To decyzja projektowa nad dwoma plikami produkcyjnymi i słownikiem,
  // a zadanie zabrania zmian w kodzie produkcyjnym.
  it.fails("pasek NIE zagnieżdża drugiego punktu orientacyjnego o tej samej nazwie", async () => {
    respondWith([placement({ config: { delay_ms: 0 } })]);
    const { container } = await renderSlideup();
    await tick(0);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
