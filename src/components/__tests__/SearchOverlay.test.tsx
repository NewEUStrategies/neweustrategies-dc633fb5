/**
 * <SearchOverlay /> - warstwa "szybkiego wyszukiwania" otwierana lupką w
 * nagłówku (tryb `fullscreen` w portalu do <body>) oraz jako popover przy
 * widgecie wyszukiwarki (tryb `dropdown`).
 *
 * CO TEN PLIK PRZYPINA (i dlaczego akurat to).
 *  1. BRAMA OTWARCIA I SPRZĄTANIE PO SOBIE. `open={false}` ma nie zostawić
 *     w drzewie NICZEGO (komponent zwraca `null`), a otwarcie w trybie modalnym
 *     wyłącza tło z nawigacji (`inert` + `aria-hidden`) i blokuje przewijanie
 *     strony. Domknięcie/odmontowanie musi PRZYWRÓCIĆ poprzednie wartości -
 *     także wtedy, gdy sąsiad miał własne `aria-hidden` (osobny przypadek),
 *     bo inaczej overlay trwale kaleczy dostępność strony pod spodem.
 *  2. HISTORIA WYSZUKIWAŃ (localStorage). Lista ostatnich fraz, wybór pozycji
 *     (zapis frazy + zamknięcie + nawigacja) oraz czyszczenie historii -
 *     wszystkie trzy to inline'owe handlery, których dotąd nikt nie kliknął.
 *  3. ZAKŁADKI I WYNIKI. Jedno zapytanie karmi pięć sekcji, więc liczniki przy
 *     zakładkach są realne; automatyczny wybór pierwszej NIEPUSTEJ zakładki ma
 *     ustępować, gdy użytkownik sam kliknie sekcję (przypięcie wyboru), a
 *     sekcja bez wyników ma być nieklikalna.
 *  4. KLAWIATURA (wzorzec combobox + listbox). Strzałki przesuwają
 *     `aria-activedescendant` w granicach listy, Enter wchodzi w podświetlony
 *     wynik albo - gdy nic nie jest podświetlone - na stronę wyników, Escape
 *     zamyka. To jest jedyna droga, którą da się uruchomić `onKey`.
 *  5. OPERATORY. Przycisk operatora wstawia tekst W MIEJSCE KARETKI (a nie na
 *     koniec pola) i po klatce animacji ustawia karetkę w zadanym punkcie -
 *     dlatego przypadek mierzy JEDNO I DRUGIE.
 *  6. DWUJĘZYCZNOŚĆ MIERZONA SŁOWNIKIEM, nie kopią napisu: `t` w atrapie
 *     `react-i18next` to PRAWDZIWY `getFixedT(lang)` z `@/test/i18nReal`,
 *     a bramka `dict()` oblewa przypadek, gdy klucz zniknie ze słownika.
 *  7. GRANICA SIECI: happy-dom WYKONUJE `<script src>`, więc osobny przypadek
 *     dowodzi, że pełny przebieg z interakcjami nie woła `fetch` i nie zostawia
 *     w drzewie skryptu z adresem.
 *
 * CO JEST ZAATRAPOWANE I DLACZEGO.
 *  * `@/integrations/supabase/client` - granica danych. Atrapa oddaje wiersze
 *    RPC/tabel, więc PRAWDZIWY `overlaySearchQueryOptions` (mapowanie wierszy
 *    na trafienia, wybór języka etykiety, zdejmowanie `<b>` ze snippetu klubu)
 *    wykonuje się naprawdę. Bramka `h.gate` pozwala zatrzymać odpowiedź i
 *    zmierzyć stan ładowania.
 *  * `@tanstack/react-router` - moduł prawdziwy z podmienionym `useRouter`
 *    (rejestrator nawigacji i preloadu dla `AppLink`).
 *  * `react-i18next` - atrapa z PRAWDZIWYM `t`. Fabryka `vi.mock` jest
 *    synchroniczna i nic nie importuje: skrót `await import("@/test/i18nReal")`
 *    zakleszcza plik, bo ten moduł dochodzi do `react-i18next` (ten sam wniosek
 *    stoi w nagłówku `Header.test.tsx`).
 *  * `@/lib/analytics/track` - `trackSearch` normalnie kolejkuje beacon do
 *    `/api/public/track`; tutaj rejestruje wywołanie, żeby test mógł
 *    zaasertować liczbę wyników i źródło ZDARZENIA, nie wychodząc do sieci.
 *
 * CO ZOSTAJE PRAWDZIWE: React (stan, efekty, portal), `useDebouncedValue`,
 * `useFocusTrap`, `useQuery` na świeżym `QueryClient`, `recentSearches`
 * (prawdziwy localStorage), `overlayTabs`, `AppLink` i atomy `SuggestListView`.
 *
 * ZNALEZISKO (przypięte niżej jako `it.fails`) - UWAGA, to NIE jest defekt
 * widoczny dla czytelnika, a UKRYTE SPRZĘŻENIE między modułami:
 * `SearchOverlay` importuje wyłącznie nakładkę `@/lib/i18n-public`, a używa
 * kluczy `search.recent`, `search.recent_clear`, `search.widget.*`, które
 * rejestruje `@/lib/i18n-search`. Overlay tej nakładki NIE deklaruje - w
 * prawdziwej aplikacji dociąga ją cudzy moduł: `__root.tsx` renderuje
 * (bezwarunkowo, przez `lazy`) `<CommandPalette />`, a ten importuje
 * `@/lib/i18n-search`, który rejestruje słownik przy ewaluacji modułu. Napisy
 * są więc na stronie poprawne, dopóki tamten chunk dojdzie pierwszy - a
 * dochodzi, bo ładuje się z pierwszym renderem `__root`, podczas gdy overlay
 * jest lazy i wchodzi dopiero po kliknięciu lupki. Ryzyko resztkowe: gdyby
 * kolejność się odwróciła, `addResourceBundle` już nie przemaluje overlaya
 * (domyślne `bindI18n` react-i18next to samo `languageChanged`), a usunięcie
 * `<CommandPalette />` z `__root` zabrałoby overlayowi napisy bez żadnego
 * sygnału w jego własnym pliku. Ten plik CELOWO nie importuje
 * `@/lib/i18n-search`, żeby zmierzyć, co overlay gwarantuje SAM ZE SIEBIE;
 * jednolinijkowe domknięcie sprzężenia to `import "@/lib/i18n-search"` w
 * `SearchOverlay.tsx`.
 *
 * ŚWIADOMIE POZA ZAKRESEM: gałęzie `typeof document === "undefined"` (SSR -
 * w happy-dom nie da się ich osiągnąć uczciwie) oraz wygląd (klasy Tailwind).
 *
 * RODO: żadnych prawdziwych osób ani adresów - dane są zmyślone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

type Row = Record<string, unknown>;

interface StubResult {
  data: Row[] | null;
  error: { message: string } | null;
}

interface FromChain {
  select: () => FromChain;
  or: () => FromChain;
  limit: () => Promise<StubResult>;
}

/** Stan atrap trzymany tak, jak w całym repo - hoistowany obiekt. */
const h = vi.hoisted(() => ({
  /** Prawdziwy `getFixedT(lang)`, wstrzykiwany poniżej (fabryka nic nie importuje). */
  t: null as null | ((lang: "pl" | "en") => unknown),
  lang: "pl" as "pl" | "en",
  rpcRows: {} as Record<string, Row[]>,
  rpcErrors: {} as Record<string, string>,
  tableRows: {} as Record<string, Row[]>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> | undefined }>,
  /** Zatrzymanie odpowiedzi bazy - do zmierzenia stanu ładowania. */
  gate: null as null | Promise<void>,
  navigations: [] as string[],
  preloads: [] as string[],
  searchEvents: [] as Array<{ query: string; meta: Record<string, unknown> | undefined }>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: h.t?.(h.lang),
    i18n: {
      language: h.lang,
      changeLanguage: () => Promise.resolve(),
      on: () => {},
      off: () => {},
    },
    ready: true,
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      h.rpcCalls.push({ name, args });
      if (h.gate) await h.gate;
      const message = h.rpcErrors[name];
      if (message) return { data: null, error: { message } };
      return { data: h.rpcRows[name] ?? [], error: null };
    },
    from: (table: string) => {
      const chain: FromChain = {
        select: () => chain,
        or: () => chain,
        limit: async () => {
          if (h.gate) await h.gate;
          return { data: h.tableRows[table] ?? [], error: null };
        },
      };
      return chain;
    },
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useRouter: () => ({
      navigate: (opts: { href?: string }) => {
        h.navigations.push(String(opts.href));
        return Promise.resolve();
      },
      preloadRoute: (opts: { href?: string }) => {
        h.preloads.push(String(opts.href));
        return Promise.resolve();
      },
    }),
  };
});

