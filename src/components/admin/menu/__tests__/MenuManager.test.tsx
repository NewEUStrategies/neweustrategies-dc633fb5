// Menedżer menu (/admin/appearance/menu) - największy plik modułu chrome
// i do 18.08.2026 na okrągłym 0%.
//
// Reguły drzewa i kolumn mega mają własne asercje w `lib/menus/__tests__/`.
// TUTAJ chodzi o coś innego: czy administrator faktycznie może tym menu
// sterować. Zapis jest DESTRUKCYJNY (delete-all + insert-all), więc każda
// pomyłka w spięciu stanu z regułami kończy się nie „brzydkim ekranem", tylko
// nawigacją całego serwisu przepisaną na to, co akurat było w pamięci karty.
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-extras";
import { realT } from "@/test/i18nReal";
import { DEFAULT_MEGA_CONFIG, type MenuItemRow, type MenuWithItems } from "@/lib/menus/types";

const server = vi.hoisted(() => ({
  menu: null as MenuWithItems | null,
  loading: false,
  save: vi.fn(async (_input: unknown) => ({ ok: true as const })),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  picker: [] as Record<string, unknown>[],
  tables: {} as Record<string, Record<string, unknown>[]>,
  single: {} as Record<string, Record<string, unknown> | null>,
}));

vi.mock("@/lib/menus/queries", () => ({
  menuWithItemsQueryOptions: (key: string) => ({
    queryKey: ["menu-with-items", key],
    queryFn: () =>
      server.loading ? new Promise<MenuWithItems | null>(() => {}) : Promise.resolve(server.menu),
  }),
}));

vi.mock("@/lib/menus/menu.functions", () => ({ saveMenu: { __serverFn: true } }));

// Podmieniamy WYŁĄCZNIE `useServerFn` - reszta modułu (m.in.
// `createIsomorphicFn`) jest używana przez warstwę i18n, więc pełna atrapa
// wywracała import słownika.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => server.save,
}));

vi.mock("sonner", () => ({
  toast: { success: server.toastSuccess, error: server.toastError },
}));

vi.mock("@/lib/menus/megaFeatured", () => ({
  megaFeaturedPostQueryOptions: (postId: string | null) => ({
    queryKey: ["mega-menu-featured-post", postId],
    queryFn: () => Promise.resolve(null),
  }),
}));

vi.mock("@/components/admin/builder/ui/molecules/LucideIconPicker", () => ({
  LucideIconPicker: ({ onChange }: { onChange: (name: string | null) => void }) => (
    <button type="button" onClick={() => onChange("star")}>
      wybierz ikonę
    </button>
  ),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        or: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: server.tables[table] ?? server.picker, error: null }),
        maybeSingle: () => Promise.resolve({ data: server.single[table] ?? null, error: null }),
      };
      return builder;
    },
  },
}));

const { MenuManager } = await import("@/components/admin/menu/MenuManager");

const t = realT("pl");

function item(over: Partial<MenuItemRow> & { id: string }): MenuItemRow {
  return {
    menu_id: "menu-1",
    parent_id: null,
    position: 0,
    item_type: "custom",
    ref_id: null,
    label_pl: `Pozycja ${over.id}`,
    label_en: "",
    href: `/${over.id}`,
    target: "_self",
    css_class: "",
    icon: "",
    mega_enabled: false,
    mega_config: DEFAULT_MEGA_CONFIG,
    ...over,
  };
}

function setMenu(items: MenuItemRow[]) {
  server.menu = { id: "menu-1", key: "main", name: "Główne", items };
}

function renderManager(): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return (
    <QueryClientProvider client={client}>
      <MenuManager menuKey="main" />
    </QueryClientProvider>
  );
}

/** Wiersz pozycji po widocznej nazwie - najbliżej tego, co widzi redaktor. */
function row(label: string): HTMLElement {
  return screen.getByText(label).closest(".relative") as HTMLElement;
}

/**
 * Wysuwana lista pickera treści. Panel dodawania pozycji (lewa kolumna) czyta
 * te same tabele i ma sekcje o tych samych nazwach, więc zapytania muszą być
 * zawężone do popovera - inaczej test klika w cudzy element.
 */
function pickerPanel(): HTMLElement {
  const panel = document.querySelector(".absolute.z-50");
  if (!panel) throw new Error("picker treści nie jest otwarty");
  return panel as HTMLElement;
}

/** Klik „Zapisz" + oddanie tury mutacji react-query (zapis jest asynchroniczny). */
async function clickSave() {
  // Nazwa przycisku zależy od języka panelu - test dwujęzyczny pyta o napis
  // w AKTUALNYM języku, a nie w polskim na sztywno.
  const label = realT(i18n.language === "en" ? "en" : "pl")("common.save");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
  });
}

/** Ładunek ostatniego zapisu. */
/**
 * Wiersz ładunku zapisu. Pola treści są celowo luźne (`unknown`) - test czyta
 * je punktowo przez `toMatchObject`, a sztywny typ zmuszałby do powtarzania
 * tu całego schematu pozycji menu.
 */
interface SavedItem {
  local_id: string;
  parent_local_id: string | null;
  label_pl: string;
  mega_config: unknown;
  [key: string]: unknown;
}

function lastPayload(): { menu_key: string; items: SavedItem[] } {
  const call = server.save.mock.calls.at(-1)?.[0] as {
    data: { menu_key: string; items: SavedItem[] };
  };
  return call.data;
}

beforeEach(() => {
  server.loading = false;
  server.menu = { id: "menu-1", key: "main", name: "Główne", items: [] };
  server.save.mockClear();
  server.save.mockImplementation(async () => ({ ok: true as const }));
  server.toastSuccess.mockClear();
  server.toastError.mockClear();
  server.picker = [];
  server.tables = {};
  server.single = {};
});

afterEach(async () => {
  cleanup();
  // Język i18next jest globalny dla procesu testowego - test, który go
  // przełącza, musi go oddać, inaczej psuje wszystkie asercje po sobie.
  if (i18n.language !== "pl") await act(async () => void (await i18n.changeLanguage("pl")));
});

