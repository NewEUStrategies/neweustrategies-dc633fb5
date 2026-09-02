// PO CO TEN PLIK. `src/lib/analytics/footerTracking.ts` (76 linii) wchodzi tu
// z ZEREM wykonanych linii, a jest jedynym nadawcą zdarzeń, które czyta
// `getFooterAnalytics` (zakładka „stopka" w panelu admin/analytics). Moduł robi
// dwie rzeczy i obie są ciche w razie błędu: (1) mapuje kliknięcie na JEDNĄ
// z trzech stabilnych nazw zdarzenia, po których dashboard grupuje wiersze bez
// migracji, (2) bije PODWÓJNIE - własnym beaconem do `/api/public/track` oraz
// przez `window.gtag` do GA4.
//
// Dlaczego to nie jest test „czy się wywołało":
//
//  1. BRAMKA ZGODY RODO JEST FUNKCJĄ, NIE DEKORACJĄ. Bez zgody `analytics` ma
//     NIE POWSTAĆ ani beacon do `/api/public/track`, ani nadanie do GA4 -
//     bramka obejmuje OBA kanały wyjścia (ostatni blok w tym pliku). Dlatego w tym
//     pliku `track()` i `hasCategoryConsent()` biegną PRAWDZIWE - atrapa
//     `track` (wygodna, użyta w teście badge Google) dowiodłaby wyłącznie tego,
//     że funkcja została zawołana, czyli akurat nie tego, co jest tu wymogiem
//     prawnym. Atrapowana jest jedynie GRANICA: transport `sendBeaconPayload`
//     (zero sieci) i klient Supabase (zero bazy). localStorage, sessionStorage,
//     cookie i sygnał GPC działają naprawdę.
//  2. NAZWA ZDARZENIA JEST KONTRAKTEM MIĘDZY MODUŁAMI. Pomyłka w mapowaniu
//     (`legal` kontra „href zawiera newsletter") nie wywala niczego - po prostu
//     przestawia kliknięcia do innego kubelka w panelu i zafałszowuje raport.
//     Testy trzymają również PIERWSZEŃSTWO: grupa `legal` wygrywa z heurystyką
//     po adresie.
//  3. PODWÓJNY BEACON MA BYĆ NIEZALEŻNY - I NIE TYLKO WTEDY, GDY DRUGI KANAŁ
//     PO PROSTU NIE ISTNIEJE. Brak `window.gtag` (GA4 niewczytane) nie może
//     zabrać pierwszego beacona, a `dataLayer` podstawiony pod `gtag`
//     (klasyczna pomyłka wdrożeniowa - tablica zamiast funkcji) nie może
//     wywrócić handlera kliknięcia. Osobny, ostatni blok pilnuje mocniejszego
//     przypadku: kanał ISTNIEJE i RZUCA. Bramka `gtagIfConsented()` odpowiada
//     wyłącznie za to, CZY nadajemy - o tym, co się dzieje, gdy nadanie padnie
//     w środku, rozstrzygają dziś dwie OSOBNE granice błędu w module
//     produkcyjnym (`fireBeacon`), a ten plik trzyma je w obie strony.
//
// CZEGO ŚWIADOMIE NIE DUBLUJĘ:
//  - `src/lib/ads/__tests__/consent.test.tsx` - katalog zgód, migracje kluczy,
//    tryb podglądu i pełna klamra GPC. Tutaj zgoda jest WEJŚCIEM, nie tematem.
//  - `src/lib/seo/__tests__/googleSourceBadgeAnalytics.test.ts` - ten sam wzorzec
//    podwójnego beacona dla badge Google, ale tam `track` jest atrapą.
//  - `footerAnalyticsFunctions.test.ts` - odbiór i agregacja tych zdarzeń.
//
// RODO: żadnych prawdziwych danych - adresy zewnętrzne wyłącznie w example.com.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GPC_COOKIE, GPC_COOKIE_VALUE } from "@/lib/consent/gpc";

const beacons = vi.hoisted(() => ({
  wyslane: [] as Array<{ endpoint: string; payload: unknown }>,
  /** Odtwarza rzucający `navigator.sendBeacon` (przekroczony limit ładunku). */
  rzucaj: false,
  /** Licznik realnych rzutów transportu - pilnuje, że test nie jest pusty. */
  rzuty: 0,
}));

/** Komunikat rzucającego transportu (`sendBeacon` po przekroczeniu limitu). */
const RZUCA_TRANSPORT = "test: sendBeacon padl na limicie ladunku";

