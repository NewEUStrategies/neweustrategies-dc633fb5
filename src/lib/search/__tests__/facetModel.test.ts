import { describe, it, expect } from "vitest";
import type { FacetValue } from "@/lib/queries/archives";
import {
  urlToFilters,
  groupFacets,
  orderTree,
  activeSelections,
  hasAnyFilter,
  collectLabels,
  DIM_PARAM,
  PARAM_DIM,
  type SearchUrl,
} from "@/lib/search/facetModel";

const fv = (p: Partial<FacetValue>): FacetValue => ({
  dim: "region",
  id: null,
  slug: "x",
  label_pl: "X",
  label_en: "X",
  parentId: null,
  count: 0,
  ...p,
});

describe("DIM_PARAM / PARAM_DIM", () => {
  it("są wzajemnie odwrotne", () => {
    for (const [dim, param] of Object.entries(DIM_PARAM)) {
      expect(PARAM_DIM[param]).toBe(dim);
    }
  });
});

describe("urlToFilters", () => {
  it("zbiera pojedyncze wybory wymiarów taksonomii w grupy (AND między wymiarami)", () => {
    const u: SearchUrl = { q: "energia", type: "t1", region: "r1", topic: "top1" };
    const f = urlToFilters(u);
    expect(f.q).toBe("energia");
    expect(f.termGroups).toEqual({ pub_type: ["t1"], region: ["r1"], topic: ["top1"] });
  });

  it("wartości CSV wymiaru trafiają do jednej grupy (OR wewnątrz wymiaru)", () => {
    const f = urlToFilters({ q: "", topic: "a,b", region: "r1" });
    expect(f.termGroups).toEqual({ topic: ["a", "b"], region: ["r1"] });
  });

  it("pusty zestaw termów daje undefined (nie pusty obiekt)", () => {
    expect(urlToFilters({ q: "" }).termGroups).toBeUndefined();
  });

  it("rok mapuje się na zakres dat, gdy brak jawnych from/to", () => {
    const f = urlToFilters({ q: "", year: "2026" });
    expect(f.dateFrom).toBe("2026-01-01");
    expect(f.dateTo).toBe("2026-12-31");
  });

  it("jawne from/to mają pierwszeństwo nad rokiem", () => {
    const f = urlToFilters({ q: "", year: "2026", from: "2025-03-01" });
    expect(f.dateFrom).toBe("2025-03-01");
    expect(f.dateTo).toBeUndefined();
  });

  it("przepisuje skalarne filtry i domyślny sort", () => {
    const f = urlToFilters({ q: "", author: "a1", format: "video", lang: "pl", access: "members" });
    expect(f).toMatchObject({
      authorId: "a1",
      format: "video",
      lang: "pl",
      access: "members",
      sort: "relevance",
    });
  });

  it("organizacja (org) trafia do grup jak pozostałe wymiary taksonomii", () => {
    const f = urlToFilters({ q: "", org: "o1", topic: "t1" });
    expect(f.termGroups).toEqual({ organization: ["o1"], topic: ["t1"] });
  });

  it("tryby zaawansowane: match przepisany, wartość domyślna pomijana", () => {
    expect(urlToFilters({ q: "x", match: "phrase" }).match).toBe("phrase");
    expect(urlToFilters({ q: "x", match: "all" }).match).toBeUndefined();
    expect(urlToFilters({ q: "x" }).match).toBeUndefined();
  });

  it("zakres: scope=title przepisany, zakładka titles wymusza zakres tytułów", () => {
    expect(urlToFilters({ q: "x", scope: "title" }).scope).toBe("title");
    expect(urlToFilters({ q: "x", scope: "all" }).scope).toBeUndefined();
    expect(urlToFilters({ q: "x", tab: "titles" }).scope).toBe("title");
    expect(urlToFilters({ q: "x", tab: "people" }).scope).toBeUndefined();
  });
});

describe("groupFacets", () => {
  it("grupuje po wymiarze i sortuje malejąco po liczności", () => {
    const facets: FacetValue[] = [
      fv({ dim: "pub_type", id: "a", slug: "a", count: 2, label_pl: "A" }),
      fv({ dim: "pub_type", id: "b", slug: "b", count: 5, label_pl: "B" }),
      fv({ dim: "author", id: "c", slug: "c", count: 1 }),
    ];
    const g = groupFacets(facets);
    expect(g.get("pub_type")!.map((x) => x.id)).toEqual(["b", "a"]);
    expect(g.get("author")!).toHaveLength(1);
  });
});

