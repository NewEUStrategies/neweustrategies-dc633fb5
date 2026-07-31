// Testy czystego buildera ItemList dla CollectionPage /tracker: fallbacki
// tytułów PL<->EN, lokalizowane URL-e (EN pod /en), pozycje 1-N, opcjonalny
// legislationIdentifier i degradacja do ścieżek względnych bez origin.
import { describe, it, expect } from "vitest";
import { trackerItemListJsonLd, type TrackerListEntry } from "@/lib/tracker/jsonld";

const ORIGIN = "https://neweuropeanstrategies.com";

function entry(overrides: Partial<TrackerListEntry> = {}): TrackerListEntry {
  return {
    slug: "ai-act",
    title_pl: "Akt o sztucznej inteligencji",
    title_en: "Artificial Intelligence Act",
    reference: "2021/0106(COD)",
    ...overrides,
  };
}

type ListItem = {
  "@type": string;
  position: number;
  item: { "@type": string; name: string; url: string; legislationIdentifier?: string };
};

function elements(node: Record<string, unknown>): ListItem[] {
  return node.itemListElement as ListItem[];
}

describe("trackerItemListJsonLd", () => {
  it("zwraca null dla pustej listy - CollectionPage bez mainEntity pozostaje ważne", () => {
    expect(trackerItemListJsonLd([], ORIGIN, "pl")).toBeNull();
  });

  it("buduje ItemList z pozycjami 1..N i licznikiem numberOfItems", () => {
    const node = trackerItemListJsonLd([entry(), entry({ slug: "cra" })], ORIGIN, "pl");
    expect(node).not.toBeNull();
    expect(node!["@type"]).toBe("ItemList");
    expect(node!.numberOfItems).toBe(2);
    expect(elements(node!).map((el) => el.position)).toEqual([1, 2]);
  });

  it("PL: tytuł polski i kanoniczny URL bez prefiksu języka", () => {
    const [el] = elements(trackerItemListJsonLd([entry()], ORIGIN, "pl")!);
    expect(el.item["@type"]).toBe("Legislation");
    expect(el.item.name).toBe("Akt o sztucznej inteligencji");
    expect(el.item.url).toBe(`${ORIGIN}/tracker/ai-act`);
  });

  it("EN: tytuł angielski i URL pod prefiksem /en", () => {
    const [el] = elements(trackerItemListJsonLd([entry()], ORIGIN, "en")!);
    expect(el.item.name).toBe("Artificial Intelligence Act");
    expect(el.item.url).toBe(`${ORIGIN}/en/tracker/ai-act`);
  });

  it("fallback tytułu: pusty wariant językowy spada na drugi język", () => {
    const noPl = entry({ title_pl: "" });
    const noEn = entry({ title_en: "" });
    expect(elements(trackerItemListJsonLd([noPl], ORIGIN, "pl")!)[0].item.name).toBe(
      "Artificial Intelligence Act",
    );
    expect(elements(trackerItemListJsonLd([noEn], ORIGIN, "en")!)[0].item.name).toBe(
      "Akt o sztucznej inteligencji",
    );
  });

  it("legislationIdentifier tylko gdy dossier ma referencję procedury", () => {
    const withRef = elements(trackerItemListJsonLd([entry()], ORIGIN, "pl")!)[0];
    const withoutRef = elements(
      trackerItemListJsonLd([entry({ reference: null })], ORIGIN, "pl")!,
    )[0];
    expect(withRef.item.legislationIdentifier).toBe("2021/0106(COD)");
    expect("legislationIdentifier" in withoutRef.item).toBe(false);
  });

  it("bez origin (testy/URL względny) degraduje do ścieżek względnych", () => {
    const [el] = elements(trackerItemListJsonLd([entry()], "", "en")!);
    expect(el.item.url).toBe("/en/tracker/ai-act");
  });
});
