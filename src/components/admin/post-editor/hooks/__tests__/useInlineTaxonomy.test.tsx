// Tworzenie kategorii i tagów WPROST z edytora wpisu (`useInlineTaxonomy`,
// 0 z 3 funkcji przed tą zmianą).
//
// To jedyne miejsce w produkcie, w którym redaktor tworzy taksonomię POZA
// ekranem taksonomii — w trakcie pisania, bez opuszczania edytora. Trzy rzeczy
// są tu warte testu:
//
//   1. `tenant_id` USTAWIANY JAWNIE we wstawce. Kategoria bez tenanta albo
//      z cudzym tenantem wchodzi do słownika innej firmy — a słowniki
//      taksonomii są czytelne szeroko, więc RLS nie zatrzyma tego tak
//      jednoznacznie jak przy treści.
//   2. NOWY WPIS OD RAZU TRAFIA DO WYBORU. Utworzenie kategorii, której wpis
//      nie dostaje przypisanej, zmusza redaktora do szukania jej na liście —
//      a to jest dokładnie ta praca, której inline miał oszczędzić.
//   3. NIEUDANY ZAPIS NIE CZYŚCI PÓL. Wyczyszczenie formularza po błędzie
//      kasuje wpisaną nazwę i każe pisać od nowa.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fail, ok, type RecordedChain, type SupabaseFromStub } from "@/test/supabaseChain";
import { EDITOR_IDS } from "@/test/post-editor/fixtures";

const h = vi.hoisted(() => ({ toast: null as unknown }));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  h.toast = toast;
  return { toast, Toaster: () => null };
});

import { useInlineTaxonomy } from "../useInlineTaxonomy";

type Mock = ReturnType<typeof vi.fn>;
const db = stubs.from as SupabaseFromStub;
const toast = () => h.toast as Record<string, Mock>;

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const onCategoryCreated = vi.fn();
  const onTagCreated = vi.fn();
  const rendered = renderHook(
    () =>
      useInlineTaxonomy({
        tenantId: EDITOR_IDS.tenant,
        onCategoryCreated,
        onTagCreated,
      }),
    { wrapper },
  );
  return { ...rendered, client, onCategoryCreated, onTagCreated };
}

beforeEach(() => {
  db.reset();
  db.setResponse("categories", ok({ id: "cat-new", name_pl: "Fundusze", name_en: "Funds" }));
  db.setResponse("tags", ok({ id: "tag-new", name: "spójność" }));
  for (const fn of Object.values(toast())) fn.mockReset();
});

// ---------------------------------------------------------------------------
// Walidacja
// ---------------------------------------------------------------------------

describe("useInlineTaxonomy - walidacja przed zapisem", () => {
  it("pusta nazwa kategorii NIE trafia do bazy", () => {
    // Kategoria bez nazwy jest nie do znalezienia i nie do usunięcia z UI.
    const { result } = harness();

    act(() => void result.current.addCategory());

    expect(db.chainsFor("categories")).toHaveLength(0);
    expect(toast().error).toHaveBeenCalledWith("adminPostPanes.taxonomy.catNameRequired");
  });

  it("nazwa z samych spacji też jest odrzucana", () => {
    const { result } = harness();
    act(() => result.current.setNewCatPl("   "));

    act(() => void result.current.addCategory());

    expect(db.chainsFor("categories")).toHaveLength(0);
  });

  it("pusta nazwa tagu NIE trafia do bazy", () => {
    const { result } = harness();

    act(() => void result.current.addTag());

    expect(db.chainsFor("tags")).toHaveLength(0);
    expect(toast().error).toHaveBeenCalledWith("adminPostPanes.taxonomy.tagNameRequired");
  });
});

// ---------------------------------------------------------------------------
// Izolacja najemców
// ---------------------------------------------------------------------------

describe("useInlineTaxonomy - izolacja najemców", () => {
  it("wstawka kategorii pinuje tenant_id JAWNIE", async () => {
    // Słowniki taksonomii są czytelne szeroko, więc RLS nie zatrzyma tego tak
    // jednoznacznie jak przy treści - filtr musi być po stronie zapisu.
    const { result } = harness();
    act(() => result.current.setNewCatPl("Fundusze"));

    await act(async () => {
      await result.current.addCategory();
    });

    const chain = db.lastChain("categories") as RecordedChain;
    const [row] = (chain.argsOf("insert") ?? []) as [Record<string, unknown>];
    expect(row.tenant_id).toBe(EDITOR_IDS.tenant);
  });

  it("wstawka tagu pinuje tenant_id JAWNIE", async () => {
    const { result } = harness();
    act(() => result.current.setNewTagName("spójność"));

    await act(async () => {
      await result.current.addTag();
    });

    const [row] = (db.lastChain("tags")?.argsOf("insert") ?? []) as [Record<string, unknown>];
    expect(row.tenant_id).toBe(EDITOR_IDS.tenant);
  });
});

