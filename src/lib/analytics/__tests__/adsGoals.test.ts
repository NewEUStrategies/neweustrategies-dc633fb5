// Cele Google Ads z fragmentow wlasciciela (2026-10-22): nazwy zdarzen musza
// zgadzac sie 1:1 z celem w panelu Ads - zmiana litery odcina pomiar.
import { beforeEach, describe, expect, it } from "vitest";

import {
  ADS_GOAL_FORM_PAGE,
  ADS_GOAL_FORM_SUBMIT,
  ADS_GOAL_PAGE_VIEW_1,
  ADS_GOAL_PAGE_VIEW_WWW,
  ADS_GOAL_REGISTRATION,
  trackAdsFormGoals,
  trackAdsPageViewGoals,
  trackAdsRegistrationGoal,
} from "../adsGoals";
import { bootstrapGa4, resetGa4BootstrapForTests } from "../ga4Client";

interface GtagWindow extends Window {
  dataLayer?: unknown[];
}

function dataLayerEntries(): unknown[] {
  return (window as GtagWindow).dataLayer ?? [];
}

function eventNames(): string[] {
  return dataLayerEntries()
    .filter(
      (entry) =>
        Object.prototype.toString.call(entry) === "[object Arguments]" &&
        entry !== null &&
        typeof entry === "object" &&
        Reflect.get(entry, 0) === "event",
    )
    .map((entry) => String(Reflect.get(entry as object, 1)));
}

beforeEach(() => {
  resetGa4BootstrapForTests();
  (window as GtagWindow).dataLayer = [];
  // Bootstrap konfiguruje strumien, zeby `ga4Event` nie byl no-op.
  bootstrapGa4("G-TEST123456");
});

describe("adsGoals - nazwy celow Google Ads", () => {
  it("cele odsłon wysyłaja oba zdarzenia z fragmentow Ads", () => {
    trackAdsPageViewGoals();
    expect(eventNames()).toEqual([ADS_GOAL_PAGE_VIEW_WWW, ADS_GOAL_PAGE_VIEW_1]);
    expect(ADS_GOAL_PAGE_VIEW_WWW).toBe("ads_conversion_www");
    expect(ADS_GOAL_PAGE_VIEW_1).toBe("ads_conversion_PAGE_VIEW_1");
  });

  it("cel rejestracji wysyla zdarzenie strony rejestracji", () => {
    trackAdsRegistrationGoal();
    expect(eventNames()).toEqual([ADS_GOAL_REGISTRATION]);
    expect(ADS_GOAL_REGISTRATION).toBe("ads_conversion_Strona_rejestracji_1");
  });

  it("cele formularza wysylaja wariant strony i klikniecia", () => {
    trackAdsFormGoals();
    expect(eventNames()).toEqual([ADS_GOAL_FORM_PAGE, ADS_GOAL_FORM_SUBMIT]);
    expect(ADS_GOAL_FORM_PAGE).toBe("ads_conversion_Formularz_1");
    expect(ADS_GOAL_FORM_SUBMIT).toBe("ads_submit_form");
  });
});