describe("wczytywanie i stan pusty", () => {
  it("do czasu odpowiedzi pokazuje wskaźnik, nie puste drzewo", async () => {
    server.loading = true;
    render(renderManager());
    expect(await screen.findByText(t("common.loading"))).toBeTruthy();
  });

  it("menu bez pozycji mówi administratorowi, co zrobić", async () => {
    setMenu([]);
    render(renderManager());
    expect(await screen.findByText(t("admin.menu.emptyMenu"))).toBeTruthy();
  });
});

describe("drzewo pozycji", () => {
  it("pokazuje pozycje z adresem, typem i licznikiem poziomu", async () => {
    setMenu([
      item({ id: "a", label_pl: "Blog", label_en: "Blog", href: "/blog", item_type: "page" }),
      item({ id: "b", label_pl: "O nas", position: 1 }),
    ]);
    render(renderManager());

    expect(await screen.findByText("Blog")).toBeTruthy();
    expect(screen.getByText("/blog")).toBeTruthy();
    expect(screen.getByText(t("admin.menu.typePage"))).toBeTruthy();
    expect(screen.getByText("2 pozycji")).toBeTruthy();
  });

  it("zagnieżdżenie z bazy odtwarza się w drzewie", async () => {
    setMenu([
      item({ id: "a", label_pl: "Wiedza" }),
      item({ id: "a1", parent_id: "a", label_pl: "Analizy" }),
    ]);
    render(renderManager());
    await screen.findByText("Wiedza");
    // Dziecko renderuje się WEWNĄTRZ wiersza rodzica - to jest cała hierarchia.
    expect(within(row("Wiedza")).getByText("Analizy")).toBeTruthy();
    expect(screen.getByText("1 pozycja")).toBeTruthy();
  });

  it("pozycja bez nazwy nie renderuje pustego wiersza", async () => {
    setMenu([item({ id: "a", label_pl: "", href: "" })]);
    render(renderManager());
    expect(await screen.findByText("(bez nazwy)")).toBeTruthy();
  });

  it("SIEROTA z bazy jest widoczna i da się nią zarządzać", async () => {
    // Poprawka z 18.08.2026: wcześniej pozycja z rodzicem spoza listy znikała
    // z edytora, choć nawigacja serwisu ją pokazywała.
    setMenu([
      item({ id: "a", label_pl: "Blog" }),
      item({ id: "x", parent_id: "duch", label_pl: "Sierota" }),
    ]);
    render(renderManager());
    expect(await screen.findByText("Sierota")).toBeTruthy();
  });
});

describe("edycja pozycji", () => {
  async function openEditor(label: string) {
    render(renderManager());
    await screen.findByText(label);
    fireEvent.click(within(row(label)).getByRole("button", { name: "Rozwiń" }));
  }

  it("rozwinięcie otwiera formularz pozycji, zwinięcie go chowa", async () => {
    setMenu([item({ id: "a", label_pl: "Blog" })]);
    await openEditor("Blog");
    expect(screen.getByDisplayValue("Blog")).toBeTruthy();

    fireEvent.click(within(row("Blog")).getByRole("button", { name: "Zwiń" }));
    expect(screen.queryByDisplayValue("Blog")).toBeNull();
  });

  it("zmiana etykiety trafia do ZAPISU, nie tylko na ekran", async () => {
    setMenu([item({ id: "a", label_pl: "Blog" })]);
    await openEditor("Blog");
    fireEvent.change(screen.getByDisplayValue("Blog"), { target: { value: "Analizy" } });
    await clickSave();

    expect(lastPayload().items[0]).toMatchObject({ label_pl: "Analizy" });
  });

  it("zmiana adresu i klasy CSS też trafia do zapisu", async () => {
    setMenu([item({ id: "a", label_pl: "Blog", href: "/blog" })]);
    await openEditor("Blog");
    fireEvent.change(screen.getByDisplayValue("/blog"), { target: { value: "/analizy" } });
    await clickSave();

    expect(lastPayload().items[0]).toMatchObject({ href: "/analizy" });
  });

  it("wybór ikony zapisuje się przy pozycji", async () => {
    setMenu([item({ id: "a", label_pl: "Blog" })]);
    await openEditor("Blog");
    // Wybór ikony siedzi w opakowaniu `<label>`, więc nazwa dostępna przycisku
    // pochodzi z etykiety pola - szukamy po widocznym tekście.
    fireEvent.click(screen.getByText("wybierz ikonę"));
    await clickSave();

    expect(lastPayload().items[0]).toMatchObject({ icon: "star" });
  });

  it("usunięcie pozycji zabiera CAŁE poddrzewo", async () => {
    // Zostawienie dzieci osieroconych byłoby gorsze: publiczne menu pokazałoby
    // je na najwyższym poziomie, bez kontekstu.
    setMenu([
      item({ id: "a", label_pl: "Wiedza" }),
      item({ id: "a1", parent_id: "a", label_pl: "Analizy" }),
      item({ id: "b", label_pl: "Kontakt", position: 1 }),
    ]);
    render(renderManager());
    await screen.findByText("Wiedza");

    fireEvent.click(within(row("Wiedza")).getAllByRole("button", { name: t("common.delete") })[0]);
    expect(screen.queryByText("Wiedza")).toBeNull();
    expect(screen.queryByText("Analizy")).toBeNull();
    expect(screen.getByText("Kontakt")).toBeTruthy();
  });
});

