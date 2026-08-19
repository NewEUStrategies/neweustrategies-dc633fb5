// TRASA KOLORÓW KATEGORII. Do 19.08.2026 na zerze (237 instrukcji).
//
// Kolor pigułki kategorii nie zostaje w panelu: trafia na nagłówki wpisów i na
// overlaye zdjęć na publicznej stronie. Ekran ma trzy reguły, których nie widać
// nigdzie indziej:
//
//   1. KOLEJNOŚĆ. Dwanaście rekomendowanych obszarów tematycznych idzie pierwsze
//      i w ustalonym porządku, reszta kategorii za nimi. Lista posortowana samą
//      nazwą gubi ten podział - a to on mówi redakcji, co jest „główne”.
//   2. ZAPIS RÓŻNICOWY. Zapisywane są WYŁĄCZNIE zmienione wiersze. Wysłanie
//      wszystkiego to kilkadziesiąt zapisów przy jednym kliknięciu, a wąska
//      ścieżka serwerowa pisze tylko kolumnę `color` - reszta wiersza (opis,
//      logo) nie jest tu wczytana i zostałaby nadpisana.
//   3. KONTRAST TEKSTU na pigułce liczy się z jasności tła. Stała barwa tekstu
//      daje białe litery na żółtym tle - nieczytelne dla czytelnika.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  selectError: null as Error | null,
  inserted: [] as unknown[],
  insertError: null as { message: string } | null,
  saved: [] as unknown[],
  saveError: null as Error | null,
  language: "pl",
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({ useRequiredTenant: () => "tenant-1" }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      ...actual.useTranslation(),
      i18n: { ...actual.useTranslation().i18n, language: h.language },
    }),
  };
});
vi.mock("@/lib/content.functions", () => ({ updateCategoryColor: "save-color" }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async (payload: unknown) => {
    if (h.saveError) throw h.saveError;
    h.saved.push(payload);
    return { ok: true };
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: h.rows, error: h.selectError }),
        }),
      }),
      insert: async (values: unknown) => {
        h.inserted.push(values);
        return { error: h.insertError };
      },
    }),
  },
}));

// Picker koloru to popover z kanwą HSL - tutaj liczy się wyłącznie to, KTÓRY
// wiersz dostaje wpisaną wartość, więc wystawiamy jego kontrakt jako pole tekstowe.
vi.mock("@/components/admin/blocks/AdminColorPicker", () => ({
  AdminColorPicker: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value?: string;
    onChange: (v: string | undefined) => void;
    ariaLabel?: string;
  }) => (
    <input
      type="text"
      aria-label={ariaLabel}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
    />
  ),
}));

// Etykiety tego ekranu siedzą w RDZENIU słownika (`locale/pl.ts`), a nie w
// nakładce - import poniżej dociąga oba rdzenie, żeby asercje mierzyły napisy,
// które zobaczy redaktor, a nie klucze.
import "@/test/i18nReal";
import { Route } from "@/routes/admin.category-colors";
import { CORE_CATEGORY_AREAS } from "@/lib/categoryAreas";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** Wiersz kategorii zbudowany z rekomendowanego obszaru o danym indeksie. */
function coreRow(index: number, overrides: Record<string, unknown> = {}) {
  const area = CORE_CATEGORY_AREAS[index];
  return {
    id: `cat-${area.slug}`,
    slug: area.slug,
    name_pl: area.name_pl,
    name_en: area.name_en,
    color: area.color,
    ...overrides,
  };
}

async function setup() {
  const Component = (Route as AnyRoute).options.component as () => ReactNode;
  const view = render(<Component />, { wrapper });
  if (h.rows.length) {
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(h.rows.length + 1));
  } else {
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  }
  return view;
}

/** Pole tekstowe koloru w wierszu o danym slugu. */
function colorInput(slug: string): HTMLInputElement {
  const cell = screen.getByTitle(slug).closest("tr");
  const input = cell?.querySelector('input[type="text"]');
  if (!input) throw new Error(`brak kontrolki koloru dla ${slug}`);
  return input as HTMLInputElement;
}

const saveButton = () => screen.getByRole("button", { name: /Zapisz kolory|Save colors/i });

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.rows = [];
  h.selectError = null;
  h.inserted.length = 0;
  h.insertError = null;
  h.saved.length = 0;
  h.saveError = null;
  h.language = "pl";
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.toast.info.mockReset();
});

