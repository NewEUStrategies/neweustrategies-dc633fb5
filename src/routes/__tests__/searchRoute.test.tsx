// Trasa /search - kompozycja całej wyszukiwarki i JEDYNE miejsce, w którym
// mieszka to, czego komponenty nie mają: nawigacja klawiaturą po
// podpowiedziach, zamknięcie popovera, „wyczyść wszystko", deep-linki
// z podpowiedzi i doładowywanie kolejnych wyników.
//
// DLACZEGO TRASA MA TEST, SKORO AUDYT ODRADZAŁ POGOŃ ZA JEJ POKRYCIEM. Bo
// zawiera 57 funkcji z 292 w module - przy zerze na tym pliku sufit pokrycia
// modułu wynosi ~80% i cel „domknięcia" jest arytmetycznie nieosiągalny. Ale
// przede wszystkim: `validateSearch` jest KONTacTEM adresu, który użytkownicy
// wklejają i udostępniają, a obsługa klawiatury combobox nie istnieje nigdzie
// indziej. To nie jest test kompozycji dla samego pokrycia.
//
// ZAKRES ŚWIADOMIE OGRANICZONY: nie testujemy tu ponownie tego, co dowodzą
// testy komponentów (grupowanie podpowiedzi, łatki faset, chipy) ani rankingu
// z bazy (9 plików pgTAP). Testujemy SKLEJENIE: co trasa wysyła do zapytań, co
// robi z klawiaturą i jak zmienia adres.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { AutosuggestItem, FacetValue, SearchResultItem } from "@/lib/queries/archives";