vi.mock("@/lib/analytics/track", () => ({
  trackSearch: (query: string, meta?: Record<string, unknown>) => {
    h.searchEvents.push({ query, meta });
  },
}));

import { realT } from "@/test/i18nReal";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { SearchOverlay } from "@/components/SearchOverlay";

h.t = (lang: "pl" | "en") => realT(lang);

/**
 * Odczyt ze słownika, który NIE MOŻE przejść na brakującym kluczu: i18next dla
 * nieistniejącego klucza zwraca sam klucz, a komponent renderuje dokładnie
 * `t(key)` - bez tej bramki asercja porównywałaby echo z echem.
 */
function dict(lang: "pl" | "en", key: string): string {
  const value = String(realT(lang)(key));
  if (value === key) {
    throw new Error(
      `Klucz i18n "${key}" (${lang}) nie ma tłumaczenia - i18next zwrócił sam klucz. ` +
        "Asercja na tej wartości mierzyłaby echo klucza, nie słownik.",
    );
  }
  return value;
}

const RECENT_KEY = "recent-searches:v1";

interface OverlayProps {
  open?: boolean;
  onClose?: () => void;
  mode?: "standalone" | "dropdown" | "fullscreen";
  heading?: string;
  liveResults?: boolean;
  limit?: number;
  lang?: "pl" | "en";
}