describe("hierarchia z klawiatury (wcięcia)", () => {
  it("PIERWSZA pozycja rzędu nie ma się pod co podpiąć - przycisk zablokowany", async () => {
    setMenu([
      item({ id: "a", label_pl: "Blog" }),
      item({ id: "b", label_pl: "O nas", position: 1 }),
    ]);
    render(renderManager());
    await screen.findByText("Blog");

    expect(
      within(row("Blog")).getByRole("button", { name: t("admin.menu.indent") }),
    ).toBeDisabled();
    expect(
      within(row("O nas")).getByRole("button", { name: t("admin.menu.indent") }),
    ).toBeEnabled();
  });

  it("pozycja najwyższego poziomu nie ma dokąd wyjść w lewo", async () => {
    setMenu([item({ id: "a", label_pl: "Blog" })]);
    render(renderManager());
    await screen.findByText("Blog");
    expect(
      within(row("Blog")).getByRole("button", { name: t("admin.menu.outdent") }),
    ).toBeDisabled();
  });

  it("wcięcie w prawo robi z pozycji dziecko poprzedniej i ROZWIJA rodzica", async () => {
    setMenu([
      item({ id: "a", label_pl: "Blog" }),
      item({ id: "b", label_pl: "O nas", position: 1 }),
    ]);
    render(renderManager());
    await screen.findByText("Blog");

    fireEvent.click(within(row("O nas")).getByRole("button", { name: t("admin.menu.indent") }));
    expect(within(row("Blog")).getByText("O nas")).toBeTruthy();
    // Rozwinięcie jest częścią operacji - inaczej pozycja „znika" pod zwiniętym rodzicem.
    expect(screen.getByDisplayValue("Blog")).toBeTruthy();
  });

  it("cofnięcie w lewo wyprowadza pozycję na poziom rodzica", async () => {
    setMenu([
      item({ id: "a", label_pl: "Wiedza" }),
      item({ id: "a1", parent_id: "a", label_pl: "Analizy" }),
    ]);
    render(renderManager());
    await screen.findByText("Wiedza");

    fireEvent.click(within(row("Analizy")).getByRole("button", { name: t("admin.menu.outdent") }));
    await clickSave();
    expect(lastPayload().items.find((i) => i.local_id)?.parent_local_id).toBeNull();
    expect(lastPayload().items.every((i) => i.parent_local_id === null)).toBe(true);
  });
});

describe("zapis menu", () => {
  it("wysyła KLUCZ menu i komplet pozycji z hierarchią", async () => {
    setMenu([
      item({ id: "a", label_pl: "Wiedza" }),
      item({ id: "a1", parent_id: "a", label_pl: "Analizy" }),
    ]);
    render(renderManager());
    await screen.findByText("Wiedza");
    await clickSave();

    const payload = lastPayload();
    expect(payload.menu_key).toBe("main");
    expect(payload.items).toHaveLength(2);
    const parent = payload.items.find((i) => i.parent_local_id === null)!;
    expect(payload.items.some((i) => i.parent_local_id === parent.local_id)).toBe(true);
  });

  it("pozycja bez nazwy dostaje adres, a bez adresu - etykietę ZE SŁOWNIKA", async () => {
    // Ta wartość ląduje w bazie i pokaże się CZYTELNIKOWI w nawigacji.
    setMenu([
      item({ id: "a", label_pl: "", href: "/analizy" }),
      item({ id: "b", label_pl: "", href: "", position: 1 }),
    ]);
    render(renderManager());
    await screen.findAllByText("(bez nazwy)");
    await clickSave();

    const labels = lastPayload().items.map((i) => i.label_pl);
    expect(labels).toContain("/analizy");
    expect(labels).toContain(t("admin.menu.untitledItem"));
  });

  it("ANGIELSKI PANEL nie wpisuje angielskiej etykiety do polskiej kolumny", async () => {
    // Regresja: etykieta zastępcza brana z aktywnego języka panelu lądowała
    // w `label_pl`, więc administrator pracujący po angielsku wpisywał
    // czytelnikom polskiego menu napis „Untitled item". Język interfejsu
    // administratora nie może decydować o treści serwisu.
    await act(async () => void (await i18n.changeLanguage("en")));
    setMenu([item({ id: "a", label_pl: "", label_en: "", href: "" })]);
    render(renderManager());
    await screen.findAllByText("(bez nazwy)");
    await clickSave();

    expect(lastPayload().items[0]).toMatchObject({
      label_pl: realT("pl")("admin.menu.untitledItem"),
      label_en: realT("en")("admin.menu.untitledItem"),
    });
  });

  it("udany zapis potwierdza się komunikatem", async () => {
    setMenu([item({ id: "a", label_pl: "Blog" })]);
    render(renderManager());
    await screen.findByText("Blog");
    await clickSave();
    expect(server.toastSuccess).toHaveBeenCalledWith(t("admin.menu.saved"));
  });

  it("nieudany zapis pokazuje POWÓD, nie ogólne „coś poszło nie tak”", async () => {
    server.save.mockRejectedValueOnce(new Error("Forbidden: staff role required"));
    setMenu([item({ id: "a", label_pl: "Blog" })]);
    render(renderManager());
    await screen.findByText("Blog");
    await clickSave();
    await vi.waitFor(() =>
      expect(server.toastError).toHaveBeenCalledWith(
        expect.stringContaining("Forbidden: staff role required"),
      ),
    );
  });
});

describe("mega panel w edytorze", () => {
  async function openMega() {
    setMenu([
      item({ id: "a", label_pl: "Wiedza", mega_enabled: true }),
      item({ id: "a1", parent_id: "a", label_pl: "Analizy", href: "/analizy" }),
      item({ id: "x", parent_id: "a1", label_pl: "Raporty", href: "/raporty" }),
    ]);
    render(renderManager());
    await screen.findByText("Wiedza");
    fireEvent.click(within(row("Wiedza")).getAllByRole("button", { name: "Rozwiń" })[0]);
  }

  it("pozycja z mega panelem jest oznaczona w drzewie", async () => {
    setMenu([item({ id: "a", label_pl: "Wiedza", mega_enabled: true })]);
    render(renderManager());
    expect(await screen.findByText("Mega")).toBeTruthy();
  });

  it("edytor kolumn otwiera się dopiero dla pozycji z włączonym mega", async () => {
    await openMega();
    expect(screen.getByText(t("admin.menu.megaColumns"))).toBeTruthy();
  });

  it("import z drzewa przepisuje dzieci na kolumny, a wnuki na linki", async () => {
    await openMega();
    fireEvent.click(screen.getByRole("button", { name: t("admin.menu.importFromTree") }));

    await clickSave();
    const saved = lastPayload().items.find((i) => i.label_pl === "Wiedza") as unknown as {
      mega_config: { columns: { title_pl: string; links: unknown[] }[] };
    };
    expect(saved.mega_config.columns).toHaveLength(1);
    expect(saved.mega_config.columns[0]).toMatchObject({ title_pl: "Analizy" });
    expect(saved.mega_config.columns[0].links).toHaveLength(1);
  });

  it("dodanie pustej kolumny zwiększa układ o jedną pozycję", async () => {
    await openMega();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("admin.menu.addColumn")) }));
    await clickSave();

    const saved = lastPayload().items.find((i) => i.label_pl === "Wiedza") as unknown as {
      mega_config: { columns: unknown[] };
    };
    expect(saved.mega_config.columns).toHaveLength(1);
  });

  it("bez ręcznych kolumn edytor mówi, że układ powstaje z drzewa", async () => {
    await openMega();
    expect(screen.getByText(t("admin.menu.autoDerivedHint"))).toBeTruthy();
  });

  it("wyłączenie mega chowa edytor kolumn", async () => {
    await openMega();
    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);
    expect(screen.queryByText(t("admin.menu.megaColumns"))).toBeNull();
  });
});