const h = vi.hoisted(() => ({
  /** Odpowiedzi RPC PER FUNKCJA: trasa woła trzy różne (page_full_path zwraca
   *  napis, search_suggest i popular_searches - tablice), więc jedna wspólna
   *  wartość karmi je nawzajem złym kształtem i wywraca render. */
  rpcByFn: {} as Record<string, unknown>,
  rpc: vi.fn(),
  searchData: null as unknown,
  peopleData: [] as unknown[],
  suggestData: [] as unknown[],
  voice: {
    supported: true,
    listening: false,
    busy: false,
    toggle: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  // Autosuggest dociąga avatary autorów przez `from("profiles_public")`.
  from.setResponse("profiles_public", ok([]));
  return { supabase: { rpc: h.rpc, from: from.from } };
});
vi.mock("@/components/ads/useInFeedAds", () => ({ useInFeedAds: () => () => null }));
vi.mock("@/components/ads/FooterSlideup", () => ({ FooterSlideup: () => null }));
vi.mock("@/lib/search/useVoiceSearch", () => ({ useVoiceSearch: () => h.voice }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

// Zapytania podmienione na poziomie OPCJI: trasa ma dowieść, co do nich wysyła
// i co robi z odpowiedzią - nie tego, jak wygląda RPC (to pgTAP).
vi.mock("@/lib/queries/archives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/archives")>();
  return {
    ...actual,
    searchQueryOptions: (filters: unknown, limit: number) => ({
      queryKey: ["test-search", JSON.stringify(filters), limit] as const,
      queryFn: () => Promise.resolve(h.searchData),
    }),
    searchPeopleOrgsQueryOptions: (q: string, limit: number) => ({
      queryKey: ["test-people", q, limit] as const,
      queryFn: () => Promise.resolve(h.peopleData),
    }),
    searchAutosuggestQueryOptions: (q: string, limit: number) => ({
      queryKey: ["test-suggest", q, limit] as const,
      queryFn: () => Promise.resolve(h.suggestData),
    }),
  };
});

import i18n from "@/lib/i18n";
import "@/test/i18nReal";
import "@/lib/i18n-search";
import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as SearchRoute } from "@/routes/search";
import { clearRecentSearches } from "@/lib/search/recentSearches";

const PATH = "/search";

const post = (p: Partial<SearchResultItem> = {}): SearchResultItem =>
  ({
    id: "p-1",
    slug: "raport-roczny",
    title_pl: "Raport roczny",
    title_en: "Annual report",
    excerpt_pl: "Streszczenie",
    excerpt_en: "Summary",
    published_at: "2026-01-10T00:00:00Z",
    cover_url: null,
    headline_pl: null,
    headline_en: null,
    ...p,
  }) as SearchResultItem;

const facet = (p: Partial<FacetValue> = {}): FacetValue => ({
  dim: "topic",
  id: "t-1",
  slug: "energia",
  label_pl: "Energia",
  label_en: "Energy",
  parentId: null,
  count: 3,
  ...p,
});

const sug = (p: Partial<AutosuggestItem> = {}): AutosuggestItem => ({
  kind: "post",
  id: "s-1",
  slug: "raport",
  label_pl: "Raport roczny",
  label_en: "Annual report",
  parentPageId: null,
  score: 1,
  ...p,
});

const result = (
  over: Partial<{
    posts: SearchResultItem[];
    facets: FacetValue[];
    total: number;
    fuzzy: boolean;
  }> = {},
) => ({
  posts: [post()],
  facets: [facet()],
  total: 1,
  fuzzy: false,
  ...over,
});

async function mount(entry = PATH) {
  let view!: Awaited<ReturnType<typeof renderRoute>>;
  await act(async () => {
    view = await renderRoute({ route: SearchRoute, path: PATH, initialEntry: entry });
  });
  return view;
}

const phraseInput = () => screen.getByRole("combobox");

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  h.rpcByFn = {};
  h.rpc.mockReset().mockImplementation((fn: string) => {
    const planned = h.rpcByFn[fn];
    if (planned instanceof Error) return Promise.reject(planned);
    return Promise.resolve({ data: planned ?? null });
  });
  h.searchData = result();
  h.peopleData = [];
  h.suggestData = [];
  h.voice = { supported: true, listening: false, busy: false, toggle: vi.fn(), stop: vi.fn() };
  clearRecentSearches();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// validateSearch - kontrakt ADRESU, który użytkownik wkleja i udostępnia
// ---------------------------------------------------------------------------

describe("/search - kontrakt adresu", () => {
  const parse = (input: Record<string, unknown>) =>
    (SearchRoute.options.validateSearch as (s: Record<string, unknown>) => Record<string, unknown>)(
      input,
    );

  it("brak frazy daje pusty napis, nie undefined - reszta kodu nie sprawdza null", () => {
    expect(parse({})).toMatchObject({ q: "" });
  });

  it("przepuszcza komplet filtrów taksonomii i wymiarów wyliczanych", () => {
    expect(
      parse({ q: "gaz", topic: "t-1,t-2", type: "pt-1", year: "2026", access: "members" }),
    ).toMatchObject({ q: "gaz", topic: "t-1,t-2", type: "pt-1", year: "2026", access: "members" });
  });

  it("ODRZUCA nieznany tryb dopasowania - adres z literówką ma paść, nie zgadywać", () => {
    expect(() => parse({ match: "wszystkie" })).toThrow();
    expect(() => parse({ scope: "tresc" })).toThrow();
    expect(() => parse({ tab: "wpisy" })).toThrow();
    expect(() => parse({ sort: "najlepsze" })).toThrow();
    expect(() => parse({ lang: "de" })).toThrow();
  });

  it("przyjmuje wszystkie DOZWOLONE warianty trybów", () => {
    for (const match of ["all", "any", "phrase"]) expect(parse({ match })).toMatchObject({ match });
    for (const scope of ["all", "title"]) expect(parse({ scope })).toMatchObject({ scope });
    for (const tab of ["all", "titles", "types", "topics", "people"])
      expect(parse({ tab })).toMatchObject({ tab });
  });

  it("adv przychodzi z widgetu jako liczba i musi przeżyć jako napis", () => {
    expect(parse({ adv: 1 })).toMatchObject({ adv: "1" });
  });
});

describe("/search - nagłówek dokumentu", () => {
  it("emituje tytuł strony wyszukiwania", async () => {
    const meta = await routeMeta(SearchRoute);
    expect(JSON.stringify(meta)).toContain("Szukaj");
  });
});

// ---------------------------------------------------------------------------
// Render i przejścia adresu
// ---------------------------------------------------------------------------

describe("/search - wyniki i filtry", () => {
  it("pokazuje wyniki dla frazy z adresu", async () => {
    const view = await mount("/search?q=raport");
    await waitFor(() => expect(screen.getByText("Raport roczny")).toBeInTheDocument());
    expect(view.search()).toMatchObject({ q: "raport" });
  });

  it("wstawia frazę z adresu do pola - odświeżenie nie gubi zapytania", async () => {
    await mount("/search?q=polityka");
    expect(phraseInput()).toHaveValue("polityka");
  });

  it("pokazuje chip aktywnego filtru i panel faset", async () => {
    await mount("/search?q=raport&topic=t-1");
    await waitFor(() => expect(screen.getByLabelText("Aktywne filtry")).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: /Energia/ })).toBeInTheDocument();
  });

  it("„WYCZYŚĆ WSZYSTKO” zdejmuje filtry, ale ZOSTAWIA frazę i zakładkę", async () => {
    const view = await mount("/search?q=raport&topic=t-1&access=members&tab=titles");
    await waitFor(() => expect(screen.getByText("Wyczyść wszystko")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByText("Wyczyść wszystko"));
    });
    await waitFor(() => expect(view.search()).toEqual({ q: "raport", tab: "titles" }));
  });

  it("bez aktywnych filtrów nie ma czego czyścić - przycisku nie ma", async () => {
    await mount("/search?q=raport");
    await waitFor(() => expect(screen.getByText("Raport roczny")).toBeInTheDocument());
    expect(screen.queryByText("Wyczyść wszystko")).not.toBeInTheDocument();
  });

  it("zdjęcie chipa zmienia ADRES, nie tylko widok", async () => {
    const view = await mount("/search?q=raport&topic=t-1");
    await waitFor(() => expect(screen.getByLabelText("Aktywne filtry")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Usuń filtr/ }));
    });
    await waitFor(() => expect(view.search().topic).toBeUndefined());
  });

  it("wybór facetu dokłada filtr do adresu", async () => {
    const view = await mount("/search?q=raport");
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /Energia/ })).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /Energia/ }));
    });
    await waitFor(() => expect(view.search().topic).toBe("t-1"));
  });

  it("zmiana zakładki idzie do adresu, a „wszystko” go CZYŚCI", async () => {
    const view = await mount("/search?q=raport");
    await waitFor(() => expect(screen.getByText("Raport roczny")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /Osoby i organizacje/ }));
    });
    await waitFor(() => expect(view.search().tab).toBe("people"));
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /Wszystko/ }));
    });
    await waitFor(() => expect(view.search().tab).toBeUndefined());
  });

  it("wysłanie formularza przenosi frazę z pola do adresu", async () => {
    const view = await mount("/search");
    fireEvent.change(phraseInput(), { target: { value: "polityka energetyczna" } });
    await act(async () => {
      fireEvent.submit(phraseInput().closest("form")!);
    });
    await waitFor(() => expect(view.search().q).toBe("polityka energetyczna"));
  });
});