describe("orderTree", () => {
  it("porządkuje rodzica przed potomkiem z narastającą głębokością", () => {
    const values: FacetValue[] = [
      fv({ id: "polska", slug: "polska", parentId: "europa", count: 1, label_pl: "Polska" }),
      fv({ id: "europa", slug: "europa", parentId: null, count: 3, label_pl: "Europa" }),
    ];
    const ordered = orderTree(values);
    expect(ordered.map((o) => o.value.id)).toEqual(["europa", "polska"]);
    expect(ordered.map((o) => o.depth)).toEqual([0, 1]);
  });

  it("dziecko bez widocznego rodzica traktuje jako korzeń (depth 0)", () => {
    const values: FacetValue[] = [
      fv({ id: "polska", slug: "polska", parentId: "europa", count: 1, label_pl: "Polska" }),
    ];
    const ordered = orderTree(values);
    expect(ordered).toHaveLength(1);
    expect(ordered[0].depth).toBe(0);
  });
});

describe("activeSelections / hasAnyFilter", () => {
  it("wypisuje aktywne filtry z kluczami URL do wyczyszczenia", () => {
    const u: SearchUrl = { q: "x", type: "t1", author: "a1", access: "members" };
    const sels = activeSelections(u);
    expect(sels.find((s) => s.dim === "pub_type")?.keys).toEqual(["type"]);
    expect(sels.find((s) => s.dim === "author")?.value).toBe("a1");
    expect(sels.some((s) => s.dim === "access")).toBe(true);
    expect(hasAnyFilter(u)).toBe(true);
  });

  it("zakres dat to jeden chip czyszczący from+to", () => {
    const sels = activeSelections({ q: "", from: "2020-01-01", to: "2020-12-31" });
    const date = sels.find((s) => s.dim === "date");
    expect(date?.keys).toEqual(["from", "to"]);
  });

  it("rok tłumi chip dat (rok jest źródłem prawdy)", () => {
    const sels = activeSelections({ q: "", year: "2026", from: "2026-01-01", to: "2026-12-31" });
    expect(sels.some((s) => s.dim === "date")).toBe(false);
    expect(sels.some((s) => s.dim === "year")).toBe(true);
  });

  it("sama fraza nie jest filtrem", () => {
    expect(hasAnyFilter({ q: "energia" })).toBe(false);
  });

  it("tryby zaawansowane są usuwalnymi chipami (match/scope), domyślne nie", () => {
    const sels = activeSelections({ q: "x", match: "phrase", scope: "title" });
    expect(sels.find((s) => s.dim === "match")?.keys).toEqual(["match"]);
    expect(sels.find((s) => s.dim === "scope")?.value).toBe("title");
    expect(activeSelections({ q: "x", match: "all", scope: "all" })).toHaveLength(0);
  });

  it("filtr organizacji jest chipem czyszczącym parametr org", () => {
    const sels = activeSelections({ q: "", org: "o1" });
    expect(sels.find((s) => s.dim === "organization")?.keys).toEqual(["org"]);
    expect(sels.find((s) => s.dim === "organization")?.patch).toEqual({ org: undefined });
  });

  it("multi-select: chip per wartość, łatka zdejmuje tylko tę wartość", () => {
    const sels = activeSelections({ q: "", topic: "a,b" });
    const topics = sels.filter((s) => s.dim === "topic");
    expect(topics.map((s) => s.value)).toEqual(["a", "b"]);
    expect(topics[0].patch).toEqual({ topic: "b" });
    expect(topics[1].patch).toEqual({ topic: "a" });
  });

  it("multi-select: ostatnia wartość wymiaru czyści parametr do undefined", () => {
    const sels = activeSelections({ q: "", topic: "a" });
    expect(sels.find((s) => s.dim === "topic")?.patch).toEqual({ topic: undefined });
  });
});

describe("collectLabels", () => {
  it("buforuje etykiety termów po id oraz bez-id po dim:slug", () => {
    const facets: FacetValue[] = [
      fv({ dim: "region", id: "europa", slug: "europa", label_pl: "Europa", label_en: "Europe" }),
      fv({ dim: "format", id: null, slug: "video", label_pl: "Wideo", label_en: "Video" }),
    ];
    const pl = collectLabels(facets, "pl", {});
    expect(pl["europa"]).toBe("Europa");
    expect(pl["format:video"]).toBe("Wideo");
    const en = collectLabels(facets, "en", {});
    expect(en["europa"]).toBe("Europe");
  });

  it("zachowuje wcześniejsze wpisy (merge, nie nadpisanie całości)", () => {
    const merged = collectLabels([fv({ id: "a", label_pl: "A" })], "pl", { z: "Z" });
    expect(merged["z"]).toBe("Z");
    expect(merged["a"]).toBe("A");
  });
});