// ZERO SIECI: `sendBeaconPayload` to jedyne wyjście transportowe track.ts.
// Flaga `rzucaj` pozwala odtworzyć awarię PIERWSZEGO beacona bez zmiany
// produkcji: `track()` woła `flush()` W SWOIM WNĘTRZU, gdy bufor dobije do
// `MAX_BATCH`, więc rzucający transport pada wewnątrz `track()`, a nie po nim.
vi.mock("@/lib/observability/report", () => ({
  sendBeaconPayload: (endpoint: string, payload: unknown) => {
    if (beacons.rzucaj) {
      beacons.rzuty += 1;
      throw new Error(RZUCA_TRANSPORT);
    }
    beacons.wyslane.push({ endpoint, payload });
    return true;
  },
}));

// ZERO BAZY: `@/lib/ads/consent` importuje klienta przeglądarki na poziomie
// modułu (sesja + synchronizacja `profiles.prefs`). Sama logika zgody biegnie
// prawdziwa - podmieniona jest wyłącznie granica.
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

/** Dostęp do `window.gtag` BEZ rzutowania - interfejs rozszerza `Window`. */
interface GtagWindow extends Window {
  gtag?: unknown;
}
const oknoGtag = (): GtagWindow => window;

interface WywolanieGtag {
  readonly name: string;
  readonly params: Record<string, unknown> | undefined;
}

/** Zapisuje wywołania GA4 i podstawia się pod `window.gtag`. */
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

/** Zdarzenia, które realnie wyszły z kolejki po wymuszonym flushu. */
function wyslaneZdarzenia(): Array<Record<string, unknown>> {
  flush(true);
  return beacons.wyslane.flatMap((b) => {
    const payload = b.payload as { events?: Array<Record<string, unknown>> };
    return payload.events ?? [];
  });
}

beforeEach(() => {
  // Flaga gaśnie PRZED drenażem: rzucający transport zostawiony z poprzedniego
  // testu wywróciłby sam hook, a nie test, który go włączył.
  beacons.rzucaj = false;
  beacons.rzuty = 0;
  // Kolejka track.ts to stan MODUŁU - resztka z poprzedniego testu udawałaby
  // beacon wysłany przez ten test. Najpierw drenaż, dopiero potem czyszczenie.
  flush(true);
  beacons.wyslane.length = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  wyczyscCiasteczka();
  delete oknoGtag().gtag;
});

afterEach(() => {
  beacons.rzucaj = false;
  flush(true);
  beacons.wyslane.length = 0;
  wyczyscCiasteczka();
  delete oknoGtag().gtag;
  vi.unstubAllGlobals();
});

describe("trackFooterLink - bramka zgody analytics", () => {
  it("bez zapisanej decyzji NIE powstaje żaden beacon", () => {
    trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" });
    flush(true);
    expect(beacons.wyslane).toEqual([]);
  });

  it("odmowa zgody analytics NIE wysyła nic, mimo zgody na inne kategorie", () => {
    zapiszZgode({ functional: true, marketing: true, analytics: false });
    trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" });
    flush(true);
    expect(beacons.wyslane).toEqual([]);
  });

  it("zgoda analytics otwiera beacon na właściwy endpoint", () => {
    zapiszZgode({ analytics: true });
    trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" });
    flush(true);
    expect(beacons.wyslane).toHaveLength(1);
    expect(beacons.wyslane[0].endpoint).toBe("/api/public/track");
  });

  it("aktywny sygnał GPC klamruje zgodę analytics - zapis w localStorage nie wystarcza", () => {
    zapiszZgode({ analytics: true, marketing: true });
    document.cookie = `${GPC_COOKIE}=${GPC_COOKIE_VALUE}; path=/`;
    trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" });
    flush(true);
    expect(beacons.wyslane).toEqual([]);
  });

  it("cofnięcie zgody między kliknięciami zatrzymuje kolejne beacony", () => {
    zapiszZgode({ analytics: true });
    trackFooterLink({ href: "/pierwsze", label: "Pierwsze", group: "editorial" });
    zapiszZgode({ analytics: false });
    trackFooterLink({ href: "/drugie", label: "Drugie", group: "editorial" });

    const zdarzenia = wyslaneZdarzenia();
    expect(zdarzenia.map((e) => e.entity_id)).toEqual(["/pierwsze"]);
  });
});

