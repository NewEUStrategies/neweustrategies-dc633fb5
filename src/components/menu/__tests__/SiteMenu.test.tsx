// Nawigacja publiczna - render. Reguły (drzewo, wariant panelu, źródło kolumn,
// geometria) mają własne asercje w `lib/menus/__tests__/siteMenu.test.ts`;
// tutaj sprawdzamy to, czego czysta funkcja nie dowiedzie: że wariant faktycznie
// TRAFIA NA EKRAN i że czytelnik dostaje treść, a nie pusty kontener.
//
// Jeden test na wariant, każdy z asercją na TREŚĆ (nie na sam fakt renderu) -
// repo raz już zdjęło warstwę testów renderujących bez asercji.
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MegaConfig, MenuItemRow, MenuWithItems } from "@/lib/menus/types";
import { DEFAULT_MEGA_CONFIG } from "@/lib/menus/types";

// Warstwa danych jest podmieniona tylko w `queryFn`, bo test dotyczy RENDERU:
// `getMenuWithItems` to server fn (nie da się jej wywołać bez kontekstu
// żądania), a `megaFeatured` idzie do Supabase. Klucz, świeżość i `select`
// pochodzą z PRAWDZIWYCH query options, a `queryFn` oddaje menu w KSZTAŁCIE
// PRZESYŁKI (`compactMenuWithItems`, P2.5) - dokładnie to, co SSR wpisuje do
// stanu odwodnionego. Każdy test renderu poniżej przechodzi więc przez
// projekcję i jej odwrotność. `wire: false` podaje pełny wiersz (kontrola),
// `noSelect: true` czyta przesyłkę BEZ `select` - jak karta otwarta przed
// wdrożeniem, której stary kod dostaje przesyłkę z nowego serwera.
const state = vi.hoisted(() => ({
  pending: false,
  wire: true,
  noSelect: false,
  data: null as MenuWithItems | null,
}));

vi.mock("@/lib/menus/queries", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/menus/queries")>();
  const { compactMenuWithItems } = await import("@/lib/menus/menu.functions");
  return {
    ...real,
    menuWithItemsQueryOptions: (key: string) => ({
      ...real.menuWithItemsQueryOptions(key),
      ...(state.noSelect ? { select: undefined } : {}),
      queryFn: () =>
        state.pending
          ? new Promise<never>(() => {})
          : Promise.resolve(state.wire ? compactMenuWithItems(state.data) : state.data),
    }),
  };
});

vi.mock("@/lib/menus/megaFeatured", () => ({
  megaFeaturedPostQueryOptions: (postId: string | null) => ({
    queryKey: ["mega-menu-featured-post", postId],
    queryFn: () => Promise.resolve(null),
  }),
}));

const { SiteMenu } = await import("@/components/menu/SiteMenu");

function item(over: Partial<MenuItemRow> & { id: string }): MenuItemRow {
  return {
    menu_id: "menu-1",
    parent_id: null,
    position: 0,
    item_type: "custom",
    ref_id: null,
    label_pl: "",
    label_en: "",
    href: "",
    target: "_self",
    css_class: "",
    visibility: "all" as const,
    icon: "",
    mega_enabled: false,
    mega_config: DEFAULT_MEGA_CONFIG,
    ...over,
  };
}

function setMenu(items: MenuItemRow[]): void {
  state.pending = false;
  state.data = { id: "menu-1", key: "main", name: "Główne", items };
}

async function renderMenu(props: { lang?: "pl" | "en"; mobile?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <SiteMenu menuKey="main" lang={props.lang ?? "pl"} mobile={props.mobile} />
    </QueryClientProvider>,
  );
  if (!state.pending) await screen.findByRole("navigation").catch(() => null);
  return utils;
}

beforeEach(() => {
  state.pending = false;
  state.wire = true;
  state.noSelect = false;
  state.data = { id: "menu-1", key: "main", name: "Główne", items: [] };
});

afterEach(cleanup);