// ---------------------------------------------------------------------------
// Nazwy i slug
// ---------------------------------------------------------------------------

describe("useInlineTaxonomy - nazwy i slug", () => {
  it("nazwa EN pusta -> podstawiana jest nazwa PL", async () => {
    // Kategoria bez nazwy EN renderowałaby się w angielskim serwisie jako pusta.
    const { result } = harness();
    act(() => result.current.setNewCatPl("Fundusze"));

    await act(async () => {
      await result.current.addCategory();
    });

    const [row] = (db.lastChain("categories")?.argsOf("insert") ?? []) as [Record<string, unknown>];
    expect(row.name_pl).toBe("Fundusze");
    expect(row.name_en).toBe("Fundusze");
  });

  it("podana nazwa EN jest zachowana", async () => {
    const { result } = harness();
    act(() => {
      result.current.setNewCatPl("Fundusze");
      result.current.setNewCatEn("Funds");
    });

    await act(async () => {
      await result.current.addCategory();
    });

    const [row] = (db.lastChain("categories")?.argsOf("insert") ?? []) as [Record<string, unknown>];
    expect(row.name_en).toBe("Funds");
  });

  it("nazwy są przycinane z białych znaków", async () => {
    const { result } = harness();
    act(() => result.current.setNewCatPl("  Fundusze  "));

    await act(async () => {
      await result.current.addCategory();
    });

    const [row] = (db.lastChain("categories")?.argsOf("insert") ?? []) as [Record<string, unknown>];
    expect(row.name_pl).toBe("Fundusze");
  });

  it("slug powstaje z nazwy, z transliteracją polskich liter", async () => {
    // Slug kategorii jest częścią publicznego adresu archiwum.
    const { result } = harness();
    act(() => result.current.setNewCatPl("Miłość i Przyjaźń"));

    await act(async () => {
      await result.current.addCategory();
    });

    const [row] = (db.lastChain("categories")?.argsOf("insert") ?? []) as [Record<string, unknown>];
    expect(row.slug).toBe("milosc-i-przyjazn");
  });

  it("nazwa nieprzekładalna na slug dostaje awaryjny identyfikator", async () => {
    // Same znaki interpunkcyjne dałyby pusty slug, a kolumna go wymaga.
    const { result } = harness();
    act(() => result.current.setNewCatPl("!!!"));

    await act(async () => {
      await result.current.addCategory();
    });

    const [row] = (db.lastChain("categories")?.argsOf("insert") ?? []) as [Record<string, unknown>];
    expect(String(row.slug)).toMatch(/^cat-\d+$/);
  });

  it("tag nieprzekładalny na slug też dostaje awaryjny identyfikator", async () => {
    const { result } = harness();
    act(() => result.current.setNewTagName("???"));

    await act(async () => {
      await result.current.addTag();
    });

    const [row] = (db.lastChain("tags")?.argsOf("insert") ?? []) as [Record<string, unknown>];
    expect(String(row.slug)).toMatch(/^tag-\d+$/);
  });
});

// ---------------------------------------------------------------------------
// Po udanym zapisie
// ---------------------------------------------------------------------------