// ---------------------------------------------------------------------------
// Autosuggest - klawiatura. TO JEST W TRASIE, NIE W KOMPONENCIE.
// ---------------------------------------------------------------------------

describe("/search - nawigacja klawiaturą po podpowiedziach", () => {
  async function openSuggest() {
    h.suggestData = [
      sug({ id: "s-1", label_pl: "Raport roczny" }),
      sug({ id: "s-2", slug: "gaz", label_pl: "Gaz ziemny" }),
    ];
    const view = await mount("/search");
    fireEvent.change(phraseInput(), { target: { value: "ra" } });
    fireEvent.focus(phraseInput());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    return view;
  }

  it("pole frazy jest COMBOBOXEM podpiętym pod listę podpowiedzi", async () => {
    await openSuggest();
    await waitFor(() => expect(phraseInput()).toHaveAttribute("aria-expanded", "true"));
    expect(phraseInput()).toHaveAttribute("aria-controls", "search-autosuggest-listbox");
    expect(phraseInput()).toHaveAttribute("aria-autocomplete", "list");
  });

  it("STRZAŁKA W DÓŁ ogłasza aktywną opcję przez aria-activedescendant", async () => {
    await openSuggest();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(2));
    fireEvent.keyDown(phraseInput(), { key: "ArrowDown" });
    await waitFor(() =>
      expect(phraseInput()).toHaveAttribute("aria-activedescendant", "search-suggest-opt-0"),
    );
    fireEvent.keyDown(phraseInput(), { key: "ArrowDown" });
    await waitFor(() =>
      expect(phraseInput()).toHaveAttribute("aria-activedescendant", "search-suggest-opt-1"),
    );
  });

  it("strzałka w dół z OSTATNIEJ opcji ZAWIJA na pierwszą", async () => {
    await openSuggest();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(2));
    fireEvent.keyDown(phraseInput(), { key: "ArrowDown" });
    fireEvent.keyDown(phraseInput(), { key: "ArrowDown" });
    fireEvent.keyDown(phraseInput(), { key: "ArrowDown" });
    await waitFor(() =>
      expect(phraseInput()).toHaveAttribute("aria-activedescendant", "search-suggest-opt-0"),
    );
  });

  it("STRZAŁKA W GÓRĘ z pozycji wyjściowej skacze na OSTATNIĄ opcję", async () => {
    await openSuggest();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(2));
    fireEvent.keyDown(phraseInput(), { key: "ArrowUp" });
    await waitFor(() =>
      expect(phraseInput()).toHaveAttribute("aria-activedescendant", "search-suggest-opt-1"),
    );
  });

  it("ESCAPE zamyka listę, zostawiając wpisaną frazę", async () => {
    await openSuggest();
    await waitFor(() => expect(phraseInput()).toHaveAttribute("aria-expanded", "true"));
    fireEvent.keyDown(phraseInput(), { key: "Escape" });
    await waitFor(() => expect(phraseInput()).toHaveAttribute("aria-expanded", "false"));
    expect(phraseInput()).toHaveValue("ra");
  });

  it("UTRATA FOKUSU zamyka listę - klik poza obszarem nie zostawia popovera", async () => {
    await openSuggest();
    await waitFor(() => expect(phraseInput()).toHaveAttribute("aria-expanded", "true"));
    fireEvent.blur(phraseInput());
    await waitFor(() => expect(phraseInput()).toHaveAttribute("aria-expanded", "false"));
  });

  it("ENTER bez wybranej opcji NIE porywa formularza - wysyła wpisaną frazę", async () => {
    const view = await openSuggest();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(2));
    await act(async () => {
      fireEvent.submit(phraseInput().closest("form")!);
    });
    await waitFor(() => expect(view.search().q).toBe("ra"));
  });

  it("ENTER na wybranej opcji wybiera JĄ, a nie wpisaną frazę", async () => {
    const view = await openSuggest();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(2));
    fireEvent.keyDown(phraseInput(), { key: "ArrowDown" });
    await act(async () => {
      fireEvent.keyDown(phraseInput(), { key: "Enter" });
    });
    await waitFor(() => expect(view.search().q).toBe("Raport roczny"));
  });

  it("klawisze nawigacji są NIEAKTYWNE, gdy lista jest zamknięta", async () => {
    await mount("/search?q=raport");
    fireEvent.keyDown(phraseInput(), { key: "ArrowDown" });
    expect(phraseInput()).not.toHaveAttribute("aria-activedescendant");
  });
});

