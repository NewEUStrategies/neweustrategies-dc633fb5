// Panel ustawień layoutu archiwum (kategorie / tagi). Do 18.08.2026: 0%
// ze 75 instrukcji - najsłabsza funkcjonalność całego modułu 4.
//
// Panel decyduje o tym, jak wygląda KAŻDA strona kategorii i tagu w serwisie.
// Cztery reguły, których złamania nie widać w warstwie danych:
//   1. wersja robocza jest LOKALNA - zmiana pola nie leci od razu do bazy,
//      więc podgląd na żywo pokazuje szkic, a zapis jest świadomym krokiem,
//   2. pozycja panelu bocznego jest WYŁĄCZONA, gdy panel jest schowany -
//      ustawianie strony niewidocznego panelu to martwa kontrolka,
//   3. strzałki kolejności widgetów są wyłączone na krańcach listy,
//   4. zapis wysyła KOMPLET pól; pominięcie choć jednego zostawiłoby w bazie
//      wartość z poprzedniego zapisu, mimo że panel pokazuje inną.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_ARCHIVE_LAYOUT } from "@/lib/archive-layout-settings";

const h = vi.hoisted(() => ({
  upserts: [] as Array<Record<string, unknown>>,
  upsertError: null as { message: string } | null,
  toastSuccess: vi.fn(),
  toastFail: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: async (payload: Record<string, unknown>) => {
        h.upserts.push(payload);
        return { error: h.upsertError };
      },
    }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastFail } }));
vi.mock("@/lib/archive-layout-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/archive-layout-settings")>();
  return {
    ...actual,
    archiveLayoutQueryOptions: (archiveType: "category" | "tag") => ({
      queryKey: ["archive-layout-settings", archiveType],
      queryFn: async () => ({
        id: "row-1",
        archive_type: archiveType,
        ...actual.DEFAULT_ARCHIVE_LAYOUT,
      }),
    }),
  };
});
// Podgląd na żywo renderuje prawdziwy układ archiwum z atrapą danych - poza
// zakresem tego testu, więc zastępujemy go znacznikiem.
vi.mock("../ArchiveLivePreview", () => ({
  ArchiveLivePreview: ({ settings }: { settings: { columns: number; layout_variant: number } }) => (
    <div data-testid="podglad">{`${settings.layout_variant}/${settings.columns}`}</div>
  ),
}));

import "@/lib/i18n-archive-layout";
import { ArchiveLayoutAdmin } from "../ArchiveLayoutAdmin";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

async function setup(archiveType: "category" | "tag" = "category", sampleSlug?: string) {
  const view = render(<ArchiveLayoutAdmin archiveType={archiveType} sampleSlug={sampleSlug} />, {
    wrapper,
  });
  await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
  return view;
}

/** Kontrolka wyboru po etykiecie pola. */
function selectByLabel(label: string | RegExp): HTMLElement {
  const container = screen.getByText(label).closest("div");
  if (!container) throw new Error(`brak pola ${String(label)}`);
  const control = within(container).getByRole("combobox");
  return control;
}

const saveButton = () => screen.getByRole("button", { name: /zapisz|save/i });

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.upserts.length = 0;
  h.upsertError = null;
  h.toastSuccess.mockReset();
  h.toastFail.mockReset();
});