describe("panel dodawania pozycji", () => {
  it("własny odnośnik wymaga adresu I nazwy, zanim da się go dodać", async () => {
    setMenu([]);
    render(renderManager());
    await screen.findByText(t("admin.menu.emptyMenu"));

    fireEvent.click(screen.getByRole("button", { name: t("admin.menu.sections.custom") }));
    const addButtons = screen.getAllByRole("button", {
      name: new RegExp(t("admin.menu.addToMenu")),
    });
    const customAdd = addButtons.at(-1)!;
    expect(customAdd).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("https://... lub /sciezka"), {
      target: { value: "/kontakt" },
    });
    expect(customAdd).toBeDisabled(); // sam adres nie wystarczy

    const labelInputs = screen.getAllByRole("textbox");
    fireEvent.change(labelInputs[labelInputs.length - 2], { target: { value: "Kontakt" } });
    expect(customAdd).toBeEnabled();
  });

  it("dodany odnośnik ląduje w drzewie i w zapisie", async () => {
    setMenu([]);
    render(renderManager());
    await screen.findByText(t("admin.menu.emptyMenu"));

    fireEvent.click(screen.getByRole("button", { name: t("admin.menu.sections.custom") }));
    fireEvent.change(screen.getByPlaceholderText("https://... lub /sciezka"), {
      target: { value: "/kontakt" },
    });
    const labelInputs = screen.getAllByRole("textbox");
    fireEvent.change(labelInputs[labelInputs.length - 2], { target: { value: "Kontakt" } });
    fireEvent.click(
      screen.getAllByRole("button", { name: new RegExp(t("admin.menu.addToMenu")) }).at(-1)!,
    );

    expect(screen.getByText("Kontakt")).toBeTruthy();
    await clickSave();
    expect(lastPayload().items[0]).toMatchObject({
      item_type: "custom",
      href: "/kontakt",
      label_pl: "Kontakt",
    });
  });

  it("lista treści bez wyników mówi to wprost", async () => {
    server.picker = [];
    setMenu([]);
    render(renderManager());
    expect((await screen.findAllByText(t("admin.menu.empty"))).length).toBeGreaterThan(0);
  });

  it("zaznaczone treści dodają się hurtem, z etykietami w obu językach", async () => {
    server.picker = [
      { id: "p1", slug: "raport", title_pl: "Raport", title_en: "Report" },
      { id: "p2", slug: "analiza", title_pl: "Analiza", title_en: "Analysis" },
    ];
    setMenu([]);
    render(renderManager());
    await screen.findByText(t("admin.menu.emptyMenu"));

    const checkboxes = await screen.findAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getAllByRole("button", { name: /2/ }).at(-1)!);

    await clickSave();
    const items = lastPayload().items as unknown as {
      label_pl: string;
      label_en: string;
      href: string;
    }[];
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ label_pl: "Raport", label_en: "Report", href: "/raport" });
  });
});

describe("podgląd mega panelu w adminie", () => {
  async function openMegaEditor(
    items = [
      item({ id: "a", label_pl: "Wiedza", label_en: "Knowledge", mega_enabled: true }),
      item({
        id: "a1",
        parent_id: "a",
        label_pl: "Analizy",
        label_en: "Analyses",
        href: "/analizy",
      }),
    ],
  ) {
    setMenu(items);
    render(renderManager());
    await screen.findByText("Wiedza");
    fireEvent.click(within(row("Wiedza")).getAllByRole("button", { name: "Rozwiń" })[0]);
  }

  it("podgląd pokazuje UKŁAD Z DRZEWA, gdy kolumn nie ustawiono ręcznie", async () => {
    // Front robi dokładnie to samo (`megaColumnsFor`), więc podgląd musi
    // pokazywać to, co zobaczy czytelnik - inaczej redaktor układa na ślepo.
    await openMegaEditor();
    const preview = screen.getByLabelText(t("admin.menu.previewAria"));
    expect(within(preview).getByText("Analizy")).toBeTruthy();
    expect(screen.getByText(t("admin.menu.autoFromTree"))).toBeTruthy();
  });

  it("przełącznik języka podglądu zmienia treść na angielską", async () => {
    await openMegaEditor();
    fireEvent.click(screen.getByRole("button", { name: "en" }));
    const preview = screen.getByLabelText(t("admin.menu.previewAria"));
    expect(within(preview).getByText("Analyses")).toBeTruthy();
  });

  it("mega bez kolumn i bez dzieci mówi, czego brakuje", async () => {
    await openMegaEditor([item({ id: "a", label_pl: "Wiedza", mega_enabled: true })]);
    expect(screen.getByText(t("admin.menu.previewEmpty"))).toBeTruthy();
  });

  it("ręczne kolumny wygrywają z układem z drzewa - i tak jest w podglądzie", async () => {
    await openMegaEditor();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("admin.menu.addColumn")) }));
    fireEvent.change(screen.getByPlaceholderText("Tytuł PL"), { target: { value: "Ręczna" } });

    const preview = screen.getByLabelText(t("admin.menu.previewAria"));
    expect(within(preview).getByText("Ręczna")).toBeTruthy();
    expect(within(preview).queryByText("Analizy")).toBeNull();
    expect(screen.queryByText(t("admin.menu.autoFromTree"))).toBeNull();
  });
});

