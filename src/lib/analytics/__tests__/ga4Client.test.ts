// GA4 w przeglądarce: tryb domyślnej odmowy Google, konfiguracja strumienia,
// aktualizacja zgody i czytanie identyfikatora klienta z cookie.
import { beforeEach, describe, expect, it } from "vitest";

import {
  bootstrapGa4,
  ga4ClientId,
  ga4ConsentUpdate,
  ga4Event,
  isGa4Ready,
  resetGa4BootstrapForTests,
} from "../ga4Client";

interface Layered {
  dataLayer?: unknown[];
}

function warstwa(): unknown[][] {
  return ((window as Layered).dataLayer ?? []) as unknown[][];
}

function znajdz(rodzaj: string, akcja?: string): unknown[] | undefined {
  return warstwa().find((wpis) => wpis[0] === rodzaj && (akcja === undefined || wpis[1] === akcja));
}

describe("GA4 w przeglądarce", () => {
  beforeEach(() => {
    resetGa4BootstrapForTests();
    (window as Layered).dataLayer = [];
    document.head.querySelectorAll("script[data-ga4-tag]").forEach((el) => el.remove());
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

  it("wyłącza automatyczną odsłonę, bo wysyła ją router", () => {
    bootstrapGa4("G-TEST123");
    const config = znajdz("config");
    expect(config?.[1]).toBe("G-TEST123");
    expect(config?.[2]).toMatchObject({ send_page_view: false, anonymize_ip: true });
  });

  it("wstawia tag Google tylko raz dla tego samego identyfikatora", () => {
    bootstrapGa4("G-TEST123");
    bootstrapGa4("G-TEST123");
    expect(document.head.querySelectorAll('script[data-ga4-tag="G-TEST123"]').length).toBe(1);
    expect(isGa4Ready()).toBe(true);
  });

  it("gdy podano Google Ads, tag ładuje się z AW- jako głównym identyfikatorem", () => {
    bootstrapGa4("G-TEST123", "AW-123456789");
    const scripts = document.head.querySelectorAll<HTMLScriptElement>("script[src*=googletagmanager]");
    expect(scripts.length).toBe(1);
    expect(scripts[0].getAttribute("src")).toContain("id=AW-123456789");
    expect(scripts[0].getAttribute("data-ga4-tag")).toBe("AW-123456789");
  });

  it("konfiguruje zarówno Google Ads, jak i GA4, gdy oba identyfikatory są podane", () => {
    bootstrapGa4("G-TEST123", "AW-123456789");
    const configs = warstwa().filter((wpis) => wpis[0] === "config");
    expect(configs.some((wpis) => wpis[1] === "AW-123456789")).toBe(true);
    const ga4Config = configs.find((wpis) => wpis[1] === "G-TEST123");
    expect(ga4Config?.[2]).toMatchObject({ send_page_view: false, anonymize_ip: true });
  });

  it("nie duplikuje skryptu gtag.js, gdy już istnieje inny tag", () => {
    const existing = document.createElement("script");
    existing.src = "https://www.googletagmanager.com/gtag/js?id=G-EXISTING";
    document.head.appendChild(existing);
    bootstrapGa4("G-TEST123", "AW-123456789");
    expect(document.head.querySelectorAll("script[src*=googletagmanager]").length).toBe(1);
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

  it("czyta identyfikator klienta z cookie _ga", () => {
    document.cookie = "_ga=GA1.1.1234567890.1699999999";
    expect(ga4ClientId()).toBe("1234567890.1699999999");
  });
});
