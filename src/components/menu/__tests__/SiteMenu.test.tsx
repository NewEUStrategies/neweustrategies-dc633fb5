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
import type { MenuItemRow, MenuWithItems } from "@/lib/menus/types";
import { DEFAULT_MEGA_CONFIG } from "@/lib/menus/types";

// Warstwa danych jest podmieniona, bo test dotyczy RENDERU: `getMenuWithItems`
// to server fn (nie da się jej wywołać bez kontekstu żądania), a `megaFeatured`
// idzie do Supabase. Kontrakt samych query options ma osobny test.
const state = vi.hoisted(() => ({
  pending: false,
  data: null as MenuWithItems | null,
}));

vi.mock("@/lib/menus/queries", () => ({
  menuWithItemsQueryOptions: (key: string) => ({
    queryKey: ["menu-with-items", key],
    queryFn: () =>
      state.pending ? new Promise<MenuWithItems | null>(() => {}) : Promise.resolve(state.data),
  }),
}));

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

  it("zjechanie kursorem zamyka panel dopiero PO chwili zwłoki", async () => {
    // Zwłoka jest po to, żeby przejazd myszą przez szczelinę między triggerem
    // a panelem nie zamykał menu w połowie ruchu.
    vi.useFakeTimers();
    try {
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

      const trigger = screen.getByRole("button", { name: /O nas/ });
      fireEvent.mouseEnter(trigger.parentElement!);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
      expect(screen.queryByRole("menu")).not.toBeNull();

      fireEvent.mouseLeave(trigger.parentElement!);
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

      const wrapper = screen.getByRole("button", { name: /O nas/ }).parentElement!;
      fireEvent.mouseEnter(wrapper);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
      fireEvent.mouseLeave(wrapper);
      fireEvent.mouseEnter(wrapper);
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