describe("edytor kolumn mega panelu", () => {
  async function openWithColumn() {
    setMenu([item({ id: "a", label_pl: "Wiedza", mega_enabled: true })]);
    render(renderManager());
    await screen.findByText("Wiedza");
    fireEvent.click(within(row("Wiedza")).getAllByRole("button", { name: "Rozwiń" })[0]);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("admin.menu.addColumn")) }));
  }

  it("tytuły i adres kolumny trafiają do zapisu", async () => {
    await openWithColumn();
    fireEvent.change(screen.getByPlaceholderText("Tytuł PL"), { target: { value: "Analizy" } });
    fireEvent.change(screen.getByPlaceholderText("Tytuł EN"), { target: { value: "Analyses" } });
    fireEvent.change(screen.getByPlaceholderText("href kolumny (opcjonalnie)"), {
      target: { value: "/analizy" },
    });
    await clickSave();

    const saved = lastPayload().items[0] as unknown as {
      mega_config: { columns: { title_pl: string; title_en: string; href: string }[] };
    };
    expect(saved.mega_config.columns[0]).toMatchObject({
      title_pl: "Analizy",
      title_en: "Analyses",
      href: "/analizy",
    });
  });

  it("własny link w kolumnie: dodanie, opis i adres", async () => {
    await openWithColumn();
    fireEvent.click(screen.getByRole("button", { name: /Własny link/ }));
    fireEvent.change(screen.getByPlaceholderText("Etykieta PL"), { target: { value: "Raporty" } });
    fireEvent.change(screen.getByPlaceholderText("EN"), { target: { value: "Reports" } });
    fireEvent.change(screen.getByPlaceholderText("href"), { target: { value: "/raporty" } });
    await clickSave();

    const saved = lastPayload().items[0] as unknown as {
      mega_config: { columns: { links: { label_pl: string; label_en: string; href: string }[] }[] };
    };
    expect(saved.mega_config.columns[0].links[0]).toMatchObject({
      label_pl: "Raporty",
      label_en: "Reports",
      href: "/raporty",
    });
  });

  /** Kosze WEWNĄTRZ edytora kolumn - poza nim jest jeszcze kosz całej pozycji. */
  function megaBins(): HTMLElement[] {
    const editor = screen
      .getByText(t("admin.menu.megaColumns"))
      .closest("div.bg-background") as HTMLElement;
    return within(editor)
      .getAllByRole("button")
      .filter((b) => b.className.includes("text-destructive"));
  }

  it("usunięcie linku i usunięcie kolumny czyszczą układ", async () => {
    await openWithColumn();
    fireEvent.click(screen.getByRole("button", { name: /Własny link/ }));
    // W kolumnie: pierwszy kosz kasuje kolumnę, ostatni - link.
    fireEvent.click(megaBins().at(-1)!);
    await clickSave();
    const afterLinkRemoval = lastPayload().items[0] as unknown as {
      mega_config: { columns: { links: unknown[] }[] };
    };
    expect(afterLinkRemoval.mega_config.columns[0].links).toHaveLength(0);

    fireEvent.click(megaBins()[0]);
    await clickSave();
    const afterColumnRemoval = lastPayload().items[0] as unknown as {
      mega_config: { columns: unknown[] };
    };
    expect(afterColumnRemoval.mega_config.columns).toHaveLength(0);
  });
});

describe("wyróżniony wpis mega panelu", () => {
  async function openPicker() {
    setMenu([item({ id: "a", label_pl: "Wiedza", mega_enabled: true })]);
    render(renderManager());
    await screen.findByText("Wiedza");
    fireEvent.click(within(row("Wiedza")).getAllByRole("button", { name: "Rozwiń" })[0]);
  }

  it("domyślnie tłumaczy, co zobaczy czytelnik bez wyboru", async () => {
    await openPicker();
    expect(screen.getByText(/Domyślnie: najnowszy opublikowany wpis z okładką/)).toBeTruthy();
  });

  it("wyszukiwarka bez trafień mówi to wprost", async () => {
    server.tables.posts = [];
    await openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Wybierz wpis" }));
    expect((await screen.findAllByText("Brak wyników")).length).toBeGreaterThan(0);
  });

  it("wybrany wpis ląduje w konfiguracji i pokazuje się jako wybrany", async () => {
    server.tables.posts = [
      { id: "post-1", slug: "raport", title_pl: "Raport", title_en: "Report" },
    ];
    await openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Wybierz wpis" }));
    fireEvent.click(await screen.findByText("Raport"));

    expect(screen.getByText("Zmień")).toBeTruthy();
    await clickSave();
    const saved = lastPayload().items[0] as unknown as {
      mega_config: { featured_post_id: string | null };
    };
    expect(saved.mega_config.featured_post_id).toBe("post-1");
  });

  it("wyczyszczenie wyboru wraca do zachowania domyślnego", async () => {
    server.tables.posts = [
      { id: "post-1", slug: "raport", title_pl: "Raport", title_en: "Report" },
    ];
    await openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Wybierz wpis" }));
    fireEvent.click(await screen.findByText("Raport"));
    fireEvent.click(screen.getByRole("button", { name: "Wyczyść" }));

    await clickSave();
    const saved = lastPayload().items[0] as unknown as {
      mega_config: { featured_post_id: string | null };
    };
    expect(saved.mega_config.featured_post_id).toBeNull();
  });
});