// ---------------------------------------------------------------------------
// Wybór podpowiedzi - deep-linki
// ---------------------------------------------------------------------------

describe("/search - deep-linki z podpowiedzi", () => {
  async function pick(item: AutosuggestItem) {
    h.suggestData = [item];
    const view = await mount("/search");
    fireEvent.change(phraseInput(), { target: { value: "ab" } });
    fireEvent.focus(phraseInput());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(1));
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("option"));
      await Promise.resolve();
    });
    return view;
  }

  it("AUTOR ze slugiem prowadzi wprost na profil", async () => {
    const view = await pick(sug({ kind: "author", id: "a-1", slug: "jan-kowalski" }));
    await waitFor(() => expect(view.currentPath()).toBe("/author/jan-kowalski"));
  });

  it("autor BEZ sluga filtruje wyniki po jego identyfikatorze", async () => {
    const view = await pick(sug({ kind: "author", id: "a-1", slug: "", label_pl: "Jan Kowalski" }));
    await waitFor(() => expect(view.search()).toMatchObject({ author: "a-1", q: "Jan Kowalski" }));
  });

  it("KATEGORIA prowadzi na publiczne archiwum", async () => {
    const view = await pick(sug({ kind: "category", id: "c-1", slug: "geopolityka" }));
    await waitFor(() => expect(view.currentPath()).toBe("/category/geopolityka"));
  });

  it("TAG prowadzi na archiwum tagu", async () => {
    const view = await pick(sug({ kind: "topic", id: "t-1", slug: "energia" }));
    await waitFor(() => expect(view.currentPath()).toBe("/tag/energia"));
  });

  it("SERIA ma własne archiwum", async () => {
    const view = await pick(sug({ kind: "series", id: "se-1", slug: "raporty" }));
    await waitFor(() => expect(view.currentPath()).toBe("/series/raporty"));
  });

  it("PROGRAM ma własne archiwum", async () => {
    const view = await pick(sug({ kind: "project", id: "pr-1", slug: "eu-green" }));
    await waitFor(() => expect(view.currentPath()).toBe("/programs/eu-green"));
  });

  it("TERM bez publicznej strony filtruje wyniki po ID i wraca do pola frazy", async () => {
    const view = await pick(
      sug({ kind: "organization", id: "o-1", slug: "nato", label_pl: "NATO" }),
    );
    await waitFor(() => expect(view.search()).toMatchObject({ org: "o-1", q: "NATO" }));
  });

  it("WPIS zagnieżdżony pod stroną rozwiązuje pełną ścieżkę JEDNYM zapytaniem", async () => {
    h.rpcByFn.page_full_path = "raporty/2026";
    const view = await pick(sug({ kind: "post", slug: "roczny", parentPageId: "pg-1" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("page_full_path", { _page_id: "pg-1" }));
    await waitFor(() => expect(view.currentPath()).toBe("/raporty/2026/roczny"));
  });

  it("BŁĄD rozwiązania ścieżki spada na wyszukanie tytułu, a nie na pustą stronę", async () => {
    h.rpcByFn.page_full_path = new Error("brak funkcji");
    const view = await pick(
      sug({ kind: "post", slug: "roczny", parentPageId: "pg-1", label_pl: "Raport roczny" }),
    );
    await waitFor(() => expect(view.search().q).toBe("Raport roczny"));
  });

  it("wpis BEZ rodzica od razu traktowany jest jak fraza", async () => {
    const view = await pick(sug({ kind: "post", slug: "roczny", label_pl: "Raport roczny" }));
    await waitFor(() => expect(view.search().q).toBe("Raport roczny"));
    expect(h.rpc).not.toHaveBeenCalledWith("page_full_path", expect.anything());
  });
});

