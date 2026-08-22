// CO DOWODZI TEN PLIK
// PODWÓJNY BEACON kliknięcia w badge „Preferowane źródło w Google"
// (`src/lib/seo/googleSourceBadgeAnalytics.ts`) - do 22.08.2026 ZERO
// wykonanych linii. Moduł ma jedno zadanie: z jednego kliknięcia zrobić DWA
// niezależne zapisy - własny `analytics_events` przez `/api/public/track`
// (raporty w `/admin/analytics`) oraz GA4 `gtag`, jeśli skrypt został
// wczytany po zgodzie marketingowej. Cała wartość tego modułu leży w SŁOWIE
// „niezależne", więc plik dowodzi:
//   1. ŁADUNKU PIERWSZEGO BEACONA co do znaku: `type`, `name` (stała
//      `GOOGLE_SOURCE_BADGE_EVENT`, po której grupują dashboardy),
//      `entityType`, `entityId` oraz PEŁNE `meta` (`href`, `device`,
//      `variant`, `lang`, `outbound`) - porównaniem `toEqual`, więc nadmiarowy
//      klucz też jest błędem.
//   2. TRZECH STANÓW `entityId`: podany, `null`, pominięty - dwa ostatnie
//      spadają na `"google_preferred_source"`, żeby raport nie miał wiersza
//      bez encji.
//   3. TRZECH STANÓW `window.gtag`: funkcja (woływana RAZ, tą samą nazwą
//      zdarzenia), brak (pierwszy beacon NADAL leci), oraz obecna wartość,
//      która NIE JEST funkcją (pomyłka z `dataLayer` - tablica) - pominięta
//      bez wyjątku.
//   4. GAŁĘZI SSR (`typeof window === "undefined"`) - z dowodem, że to
//      właśnie ona ucina GA4: `gtag` zostaje osiągalny jako globalna funkcja,
//      a mimo to nie jest wołany.
//   5. DEFEKTU: wyjątek z pierwszego beacona zabiera drugi i wychodzi z
//      handlera kliknięcia (patrz `it.fails` na końcu) - to dokładnie
//      zaprzeczenie „podwójnego beacona".
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
//   - `src/lib/analytics/track.ts` - kolejkowanie, `sendBeacon`, bramka zgody
//     RODO i `flush` na `pagehide`. `track` jest tu ATRAPĄ; sprawdzam
//     wyłącznie, Z JAKIM ŁADUNKIEM zostaje wołany. Dzięki temu ZERO sieci i
//     zero zależności od stanu zgód.
//   - `src/lib/analytics/footerTracking.ts` - ten sam wzorzec podwójnego
//     beacona, ale dla linków stopki (i z mapowaniem grupy na nazwę
//     zdarzenia). Osobny moduł, osobna powierzchnia.
//   - `src/lib/seo/__tests__/googleSourceBadge.test.ts` - konfiguracja badge
//     (adresy, logo, klamry, hook). Tutaj `device`/`variant`/`lang` to już
//     tylko wartości wejściowe ładunku.
//   - `src/components/seo/__tests__/GooglePreferredSourceBadge.test.tsx` -
//     test „raportuje kliknięcie jako zdarzenie analityczne" klika w
//     wyrenderowany `<a>` i sprawdza ładunek CZĘŚCIOWO
//     (`objectContaining` na `name`, `entityId`, `device`, `variant`). Nie
//     dotyka GA4 ani razu i nie zna stanów `window.gtag`; tutaj nie renderuję
//     żadnego komponentu, a ładunek sprawdzam DOKŁADNIE.
//   - `e2e/seo.spec.ts` - brak styku: żaden z 15 testów nie klika w badge ani
//     nie sprawdza analityki; tutaj nie ma serwera, DOM-u komponentu ani
//     żądania HTTP.
//   - RLS i RPC tabeli `analytics_events` - domena pgTAP.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GoogleSourceBadgeDevice,
  GoogleSourceBadgeVariant,
} from "@/lib/seo/googleSourceBadge";