describe("powiązanie kolumny z treścią wewnętrzną", () => {
  async function openColumnPicker() {
    setMenu([item({ id: "a", label_pl: "Wiedza", mega_enabled: true })]);
    render(renderManager());
    await screen.findByText("Wiedza");
    fireEvent.click(within(row("Wiedza")).getAllByRole("button", { name: "Rozwiń" })[0]);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("admin.menu.addColumn")) }));
    fireEvent.click(screen.getByRole("button", { name: "Powiąż nagłówek kolumny z treścią" }));
  }

  it("wybór strony wypełnia tytuł i adres kolumny", async () => {
    server.tables.pages = [{ id: "pg1", slug: "o-nas", title_pl: "O nas", title_en: "About" }];
    await openColumnPicker();
    fireEvent.click(await within(pickerPanel()).findByText("O nas"));

    await clickSave();
    const saved = lastPayload().items[0] as unknown as {
      mega_config: { columns: { title_pl: string; href: string }[] };
    };
    expect(saved.mega_config.columns[0]).toMatchObject({ title_pl: "O nas", href: "/o-nas" });
  });

  it("przełączenie źródła zmienia adres wynikowy (kategoria zamiast strony)", async () => {
    server.tables.categories = [
      { id: "c1", slug: "gospodarka", name_pl: "Gospodarka", name_en: "Economy" },
    ];
    await openColumnPicker();
    fireEvent.click(within(pickerPanel()).getByRole("button", { name: "Kategorie" }));
    fireEvent.click(await within(pickerPanel()).findByText("Gospodarka"));

    await clickSave();
    const saved = lastPayload().items[0] as unknown as {
      mega_config: { columns: { href: string }[] };
    };
    expect(saved.mega_config.columns[0].href).toBe("/category/gospodarka");
  });

  it("link z treści wewnętrznej dokłada pozycję do kolumny", async () => {
    server.tables.posts = [{ id: "p1", slug: "raport", title_pl: "Raport", title_en: "Report" }];
    setMenu([item({ id: "a", label_pl: "Wiedza", mega_enabled: true })]);
    render(renderManager());
    await screen.findByText("Wiedza");
    fireEvent.click(within(row("Wiedza")).getAllByRole("button", { name: "Rozwiń" })[0]);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("admin.menu.addColumn")) }));
    fireEvent.click(screen.getByRole("button", { name: /Z treści/ }));
    fireEvent.click(within(pickerPanel()).getByRole("button", { name: "Wpisy" }));
    fireEvent.click(await within(pickerPanel()).findByText("Raport"));

    await clickSave();
    const saved = lastPayload().items[0] as unknown as {
      mega_config: { columns: { links: { label_pl: string; href: string }[] }[] };
    };
    expect(saved.mega_config.columns[0].links[0]).toMatchObject({
      label_pl: "Raport",
      href: "/post/raport",
    });
  });

  it("brak trafień w pickerze treści mówi to wprost", async () => {
    server.tables.pages = [];
    await openColumnPicker();
    expect(await within(pickerPanel()).findByText("Brak wyników")).toBeTruthy();
  });
});

describe("przeciąganie pozycji", () => {
  /** Atrapa schowka przeciągania - zapamiętuje to, co ustawił `onDragStart`. */
  function dataTransfer() {
    const store = new Map<string, string>();
    return {
      types: ["application/x-menu-item"],
      effectAllowed: "",
      setData: (key: string, value: string) => store.set(key, value),
      getData: (key: string) => store.get(key) ?? "",
    };
  }

  it("upuszczenie na inną pozycję robi z niej rodzica", async () => {
    // happy-dom nie liczy układu, więc kursor wypada w ŚRODKU wiersza -
    // czyli w strefie zagnieżdżenia (patrz `dropZoneForOffset`).
    setMenu([
      item({ id: "a", label_pl: "Wiedza" }),
      item({ id: "b", label_pl: "Analizy", position: 1 }),
    ]);
    render(renderManager());
    await screen.findByText("Wiedza");

    const dt = dataTransfer();
    const dragged = row("Analizy").querySelector("[draggable]") as HTMLElement;
    const target = row("Wiedza").querySelector("[draggable]") as HTMLElement;
    fireEvent.dragStart(dragged, { dataTransfer: dt });
    fireEvent.dragOver(target, { dataTransfer: dt, clientY: 5 });
    fireEvent.drop(target, { dataTransfer: dt });

    expect(within(row("Wiedza")).getByText("Analizy")).toBeTruthy();
  });

  it("upuszczenie na TŁO listy wyprowadza pozycję na najwyższy poziom", async () => {
    setMenu([
      item({ id: "a", label_pl: "Wiedza" }),
      item({ id: "a1", parent_id: "a", label_pl: "Analizy" }),
    ]);
    render(renderManager());
    await screen.findByText("Wiedza");

    const dt = dataTransfer();
    const dragged = row("Analizy").querySelector("[draggable]") as HTMLElement;
    fireEvent.dragStart(dragged, { dataTransfer: dt });
    const canvas = screen
      .getByText(t("admin.menu.dragHint"))
      .closest("section")!
      .querySelector(".min-h-\\[200px\\]") as HTMLElement;
    fireEvent.dragOver(canvas, { dataTransfer: dt });
    fireEvent.drop(canvas, { dataTransfer: dt });

    await clickSave();
    expect(lastPayload().items.every((i) => i.parent_local_id === null)).toBe(true);
  });

  it("upuszczenie pozycji NA SIEBIE nic nie zmienia", async () => {
    setMenu([
      item({ id: "a", label_pl: "Wiedza" }),
      item({ id: "b", label_pl: "Analizy", position: 1 }),
    ]);
    render(renderManager());
    await screen.findByText("Wiedza");

    const dt = dataTransfer();
    const self = row("Analizy").querySelector("[draggable]") as HTMLElement;
    fireEvent.dragStart(self, { dataTransfer: dt });
    fireEvent.dragOver(self, { dataTransfer: dt });
    fireEvent.drop(self, { dataTransfer: dt });

    await clickSave();
    expect(lastPayload().items.every((i) => i.parent_local_id === null)).toBe(true);
  });

  it("przeciąganie CZEGOŚ INNEGO niż pozycja menu jest ignorowane", async () => {
    // Do drzewa da się upuścić plik albo zaznaczony tekst - wtedy `onDragOver`
    // nie może w ogóle zgłosić strefy upuszczenia.
    setMenu([item({ id: "a", label_pl: "Wiedza" })]);
    render(renderManager());
    await screen.findByText("Wiedza");

    const target = row("Wiedza").querySelector("[draggable]") as HTMLElement;
    const foreign = { types: ["text/plain"], setData: () => {}, getData: () => "" };
    fireEvent.dragOver(target, { dataTransfer: foreign });
    expect(target.className).not.toContain("ring-brand");
  });

  it("opuszczenie wiersza kursorem gasi podświetlenie strefy", async () => {
    setMenu([item({ id: "a", label_pl: "Wiedza" })]);
    render(renderManager());
    await screen.findByText("Wiedza");

    const dt = dataTransfer();
    const target = row("Wiedza").querySelector("[draggable]") as HTMLElement;
    fireEvent.dragStart(target, { dataTransfer: dt });
    fireEvent.dragOver(target, { dataTransfer: dt });
    expect(target.className).toContain("ring-2");
    fireEvent.dragLeave(target);
    expect(target.className).not.toContain("ring-2");
  });
});

