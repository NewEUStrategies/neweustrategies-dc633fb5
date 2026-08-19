// TRASA KATEGORII. Do 19.08.2026 na zerze (412 instrukcji) - największa trasa
// modułu 4 po stronach.
//
// Ekran zarządza SIEDMIOMA wymiarami taksonomii naraz (specjalizacja, typ
// publikacji, region, temat, projekt, seria, organizacja) w jednej tabeli i
// jednym formularzu. Trzy reguły, których złamania nie widać na pierwszy rzut
// oka:
//
//   1. HIERARCHIA JEST PER WYMIAR. Rodzicem może być wyłącznie kategoria tego
//      samego wymiaru i nigdy sama edytowana pozycja. Rodzic spoza wymiaru daje
//      drzewo, którego publiczne archiwum nie umie rozwinąć; rodzic wskazujący
//      na siebie to pętla.
//   2. ZMIANA WYMIARU UNIEWAŻNIA RODZICA. Bez tego edycja „region → temat”
//      zostawia w wierszu rodzica z poprzedniego wymiaru.
//   3. FILTR POKRYCIA JĘZYKOWEGO to jedyne narzędzie do znalezienia kategorii
//      bez tłumaczenia - a kategoria bez nazwy EN renderuje się na
//      anglojęzycznej stronie jako pustka.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  upserts: [] as unknown[],
  upsertError: null as Error | null,
  deletes: [] as unknown[],
  deleteError: null as Error | null,
  confirmAnswer: true,
  confirmCalls: [] as Record<string, unknown>[],
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({ useRequiredTenant: () => "tenant-1" }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: async (opts: Record<string, unknown>) => {
    h.confirmCalls.push(opts);
    return h.confirmAnswer;
  },
}));
vi.mock("@/lib/content.functions", () => ({
  upsertCategory: "upsert",
  deleteCategory: "delete",
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => async (payload: unknown) => {
    if (fn === "upsert") {
      if (h.upsertError) throw h.upsertError;
      h.upserts.push(payload);
      return { ok: true };
    }
    if (h.deleteError) throw h.deleteError;
    h.deletes.push(payload);
    return { ok: true };
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: h.rows, error: null }) }) }),
    }),
  },
}));

