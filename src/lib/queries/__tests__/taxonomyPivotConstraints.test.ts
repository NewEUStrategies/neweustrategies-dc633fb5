// KONTRAKT `postsConstrainedByTaxonomy` / `taxonomyConstraintsFromSlugs` -
// wspólnego zawężenia taksonomią dla widżetów buildera (slider, lista wpisów,
// lista oceniana, pasek newsów).
//
// CO TU JEST DO OBRONY
//
// 1. DOSŁOWNY NAPIS `select`. Literówka w nazwie osadzenia albo zgubione
//    `!inner` przechodzą przez tsc (patrz nagłówek `taxonomyPivot.ts`), a skutki
//    są ciche: bez `!inner` filtr włączający przestaje filtrować wpisy i widżet
//    pokazuje WSZYSTKO. Dlatego asercje porównują cały napis.
// 2. WYKLUCZENIE TO ANTY-ZŁĄCZENIE: osadzenie BEZ `!inner`, filtr po terminie
//    i `alias=is.null`. Zgubione `.is(alias, null)` zamienia wykluczenie
//    w no-op - wpisy wycięte przez redakcję wracają na stronę.
// 3. ALIAS OD POZYCJI. Ta sama tabela pośrednia potrafi wystąpić dwa razy, a
//    filtr osadzenia adresuje je po aliasie - kolizja aliasów skleiłaby dwa
//    warunki w jeden.
// 4. SŁOWNIKI: najwyżej jedno zapytanie na rodzaj, błąd RZUCA, nieznany slug
//    włączający daje `null` (pusto z definicji), wykluczający - nic.
//
// Wejście przez publiczne funkcje modułu, klient Supabase podstawiony
// wspólnym rejestratorem łańcuchów (`@/test/supabase`). Faktyczną postać
// adresu URL, jaką z tych łańcuchów robi postgrest-js, mierzy osobno
// `lib/builder/__tests__/widgetTaxonomyRequestLine.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabase";

const sb = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const fromStub = supabaseFromStub();
  sb.from = fromStub;
  return { supabase: { from: fromStub.from } };
});

import { fail, ok } from "@/test/supabase";
import {
  postsConstrainedByTaxonomy,
  taxonomyConstraintsFromSlugs,
  taxonomyTermIdsBySlug,
  type TaxonomyConstraint,
} from "@/lib/queries/taxonomyPivot";

function db(): SupabaseFromStub {
  if (!sb.from) throw new Error("test: atrapa `from` nie zostala zamontowana");
  return sb.from;
}

/** Buduje zapytanie i zwraca jego zapisany łańcuch (bez wysyłania). */
function chainFor(cols: string, constraints: readonly TaxonomyConstraint[]): RecordedChain {
  postsConstrainedByTaxonomy(cols, constraints);
  const chain = db().lastChain("posts");
  if (!chain) throw new Error("test: zapytanie o `posts` nie zostalo zbudowane");
  return chain;
}

function argsOfAll(chain: RecordedChain, method: string): ReadonlyArray<unknown>[] {
  return chain.calls.filter((c) => c.method === method).map((c) => c.args);
}

beforeEach(() => {
  db().reset();
});

