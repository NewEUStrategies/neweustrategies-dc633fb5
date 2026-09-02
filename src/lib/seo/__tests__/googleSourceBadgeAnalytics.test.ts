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
//   5. NIEZALEŻNOŚCI OBU BEACONÓW - W OBIE STRONY: rzucający `track()` NIE
//      zabiera GA4, rzucający `gtag` NIE unieważnia zapisu w
//      `analytics_events`, a ŻADEN z nich nie wychodzi wyjątkiem do
//      wołającego. Tak ma być, bo ta funkcja jest wołana WPROST z `onClick`
//      linku wychodzącego (`GooglePreferredSourceBadge`): analityka jest
//      fire-and-forget i kliknięcie ma prowadzić do nawigacji, a nie do
//      `window.onerror`. Mechanizm dowodu ten sam co przed naprawą - atrapa
//      `track` z flagą `throwFromTrack` odtwarza awarię pierwszego kanału
//      (zablokowany magazyn w trybie prywatnym, `sendBeacon` po przekroczeniu
//      limitu ładunku) bez dotykania sieci.
//   6. RODO PO NAPRAWIE: granica błędu NIE jest obejściem bramki zgody. Moduł
//      nie ma własnego transportu (żadnego `fetch`, żadnego `sendBeacon` - ani
//      przed wyjątkiem, ani po nim), więc jedyną drogą do `analytics_events`
//      zostaje `track()` z bramką `hasAnalyticsConsent()`; nie tworzy też sam
//      `window.gtag` ani `dataLayer`, więc GA4 pozostaje nieosiągalne, dopóki
//      CMP nie wczyta skryptu.
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
  /** Sprawdzane w bloku RODO: moduł nie ma prawa sam zakładać kolejki GA4. */
  dataLayer?: unknown;
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

describe("niezależność obu beaconów - granica błędu w OBIE strony", () => {
  // PO CO TE PRZYPADKI. Do naprawy kod robił `track({...})` a POTEM
  // `gtag()?.(...)` bez żadnego `try`, więc porażka pierwszego wywołania
  // przerywała funkcję: GA4 nie dostawał nic ORAZ wyjątek wychodził z handlera
  // kliknięcia. Dwie złe rzeczy naraz - „podwójny beacon” przestawał być
  // podwójny dokładnie w chwili, w której druga ścieżka miała ratować
  // pierwszą, a kliknięcie w link „Preferowane źródło” zgłaszało błąd
  // aplikacji (`window.onerror`, a w panelach - granica błędu Reacta).
  // Produkcja trzyma dziś KAŻDE nadanie w osobnym `try`/`catch`, więc oba
  // kierunki awarii są tu przypięte osobno.
  const RZUCA_GTAG = "test: gtag GA4 padł";

  /** `gtag`, który rejestruje wywołanie i DOPIERO POTEM rzuca. */
  const gtagRzucajacy = (): ReturnType<typeof vi.fn> => {
    const gtag = vi.fn(() => {
      throw new Error(RZUCA_GTAG);
    });
    gtagWindow().gtag = gtag;
    return gtag;
  };

  it("rzucający track() NIE zabiera GA4 - drugi beacon leci z pełnym ładunkiem", () => {
    const gtag = vi.fn();
    gtagWindow().gtag = gtag;
    h.throwFromTrack = true;
    const input = payload({ device: "mobile", variant: "icon", lang: "de", entityId: "post-9" });

    trackGoogleSourceBadgeClick(input);

    expect(h.track).toHaveBeenCalledTimes(1);
    // Ładunek GA4 co do znaku: awaria pierwszego kanału nie ma prawa zubożyć
    // drugiego, bo to on zostaje jedynym pomiarem tego kliknięcia.
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith("event", GOOGLE_SOURCE_BADGE_EVENT, {
      link_url: input.href,
      device: "mobile",
      variant: "icon",
      language: "de",
      outbound: true,
    });
  });

  it("rzucający gtag NIE unieważnia zapisu przez track() - ładunek dojeżdża cały", () => {
    const gtag = gtagRzucajacy();
    const input = payload({ href: "https://google.com/y", lang: "en-GB", entityId: "post-3" });

    trackGoogleSourceBadgeClick(input);

    expect(gtag).toHaveBeenCalledTimes(1);
    expect(h.track).toHaveBeenCalledTimes(1);
    expect(h.track.mock.calls[0][0]).toEqual(expectedTrackEvent(input, "post-3"));
  });

  it.each([
    ["rzuca tylko track()", true, false],
    ["rzuca tylko gtag", false, true],
    ["rzucają OBA naraz", true, true],
  ])("%s: wołający nie widzi wyjątku, a każdy sprawny kanał nadaje", (_case, zTrack, zGtag) => {
    // Klucz do konsekwencji dla użytkownika: `expect(...).not.toThrow()` jest
    // tu odpowiednikiem „kliknięcie prowadzi do nawigacji”. Trzeci wiersz
    // (oba kanały padają) pilnuje, że granice są NIEZALEŻNE, a nie jedna
    // wspólna - wspólny `try` przeszedłby dwa pierwsze wiersze i przewrócił
    // się dopiero na trzecim, gdyby drugi `catch` nie istniał.
    h.throwFromTrack = zTrack;
    const gtag = zGtag ? gtagRzucajacy() : vi.fn();
    if (!zGtag) gtagWindow().gtag = gtag;

    expect(() => trackGoogleSourceBadgeClick(payload())).not.toThrow();

    expect(h.track).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledTimes(1);
  });
});

