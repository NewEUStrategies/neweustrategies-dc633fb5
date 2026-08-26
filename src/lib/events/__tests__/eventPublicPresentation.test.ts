// Prezentacja publicznej strony wydarzenia: informacje praktyczne i branding.
//
// OBA MODULY PILNUJA REGULY, KTORA WIDAC DOPIERO PRZY BLEDZIE. `eventPractical`
// rozstrzyga, czy sekcja ma sie w ogole pojawic - i pomylka daje samotny
// naglowek „Dojazd" nad pustka. `eventBrandingCss` rozstrzyga ZAKRES kolorow -
// i pomylka daje kolory jednego kongresu na calym serwisie. Jedno i drugie
// przechodzi tu bez DOM-u.
import { describe, expect, it } from "vitest";

import {
  eventHashtag,
  eventSupportEmail,
  hasPracticalContent,
  isEventPracticalSection,
  type EventPracticalInfo,
} from "@/lib/events/eventPractical";
import { eventBrandingCss, eventBrandingScopeProps } from "@/lib/events/eventBrandingCss";

const EMPTY: EventPracticalInfo = {
  streetAddress: null,
  postalCode: null,
  city: null,
  region: null,
  country: null,
  languages: [],
  socialHashtag: null,
  supportEmail: null,
};

describe("eventPractical - podzial na `map` i `contact`", () => {
  it("adres nalezy do mapy, a nie do kontaktu", () => {
    const info: EventPracticalInfo = { ...EMPTY, city: "Warszawa" };
    expect(hasPracticalContent(info, "map")).toBe(true);
    expect(hasPracticalContent(info, "contact")).toBe(false);
  });

  it("jezyki, hashtag i wsparcie naleza do kontaktu, a nie do mapy", () => {
    expect(hasPracticalContent({ ...EMPTY, languages: ["pl"] }, "contact")).toBe(true);
    expect(hasPracticalContent({ ...EMPTY, socialHashtag: "Kongres2026" }, "contact")).toBe(true);
    expect(hasPracticalContent({ ...EMPTY, supportEmail: "biuro@example.org" }, "contact")).toBe(
      true,
    );
    expect(hasPracticalContent({ ...EMPTY, languages: ["pl"] }, "map")).toBe(false);
  });

  it("wydarzenie bez zadnej informacji nie oddaje ZADNEJ sekcji", () => {
    expect(hasPracticalContent(EMPTY, "map")).toBe(false);
    expect(hasPracticalContent(EMPTY, "contact")).toBe(false);
  });

  it("krzyzyk jest prezentacja - wklejony hashtag schodzi do samej nazwy", () => {
    expect(eventHashtag({ ...EMPTY, socialHashtag: "##Kongres2026" })).toBe("Kongres2026");
    expect(eventHashtag({ ...EMPTY, socialHashtag: "  " })).toBe("");
  });

  it("napis, ktory nie jest adresem e-mail, NIE dostaje mailto ani nie liczy sie do tresci", () => {
    // `mailto:` przyjmuje naglowki po `?`, wiec smiec z bazy nie moze trafic
    // do atrybutu href - i nie moze wywolac pustej karty „Kontakt".
    const junk: EventPracticalInfo = { ...EMPTY, supportEmail: "biuro@example.org?bcc=zly@x.pl" };
    expect(eventSupportEmail(junk)).toBe("");
    expect(hasPracticalContent(junk, "contact")).toBe(false);
    expect(eventSupportEmail({ ...EMPTY, supportEmail: "biuro@example.org" })).toBe(
      "biuro@example.org",
    );
  });

  it("zna dokladnie dwa klucze sekcji praktycznych", () => {
    expect(isEventPracticalSection("map")).toBe(true);
    expect(isEventPracticalSection("contact")).toBe(true);
    expect(isEventPracticalSection("agenda")).toBe(false);
  });
});

describe("eventBrandingCss - zakres i pomijanie pustych slotow", () => {
  it("reguly wchodza pod atrybut wydarzenia, NIGDY pod :root", () => {
    const css = eventBrandingCss({ main_action: "#123456" });
    expect(css.startsWith("[data-event-branding]{")).toBe(true);
    expect(css).not.toContain(":root");
    expect(eventBrandingScopeProps).toEqual({ "data-event-branding": "" });
  });

  it("slot wypelniony nadpisuje wlasna zmienna I token semantyczny", () => {
    const css = eventBrandingCss({ main_action: "#123456", page_background: "#FFFFFF" });
    expect(css).toContain("--event-action:#123456;");
    expect(css).toContain("--primary:#123456;");
    expect(css).toContain("--ring:#123456;");
    expect(css).toContain("--background:#FFFFFF;");
  });

  it("pusty slot NIE generuje deklaracji - pusta wartosc wygralaby kaskade", () => {
    const css = eventBrandingCss({ main_action: "#123456" });
    expect(css).not.toContain("--background");
    expect(css).not.toContain("--foreground");
  });

  it("smiec zamiast koloru degraduje do dziedziczenia, a nie do deklaracji", () => {
    expect(eventBrandingCss({ main_action: "red" })).toBe("");
    expect(eventBrandingCss({ text: "#12345" })).toBe("");
    expect(eventBrandingCss(null)).toBe("");
    expect(eventBrandingCss("nie obiekt")).toBe("");
    expect(eventBrandingCss({})).toBe("");
  });

  it("obraz tla spoza `https://` bez znakow ucieczki NIE wchodzi do url()", () => {
    expect(eventBrandingCss({ background_image: 'https://a/x.jpg");body{display:none' })).toBe("");
    expect(eventBrandingCss({ background_image: "http://a/x.jpg" })).toBe("");
    expect(eventBrandingCss({ background_image: "https://cdn.example.org/tlo.jpg" })).toContain(
      '--event-bg-image:url("https://cdn.example.org/tlo.jpg");',
    );
  });
});
