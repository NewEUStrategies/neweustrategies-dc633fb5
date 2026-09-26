// Nagłówki stron naboru i przycisk „Zgłoś prelekcję" w szablonie strony
// prelegentów.
//
// Strona naboru jest publiczna (tytuł z nazwą wydarzenia, jak Program), a trzy
// strony prywatne (formularz, panel prelegenta, panel recenzenta) mają tytuł
// w języku adresu i `noindex`.
import { describe, expect, it } from "vitest";

import { buildEventPrivateHead, buildEventTabHead } from "@/lib/events/eventTabHead";
import {
  eventCfpHref,
  eventPageTemplateDocument,
  findEventPageTemplate,
} from "@/lib/events/eventPageTemplates";

function metaOf(meta: Array<Record<string, string>>, key: string): string | undefined {
  if (key === "title") return meta.find((m) => "title" in m)?.title;
  return meta.find((m) => m.name === key || m.property === key)?.content;
}

describe("buildEventTabHead - zakładka naboru", () => {
  it("tytuł i opis z nazwą wydarzenia w obu językach", () => {
    const pl = buildEventTabHead({
      tab: "cfp",
      url: "https://neweuropeanstrategies.com/events/kongres/cfp",
      lang: "pl",
      event: { titlePl: "Kongres", titleEn: "Congress", cover: null },
    });
    expect(metaOf(pl.meta, "og:title")).toBe("Nabór prelegentów - Kongres");
    expect(metaOf(pl.meta, "description")).toContain("Kongres");
    const en = buildEventTabHead({
      tab: "cfp",
      url: "https://neweuropeanstrategies.com/en/events/kongres/cfp",
      lang: "en",
      event: { titlePl: "Kongres", titleEn: "Congress", cover: null },
    });
    expect(metaOf(en.meta, "og:title")).toBe("Call for speakers - Congress");
  });
});

describe("buildEventPrivateHead", () => {
  it.each([
    ["cfpSubmit", "pl", "Zgłoszenie wystąpienia - New European Strategies"],
    ["speakerPanel", "en", "Speaker panel - New European Strategies"],
    ["reviewPanel", "pl", "Panel recenzenta - New European Strategies"],
  ] as const)("%s (%s)", (page, lang, title) => {
    const head = buildEventPrivateHead({ page, lang });
    expect(metaOf(head.meta, "title")).toBe(title);
    expect(metaOf(head.meta, "robots")).toBe("noindex, nofollow");
    expect(head.links).toEqual([]);
  });
});

describe("szablon strony prelegentów - przycisk do naboru", () => {
  it("adres naboru ze slugiem wydarzenia, bez sluga `#`", () => {
    expect(eventCfpHref({ eventSlug: "kongres 2026" })).toBe("/events/kongres%202026/cfp");
    expect(eventCfpHref({ eventSlug: "  " })).toBe("#");
    expect(eventCfpHref({ eventSlug: null })).toBe("#");
    expect(eventCfpHref(undefined)).toBe("#");
  });

  it("dokument szablonu niesie adres naboru w przycisku CTA", () => {
    const doc = eventPageTemplateDocument("event-page-speakers", { eventSlug: "kongres" });
    expect(JSON.stringify(doc)).toContain('"href":"/events/kongres/cfp"');
    const withoutSlug = findEventPageTemplate("event-page-speakers")?.build();
    expect(JSON.stringify(withoutSlug)).toContain('"href":"#"');
  });
});
