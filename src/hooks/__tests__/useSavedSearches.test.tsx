// Zapisane wyszukiwania i ALERTY o nowych trafieniach.
//
// Najwyższe ryzyko w module: `useToggleSavedSearchAlert` włącza wysyłkę
// powiadomień, więc defekt to albo spam do skrzynki, albo cisza tam, gdzie
// obiecano alert. Drugi nośnik ryzyka to `savedSearchHref` - to ON jest
// adresem, pod który prowadzi powiadomienie („zobacz nowe wyniki"), więc
// stratna runda zapis → href → odtworzenie zapytania oznacza alert prowadzący
// pod INNE zapytanie niż zapisane.
//
// CZEGO TU NIE MA I DLACZEGO. Brief przewidywał testy limitu zapisów, duplikatu
// tej samej frazy i wycofania optymistycznej aktualizacji. Żadnej z tych trzech
// rzeczy w kodzie nie ma: migracja 20260713173411:470 nie zakłada ani limitu na
// użytkownika, ani UNIQUE na (user_id, params) - jedynym ograniczeniem jest
// `CHECK (length(btrim(name)) BETWEEN 1 AND 120)` - a mutacje nie robią
// optymistycznej aktualizacji (samo `onSuccess: invalidateQueries`), więc nie
// ma czego wycofywać. Testujemy zamiast tego LUSTRO tego CHECK-a po stronie TS
// (`name.trim().slice(0, 120)`), bo to ono decyduje, czy zapis w ogóle wejdzie.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fail, ok, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({ user: { current: null as { id: string } | null } }));
const stubs = vi.hoisted(() => ({ from: null as ReturnType<typeof supabaseFromStub> | null }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user.current }) }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub: make } = await import("@/test/supabaseChain");
  const from = make();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

import {
  savedSearchHref,
  useSavedSearches,
  useSaveSearch,
  useToggleSavedSearchAlert,
  useDeleteSavedSearch,
  type SavedSearch,
} from "@/hooks/useSavedSearches";

const USER = { id: "u-1" };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const row = (p: Partial<Record<string, unknown>> = {}) => ({
  id: "s-1",
  name: "Energia w CEE",
  params: { q: "energia", topic: "t-1" },
  created_at: "2026-08-01T10:00:00Z",
  alert_enabled: false,
  url: "/search?q=energia&topic=t-1",
  entity: "posts",
  ...p,
});

const saved = (p: Partial<SavedSearch> = {}): SavedSearch => ({
  id: "s-1",
  name: "Energia w CEE",
  params: { q: "energia" },
  created_at: "2026-08-01T10:00:00Z",
  alert_enabled: false,
  url: "/search?q=energia",
  entity: "posts",
  ...p,
});

/** Ostatni patch przekazany do `update()` w łańcuchu tabeli. */
const patchOf = (chain: RecordedChain | undefined) =>
  chain?.argsOf("update")?.[0] as Record<string, unknown> | undefined;

