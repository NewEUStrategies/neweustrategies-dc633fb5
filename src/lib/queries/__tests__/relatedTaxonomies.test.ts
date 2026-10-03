// „Powiązane kategorie / tagi" archiwum - fabryka zapytania.
//
// CO TO DOWODZI. Do 03.10.2026 sekcja pod listą i widżet sidebara pytały
// `categories` / `tags` o DOWOLNE inne wiersze (`.neq("id", ...).limit(12 | 10)`,
// bez `ORDER BY`) - każda własnym kluczem cache. Teraz jedna fabryka woła
// `related_taxonomies` (ranking ze współwystępowania liczony w bazie). Tu
// przypinamy to, czego nie złapie ani `tsc`, ani pgTAP:
//   * NAZWY ARGUMENTÓW RPC - obiekt argumentów jest luźny, więc literówka
//     w `_taxonomy_id` przechodzi przez kompilator, a baza dostaje NULL
//     i oddaje pustą listę: sekcja znika bez śladu;
//   * KOLEJNOŚĆ WIERSZY JEST KOLEJNOŚCIĄ RANKINGU - mapowanie nie może
//     sortować po swojemu ani gubić wierszy;
//   * BŁĄD DAJE PUSTĄ LISTĘ - sekcja dekoracyjna nie może wywrócić archiwum
//     ani mielić ponowień;
//   * KLUCZ WSPÓLNY DLA OBU POWIERZCHNI - ten sam rodzaj, termin i limit to
//     ten sam wpis cache, czyli jedno żądanie na stronę.
//
// Treść rankingu (kosinus, szkice, najemcy, limit 1..24) należy do pgTAP
// (`supabase/tests/related_taxonomies_test.sql`) i nie jest tu dublowana.
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok } from "@/test/supabaseChain";
import type { RecordedRpc, SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseRpcStub } = await import("@/test/supabase/rpc");
  const rpc = supabaseRpcStub();
  h.rpc = rpc;
  return { supabase: { rpc: rpc.rpc, from: h.from } };
});

import {
  RELATED_TAXONOMIES_LIMIT,
  relatedTaxonomiesQueryOptions,
} from "@/lib/queries/relatedTaxonomies";

function funkcje(): SupabaseRpcStub {
  const s = h.rpc;
  if (!s) throw new Error("test: atrapa RPC Supabase nie została podpięta");
  return s;
}

function wywolanie(): RecordedRpc {
  const c = funkcje().lastCall("related_taxonomies");
  if (!c) throw new Error('test: kod nie wywołał RPC "related_taxonomies"');
  return c;
}

function klient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

/** Wiersz w kształcie zwracanym przez funkcję SQL (z polami rankingu). */
function wiersz(slug: string, shared: number, score: number) {
  return {
    id: `id-${slug}`,
    slug,
    name_pl: `PL ${slug}`,
    name_en: `EN ${slug}`,
    shared_posts: shared,
    score,
  };
}

beforeEach(() => {
  funkcje().reset();
  h.from.mockReset();
});

describe("relatedTaxonomiesQueryOptions - kontrakt z funkcją SQL", () => {
  it("woła related_taxonomies z rodzajem, terminem i limitem pod DOKŁADNYMI nazwami", async () => {
    funkcje().setResponse("related_taxonomies", ok([]));
    await klient().fetchQuery(relatedTaxonomiesQueryOptions("category", "cat-1"));

    const call = wywolanie();
    expect(call.keys().sort()).toEqual(["_kind", "_limit", "_taxonomy_id"]);
    expect(call.arg("_kind")).toBe("category");
    expect(call.arg("_taxonomy_id")).toBe("cat-1");
    expect(call.arg("_limit")).toBe(RELATED_TAXONOMIES_LIMIT);
  });

  it("dla tagu przekazuje rodzaj 'tag' i jawny limit", async () => {
    funkcje().setResponse("related_taxonomies", ok([]));
    await klient().fetchQuery(relatedTaxonomiesQueryOptions("tag", "tag-9", 5));

    expect(wywolanie().arg("_kind")).toBe("tag");
    expect(wywolanie().arg("_taxonomy_id")).toBe("tag-9");
    expect(wywolanie().arg("_limit")).toBe(5);
  });

  it("NIE czyta tabel categories / tags wprost - to był stary szum", async () => {
    funkcje().setResponse("related_taxonomies", ok([]));
    await klient().fetchQuery(relatedTaxonomiesQueryOptions("category", "cat-1"));
    expect(h.from).not.toHaveBeenCalled();
  });

  it("zachowuje kolejność rankingu i oddaje wyłącznie pola potrzebne chipom", async () => {
    funkcje().setResponse(
      "related_taxonomies",
      ok([wiersz("klimat", 2, 0.71), wiersz("migracje", 2, 0.5), wiersz("hub", 3, 0.34)]),
    );
    const out = await klient().fetchQuery(relatedTaxonomiesQueryOptions("category", "cat-1"));

    expect(out).toEqual([
      { id: "id-klimat", slug: "klimat", name_pl: "PL klimat", name_en: "EN klimat" },
      { id: "id-migracje", slug: "migracje", name_pl: "PL migracje", name_en: "EN migracje" },
      { id: "id-hub", slug: "hub", name_pl: "PL hub", name_en: "EN hub" },
    ]);
  });

  it("odmowa bazy daje PUSTĄ listę, nie wyjątek", async () => {
    funkcje().setResponse("related_taxonomies", fail("permission denied", "42501"));
    await expect(
      klient().fetchQuery(relatedTaxonomiesQueryOptions("category", "cat-1")),
    ).resolves.toEqual([]);
  });

  it("brak danych (null) też daje pustą listę", async () => {
    funkcje().setResponse("related_taxonomies", ok(null));
    await expect(
      klient().fetchQuery(relatedTaxonomiesQueryOptions("tag", "tag-1")),
    ).resolves.toEqual([]);
  });
});

describe("relatedTaxonomiesQueryOptions - wspólny cache", () => {
  it("klucz niesie rodzaj, termin i limit w przestrzeni publicznej", () => {
    expect(relatedTaxonomiesQueryOptions("category", "cat-1").queryKey).toEqual([
      "public",
      "related-taxonomies",
      "category",
      "cat-1",
      RELATED_TAXONOMIES_LIMIT,
    ]);
  });

  it("dwa odczyty tego samego terminu to JEDNO żądanie (sekcja + widżet)", async () => {
    funkcje().setResponse("related_taxonomies", ok([wiersz("klimat", 2, 0.71)]));
    const qc = klient();
    await Promise.all([
      qc.fetchQuery(relatedTaxonomiesQueryOptions("category", "cat-1")),
      qc.fetchQuery(relatedTaxonomiesQueryOptions("category", "cat-1")),
    ]);
    expect(funkcje().callsFor("related_taxonomies")).toHaveLength(1);
  });

  it("kategoria i tag o tym samym identyfikatorze to RÓŻNE wpisy", () => {
    expect(relatedTaxonomiesQueryOptions("category", "x").queryKey).not.toEqual(
      relatedTaxonomiesQueryOptions("tag", "x").queryKey,
    );
  });
});
