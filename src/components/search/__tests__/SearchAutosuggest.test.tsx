import { describe, it, expect } from "vitest";
import type { AutosuggestItem } from "@/lib/queries/archives";
import {
  orderSuggestions,
  suggestBucketOf,
  suggestionHref,
  SUGGEST_BUCKET_LABELS,
} from "@/lib/search/facetModel";

const it0 = (p: Partial<AutosuggestItem>): AutosuggestItem => ({
  kind: "post",
  id: "1",
  slug: "s",
  label_pl: "L",
  label_en: "L",
  parentPageId: null,
  score: 0,
  ...p,
});

describe("orderSuggestions", () => {
  it("porządkuje kubełki: tytuły → rodzaje treści → tematyka → osoby i organizacje", () => {
    const items: AutosuggestItem[] = [
      it0({ kind: "author", id: "a", score: 0.9 }),
      it0({ kind: "region", id: "r", score: 0.9 }),
      it0({ kind: "pub_type", id: "t", score: 0.5 }),
      it0({ kind: "post", id: "p", score: 0.1 }),
    ];
    expect(orderSuggestions(items).map((i) => i.kind)).toEqual([
      "post",
      "pub_type",
      "region",
      "author",
    ]);
  });

  it("organizacja ląduje w kubełku osób i organizacji", () => {
    const items: AutosuggestItem[] = [
      it0({ kind: "organization", id: "o", score: 0.9 }),
      it0({ kind: "topic", id: "t", score: 0.1 }),
    ];
    expect(orderSuggestions(items).map((i) => i.kind)).toEqual(["topic", "organization"]);
  });

  it("w obrębie kubełka sortuje malejąco po score", () => {
    const items: AutosuggestItem[] = [
      it0({ kind: "post", id: "p1", score: 0.2 }),
      it0({ kind: "post", id: "p2", score: 0.8 }),
    ];
    expect(orderSuggestions(items).map((i) => i.id)).toEqual(["p2", "p1"]);
  });

  it("nie mutuje wejścia", () => {
    const items: AutosuggestItem[] = [it0({ kind: "author" }), it0({ kind: "post" })];
    const copy = [...items];
    orderSuggestions(items);
    expect(items).toEqual(copy);
  });
});

describe("suggestBucketOf", () => {
  it("mapuje rodzaje podpowiedzi na cztery premium kubełki", () => {
    expect(suggestBucketOf("post")).toBe("titles");
    expect(suggestBucketOf("pub_type")).toBe("contentTypes");
    expect(suggestBucketOf("format")).toBe("contentTypes");
    expect(suggestBucketOf("access")).toBe("contentTypes");
    expect(suggestBucketOf("lang")).toBe("contentTypes");
    expect(suggestBucketOf("topic")).toBe("topics");
    expect(suggestBucketOf("region")).toBe("topics");
    expect(suggestBucketOf("author")).toBe("peopleOrg");
    expect(suggestBucketOf("organization")).toBe("peopleOrg");
  });

  it("ma etykiety PL i EN dla każdego kubełka", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const bucket of ["titles", "contentTypes", "topics", "peopleOrg"] as const) {
        expect(SUGGEST_BUCKET_LABELS[lang][bucket]).toBeTruthy();
      }
    }
  });
});

describe("suggestionHref", () => {
  it("publikacja prowadzi do permalinka /post/<slug>", () => {
    expect(suggestionHref(it0({ kind: "post", slug: "moj-wpis" }))).toBe("/post/moj-wpis");
  });

  it("autor filtruje /search po id", () => {
    expect(suggestionHref(it0({ kind: "author", id: "a-1", slug: "jan" }))).toBe(
      "/search?author=a-1",
    );
  });

  it("term taksonomii filtruje /search po ID (parametry _terms są uuid)", () => {
    expect(suggestionHref(it0({ kind: "topic", id: "t-1", slug: "energia" }))).toBe(
      "/search?topic=t-1",
    );
    expect(suggestionHref(it0({ kind: "organization", id: "o-1", slug: "nato" }))).toBe(
      "/search?org=o-1",
    );
  });

  it("wymiary wyliczane (format/rok) filtrują po slugu", () => {
    expect(suggestionHref(it0({ kind: "format", slug: "video" }))).toBe("/search?format=video");
    expect(suggestionHref(it0({ kind: "year", slug: "2026" }))).toBe("/search?year=2026");
  });
});
