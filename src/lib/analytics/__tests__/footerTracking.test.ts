// PO CO TEN PLIK. `src/lib/analytics/footerTracking.ts` (76 linii) wchodzi tu
// z ZEREM wykonanych linii, a jest jedynym nadawca zdarzen, ktore czyta
// `getFooterAnalytics` (zakladka „stopka" w panelu admin/analytics). Modul robi
// dwie rzeczy i obie sa ciche w razie bledu: (1) mapuje klikniecie na JEDNA
// z trzech stabilnych nazw zdarzenia, po ktorych dashboard grupuje wiersze bez
// migracji, (2) bije PODWOJNIE - wlasnym beaconem do `/api/public/track` oraz
// przez `window.gtag` do GA4.
//
// Dlaczego to nie jest test „czy sie wywolalo":
//
//  1. BRAMKA ZGODY RODO JEST FUNKCJA, NIE DEKORACJA. Beacon do
//     `/api/public/track` ma NIE POWSTAC bez zgody `analytics`. Dlatego w tym
//     pliku `track()` i `hasCategoryConsent()` biegna PRAWDZIWE - atrapa
//     `track` (wygodna, uzyta w tescie badge Google) dowiodlaby wylacznie tego,
//     ze funkcja zostala zawolana, czyli akurat nie tego, co jest tu wymogiem
//     prawnym. Atrapowana jest jedynie GRANICA: transport `sendBeaconPayload`
//     (zero sieci) i klient Supabase (zero bazy). localStorage, sessionStorage,
//     cookie i sygnal GPC dzialaja naprawde.
//  2. NAZWA ZDARZENIA JEST KONTRAKTEM MIEDZY MODULAMI. Pomylka w mapowaniu
//     (`legal` kontra „href zawiera newsletter") nie wywala niczego - po prostu
//     przestawia klikniecia do innego kubelka w panelu i zafalszowuje raport.
//     Testy trzymaja rowniez PIERWSZENSTWO: grupa `legal` wygrywa z heurystyka
//     po adresie.
//  3. PODWOJNY BEACON MA BYC NIEZALEZNY. Brak `window.gtag` (GA4 niewczytane)
//     nie moze zabrac pierwszego beacona, a `dataLayer` podstawiony pod `gtag`
//     (klasyczna pomylka wdrozeniowa - tablica zamiast funkcji) nie moze
//     wywrocic handlera klikniecia.
//
// CZEGO SWIADOMIE NIE DUBLUJE:
//  - `src/lib/ads/__tests__/consent.test.tsx` - katalog zgod, migracje kluczy,
//    tryb podgladu i pelna klamra GPC. Tutaj zgoda jest WEJSCIEM, nie tematem.
//  - `src/lib/seo/__tests__/googleSourceBadgeAnalytics.test.ts` - ten sam wzorzec
//    podwojnego beacona dla badge Google, ale tam `track` jest atrapa.
//  - `footerAnalyticsFunctions.test.ts` - odbior i agregacja tych zdarzen.
//
// RODO: zadnych prawdziwych danych - adresy zewnetrzne wylacznie w example.com.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GPC_COOKIE, GPC_COOKIE_VALUE } from "@/lib/consent/gpc";

const beacons = vi.hoisted(() => ({
  wyslane: [] as Array<{ endpoint: string; payload: unknown }>,
}));

// ZERO SIECI: `sendBeaconPayload` to jedyne wyjscie transportowe track.ts.
vi.mock("@/lib/observability/report", () => ({
  sendBeaconPayload: (endpoint: string, payload: unknown) => {
    beacons.wyslane.push({ endpoint, payload });
    return true;
  },
}));

// ZERO BAZY: `@/lib/ads/consent` importuje klienta przegladarki na poziomie
// modulu (sesja + synchronizacja `profiles.prefs`). Sama logika zgody biegnie
// prawdziwa - podmieniona jest wylacznie granica.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: async () => ({ data: [], error: null }),
    from: () => ({ update: () => ({ eq: async () => ({ data: null, error: null }) }) }),
  },
}));

import { flush } from "@/lib/analytics/track";
import { trackFooterLink, trackFooterNewsletterSubmit } from "../footerTracking";

const STORAGE_KEY = "consent:v2";

type GtagFn = (command: "event", name: string, params?: Record<string, unknown>) => void;

