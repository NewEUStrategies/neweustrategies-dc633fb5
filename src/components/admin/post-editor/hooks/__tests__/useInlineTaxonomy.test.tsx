// Inline tworzenie kategorii i tagów z poziomu edytora wpisu.
//
// Hook stał na 0%, a zapisuje do bazy z poziomu formularza - z jawnym
// `tenant_id`, bo grant INSERT na `categories`/`tags` ma rolę `authenticated`,
// nie właściciela obszaru roboczego. Pominięcie stempla albo wpisanie cudzego
// tenanta jest błędem, którego nie widać w UI: kategoria po prostu „się tworzy",
// tylko nie tam, gdzie trzeba.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail, supabaseFromStub } from "@/test/supabaseChain";

const stub = supabaseFromStub();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => stub.from(table) },
}));

const invalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && "name" in opts ? `${key}:${String(opts.name)}` : key,
  }),
}));

vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

import { useInlineTaxonomy } from "../useInlineTaxonomy";

const TENANT = "tenant-abc";

function setup() {
  const onCategoryCreated = vi.fn();
  const onTagCreated = vi.fn();
  const hook = renderHook(() =>
    useInlineTaxonomy({ tenantId: TENANT, onCategoryCreated, onTagCreated }),
  );
  return { ...hook, onCategoryCreated, onTagCreated };
}

beforeEach(() => {
  stub.reset();
  invalidateQueries.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe("addCategory", () => {
  it("REGRESJA: stempluje tenant_id aktywnego obszaru roboczego", async () => {
    // Grant INSERT na `categories` ma rolę `authenticated`, nie właściciela
    // obszaru - bez jawnego stempla kategoria trafiłaby poza obszar redaktora.
    stub.setResponse("categories", ok({ id: "cat-1", name_pl: "Analizy", name_en: "Analyses" }));
    const { result, onCategoryCreated } = setup();

    act(() => result.current.setNewCatPl("Analizy"));
    await act(async () => {
      await result.current.addCategory();
    });

    const insert = stub.lastChain("categories")!.argsOf("insert")![0] as Record<string, unknown>;
    expect(insert.tenant_id).toBe(TENANT);
    expect(onCategoryCreated).toHaveBeenCalledWith("cat-1");
  });

  it("nazwa EN pusta dziedziczy po polskiej, zamiast zapisać pustkę", async () => {
    stub.setResponse("categories", ok({ id: "cat-1", name_pl: "Analizy", name_en: "Analizy" }));
    const { result } = setup();

    act(() => result.current.setNewCatPl("  Analizy  "));
    await act(async () => {
      await result.current.addCategory();
    });

    const insert = stub.lastChain("categories")!.argsOf("insert")![0] as Record<string, unknown>;
    // Białe znaki obcięte po obu stronach, EN skopiowane z PL.
    expect(insert.name_pl).toBe("Analizy");
    expect(insert.name_en).toBe("Analizy");
  });

  it("podana nazwa EN nie jest nadpisywana polską", async () => {
    stub.setResponse("categories", ok({ id: "cat-1", name_pl: "Analizy", name_en: "Analyses" }));
    const { result } = setup();

    act(() => {
      result.current.setNewCatPl("Analizy");
      result.current.setNewCatEn("Analyses");
    });
    await act(async () => {
      await result.current.addCategory();
    });

    const insert = stub.lastChain("categories")!.argsOf("insert")![0] as Record<string, unknown>;
    expect(insert.name_en).toBe("Analyses");
  });

  it("slug powstaje z nazwy polskiej", async () => {
    stub.setResponse("categories", ok({ id: "cat-1", name_pl: "Ważne analizy", name_en: "x" }));
    const { result } = setup();

    act(() => result.current.setNewCatPl("Ważne analizy"));
    await act(async () => {
      await result.current.addCategory();
    });

    const insert = stub.lastChain("categories")!.argsOf("insert")![0] as Record<string, unknown>;
    expect(insert.slug).toBe("wazne-analizy");
  });

  it("pusta nazwa NIE dobija do bazy - guard stoi przed zapisem", async () => {
    const { result, onCategoryCreated } = setup();

    await act(async () => {
      await result.current.addCategory();
    });

    expect(stub.chainsFor("categories")).toHaveLength(0);
    expect(toastError).toHaveBeenCalledWith("adminPostPanes.taxonomy.catNameRequired");
    expect(onCategoryCreated).not.toHaveBeenCalled();
  });

  it("same białe znaki liczą się jako pusta nazwa", async () => {
    const { result } = setup();
    act(() => result.current.setNewCatPl("   "));

    await act(async () => {
      await result.current.addCategory();
    });

    expect(stub.chainsFor("categories")).toHaveLength(0);
    expect(toastError).toHaveBeenCalledWith("adminPostPanes.taxonomy.catNameRequired");
  });

  it("po sukcesie czyści pola i unieważnia cache ZAWĘŻONY do tenanta", async () => {
    // Klucz bez tenanta pokazałby redaktorowi kategorie innego obszaru
    // roboczego po przełączeniu kontekstu.
    stub.setResponse("categories", ok({ id: "cat-1", name_pl: "Analizy", name_en: "Analyses" }));
    const { result } = setup();

    act(() => {
      result.current.setNewCatPl("Analizy");
      result.current.setNewCatEn("Analyses");
    });
    await act(async () => {
      await result.current.addCategory();
    });

    await waitFor(() => expect(result.current.newCatPl).toBe(""));
    expect(result.current.newCatEn).toBe("");
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["categories", TENANT] });
    expect(toastSuccess).toHaveBeenCalledWith("adminPostPanes.taxonomy.catAdded:Analizy");
  });

  it("błąd bazy nie zgłasza sukcesu ani nie woła zwrotki", async () => {
    stub.setResponse("categories", fail("duplicate key value violates unique constraint"));
    const { result, onCategoryCreated } = setup();

    act(() => result.current.setNewCatPl("Analizy"));
    await act(async () => {
      await result.current.addCategory();
    });

    expect(onCategoryCreated).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("duplicate key value violates unique constraint");
    // Pola zostają wypełnione - redaktor poprawia nazwę, nie wpisuje jej od nowa.
    expect(result.current.newCatPl).toBe("Analizy");
  });

  it("wskaźnik zajętości wraca do spoczynku także po błędzie", async () => {
    stub.setResponse("categories", fail("cokolwiek"));
    const { result } = setup();

    act(() => result.current.setNewCatPl("Analizy"));
    await act(async () => {
      await result.current.addCategory();
    });

    // Zablokowany na stałe przycisk to zablokowany formularz.
    expect(result.current.taxonomyBusy).toBeNull();
  });
});

