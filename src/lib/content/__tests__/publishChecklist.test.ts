import { describe, it, expect } from "vitest";
import {
  buildPublishChecklist,
  isPublishTransition,
  type PublishChecklistInput,
} from "../publishChecklist";

const complete: PublishChecklistInput = {
  title_pl: "Analiza bezpieczeństwa energetycznego",
  title_en: "Energy security analysis",
  excerpt_pl: "Zajawka",
  excerpt_en: "Excerpt",
  cover_image_url: "https://cdn.example.com/cover.jpg",
  seo_description_pl: null,
  seo_description_en: null,
  seo_noindex: false,
  takeaways_pl: ["Punkt 1", "Punkt 2", "Punkt 3"],
  categoriesCount: 1,
  tagsCount: 2,
};

describe("buildPublishChecklist", () => {
  it("kompletny wpis: 100 punktów, wszystkie wymagane OK", () => {
    const cl = buildPublishChecklist(complete);
    expect(cl.requiredOk).toBe(true);
    expect(cl.score).toBe(100);
    expect(cl.missingRequired).toHaveLength(0);
    expect(cl.missingRecommended).toHaveLength(0);
  });

  it("brak okładki i kategorii: wymagane niespełnione, bramka aktywna", () => {
    const cl = buildPublishChecklist({ ...complete, cover_image_url: null, categoriesCount: 0 });
    expect(cl.requiredOk).toBe(false);
    expect(cl.missingRequired.map((i) => i.id)).toEqual(["cover", "category"]);
    expect(cl.score).toBe(100 - 2 * 15);
  });

  it("opis PL: wystarczy seo_description_pl LUB excerpt_pl", () => {
    const seoOnly = buildPublishChecklist({
      ...complete,
      excerpt_pl: null,
      seo_description_pl: "Opis SEO",
    });
    expect(seoOnly.missingRequired).toHaveLength(0);
    const none = buildPublishChecklist({ ...complete, excerpt_pl: "  ", seo_description_pl: null });
    expect(none.missingRequired.map((i) => i.id)).toEqual(["descriptionPl"]);
  });

  it("takeaways: puste stringi nie liczą się do minimum trzech", () => {
    const cl = buildPublishChecklist({ ...complete, takeaways_pl: ["A", " ", ""] });
    expect(cl.missingRecommended.map((i) => i.id)).toContain("takeaways");
  });

  it("wersja EN wymaga tytułu ORAZ zajawki/opisu", () => {
    const noExcerpt = buildPublishChecklist({
      ...complete,
      excerpt_en: null,
      seo_description_en: null,
    });
    expect(noExcerpt.missingRecommended.map((i) => i.id)).toContain("enVersion");
    const noTitle = buildPublishChecklist({ ...complete, title_en: "" });
    expect(noTitle.missingRecommended.map((i) => i.id)).toContain("enVersion");
  });

  it("noindex zgłasza pozycję indexable", () => {
    const cl = buildPublishChecklist({ ...complete, seo_noindex: true });
    expect(cl.missingRecommended.map((i) => i.id)).toContain("indexable");
  });
});

describe("isPublishTransition", () => {
  it("wejście do publikacji: draft/pending_review -> published/scheduled", () => {
    expect(isPublishTransition("draft", "published")).toBe(true);
    expect(isPublishTransition("pending_review", "published")).toBe(true);
    expect(isPublishTransition("draft", "scheduled")).toBe(true);
  });

  it("już publiczne przejścia nie wywołują bramki", () => {
    expect(isPublishTransition("published", "published")).toBe(false);
    expect(isPublishTransition("published", "scheduled")).toBe(false);
    expect(isPublishTransition("scheduled", "published")).toBe(false);
  });

  it("zejścia i statusy robocze bez bramki", () => {
    expect(isPublishTransition("published", "draft")).toBe(false);
    expect(isPublishTransition("draft", "pending_review")).toBe(false);
  });
});
