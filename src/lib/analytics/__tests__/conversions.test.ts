// Konwersje przeniesione z WordPressa: lead z formularza i kliknięcie w
// konkretną strategię. Test pilnuje trzech rzeczy naraz: zdarzenie leci do
// naszego silnika, mostek GA4 tłumaczy nazwę na zdarzenie rekomendowane, a
// konwersja Ads jest wysyłana WYŁĄCZNIE przy poprawnej etykiecie.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ga4EventName } from "../ga4EventMap";
import { GOOGLE_ADS_ID } from "../tagIds";

const trackMock = vi.fn();
const ga4EventMock = vi.fn();

vi.mock("../track", () => ({ track: (...args: unknown[]) => trackMock(...args) }));
vi.mock("../ga4Client", () => ({ ga4Event: (...args: unknown[]) => ga4EventMock(...args) }));

const { adsSendTo, adsConversion, trackFormConversion, trackStrategyConversion } =
  await import("../conversions");

beforeEach(() => {
  trackMock.mockClear();
  ga4EventMock.mockClear();
});

describe("mostek nazw", () => {
  it("mapuje konwersje na zdarzenia rekomendowane GA4", () => {
    expect(ga4EventName("form_submit")).toBe("generate_lead");
    expect(ga4EventName("strategy_click")).toBe("select_content");
  });
});

describe("adsSendTo", () => {
  it("składa cel konwersji z identyfikatora konta i etykiety", () => {
    expect(adsSendTo("abCD1234ef")).toBe(`${GOOGLE_ADS_ID}/abCD1234ef`);
  });

  it("odrzuca etykiety o niepoprawnym kształcie", () => {
    expect(adsSendTo("")).toBe("");
    expect(adsSendTo("ab")).toBe("");
    expect(adsSendTo("ab/cd?x=1")).toBe("");
  });
});

describe("adsConversion", () => {
  it("nie wysyła nic bez etykiety", () => {
    adsConversion("");
    expect(ga4EventMock).not.toHaveBeenCalled();
  });

  it("wysyła konwersję z celem send_to", () => {
    adsConversion("abCD1234ef", { value: 10, currency: "PLN" });
    expect(ga4EventMock).toHaveBeenCalledWith("conversion", {
      send_to: `${GOOGLE_ADS_ID}/abCD1234ef`,
      value: 10,
      currency: "PLN",
    });
  });
});

describe("trackFormConversion", () => {
  it("zgłasza lead z identyfikatorem formularza", () => {
    trackFormConversion({ formId: "contact_main", formName: "Kontakt", lang: "pl" });
    expect(trackMock).toHaveBeenCalledTimes(1);
    const payload = trackMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.name).toBe("form_submit");
    expect(payload.entityType).toBe("form");
    expect(payload.entityId).toBe("contact_main");
    expect(payload.meta).toMatchObject({ form_name: "Kontakt", form_lang: "pl" });
  });
});

describe("trackStrategyConversion", () => {
  it("zgłasza kliknięcie w konkretną strategię z miejscem kliknięcia", () => {
    trackStrategyConversion({
      strategyId: "post-1",
      href: "/blog/strategia",
      title: "Strategia",
      placement: "blog",
      lang: "pl",
    });
    const payload = trackMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.name).toBe("strategy_click");
    expect(payload.entityType).toBe("strategy");
    expect(payload.entityId).toBe("post-1");
    expect(payload.meta).toMatchObject({
      item_name: "Strategia",
      link_url: "/blog/strategia",
      placement: "blog",
    });
  });

  it("bez miejsca kliknięcia zapisuje `unknown`, nie pustkę", () => {
    trackStrategyConversion({ strategyId: "post-2" });
    const payload = trackMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.meta).toMatchObject({ placement: "unknown" });
  });
});