function overlay(props: OverlayProps): ReactElement {
  const {
    open = true,
    onClose = () => {},
    mode = "fullscreen",
    heading = "",
    liveResults = true,
    limit = 8,
    lang = "pl",
  } = props;
  return (
    <SearchOverlay
      open={open}
      onClose={onClose}
      mode={mode}
      heading={heading}
      liveResults={liveResults}
      limit={limit}
      lang={lang}
    />
  );
}

function renderOverlay(props: OverlayProps = {}) {
  return renderWithQueryClient(overlay(props));
}

/**
 * Wariant pozwalający PRZESTAWIĆ propsy przy tym samym kliencie zapytań -
 * `rerender` z RTL renderuje goły element, więc bez własnego opakowania
 * komponent zgubiłby `QueryClientProvider`.
 */
function renderReopenable(props: OverlayProps = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (p: OverlayProps): ReactElement => (
    <QueryClientProvider client={client}>{overlay(p)}</QueryClientProvider>
  );
  const view = render(wrap(props));
  return { ...view, setProps: (next: OverlayProps) => view.rerender(wrap(next)) };
}

function seedRecent(terms: string[]): void {
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(terms));
}

function readRecent(): string[] {
  const raw = window.localStorage.getItem(RECENT_KEY);
  return raw === null ? [] : (JSON.parse(raw) as string[]);
}

const input = (): HTMLInputElement => {
  const el = screen.getByRole("combobox");
  if (!(el instanceof HTMLInputElement)) throw new Error("Combobox nie jest polem tekstowym.");
  return el;
};

/** Wpisanie frazy + odczekanie na debounce (220 ms) i rozwiązanie zapytania. */
async function search(value: string): Promise<void> {
  fireEvent.change(input(), { target: { value } });
  await waitFor(() => {
    expect(h.rpcCalls.some((c) => c.name === "search_posts" && c.args?.["_q"] === value)).toBe(
      true,
    );
  });
}

/** Wypadnięcie klatki animacji - `insertOperator` ustawia w niej karetkę. */
async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

const postRow = (id: string, slug: string, titlePl: string, titleEn: string): Row => ({
  id,
  slug,
  title_pl: titlePl,
  title_en: titleEn,
  excerpt_pl: "streszczenie",
  excerpt_en: "summary",
});

/** Sąsiedzi <body> dołożeni przez test - sprzątane w `afterEach`. */
const strays: HTMLElement[] = [];

function appendBodyChild(attrs: Record<string, string>): HTMLElement {
  const el = document.createElement("div");
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  document.body.appendChild(el);
  strays.push(el);
  return el;
}