describe("useInlineTaxonomy - po udanym zapisie", () => {
  it("nowa kategoria jest OD RAZU przypisana do wpisu", async () => {
    // Bez tego redaktor musiałby jej szukać na liście - czyli robić dokładnie
    // tę pracę, której tworzenie inline miało oszczędzić.
    const { result, onCategoryCreated } = harness();
    act(() => result.current.setNewCatPl("Fundusze"));

    await act(async () => {
      await result.current.addCategory();
    });

    expect(onCategoryCreated).toHaveBeenCalledWith("cat-new");
  });

  it("nowy tag jest OD RAZU przypisany do wpisu", async () => {
    const { result, onTagCreated } = harness();
    act(() => result.current.setNewTagName("spójność"));

    await act(async () => {
      await result.current.addTag();
    });

    expect(onTagCreated).toHaveBeenCalledWith("tag-new");
  });

  it("pola formularza są czyszczone po sukcesie", async () => {
    const { result } = harness();
    act(() => {
      result.current.setNewCatPl("Fundusze");
      result.current.setNewCatEn("Funds");
    });

    await act(async () => {
      await result.current.addCategory();
    });

    await waitFor(() => {
      expect(result.current.newCatPl).toBe("");
      expect(result.current.newCatEn).toBe("");
    });
  });

  it("odświeża słownik TEGO tenanta, żeby nowa pozycja pojawiła się na liście", async () => {
    const { result, client } = harness();
    const spy = vi.spyOn(client, "invalidateQueries");
    act(() => result.current.setNewCatPl("Fundusze"));

    await act(async () => {
      await result.current.addCategory();
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["categories", EDITOR_IDS.tenant] }),
    );
  });

  it("melduje sukces NAZWĄ utworzonej pozycji", async () => {
    const { result } = harness();
    act(() => result.current.setNewTagName("spójność"));

    await act(async () => {
      await result.current.addTag();
    });

    const message = String(toast().success.mock.calls[0][0]);
    expect(message).toContain("adminPostPanes.taxonomy.tagAdded");
    expect(message).toContain("spójność");
  });
});

// ---------------------------------------------------------------------------
// Ścieżka błędu
// ---------------------------------------------------------------------------

describe("useInlineTaxonomy - ścieżka błędu", () => {
  it("błąd zapisu kategorii jest POKAZANY, a pola NIE są czyszczone", async () => {
    // Wyczyszczenie formularza po błędzie kasuje wpisaną nazwę i każe pisać
    // wszystko od nowa.
    db.setResponse("categories", fail("duplikat sluga"));
    const { result, onCategoryCreated } = harness();
    act(() => result.current.setNewCatPl("Fundusze"));

    await act(async () => {
      await result.current.addCategory();
    });

    expect(toast().error).toHaveBeenCalledWith("duplikat sluga");
    expect(toast().success).not.toHaveBeenCalled();
    expect(onCategoryCreated).not.toHaveBeenCalled();
    expect(result.current.newCatPl).toBe("Fundusze");
  });

  it("błąd zapisu tagu również nie czyści pola", async () => {
    db.setResponse("tags", fail("rls denied"));
    const { result, onTagCreated } = harness();
    act(() => result.current.setNewTagName("spójność"));

    await act(async () => {
      await result.current.addTag();
    });

    expect(toast().error).toHaveBeenCalledWith("rls denied");
    expect(onTagCreated).not.toHaveBeenCalled();
    expect(result.current.newTagName).toBe("spójność");
  });

  it("wskaźnik zajętości wraca do spoczynku także po błędzie", async () => {
    // Zablokowany przycisk po nieudanej próbie uniemożliwiłby powtórzenie.
    db.setResponse("categories", fail("cokolwiek"));
    const { result } = harness();
    act(() => result.current.setNewCatPl("Fundusze"));

    await act(async () => {
      await result.current.addCategory();
    });

    await waitFor(() => expect(result.current.taxonomyBusy).toBeNull());
  });

  it("wskaźnik zajętości jest USTAWIONY w trakcie zapisu i rozróżnia rodzaj", async () => {
    // Oba formularze stoją obok siebie; wspólny wskaźnik blokowałby oba naraz,
    // a brak wskaźnika pozwoliłby kliknąć „Dodaj" dwa razy i utworzyć duplikat.
    let release: (() => void) | undefined;
    db.setResponse("categories", () => {
      // Odpowiedź, która nie rozwiązuje się natychmiast - dzięki temu widzimy
      // stan POŚREDNI, a nie tylko końcowy.
      return ok({ id: "cat-new", name_pl: "x", name_en: "x" });
    });
    const { result } = harness();
    act(() => result.current.setNewCatPl("Fundusze"));

    let pending: Promise<void>;
    act(() => {
      pending = result.current.addCategory();
    });
    // Zapis wystartował - wskaźnik pokazuje KATEGORIĘ, nie tag.
    await waitFor(() => expect(result.current.taxonomyBusy).toBe("cat"));

    await act(async () => {
      await pending!;
    });
    release?.();

    await waitFor(() => expect(result.current.taxonomyBusy).toBeNull());
  });
});