describe("stan wczytywania i pustka", () => {
  it("dopóki zapytanie trwa, pokazuje SZKIELET, nie komunikat o pustym menu", async () => {
    // Bez tego rozróżnienia przy każdym zimnym renderze mignęłoby „Menu jest
    // puste" - komunikat o błędzie konfiguracji na sprawnym serwisie.
    state.pending = true;
    const { container } = await renderMenu();
    expect(screen.queryByText(/Menu jest puste/)).toBeNull();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(5);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden");
  });

  it("puste menu tłumaczy administratorowi, gdzie je skonfigurować (PL i EN)", async () => {
    setMenu([]);
    const { unmount } = await renderMenu({ lang: "pl" });
    expect(screen.getByText(/Menu jest puste/)).toBeTruthy();
    expect(screen.getByText(/Admin → Wygląd → Menu/)).toBeTruthy();
    unmount();

    await renderMenu({ lang: "en" });
    expect(screen.getByText(/Menu is empty/)).toBeTruthy();
  });
});

describe("wariant desktopowy", () => {
  it("pozycja bez dzieci jest zwykłym linkiem w nawigacji głównej", async () => {
    setMenu([item({ id: "a", label_pl: "Kontakt", href: "/kontakt" })]);
    await renderMenu();
    const nav = screen.getByRole("navigation", { name: "Nawigacja główna" });
    expect(within(nav).getByRole("link", { name: "Kontakt" })).toHaveAttribute("href", "/kontakt");
    // Link, nie trigger - pozycja bez panelu nie ma czego rozwijać.
    expect(within(nav).queryByRole("button")).toBeNull();
  });

  it("nazwa nawigacji idzie za językiem strony", async () => {
    setMenu([item({ id: "a", label_en: "Contact", href: "/contact" })]);
    await renderMenu({ lang: "en" });
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeTruthy();
  });

  it("pozycja BEZ NAZWY w obu językach nie trafia do nagłówka", async () => {
    setMenu([
      item({ id: "a", label_pl: "Blog", href: "/blog" }),
      item({ id: "b", href: "/bez-nazwy", position: 1 }),
    ]);
    await renderMenu();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "" })).toBeNull();
  });

  it("otwiera płaski dropdown z linkiem do strony sekcji", async () => {
    setMenu([
      item({ id: "a", label_pl: "O nas", href: "/o-nas" }),
      item({ id: "a1", parent_id: "a", label_pl: "Zespół", href: "/o-nas/zespol" }),
    ]);
    await renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /O nas/ }));

    const panel = await screen.findByRole("menu");
    expect(within(panel).getByText("W sekcji")).toBeTruthy();
    // Strona samej sekcji jest osobną pozycją listy - inaczej rodzic z dziećmi
    // stawał się nieklikalny.
    expect(within(panel).getByText("Strona sekcji")).toBeTruthy();
    expect(within(panel).getByRole("menuitem", { name: /Zespół/ })).toHaveAttribute(
      "href",
      "/o-nas/zespol",
    );
  });

  it("oznacza linki i triggery wspólnym rozmiarem głównego menu", async () => {
    setMenu([
      item({ id: "a", label_pl: "Wywiady", href: "/wywiady" }),
      item({ id: "b", label_pl: "Analizy", href: "/analizy", position: 1 }),
      item({ id: "b1", parent_id: "b", label_pl: "Europa", href: "/europa" }),
    ]);
    await renderMenu();

    expect(screen.getByRole("link", { name: "Wywiady" })).toHaveAttribute(
      "data-site-menu-top-level",
    );
    expect(screen.getByRole("button", { name: /Analizy/ })).toHaveAttribute(
      "data-site-menu-top-level",
    );
  });

  it("menu z WNUKAMI awansuje na panel redakcyjny (bez zgody administratora)", async () => {
    setMenu([
      item({ id: "a", label_pl: "Wiedza", href: "/wiedza" }),
      item({ id: "a1", parent_id: "a", label_pl: "Analizy", href: "/analizy" }),
      item({ id: "x", parent_id: "a1", label_pl: "Raporty", href: "/raporty" }),
    ]);
    await renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /Wiedza/ }));

    const panel = await screen.findByRole("menu");
    // Kolumna z dziecka, link z wnuka - dowód, że wnuki nie zniknęły w płaskiej liście.
    expect(within(panel).getByText("Analizy")).toBeTruthy();
    expect(within(panel).getByRole("menuitem", { name: /Raporty/ })).toHaveAttribute(
      "href",
      "/raporty",
    );
    expect(within(panel).getByText(/Przejdź do strony/)).toBeTruthy();
  });

  it("pozycja z panelem niesie w HTML-u ukryte linki sekcji i podpozycji dla crawlera", async () => {
    // Zgłoszenie 2026-10-09: trigger panelu to `<button>` bez `href`, a panel
    // montuje się dopiero po najechaniu - Analizy, Wydarzenia i O nas nie były
    // w dokumencie serwera żadnym linkiem, więc nie mogły zostać sitelinkiem.
    setMenu([
      item({ id: "a", label_pl: "Wiedza", href: "/wiedza" }),
      item({ id: "a1", parent_id: "a", label_pl: "Analizy", href: "/analizy" }),
      item({ id: "x", parent_id: "a1", label_pl: "Raporty", href: "/raporty" }),
      item({ id: "b", label_pl: "Kontakt", href: "/kontakt", position: 1 }),
    ]);
    const { container } = await renderMenu();
    const mirror = container.querySelector("ul[data-site-menu-crawl]");
    expect(mirror?.hasAttribute("hidden")).toBe(true);
    expect([...(mirror?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"))).toEqual([
      "/wiedza",
      "/analizy",
      "/raporty",
    ]);
    // Lustro jest poza drzewem dostępności: czytnik ekranu i klawiatura widzą
    // nawigację dokładnie taką jak wcześniej (trigger + jeden zwykły link).
    const nav = screen.getByRole("navigation", { name: "Nawigacja główna" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual(["/kontakt"]);
    expect(within(nav).getByRole("button", { name: /Wiedza/ })).toBeTruthy();
  });

  it("pozycja bez panelu nie dostaje lustra linków", async () => {
    setMenu([item({ id: "a", label_pl: "Kontakt", href: "/kontakt" })]);
    const { container } = await renderMenu();
    expect(container.querySelector("[data-site-menu-crawl]")).toBeNull();
  });

  it("mega z ręczną konfiguracją pokazuje kolumny administratora", async () => {
    setMenu([
      item({
        id: "a",
        label_pl: "Tematy",
        href: "/tematy",
        mega_enabled: true,
        mega_config: {
          ...DEFAULT_MEGA_CONFIG,
          columns: [
            {
              title_pl: "Bezpieczeństwo",
              title_en: "Security",
              href: "/bezpieczenstwo",
              links: [{ label_pl: "NATO", label_en: "NATO", href: "/nato", icon: "" }],
            },
          ],
        },
      }),
    ]);
    await renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /Tematy/ }));

    const panel = await screen.findByRole("menu");
    expect(within(panel).getByText("Bezpieczeństwo")).toBeTruthy();
    expect(within(panel).getByRole("menuitem", { name: /NATO/ })).toHaveAttribute("href", "/nato");
  });

  it("zagnieżdżony podpunkt dropdownu rozwija się po najechaniu", async () => {
    setMenu([
      item({ id: "a", label_pl: "O nas", href: "/o-nas" }),
      item({ id: "a1", parent_id: "a", label_pl: "Zespół", href: "/zespol" }),
      item({ id: "a2", parent_id: "a", label_pl: "Historia", href: "/historia" }),
    ]);
    await renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /O nas/ }));
    await screen.findByRole("menu");
    expect(screen.getByRole("menuitem", { name: /Historia/ })).toBeTruthy();
  });

  it("pozycja otwierana w nowej karcie niesie zabezpieczenie rel", async () => {
    setMenu([
      item({ id: "a", label_pl: "Komisja", href: "https://ec.europa.eu", target: "_blank" }),
    ]);
    await renderMenu();
    const link = screen.getByRole("link", { name: "Komisja" });
    expect(link).toHaveAttribute("target", "_blank");
  });
});