const h = vi.hoisted(() => ({ track: vi.fn(), throwFromTrack: false }));

// ZERO SIECI: prawdziwy `track` bije w `/api/public/track` przez `sendBeacon`
// i czyta zgody z localStorage. Atrapa odcina jedno i drugie, a `throwFromTrack`
// pozwala odtworzyć awarię pierwszego beacona bez zmiany produkcji.
vi.mock("@/lib/analytics/track", () => ({
  track: (event: unknown) => {
    h.track(event);
    if (h.throwFromTrack) throw new Error("test: beacon /api/public/track padł");
  },
}));

import {
  GOOGLE_SOURCE_BADGE_EVENT,
  trackGoogleSourceBadgeClick,
  type GoogleSourceBadgeClickPayload,
} from "@/lib/seo/googleSourceBadgeAnalytics";

type GtagFn = (command: "event", name: string, params?: Record<string, unknown>) => void;

/**
 * Dostęp do pola `gtag` na obiekcie okna BEZ rzutowania: interfejs ROZSZERZA
 * `Window`, więc przypisanie `window` jest zgodne strukturalnie (pole jest
 * opcjonalne), a jednocześnie nie jest to typ „słaby" - `as unknown as` nie
 * jest tu do niczego potrzebne.
 */
interface GtagWindow extends Window {
  gtag?: unknown;
}

const gtagWindow = (): GtagWindow => window;

/**
 * Wartości, które lądują na `window.gtag` przez pomyłkę wdrożeniową, a nie
 * przez wczytanie GA4. Tablica jest OTYPOWANA na `unknown` deklaracją, więc
 * żadne rzutowanie w miejscu użycia nie jest potrzebne.
 */
const NOT_A_FUNCTION: ReadonlyArray<readonly [string, unknown]> = [
  ["tablica dataLayer", []],
  ["obiekt", { push: 1 }],
  ["napis", "gtag"],
  ["null", null],
];

/** Wszystkie kombinacje breakpointu i wariantu, jakie może przyjąć badge. */
const DEVICE_VARIANT_MATRIX: ReadonlyArray<
  readonly [GoogleSourceBadgeDevice, GoogleSourceBadgeVariant]
> = [
  ["desktop", "default"],
  ["desktop", "compact"],
  ["desktop", "icon"],
  ["mobile", "default"],
  ["mobile", "compact"],
  ["mobile", "icon"],
];

/** Pełny ładunek kliknięcia z możliwością punktowego nadpisania. */
const payload = (
  patch: Partial<GoogleSourceBadgeClickPayload> = {},
): GoogleSourceBadgeClickPayload => ({
  href: "https://google.com/preferences/source?q=neweuropeanstrategies.com",
  device: "desktop",
  variant: "default",
  lang: "pl",
  ...patch,
});

/** Ładunek, jakiego oczekujemy na wejściu `track()`. */
const expectedTrackEvent = (
  input: GoogleSourceBadgeClickPayload,
  entityId: string,
): Record<string, unknown> => ({
  type: "cta_click",
  name: GOOGLE_SOURCE_BADGE_EVENT,
  entityType: "cta",
  entityId,
  meta: {
    href: input.href,
    device: input.device,
    variant: input.variant,
    lang: input.lang,
    outbound: true,
  },
});

beforeEach(() => {
  h.track.mockClear();
  h.throwFromTrack = false;
  delete gtagWindow().gtag;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete gtagWindow().gtag;
});

describe("stała nazwa zdarzenia", () => {
  it("jest tą samą wartością w OBU beaconach", () => {
    // Nazwa jest kontraktem z dashboardami - zmiana wymaga migracji raportów,
    // więc jest przypięta dosłownie, a nie odczytana z modułu do porównania
    // sama z sobą.
    expect(GOOGLE_SOURCE_BADGE_EVENT).toBe("google_preferred_source_click");
    const gtag = vi.fn();
    gtagWindow().gtag = gtag;
    trackGoogleSourceBadgeClick(payload());
    expect(h.track.mock.calls[0][0]).toMatchObject({ name: "google_preferred_source_click" });
    expect(gtag.mock.calls[0][1]).toBe("google_preferred_source_click");
  });
});

