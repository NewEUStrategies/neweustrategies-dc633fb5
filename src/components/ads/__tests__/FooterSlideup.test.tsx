// Nakładka reklamowa przyklejona do dołu ekranu czytelnika. RYZYKO jest
// dwustronne i oba końce są kosztowne: błąd w jedną stronę daje reklamę, której
// NIE DA SIĘ ZAMKNĄĆ (przykryty dół treści na każdej podstronie), w drugą -
// reklamę, która NIE POKAŻE SIĘ NIGDY (emisja sprzedana i nierozliczona).
//
// CO TEN PLIK DOWODZI.
//   1. Brak kampanii nie ustawia ŻADNEGO timera. Efekt wychodzi przed
//      `setTimeout`, więc strona bez reklamy nie płaci nawet za budzik.
//   2. Opóźnienie z panelu redakcji faktycznie opóźnia: przed jego upływem
//      nakładki nie ma w DOM, po - jest. Fałszywy dowód dałby tu każdy test
//      z `waitFor`, dlatego czas jest sterowany zegarem, nie oczekiwaniem.
//   3. Nieliczbowe `delay_ms` (redakcja wpisuje słownie) daje NaN, a
//      `setTimeout(fn, NaN)` odpala się natychmiast - defekt, `it.fails`.
//   4. Zamknięcie żyje w `sessionStorage` i przeżywa ponowny montaż, ALE
//      nakładka NIEZAMYKALNA w ogóle nie zagląda do tego zapisu - czyli
//      pokaże się znowu komuś, kto ją wcześniej zamknął.
//   5. Oba dojścia do `sessionStorage` są w try/catch i każde połknięcie ma
//      inny skutek: wyjątek przy odczycie = nakładka wraca zawsze, wyjątek
//      przy zapisie = zamknięcie działa tylko do odświeżenia.
//   6. Koordynator nakładek jest ASYNCHRONICZNY: dopóki nie przyzna slotu,
//      nakładki nie ma; odmontowanie przed przyznaniem zwalnia slot i nie
//      dotyka stanu; sprzątanie anuluje żądanie TYM SAMYM identyfikatorem.
//   7. Zamknięcie zwalnia slot dokładnie raz i nie wraca do końca sesji.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Samych decyzji bez Reacta (klucze, wartości
// domyślne, try/catch) dowodzi `src/lib/ads/__tests__/footerSlideup.test.ts`.
// Renderu pojedynczego slotu - `src/components/ads/__tests__/AdSlotView.*`.
//
// CO JEST ATRAPĄ I DLACZEGO. `@/lib/ads/queries` (żeby sterować kampanią bez
// sieci), `@/lib/overlayCoordinator` (bo jego prawdziwy, PERSYSTOWANY budżet
// przerwań i 30-sekundowy cooldown uczyniłyby test zależnym od kolejności
// przypadków, a przedmiotem dowodu jest tu KONTRAKT wywołania, nie polityka
// koordynatora - ta ma własne testy) oraz `@/components/AdSlot` (nakładka ma
// dowieść, KIEDY pokazuje slot, a nie jak slot się rysuje).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AdPlacementWithSlot, AdSlot } from "@/lib/ads/types";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const zapytania = vi.hoisted(() => ({ dane: undefined as unknown[] | undefined }));
vi.mock("@/lib/ads/queries", () => ({
  useAdPlacements: () => ({ data: zapytania.dane }),
}));

vi.mock("@/components/AdSlot", () => ({
  AdSlotView: ({ placement }: { placement: { id: string } }) => (
    <div data-testid="kreacja" data-placement={placement.id} />
  ),
  AdZone: () => null,
}));

const koordynator = vi.hoisted(() => {
  const release = vi.fn();
  const czekajacy: Array<(r: () => void) => void> = [];
  const tryb = { przyznajOdRazu: true };
  const requestOverlaySlot = vi.fn(
    (_id: string, _opts?: unknown) =>
      new Promise<() => void>((resolve) => {
        czekajacy.push(resolve);
        if (tryb.przyznajOdRazu) resolve(release);
      }),
  );
  const cancelOverlayRequest = vi.fn();
  return { release, czekajacy, tryb, requestOverlaySlot, cancelOverlayRequest };
});
vi.mock("@/lib/overlayCoordinator", () => ({
  requestOverlaySlot: koordynator.requestOverlaySlot,
  cancelOverlayRequest: koordynator.cancelOverlayRequest,
}));