describe("układ panelu mega z konfiguracji redaktora", () => {
  // Do 03.10.2026 `columns_per_row` i `width` z edytora lądowały w bazie,
  // a nagłówek ich nie czytał: siatka miała na sztywno najwyżej 4 kolumny,
  // panel zawsze 980 px. Ten blok sprawdza, że ustawienia DOCHODZĄ do ekranu.
  const OPIS_INNER_WIDTH = Object.getOwnPropertyDescriptor(window, "innerWidth");

  afterEach(() => {
    // Szerokość okna jest globalna dla pliku - oddajemy ją, żeby kolejne
    // testy nie liczyły geometrii na podstawionych 1440 px.
    if (OPIS_INNER_WIDTH) Object.defineProperty(window, "innerWidth", OPIS_INNER_WIDTH);
    else Reflect.deleteProperty(window, "innerWidth");
  });

  function megaItem(config: Partial<MegaConfig>): MenuItemRow {
    return item({
      id: "a",
      label_pl: "Tematy",
      href: "/tematy",
      mega_enabled: true,
      mega_config: {
        ...DEFAULT_MEGA_CONFIG,
        columns: ["Bezpieczeństwo", "Energia", "Gospodarka"].map((title) => ({
          title_pl: title,
          title_en: title,
          href: "",
          links: [],
        })),
        ...config,
      },
    });
  }

  /** Otwiera panel „Tematy” w oknie o zadanej szerokości. */
  async function openMega(config: Partial<MegaConfig>, viewportWidth = 1440) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: viewportWidth });
    setMenu([megaItem(config)]);
    await renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /Tematy/ }));
    return screen.findByRole("menu");
  }

  it("liczba kolumn w rzędzie z konfiguracji układa siatkę panelu", async () => {
    const panel = await openMega({ columns_per_row: 2 });
    const grid = panel.querySelector<HTMLElement>(".grid.gap-x-4");
    expect(grid?.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    // Trzecia kolumna nie znika - schodzi do drugiego rzędu.
    expect(within(panel).getByText("Gospodarka")).toBeTruthy();
  });

  it("szerokość „full” rozciąga panel na okno i kotwiczy go przy marginesie", async () => {
    const panel = await openMega({ width: "full" });
    expect(panel.style.width).toBe("calc(100vw - 32px)");
    // Wyśrodkowany jak „container" stałby 160 px od lewej i wystawał poza ekran.
    expect(panel.parentElement?.style.left).toBe("16px");
  });

  it("szerokość „container” zostawia panel tam, gdzie stał dotąd", async () => {
    const panel = await openMega({ width: "container" });
    expect(panel.parentElement?.style.left).toBe("160px");
  });
});