describe("addTag", () => {
  it("REGRESJA: stempluje tenant_id i buduje slug z nazwy", async () => {
    stub.setResponse("tags", ok({ id: "tag-1", name: "Rynek wewnętrzny" }));
    const { result, onTagCreated } = setup();

    act(() => result.current.setNewTagName("Rynek wewnętrzny"));
    await act(async () => {
      await result.current.addTag();
    });

    const insert = stub.lastChain("tags")!.argsOf("insert")![0] as Record<string, unknown>;
    expect(insert.tenant_id).toBe(TENANT);
    expect(insert.name).toBe("Rynek wewnętrzny");
    expect(insert.slug).toBe("rynek-wewnetrzny");
    expect(onTagCreated).toHaveBeenCalledWith("tag-1");
  });

  it("pusta nazwa taga NIE dobija do bazy", async () => {
    const { result, onTagCreated } = setup();

    await act(async () => {
      await result.current.addTag();
    });

    expect(stub.chainsFor("tags")).toHaveLength(0);
    expect(toastError).toHaveBeenCalledWith("adminPostPanes.taxonomy.tagNameRequired");
    expect(onTagCreated).not.toHaveBeenCalled();
  });

  it("po sukcesie czyści pole i unieważnia cache tagów tego tenanta", async () => {
    stub.setResponse("tags", ok({ id: "tag-1", name: "Handel" }));
    const { result } = setup();

    act(() => result.current.setNewTagName("Handel"));
    await act(async () => {
      await result.current.addTag();
    });

    await waitFor(() => expect(result.current.newTagName).toBe(""));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["tags", TENANT] });
  });

  it("zapisuje do tabeli `tags`, nie do `categories`", async () => {
    // Dwie prawie identyczne ścieżki obok siebie - pomyłka w nazwie tabeli
    // przeszłaby przez typy i wyszła dopiero na produkcji.
    stub.setResponse("tags", ok({ id: "tag-1", name: "Handel" }));
    const { result } = setup();

    act(() => result.current.setNewTagName("Handel"));
    await act(async () => {
      await result.current.addTag();
    });

    expect(stub.chainsFor("tags")).toHaveLength(1);
    expect(stub.chainsFor("categories")).toHaveLength(0);
  });
});