beforeEach(() => {
  h.lang = "pl";
  h.rpcRows = {};
  h.rpcErrors = {};
  h.tableRows = {};
  h.rpcCalls.length = 0;
  h.navigations.length = 0;
  h.preloads.length = 0;
  h.searchEvents.length = 0;
  h.gate = null;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  for (const el of strays.splice(0, strays.length)) el.remove();
  window.localStorage.clear();
  document.body.style.removeProperty("overflow");
  document.body.style.removeProperty("touch-action");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// --- Brama otwarcia i sprzątanie ---------------------------------------------

describe("SearchOverlay - brama otwarcia i sprzątanie po sobie", () => {
  it("zamknięty nie zostawia w drzewie niczego i nie blokuje przewijania", () => {
    const { container } = renderOverlay({ open: false });

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("otwarty w portalu wyłącza tło z nawigacji i blokuje przewijanie, a odmontowanie to cofa", () => {
    const { container, unmount } = renderOverlay({});

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", dict("pl", "searchOverlay.dialogLabel"));
    // Portal: warstwa wisi bezpośrednio na <body>, poza kontenerem RTL.
    expect(container.contains(dialog)).toBe(false);

    // `container` RTL to samodzielne dziecko <body>, więc overlay musi je
    // wyłączyć razem z resztą tła.
    expect(container.parentElement).toBe(document.body);
    expect(container.hasAttribute("inert")).toBe(true);
    expect(container.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.style.touchAction).toBe("none");

    unmount();

    expect(container.hasAttribute("inert")).toBe(false);
    expect(container.hasAttribute("aria-hidden")).toBe(false);
    expect(document.body.style.touchAction).toBe("");
  });

  it.fails(
    "DEFEKT: po zamknięciu warstwy <body> zostaje z `overflow: hidden` - strona przestaje się przewijać",
    () => {
      // Dwa efekty pilnują tej samej właściwości: modalny (blokada + inert)
      // zapamiętuje ""; ten drugi (uniwersalny) startuje PO nim i zapamiętuje
      // już "hidden". Przy zamknięciu sprzątają w kolejności deklaracji, więc
      // ostatni przywraca "hidden" - czyli blokadę, którą sam założył.
      const { setProps } = renderReopenable({});
      expect(document.body.style.overflow).toBe("hidden");

      setProps({ open: false });

      expect(document.body.style.overflow).toBe("");
    },
  );

  it("sąsiad z własnym aria-hidden dostaje swoją wartość z powrotem, a druga warstwa jest pomijana", () => {
    const neighbour = appendBodyChild({ "aria-hidden": "false", "data-rola": "sasiad" });
    const otherOverlay = appendBodyChild({ "data-search-overlay-root": "1" });

    const { unmount } = renderOverlay({});

    expect(neighbour.getAttribute("aria-hidden")).toBe("true");
    expect(neighbour.hasAttribute("inert")).toBe(true);
    // Druga warstwa wyszukiwarki NIE jest wyłączana - inaczej overlay
    // zablokowałby sam siebie przy przełączaniu trybów.
    expect(otherOverlay.hasAttribute("inert")).toBe(false);
    expect(otherOverlay.hasAttribute("aria-hidden")).toBe(false);

    unmount();

    expect(neighbour.getAttribute("aria-hidden")).toBe("false");
    expect(neighbour.hasAttribute("inert")).toBe(false);
  });

  it("tryb dropdown renderuje popover w miejscu i NIE wyłącza tła", () => {
    const { container } = renderOverlay({ mode: "dropdown" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.querySelector("input[role='combobox']")).not.toBeNull();
    expect(container.hasAttribute("inert")).toBe(false);
    // Blokada przewijania jest wspólna dla obu trybów (osobny efekt).
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.style.touchAction).toBe("");
  });

  it("kliknięcie w tło zamyka, a kliknięcie w panel - nie", () => {
    const onClose = vi.fn();
    renderOverlay({ onClose });

    const dialog = screen.getByRole("dialog");
    const backdrop = document.querySelector<HTMLElement>("[data-search-overlay-root='1']");
    expect(backdrop).not.toBeNull();

    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("krzyżyk zamyka warstwę", () => {
    const onClose = vi.fn();
    renderOverlay({ onClose });

    fireEvent.click(screen.getByRole("button", { name: dict("pl", "searchOverlay.close") }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// --- Historia wyszukiwań -----------------------------------------------------

describe("SearchOverlay - ostatnie wyszukiwania", () => {
  it("bez historii pokazuje zachętę do pisania, a nie pustą listę", () => {
    renderOverlay({});

    expect(screen.getByText(dict("pl", "searchOverlay.startTyping"))).toBeInTheDocument();
    expect(screen.getByText(dict("pl", "searchOverlay.hint"))).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("wybór pozycji z historii zapisuje frazę na szczycie, zamyka i nawiguje na stronę wyników", () => {
    seedRecent(["unia energetyczna", "rada ue"]);
    const onClose = vi.fn();
    renderOverlay({ onClose });

    const rows = screen.getAllByRole("option");
    expect(rows.map((r) => r.textContent)).toEqual(["unia energetyczna", "rada ue"]);

    fireEvent.click(rows[1]);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(h.navigations).toEqual(["/search?q=rada%20ue"]);
    // `addRecentSearch` przenosi wybraną frazę na początek historii.
    expect(readRecent()).toEqual(["rada ue", "unia energetyczna"]);
  });

  it("czyszczenie historii kasuje listę i wpis w localStorage", () => {
    seedRecent(["unia energetyczna"]);
    renderOverlay({});

    expect(screen.getAllByRole("option")).toHaveLength(1);

    // Surowy klucz, nie napis: w izolacji overlay nie ma nakładki
    // `@/lib/i18n-search` (patrz `it.fails` niżej i nagłówek pliku).
    fireEvent.click(screen.getByRole("button", { name: "search.recent_clear" }));

    expect(screen.queryByRole("option")).toBeNull();
    expect(window.localStorage.getItem(RECENT_KEY)).toBeNull();
    expect(screen.getByText(dict("pl", "searchOverlay.startTyping"))).toBeInTheDocument();
  });

  it.fails(
    "SPRZĘŻENIE (nie defekt widoczny na stronie): overlay SAM Z SIEBIE nie gwarantuje etykiet `search.*` - nakładkę `@/lib/i18n-search` dociąga cudzy moduł",
    () => {
      seedRecent(["unia energetyczna"]);
      renderOverlay({});

      // W słowniku klucz istnieje ("Wyczyść historię" / "Clear history"), ale
      // rejestruje go `@/lib/i18n-search`, którego SearchOverlay nie importuje.
      // W aplikacji napis JEST poprawny, bo `__root.tsx` renderuje
      // `<CommandPalette />`, a ten importuje tamtą nakładkę - overlay jedzie
      // więc na cudzym imporcie. Tu, w izolacji, widać co gwarantuje sam:
      // surowy klucz. Przypadek pilnuje granicy własności słownika, nie
      // bieżącego wyglądu strony - patrz nagłówek pliku.
      expect(screen.getByRole("button", { name: "Wyczyść historię" })).toBeInTheDocument();
    },
  );
});

// --- Wyniki, zakładki, wybór -------------------------------------------------

describe("SearchOverlay - wyniki i zakładki", () => {
  it("wpisana fraza pyta o wszystkie sekcje z limitem i pokazuje liczniki przy zakładkach", async () => {
    h.rpcRows["search_posts"] = [postRow("p1", "raport-ue", "Raport o UE", "EU report")];
    h.tableRows["categories"] = [
      { id: "c1", slug: "energia", name_pl: "Energia", name_en: "Energy" },
    ];
    h.tableRows["tags"] = [{ id: "t1", slug: "klimat", name: "Klimat" }];
    h.rpcRows["search_people_orgs"] = [
      {
        id: "e1",
        kind: "person",
        label_pl: "Anna Przykładowa",
        label_en: "Anna Example",
        sublabel_pl: "Instytut Testowy",
        sublabel_en: "Test Institute",
        slug: "anna-przykladowa",
        avatar_url: null,
      },
    ];

    renderOverlay({ limit: 5 });
    await search("ue");

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Wpisy/ })).toHaveAttribute("aria-selected", "true");
    });

    const posts = h.rpcCalls.find((c) => c.name === "search_posts");
    expect(posts?.args).toEqual({ _q: "ue", _limit: 5 });
    expect(h.rpcCalls.map((c) => c.name).sort()).toEqual([
      "club_search",
      "search_people",
      "search_people_orgs",
      "search_posts",
    ]);

    // Liczniki: 1 wpis, 2 pozycje tematyki (kategoria + tag), 1 ekspert.
    expect(screen.getByRole("tab", { name: /Wpisy/ })).toHaveTextContent("1");
    expect(screen.getByRole("tab", { name: /Tematyka/ })).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: /Eksperci/ })).toHaveTextContent("1");
    // Sekcje bez wyników są nieklikalne.
    expect(screen.getByRole("tab", { name: /Kluby/ })).toBeDisabled();
    expect(screen.getByRole("tab", { name: /Osoby/ })).toBeDisabled();

    expect(screen.getByRole("option")).toHaveTextContent("Raport o UE");
    expect(input()).toHaveAttribute("aria-expanded", "true");
  });

  it("bez wpisów sam z siebie przechodzi na pierwszą niepustą zakładkę", async () => {
    h.tableRows["tags"] = [{ id: "t1", slug: "klimat", name: "Klimat" }];

    renderOverlay({});
    await search("kli");

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Tematyka/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(screen.getByRole("tab", { name: /Wpisy/ })).toBeDisabled();
    expect(screen.getByRole("option")).toHaveTextContent("Klimat");
  });

  it("ręczny wybór zakładki jest przypięty - kolejne wyniki go nie przestawiają", async () => {
    h.rpcRows["search_posts"] = [postRow("p1", "raport-ue", "Raport o UE", "EU report")];
    h.tableRows["tags"] = [{ id: "t1", slug: "klimat", name: "Klimat" }];

    renderOverlay({});
    await search("ue");
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Wpisy/ })).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.click(screen.getByRole("tab", { name: /Tematyka/ }));
    expect(screen.getByRole("tab", { name: /Tematyka/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option")).toHaveTextContent("Klimat");

    // Nowa fraza = nowy zestaw wyników. Bez przypięcia automat wróciłby na "Wpisy".
    h.rpcRows["search_posts"] = [postRow("p2", "rada", "Rada UE", "EU Council")];
    await search("rada");
    await waitFor(() => {
      expect(h.rpcCalls.filter((c) => c.name === "search_posts")).toHaveLength(2);
    });

    expect(screen.getByRole("tab", { name: /Tematyka/ })).toHaveAttribute("aria-selected", "true");
  });

  it("najechanie na wiersz przesuwa podświetlenie, a kliknięcie zapisuje frazę i zamyka", async () => {
    h.rpcRows["search_posts"] = [
      postRow("p1", "raport-ue", "Raport o UE", "EU report"),
      postRow("p2", "rada-ue", "Rada UE", "EU Council"),
    ];
    const onClose = vi.fn();
    renderOverlay({ onClose });
    await search("ue");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));

    const [first, second] = screen.getAllByRole("option");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(input().getAttribute("aria-activedescendant")).toBe(first.id);

    fireEvent.mouseEnter(second);
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(input().getAttribute("aria-activedescendant")).toBe(second.id);

    fireEvent.click(second);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(readRecent()).toEqual(["ue"]);
    expect(h.navigations).toEqual(["/post/rada-ue"]);
  });

  it("brak trafień pokazuje komunikat o pustym wyniku", async () => {
    renderOverlay({});
    await search("xyz");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(dict("pl", "searchOverlay.noResults"));
    });
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("odmowa bazy w sekcji nie wywraca overlaya - reszta wyników zostaje", async () => {
    h.rpcErrors["search_posts"] = "42883 undefined function";
    h.rpcRows["club_search"] = [
      {
        thread_id: "th1",
        title: "Wątek o energii",
        snippet: "fragment <b>energia</b> dalej",
        club_slug: "klub-energia",
        thread_slug: "watek",
      },
    ];

    renderOverlay({});
    await search("ene");

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Kluby/ })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByRole("tab", { name: /Wpisy/ })).toBeDisabled();
    // Snippet z ts_headline jest renderowany jako tekst - znaczniki zdjęte.
    expect(screen.getByRole("option")).toHaveTextContent("fragment energia dalej");
  });

  it("wyłączone wyniki na żywo (liveResults=false) nie pytają bazy", async () => {
    renderOverlay({ liveResults: false });
    fireEvent.change(input(), { target: { value: "ue" } });

    await flushFrame();
    expect(h.rpcCalls).toHaveLength(0);
    expect(screen.getByText(dict("pl", "searchOverlay.startTyping")).textContent).toBeTruthy();
  });
});

// --- Pasek wyszukiwania ------------------------------------------------------

describe("SearchOverlay - pole zapytania", () => {
  it("czyszczenie pola chowa link do pełnych wyników", async () => {
    renderOverlay({});
    await search("ue");

    expect(document.querySelector("a[href='/search?q=ue']")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: dict("pl", "searchOverlay.clear") }));

    expect(input().value).toBe("");
    expect(document.querySelector("a[href='/search?q=ue']")).toBeNull();
  });

  it("w trakcie odpytywania bazy pokazuje wskaźnik zamiast przycisku czyszczenia", async () => {
    let release = (): void => {};
    h.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.rpcRows["search_posts"] = [postRow("p1", "raport-ue", "Raport o UE", "EU report")];

    const { container } = renderOverlay({});
    fireEvent.change(input(), { target: { value: "ue" } });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: dict("pl", "searchOverlay.clear") })).toBeNull();
    });
    expect(container.ownerDocument.querySelector(".animate-spin")).not.toBeNull();

    h.gate = null;
    await act(async () => {
      release();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: dict("pl", "searchOverlay.clear") })).toBeVisible();
    });
  });
});