describe("wariant mobilny", () => {
  it("pozycja bez dzieci jest linkiem, bez akordeonu", async () => {
    setMenu([item({ id: "a", label_pl: "Kontakt", href: "/kontakt" })]);
    const { container } = await renderMenu({ mobile: true });
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByRole("link", { name: "Kontakt" })).toHaveAttribute("href", "/kontakt");
  });

  it("pozycja z dziećmi zwija się w <details> i prowadzi do strony rodzica", async () => {
    setMenu([
      item({ id: "a", label_pl: "O nas", href: "/o-nas" }),
      item({ id: "a1", parent_id: "a", label_pl: "Zespół", href: "/zespol" }),
    ]);
    const { container } = await renderMenu({ mobile: true });
    expect(container.querySelector("details")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Zespół/ })).toHaveAttribute("href", "/zespol");
    // Rodzic musi zostać osiągalny - stopka akordeonu prowadzi na jego stronę.
    expect(screen.getByText(/Przejdź do strony/)).toBeTruthy();
  });

  it("linki mega ustawione na desktopie NIE ZNIKAJĄ na telefonie", async () => {
    setMenu([
      item({
        id: "a",
        label_pl: "Tematy",
        href: "/tematy",
        mega_enabled: true,
        mega_config: {
          ...DEFAULT_MEGA_CONFIG,
          columns: [
            {
              title_pl: "Bezpieczeństwo",
              title_en: "Security",
              href: "/b",
              links: [{ label_pl: "NATO", label_en: "NATO", href: "/nato", icon: "" }],
            },
          ],
        },
      }),
    ]);
    await renderMenu({ mobile: true });
    expect(screen.getByRole("link", { name: "NATO" })).toHaveAttribute("href", "/nato");
  });

  it("nazwa nawigacji mobilnej też idzie za językiem", async () => {
    setMenu([item({ id: "a", label_en: "Contact", href: "/contact" })]);
    await renderMenu({ lang: "en", mobile: true });
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeTruthy();
  });
});