describe("stan zapisu", () => {
  it("w trakcie zapisu przycisk jest zablokowany", async () => {
    let release: () => void = () => {};
    server.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true as const });
        }),
    );
    setMenu([item({ id: "a", label_pl: "Blog" })]);
    render(renderManager());
    await screen.findByText("Blog");

    await clickSave();
    const button = screen.getByRole("button", { name: new RegExp(t("common.save")) });
    expect(button).toBeDisabled();

    await act(async () => {
      release();
    });
    await vi.waitFor(() => expect(button).toBeEnabled());
  });
});

describe("wyróżniony wpis wczytany z konfiguracji", () => {
  it("pokazuje TYTUŁ zapisanego wpisu, nie jego identyfikator", async () => {
    server.single.posts = {
      id: "post-1",
      slug: "raport",
      title_pl: "Raport roczny",
      title_en: "Annual report",
      excerpt_pl: null,
      excerpt_en: null,
      cover_image_url: null,
      published_at: null,
      post_format: null,
      author_id: "u1",
    };
    server.single.profiles = { display_name: "Anna Nowak", slug: "anna-nowak", avatar_url: null };
    setMenu([
      item({
        id: "a",
        label_pl: "Wiedza",
        mega_enabled: true,
        mega_config: { ...DEFAULT_MEGA_CONFIG, featured_post_id: "post-1" },
      }),
    ]);
    render(renderManager());
    await screen.findByText("Wiedza");
    fireEvent.click(within(row("Wiedza")).getAllByRole("button", { name: "Rozwiń" })[0]);

    expect(await screen.findByText("Raport roczny")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zmień" })).toBeTruthy();
  });

  it("wpis bez autora też się wczytuje", async () => {
    server.single.posts = {
      id: "post-1",
      slug: "raport",
      title_pl: "Raport roczny",
      title_en: null,
      excerpt_pl: null,
      excerpt_en: null,
      cover_image_url: null,
      published_at: null,
      post_format: null,
      author_id: null,
    };
    setMenu([
      item({
        id: "a",
        label_pl: "Wiedza",
        mega_enabled: true,
        mega_config: { ...DEFAULT_MEGA_CONFIG, featured_post_id: "post-1" },
      }),
    ]);
    render(renderManager());
    await screen.findByText("Wiedza");
    fireEvent.click(within(row("Wiedza")).getAllByRole("button", { name: "Rozwiń" })[0]);
    expect(await screen.findByText("Raport roczny")).toBeTruthy();
  });

  it("skasowany wpis nie zostawia pustego miejsca - wchodzi identyfikator", async () => {
    server.single.posts = null;
    setMenu([
      item({
        id: "a",
        label_pl: "Wiedza",
        mega_enabled: true,
        mega_config: { ...DEFAULT_MEGA_CONFIG, featured_post_id: "post-znikniety" },
      }),
    ]);
    render(renderManager());
    await screen.findByText("Wiedza");
    fireEvent.click(within(row("Wiedza")).getAllByRole("button", { name: "Rozwiń" })[0]);
    expect(await screen.findByText("post-znikniety")).toBeTruthy();
  });
});

describe("picker treści - pozostałe źródła", () => {
  it("tagi dają adres tagowy", async () => {
    server.tables.tags = [{ id: "t1", slug: "nato", name: "NATO" }];
    setMenu([item({ id: "a", label_pl: "Wiedza", mega_enabled: true })]);
    render(renderManager());
    await screen.findByText("Wiedza");
    fireEvent.click(within(row("Wiedza")).getAllByRole("button", { name: "Rozwiń" })[0]);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("admin.menu.addColumn")) }));
    fireEvent.click(screen.getByRole("button", { name: "Powiąż nagłówek kolumny z treścią" }));
    fireEvent.click(within(pickerPanel()).getByRole("button", { name: "Tagi" }));
    fireEvent.click(await within(pickerPanel()).findByText("NATO"));

    await clickSave();
    const saved = lastPayload().items[0] as unknown as {
      mega_config: { columns: { href: string }[] };
    };
    expect(saved.mega_config.columns[0].href).toBe("/tag/nato");
  });

  it("szukanie zawęża listę dopiero od dwóch znaków", async () => {
    server.tables.pages = [{ id: "pg1", slug: "o-nas", title_pl: "O nas", title_en: "About" }];
    setMenu([item({ id: "a", label_pl: "Wiedza", mega_enabled: true })]);
    render(renderManager());
    await screen.findByText("Wiedza");
    fireEvent.click(within(row("Wiedza")).getAllByRole("button", { name: "Rozwiń" })[0]);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("admin.menu.addColumn")) }));
    fireEvent.click(screen.getByRole("button", { name: "Powiąż nagłówek kolumny z treścią" }));

    fireEvent.change(within(pickerPanel()).getByPlaceholderText("Szukaj..."), {
      target: { value: "on" },
    });
    expect(await within(pickerPanel()).findByText("O nas")).toBeTruthy();
  });
});