describe("postsConstrainedByTaxonomy - budowa zapytania", () => {
  it("bez warunków select to DOKŁADNIE kolumny, bez żadnego filtra", () => {
    const chain = chainFor("id, slug", []);

    expect(chain.argsOf("select")).toEqual(["id, slug", undefined]);
    expect(chain.has("in")).toBe(false);
    expect(chain.has("is")).toBe(false);
  });

  it("włączenie kategorii to PUSTE osadzenie !inner z filtrem po id kategorii", () => {
    const chain = chainFor("id", [{ mode: "include", kind: "category", termIds: ["c-1", "c-2"] }]);

    expect(chain.argsOf("select")?.[0]).toBe("id, tx_inc_category_0:post_categories!inner()");
    expect(argsOfAll(chain, "in")).toEqual([["tx_inc_category_0.category_id", ["c-1", "c-2"]]]);
    expect(chain.has("is")).toBe(false);
  });

  it("wykluczenie tagu to osadzenie BEZ !inner, filtr po id tagu i alias=is.null", () => {
    const chain = chainFor("id", [{ mode: "exclude", kind: "tag", termIds: ["t-9"] }]);

    expect(chain.argsOf("select")?.[0]).toBe("id, tx_exc_tag_0:post_tags()");
    expect(argsOfAll(chain, "in")).toEqual([["tx_exc_tag_0.tag_id", ["t-9"]]]);
    expect(argsOfAll(chain, "is")).toEqual([["tx_exc_tag_0", null]]);
  });

  it("cztery warunki naraz: KAŻDY ma własny alias, także dwa razy ta sama tabela", () => {
    const chain = chainFor("id", [
      { mode: "include", kind: "category", termIds: ["c-1"] },
      { mode: "include", kind: "tag", termIds: ["t-1"] },
      { mode: "exclude", kind: "category", termIds: ["c-x"] },
      { mode: "exclude", kind: "tag", termIds: ["t-x"] },
    ]);

    expect(chain.argsOf("select")?.[0]).toBe(
      "id, tx_inc_category_0:post_categories!inner(), tx_inc_tag_1:post_tags!inner(), " +
        "tx_exc_category_2:post_categories(), tx_exc_tag_3:post_tags()",
    );
    expect(argsOfAll(chain, "in")).toEqual([
      ["tx_inc_category_0.category_id", ["c-1"]],
      ["tx_inc_tag_1.tag_id", ["t-1"]],
      ["tx_exc_category_2.category_id", ["c-x"]],
      ["tx_exc_tag_3.tag_id", ["t-x"]],
    ]);
    // Tylko wykluczenia dostają `is.null` - na włączeniu odwróciłoby ono sens.
    expect(argsOfAll(chain, "is")).toEqual([
      ["tx_exc_category_2", null],
      ["tx_exc_tag_3", null],
    ]);
  });

  it("wykluczenie BEZ terminów jest pomijane (żadnego złączenia), a aliasy zostają ciągłe", () => {
    const chain = chainFor("id", [
      { mode: "exclude", kind: "category", termIds: [] },
      { mode: "include", kind: "tag", termIds: ["t-1"] },
    ]);

    expect(chain.argsOf("select")?.[0]).toBe("id, tx_inc_tag_0:post_tags!inner()");
    expect(argsOfAll(chain, "in")).toEqual([["tx_inc_tag_0.tag_id", ["t-1"]]]);
    expect(chain.has("is")).toBe(false);
  });

  it("włączenie BEZ terminów ZOSTAJE i daje pusty wynik (nie wolno go po cichu zgubić)", () => {
    // Zgubienie pustego włączenia zamieniłoby "wpis z żadnej z zero kategorii"
    // w "dowolny wpis" - widżet pokazałby wszystko zamiast niczego.
    const chain = chainFor("id", [{ mode: "include", kind: "category", termIds: [] }]);

    expect(chain.argsOf("select")?.[0]).toBe("id, tx_inc_category_0:post_categories!inner()");
    expect(argsOfAll(chain, "in")).toEqual([["tx_inc_category_0.category_id", []]]);
  });

  it("opcje select (count) przechodzą bez zmian, a lista terminów jest KOPIĄ", () => {
    const termIds = ["c-1"];
    postsConstrainedByTaxonomy("id", [{ mode: "include", kind: "category", termIds }], {
      count: "exact",
    });
    const chain = db().lastChain("posts");

    expect(chain?.argsOf("select")?.[1]).toEqual({ count: "exact" });
    const passed = chain?.argsOf("in")?.[1];
    expect(passed).toEqual(["c-1"]);
    expect(passed).not.toBe(termIds);
  });
});

describe("taxonomyTermIdsBySlug - słownik slug -> id", () => {
  it("bez slugów NIE pyta bazy", async () => {
    await expect(taxonomyTermIdsBySlug("category", [])).resolves.toEqual(new Map());
    expect(db().chains).toHaveLength(0);
  });

  it("pyta właściwy słownik o id i slug, a powtórzone slugi wysyła RAZ", async () => {
    db().setResponse("tags", () => ok([{ id: "t-1", slug: "ue" }]));

    const map = await taxonomyTermIdsBySlug("tag", ["ue", "ue", "nato"]);

    const chain = db().lastChain("tags");
    expect(chain?.argsOf("select")).toEqual(["id, slug"]);
    expect(chain?.argsOf("in")).toEqual(["slug", ["ue", "nato"]]);
    expect(map.get("ue")).toBe("t-1");
    expect(map.has("nato")).toBe(false);
    expect(db().chainsFor("categories")).toHaveLength(0);
  });

  it("odmowa odczytu RZUCA, a brak wierszy (data null) daje pustą mapę", async () => {
    db().setResponse("categories", () => fail("permission denied for table categories", "42501"));
    await expect(taxonomyTermIdsBySlug("category", ["ue"])).rejects.toThrow(/permission denied/);

    db().setResponse("categories", () => ok(null));
    await expect(taxonomyTermIdsBySlug("category", ["ue"])).resolves.toEqual(new Map());
  });
});