import "@/test/i18nReal";
// Etykiety filtra pokrycia językowego („Tylko PL”, „Komplet”…) mieszkają w
// nakładce, której sama trasa nie importuje - bez tego testy asertowałyby klucze.
import "@/lib/i18n-admin-extras";
import { Route } from "@/routes/admin.categories";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function cat(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    slug: "geopolityka",
    name_pl: "Geopolityka",
    name_en: "Geopolitics",
    description_pl: null,
    description_en: null,
    logo_url: null,
    kind: "category",
    parent_id: null,
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

/** Wiersz tabeli po widocznym slugu. */
const rowBySlug = (slug: string) => screen.getByTitle(slug).closest("tr") as HTMLElement;

/** Pole formularza po etykiecie pływającej. */
function formField(label: string): HTMLInputElement {
  const dialog = screen.getByRole("dialog");
  const input = within(dialog).getByLabelText(label);
  return input as HTMLInputElement;
}

/** Lista wyboru w oknie dialogowym po etykiecie sąsiadującej. */
function dialogSelect(label: string): HTMLElement {
  const dialog = screen.getByRole("dialog");
  const wrap = within(dialog).getByText(label).closest("div");
  return within(wrap as HTMLElement).getByRole("combobox");
}

function chooseInSelect(control: HTMLElement, optionName: string | RegExp) {
  fireEvent.keyDown(control, { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

/** Przycisk otwierający formularz nowej kategorii - w słowniku „Dodaj”. */
const newButton = () => screen.getByRole("button", { name: /^(Dodaj|Add|New)$/ });
const saveInDialog = () =>
  within(screen.getByRole("dialog")).getByRole("button", { name: /^(Zapisz|Save)$/ });
const lastUpsert = () =>
  (h.upserts.at(-1) as { data: { id?: string; fields: Record<string, unknown> } }).data;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.rows = [];
  h.upserts.length = 0;
  h.deletes.length = 0;
  h.confirmCalls.length = 0;
  h.upsertError = null;
  h.deleteError = null;
  h.confirmAnswer = true;
  h.toast.success.mockReset();
  h.toast.error.mockReset();
});

describe("kategorie - lista i licznik", () => {
  it("pusta baza mówi wprost, że nie ma kategorii", async () => {
    await setup();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("wiersz pokazuje OBIE wersje językowe, wymiar i slug", async () => {
    await setup2([cat()]);
    const wiersz = rowBySlug("geopolityka");

    expect(wiersz.textContent).toContain("Geopolityka");
    expect(wiersz.textContent).toContain("Geopolitics");
    expect(wiersz.textContent).toContain("Specjalizacja");
  });

  it("brak nazwy w danym języku pokazuje myślnik, nie pustkę", async () => {
    // Pusta komórka wygląda jak błąd renderu; myślnik to świadomy brak.
    await setup2([cat({ name_en: "" })]);
    const wiersz = rowBySlug("geopolityka");

    expect(within(wiersz).getAllByText("-")).not.toHaveLength(0);
  });

  it("kategoria z rodzicem jest oznaczona w kolumnie wymiaru", async () => {
    // Bez tego znaku płaska tabela nie mówi nic o hierarchii.
    await setup2([cat(), cat({ id: "c2", slug: "dziecko", parent_id: "c1" })]);

    expect(rowBySlug("dziecko").textContent).toContain("↳");
    expect(rowBySlug("geopolityka").textContent).not.toContain("↳");
  });

  it("licznik pokazuje SAMĄ liczbę, dopóki nic nie odfiltrowano", async () => {
    await setup2([cat(), cat({ id: "c2", slug: "druga" })]);
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

/** Wariant `setup` dla przypadków ustawiających wiersze w treści testu. */
async function setup2(rows: Record<string, unknown>[]) {
  h.rows = rows;
  return setup();
}

describe("kategorie - wyszukiwanie i filtr pokrycia", () => {
  const searchBox = () => screen.getByPlaceholderText(/szukaj|search/i);
  const langSelect = () => screen.getAllByRole("combobox")[0];

  it("wyszukiwarka obejmuje nazwę PL, nazwę EN i slug", async () => {
    // Szukanie tylko po jednym polu zostawia redaktora bez sposobu na znalezienie
    // kategorii, której nazwy nie pamięta w danym języku.
    await setup2([
      cat(),
      cat({ id: "c2", slug: "military", name_pl: "Wojskowość", name_en: "Military" }),
    ]);

    for (const fraza of ["Wojskow", "Milit", "military"]) {
      fireEvent.change(searchBox(), { target: { value: fraza } });
      await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
      expect(rowBySlug("military")).toBeInTheDocument();
    }
  });

  it("wyszukiwanie IGNORUJE wielkość liter", async () => {
    await setup2([cat()]);
    fireEvent.change(searchBox(), { target: { value: "GEOPOLIT" } });

    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
  });

  it("brak trafień mówi „brak wyników”, a nie „brak kategorii”", async () => {
    // To dwie różne informacje: puste archiwum kontra zbyt wąski filtr.
    await setup2([cat()]);
    fireEvent.change(searchBox(), { target: { value: "nieistniejąca" } });

    await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
    expect(screen.getByText(/wynik|result/i)).toBeInTheDocument();
  });

  it.each([
    ["complete", ["pelna"]],
    ["missing_any", ["tylko-pl", "tylko-en"]],
    ["pl_only", ["tylko-pl"]],
    ["en_only", ["tylko-en"]],
  ])("filtr %s wybiera właściwe wiersze", async (_wartosc, oczekiwane) => {
    await setup2([
      cat({ id: "a", slug: "pelna", name_pl: "Pełna", name_en: "Complete" }),
      cat({ id: "b", slug: "tylko-pl", name_pl: "Tylko PL", name_en: "" }),
      cat({ id: "c", slug: "tylko-en", name_pl: "", name_en: "Only EN" }),
    ]);
    const etykiety: Record<string, RegExp> = {
      complete: /^PL \+ EN$/,
      missing_any: /brak|missing/i,
      pl_only: /tylko PL|PL only/i,
      en_only: /tylko EN|EN only/i,
    };
    chooseInSelect(langSelect(), etykiety[_wartosc as string]);

    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(oczekiwane.length + 1));
    for (const slug of oczekiwane) expect(rowBySlug(slug)).toBeInTheDocument();
  });

  it("licznik pokazuje ODFILTROWANE ze WSZYSTKICH", async () => {
    // Sama liczba po filtrze wygląda jak utrata danych.
    await setup2([cat(), cat({ id: "c2", slug: "druga", name_pl: "Druga", name_en: "Second" })]);
    fireEvent.change(searchBox(), { target: { value: "Druga" } });

    await waitFor(() => expect(screen.getByText("1 / 2")).toBeInTheDocument());
  });

  it("czyszczenie filtrów przywraca PEŁNĄ listę", async () => {
    await setup2([cat(), cat({ id: "c2", slug: "druga", name_pl: "Druga", name_en: "Second" })]);
    fireEvent.change(searchBox(), { target: { value: "Druga" } });
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: /wyczyść|clear/i }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));
  });

  it("przycisk czyszczenia pojawia się DOPIERO po nałożeniu filtra", async () => {
    await setup2([cat()]);
    expect(screen.queryByRole("button", { name: /wyczyść|clear/i })).toBeNull();

    fireEvent.change(searchBox(), { target: { value: "x" } });
    expect(screen.getByRole("button", { name: /wyczyść|clear/i })).toBeInTheDocument();
  });
});

describe("kategorie - hierarchia jest PER WYMIAR", () => {
  it("rodzicem może być tylko kategoria TEGO SAMEGO wymiaru", async () => {
    // Rodzic spoza wymiaru daje drzewo, którego publiczne archiwum nie rozwinie.
    await setup2([
      cat({ id: "a", slug: "spec", kind: "category", name_pl: "Specjalizacja A" }),
      cat({ id: "b", slug: "region", kind: "region", name_pl: "Region B" }),
    ]);
    fireEvent.click(newButton());
    chooseInSelect(dialogSelect("Rodzic"), /Specjalizacja A/);

    expect(screen.queryByRole("option", { name: /Region B/ })).toBeNull();
  });

  it("edytowana pozycja NIE może być własnym rodzicem", async () => {
    // Rodzic wskazujący na siebie to pętla w drzewie.
    await setup2([
      cat({ id: "a", slug: "spec", name_pl: "Specjalizacja A" }),
      cat({ id: "b", slug: "inna", name_pl: "Inna" }),
    ]);
    fireEvent.click(within(rowBySlug("spec")).getAllByRole("button")[0]);
    fireEvent.keyDown(dialogSelect("Rodzic"), { key: "ArrowDown" });

    expect(screen.queryByRole("option", { name: /Specjalizacja A/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Inna/ })).toBeInTheDocument();
  });

  it("brak kandydatów na rodzica BLOKUJE listę zamiast dawać pustą", async () => {
    await setup2([cat({ id: "a", slug: "jedyna", name_pl: "Jedyna" })]);
    fireEvent.click(within(rowBySlug("jedyna")).getAllByRole("button")[0]);

    expect(dialogSelect("Rodzic")).toBeDisabled();
  });

  it("ZMIANA WYMIARU unieważnia wybranego rodzica", async () => {
    // Bez tego w wierszu zostaje rodzic z poprzedniego wymiaru.
    await setup2([
      cat({ id: "a", slug: "spec", name_pl: "Specjalizacja A" }),
      cat({ id: "b", slug: "dziecko", name_pl: "Dziecko", parent_id: "a" }),
    ]);
    fireEvent.click(within(rowBySlug("dziecko")).getAllByRole("button")[0]);
    chooseInSelect(dialogSelect("Wymiar"), "Region / państwo");
    fireEvent.click(saveInDialog());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastUpsert().fields).toMatchObject({ kind: "region", parent_id: null });
  });

  it("wybór „brak rodzica” zapisuje pustkę, nie napis", async () => {
    await setup2([
      cat({ id: "a", slug: "spec", name_pl: "Specjalizacja A" }),
      cat({ id: "b", slug: "dziecko", name_pl: "Dziecko", parent_id: "a" }),
    ]);
    fireEvent.click(within(rowBySlug("dziecko")).getAllByRole("button")[0]);
    chooseInSelect(dialogSelect("Rodzic"), /brak/);
    fireEvent.click(saveInDialog());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastUpsert().fields.parent_id).toBeNull();
  });
});

describe("kategorie - formularz i zapis", () => {
  it("NOWA kategoria startuje z pustym formularzem, nawet po edycji innej", async () => {
    // Formularz z resztkami po edycji tworzy duplikat cudzej kategorii.
    await setup2([cat()]);
    fireEvent.click(within(rowBySlug("geopolityka")).getAllByRole("button")[0]);
    expect(formField("Nazwa (PL)").value).toBe("Geopolityka");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    fireEvent.click(newButton());
    expect(formField("Nazwa (PL)").value).toBe("");
  });

  it("EDYCJA wypełnia komplet pól i niesie identyfikator", async () => {
    // Zgubione `id` tworzy duplikat zamiast poprawić kategorię.
    await setup2([
      cat({
        description_pl: "Opis PL",
        description_en: "Desc EN",
        logo_url: "https://cdn.example/logo.png",
      }),
    ]);
    fireEvent.click(within(rowBySlug("geopolityka")).getAllByRole("button")[0]);

    expect(formField("Opis (PL)").value).toBe("Opis PL");
    expect(formField("Description (EN)").value).toBe("Desc EN");
    expect(formField("Logo URL").value).toBe("https://cdn.example/logo.png");

    fireEvent.click(saveInDialog());
    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastUpsert().id).toBe("c1");
  });

  it("puste pola tekstowe zapisują się jako PUSTKA, nie jako pusty napis", async () => {
    // Pusty napis w opisie renderuje na stronie pusty akapit zamiast niczego.
    await setup2([cat({ description_pl: "Opis PL" })]);
    fireEvent.click(within(rowBySlug("geopolityka")).getAllByRole("button")[0]);
    fireEvent.change(formField("Opis (PL)"), { target: { value: "" } });
    fireEvent.click(saveInDialog());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastUpsert().fields.description_pl).toBeNull();
  });

  it("pusty slug jest POMIJANY, żeby serwer wygenerował go z nazwy", async () => {
    // Wysłanie pustego napisu utrwaliłoby w bazie kategorię bez adresu.
    await setup2([]);
    fireEvent.click(newButton());
    fireEvent.change(formField("Nazwa (PL)"), { target: { value: "Nowa" } });
    fireEvent.click(saveInDialog());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastUpsert().fields.slug).toBeUndefined();
    expect(lastUpsert().id).toBeUndefined();
  });

  it.each([
    ["Nazwa (PL)", "name_pl", "Nowa nazwa"],
    ["Name (EN)", "name_en", "New name"],
    ["Slug (auto)", "slug", "nowy-slug"],
    ["Opis (PL)", "description_pl", "Nowy opis"],
    ["Description (EN)", "description_en", "New description"],
    ["Logo URL", "logo_url", "https://cdn.example/x.svg"],
  ])("pole %s pisze do WŁASNEGO klucza", async (etykieta, klucz, wartosc) => {
    // Sześć pól tekstowych o identycznej budowie - podpięcie „Opis (PL)” pod
    // `description_en` przechodzi typowanie i objawia się jako opis widoczny
    // wyłącznie na anglojęzycznej stronie.
    await setup2([]);
    fireEvent.click(newButton());
    fireEvent.change(formField(etykieta), { target: { value: wartosc } });
    fireEvent.click(saveInDialog());

    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(lastUpsert().fields[klucz]).toBe(wartosc);
  });

  it("udany zapis ZAMYKA okno", async () => {
    await setup2([]);
    fireEvent.click(newButton());
    fireEvent.change(formField("Nazwa (PL)"), { target: { value: "Nowa" } });
    fireEvent.click(saveInDialog());

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.toast.success).toHaveBeenCalled();
  });

  it("PORAŻKA zapisu ZOSTAWIA okno otwarte z wpisanymi danymi", async () => {
    // Zamknięcie okna po błędzie kasuje pracę redaktora.
    h.upsertError = new Error("slug zajęty");
    await setup2([]);
    fireEvent.click(newButton());
    fireEvent.change(formField("Nazwa (PL)"), { target: { value: "Nowa" } });
    fireEvent.click(saveInDialog());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("slug zajęty"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(formField("Nazwa (PL)").value).toBe("Nowa");
  });
});

