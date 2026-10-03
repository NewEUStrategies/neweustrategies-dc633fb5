// @vitest-environment node
// Warstwa zgod (`src/lib/ads/consent.ts`) poza przegladarka (SSR, worker).
//
// CO KONKRETNIE PSUJE SIE BEZ TEGO TESTU. Modul laduje sie tez na serwerze
// (chunk wejsciowy), a jego funkcje sa wolane z kodu wspoldzielonego: render
// SSR (`useConsent` w inicjalizatorze stanu), silnik analityki
// (`hasCategoryConsent`), przechwycenie atrybucji. Bez straznikow `window`
// kazde takie wywolanie rzucaloby `ReferenceError` w SSR zamiast oddac
// bezpieczny stan "brak zgody / brak decyzji".
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const consent = await import("@/lib/ads/consent");

describe("subscribeConsentChange na serwerze", () => {
  it("nie dotyka `window`, zwraca bezpieczne odpiecie i nie wola sluchacza", () => {
    const listener = vi.fn();
    const off = consent.subscribeConsentChange(listener);
    expect(() => off()).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("odczyty poza Reactem na serwerze", () => {
  it("niezbedne sa zawsze dozwolone, reszta kategorii - nigdy", () => {
    expect(consent.hasCategoryConsent("necessary")).toBe(true);
    expect(consent.hasCategoryConsent("analytics")).toBe(false);
    expect(consent.hasAnalyticsConsent()).toBe(false);
    expect(consent.hasCategoryConsent("marketing")).toBe(false);
  });

  it("brak decyzji, brak honorowanego GPC, brak zadania podgladu", () => {
    expect(consent.hasConsentDecision()).toBe(false);
    expect(consent.isGpcCurrentlyHonored()).toBe(false);
    expect(consent.isConsentPreviewRequested()).toBe(false);
  });

  it("zapisy podgladu i zadanie preferencji sa no-opem, a nie wyjatkiem", () => {
    expect(() => consent.setConsentPreview({ marketing: true })).not.toThrow();
    expect(() => consent.clearConsentPreview()).not.toThrow();
    expect(() => consent.requestConsentPreferences()).not.toThrow();
    // Zadanie z serwera nie moze zostac w stanie modulu - otworzyloby panel
    // preferencji u pierwszego czytelnika obsluzonego przez ten izolat.
    expect(consent.consumeOpenPrefsRequest()).toBe(false);
  });
});

describe("render SSR hookow zgody", () => {
  it("useConsent / useEffectiveConsent renderuja stan domyslny bez dotykania magazynow", () => {
    let snapshot: {
      state: unknown;
      decided: boolean;
      mounted: boolean;
      categories: Record<string, boolean>;
      preview: boolean;
      gpcHonored: boolean;
      clear: () => void;
      save: (cats: Record<string, boolean>) => void;
    } | null = null;
    function Probe() {
      const c = consent.useConsent();
      const e = consent.useEffectiveConsent();
      snapshot = { ...c, ...e };
      return null;
    }

    expect(() => renderToString(createElement(Probe))).not.toThrow();

    expect(snapshot).toMatchObject({
      state: null,
      // Przed montazem `decided` jest prawdziwe: SSR nie renderuje banera, ktory
      // klient zaraz by zdjal (migniecie przy hydratacji).
      decided: true,
      mounted: false,
      preview: false,
      gpcHonored: false,
      categories: { necessary: true, functional: false, analytics: false, marketing: false },
    });
    // `clear()` / `save()` wolane na serwerze (np. z kodu wspoldzielonego) nie
    // rzucaja i niczego nie utrwalaja - nie ma gdzie.
    expect(() => snapshot!.clear()).not.toThrow();
    expect(() => snapshot!.save({ marketing: true })).not.toThrow();
    expect(consent.hasConsentDecision()).toBe(false);
  });
});