describe("ładunek pierwszego beacona (/api/public/track)", () => {
  it("ma DOKŁADNIE uzgodniony kształt - bez klucza więcej i bez mniej", () => {
    const input = payload({ href: "https://google.com/x", lang: "en-GB", entityId: "post-1" });
    trackGoogleSourceBadgeClick(input);
    expect(h.track).toHaveBeenCalledTimes(1);
    expect(h.track.mock.calls[0][0]).toEqual(expectedTrackEvent(input, "post-1"));
  });

  it.each(DEVICE_VARIANT_MATRIX)(
    "przenosi breakpoint i wariant bez tłumaczenia: %s / %s",
    (device, variant) => {
      const input = payload({ device, variant });
      trackGoogleSourceBadgeClick(input);
      expect(h.track.mock.calls[0][0]).toEqual(
        expectedTrackEvent(input, "google_preferred_source"),
      );
    },
  );

  it("oznacza zdarzenie jako wyjście z serwisu (`outbound`)", () => {
    trackGoogleSourceBadgeClick(payload());
    expect(h.track.mock.calls[0][0]).toMatchObject({ meta: { outbound: true } });
  });
});

describe("entityId - trzy warianty ładunku", () => {
  it("podany id encji trafia do zdarzenia bez zmian", () => {
    trackGoogleSourceBadgeClick(payload({ entityId: "post-42" }));
    expect(h.track.mock.calls[0][0]).toMatchObject({ entityId: "post-42" });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("%s spada na stałą encję, żeby raport nie miał wiersza bez encji", (_case, entityId) => {
    trackGoogleSourceBadgeClick(payload({ entityId }));
    expect(h.track.mock.calls[0][0]).toMatchObject({ entityId: "google_preferred_source" });
  });

  it("pominięcie pola daje ten sam spadek co jawny null", () => {
    const { href, device, variant, lang } = payload();
    trackGoogleSourceBadgeClick({ href, device, variant, lang });
    expect(h.track.mock.calls[0][0]).toMatchObject({ entityId: "google_preferred_source" });
  });
});

describe("drugi beacon (GA4 gtag) - trzy stany window.gtag", () => {
  it("gtag JEST funkcją: wołany RAZ, z własnym słownikiem parametrów GA4", () => {
    const gtag = vi.fn();
    gtagWindow().gtag = gtag;
    const input = payload({ device: "mobile", variant: "compact", lang: "en", entityId: "post-7" });
    trackGoogleSourceBadgeClick(input);
    expect(gtag).toHaveBeenCalledTimes(1);
    // GA4 ma INNE nazwy pól niż nasz `meta` - to celowe (konwencja
    // `link_url`/`language`), więc porównanie jest dosłowne.
    expect(gtag).toHaveBeenCalledWith("event", GOOGLE_SOURCE_BADGE_EVENT, {
      link_url: input.href,
      device: "mobile",
      variant: "compact",
      language: "en",
      outbound: true,
    });
    expect(h.track).toHaveBeenCalledTimes(1);
  });

  it("gtag NIE ISTNIEJE: pierwszy beacon nadal leci, bez wyjątku", () => {
    // Sens „podwójnego beacona": brak zgody marketingowej (a więc brak skryptu
    // GA4) NIE MOŻE zabrać naszego własnego zapisu w analytics_events.
    expect(gtagWindow().gtag).toBeUndefined();
    expect(() => trackGoogleSourceBadgeClick(payload())).not.toThrow();
    expect(h.track).toHaveBeenCalledTimes(1);
  });

  it.each(NOT_A_FUNCTION)(
    "gtag obecny, ale NIE jest funkcją (%s): pomijany bez wyjątku",
    (_case, value) => {
      // Realna pomyłka wdrożeniowa: na `window` ląduje `dataLayer` albo znacznik
      // konsentu zamiast funkcji `gtag`. Wywołanie takiej wartości rzuciłoby
      // `TypeError` W HANDLERZE KLIKNIĘCIA, więc strażnik `typeof === "function"`
      // jest tu warunkiem działania nawigacji, nie kosmetyką.
      gtagWindow().gtag = value;
      expect(() => trackGoogleSourceBadgeClick(payload())).not.toThrow();
      expect(h.track).toHaveBeenCalledTimes(1);
    },
  );
});

describe("gałąź SSR (typeof window === 'undefined')", () => {
  it("bez obiektu okna GA4 jest pominięty, a pierwszy beacon nadal wołany", () => {
    // Dowód, że ucina to WŁAŚNIE strażnik SSR, a nie `typeof w.gtag`:
    // `gtag` zostaje przypisany na obiekcie globalnym (w happy-dom
    // `globalThis === window`), a `vi.stubGlobal` gasi samą referencję
    // `window`. Funkcja jest więc dalej osiągalna, ale kod produkcyjny wychodzi
    // z `gtag()` zanim po nią sięgnie.
    const gtag: GtagFn = vi.fn();
    gtagWindow().gtag = gtag;
    vi.stubGlobal("window", undefined);
    expect(typeof window).toBe("undefined");
    expect(() => trackGoogleSourceBadgeClick(payload())).not.toThrow();
    expect(gtag).not.toHaveBeenCalled();
    expect(h.track).toHaveBeenCalledTimes(1);
  });
});

describe("awaria pierwszego beacona - stan faktyczny i defekt", () => {
  it("STAN FAKTYCZNY: wyjątek z track() wychodzi na zewnątrz i GA4 nie dostaje nic", () => {
    // Przypięcie, nie życzenie. Kolejność w produkcji to `track(...)` a POTEM
    // `gtag()?.(...)`, bez żadnego `try`, więc porażka pierwszego wywołania
    // przerywa całą funkcję.
    const gtag = vi.fn();
    gtagWindow().gtag = gtag;
    h.throwFromTrack = true;
    expect(() => trackGoogleSourceBadgeClick(payload())).toThrow(
      "test: beacon /api/public/track padł",
    );
    expect(h.track).toHaveBeenCalledTimes(1);
    expect(gtag).not.toHaveBeenCalled();
  });

  it.fails("DEFEKT: awaria pierwszego beacona zabiera drugi i wychodzi z handlera", () => {
    // KONSEKWENCJA DLA UŻYTKOWNIKA: ta funkcja jest wołana WPROST z `onClick`
    // linku badge (`GooglePreferredSourceBadge`), a badge stoi w stopce i przy
    // każdym artykule. `track()` czyta `localStorage`/`sessionStorage`
    // (zgoda RODO, identyfikator sesji) - w przeglądarce z zablokowanym
    // magazynem (tryb prywatny, polityka firmowa, wygaszony origin) odczyt
    // rzuca. Wtedy dzieją się DWIE złe rzeczy naraz:
    //   * GA4 nie dostaje zdarzenia, choć skrypt jest wczytany i zgoda jest -
    //     czyli „podwójny beacon" przestaje być podwójny dokładnie w chwili,
    //     w której druga ścieżka miała ratować pierwszą;
    //   * niewyłapany wyjątek leci z handlera kliknięcia i trafia do
    //     `window.onerror` (a w panelach z granicą błędu - do niej), więc
    //     kliknięcie w link „Preferowane źródło" zgłasza błąd aplikacji.
    // NAPRAWA (w produkcji, nie w teście): oba beacony w osobnych `try`/`catch`
    // - analityka jest fire-and-forget i nie ma prawa wywrócić nawigacji. Po
    // takiej zmianie ten `it.fails` natychmiast się wywali, a test „STAN
    // FAKTYCZNY" wyżej trzeba będzie przepisać na oczekiwanie wywołania GA4.
    h.throwFromTrack = true;
    expect(() => trackGoogleSourceBadgeClick(payload())).not.toThrow();
  });
});