describe("zamykanie panelu", () => {
  const withPanel = () => {
    setMenu([
      item({ id: "a", label_pl: "O nas", href: "/o-nas" }),
      item({ id: "a1", parent_id: "a", label_pl: "Zespół", href: "/zespol" }),
    ]);
  };

  it("Escape zamyka panel - klawiatura musi mieć wyjście", async () => {
    withPanel();
    await renderMenu();
    const trigger = screen.getByRole("button", { name: /O nas/ });
    fireEvent.click(trigger);
    await screen.findByRole("menu");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("kliknięcie POZA nagłówkiem zamyka panel, kliknięcie w trigger nie", async () => {
    withPanel();
    await renderMenu();
    const trigger = screen.getByRole("button", { name: /O nas/ });
    fireEvent.click(trigger);
    await screen.findByRole("menu");

    // Wewnątrz triggera - panel zostaje (inaczej nie dałoby się go używać).
    fireEvent.mouseDown(trigger);
    expect(screen.queryByRole("menu")).not.toBeNull();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  /**
   * Menu na sztywnych zegarach: montaż + rozwiązanie zapytania, a potem sam
   * scenariusz. Zwraca kontener pozycji „O nas" (to on nosi handlery myszy).
   */
  async function menuNaSztywnychZegarach(): Promise<HTMLElement> {
    withPanel();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });
    render(
      <QueryClientProvider client={client}>
        <SiteMenu menuKey="main" lang="pl" />
      </QueryClientProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return screen.getByRole("button", { name: /O nas/ }).parentElement!;
  }

  /** Próg intencji najechania z `SiteMenu` (`HOVER_INTENT_MS`). */
  const HOVER_INTENT_MS = 80;

  it("przejazd kursorem przez pasek NIE montuje panelu - dopiero zatrzymanie", async () => {
    // Mega panel ciągnie zapytanie o wpis wyróżniony i całą siatkę kolumn.
    // Mysz jadąca przez nawigację do treści mijała po drodze kilka triggerów
    // i każdy z nich montował panel tylko po to, żeby go zaraz odmontować -
    // stąd próg odróżniający INTENCJĘ od przejazdu.
    vi.useFakeTimers();
    try {
      const pozycja = await menuNaSztywnychZegarach();

      fireEvent.mouseEnter(pozycja);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HOVER_INTENT_MS - 1);
      });
      expect(screen.queryByRole("menu")).toBeNull();

      fireEvent.mouseLeave(pozycja);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * HOVER_INTENT_MS);
      });
      // Wyjazd przed progiem kasuje odliczanie - panel nie ma się pojawić
      // „po fakcie", gdy kursor jest już dawno gdzie indziej.
      expect(screen.queryByRole("menu")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("klik otwiera panel NATYCHMIAST, z pominięciem progu intencji", async () => {
    // Klik jest deklaracją intencji - czekanie na próg byłoby tu wyłącznie
    // opóźnieniem odpowiedzi na wprost wyrażone żądanie.
    withPanel();
    await renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /O nas/ }));
    expect(screen.queryByRole("menu")).not.toBeNull();
  });

  it("zjechanie kursorem zamyka panel dopiero PO chwili zwłoki", async () => {
    // Zwłoka jest po to, żeby przejazd myszą przez szczelinę między triggerem
    // a panelem nie zamykał menu w połowie ruchu.
    vi.useFakeTimers();
    try {
      const pozycja = await menuNaSztywnychZegarach();

      fireEvent.mouseEnter(pozycja);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HOVER_INTENT_MS);
      });
      expect(screen.queryByRole("menu")).not.toBeNull();

      fireEvent.mouseLeave(pozycja);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(screen.queryByRole("menu")).not.toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(screen.queryByRole("menu")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("powrót kursora na trigger ODWOŁUJE zaplanowane zamknięcie", async () => {
    vi.useFakeTimers();
    try {
      const pozycja = await menuNaSztywnychZegarach();

      // Panel musi być NAPRAWDĘ otwarty, zanim sprawdzimy odwołanie zamknięcia
      // - inaczej test mierzyłby próg otwarcia, a nie anulowanie zwłoki.
      fireEvent.mouseEnter(pozycja);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HOVER_INTENT_MS);
      });
      expect(screen.queryByRole("menu")).not.toBeNull();

      fireEvent.mouseLeave(pozycja);
      fireEvent.mouseEnter(pozycja);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(screen.queryByRole("menu")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("przewijanie i zmiana rozmiaru okna nie gubią otwartego panelu", async () => {
    // Panel jest `position: fixed` i kotwiczy się do triggera, więc przy każdym
    // ruchu strony musi przeliczyć pozycję - a nie zniknąć.
    withPanel();
    await renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /O nas/ }));
    await screen.findByRole("menu");

    fireEvent.scroll(window);
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("menu")).not.toBeNull();
  });

  it("ponowne kliknięcie triggera zamyka panel", async () => {
    withPanel();
    await renderMenu();
    const trigger = screen.getByRole("button", { name: /O nas/ });
    fireEvent.click(trigger);
    await screen.findByRole("menu");
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

// DIETA STANU ODWODNIONEGO (P2.5). Cache - a więc stan `$tsr` dokumentu - niesie
// menu w kształcie przesyłki; nagłówek dostaje przez `select` pełne wiersze.
// Kontrakt jest zerojedynkowy: ten sam znacznik z przesyłki co z pełnego wiersza
// (inaczej hydratacja nagłówka rozjedzie się z HTML-em starszego izolatu albo
// z podglądem w edytorze), a w samym cache nie ma pól, które projekcja zdejmuje.
describe("projekcja przesyłki menu (P2.5)", () => {
  const MEGA: MegaConfig = {
    ...DEFAULT_MEGA_CONFIG,
    columns_per_row: 2,
    columns: [
      {
        title_pl: "Bezpieczeństwo",
        title_en: "Security",
        href: "/bezpieczenstwo",
        links: [{ label_pl: "NATO", label_en: "NATO", href: "/nato", icon: "shield" }],
      },
    ],
  };

  function richMenu(): MenuItemRow[] {
    return [
      item({ id: "a", label_pl: "Kontakt", label_en: "Contact", href: "/kontakt", position: 3 }),
      item({ id: "b", label_pl: "O nas", href: "/o-nas", icon: "info", css_class: "nav-wide" }),
      item({ id: "b1", parent_id: "b", label_pl: "Zespół", href: "/zespol", ref_id: "r-1" }),
      item({ id: "b2", parent_id: "b", label_pl: "Kariera", href: "/kariera", position: 1 }),
      item({
        id: "c",
        label_pl: "Analizy",
        href: "/analizy",
        mega_enabled: true,
        mega_config: MEGA,
      }),
      item({ id: "d", label_pl: "Komisja", href: "https://ec.europa.eu", target: "_blank" }),
      item({ id: "e", label_pl: "Zarejestruj się", href: "/rejestracja", visibility: "guest" }),
    ];
  }

  async function markup(wire: boolean, mobile: boolean): Promise<string> {
    state.wire = wire;
    setMenu(richMenu());
    const { container, unmount } = await renderMenu({ mobile });
    // `useId` liczy w obrębie procesu testu, więc drugi render ma inne
    // `aria-controls` - to szum licznika, nie różnica danych.
    const html = container.innerHTML.replace(/_r_[0-9a-z]+_/g, "_r_");
    unmount();
    return html;
  }

  it("nagłówek desktopowy i szuflada mobilna z przesyłki = znacznik z pełnego wiersza", async () => {
    for (const mobile of [false, true]) {
      const full = await markup(false, mobile);
      const wire = await markup(true, mobile);
      expect(full).toContain("Analizy");
      expect(wire).toBe(full);
    }
  });

  it("w cache nie ma `menu_id` ani domyślnego `mega_config`; konfiguracja redaktora zostaje", async () => {
    state.wire = true;
    setMenu(richMenu());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SiteMenu menuKey="main" lang="pl" />
      </QueryClientProvider>,
    );
    await screen.findByRole("navigation");

    const cached = client.getQueryData<{ items: Array<Record<string, unknown>> }>([
      "menu-with-items",
      "main",
    ]);
    expect(cached?.items).toHaveLength(7);
    const raw = JSON.stringify(cached);
    expect(raw).not.toContain("menu_id");
    // Domyślne `mega_config` znika z pozycji zagnieżdżonych; pozycje
    // najwyższego poziomu niosą konfigurację zawsze (stary `MegaPanel`).
    const nested = cached!.items.filter((row) => row.parent_id);
    expect(nested.map((row) => row.id)).toEqual(["b1", "b2"]);
    for (const row of nested) expect(row).not.toHaveProperty("mega_config");
    expect(cached!.items.find((row) => row.id === "c")?.mega_config).toEqual(MEGA);
    // `ref_id`, `position` i etykieta EN zostają - edytor menu zapisuje drzewo
    // z tego wpisu, a schemat zapisu wymaga `ref_id` i `position`.
    expect(cached!.items.find((row) => row.id === "b1")).toMatchObject({ ref_id: "r-1" });
    expect(cached!.items.find((row) => row.id === "b2")).toMatchObject({ ref_id: null });
    expect(cached!.items.find((row) => row.id === "a")).toMatchObject({
      label_en: "Contact",
      position: 3,
    });
    // Wartości domyślne (`target: "_self"`, `visibility: "all"`, puste
    // `icon`/`css_class`, `mega_enabled: false`) nie jadą - odtwarza je
    // normalizacja po stronie odbiorcy. Niedomyślne zostają.
    const a = cached!.items.find((row) => row.id === "a");
    for (const field of ["target", "visibility", "icon", "css_class", "mega_enabled"]) {
      expect(a, field).not.toHaveProperty(field);
    }
    expect(cached!.items.find((row) => row.id === "d")).toMatchObject({ target: "_blank" });
    expect(cached!.items.find((row) => row.id === "d")).not.toHaveProperty("visibility");
    expect(cached!.items.find((row) => row.id === "e")).toMatchObject({ visibility: "guest" });
    expect(cached!.items.find((row) => row.id === "e")).not.toHaveProperty("target");
    expect(cached!.items.find((row) => row.id === "b")).toMatchObject({
      icon: "info",
      css_class: "nav-wide",
    });
    expect(cached!.items.find((row) => row.id === "c")).toMatchObject({ mega_enabled: true });
  });

  it("karta sprzed wdrożenia czyta przesyłkę BEZ `select`: ta sama kolejność i działający panel mega", async () => {
    // Identyfikator server fn nie zależy od treści, więc stary kod (bez
    // `select`) dostaje przesyłkę przy refetchu. „Analizy" awansuje do mega
    // przez WNUKI (bez zgody administratora, domyślne `mega_config`).
    const nestedMenu = [
      ...richMenu(),
      item({ id: "c1", parent_id: "c", label_pl: "Raporty", href: "/raporty" }),
      item({ id: "c1a", parent_id: "c1", label_pl: "Roczne", href: "/raporty/roczne" }),
    ].map((row) =>
      row.id === "c" ? { ...row, mega_enabled: false, mega_config: DEFAULT_MEGA_CONFIG } : row,
    );
    state.wire = false;
    setMenu(nestedMenu);
    const { container: fullView, unmount } = await renderMenu();
    const full = fullView.innerHTML.replace(/_r_[0-9a-z]+_/g, "_r_");
    unmount();

    state.wire = true;
    state.noSelect = true;
    setMenu(nestedMenu);
    const { container } = await renderMenu();
    expect(container.innerHTML.replace(/_r_[0-9a-z]+_/g, "_r_")).toBe(full);
    fireEvent.click(screen.getByRole("button", { name: /Analizy/ }));
    // W panelu, nie w całym dokumencie: ukryte lustro linków dla crawlera
    // (`data-site-menu-crawl`) też niesie „Roczne".
    expect(await within(await screen.findByRole("menu")).findByText("Roczne")).toBeTruthy();
  });
});
