// GA4 w przeglądarce: tryb domyślnej odmowy Google, konfiguracja strumienia,
// aktualizacja zgody, przejęcie tagu ze snippetu SSR, kształt poleceń w
// `dataLayer`, Google Ads dopiero po zgodzie marketingowej (P1.1, TP-2:
// `ga4ConfigureAds` idempotentne flagą i skanem warstwy danych), promise
// dociągnięcia gtag.js (KONTRAKT ZADANIA kolejki P0.3) i czytanie
// identyfikatora klienta z cookie.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  asGa4MeasurementId,
  asGoogleAdsId,
  bootstrapGa4,
  ga4ClientId,
  ga4ConfigureAds,
  ga4ConsentUpdate,
  ga4Event,
  ga4PageView,
  ga4SsrSnippet,
  GA4_MEASUREMENT_ID,
  isGa4Ready,
  resetGa4BootstrapForTests,
  resolveBrowserGa4Id,
  ssrGtagId,
} from "../ga4Client";

interface Layered {
  dataLayer?: unknown[];
  gtag?: unknown;
}

/** Wpisy `dataLayer` to obiekty `arguments` - czytamy je po indeksach, nie jako tablice. */
function warstwa(): ArrayLike<unknown>[] {
  return ((window as Layered).dataLayer ?? []) as ArrayLike<unknown>[];
}

function znajdz(rodzaj: string, akcja?: string): ArrayLike<unknown> | undefined {
  return warstwa().find((wpis) => wpis[0] === rodzaj && (akcja === undefined || wpis[1] === akcja));
}

function policz(rodzaj: string, akcja?: string): number {
  return warstwa().filter(
    (wpis) => wpis[0] === rodzaj && (akcja === undefined || wpis[1] === akcja),
  ).length;
}

const GTAG_SRC = "https://www.googletagmanager.com/gtag/js";

/**
 * Snippet SSR z `__root.tsx` wykonany tak, jak robi to przeglądarka (tekst
 * `<script>` w `<head>`). Od 2026-09-20 to CAŁY udział SSR: sam `<script src>`
 * dociąga bootstrap kliencki na sygnał polityki (F20, P1.1), a snippet
 * zostawia po sobie wyłącznie warstwę danych, polecenia i pieczątkę.
 * `__root.tsx` podaje też identyfikator Ads - snippet go nie używa (TP-2).
 */
function uruchomSnippetSsr(ga4 = "G-TEST123", ads = "AW-123456789"): void {
  new Function(ga4SsrSnippet(ga4, ads))();
}

/**
 * Snippet SPRZED P1.1 (wpis w cache brzegowym dokumentu): ten sam tekst, ale z
 * `gtag('config', AW)` PRZED konfiguracją GA4 - dokładnie tak, jak go
 * składał stary `ga4SsrSnippet`. Na nim `ga4ConfigureAds` musi rozpoznać, że
 * miejsce docelowe Ads jest już w warstwie danych.
 */
function uruchomSnippetSprzedP11(ga4 = "G-TEST123", ads = "AW-123456789"): void {
  const nowy = ga4SsrSnippet(ga4, ads);
  const configGa4 = `gtag('config',${JSON.stringify(ga4)}`;
  expect(nowy).toContain(configGa4);
  new Function(nowy.replace(configGa4, `gtag('config',${JSON.stringify(ads)});${configGa4}`))();
}

/** Polecenia `config` dla dowolnego miejsca docelowego Google Ads. */
function policzConfigAds(): number {
  return warstwa().filter(
    (wpis) => wpis[0] === "config" && typeof wpis[1] === "string" && wpis[1].startsWith("AW-"),
  ).length;
}

function indeks(wpis: ArrayLike<unknown> | undefined): number {
  return wpis === undefined ? -1 : warstwa().indexOf(wpis);
}