describe("kategorie - usuwanie", () => {
  it("PYTA przed usunięciem, pytaniem destrukcyjnym", async () => {
    // Usunięcie kategorii odpina ją od wszystkich wpisów.
    await setup2([cat()]);
    fireEvent.click(within(rowBySlug("geopolityka")).getAllByRole("button")[1]);

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.confirmCalls[0]).toMatchObject({ destructive: true });
  });

  it("odmowa NIE usuwa", async () => {
    h.confirmAnswer = false;
    await setup2([cat()]);
    fireEvent.click(within(rowBySlug("geopolityka")).getAllByRole("button")[1]);

    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.deletes).toHaveLength(0);
  });

  it("zgoda usuwa DOKŁADNIE wskazany wiersz", async () => {
    await setup2([cat(), cat({ id: "c2", slug: "druga", name_pl: "Druga" })]);
    fireEvent.click(within(rowBySlug("druga")).getAllByRole("button")[1]);

    await waitFor(() => expect(h.deletes).toEqual([{ data: { id: "c2" } }]));
  });

  it("PORAŻKA usuwania mówi o powodzie", async () => {
    h.deleteError = new Error("kategoria używana przez wpisy");
    await setup2([cat()]);
    fireEvent.click(within(rowBySlug("geopolityka")).getAllByRole("button")[1]);

    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith("kategoria używana przez wpisy"),
    );
  });
});