describe("taxonomyConstraintsFromSlugs - slugi widżetu -> warunki", () => {
  it("bez slugów: pusta lista warunków i ZERO zapytań", async () => {
    await expect(taxonomyConstraintsFromSlugs({})).resolves.toEqual([]);
    await expect(
      taxonomyConstraintsFromSlugs({ includeCategories: [], excludeTags: [] }),
    ).resolves.toEqual([]);
    expect(db().chains).toHaveLength(0);
  });

  it("włączenia i wykluczenia jednego rodzaju jadą JEDNYM zapytaniem do słownika", async () => {
    db().setResponse("categories", () =>
      ok([
        { id: "c-1", slug: "analizy" },
        { id: "c-x", slug: "sponsorowane" },
      ]),
    );
    db().setResponse("tags", () =>
      ok([
        { id: "t-1", slug: "ue" },
        { id: "t-x", slug: "archiwum" },
      ]),
    );

    const constraints = await taxonomyConstraintsFromSlugs({
      includeCategories: ["analizy"],
      includeTags: ["ue"],
      excludeCategories: ["sponsorowane"],
      excludeTags: ["archiwum"],
    });

    expect(db().chainsFor("categories")).toHaveLength(1);
    expect(db().chainsFor("tags")).toHaveLength(1);
    expect(db().lastChain("categories")?.argsOf("in")).toEqual([
      "slug",
      ["analizy", "sponsorowane"],
    ]);
    // Kolejność warunków jest stała: włączenia przed wykluczeniami, kategoria
    // przed tagiem - od niej zależą aliasy, a więc dosłowny łańcuch.
    expect(constraints).toEqual([
      { mode: "include", kind: "category", termIds: ["c-1"] },
      { mode: "include", kind: "tag", termIds: ["t-1"] },
      { mode: "exclude", kind: "category", termIds: ["c-x"] },
      { mode: "exclude", kind: "tag", termIds: ["t-x"] },
    ]);
  });

  it("włączenie, które nie trafiło w ŻADEN termin, daje null (pusto z definicji)", async () => {
    db().setResponse("categories", () => ok([]));
    db().setResponse("tags", () => ok([{ id: "t-1", slug: "ue" }]));

    await expect(
      taxonomyConstraintsFromSlugs({ includeCategories: ["widmo"], includeTags: ["ue"] }),
    ).resolves.toBeNull();
  });

  it("nieznany slug WYKLUCZAJĄCY niczego nie wyklucza i nie zeruje wyniku", async () => {
    db().setResponse("categories", () => ok([{ id: "c-1", slug: "analizy" }]));

    await expect(
      taxonomyConstraintsFromSlugs({
        includeCategories: ["analizy"],
        excludeCategories: ["widmo"],
      }),
    ).resolves.toEqual([{ mode: "include", kind: "category", termIds: ["c-1"] }]);
  });

  it("częściowo trafione włączenie zostaje przy TRAFIONYCH terminach", async () => {
    db().setResponse("categories", () => ok([{ id: "c-1", slug: "analizy" }]));

    await expect(
      taxonomyConstraintsFromSlugs({ includeCategories: ["analizy", "widmo"] }),
    ).resolves.toEqual([{ mode: "include", kind: "category", termIds: ["c-1"] }]);
  });

  it("ten sam slug we włączeniu i wykluczeniu daje oba warunki (wynik pusty liczy baza)", async () => {
    db().setResponse("tags", () => ok([{ id: "t-1", slug: "ue" }]));

    await expect(
      taxonomyConstraintsFromSlugs({ includeTags: ["ue"], excludeTags: ["ue"] }),
    ).resolves.toEqual([
      { mode: "include", kind: "tag", termIds: ["t-1"] },
      { mode: "exclude", kind: "tag", termIds: ["t-1"] },
    ]);
    expect(db().lastChain("tags")?.argsOf("in")).toEqual(["slug", ["ue"]]);
  });

  it("odmowa odczytu słownika RZUCA - decyzję o pustce podejmuje wołający", async () => {
    db().setResponse("tags", () => fail("permission denied for table tags", "42501"));

    await expect(taxonomyConstraintsFromSlugs({ excludeTags: ["archiwum"] })).rejects.toThrow(
      /permission denied/,
    );
  });
});