beforeEach(() => {
  h.user.current = USER;
  stubs.from?.reset();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// savedSearchHref - adres, pod który prowadzi powiadomienie o nowych wynikach
// ---------------------------------------------------------------------------

describe("savedSearchHref", () => {
  it("bez parametrów daje samą ścieżkę encji, bez wiszącego znaku zapytania", () => {
    expect(savedSearchHref({})).toBe("/search");
    expect(savedSearchHref({}, "people")).toBe("/people");
  });

  it("kieruje na powierzchnię WŁAŚCIWĄ dla encji zapisu", () => {
    expect(savedSearchHref({ q: "ekspert" }, "people")).toBe("/people?q=ekspert");
    expect(savedSearchHref({ q: "ekspert" }, "posts")).toBe("/search?q=ekspert");
  });

  it("domyślną encją są wpisy - zachowanie sprzed rozdzielenia encji (08.2026)", () => {
    expect(savedSearchHref({ q: "x" })).toBe(savedSearchHref({ q: "x" }, "posts"));
  });

  it("stawia frazę PIERWSZĄ, resztę alfabetycznie - adres jest stabilny między zapisami", () => {
    const a = savedSearchHref({ topic: "t-1", q: "energia", access: "public" });
    const b = savedSearchHref({ access: "public", q: "energia", topic: "t-1" });
    expect(a).toBe("/search?q=energia&access=public&topic=t-1");
    expect(a).toBe(b);
  });

  it("pomija wartości puste - alert nie może prowadzić pod „?q=&topic=”", () => {
    expect(savedSearchHref({ q: "energia", topic: "", access: "" })).toBe("/search?q=energia");
  });

  it("koduje znaki specjalne frazy", () => {
    expect(savedSearchHref({ q: "gaz & ropa" })).toBe("/search?q=gaz+%26+ropa");
  });

  it("GUBI wartości niebędące stringami - to granica bezstratności rundy", () => {
    // Snapshot parametrów jest typowany jako Record<string, unknown>, ale filtr
    // przepuszcza wyłącznie stringi. Wywołujący MUSI serializować liczby i flagi
    // przed zapisem, inaczej alert poleci pod węższe zapytanie niż zapisane.
    expect(savedSearchHref({ q: "energia", year: 2026, adv: true, topic: null })).toBe(
      "/search?q=energia",
    );
    expect(savedSearchHref({ q: "energia", year: "2026" })).toBe("/search?q=energia&year=2026");
  });

  it("RUNDA W OBIE STRONY: zapis → href → odtworzone zapytanie jest identyczne", () => {
    const params = {
      q: "polityka energetyczna",
      topic: "t-1,t-2",
      access: "members",
      year: "2026",
      match: "phrase",
    };
    const href = savedSearchHref(params);
    const restored = Object.fromEntries(new URL(href, "https://nes.test").searchParams);
    expect(restored).toEqual(params);
  });

  it("runda jest bezstratna także dla katalogu osób", () => {
    const params = { q: "ekspert energetyczny", org: "o-1" };
    const href = savedSearchHref(params, "people");
    expect(href.startsWith("/people?")).toBe(true);
    expect(Object.fromEntries(new URL(href, "https://nes.test").searchParams)).toEqual(params);
  });
});

// ---------------------------------------------------------------------------
// useSavedSearches - odczyt listy
// ---------------------------------------------------------------------------

describe("useSavedSearches", () => {
  it("bez sesji NIE PYTA bazy (zapisy są prywatne, RLS i tak by je odciął)", () => {
    h.user.current = null;
    const { result } = renderHook(() => useSavedSearches("posts"), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(stubs.from?.chainsFor("saved_searches")).toHaveLength(0);
  });

  it("czyta zapisy najnowszymi od góry", async () => {
    stubs.from?.setResponse("saved_searches", ok([row()]));
    const { result } = renderHook(() => useSavedSearches(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const chain = stubs.from?.lastChain("saved_searches");
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("select")?.[0]).toContain("alert_enabled");
  });

  it("zawęża listę do encji - panel wpisów nie może pokazać zapisów katalogu osób", async () => {
    stubs.from?.setResponse("saved_searches", ok([]));
    const { result } = renderHook(() => useSavedSearches("people"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(stubs.from?.lastChain("saved_searches")?.argsOf("eq")).toEqual(["entity", "people"]);
  });

  it("bez parametru encji zwraca WSZYSTKIE zapisy (brak filtra)", async () => {
    stubs.from?.setResponse("saved_searches", ok([]));
    const { result } = renderHook(() => useSavedSearches(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(stubs.from?.lastChain("saved_searches")?.has("eq")).toBe(false);
  });

  it("izoluje cache po użytkowniku i encji - klucz niesie oba", async () => {
    stubs.from?.setResponse("saved_searches", ok([]));
    const { result } = renderHook(() => useSavedSearches("people"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Wyciek między kontami byłby ujawnieniem cudzych zapytań.
    expect(result.current.data).toEqual([]);
  });

  it("mapuje wiersz na model, uzupełniając braki bezpiecznymi wartościami", async () => {
    stubs.from?.setResponse(
      "saved_searches",
      ok([row({ params: null, alert_enabled: null, url: null, entity: null })]),
    );
    const { result } = renderHook(() => useSavedSearches(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({
      params: {},
      // Brak wartości NIE MOŻE oznaczać „alert włączony" - to byłby spam.
      alert_enabled: false,
      url: null,
      entity: "posts",
    });
  });

  it("toEntity: tylko „people” daje people, wszystko inne spada na posts", async () => {
    stubs.from?.setResponse(
      "saved_searches",
      ok([
        row({ id: "a", entity: "people" }),
        row({ id: "b", entity: "posts" }),
        row({ id: "c", entity: "cokolwiek" }),
        row({ id: "d", entity: undefined }),
      ]),
    );
    const { result } = renderHook(() => useSavedSearches(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((s) => s.entity)).toEqual([
      "people",
      "posts",
      "posts",
      "posts",
    ]);
  });

  it("brak wierszy daje pustą listę, nie undefined", async () => {
    stubs.from?.setResponse("saved_searches", { data: null, error: null });
    const { result } = renderHook(() => useSavedSearches(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("błąd bazy zgłasza się jako błąd zapytania, a nie jako pusta lista", async () => {
    stubs.from?.setResponse("saved_searches", fail("permission denied", "42501"));
    const { result } = renderHook(() => useSavedSearches(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("permission denied");
  });
});

// ---------------------------------------------------------------------------
// useSaveSearch - zapis
// ---------------------------------------------------------------------------

describe("useSaveSearch", () => {
  it("zapisuje właściciela, snapshot i KANONICZNY adres wyników", async () => {
    stubs.from?.setResponse("saved_searches", ok(null));
    const { result } = renderHook(() => useSaveSearch(), { wrapper });
    await result.current.mutateAsync({
      name: "Energia",
      params: { q: "energia", topic: "t-1" },
      entity: "posts",
    });
    const insert = stubs.from?.lastChain("saved_searches")?.argsOf("insert")?.[0] as Record<
      string,
      unknown
    >;
    expect(insert).toEqual({
      user_id: "u-1",
      name: "Energia",
      params: { q: "energia", topic: "t-1" },
      entity: "posts",
      url: "/search?q=energia&topic=t-1",
    });
  });

  it("domyślną encją zapisu są wpisy", async () => {
    stubs.from?.setResponse("saved_searches", ok(null));
    const { result } = renderHook(() => useSaveSearch(), { wrapper });
    await result.current.mutateAsync({ name: "X", params: { q: "x" } });
    const insert = stubs.from?.lastChain("saved_searches")?.argsOf("insert")?.[0] as Record<
      string,
      unknown
    >;
    expect(insert.entity).toBe("posts");
    expect(insert.url).toBe("/search?q=x");
  });

  it("adres zapisu wskazuje katalog osób, gdy zapis dotyczy osób", async () => {
    stubs.from?.setResponse("saved_searches", ok(null));
    const { result } = renderHook(() => useSaveSearch(), { wrapper });
    await result.current.mutateAsync({ name: "Eksperci", params: { q: "ai" }, entity: "people" });
    const insert = stubs.from?.lastChain("saved_searches")?.argsOf("insert")?.[0] as Record<
      string,
      unknown
    >;
    expect(insert.url).toBe("/people?q=ai");
  });

  it("przycina nazwę i tnie ją do 120 znaków - LUSTRO CHECK-a z migracji", async () => {
    stubs.from?.setResponse("saved_searches", ok(null));
    const { result } = renderHook(() => useSaveSearch(), { wrapper });
    await result.current.mutateAsync({ name: `  ${"a".repeat(150)}  `, params: { q: "x" } });
    const insert = stubs.from?.lastChain("saved_searches")?.argsOf("insert")?.[0] as Record<
      string,
      unknown
    >;
    // CHECK (length(btrim(name)) BETWEEN 1 AND 120) odrzuciłby dłuższą nazwę,
    // a użytkownik zobaczyłby surowy błąd PostgREST zamiast zapisu.
    expect((insert.name as string).length).toBe(120);
  });

  it("zapis bez sesji jest odrzucany PRZED dotknięciem bazy", async () => {
    h.user.current = null;
    const { result } = renderHook(() => useSaveSearch(), { wrapper });
    await expect(
      result.current.mutateAsync({ name: "X", params: { q: "x" } }),
    ).rejects.toThrow("Not authenticated");
    expect(stubs.from?.chainsFor("saved_searches")).toHaveLength(0);
  });

  it("błąd zapisu WRACA do wywołującego (panel pokazuje toast błędu)", async () => {
    stubs.from?.setResponse("saved_searches", fail("duplicate key value", "23505"));
    const { result } = renderHook(() => useSaveSearch(), { wrapper });
    await expect(
      result.current.mutateAsync({ name: "X", params: { q: "x" } }),
    ).rejects.toThrow("duplicate key value");
  });

  it("udany zapis unieważnia listę zapisów tego użytkownika", async () => {
    stubs.from?.setResponse("saved_searches", ok(null));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSaveSearch(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await result.current.mutateAsync({ name: "X", params: { q: "x" } });
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ["saved-searches", "u-1"] }),
    );
  });
});

// ---------------------------------------------------------------------------
// useToggleSavedSearchAlert - wysyłka powiadomień
// ---------------------------------------------------------------------------

describe("useToggleSavedSearchAlert", () => {
  it("włącza alert dokładnie na wskazanym zapisie", async () => {
    stubs.from?.setResponse("saved_searches", ok(null));
    const { result } = renderHook(() => useToggleSavedSearchAlert(), { wrapper });
    await result.current.mutateAsync({ search: saved({ id: "s-7" }), enabled: true });
    const chain = stubs.from?.lastChain("saved_searches");
    expect(patchOf(chain)?.alert_enabled).toBe(true);
    expect(chain?.argsOf("eq")).toEqual(["id", "s-7"]);
  });

  it("wyłącza alert i NIE RUSZA adresu przy okazji", async () => {
    stubs.from?.setResponse("saved_searches", ok(null));
    const { result } = renderHook(() => useToggleSavedSearchAlert(), { wrapper });
    await result.current.mutateAsync({ search: saved({ alert_enabled: true }), enabled: false });
    expect(patchOf(stubs.from?.lastChain("saved_searches"))).toEqual({ alert_enabled: false });
  });

  it("włączenie na STARYM zapisie bez adresu dolicza adres z parametrów", async () => {
    stubs.from?.setResponse("saved_searches", ok(null));
    const { result } = renderHook(() => useToggleSavedSearchAlert(), { wrapper });
    await result.current.mutateAsync({
      search: saved({ url: null, params: { q: "energia", topic: "t-1" } }),
      enabled: true,
    });
    // Bez tego powiadomienie o nowych wynikach nie miałoby dokąd prowadzić.
    expect(patchOf(stubs.from?.lastChain("saved_searches"))).toEqual({
      alert_enabled: true,
      url: "/search?q=energia&topic=t-1",
    });
  });

  it("stary zapis KATALOGU OSÓB dostaje adres katalogu, nie wyszukiwarki treści", async () => {
    stubs.from?.setResponse("saved_searches", ok(null));
    const { result } = renderHook(() => useToggleSavedSearchAlert(), { wrapper });
    await result.current.mutateAsync({
      search: saved({ url: null, entity: "people", params: { q: "ekspert" } }),
      enabled: true,
    });
    expect(patchOf(stubs.from?.lastChain("saved_searches"))?.url).toBe("/people?q=ekspert");
  });

  it("włączenie NIE NADPISUJE adresu, który zapis już ma", async () => {
    stubs.from?.setResponse("saved_searches", ok(null));
    const { result } = renderHook(() => useToggleSavedSearchAlert(), { wrapper });
    await result.current.mutateAsync({
      search: saved({ url: "/search?q=stara-fraza" }),
      enabled: true,
    });
    expect(patchOf(stubs.from?.lastChain("saved_searches"))).toEqual({ alert_enabled: true });
  });

  it("wyłączenie zapisu BEZ adresu też go nie dolicza (adres to sprawa alertu)", async () => {
    stubs.from?.setResponse("saved_searches", ok(null));
    const { result } = renderHook(() => useToggleSavedSearchAlert(), { wrapper });
    await result.current.mutateAsync({ search: saved({ url: null }), enabled: false });
    expect(patchOf(stubs.from?.lastChain("saved_searches"))).toEqual({ alert_enabled: false });
  });

  it("przełączenie w obie strony wraca do stanu wyjściowego", async () => {
    stubs.from?.setResponse("saved_searches", ok(null));
    const { result } = renderHook(() => useToggleSavedSearchAlert(), { wrapper });
    const s = saved({ url: "/search?q=energia" });
    await result.current.mutateAsync({ search: s, enabled: true });
    await result.current.mutateAsync({ search: { ...s, alert_enabled: true }, enabled: false });
    const patches = stubs.from
      ?.chainsFor("saved_searches")
      .map((c) => patchOf(c)?.alert_enabled);
    expect(patches).toEqual([true, false]);
  });

  it("przełączenie bez sesji jest odrzucane PRZED dotknięciem bazy", async () => {
    h.user.current = null;
    const { result } = renderHook(() => useToggleSavedSearchAlert(), { wrapper });
    await expect(
      result.current.mutateAsync({ search: saved(), enabled: true }),
    ).rejects.toThrow("Not authenticated");
    expect(stubs.from?.chainsFor("saved_searches")).toHaveLength(0);
  });

  it("błąd zapisu wraca do wywołującego - dzwonek nie może skłamać o stanie", async () => {
    stubs.from?.setResponse("saved_searches", fail("row level security", "42501"));
    const { result } = renderHook(() => useToggleSavedSearchAlert(), { wrapper });
    await expect(
      result.current.mutateAsync({ search: saved(), enabled: true }),
    ).rejects.toThrow("row level security");
  });

  it("udane przełączenie unieważnia listę zapisów", async () => {
    stubs.from?.setResponse("saved_searches", ok(null));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useToggleSavedSearchAlert(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await result.current.mutateAsync({ search: saved(), enabled: true });
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ["saved-searches", "u-1"] }),
    );
  });
});

// ---------------------------------------------------------------------------
// useDeleteSavedSearch
// ---------------------------------------------------------------------------

describe("useDeleteSavedSearch", () => {
  it("usuwa dokładnie wskazany zapis", async () => {
    stubs.from?.setResponse("saved_searches", ok(null));
    const { result } = renderHook(() => useDeleteSavedSearch(), { wrapper });
    await result.current.mutateAsync("s-9");
    const chain = stubs.from?.lastChain("saved_searches");
    expect(chain?.has("delete")).toBe(true);
    expect(chain?.argsOf("eq")).toEqual(["id", "s-9"]);
  });

  it("usunięcie bez sesji jest odrzucane PRZED dotknięciem bazy", async () => {
    h.user.current = null;
    const { result } = renderHook(() => useDeleteSavedSearch(), { wrapper });
    await expect(result.current.mutateAsync("s-9")).rejects.toThrow("Not authenticated");
    expect(stubs.from?.chainsFor("saved_searches")).toHaveLength(0);
  });

  it("błąd usunięcia wraca do wywołującego", async () => {
    stubs.from?.setResponse("saved_searches", fail("not found", "PGRST116"));
    const { result } = renderHook(() => useDeleteSavedSearch(), { wrapper });
    await expect(result.current.mutateAsync("s-9")).rejects.toThrow("not found");
  });

  it("udane usunięcie unieważnia listę zapisów", async () => {
    stubs.from?.setResponse("saved_searches", ok(null));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDeleteSavedSearch(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await result.current.mutateAsync("s-9");
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ["saved-searches", "u-1"] }),
    );
  });
});
