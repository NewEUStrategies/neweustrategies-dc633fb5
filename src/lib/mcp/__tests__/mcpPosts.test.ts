// Wspólny model wpisów /mcp: wybór języka, kształt odpowiedzi i sanityzacja
// frazy wyszukiwania.
import { describe, expect, it } from "vitest";

import {
  pickLocalized,
  toIlikePattern,
  toPostSummaryJson,
  type PostSummaryRow,
} from "@/lib/mcp/posts";

const ROW: PostSummaryRow = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "traktat-o-cle",
  title_pl: "Traktat o cle",
  title_en: "Treaty on tariffs",
  excerpt_pl: "Skrót po polsku",
  excerpt_en: null,
  cover_image_url: "https://cdn.example.com/cover.jpg",
  published_at: "2026-08-01T10:00:00.000Z",
  post_format: "standard",
};

describe("pickLocalized", () => {
  it("bierze żądany język", () => {
    expect(pickLocalized("pl", "en", "pl")).toBe("pl");
    expect(pickLocalized("pl", "en", "en")).toBe("en");
  });

  it("gdy tłumaczenia brak, oddaje drugi język", () => {
    expect(pickLocalized("pl", null, "en")).toBe("pl");
    expect(pickLocalized("   ", "en", "pl")).toBe("en");
  });

  it("pusty tekst w obu językach to brak", () => {
    expect(pickLocalized("", " ", "pl")).toBeNull();
    expect(pickLocalized(null, null, "en")).toBeNull();
  });
});

describe("toPostSummaryJson", () => {
  it("nie ujawnia wewnętrznego `id` i wybiera język", () => {
    expect(toPostSummaryJson(ROW, "en")).toEqual({
      slug: "traktat-o-cle",
      title: "Treaty on tariffs",
      excerpt: "Skrót po polsku",
      cover_image_url: "https://cdn.example.com/cover.jpg",
      published_at: "2026-08-01T10:00:00.000Z",
      post_format: "standard",
    });
  });

  it("bez tytułu w obu językach podaje slug, nie pusty napis", () => {
    expect(toPostSummaryJson({ ...ROW, title_pl: "", title_en: "" }, "pl").title).toBe(
      "traktat-o-cle",
    );
  });
});

describe("toIlikePattern", () => {
  it("owija frazę w symbole wieloznaczne", () => {
    expect(toIlikePattern("cła UE")).toBe("%cła UE%");
  });

  it("usuwa wieloznaczniki LIKE i alias `*` PostgREST", () => {
    expect(toIlikePattern("a%b_c*d")).toBe("%abcd%");
  });

  it("usuwa metaznaki filtra `.or()` - fraza nie dopisze warunku", () => {
    expect(toIlikePattern('x),status.eq.draft,("\\')).toBe("%xstatus.eq.draft%");
  });

  it("fraza z samych metaznaków nie jest wyszukiwaniem", () => {
    expect(toIlikePattern("%_*(),")).toBeNull();
    expect(toIlikePattern("   ")).toBeNull();
  });
});