describe("panel dodawania - wszystkie źródła treści", () => {
  async function openSection(name: string) {
    setMenu([]);
    render(renderManager());
    await screen.findByText(t("admin.menu.emptyMenu"));
    fireEvent.click(screen.getByRole("button", { name }));
  }

  it("wpisy dodają się z adresem wpisu", async () => {
    server.tables.posts = [{ id: "p1", slug: "raport", title_pl: "Raport", title_en: "Report" }];
    await openSection(t("admin.menu.sections.posts"));
    fireEvent.click((await screen.findAllByRole("checkbox"))[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /1/ }).at(-1)!);

    await clickSave();
    expect(lastPayload().items[0]).toMatchObject({ item_type: "post", href: "/post/raport" });
  });

  it("kategorie dodają się z adresem kategorii i nazwą dwujęzyczną", async () => {
    server.tables.categories = [
      { id: "c1", slug: "gospodarka", name_pl: "Gospodarka", name_en: "Economy" },
    ];
    await openSection(t("admin.menu.sections.categories"));
    fireEvent.click((await screen.findAllByRole("checkbox"))[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /1/ }).at(-1)!);

    await clickSave();
    expect(lastPayload().items[0]).toMatchObject({
      item_type: "category",
      href: "/category/gospodarka",
      label_pl: "Gospodarka",
      label_en: "Economy",
    });
  });

  it("tagi dodają się z adresem tagu", async () => {
    server.tables.tags = [{ id: "t1", slug: "nato", name: "NATO" }];
    await openSection(t("admin.menu.sections.tags"));
    fireEvent.click((await screen.findAllByRole("checkbox"))[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /1/ }).at(-1)!);

    await clickSave();
    expect(lastPayload().items[0]).toMatchObject({ item_type: "tag", href: "/tag/nato" });
  });

  it("odznaczenie pozycji cofa ją z wyboru", async () => {
    server.tables.pages = [{ id: "pg1", slug: "o-nas", title_pl: "O nas", title_en: "About" }];
    setMenu([]);
    render(renderManager());
    await screen.findByText(t("admin.menu.emptyMenu"));

    const box = (await screen.findAllByRole("checkbox"))[0];
    fireEvent.click(box);
    expect(screen.getAllByRole("button", { name: /1/ }).at(-1)!).toBeEnabled();
    fireEvent.click(box);
    // Licznik wraca na zero, a przycisk się blokuje - inaczej dałoby się
    // „dodać" pusty wybór.
    expect(screen.getAllByRole("button", { name: /0/ }).at(-1)!).toBeDisabled();
  });

  it("wyszukiwarka w sekcji zawęża listę", async () => {
    server.tables.pages = [{ id: "pg1", slug: "o-nas", title_pl: "O nas", title_en: "About" }];
    setMenu([]);
    render(renderManager());
    await screen.findByText(t("admin.menu.emptyMenu"));

    fireEvent.change(screen.getByPlaceholderText(t("admin.menu.searchPlaceholder")), {
      target: { value: "on" },
    });
    expect(await screen.findByText("O nas")).toBeTruthy();
  });

  it("treść bez tytułu identyfikuje się adresem", async () => {
    // Wpis w trakcie redakcji może nie mieć jeszcze tytułu w żadnym języku -
    // pozycja menu i tak musi dać się rozpoznać.
    server.tables.pages = [{ id: "pg1", slug: "bez-tytulu", title_pl: "", title_en: "" }];
    setMenu([]);
    render(renderManager());
    await screen.findByText(t("admin.menu.emptyMenu"));
    expect(await screen.findByText("/bez-tytulu")).toBeTruthy();
  });

  it("formularz własnego odnośnika czyści się po dodaniu", async () => {
    setMenu([]);
    render(renderManager());
    await screen.findByText(t("admin.menu.emptyMenu"));
    fireEvent.click(screen.getByRole("button", { name: t("admin.menu.sections.custom") }));

    const url = screen.getByPlaceholderText("https://... lub /sciezka");
    fireEvent.change(url, { target: { value: "/kontakt" } });
    const labels = screen.getAllByRole("textbox");
    fireEvent.change(labels[labels.length - 2], { target: { value: "Kontakt" } });
    fireEvent.click(
      screen.getAllByRole("button", { name: new RegExp(t("admin.menu.addToMenu")) }).at(-1)!,
    );

    expect((url as HTMLInputElement).value).toBe("");
  });
});

describe("listy wyboru w edytorze", () => {
  /** Radix Select otwiera się z klawiatury; opcje renderują się w portalu. */
  function chooseOption(comboboxName: string | RegExp, optionName: string) {
    fireEvent.keyDown(screen.getByRole("combobox", { name: comboboxName }), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: optionName }));
  }

  it("otwieranie w nowej karcie zapisuje się przy pozycji", async () => {
    setMenu([item({ id: "a", label_pl: "Komisja", href: "https://ec.europa.eu" })]);
    render(renderManager());
    await screen.findByText("Komisja");
    fireEvent.click(within(row("Komisja")).getByRole("button", { name: "Rozwiń" }));

    chooseOption(new RegExp(t("admin.menu.target")), t("admin.menu.targetBlank"));
    await clickSave();
    expect(lastPayload().items[0]).toMatchObject({ target: "_blank" });
  });

  it("liczba kolumn w rzędzie i szerokość panelu trafiają do konfiguracji", async () => {
    setMenu([item({ id: "a", label_pl: "Wiedza", mega_enabled: true })]);
    render(renderManager());
    await screen.findByText("Wiedza");
    fireEvent.click(within(row("Wiedza")).getAllByRole("button", { name: "Rozwiń" })[0]);

    fireEvent.keyDown(screen.getAllByRole("combobox")[1], { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "2" }));
    fireEvent.keyDown(screen.getAllByRole("combobox")[2], { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Pełna szerokość" }));

    await clickSave();
    const saved = lastPayload().items[0] as unknown as {
      mega_config: { columns_per_row: number; width: string };
    };
    expect(saved.mega_config).toMatchObject({ columns_per_row: 2, width: "full" });
  });
});
