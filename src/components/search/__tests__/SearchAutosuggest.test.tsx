import { describe, it, expect } from "vitest";
import type { AutosuggestItem } from "@/lib/queries/archives";
import { orderSuggestions } from "@/lib/search/facetModel";

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
  it("porządkuje grupy: publikacje → autorzy → termy", () => {
    const items: AutosuggestItem[] = [
      it0({ kind: "region", id: "r", score: 0.9 }),
      it0({ kind: "author", id: "a", score: 0.5 }),
      it0({ kind: "post", id: "p", score: 0.1 }),
    ];
    expect(orderSuggestions(items).map((i) => i.kind)).toEqual(["post", "author", "region"]);
  });

  it("w obrębie grupy sortuje malejąco po score", () => {
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