describe("kolory kategorii - kolejność listy", () => {
  it("rekomendowane obszary idą PIERWSZE i w kolejności katalogu", async () => {
    // Sortowanie po nazwie gubi podział na obszary główne i pozostałe.
    h.rows = [
      { id: "x", slug: "aaa-inna", name_pl: "Aaa inna", name_en: "Aaa other", color: null },
      coreRow(2),
      coreRow(0),
    ];
    await setup();
    const slugi = screen
      .getAllByRole("row")
      .slice(1)
      .map((tr) => within(tr).getAllByRole("cell")[2].textContent);

    expect(slugi).toEqual([CORE_CATEGORY_AREAS[0].slug, CORE_CATEGORY_AREAS[2].slug, "aaa-inna"]);
  });

  it("pusta baza mówi wprost, że nie ma czego kolorować", async () => {
    await setup();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("nazwa pigułki idzie za językiem interfejsu", async () => {
    // Podgląd ma pokazywać to, co zobaczy czytelnik w swojej wersji językowej.
    h.rows = [coreRow(0)];
    h.language = "en";
    const view = await setup();
    // Kolumna nazwy pokazuje OBIE wersje niezależnie od języka; regułą jest
    // wyłącznie napis na PODGLĄDZIE pigułki.
    const pill = view.container.querySelector<HTMLElement>("span[style]");

    expect(pill?.textContent).toBe(CORE_CATEGORY_AREAS[0].name_en);
  });
});

describe("kolory kategorii - kontrast tekstu na pigułce", () => {
  /** Kolor tekstu pigułki dla zadanego tła. */
  async function pillTextColor(background: string): Promise<string> {
    h.rows = [coreRow(0, { color: background })];
    const view = await setup();
    const pill = view.container.querySelector<HTMLElement>("span[style]");
    const color = pill?.style.color ?? "";
    view.unmount();
    return color;
  }

  it("na JASNYM tle tekst jest ciemny", async () => {
    // Białe litery na żółtym tle są nieczytelne - a żółć bywa kolorem obszaru.
    expect(await pillTextColor("#ffef99")).toBe("#0b0b0d");
  });

  it("na CIEMNYM tle tekst jest jasny", async () => {
    expect(await pillTextColor("#111827")).toBe("#ffffff");
  });

  it("nieprawidłowy zapis koloru spada na tekst jasny, nie na pustkę", async () => {
    // Brak koloru tekstu daje litery w kolorze odziedziczonym - często tym samym
    // co tło, czyli pigułkę bez treści.
    expect(await pillTextColor("#abc")).toBe("#ffffff");
  });

  it("brak koloru w bazie daje domyślne ciemne tło", async () => {
    h.rows = [coreRow(0, { color: null })];
    const view = await setup();
    const pill = view.container.querySelector<HTMLElement>("span[style]");

    expect(pill?.style.backgroundColor).toBe("#111827");
  });
});

describe("kolory kategorii - zapis różnicowy", () => {
  it("bez zmian przycisk zapisu jest ZABLOKOWANY", async () => {
    // Kliknięcie „na wszelki wypadek” wysyłałoby kilkadziesiąt zapisów.
    h.rows = [coreRow(0)];
    await setup();

    expect(saveButton()).toBeDisabled();
  });

  it("zapisuje WYŁĄCZNIE zmieniony wiersz", async () => {
    h.rows = [coreRow(0), coreRow(1)];
    await setup();
    fireEvent.change(colorInput(CORE_CATEGORY_AREAS[0].slug), { target: { value: "#123456" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.saved).toHaveLength(1));
    expect(h.saved[0]).toMatchObject({
      data: { id: `cat-${CORE_CATEGORY_AREAS[0].slug}`, color: "#123456" },
    });
  });

  it("wpisanie TEJ SAMEJ wartości nie generuje zapisu", async () => {
    // Porównanie bez ignorowania wielkości liter uznałoby „#ABC123” za zmianę.
    h.rows = [coreRow(0, { color: "#abc123" })];
    await setup();
    fireEvent.change(colorInput(CORE_CATEGORY_AREAS[0].slug), { target: { value: "#ABC123" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toast.info).toHaveBeenCalled());
    expect(h.saved).toHaveLength(0);
  });

  it("po udanym zapisie znika oznaczenie niezapisanych zmian", async () => {
    h.rows = [coreRow(0)];
    await setup();
    fireEvent.change(colorInput(CORE_CATEGORY_AREAS[0].slug), { target: { value: "#123456" } });
    expect(screen.getByText("●")).toBeInTheDocument();

    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toast.success).toHaveBeenCalled());
    expect(screen.queryByText("●")).toBeNull();
  });

  it("PORAŻKA zapisu zostawia wersję roboczą i mówi o błędzie", async () => {
    // Wyczyszczenie szkicu po nieudanym zapisie kasuje pracę redaktora.
    h.saveError = new Error("brak uprawnień");
    h.rows = [coreRow(0)];
    await setup();
    fireEvent.change(colorInput(CORE_CATEGORY_AREAS[0].slug), { target: { value: "#123456" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(screen.getByText("●")).toBeInTheDocument();
  });

  it("podpowiedź rekomendowanego koloru pojawia się TYLKO przy odstępstwie", async () => {
    // Widoczna zawsze byłaby zaproszeniem do cofnięcia świadomej decyzji.
    h.rows = [coreRow(0)];
    await setup();
    expect(screen.queryByRole("button", { name: /rekomendowan|recommended/i })).toBeNull();

    fireEvent.change(colorInput(CORE_CATEGORY_AREAS[0].slug), { target: { value: "#123456" } });
    fireEvent.click(screen.getByRole("button", { name: /rekomendowan|recommended/i }));

    expect(colorInput(CORE_CATEGORY_AREAS[0].slug).value.toLowerCase()).toBe(
      CORE_CATEGORY_AREAS[0].color.toLowerCase(),
    );
  });

  it("kategoria SPOZA katalogu nie ma podpowiedzi rekomendowanego koloru", async () => {
    h.rows = [{ id: "x", slug: "wlasna", name_pl: "Własna", name_en: "Own", color: "#010101" }];
    await setup();
    fireEvent.change(colorInput("wlasna"), { target: { value: "#123456" } });

    expect(screen.queryByRole("button", { name: /rekomendowan|recommended/i })).toBeNull();
  });
});

describe("kolory kategorii - uzupełnianie brakujących obszarów", () => {
  it("przycisk pokazuje LICZBĘ brakujących obszarów", async () => {
    h.rows = [coreRow(0)];
    await setup();
    const btn = screen.getByRole("button", { name: /brakując|missing/i });

    expect(btn.textContent).toContain(String(CORE_CATEGORY_AREAS.length - 1));
  });

  it("komplet obszarów CHOWA przycisk", async () => {
    // Przycisk, który nic nie robi, jest gorszy niż jego brak.
    h.rows = CORE_CATEGORY_AREAS.map((_, i) => coreRow(i));
    await setup();

    expect(screen.queryByRole("button", { name: /brakując|missing/i })).toBeNull();
  });

  it("wstawia brakujące obszary z NAZWAMI w obu językach i kolorem", async () => {
    // Kategoria bez nazwy EN renderuje się na anglojęzycznej stronie jako pustka.
    h.rows = CORE_CATEGORY_AREAS.slice(1).map((_, i) => coreRow(i + 1));
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /brakując|missing/i }));

    await waitFor(() => expect(h.inserted).toHaveLength(1));
    const values = h.inserted[0] as Record<string, unknown>[];
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({
      tenant_id: "tenant-1",
      slug: CORE_CATEGORY_AREAS[0].slug,
      name_pl: CORE_CATEGORY_AREAS[0].name_pl,
      name_en: CORE_CATEGORY_AREAS[0].name_en,
      color: CORE_CATEGORY_AREAS[0].color,
    });
  });

  it("PORAŻKA wstawiania nie udaje sukcesu", async () => {
    h.insertError = { message: "naruszenie unikalności" };
    h.rows = [coreRow(0)];
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /brakując|missing/i }));

    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("DEFEKT: błąd bazy pokazuje się jako „[object Object]”, nie jako powód", async () => {
    // Supabase zwraca `PostgrestError` - zwykły obiekt, nie instancję `Error`.
    // Gałąź `e instanceof Error ? e.message : String(e)` wpada więc w `String(e)`
    // i redaktor dostaje komunikat bez żadnej informacji. Przypięte na stan
    // dzisiejszy; naprawa (odczyt pola `message`) zmienia zachowanie.
    h.insertError = { message: "naruszenie unikalności" };
    h.rows = [coreRow(0)];
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /brakując|missing/i }));

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("[object Object]"));
  });
});