// ---------------------------------------------------------------------------
// Stany brzegowe listy
// ---------------------------------------------------------------------------

describe("/search - stany wyników", () => {
  it("ZERO WYNIKÓW pyta o podpowiedzi „czy chodziło o”", async () => {
    h.searchData = result({ posts: [], total: 0 });
    h.rpcByFn.search_suggest = [{ title: "raport", slug: "raport" }];
    await mount("/search?q=rapotr");
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("search_suggest", { _q: "rapotr", _limit: 5 }),
    );
  });

  it("STAN PUSTY (bez frazy i filtrów) pyta o popularne frazy", async () => {
    h.searchData = result({ posts: [], total: 0 });
    await mount("/search");
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("popular_searches", { _days: 30, _limit: 6 }),
    );
  });

  it("wyniki przybliżone są oznaczone - użytkownik ma wiedzieć, że to nie dokładne trafienia", async () => {
    h.searchData = result({ fuzzy: true });
    await mount("/search?q=rapotr");
    await waitFor(() =>
      expect(
        screen.getByText("Brak dokładnych trafień - pokazujemy przybliżone wyniki."),
      ).toBeInTheDocument(),
    );
  });

  it("gdy jest CO doładować, pokazuje przycisk kolejnej strony", async () => {
    h.searchData = result({ posts: [post()], total: 40 });
    await mount("/search?q=raport");
    await waitFor(() => expect(screen.getByText("Raport roczny")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Pokaż więcej|Załaduj/i })).toBeInTheDocument();
  });

  it("komplet wyników na stronie NIE pokazuje przycisku doładowania", async () => {
    h.searchData = result({ posts: [post()], total: 1 });
    await mount("/search?q=raport");
    await waitFor(() => expect(screen.getByText("Raport roczny")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Pokaż więcej|Załaduj/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Ostatnie wyszukiwania i dyktowanie
// ---------------------------------------------------------------------------

describe("/search - ostatnie wyszukiwania", () => {
  it("wysłana fraza trafia do historii i wraca w pustym popoverze", async () => {
    const view = await mount("/search");
    fireEvent.change(phraseInput(), { target: { value: "polityka" } });
    await act(async () => {
      fireEvent.submit(phraseInput().closest("form")!);
    });
    await waitFor(() => expect(view.search().q).toBe("polityka"));

    cleanup();
    await mount("/search");
    fireEvent.focus(phraseInput());
    await waitFor(() => expect(screen.getByText("Ostatnie wyszukiwania")).toBeInTheDocument());
    expect(screen.getByRole("option", { name: /polityka/ })).toBeInTheDocument();
  });

  it("„wyczyść historię” opróżnia listę ostatnich wyszukiwań", async () => {
    const view = await mount("/search");
    fireEvent.change(phraseInput(), { target: { value: "polityka" } });
    await act(async () => {
      fireEvent.submit(phraseInput().closest("form")!);
    });
    await waitFor(() => expect(view.search().q).toBe("polityka"));

    cleanup();
    await mount("/search");
    fireEvent.focus(phraseInput());
    await waitFor(() => expect(screen.getByText("Ostatnie wyszukiwania")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Wyczyść historię" }));
    });
    await waitFor(() =>
      expect(screen.queryByText("Ostatnie wyszukiwania")).not.toBeInTheDocument(),
    );
  });
});

describe("/search - dyktowanie", () => {
  it("przycisk mikrofonu pokazuje się, gdy przeglądarka wspiera dyktowanie", async () => {
    await mount("/search");
    expect(screen.getByRole("button", { name: "Wyszukiwanie głosowe" })).toBeInTheDocument();
  });

  it("BEZ WSPARCIA przycisku nie ma wcale - martwy przycisk byłby gorszy", async () => {
    h.voice = { ...h.voice, supported: false };
    await mount("/search");
    expect(screen.queryByRole("button", { name: "Wyszukiwanie głosowe" })).not.toBeInTheDocument();
  });

  it("w trakcie nasłuchu przycisk ogłasza stan i oferuje zatrzymanie", async () => {
    h.voice = { ...h.voice, listening: true };
    await mount("/search");
    const mic = screen.getByRole("button", { name: "Zatrzymaj dyktowanie" });
    expect(mic).toHaveAttribute("aria-pressed", "true");
  });

  it("klik mikrofonu przełącza dyktowanie", async () => {
    await mount("/search");
    fireEvent.click(screen.getByRole("button", { name: "Wyszukiwanie głosowe" }));
    expect(h.voice.toggle).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tryby zaawansowane
// ---------------------------------------------------------------------------

describe("/search - tryby zaawansowane", () => {
  it("panel otwiera się sam, gdy adres niesie aktywny tryb", async () => {
    await mount("/search?q=raport&match=phrase");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Dokładna fraza" })).toBeInTheDocument(),
    );
  });

  it("deep-link adv=1 z widgetu nagłówka otwiera panel bez aktywnego trybu", async () => {
    await mount("/search?q=raport&adv=1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Dokładna fraza" })).toBeInTheDocument(),
    );
  });

  it("bez trybu i bez adv panel jest zwinięty", async () => {
    await mount("/search?q=raport");
    await waitFor(() => expect(screen.getByText("Raport roczny")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Dokładna fraza" })).not.toBeInTheDocument();
  });

  it("wybór trybu ląduje w adresie", async () => {
    const view = await mount("/search?q=raport&adv=1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Dokładna fraza" })).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dokładna fraza" }));
    });
    await waitFor(() => expect(view.search().match).toBe("phrase"));
  });
});