describe("trackFooterLink - ładunek pierwszego beacona", () => {
  beforeEach(() => {
    zapiszZgode({ analytics: true });
  });

  it("niesie typ, nazwę, encję i PEŁNE meta - nadmiarowy klucz też jest błędem", () => {
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

  it("pominięte `external` zapisuje się jako false, a nie undefined", () => {
    trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" });
    const [zdarzenie] = wyslaneZdarzenia();
    expect(zdarzenie.meta).toEqual({
      href: "/analizy",
      label: "Analizy",
      group: "editorial",
      external: false,
    });
  });

  it("grupa `unknown` przechodzi do meta bez podmiany na inną wartość", () => {
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
  ])("%s mapuje się na %s", (_nazwa, payload, oczekiwane) => {
    trackFooterLink(payload);
    const [zdarzenie] = wyslaneZdarzenia();
    expect(zdarzenie.name).toBe(oczekiwane);
  });

  it("grupa legal WYGRYWA z heurystyką po adresie", () => {
    trackFooterLink({
      href: "/newsletter-regulamin",
      label: "Regulamin newslettera",
      group: "legal",
    });
    const [zdarzenie] = wyslaneZdarzenia();
    expect(zdarzenie.name).toBe("footer_legal_click");
  });

  it("heurystyka łapie newsletter także w środku ścieżki i w adresie zewnętrznym", () => {
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
  it("woła gtag RAZ, tą samą nazwą zdarzenia i własnym zestawem parametrów", () => {
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

  it("`gtag` podstawione tablicą (pomyłka z dataLayer) jest pomijane bez wyjątku", () => {
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

  it("niesie stałą nazwę konwersji i encję CTA stopki", () => {
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

  it("dodatkowe meta jest dołączane obok statusu", () => {
    trackFooterNewsletterSubmit("error", { reason: "invalid_email", attempt: 2 });
    const [zdarzenie] = wyslaneZdarzenia();
    expect(zdarzenie.meta).toEqual({ status: "error", reason: "invalid_email", attempt: 2 });
  });

  it("dodatkowe meta NIE może nadpisać statusu - kolejność rozstrzyga na korzyść wywołania", () => {
    trackFooterNewsletterSubmit("error", { status: "success" });
    const [zdarzenie] = wyslaneZdarzenia();
    // `{ status, ...meta }` - rozwinięcie idzie PO statusie, więc wygrywa meta.
    // Test utrwala to, co moduł robi naprawdę, żeby zmiana kolejności była widoczna.
    expect(zdarzenie.meta).toEqual({ status: "success" });
  });

  it("mirroruje konwersję do GA4 z tym samym statusem", () => {
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

describe("footerTracking - bramka zgody obejmuje OBA beacony, nie tylko własny", () => {
  // Te dwa przypadki pilnują szczelności bramki RODO na drugim kanale wyjścia.
  // Nie wystarczy, że `track()` sam sprawdza zgodę analityczną: `window.gtag`
  // PRZEŻYWA cofnięcie zgody w dwóch niezależnych miejscach mechanizmu -
  //  * GA4 wstrzykuje `loadAnalytics()` w `ConsentScriptInjector.tsx`, czyli
  //    pod kategorią ANALYTICS, a nie marketingową (założenie o „zgodzie
  //    marketingowej" nigdy nie było prawdziwe);
  //  * sprzątanie (`removeMarked`) usuwa ELEMENT <script>, a nie globalną
  //    funkcję `window.gtag`, którą ten skrypt zdefiniował - po cofnięciu zgody
  //    (albo po włączeniu GPC w trakcie sesji) `gtag` NADAL jest funkcją.
  // Dlatego oba nadania idą dziś przez tę samą bramkę (`gtagIfConsented()` w
  // module produkcyjnym): własny beacon milczy i GA4 milczy razem z nim.
  // Gdyby ktoś usunął bramkę z akcesora GA4 - albo dopisał nowe zdarzenie
  // stopki obok niego - te przypadki padną, zanim zdarzenie po odmowie zgody
  // trafi do Google.
  it("cofnięta zgoda analytics zatrzymuje TAKŻE zdarzenie GA4", () => {
    zapiszZgode({ analytics: false });
    const ga = podstawGtag();

    trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" });

    expect(wyslaneZdarzenia()).toEqual([]);
    expect(ga).toEqual([]);
  });

  it("aktywny sygnał GPC zatrzymuje TAKŻE zdarzenie GA4", () => {
    zapiszZgode({ analytics: true, marketing: true });
    document.cookie = `${GPC_COOKIE}=${GPC_COOKIE_VALUE}; path=/`;
    const ga = podstawGtag();

    trackFooterNewsletterSubmit("success");

    expect(wyslaneZdarzenia()).toEqual([]);
    expect(ga).toEqual([]);
  });
});

describe("footerTracking - granica błędu OSOBNO dla każdego beacona", () => {
  // Bramka zgody (blok wyżej) pilnuje, CZY nadajemy. Ten blok pilnuje, co się
  // dzieje, gdy nadanie PADNIE - a to był realny defekt bliźniaczego modułu
  // `googleSourceBadgeAnalytics`: jedna sekwencja bez `try` znaczy, że wyjątek
  // z pierwszego kanału przeskakuje drugi i wychodzi z nasłuchu w `Footer.tsx`
  // (klik w fazie przechwytywania oraz `submit` newslettera). Tutaj oba
  // kierunki awarii są przypięte osobno, bo oba mają WŁASNE przyczyny:
  // magazyn/transport po stronie `track()` i cudzy kod GA4 po stronie `gtag`.
  const RZUCA_GTAG = "test: gtag GA4 padl";

  /** `gtag`, który rejestruje nadanie i DOPIERO POTEM rzuca. */
  function podstawRzucajacyGtag(): WywolanieGtag[] {
    const zapis: WywolanieGtag[] = [];
    const fn: GtagFn = (_command, name, params) => {
      zapis.push({ name, params });
      throw new Error(RZUCA_GTAG);
    };
    oknoGtag().gtag = fn;
    return zapis;
  }

  it("rzucający gtag NIE unieważnia własnego beacona kliknięcia ani nie wychodzi z nasłuchu", () => {
    zapiszZgode({ analytics: true });
    const ga = podstawRzucajacyGtag();

    expect(() =>
      trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" }),
    ).not.toThrow();

    expect(ga).toHaveLength(1);
    const [zdarzenie] = wyslaneZdarzenia();
    expect(zdarzenie).toMatchObject({ name: "footer_link_click", entity_id: "/analizy" });
  });

  it("rzucający gtag NIE unieważnia beacona konwersji newslettera", () => {
    zapiszZgode({ analytics: true });
    const ga = podstawRzucajacyGtag();

    expect(() => trackFooterNewsletterSubmit("success", { form_id: "footer" })).not.toThrow();

    expect(ga).toHaveLength(1);
    const [zdarzenie] = wyslaneZdarzenia();
    expect(zdarzenie).toMatchObject({ name: "footer_newsletter_signup" });
    expect(zdarzenie.meta).toEqual({ status: "success", form_id: "footer" });
  });

  it("rzucający transport PIERWSZEGO beacona nie zabiera GA4 i nie wychodzi z nasłuchu", () => {
    zapiszZgode({ analytics: true });
    beacons.rzucaj = true;
    const ga = podstawGtag();

    // `track()` drenuje bufor SAM, gdy dojdzie do `MAX_BATCH` (20 w track.ts),
    // więc pętla przekracza próg i rzucający `sendBeacon` pada W ŚRODKU
    // pierwszego beacona - dokładnie tak, jak przy przekroczonym limicie
    // ładunku w przeglądarce. Bez własnej granicy błędu 20. kliknięcie
    // przerwałoby pętlę wyjątkiem.
    expect(() => {
      for (let i = 0; i < 25; i += 1) {
        trackFooterLink({ href: `/analizy/${i}`, label: `Analiza ${i}`, group: "editorial" });
      }
    }).not.toThrow();

    // Bez tej asercji test byłby PUSTY: gdyby próg `MAX_BATCH` urósł ponad
    // długość pętli, transport nigdy by nie rzucił, a granica błędu nie
    // zostałaby dotknięta.
    expect(beacons.rzuty).toBeGreaterThan(0);
    // Drugi kanał dostał WSZYSTKIE 25 nadań, w tym to, na którym padł pierwszy.
    expect(ga).toHaveLength(25);
    expect(ga[19].params).toMatchObject({ link_url: "/analizy/19" });
    expect(ga[24].params).toMatchObject({ link_url: "/analizy/24" });
  });

  it("granica błędu NIE otwiera GA4 bez zgody - rzucający gtag nie zostaje nawet zawołany", () => {
    // Gdyby ktoś „naprawił" połknięty błąd, przenosząc nadanie przed bramkę
    // (albo omijając `gtagIfConsented()` w nowym `catch`), ten przypadek padnie
    // ZANIM zdarzenie po odmowie zgody trafi do Google.
    zapiszZgode({ analytics: false });
    const ga = podstawRzucajacyGtag();

    expect(() =>
      trackFooterLink({ href: "/analizy", label: "Analizy", group: "editorial" }),
    ).not.toThrow();

    expect(ga).toEqual([]);
    expect(wyslaneZdarzenia()).toEqual([]);
  });
});