/**
 * Dokument SPRZED przeniesienia tagu za bezczynność: snippet PLUS
 * `<script async src>` bez znacznika `data-ga4-tag` (ten daje wyłącznie
 * bootstrap kliencki). Takie dokumenty żyją w cache'u brzegowym jeszcze przez
 * całe okno `s-maxage`, więc klient MUSI je rozpoznawać tak samo.
 */
function uruchomStarySnippetSsr(ga4 = "G-TEST123", ads = "AW-123456789"): void {
  uruchomSnippetSsr(ga4, ads);
  const tag = document.createElement("script");
  tag.async = true;
  tag.src = `${GTAG_SRC}?id=${encodeURIComponent(ga4 || ads)}`;
  document.head.appendChild(tag);
}

describe("GA4 w przeglądarce", () => {
  beforeEach(() => {
    resetGa4BootstrapForTests();
    (window as Layered).dataLayer = [];
    document.head.querySelectorAll(`script[src^="${GTAG_SRC}"]`).forEach((el) => el.remove());
  });

  it("startuje z odmową wszystkich kategorii poza bezpieczeństwem", () => {
    bootstrapGa4("G-TEST123");
    const domyslne = znajdz("consent", "default");
    expect(domyslne?.[2]).toMatchObject({
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "denied",
      security_storage: "granted",
      wait_for_update: 500,
    });
  });

  it("wyłącza automatyczną odsłonę, bo wysyła ją router, i nie niesie parametrów z epoki UA", () => {
    bootstrapGa4("G-TEST123");
    const config = znajdz("config");
    expect(config?.[1]).toBe("G-TEST123");
    expect(config?.[2]).toEqual({ send_page_view: false });
  });

  it("wstawia tag Google tylko raz dla tego samego identyfikatora", () => {
    bootstrapGa4("G-TEST123");
    bootstrapGa4("G-TEST123");
    expect(document.head.querySelectorAll('script[data-ga4-tag="G-TEST123"]').length).toBe(1);
    expect(isGa4Ready()).toBe(true);
  });

  it("tag ładuje się identyfikatorem GA4, a Google Ads nie ma osobnego skryptu", () => {
    bootstrapGa4("G-TEST123");
    ga4ConfigureAds("AW-123456789");
    const scripts = document.head.querySelectorAll<HTMLScriptElement>(
      "script[src*=googletagmanager]",
    );
    expect(scripts.length).toBe(1);
    // Po `?id=` weryfikator Google rozpoznaje instalację strumienia GA4; Google
    // Ads jest drugim miejscem docelowym tego samego tagu (`config`), nie
    // osobnym skryptem.
    expect(scripts[0].getAttribute("src")).toContain("id=G-TEST123");
    expect(scripts[0].getAttribute("data-ga4-tag")).toBe("G-TEST123");
  });

  it("bootstrap konfiguruje WYŁĄCZNIE GA4 - Google Ads czeka na zgodę marketingową (TP-2)", () => {
    bootstrapGa4("G-TEST123");
    expect(znajdz("config", "G-TEST123")?.[2]).toEqual({ send_page_view: false });
    // `config AW` w warstwie danych kazałby gtag.js dociągnąć kontener Ads
    // (~200 KB, ~185 ms CPU) każdemu odwiedzającemu, także bez zgody.
    expect(policzConfigAds()).toBe(0);
  });

  it("nie duplikuje skryptu gtag.js, gdy już istnieje inny tag", () => {
    const existing = document.createElement("script");
    existing.src = `${GTAG_SRC}?id=G-EXISTING`;
    document.head.appendChild(existing);
    bootstrapGa4("G-TEST123");
    expect(document.head.querySelectorAll("script[src*=googletagmanager]").length).toBe(1);
    // Inny identyfikator to nie „nasz" tag z SSR - konfiguracja idzie normalnie.
    expect(policz("config", "G-TEST123")).toBe(1);
  });

  it("przekłada zgodę odwiedzającego na aktualizację Consent Mode", () => {
    bootstrapGa4("G-TEST123");
    ga4ConsentUpdate({ necessary: true, functional: true, analytics: true, marketing: false });
    const update = znajdz("consent", "update");
    expect(update?.[2]).toMatchObject({
      analytics_storage: "granted",
      functionality_storage: "granted",
      ad_storage: "denied",
      ad_personalization: "denied",
    });
  });

  it("nie wysyła zdarzeń przed konfiguracją strumienia", () => {
    ga4Event("test_event", { a: 1 });
    expect(znajdz("event", "test_event")).toBeUndefined();
    bootstrapGa4("G-TEST123");
    ga4Event("test_event", { a: 1 });
    expect(znajdz("event", "test_event")).toBeDefined();
  });

  it("polecenia trafiają do dataLayer jako obiekty `arguments`, nie tablice", () => {
    bootstrapGa4("G-TEST123");
    ga4ConsentUpdate({ necessary: true, functional: false, analytics: true, marketing: true });
    ga4ConfigureAds("AW-123456789");
    ga4Event("test_event", { a: 1 });
    ga4PageView("/", "Start", "pl");
    const wpisy = warstwa();
    expect(wpisy.length).toBeGreaterThanOrEqual(9);
    expect(policz("config", "AW-123456789")).toBe(1);
    for (const wpis of wpisy) {
      // gtag.js rozpoznaje komendę WYŁĄCZNIE po tym kształcie - tablica byłaby
      // zwykłym wpisem warstwy danych i zgoda/odsłona nigdy by nie dojechały.
      expect(Object.prototype.toString.call(wpis)).toBe("[object Arguments]");
      expect(Array.isArray(wpis)).toBe(false);
    }
  });

  it("definiuje `window.gtag` jak oficjalny snippet, gdy nikt go jeszcze nie dał", () => {
    expect((window as Layered).gtag).toBeUndefined();
    bootstrapGa4("G-TEST123");
    const globalna = (window as Layered).gtag;
    expect(typeof globalna).toBe("function");
    (globalna as (...args: unknown[]) => void)("event", "z_globalnej", { x: 1 });
    expect(znajdz("event", "z_globalnej")?.[2]).toEqual({ x: 1 });
  });

  it("snippet SSR i bootstrap klienta nie konfigurują strumienia dwa razy (i żaden nie konfiguruje Ads)", () => {
    uruchomSnippetSsr("G-TEST123", "AW-123456789");
    expect(ssrGtagId()).toBe("G-TEST123");

    bootstrapGa4("G-TEST123");

    expect(policz("consent", "default")).toBe(1);
    expect(policz("js")).toBe(1);
    expect(policzConfigAds()).toBe(0);
    expect(policz("config", "G-TEST123")).toBe(1);
    // Snippet nie ładuje już tagu, więc DOCIĄGNIĘCIE należy do klienta - ale
    // dokładnie jedno i tym samym identyfikatorem, którym SSR skonfigurował
    // strumień (drugi tag = drugi ping Google Ads przy wejściu).
    const tagi = document.head.querySelectorAll<HTMLScriptElement>("script[src*=googletagmanager]");
    expect(tagi).toHaveLength(1);
    expect(tagi[0].getAttribute("src")).toContain("id=G-TEST123");
    expect(isGa4Ready()).toBe(true);
  });

  it("dokument SPRZED odroczenia tagu (z `<script src>` w head) nadal nie dostaje drugiego tagu", () => {
    uruchomStarySnippetSsr("G-TEST123", "AW-123456789");

    bootstrapGa4("G-TEST123");

    expect(policz("consent", "default")).toBe(1);
    expect(policz("config", "G-TEST123")).toBe(1);
    expect(document.head.querySelectorAll("script[src*=googletagmanager]")).toHaveLength(1);
    expect(document.head.querySelectorAll("script[data-ga4-tag]")).toHaveLength(0);
  });

  // ODROCZENIE TAGU (F20). Polecenia i skrypt to DWIE RÓŻNE rzeczy: pierwsze
  // idą do `dataLayer` natychmiast (inaczej zgoda i pierwsza odsłona jechałyby
  // z opóźnieniem albo ginęły), drugi czeka na decyzję wołającego.
  it("polecenia idą do warstwy NATYCHMIAST, a skrypt dopiero gdy wołający na to pozwoli", () => {
    let dociagnij: (() => Promise<void>) | null = null;

    bootstrapGa4("G-TEST123", {
      scheduleScript: (load) => {
        dociagnij = load;
      },
    });

    expect(znajdz("consent", "default")).toBeDefined();
    expect(policz("config", "G-TEST123")).toBe(1);
    expect(document.head.querySelectorAll("script[src*=googletagmanager]")).toHaveLength(0);
    // Zdarzenie z okna PRZED dociągnięciem tagu nie ginie - czeka w kolejce
    // `dataLayer`, którą gtag.js przetwarza od początku po załadowaniu.
    expect(isGa4Ready()).toBe(true);
    ga4Event("test_event", { a: 1 });
    expect(znajdz("event", "test_event")).toBeDefined();

    expect(dociagnij).toBeTypeOf("function");
    void (dociagnij as unknown as () => Promise<void>)();
    expect(document.head.querySelectorAll("script[data-ga4-tag]")).toHaveLength(1);
  });

  // KONTRAKT ZADANIA kolejki P0.3: zadanie gtag oddaje promise, który
  // rozstrzyga się dopiero na `load`/`error` skryptu - kolejka nie puszcza
  // następnego kroku na ewaluację gtag.js.
  it.each(["load", "error"])(
    "dociągnięcie zwraca promise rozstrzygany dopiero na `%s` skryptu gtag.js",
    async (zdarzenie) => {
      // happy-dom z wyłączonym pobieraniem JS sam odpala `error` po wstawieniu
      // skryptu - węzeł przechwytujemy przed DOM, żeby zdarzenie dał test.
      const wstawione: Node[] = [];
      vi.spyOn(document.head, "appendChild").mockImplementation(<T extends Node>(node: T): T => {
        wstawione.push(node);
        return node;
      });
      let dociagnij: (() => Promise<void>) | null = null;
      bootstrapGa4("G-TEST123", {
        scheduleScript: (load) => {
          dociagnij = load;
        },
      });
      let rozstrzygniety = false;
      void (dociagnij as unknown as () => Promise<void>)().then(() => {
        rozstrzygniety = true;
      });
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
      expect(rozstrzygniety).toBe(false);

      const [tag] = wstawione;
      expect(tag).toBeInstanceOf(HTMLScriptElement);
      expect((tag as HTMLScriptElement).getAttribute("data-ga4-tag")).toBe("G-TEST123");
      tag?.dispatchEvent(new Event(zdarzenie));
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
      expect(rozstrzygniety).toBe(true);
      vi.restoreAllMocks();
    },
  );

  it("skrypt, który już jest w dokumencie, nie trzyma kolejki (promise rozstrzygnięty od razu)", async () => {
    const loads: Array<() => Promise<void>> = [];
    bootstrapGa4("G-TEST123", { scheduleScript: (load) => loads.push(load) });
    void loads[0]?.();
    // Drugi montaż po anulowanym planie: skrypt już stoi, nowy plan nic nie wstawia.
    resetGa4BootstrapForTests();
    bootstrapGa4("G-TEST123", { scheduleScript: (load) => loads.push(load) });
    expect(loads).toHaveLength(1);
    let rozstrzygniety = false;
    void loads[0]?.().then(() => {
      rozstrzygniety = true;
    });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(rozstrzygniety).toBe(true);
    expect(document.head.querySelectorAll("script[data-ga4-tag]")).toHaveLength(1);
  });

  it("anulowane dociągnięcie jest ponawiane przy ponownym montażu (inaczej tag nigdy by nie dojechał)", () => {
    // Pierwszy montaż: plan dociągnięcia zostaje ANULOWANY razem z efektem
    // (odmontowanie, podwójny efekt StrictMode w dev) - nikt go nie woła.
    bootstrapGa4("G-TEST123", { scheduleScript: () => {} });
    expect(document.head.querySelectorAll("script[data-ga4-tag]")).toHaveLength(0);

    // Drugi montaż z tą samą parą identyfikatorów: poleceń nie powtarzamy,
    // ale skrypt zamawiamy ponownie.
    bootstrapGa4("G-TEST123");

    expect(policz("consent", "default")).toBe(1);
    expect(policz("config", "G-TEST123")).toBe(1);
    expect(document.head.querySelectorAll("script[data-ga4-tag]")).toHaveLength(1);
  });

  it("pieczątka snippetu SSR zastępuje nieobecny `<script src>` w rozpoznaniu strumienia", () => {
    expect(ssrGtagId()).toBe("");
    uruchomSnippetSsr("G-SSR0000001", "");
    // Żadnego węzła w dokumencie - a strumień JEST rozpoznany.
    expect(document.head.querySelectorAll("script[src*=googletagmanager]")).toHaveLength(0);
    expect(ssrGtagId()).toBe("G-SSR0000001");
    expect(isGa4Ready()).toBe(true);
    expect(resolveBrowserGa4Id({ settingsId: "G-PANEL1234" })).toBe("G-SSR0000001");
  });

  it("pierwsza odsłona nie ginie, gdy snippet SSR skonfigurował strumień, a bootstrap klienta jeszcze nie ruszył", () => {
    uruchomSnippetSsr();
    expect(isGa4Ready()).toBe(true);

    ga4PageView("/analizy", "Analizy", "pl");

    const odslona = znajdz("event", "page_view");
    expect(odslona?.[2]).toMatchObject({ page_title: "Analizy", language: "pl" });
    expect((odslona?.[2] as Record<string, unknown>).page_location).toEqual(expect.any(String));
    expect(odslona?.[2]).not.toHaveProperty("page_path");
  });

  it("page_location bez poświadczeń: token w ścieżce i parametrach zamaskowany, fragment odcięty", () => {
    uruchomSnippetSsr();
    const before = `${location.pathname}${location.search}${location.hash}`;
    history.pushState(
      {},
      "",
      "/en/tickets/transfer/AbCdEfGhIjKlMnOpQrStUvWxYz012345?token=abc&x=1#t=sekret",
    );
    try {
      ga4PageView("/pominiete", "Przekazanie", "en");
      const odslona = znajdz("event", "page_view");
      const oczekiwany = `${location.origin}/en/tickets/transfer/[redacted]?token=[redacted]&x=1`;
      expect((odslona?.[2] as Record<string, unknown>).page_location).toBe(oczekiwany);
      // Kolejne zdarzenia (kliknięcia, konwersje) dziedziczą `page_location`
      // z `set` - bez niego gtag.js dokleiłby surowy `document.location`.
      const ustawienie = warstwa().find(
        (wpis) => wpis[0] === "set" && typeof wpis[1] === "object" && wpis[1] !== null,
      );
      expect(ustawienie?.[1]).toEqual({ page_location: oczekiwany });
      const indeks = (wpis: ArrayLike<unknown> | undefined) =>
        wpis === undefined ? -1 : warstwa().indexOf(wpis);
      expect(indeks(ustawienie)).toBeLessThan(indeks(odslona));
    } finally {
      history.pushState({}, "", before);
    }
  });

  it("page_location bez `location` (SSR) = maskowana ścieżka wołającego", () => {
    uruchomSnippetSsr();
    vi.stubGlobal("location", undefined);
    try {
      ga4PageView("/certificates/ABCD-EFGH-JKMN-PQRS?code=x#frag", "Certyfikat", "pl");
    } finally {
      vi.unstubAllGlobals();
    }
    const odslona = znajdz("event", "page_view");
    expect((odslona?.[2] as Record<string, unknown>).page_location).toBe(
      "/certificates/[redacted]?code=[redacted]",
    );
    expect(warstwa().find((wpis) => wpis[0] === "set" && typeof wpis[1] === "object")?.[1]).toEqual(
      { page_location: "/certificates/[redacted]?code=[redacted]" },
    );
  });

  // `redactTrackedPath` maskuje poświadczenia, nie TEKST odwiedzającego: fraza
  // z wyszukiwarki i e-mail z linku zaproszenia szły do GA4 w `page_location`,
  // a przez `set` - w każdym kolejnym zdarzeniu na stronie.
  it.each([
    [
      "fraza z wyszukiwarki zredagowana, parametry kampanii zostają",
      "/search?q=jan%40example.com&gclid=ABC123&gad_campaignid=987654321",
      "/search?q=[redacted-email]&gclid=ABC123&gad_campaignid=987654321",
    ],
    [
      "e-mail z linku zaproszenia (/auth?email=)",
      "/auth?email=jan%40example.com",
      "/auth?email=[redacted-email]",
    ],
    [
      "telefon w ?q= (zakodowany %2B)",
      "/search?q=%2B48%20600%20123%20456",
      "/search?q=[redacted-phone]",
    ],
  ])("page_location: %s (także w `set`)", (_opis, adres, oczekiwanaSciezka) => {
    uruchomSnippetSsr();
    const before = `${location.pathname}${location.search}${location.hash}`;
    history.pushState({}, "", adres);
    try {
      ga4PageView("/pominiete", "Wyszukiwarka", "pl");
      const oczekiwany = `${location.origin}${oczekiwanaSciezka}`;
      const odslona = znajdz("event", "page_view");
      expect((odslona?.[2] as Record<string, unknown>).page_location).toBe(oczekiwany);
      const ustawienie = warstwa().find(
        (wpis) => wpis[0] === "set" && typeof wpis[1] === "object" && wpis[1] !== null,
      );
      expect(ustawienie?.[1]).toEqual({ page_location: oczekiwany });
      expect(JSON.stringify(Array.from(warstwa(), (w) => Array.from(w)))).not.toContain(
        "example.com",
      );
    } finally {
      history.pushState({}, "", before);
    }
  });

  it("`ga4Event` NIE redaguje: `send_to` konwersji Ads z 9-cyfrowym kontem zostaje co do bajtu", () => {
    // Redakcja stoi w `ga4EventMap`/`ga4PageView`, nie tutaj - świadomie.
    // Reguła telefonu wzięłaby 9 cyfr identyfikatora konta za numer, a
    // `send_to` z `[redacted-phone]` to konwersja, która nie trafia na konto.
    uruchomSnippetSsr();
    const sendTo = "AW-123456789/abCdEfGhIj";
    ga4Event("conversion", { send_to: sendTo, transaction_id: "ord_1" });
    expect(znajdz("event", "conversion")?.[2]).toEqual({
      send_to: sendTo,
      transaction_id: "ord_1",
    });
  });

  it("bez gotowego GA4 odsłona nie ustawia niczego (ani `set`, ani `page_view`)", () => {
    ga4PageView("/tickets/transfer/abc", "Przekazanie", "pl");
    expect(znajdz("event", "page_view")).toBeUndefined();
    expect(warstwa().some((wpis) => wpis[0] === "set")).toBe(false);
  });

  it("snippet SSR: zgoda domyślna PRZED konfiguracją, wyłącznie GA4 (bez `config AW`), brak parametrów UA", () => {
    const snippet = ga4SsrSnippet(" G-TEST123 ", "AW-123456789");
    expect(snippet.indexOf("gtag('consent','default'")).toBeGreaterThanOrEqual(0);
    expect(snippet.indexOf("gtag('consent','default'")).toBeLessThan(
      snippet.indexOf("gtag('config'"),
    );
    // Consent Mode `default` z `wait_for_update:500` - bajt w bajt jak przed P1.1.
    expect(snippet).toContain(
      "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'denied',personalization_storage:'denied',security_storage:'granted',wait_for_update:500});",
    );
    expect(snippet).toContain(`gtag('config',"G-TEST123",{send_page_view:false});`);
    // TP-2: identyfikator Ads zostaje w sygnaturze (`__root.tsx`), ale do
    // snippetu nie trafia - przed zgodą marketingową nie ma czego konfigurować.
    expect(snippet).not.toContain("AW-123456789");
    expect(snippet.match(/gtag\('config'/g)).toHaveLength(1);
    expect(snippet).not.toContain("anonymize_ip");
    expect(snippet).toContain("window.gtag=gtag;");
    expect(snippet).toContain(`window.__nesGa4SsrTag="G-TEST123";`);
    expect(ga4SsrSnippet("", "")).toBe("");
    expect(ga4SsrSnippet("", "AW-123456789")).toBe("");
  });

  it("snippet SSR wykonany w przeglądarce nie zostawia `config AW` w warstwie danych", () => {
    uruchomSnippetSsr("G-TEST123", "AW-123456789");
    expect(policz("config", "G-TEST123")).toBe(1);
    expect(policzConfigAds()).toBe(0);
  });

  it("resolveBrowserGa4Id: tag z SSR > wpis panelu > konektor > stała; klucz API nigdy nie przechodzi", () => {
    expect(resolveBrowserGa4Id({ settingsId: "G-PANEL1234" })).toBe("G-PANEL1234");
    expect(resolveBrowserGa4Id({ settingsId: "AIzaSyFakeKey", connectorId: "G-KONEKTOR1" })).toBe(
      "G-KONEKTOR1",
    );
    expect(resolveBrowserGa4Id({ settingsId: "", connectorId: "AIzaSyFakeKey" })).toBe(
      GA4_MEASUREMENT_ID,
    );
    expect(resolveBrowserGa4Id({})).toBe(GA4_MEASUREMENT_ID);

    // Skrypt wstawiony przez bootstrap KLIENCKI (data-ga4-tag) nie jest tagiem z
    // SSR - zmiana strumienia w panelu nadal ma prawo przekonfigurować klienta.
    bootstrapGa4("G-TEST123");
    expect(ssrGtagId()).toBe("");
    expect(resolveBrowserGa4Id({ settingsId: "G-PANEL1234" })).toBe("G-PANEL1234");

    uruchomSnippetSsr("G-SSR0000001", "");
    expect(resolveBrowserGa4Id({ settingsId: "G-PANEL1234" })).toBe("G-SSR0000001");
  });

  it("asGa4MeasurementId / asGoogleAdsId normalizują kształt i odrzucają wszystko inne", () => {
    expect(asGa4MeasurementId(" g-en05jh34vp ")).toBe("G-EN05JH34VP");
    expect(asGa4MeasurementId("AIzaSyFakeKey")).toBe("");
    expect(asGa4MeasurementId("G-")).toBe("");
    expect(asGa4MeasurementId(123)).toBe("");
    expect(asGa4MeasurementId(undefined)).toBe("");
    expect(asGoogleAdsId("aw-17612160320")).toBe("AW-17612160320");
    expect(asGoogleAdsId("AW-12")).toBe("");
    expect(asGoogleAdsId(null)).toBe("");
  });

  it("czyta identyfikator klienta z cookie _ga", () => {
    document.cookie = "_ga=GA1.1.1234567890.1699999999";
    expect(ga4ClientId()).toBe("1234567890.1699999999");
  });
});

describe("Google Ads dopiero po zgodzie marketingowej - ga4ConfigureAds (P1.1, TP-2)", () => {
  const ADS = "AW-123456789";
  const zgodaMarketingowa = {
    necessary: true,
    functional: false,
    analytics: true,
    marketing: true,
  };

  beforeEach(() => {
    resetGa4BootstrapForTests();
    (window as Layered).dataLayer = [];
    document.head.querySelectorAll(`script[src^="${GTAG_SRC}"]`).forEach((el) => el.remove());
  });

  it("wypycha DOKŁADNIE jedno `config AW` jako obiekt `arguments`, za aktualizacją zgody", () => {
    uruchomSnippetSsr();
    bootstrapGa4("G-TEST123");
    ga4ConsentUpdate(zgodaMarketingowa);
    ga4ConfigureAds(ADS);

    expect(policz("config", ADS)).toBe(1);
    const config = znajdz("config", ADS);
    expect(Object.prototype.toString.call(config)).toBe("[object Arguments]");
    // gtag.js przetwarza warstwę po kolei: `config AW` przed `consent update`
    // wysłałby pierwsze trafienie Ads w stanie `denied`.
    const update = znajdz("consent", "update");
    expect((update?.[2] as Record<string, unknown>).ad_storage).toBe("granted");
    expect(indeks(update)).toBeLessThan(indeks(config));
  });

  it("idempotentne flagą modułu: kolejne zmiany kategorii i ponowny montaż nie dokładają drugiego `config`", () => {
    bootstrapGa4("G-TEST123");
    ga4ConsentUpdate(zgodaMarketingowa);
    ga4ConfigureAds(ADS);
    ga4ConsentUpdate({ ...zgodaMarketingowa, functional: true });
    ga4ConfigureAds(ADS);
    ga4ConfigureAds(` ${ADS} `);
    expect(policz("config", ADS)).toBe(1);
  });

  it("idempotentne skanem warstwy: dokument z cache sprzed P1.1 (`config AW` w snippecie) nie dostaje drugiego", () => {
    uruchomSnippetSprzedP11("G-TEST123", ADS);
    expect(policz("config", ADS)).toBe(1);
    bootstrapGa4("G-TEST123");
    ga4ConsentUpdate(zgodaMarketingowa);

    ga4ConfigureAds(ADS);

    expect(policz("config", ADS)).toBe(1);
    expect(policz("config", "G-TEST123")).toBe(1);
  });

  it("zwykła tablica `['config', AW]` nie jest poleceniem gtag - nie blokuje prawdziwej konfiguracji", () => {
    bootstrapGa4("G-TEST123");
    (window as Layered).dataLayer?.push(["config", ADS]);
    ga4ConfigureAds(ADS);
    const polecenia = warstwa().filter(
      (wpis) =>
        Object.prototype.toString.call(wpis) === "[object Arguments]" &&
        wpis[0] === "config" &&
        wpis[1] === ADS,
    );
    expect(polecenia).toHaveLength(1);
  });

  it("inny identyfikator Ads to osobne miejsce docelowe (flaga per identyfikator)", () => {
    bootstrapGa4("G-TEST123");
    ga4ConfigureAds(ADS);
    ga4ConfigureAds("AW-987654321");
    expect(policz("config", ADS)).toBe(1);
    expect(policz("config", "AW-987654321")).toBe(1);
  });

  it("pusty identyfikator i host spoza produkcji (podgląd) - no-op", () => {
    bootstrapGa4("G-TEST123");
    ga4ConfigureAds("   ");
    expect(policzConfigAds()).toBe(0);

    resetGa4BootstrapForTests();
    (window as Layered).dataLayer = [];
    const flaga: unknown = Reflect.get(window, "__NES_GA_ANY_HOST__");
    Reflect.set(window, "__NES_GA_ANY_HOST__", false);
    try {
      ga4ConfigureAds(ADS);
    } finally {
      Reflect.set(window, "__NES_GA_ANY_HOST__", flaga);
    }
    expect(policzConfigAds()).toBe(0);
  });

  it("`resetGa4BootstrapForTests` zeruje także flagę Ads", () => {
    ga4ConfigureAds(ADS);
    resetGa4BootstrapForTests();
    (window as Layered).dataLayer = [];
    ga4ConfigureAds(ADS);
    expect(policz("config", ADS)).toBe(1);
  });
});