describe("RODO - granica błędu nie jest obejściem bramki zgody", () => {
  // Naprawa dodała `catch`, a nie kanał awaryjny. Te przypadki pilnują, że po
  // zmianie moduł NADAL nie ma jak ominąć dwóch bramek zgody, które leżą poza
  // nim: `hasAnalyticsConsent()` wewnątrz prawdziwego `track()` oraz sam fakt
  // wczytania skryptu GA4 przez CMP (dopóki go nie ma, `window.gtag` nie
  // istnieje). Dlatego szpieguję WSZYSTKIE wyjścia sieciowe przeglądarki:
  // gdyby ktoś „poprawił” połknięty błąd na ponowną próbę przez `fetch` albo
  // `navigator.sendBeacon`, zdarzenie poszłoby do serwera bez zgody.
  const podstawWyjsciaSieciowe = (): {
    fetch: ReturnType<typeof vi.fn>;
    sendBeacon: ReturnType<typeof vi.fn>;
  } => {
    const fetchSpy = vi.fn();
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("fetch", fetchSpy);
    // Moduł nie dotyka `navigator`, więc podstawienie całego obiektu jest
    // bezpieczne, a `vi.unstubAllGlobals()` w `afterEach` je zdejmuje.
    vi.stubGlobal("navigator", { sendBeacon });
    return { fetch: fetchSpy, sendBeacon };
  };

  it("jedyną drogą do analytics_events jest track() - zero własnej sieci", () => {
    const siec = podstawWyjsciaSieciowe();
    gtagWindow().gtag = vi.fn();

    trackGoogleSourceBadgeClick(payload());

    expect(h.track).toHaveBeenCalledTimes(1);
    expect(siec.fetch).not.toHaveBeenCalled();
    expect(siec.sendBeacon).not.toHaveBeenCalled();
  });

  it("po awarii track() NIE ma ponownej próby innym kanałem", () => {
    const siec = podstawWyjsciaSieciowe();
    h.throwFromTrack = true;

    expect(() => trackGoogleSourceBadgeClick(payload())).not.toThrow();

    expect(h.track).toHaveBeenCalledTimes(1);
    expect(siec.fetch).not.toHaveBeenCalled();
    expect(siec.sendBeacon).not.toHaveBeenCalled();
  });

  it("moduł nie tworzy sam window.gtag ani dataLayer - GA4 zostaje niedostępne", () => {
    // Bez zgody marketingowej CMP nie wstrzykuje snippetu GA4, więc ani
    // `window.gtag`, ani kolejka `dataLayer` nie istnieją. Nadawca nie ma
    // prawa ich założyć „na wszelki wypadek” - byłby to pomiar przed zgodą.
    delete gtagWindow().dataLayer;
    expect(gtagWindow().gtag).toBeUndefined();

    trackGoogleSourceBadgeClick(payload());

    expect(gtagWindow().gtag).toBeUndefined();
    expect(gtagWindow().dataLayer).toBeUndefined();
    expect(h.track).toHaveBeenCalledTimes(1);
  });
});