import { FooterSlideup } from "@/components/ads/FooterSlideup";

// --- Fixtures -------------------------------------------------------------

function slot(): AdSlot {
  return {
    id: "slot-1",
    tenant_id: "t1",
    name: "Stopka",
    kind: "image",
    status: "active",
    html: null,
    script: null,
    image_url: "https://example.com/ad.png",
    image_link: null,
    image_alt: "Reklama",
    width: 728,
    height: 90,
    requires_consent: false,
    targeting: {},
    notes: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
}

/**
 * Placement musi być STABILNY między renderami - dokładnie tak, jak oddaje go
 * react-query. Gdyby test tworzył nowy obiekt na każdy render, `useEffect`
 * z zależnością `[placement]` przeliczałby się bez końca i dowód z punktu 7
 * (nakładka nie wraca po zamknięciu) byłby fałszywy.
 */
function placement(id: string, config: Record<string, unknown>): AdPlacementWithSlot {
  return {
    id,
    tenant_id: "t1",
    slot_id: "slot-1",
    position: "footer_slideup",
    page_type: "post",
    page_id: null,
    config,
    sort_order: 0,
    active: true,
    starts_at: null,
    ends_at: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    slot: slot(),
  };
}

const nakladka = () => screen.queryByRole("complementary", { name: "ads.slideupLabel" });
const przyciskZamknij = () => screen.queryByRole("button", { name: "ads.dismiss" });

/** Przesuń zegar i domknij mikrozadania obietnicy koordynatora. */
async function przewin(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** Ustaw kampanię (jeden placement) i zamontuj nakładkę. */
function zamontuj(p: AdPlacementWithSlot | null) {
  zapytania.dane = p ? [p] : [];
  return render(<FooterSlideup pageType="post" pageId="post-1" />);
}

beforeEach(() => {
  vi.useFakeTimers();
  koordynator.tryb.przyznajOdRazu = true;
  koordynator.czekajacy.length = 0;
  koordynator.release.mockClear();
  koordynator.requestOverlaySlot.mockClear();
  koordynator.cancelOverlayRequest.mockClear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// --- Brak kampanii --------------------------------------------------------

describe("FooterSlideup - brak kampanii", () => {
  it("puste dane nie renderują nakładki i NIE ustawiają timera", () => {
    zamontuj(null);
    expect(nakladka()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(koordynator.requestOverlaySlot).not.toHaveBeenCalled();
  });

  it("zapytanie jeszcze w locie (data undefined) też nie uzbraja timera", () => {
    zapytania.dane = undefined;
    render(<FooterSlideup pageType="post" pageId="post-1" />);
    expect(nakladka()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// --- Opóźnienie -----------------------------------------------------------

describe("FooterSlideup - opóźnienie emisji", () => {
  it("przy pustym configu nakładki nie ma przez 2999 ms, a jest po 3000 ms", async () => {
    zamontuj(placement("p1", {}));

    await przewin(2999);
    expect(nakladka()).toBeNull();

    await przewin(1);
    expect(nakladka()).not.toBeNull();
    expect(screen.getByTestId("kreacja").dataset.placement).toBe("p1");
  });

  it("delay_ms z panelu jest respektowany co do milisekundy", async () => {
    zamontuj(placement("p1", { delay_ms: 500 }));

    await przewin(499);
    expect(nakladka()).toBeNull();

    await przewin(1);
    expect(nakladka()).not.toBeNull();
  });

  it("ujemne delay_ms pokazuje nakładkę natychmiast (Math.max podciąga do zera)", async () => {
    zamontuj(placement("p1", { delay_ms: -5000 }));

    await przewin(0);
    expect(nakladka()).not.toBeNull();
  });

  it("nieliczbowe delay_ms pokazuje nakładkę NATYCHMIAST - stan faktyczny, przypięty", async () => {
    zamontuj(placement("p1", { delay_ms: "za chwilę" }));

    await przewin(0);
    expect(nakladka()).not.toBeNull();
  });

  // DEFEKT. `Number("za chwilę")` = NaN, `Math.max(0, NaN)` = NaN,
  // `setTimeout(fn, NaN)` zachowuje się jak `setTimeout(fn, 0)`. Redakcja
  // wpisuje opóźnienie słownie (albo wkleja "3 s"), a czytelnik dostaje
  // nakładkę na twarz w pierwszej klatce - odwrotnie niż brzmiała intencja.
  // OCZEKIWANE: wartość nie do sparsowania cofa się do domyślnych 3000 ms,
  // więc na 0 ms nakładki jeszcze nie ma.
  it.fails(
    "nieliczbowe delay_ms NIE POWINNO pokazywać nakładki przed upływem 3000 ms",
    async () => {
      zamontuj(placement("p1", { delay_ms: "za chwilę" }));

      await przewin(0);
      expect(nakladka()).toBeNull();
    },
  );
});

// --- Koordynator nakładek -------------------------------------------------

describe("FooterSlideup - koordynator nakładek", () => {
  it("prosi o slot 'footer-slideup:<id>' jako nakładka marketingowa o priorytecie -1", async () => {
    zamontuj(placement("p1", { delay_ms: 0 }));
    await przewin(0);

    expect(koordynator.requestOverlaySlot).toHaveBeenCalledTimes(1);
    expect(koordynator.requestOverlaySlot).toHaveBeenCalledWith("footer-slideup:p1", {
      marketing: true,
      priority: -1,
    });
  });

  it("dopóki koordynator nie przyzna slotu, nakładki nie ma - popup wygrywa", async () => {
    koordynator.tryb.przyznajOdRazu = false;
    zamontuj(placement("p1", { delay_ms: 0 }));

    await przewin(10_000);
    expect(nakladka()).toBeNull();

    // Popup się zamknął, koordynator zwalnia kolejkę.
    await act(async () => {
      koordynator.czekajacy.forEach((resolve) => resolve(koordynator.release));
    });
    expect(nakladka()).not.toBeNull();
  });

  it("odmontowanie PRZED przyznaniem slotu zwalnia go i nie dotyka stanu Reacta", async () => {
    const bledy = vi.spyOn(console, "error").mockImplementation(() => {});
    koordynator.tryb.przyznajOdRazu = false;
    const widok = zamontuj(placement("p1", { delay_ms: 0 }));
    await przewin(0);

    widok.unmount();
    await act(async () => {
      koordynator.czekajacy.forEach((resolve) => resolve(koordynator.release));
    });

    // Slot oddany, żaden setState nie poleciał po odmontowaniu.
    expect(koordynator.release).toHaveBeenCalledTimes(1);
    expect(nakladka()).toBeNull();
    expect(bledy).not.toHaveBeenCalled();
  });

  it("sprzątanie efektu anuluje żądanie TYM SAMYM identyfikatorem slotu", () => {
    const widok = zamontuj(placement("p1", { delay_ms: 3000 }));
    widok.unmount();

    expect(koordynator.cancelOverlayRequest).toHaveBeenCalledWith("footer-slideup:p1");
  });

  it("zmiana kampanii nie pokazuje nowej kreacji pod zezwoleniem wydanym poprzedniej", async () => {
    const pierwsza = placement("p1", { delay_ms: 0 });
    const druga = placement("p2", { delay_ms: 1000 });
    const widok = zamontuj(pierwsza);
    await przewin(0);
    expect(screen.getByTestId("kreacja").dataset.placement).toBe("p1");

    zapytania.dane = [druga];
    await act(async () => {
      widok.rerender(<FooterSlideup pageType="post" pageId="post-1" />);
    });
    // Stare zezwolenie oddane, nowa kreacja czeka na własne opóźnienie.
    expect(nakladka()).toBeNull();
    expect(koordynator.cancelOverlayRequest).toHaveBeenCalledWith("footer-slideup:p1");

    await przewin(1000);
    expect(screen.getByTestId("kreacja").dataset.placement).toBe("p2");
  });
});

// --- Zamykanie ------------------------------------------------------------

describe("FooterSlideup - zamykanie i pamięć sesji", () => {
  it("nakładka ma rolę complementary, etykietę i przycisk zamknięcia", async () => {
    zamontuj(placement("p1", { delay_ms: 0 }));
    await przewin(0);

    expect(nakladka()).not.toBeNull();
    expect(przyciskZamknij()).not.toBeNull();
  });

  it("zamknięcie znika nakładkę i zapisuje '1' pod kluczem placementu", async () => {
    zamontuj(placement("p1", { delay_ms: 0 }));
    await przewin(0);

    await act(async () => {
      fireEvent.click(przyciskZamknij()!);
    });

    expect(nakladka()).toBeNull();
    expect(sessionStorage.getItem("ad_slideup_dismissed:p1")).toBe("1");
  });

  it("po zamknięciu ponowny montaż nie uzbraja nawet timera", async () => {
    const p = placement("p1", { delay_ms: 0 });
    zamontuj(p);
    await przewin(0);
    await act(async () => {
      fireEvent.click(przyciskZamknij()!);
    });
    cleanup();

    koordynator.requestOverlaySlot.mockClear();
    zamontuj(p);
    expect(vi.getTimerCount()).toBe(0);
    await przewin(10_000);
    expect(nakladka()).toBeNull();
    expect(koordynator.requestOverlaySlot).not.toHaveBeenCalled();
  });

  it("zamknięcie zwalnia slot koordynatora DOKŁADNIE RAZ, także po odmontowaniu", async () => {
    const widok = zamontuj(placement("p1", { delay_ms: 0 }));
    await przewin(0);

    await act(async () => {
      fireEvent.click(przyciskZamknij()!);
    });
    expect(koordynator.release).toHaveBeenCalledTimes(1);

    // Sprzątanie efektu woła `releaseSlotRef.current?.()`, ale ref jest już
    // wyzerowany - drugie zwolnienie tego samego slotu przestawiłoby cooldown
    // koordynatora i przepuściło kolejną nakładkę poza kolejnością.
    widok.unmount();
    expect(koordynator.release).toHaveBeenCalledTimes(1);
  });

  it("po zamknięciu nakładka nie wraca do końca sesji - efekt się nie przelicza", async () => {
    zamontuj(placement("p1", { delay_ms: 0 }));
    await przewin(0);
    await act(async () => {
      fireEvent.click(przyciskZamknij()!);
    });

    await przewin(600_000);
    expect(nakladka()).toBeNull();
    expect(koordynator.requestOverlaySlot).toHaveBeenCalledTimes(1);
  });
});

// --- Nakładka niezamykalna ------------------------------------------------

describe("FooterSlideup - dismissible: false", () => {
  it("nie renderuje przycisku zamknięcia (nakładki nie da się zdjąć)", async () => {
    zamontuj(placement("p1", { delay_ms: 0, dismissible: false }));
    await przewin(0);

    expect(nakladka()).not.toBeNull();
    expect(przyciskZamknij()).toBeNull();
  });

  it("POMIJA sprawdzenie sessionStorage: pokazuje się znowu temu, kto ją już zamknął", async () => {
    // Czytelnik zamknął tę nakładkę, gdy była zamykalna...
    sessionStorage.setItem("ad_slideup_dismissed:p1", "1");

    // ...redakcja przestawia dismissible na false i zapis przestaje obowiązywać.
    zamontuj(placement("p1", { delay_ms: 0, dismissible: false }));
    await przewin(0);
    expect(nakladka()).not.toBeNull();
    expect(przyciskZamknij()).toBeNull();
  });

  it("kontrola: ten sam zapis PRZY zamykalnej nakładce blokuje emisję", async () => {
    sessionStorage.setItem("ad_slideup_dismissed:p1", "1");

    zamontuj(placement("p1", { delay_ms: 0 }));
    await przewin(0);
    expect(nakladka()).toBeNull();
  });
});

// --- sessionStorage niedostępny ------------------------------------------

describe("FooterSlideup - zablokowany magazyn sesji (tryb prywatny)", () => {
  it("wyjątek przy ODCZYCIE: nakładka pokazuje się mimo wcześniejszego zamknięcia", async () => {
    sessionStorage.setItem("ad_slideup_dismissed:p1", "1");
    vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new DOMException("dostęp do magazynu zablokowany");
    });

    zamontuj(placement("p1", { delay_ms: 0 }));
    await przewin(0);
    expect(nakladka()).not.toBeNull();
  });

  it("wyjątek przy ZAPISIE: zamknięcie działa w tej sesji, ale nie przeżywa montażu", async () => {
    const zapis = vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new DOMException("przekroczony limit magazynu");
    });
    const p = placement("p1", { delay_ms: 0 });
    zamontuj(p);
    await przewin(0);

    await act(async () => {
      fireEvent.click(przyciskZamknij()!);
    });
    expect(nakladka()).toBeNull();

    // Nic nie zostało zapisane - po powrocie na stronę reklama wraca.
    zapis.mockRestore();
    cleanup();
    zamontuj(p);
    await przewin(0);
    expect(nakladka()).not.toBeNull();
  });
});