// --- Klawiatura --------------------------------------------------------------

describe("SearchOverlay - nawigacja klawiaturą", () => {
  /** Wiersze BEZ zajawki - etykieta wiersza jest wtedy całą jego treścią. */
  const bare = (id: string, slug: string, label: string): Row => ({
    id,
    slug,
    title_pl: label,
    title_en: label,
    excerpt_pl: null,
    excerpt_en: null,
  });

  const withThreeResults = async (onClose = vi.fn()) => {
    h.rpcRows["search_posts"] = [
      bare("p1", "a", "Wynik A"),
      bare("p2", "b", "Wynik B"),
      bare("p3", "c", "Wynik C"),
    ];
    renderOverlay({ onClose });
    await search("wy");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    return onClose;
  };

  const activeLabel = (): string | null => {
    const id = input().getAttribute("aria-activedescendant");
    return id === null ? null : (document.getElementById(id)?.textContent ?? null);
  };

  it("strzałki przesuwają podświetlenie i zatrzymują się na krańcach listy", async () => {
    await withThreeResults();
    expect(activeLabel()).toBe("Wynik A");

    act(() => {
      fireEvent.keyDown(window, { key: "ArrowDown" });
    });
    expect(activeLabel()).toBe("Wynik B");

    act(() => {
      fireEvent.keyDown(window, { key: "ArrowDown" });
      fireEvent.keyDown(window, { key: "ArrowDown" });
    });
    expect(activeLabel()).toBe("Wynik C");

    act(() => {
      fireEvent.keyDown(window, { key: "ArrowUp" });
      fireEvent.keyDown(window, { key: "ArrowUp" });
      fireEvent.keyDown(window, { key: "ArrowUp" });
    });
    expect(activeLabel()).toBe("Wynik A");
  });

  it("Enter wchodzi w podświetlony wynik, zapisuje frazę i zamyka", async () => {
    const onClose = await withThreeResults();

    // Osobne `act`: uchwyt `keydown` czyta `active` z domknięcia renderu, więc
    // Enter w tej samej partii co strzałka widziałby jeszcze poprzedni wiersz.
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowDown" });
    });
    act(() => {
      fireEvent.keyDown(window, { key: "Enter" });
    });

    expect(h.navigations).toEqual(["/post/b"]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(readRecent()).toEqual(["wy"]);
  });

  it("Enter bez trafień prowadzi na stronę wyników z zapytaniem", async () => {
    const onClose = vi.fn();
    renderOverlay({ onClose });
    await search("brak");
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    act(() => {
      fireEvent.keyDown(window, { key: "Enter" });
    });

    expect(h.navigations).toEqual(["/search?q=brak"]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(readRecent()).toEqual(["brak"]);
  });

  it("Enter przy zapytaniu krótszym niż dwa znaki nic nie robi", () => {
    const onClose = vi.fn();
    renderOverlay({ onClose });
    fireEvent.change(input(), { target: { value: "u" } });

    act(() => {
      fireEvent.keyDown(window, { key: "Enter" });
    });

    expect(h.navigations).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape zamyka warstwę, a obojętny klawisz nie", () => {
    const onClose = vi.fn();
    renderOverlay({ onClose });

    act(() => {
      fireEvent.keyDown(window, { key: "a" });
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// --- Operatory ---------------------------------------------------------------

describe("SearchOverlay - operatory wyszukiwania", () => {
  it("wstawia operator W MIEJSCE KARETKI i po klatce ustawia karetkę za nim", async () => {
    renderOverlay({});
    const el = input();
    fireEvent.change(el, { target: { value: "ue klimat" } });
    el.setSelectionRange(2, 2);

    fireEvent.mouseDown(screen.getByRole("button", { name: "AND" }));

    expect(input().value).toBe("ue AND  klimat");
    await flushFrame();
    expect(input().selectionStart).toBe(7);
    expect(document.activeElement).toBe(input());
  });

  it("operator frazy zostawia karetkę WEWNĄTRZ cudzysłowu", async () => {
    renderOverlay({});
    const el = input();
    fireEvent.change(el, { target: { value: "" } });
    el.setSelectionRange(0, 0);

    fireEvent.mouseDown(screen.getByRole("button", { name: '"fraza"' }));

    expect(input().value).toBe('"" ');
    await flushFrame();
    expect(input().selectionStart).toBe(1);
  });

  it("wstawienie operatora na zaznaczeniu podmienia zaznaczony fragment", async () => {
    renderOverlay({});
    const el = input();
    fireEvent.change(el, { target: { value: "ue klimat" } });
    el.setSelectionRange(3, 9);

    fireEvent.mouseDown(screen.getByRole("button", { name: "-słowo" }));

    expect(input().value).toBe("ue  -");
  });
});

// --- Linki do pełnych wyników ------------------------------------------------

describe("SearchOverlay - przejście do pełnych wyników", () => {
  it("link 'zobacz wszystkie' niesie zapytanie, zapisuje frazę i zamyka", async () => {
    const onClose = vi.fn();
    renderOverlay({ onClose });
    await search("unia");

    const link = document.querySelector<HTMLAnchorElement>("a[href='/search?q=unia']");
    expect(link).not.toBeNull();
    if (!link) return;
    expect(link.textContent).toContain(dict("pl", "searchOverlay.viewAllFor").trim());

    fireEvent.click(link);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(readRecent()).toEqual(["unia"]);
    expect(h.navigations).toEqual(["/search?q=unia"]);
  });

  it("wyszukiwanie zaawansowane bez frazy prowadzi na sam formularz", () => {
    const onClose = vi.fn();
    renderOverlay({ onClose });

    const link = document.querySelector<HTMLAnchorElement>("a[href='/search?adv=1']");
    expect(link).not.toBeNull();
    if (!link) return;

    fireEvent.click(link);

    expect(h.navigations).toEqual(["/search?adv=1"]);
    expect(onClose).toHaveBeenCalledTimes(1);
    // Fraza krótsza niż dwa znaki nie trafia do historii.
    expect(readRecent()).toEqual([]);
  });

  it("wyszukiwanie zaawansowane z frazą przenosi ją w adresie", async () => {
    renderOverlay({});
    await search("unia");

    const link = document.querySelector<HTMLAnchorElement>("a[href='/search?q=unia&adv=1']");
    expect(link).not.toBeNull();
    if (link) fireEvent.click(link);

    expect(h.navigations).toEqual(["/search?q=unia&adv=1"]);
  });
});

// --- Analityka ---------------------------------------------------------------

describe("SearchOverlay - zdarzenie wyszukiwania", () => {
  it("po ustaleniu wyników melduje frazę, liczbę trafień, źródło i język", async () => {
    h.rpcRows["search_posts"] = [
      postRow("p1", "a", "Wynik A", "Result A"),
      postRow("p2", "b", "Wynik B", "Result B"),
    ];
    h.tableRows["tags"] = [{ id: "t1", slug: "klimat", name: "Klimat" }];

    renderOverlay({ mode: "dropdown", lang: "en" });
    await search("eu");

    await waitFor(() => expect(h.searchEvents.length).toBeGreaterThan(0));
    const last = h.searchEvents.at(-1);
    expect(last?.query).toBe("eu");
    expect(last?.meta).toEqual({ results: 3, source: "overlay", mode: "dropdown", lang: "en" });
  });
});

// --- Dwujęzyczność -----------------------------------------------------------

describe("SearchOverlay - warianty językowe", () => {
  it("wariant PL bierze podpowiedź, zakładki i puste stany z polskiego słownika", () => {
    h.lang = "pl";
    renderOverlay({ lang: "pl" });

    expect(input()).toHaveAttribute("placeholder", dict("pl", "searchOverlay.placeholder"));
    expect(screen.getByText(dict("pl", "searchOverlay.startTyping"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: dict("pl", "searchOverlay.close") }),
    ).toBeInTheDocument();
  });

  it("wariant EN niesie napisy z angielskiego słownika i angielskie etykiety wyników", async () => {
    h.lang = "en";
    h.rpcRows["search_posts"] = [postRow("p1", "a", "Wynik A", "Result A")];

    renderOverlay({ lang: "en" });
    expect(input()).toHaveAttribute("placeholder", dict("en", "searchOverlay.placeholder"));
    expect(screen.getByText(dict("en", "searchOverlay.startTyping"))).toBeInTheDocument();

    await search("re");
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Posts/ })).toHaveAttribute("aria-selected", "true");
    });
    // Etykieta trafienia idzie z kolumny EN, nie z PL.
    expect(screen.getByRole("option")).toHaveTextContent("Result A");
    // Dowód, że to naprawdę dwa różne słowniki, a nie kopia jednego napisu.
    expect(dict("en", "searchOverlay.startTyping")).not.toBe(
      dict("pl", "searchOverlay.startTyping"),
    );
  });

  it("własny nagłówek z ustawień przebija podpowiedź ze słownika", () => {
    renderOverlay({ heading: "Szukaj w analizach" });

    expect(input()).toHaveAttribute("placeholder", "Szukaj w analizach");
    expect(input()).toHaveAttribute("aria-label", "Szukaj w analizach");
  });
});

// --- Granica sieci -----------------------------------------------------------

describe("SearchOverlay - nie wychodzi do sieci", () => {
  it("pełny przebieg z wyszukiwaniem i wyborem wyniku nie woła fetcha ani nie wstrzykuje skryptu", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("test nie ma prawa iść do sieci")));
    vi.stubGlobal("fetch", fetchSpy);
    const beacon = vi.spyOn(navigator, "sendBeacon");
    h.rpcRows["search_posts"] = [postRow("p1", "a", "Wynik A", "Result A")];

    renderOverlay({});
    await search("wy");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    fireEvent.click(screen.getAllByRole("option")[0]);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(document.querySelectorAll("script[src]")).toHaveLength(0);
  });
});