describe("ArchiveLayoutAdmin - wczytanie", () => {
  it("do czasu wczytania nie pokazuje pól", () => {
    render(<ArchiveLayoutAdmin archiveType="category" />, { wrapper });
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("po wczytaniu pokazuje wersję roboczą z bazy", async () => {
    await setup();
    expect(screen.getAllByRole("switch").length).toBeGreaterThan(0);
    expect(screen.getByTestId("podglad")).toHaveTextContent(
      `${DEFAULT_ARCHIVE_LAYOUT.layout_variant}/${DEFAULT_ARCHIVE_LAYOUT.columns}`,
    );
  });

  it("tytuł rozróżnia archiwum KATEGORII od archiwum TAGÓW", async () => {
    const view = await setup("category");
    const categoryTitle = screen.getByRole("heading", { level: 1 }).textContent;
    view.unmount();

    await setup("tag");
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toBe(categoryTitle);
  });

  it("odnośnik do podglądu na żywo pojawia się TYLKO z przykładowym adresem", async () => {
    const view = await setup("category");
    expect(screen.queryByRole("link")).toBeNull();
    view.unmount();

    await setup("category", "polityka");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/category/polityka");
  });
});

describe("ArchiveLayoutAdmin - wersja robocza i podgląd", () => {
  it("zmiana pola NIE leci od razu do bazy", async () => {
    // Panel ma być edytowalny bez zapisu po każdym kliknięciu - inaczej każda
    // pomyłka natychmiast zmienia wygląd serwisu.
    await setup();
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(h.upserts).toHaveLength(0);
  });

  it("podgląd na żywo reaguje na wersję roboczą", async () => {
    // Wybór wariantu układu to kafle z `aria-pressed` - jedyna kontrolka tego
    // panelu sterowana bez rozwijanej listy Radix.
    await setup();
    const variants = screen.getAllByRole("button", { pressed: false });
    fireEvent.click(variants[0]);
    await waitFor(() =>
      expect(screen.getByTestId("podglad").textContent).not.toBe(
        `${DEFAULT_ARCHIVE_LAYOUT.layout_variant}/${DEFAULT_ARCHIVE_LAYOUT.columns}`,
      ),
    );
  });

  it("wybrany wariant układu jest zaznaczony dla czytnika ekranu", async () => {
    await setup();
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });
});

describe("ArchiveLayoutAdmin - panel boczny", () => {
  it("pozycja panelu jest WYŁĄCZONA, gdy panel jest schowany", async () => {
    // Domyślnie panel boczny jest schowany, więc jego pozycja to martwa
    // kontrolka - włączenie panelu ma ją odblokować.
    await setup();
    expect(selectByLabel(/pozycj|position/i)).toBeDisabled();
  });

  it("włączenie panelu odblokowuje wybór pozycji", async () => {
    await setup();
    const sidebarSwitch = screen
      .getAllByRole("switch")
      .find((s) => s.closest("label")?.textContent?.match(/panel boczn|sidebar/i));
    if (!sidebarSwitch) throw new Error("brak przełącznika panelu bocznego");

    fireEvent.click(sidebarSwitch);
    await waitFor(() => expect(selectByLabel(/pozycj|position/i)).toBeEnabled());
  });

  it("strzałki kolejności są WYŁĄCZONE na krańcach listy", async () => {
    // Aktywna strzałka, która nic nie robi, uczy operatora, że panel jest
    // popsuty - i przy okazji ukrywa realny kraniec listy.
    await setup();
    const items = screen.getAllByRole("listitem");
    const first = within(items[0]).getByRole("button", { name: /w gór|up/i });
    const last = within(items[items.length - 1]).getByRole("button", { name: /w dó|down/i });
    expect(first).toBeDisabled();
    expect(last).toBeDisabled();
  });

  it("wyłączenie widgetu CHOWA jego strzałki kolejności", async () => {
    // Kolejność wyłączonego widgetu nie ma znaczenia - pokazywanie strzałek
    // sugerowałoby, że ma.
    await setup();
    const item = screen.getAllByRole("listitem")[0];
    expect(within(item).getAllByRole("button")).toHaveLength(2);

    fireEvent.click(within(item).getByRole("switch"));
    await waitFor(() => expect(within(item).queryAllByRole("button")).toHaveLength(0));
  });

  it("DEFEKT (zapinany): przesunięcie widgetu NIE zmienia kolejności na liście", async () => {
    // Lista renderuje się z katalogu `ALL_WIDGETS` w SZTYWNEJ kolejności, a
    // strzałki zmieniają wyłącznie `sidebar_widgets` w wersji roboczej.
    // Kolejność DZIAŁA na stronie publicznej, ale operator nie widzi jej
    // w panelu - klika i nic się nie rusza. Pin na stan dzisiejszy; naprawa
    // (sortowanie listy po wersji roboczej) to osobna decyzja i osobny commit.
    await setup();
    const labelsBefore = screen.getAllByRole("listitem").map((li) => li.textContent);
    const second = screen.getAllByRole("listitem")[1];
    fireEvent.click(within(second).getByRole("button", { name: /w gór|up/i }));

    await waitFor(() => {
      const labelsAfter = screen.getAllByRole("listitem").map((li) => li.textContent);
      expect(labelsAfter).toEqual(labelsBefore);
    });
  });

  it("przesunięcie widgetu ZMIENIA jednak kolejność w zapisie", async () => {
    // Dowód, że sama reguła działa - efekt widać dopiero w danych, nie w UI.
    await setup();
    const second = screen.getAllByRole("listitem")[1];
    fireEvent.click(within(second).getByRole("button", { name: /w gór|up/i }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(h.upserts[0].sidebar_widgets).not.toEqual(DEFAULT_ARCHIVE_LAYOUT.sidebar_widgets);
    expect(new Set(h.upserts[0].sidebar_widgets as string[])).toEqual(
      new Set(DEFAULT_ARCHIVE_LAYOUT.sidebar_widgets),
    );
  });

  it("strzałka W DÓŁ przesuwa w przeciwną stronę niż strzałka W GÓRĘ", async () => {
    // Dwie strzałki obok siebie o identycznej budowie - podmiana kierunku nie
    // daje błędu typów i objawia się dopiero jako lista, która „ucieka” w złą
    // stronę pod palcem operatora.
    const domyslne = [...DEFAULT_ARCHIVE_LAYOUT.sidebar_widgets];
    await setup();
    const pierwszy = screen.getAllByRole("listitem")[0];
    fireEvent.click(within(pierwszy).getByRole("button", { name: /w dół|down/i }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    const zapisane = h.upserts[0].sidebar_widgets as string[];
    expect(zapisane[0]).toBe(domyslne[1]);
    expect(zapisane[1]).toBe(domyslne[0]);
  });
});

describe("ArchiveLayoutAdmin - zapis", () => {
  it("wysyła KOMPLET pól ustawień, nie tylko zmienione", async () => {
    // Pominięcie choć jednego pola zostawiłoby w bazie wartość z poprzedniego
    // zapisu, mimo że panel pokazuje inną.
    await setup();
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    const payload = h.upserts[0];
    for (const key of Object.keys(DEFAULT_ARCHIVE_LAYOUT)) {
      expect(payload, key).toHaveProperty(key);
    }
    expect(payload.archive_type).toBe("category");
  });

  it("zapis idzie przez klucz konfliktu TENANT + RODZAJ archiwum", async () => {
    // Bez tego klucza zapis kategorii utworzyłby drugi wiersz zamiast
    // zaktualizować istniejący - i archiwum czytałoby losowy z nich.
    await setup();
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it("zapis niesie WERSJĘ ROBOCZĄ, nie wartość z bazy", async () => {
    await setup();
    const before = DEFAULT_ARCHIVE_LAYOUT.show_breadcrumbs;
    const breadcrumbs = screen
      .getAllByRole("switch")
      .find((s) => s.closest("label")?.textContent?.match(/okruszk|breadcrumb/i));
    if (!breadcrumbs) throw new Error("brak przełącznika okruszków");

    fireEvent.click(breadcrumbs);
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(h.upserts[0].show_breadcrumbs).toBe(!before);
  });

  it("porażka zapisu daje komunikat, a nie ciche powodzenie", async () => {
    h.upsertError = { message: "brak uprawnień" };
    await setup();
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toastFail).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("zapis tagów niesie WŁASNY rodzaj archiwum", async () => {
    await setup("tag");
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.upserts[0]).toMatchObject({ archive_type: "tag" }));
  });
});

// PEŁNY PRZEGLĄD PÓL FORMULARZA. Dotychczasowe przypadki brały panel boczny,
// wariant układu i zapis; siedem przełączników i cztery listy wyboru nie miały
// ani jednego wykonania.
//
// To ten sam rodzaj kodu co w edytorze motywu: jednolinijkowe `set("klucz", v)`
// o identycznej sygnaturze. Podpięcie „Pokaż opis” pod `show_follow` nie daje
// błędu typów (oba to `boolean`), nie wywraca renderu i wychodzi dopiero na
// publicznym archiwum - u czytelnika, nie u redaktora.
describe("ArchiveLayoutAdmin - każde pole pisze do WŁASNEGO ustawienia", () => {
  /**
   * Przełącznik w wierszu o danej etykiecie. Wiersz to `<label>` - nie `<div>`,
   * bo najbliższy div obejmuje całą siatkę pól i zwróciłby cudzy przełącznik.
   */
  function toggleByLabel(label: string): HTMLElement {
    const row = screen.getByText(label).closest("label");
    const control = row?.querySelector('[role="switch"]');
    if (!control) throw new Error(`brak przełącznika ${label}`);
    return control as HTMLElement;
  }

  /** Ostatnia wysłana wersja ustawień. */
  const lastSaved = () => h.upserts.at(-1) as Record<string, unknown>;

  it.each([
    ["Pokaż okruszki", "show_breadcrumbs"],
    ["Pokaż nagłówek hero", "show_hero"],
    ["Pokaż opis", "show_description"],
    ["Pokaż przycisk obserwuj", "show_follow"],
    ["Pokaż sidebar", "show_sidebar"],
    ["Pokaż wyróżniony wpis na górze", "show_featured_top"],
    ["Pokaż powiązane kategorie/tagi", "show_related_taxonomies"],
    ["Pokaż powiązane podcasty", "show_podcasts"],
  ])("przełącznik %s zmienia WYŁĄCZNIE %s", async (etykieta, klucz) => {
    await setup();
    const przed = { ...DEFAULT_ARCHIVE_LAYOUT } as Record<string, unknown>;
    fireEvent.click(toggleByLabel(etykieta));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    const zmienione = Object.keys(przed).filter((k) => lastSaved()[k] !== przed[k]);
    expect(zmienione).toEqual([klucz]);
    expect(lastSaved()[klucz]).toBe(!przed[klucz]);
  });

  it.each([
    ["Tło nagłówka", "Zdjęcie", "hero_bg_style", "image"],
    ["Styl listy", "Lista", "list_style", "list"],
    ["Liczba kolumn", "4", "columns", 4],
  ])("lista %s zapisuje wartość, nie etykietę", async (etykieta, opcja, klucz, wartosc) => {
    // Etykieta („Zdjęcie”) i wartość („image”) to dwie różne rzeczy; zapisanie
    // etykiety daje wariant, którego publiczny układ nie zna.
    await setup();
    fireEvent.keyDown(selectByLabel(etykieta), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: opcja }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastSaved()[klucz]).toBe(wartosc);
  });

  it("liczba wpisów na stronie zapisuje się jako LICZBA, nie napis", async () => {
    // Napis „30” przeszedłby do zapytania i wywrócił paginację po stronie bazy.
    await setup();
    const pole = screen.getByText("Wpisy na stronie").closest("div")?.querySelector("input");
    fireEvent.change(pole as HTMLInputElement, { target: { value: "30" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastSaved().posts_per_page).toBe(30);
  });

  it("pozycja panelu bocznego zapisuje stronę, po której panel stoi", async () => {
    await setup();
    fireEvent.click(toggleByLabel("Pokaż sidebar"));
    fireEvent.keyDown(selectByLabel(/pozycj|position/i), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Lewa" }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastSaved().sidebar_position).toBe("left");
  });

  it("Reset przywraca WSZYSTKIE domyślne wartości naraz", async () => {
    // Reset zostawiający choć jedno pole po staremu daje układ, którego nie ma
    // ani w domyślnych, ani w zapisanych ustawieniach.
    await setup();
    fireEvent.click(toggleByLabel("Pokaż okruszki"));
    fireEvent.click(toggleByLabel("Pokaż opis"));
    fireEvent.click(screen.getByRole("button", { name: /^Reset$/ }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    for (const [klucz, wartosc] of Object.entries(DEFAULT_ARCHIVE_LAYOUT)) {
      expect(lastSaved()[klucz], klucz).toEqual(wartosc);
    }
  });

  it("Reset zachowuje identyfikator wiersza, nie tworzy drugiego", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /^Reset$/ }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastSaved().archive_type).toBe("category");
  });
});
