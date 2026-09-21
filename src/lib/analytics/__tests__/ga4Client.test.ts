// GA4 w przeglądarce: tryb domyślnej odmowy Google, konfiguracja strumienia,
// aktualizacja zgody, przejęcie tagu ze snippetu SSR, kształt poleceń w
// `dataLayer` i czytanie identyfikatora klienta z cookie.
import { beforeEach, describe, expect, it } from "vitest";

import {
  asGa4MeasurementId,
  asGoogleAdsId,
  bootstrapGa4,
  ga4ClientId,
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
 * dociąga bootstrap kliencki po bezczynności (F20), a snippet zostawia po
 * sobie wyłącznie warstwę danych, polecenia i pieczątkę.
 */
function uruchomSnippetSsr(ga4 = "G-TEST123", ads = "AW-123456789"): void {
  new Function(ga4SsrSnippet(ga4, ads))();
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

  it("tag ładuje się identyfikatorem GA4, nawet gdy podano też Google Ads", () => {
    bootstrapGa4("G-TEST123", "AW-123456789");
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

  it("konfiguruje zarówno Google Ads, jak i GA4, gdy oba identyfikatory są podane", () => {
    bootstrapGa4("G-TEST123", "AW-123456789");
    expect(policz("config", "AW-123456789")).toBe(1);
    expect(znajdz("config", "G-TEST123")?.[2]).toEqual({ send_page_view: false });
  });

  it("nie duplikuje skryptu gtag.js, gdy już istnieje inny tag", () => {
    const existing = document.createElement("script");
    existing.src = `${GTAG_SRC}?id=G-EXISTING`;
    document.head.appendChild(existing);
    bootstrapGa4("G-TEST123", "AW-123456789");
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
    bootstrapGa4("G-TEST123", "AW-123456789");
    ga4ConsentUpdate({ necessary: true, functional: false, analytics: true, marketing: false });
    ga4Event("test_event", { a: 1 });
    ga4PageView("/", "Start", "pl");
    const wpisy = warstwa();
    expect(wpisy.length).toBeGreaterThanOrEqual(8);
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

  it("snippet SSR i bootstrap klienta nie konfigurują strumienia dwa razy", () => {
    uruchomSnippetSsr("G-TEST123", "AW-123456789");
    expect(ssrGtagId()).toBe("G-TEST123");

    bootstrapGa4("G-TEST123", "AW-123456789");

    expect(policz("consent", "default")).toBe(1);
    expect(policz("js")).toBe(1);
    expect(policz("config", "AW-123456789")).toBe(1);
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

    bootstrapGa4("G-TEST123", "AW-123456789");

    expect(policz("consent", "default")).toBe(1);
    expect(policz("config", "G-TEST123")).toBe(1);
    expect(document.head.querySelectorAll("script[src*=googletagmanager]")).toHaveLength(1);
    expect(document.head.querySelectorAll("script[data-ga4-tag]")).toHaveLength(0);
  });

  // ODROCZENIE TAGU (F20). Polecenia i skrypt to DWIE RÓŻNE rzeczy: pierwsze
  // idą do `dataLayer` natychmiast (inaczej zgoda i pierwsza odsłona jechałyby
  // z opóźnieniem albo ginęły), drugi czeka na decyzję wołającego.
  it("polecenia idą do warstwy NATYCHMIAST, a skrypt dopiero gdy wołający na to pozwoli", () => {
    let dociagnij: (() => void) | null = null;

    bootstrapGa4("G-TEST123", "AW-123456789", {
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
    (dociagnij as unknown as () => void)();
    expect(document.head.querySelectorAll("script[data-ga4-tag]")).toHaveLength(1);
  });

  it("anulowane dociągnięcie jest ponawiane przy ponownym montażu (inaczej tag nigdy by nie dojechał)", () => {
    // Pierwszy montaż: plan dociągnięcia zostaje ANULOWANY razem z efektem
    // (odmontowanie, podwójny efekt StrictMode w dev) - nikt go nie woła.
    bootstrapGa4("G-TEST123", "", { scheduleScript: () => {} });
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

  it("snippet SSR: zgoda domyślna PRZED konfiguracją, oba miejsca docelowe, brak parametrów UA", () => {
    const snippet = ga4SsrSnippet(" G-TEST123 ", "AW-123456789");
    expect(snippet.indexOf("gtag('consent','default'")).toBeGreaterThanOrEqual(0);
    expect(snippet.indexOf("gtag('consent','default'")).toBeLessThan(
      snippet.indexOf("gtag('config'"),
    );
    expect(snippet).toContain(`gtag('config',"AW-123456789");`);
    expect(snippet).toContain(`gtag('config',"G-TEST123",{send_page_view:false});`);
    expect(snippet).not.toContain("anonymize_ip");
    expect(snippet).toContain("window.gtag=gtag;");
    expect(ga4SsrSnippet("", "")).toBe("");
    expect(ga4SsrSnippet("", "AW-123456789")).toContain(`gtag('config',"AW-123456789");`);
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