/** Dostep do `window.gtag` BEZ rzutowania - interfejs rozszerza `Window`. */
interface GtagWindow extends Window {
  gtag?: unknown;
}
const oknoGtag = (): GtagWindow => window;

interface WywolanieGtag {
  readonly name: string;
  readonly params: Record<string, unknown> | undefined;
}

/** Zapisuje wywolania GA4 i podstawia sie pod `window.gtag`. */
function podstawGtag(): WywolanieGtag[] {
  const zapis: WywolanieGtag[] = [];
  const fn: GtagFn = (_command, name, params) => {
    zapis.push({ name, params });
  };
  oknoGtag().gtag = fn;
  return zapis;
}

function zapiszZgode(cats: Partial<Record<string, boolean>>): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 2,
      ts: Date.now(),
      categories: {
        necessary: true,
        functional: false,
        analytics: false,
        marketing: false,
        ...cats,
      },
    }),
  );
}

function wyczyscCiasteczka(): void {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

/** Zdarzenia, ktore realnie wyszly z kolejki po wymuszonym flushu. */
function wyslaneZdarzenia(): Array<Record<string, unknown>> {
  flush(true);
  return beacons.wyslane.flatMap((b) => {
    const payload = b.payload as { events?: Array<Record<string, unknown>> };
    return payload.events ?? [];
  });
}

beforeEach(() => {
  // Kolejka track.ts to stan MODULU - resztka z poprzedniego testu udawalaby
  // beacon wyslany przez ten test. Najpierw drenaz, dopiero potem czyszczenie.
  flush(true);
  beacons.wyslane.length = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  wyczyscCiasteczka();
  delete oknoGtag().gtag;
});

afterEach(() => {
  flush(true);
  beacons.wyslane.length = 0;
  wyczyscCiasteczka();
  delete oknoGtag().gtag;
  vi.unstubAllGlobals();
});

describe("trackFooterLink - bramka zgody analytics", () => {
  it("bez zapisanej decyzji NIE powstaje zaden beacon", () => {
    trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" });
    flush(true);
    expect(beacons.wyslane).toEqual([]);
  });

  it("odmowa zgody analytics NIE wysyla nic, mimo zgody na inne kategorie", () => {
    zapiszZgode({ functional: true, marketing: true, analytics: false });
    trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" });
    flush(true);
    expect(beacons.wyslane).toEqual([]);
  });

  it("zgoda analytics otwiera beacon na wlasciwy endpoint", () => {
    zapiszZgode({ analytics: true });
    trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" });
    flush(true);
    expect(beacons.wyslane).toHaveLength(1);
    expect(beacons.wyslane[0].endpoint).toBe("/api/public/track");
  });

  it("aktywny sygnal GPC klamruje zgode analytics - zapis w localStorage nie wystarcza", () => {
    zapiszZgode({ analytics: true, marketing: true });
    document.cookie = `${GPC_COOKIE}=${GPC_COOKIE_VALUE}; path=/`;
    trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" });
    flush(true);
    expect(beacons.wyslane).toEqual([]);
  });

  it("cofniecie zgody miedzy kliknieciami zatrzymuje kolejne beacony", () => {
    zapiszZgode({ analytics: true });
    trackFooterLink({ href: "/pierwsze", label: "Pierwsze", group: "editorial" });
    zapiszZgode({ analytics: false });
    trackFooterLink({ href: "/drugie", label: "Drugie", group: "editorial" });

    const zdarzenia = wyslaneZdarzenia();
    expect(zdarzenia.map((e) => e.entity_id)).toEqual(["/pierwsze"]);
  });
});

describe("trackFooterLink - ladunek pierwszego beacona", () => {
  beforeEach(() => {
    zapiszZgode({ analytics: true });
  });

  it("niesie typ, nazwe, encje i PELNE meta - nadmiarowy klucz tez jest bledem", () => {
    trackFooterLink({
      href: "https://example.com/partner",
      label: "Partner",
      group: "institute",
      external: true,
    });

    const [zdarzenie] = wyslaneZdarzenia();
    expect(zdarzenie).toMatchObject({
      type: "cta_click",
      name: "footer_link_click",
      entity_type: "menu",
      entity_id: "https://example.com/partner",
    });
    expect(zdarzenie.meta).toEqual({
      href: "https://example.com/partner",
      label: "Partner",
      group: "institute",
      external: true,
    });
  });

  it("pominiete `external` zapisuje sie jako false, a nie undefined", () => {
    trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" });
    const [zdarzenie] = wyslaneZdarzenia();
    expect(zdarzenie.meta).toEqual({
      href: "/analizy",
      label: "Analizy",
      group: "editorial",
      external: false,
    });
  });

  it("grupa `unknown` przechodzi do meta bez podmiany na inna wartosc", () => {
    trackFooterLink({ href: "/cokolwiek", label: "Cokolwiek", group: "unknown" });
    const [zdarzenie] = wyslaneZdarzenia();
    expect(zdarzenie.meta).toMatchObject({ group: "unknown" });
  });
});

describe("trackFooterLink - mapowanie nazwy zdarzenia", () => {
  beforeEach(() => {
    zapiszZgode({ analytics: true });
  });

  it.each([
    [
      "grupa legal",
      { href: "/regulamin", label: "Regulamin", group: "legal" as const },
      "footer_legal_click",
    ],
    [
      "adres z newsletter",
      { href: "/newsletter", label: "Newsletter", group: "community" as const },
      "footer_newsletter_click",
    ],
    [
      "adres polskiej zapisowki",
      { href: "/dolacz-do-newslettera", label: "Dolacz", group: "community" as const },
      "footer_newsletter_click",
    ],
    [
      "zwykly link",
      { href: "/analizy", label: "Analizy", group: "editorial" as const },
      "footer_link_click",
    ],
  ])("%s mapuje sie na %s", (_nazwa, payload, oczekiwane) => {
    trackFooterLink(payload);
    const [zdarzenie] = wyslaneZdarzenia();
    expect(zdarzenie.name).toBe(oczekiwane);
  });

  it("grupa legal WYGRYWA z heurystyka po adresie", () => {
    trackFooterLink({
      href: "/newsletter-regulamin",
      label: "Regulamin newslettera",
      group: "legal",
    });
    const [zdarzenie] = wyslaneZdarzenia();
    expect(zdarzenie.name).toBe("footer_legal_click");
  });

  it("heurystyka lapie newsletter takze w srodku sciezki i w adresie zewnetrznym", () => {
    trackFooterLink({
      href: "https://example.com/pl/newsletter/zapis",
      label: "Zapis",
      group: "community",
    });
    const [zdarzenie] = wyslaneZdarzenia();
    expect(zdarzenie.name).toBe("footer_newsletter_click");
  });
});

describe("trackFooterLink - drugi beacon do GA4", () => {
  it("woła gtag RAZ, ta sama nazwa zdarzenia i wlasnym zestawem parametrow", () => {
    zapiszZgode({ analytics: true });
    const ga = podstawGtag();

    trackFooterLink({
      href: "https://example.com/partner",
      label: "Partner",
      group: "institute",
      external: true,
    });

    expect(ga).toEqual([
      {
        name: "footer_link_click",
        params: {
          link_url: "https://example.com/partner",
          link_text: "Partner",
          link_group: "institute",
          outbound: true,
        },
      },
    ]);
  });

  it("brak GA4 na stronie nie zabiera pierwszego beacona ani nie rzuca", () => {
    zapiszZgode({ analytics: true });
    expect(oknoGtag().gtag).toBeUndefined();

    expect(() =>
      trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" }),
    ).not.toThrow();
    expect(wyslaneZdarzenia()).toHaveLength(1);
  });

  it("`gtag` podstawione tablica (pomylka z dataLayer) jest pomijane bez wyjatku", () => {
    zapiszZgode({ analytics: true });
    const nieFunkcja: unknown[] = [];
    oknoGtag().gtag = nieFunkcja;

    expect(() =>
      trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" }),
    ).not.toThrow();
    expect(nieFunkcja).toEqual([]);
    expect(wyslaneZdarzenia()).toHaveLength(1);
  });

  it("na serwerze (brak `window`) nie leci ani beacon, ani GA4", () => {
    zapiszZgode({ analytics: true });
    const ga = podstawGtag();
    vi.stubGlobal("window", undefined);

    expect(() =>
      trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" }),
    ).not.toThrow();

    vi.unstubAllGlobals();
    expect(ga).toEqual([]);
    expect(wyslaneZdarzenia()).toEqual([]);
  });
});

describe("trackFooterNewsletterSubmit", () => {
  beforeEach(() => {
    zapiszZgode({ analytics: true });
  });

  it("bez zgody analytics nie powstaje beacon konwersji", () => {
    zapiszZgode({ analytics: false });
    trackFooterNewsletterSubmit("success");
    flush(true);
    expect(beacons.wyslane).toEqual([]);
  });

  it("niesie stala nazwe konwersji i encje CTA stopki", () => {
    trackFooterNewsletterSubmit("success");
    const [zdarzenie] = wyslaneZdarzenia();
    expect(zdarzenie).toMatchObject({
      type: "cta_click",
      name: "footer_newsletter_signup",
      entity_type: "cta",
      entity_id: "footer_newsletter",
    });
    expect(zdarzenie.meta).toEqual({ status: "success" });
  });

  it.each(["success", "error", "throttled"] as const)("zapisuje status %s", (status) => {
    trackFooterNewsletterSubmit(status);
    const [zdarzenie] = wyslaneZdarzenia();
    expect(zdarzenie.meta).toMatchObject({ status });
  });

  it("dodatkowe meta jest dolaczane obok statusu", () => {
    trackFooterNewsletterSubmit("error", { reason: "invalid_email", attempt: 2 });
    const [zdarzenie] = wyslaneZdarzenia();
    expect(zdarzenie.meta).toEqual({ status: "error", reason: "invalid_email", attempt: 2 });
  });

  it("dodatkowe meta NIE moze nadpisac statusu - kolejnosc rozstrzyga na korzysc wywolania", () => {
    trackFooterNewsletterSubmit("error", { status: "success" });
    const [zdarzenie] = wyslaneZdarzenia();
    // `{ status, ...meta }` - rozwiniecie idzie PO statusie, wiec wygrywa meta.
    // Test utrwala to, co modul robi naprawde, zeby zmiana kolejnosci byla widoczna.
    expect(zdarzenie.meta).toEqual({ status: "success" });
  });

  it("mirroruje konwersje do GA4 z tym samym statusem", () => {
    const ga = podstawGtag();
    trackFooterNewsletterSubmit("throttled", { source: "footer" });
    expect(ga).toEqual([
      { name: "footer_newsletter_signup", params: { status: "throttled", source: "footer" } },
    ]);
  });

  it("brak GA4 nie zabiera beacona konwersji", () => {
    expect(() => trackFooterNewsletterSubmit("success")).not.toThrow();
    expect(wyslaneZdarzenia()).toHaveLength(1);
  });
});

describe("footerTracking - defekt: cofnieta zgoda zatrzymuje tylko JEDEN z dwoch beaconow", () => {
  // Naglowek modulu uzasadnia zgodnosc z RODO tak: „track() sam sprawdza
  // analytics-consent, a window.gtag istnieje tylko gdy uzytkownik wyrazil
  // zgode marketingowa". Drugie zalozenie jest nieprawdziwe w DWOCH miejscach:
  //  * GA4 wstrzykuje `loadAnalytics()` w `ConsentScriptInjector.tsx`, czyli
  //    kategoria ANALYTICS, nie marketingowa;
  //  * jego sprzatanie (`removeMarked`) usuwa ELEMENT <script>, a nie globalna
  //    funkcje `window.gtag`, ktora ten skrypt zdefiniowal - po cofnieciu zgody
  //    (albo po wlaczeniu GPC w trakcie sesji) `gtag` nadal jest funkcja.
  // Skutek: wlasny beacon milknie zgodnie z prawem, a GA4 dostaje zdarzenie
  // dalej. Bramka zgody musi byc PRZED oboma nadaniami, nie tylko przed jednym.
  it.fails("cofnieta zgoda analytics zatrzymuje TAKZE zdarzenie GA4", () => {
    zapiszZgode({ analytics: false });
    const ga = podstawGtag();

    trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" });

    expect(wyslaneZdarzenia()).toEqual([]);
    expect(ga).toEqual([]);
  });

  it.fails("aktywny sygnal GPC zatrzymuje TAKZE zdarzenie GA4", () => {
    zapiszZgode({ analytics: true, marketing: true });
    document.cookie = `${GPC_COOKIE}=${GPC_COOKIE_VALUE}; path=/`;
    const ga = podstawGtag();

    trackFooterNewsletterSubmit("success");

    expect(wyslaneZdarzenia()).toEqual([]);
    expect(ga).toEqual([]);
  });
});
