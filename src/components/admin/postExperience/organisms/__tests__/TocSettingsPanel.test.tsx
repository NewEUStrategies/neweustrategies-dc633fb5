// Panel globalnych ustawień spisu treści - CAŁY, od odczytu z site_settings do
// upsertu.
//
// STAN WYJŚCIOWY: `src/routes/admin.toc.tsx` miał 0 z 32 funkcji i 0% linii.
// Panel wpisany w plik trasy nie ma jak dostać testu komponentowego bez
// stawiania routera, więc czterysta linii formularza stało nietknięte - łącznie
// z zapisem, który idzie do wiersza współdzielonego przez cały obszar roboczy.
//
// CZEGO PILNUJE TEN PLIK (a nie „czy się wyrenderowało"):
//   1. CO WIDAĆ - wszystkie sekcje, wszystkie pola, poprawne nazwy dostępne.
//   2. CO JEST WYŁĄCZONE - zapis i reset przy czystym szkicu oraz w trakcie
//      zapisu; poziomy nagłówka, które przeskoczyłyby drugą granicę.
//   3. CO SIĘ DZIEJE PO ZMIANIE - „brak zmian" kontra „niezapisane zmiany".
//   4. CO IDZIE DO BAZY - upsert z jawnym konfliktem `tenant_id,key` i pełną
//      treścią szkicu, nie samym zmienionym polem.
//   5. PODGLĄD ODPOWIADA USTAWIENIOM - numeracja, kolumny, zakres poziomów,
//      język zakładki i stan wyłączony.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

// Fabryka atrapy klienta importuje WYŁĄCZNIE `@/test/supabaseChain` - moduł bez
// ani jednego importu z produkcji. Sięgnięcie tu po fixture'y modułu zamyka cykl
// inicjalizacji (fixture'y -> lib/toc/settings -> mockowany klient -> fabryka)
// i ZAWIESZA cały plik testowy.
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

vi.mock("react-i18next", async () => {
  const fixtures = await import("@/test/postExperience/fixtures");
  return fixtures.reactI18nextStub();
});

// Radix Select nie otwiera listy w happy-dom (brak `hasPointerCapture` i
// pomiarów układu), więc prymityw schodzi do natywnego `<select>`. Reguła (jakie
// opcje, która wyłączona) zostaje prawdziwa - podmieniony jest sposób pokazania.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { selectPrimitiveStub } = await import("@/test/postExperience/fixtures");
  return selectPrimitiveStub(React);
});

// Selektor barwy wciąga react-colorful i własny słownik bloków; tutaj liczy się
// wyłącznie to, że każde z siedmiu pól koloru ma nazwę i oddaje wartość.
vi.mock("@/components/admin/blocks/AdminColorPicker", () => ({
  AdminColorPicker: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string | undefined;
    onChange: (v: string | undefined) => void;
    ariaLabel?: string;
  }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      data-color={value}
      onClick={() => onChange("#101010")}
    >
      {value}
    </button>
  ),
}));

import { TocSettingsPanel } from "@/components/admin/postExperience/organisms/TocSettingsPanel";
import { TOC_DEFAULTS, TOC_SETTING_KEY } from "@/lib/toc/settings";
import {
  SITE_SETTINGS_QUERY_KEY,
  fail,
  ok,
  tocDefaults,
  type SupabaseFromStub,
} from "@/test/postExperience/fixtures";
import { resetPendingWrites } from "@/lib/useSiteSetting";

const from = () => stubs.from as SupabaseFromStub;

/**
 * Osadza panel z ZASIANĄ mapą site_settings, żeby test nie musiał przechodzić
 * przez `fetchAllSiteSettings` (ta droga ma własny test w warstwie ustawień).
 */
function renderPanel(persisted?: Record<string, unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(SITE_SETTINGS_QUERY_KEY, {
    [TOC_SETTING_KEY]: persisted ?? tocDefaults(),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...render(<TocSettingsPanel />, { wrapper }) };
}

const saveButton = () => screen.getByRole("button", { name: /common\.save/ });
const resetButton = () => screen.getByRole("button", { name: /common\.reset/ });
const numberField = (key: string) => screen.getByRole("spinbutton", { name: `admin.toc.${key}` });
const selectField = (key: string) => screen.getByRole("combobox", { name: `admin.toc.${key}` });
const toggle = (key: string) =>
  screen.getByRole("switch", { name: new RegExp(`admin.toc.${key}`) });

/**
 * Łańcuch ZAPISU, odsiany od łańcucha odczytu.
 *
 * Zasianie mapy ustawień przez `setQueryData` nie znaczy „świeże" - react-query
 * i tak odpala odświeżenie, więc w atrapie stoi też `select` na tej samej
 * tabeli. Test zapisu musi patrzeć na łańcuch z ogniwem `upsert`, inaczej
 * sprawdzałby odczyt i przechodziłby także wtedy, gdy zapis nie poszedł wcale.
 */
const writeChains = () =>
  from()
    .chainsFor("site_settings")
    .filter((chain) => chain.calls.some((call) => call.method === "upsert"));

beforeEach(() => {
  vi.clearAllMocks();
  from().reset();
  resetPendingWrites();
  from().setResponse("site_settings", ok(null));
});

describe("TocSettingsPanel - co widać", () => {
  it("nagłówek strony i wszystkie trzy sekcje formularza są nagłówkami w drzewie", () => {
    renderPanel();
    expect(screen.getByRole("heading", { level: 1, name: "admin.toc.title" })).toBeInTheDocument();
    const sections = screen.getAllByRole("heading", { level: 2 }).map((n) => n.textContent);
    expect(sections).toEqual(
      expect.arrayContaining(["admin.toc.general", "admin.toc.labels", "admin.toc.colors"]),
    );
  });

  it("pola liczbowe niosą granice ze SCHEMATU ustawień, nie z osobnej listy w panelu", () => {
    renderPanel();
    expect(numberField("position")).toHaveAttribute("min", "-1");
    expect(numberField("position")).toHaveAttribute("max", "20");
    expect(numberField("minHeadings")).toHaveAttribute("min", "1");
  });

  it("wszystkie trzy układy spisu treści są do wyboru, każdy z własnym kluczem etykiety", () => {
    renderPanel();
    const options = within(selectField("layout"))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["boxed", "inline", "sticky-sidebar"]);
    expect(
      screen.getByRole("option", { name: "admin.toc.layoutOption.boxed" }),
    ).toBeInTheDocument();
  });

  it("trzy karty kolumn są przyciskami ogłaszającymi stan wyboru", () => {
    renderPanel(tocDefaults({ columns: "col-2" }));
    const two = screen.getByRole("button", { name: "admin.toc.columnsOption.col-2.label" });
    const one = screen.getByRole("button", { name: "admin.toc.columnsOption.col-1.label" });
    expect(two).toHaveAttribute("aria-pressed", "true");
    expect(one).toHaveAttribute("aria-pressed", "false");
  });

  it("SIEDEM pól koloru, każde z własną nazwą dostępną i wartością z ustawień", () => {
    renderPanel(tocDefaults({ colors: { ...TOC_DEFAULTS.colors, accent: "#abcdef" } }));
    const pickers = screen.getAllByRole("button", { name: /admin\.toc\.colorField\./ });
    expect(pickers).toHaveLength(7);
    expect(screen.getByRole("button", { name: "admin.toc.colorField.accent" })).toHaveAttribute(
      "data-color",
      "#abcdef",
    );
  });

  it("tytuł spisu treści ma osobne pole na każdy język publikacji", () => {
    renderPanel(tocDefaults({ titlePl: "Spis", titleEn: "Contents" }));
    expect(screen.getByRole("textbox", { name: "admin.toc.titlePl" })).toHaveValue("Spis");
    expect(screen.getByRole("textbox", { name: "admin.toc.titleEn" })).toHaveValue("Contents");
  });

  it("podpowiedź pozycji jest WIĄZANA z polem, nie tylko postawiona pod nim", () => {
    renderPanel();
    const describedBy = numberField("position").getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe(
      "admin.toc.positionHint",
    );
  });

  it("panel czyta wartości Z BAZY, nie z wartości domyślnych", () => {
    renderPanel(tocDefaults({ position: 9, minHeadings: 5, layout: "inline", ordered: true }));
    expect(numberField("position")).toHaveValue(9);
    expect(numberField("minHeadings")).toHaveValue(5);
    expect(selectField("layout")).toHaveValue("inline");
  });

  it("NIEPOPRAWNY wiersz w bazie degraduje do wartości domyślnych, nie gasi panelu", () => {
    renderPanel({ layout: "wymyslony", position: "duzo" } as unknown as Record<string, unknown>);
    expect(selectField("layout")).toHaveValue(TOC_DEFAULTS.layout);
    expect(numberField("position")).toHaveValue(TOC_DEFAULTS.position);
  });
});

describe("TocSettingsPanel - co jest wyłączone", () => {
  it("BRAK ZMIAN wyłącza i zapis, i reset (nic nie leci do bazy przy zerowej zmianie)", () => {
    renderPanel();
    expect(saveButton()).toBeDisabled();
    expect(resetButton()).toBeDisabled();
  });

  it("pierwsza zmiana ODBLOKOWUJE zapis i reset", () => {
    renderPanel();
    fireEvent.change(numberField("position"), { target: { value: "7" } });
    expect(saveButton()).not.toBeDisabled();
    expect(resetButton()).not.toBeDisabled();
  });

  it("powrót do wartości zapisanej ZNOWU wyłącza zapis (to nie jest zmiana)", () => {
    renderPanel(tocDefaults({ position: 3 }));
    fireEvent.change(numberField("position"), { target: { value: "7" } });
    expect(saveButton()).not.toBeDisabled();
    fireEvent.change(numberField("position"), { target: { value: "3" } });
    expect(saveButton()).toBeDisabled();
  });

  it("dolna granica poziomu nie może przeskoczyć górnej - opcje ponad nią są wyłączone", () => {
    renderPanel(tocDefaults({ minLevel: 2, maxLevel: 3 }));
    const disabled = within(selectField("minLevel"))
      .getAllByRole("option")
      .filter((o) => (o as HTMLOptionElement).disabled)
      .map((o) => (o as HTMLOptionElement).value);
    expect(disabled).toEqual(["4", "5", "6"]);
    expect(within(selectField("minLevel")).getByRole("option", { name: "H3" })).not.toBeDisabled();
  });

  it("górna granica poziomu nie może zejść pod dolną", () => {
    renderPanel(tocDefaults({ minLevel: 3, maxLevel: 5 }));
    const disabled = within(selectField("maxLevel"))
      .getAllByRole("option")
      .filter((o) => (o as HTMLOptionElement).disabled)
      .map((o) => (o as HTMLOptionElement).value);
    expect(disabled).toEqual(["1", "2"]);
    expect(within(selectField("maxLevel")).getByRole("option", { name: "H6" })).not.toBeDisabled();
  });

  it("zmiana dolnej granicy PRZELICZA wyłączone opcje górnej (jedna reguła, dwie listy)", () => {
    renderPanel(tocDefaults({ minLevel: 2, maxLevel: 6 }));
    fireEvent.change(selectField("minLevel"), { target: { value: "4" } });
    const disabled = within(selectField("maxLevel"))
      .getAllByRole("option")
      .filter((o) => (o as HTMLOptionElement).disabled)
      .map((o) => (o as HTMLOptionElement).value);
    expect(disabled).toEqual(["1", "2", "3"]);
    expect(selectField("minLevel")).toHaveValue("4");
  });
});

describe("TocSettingsPanel - co idzie do bazy", () => {
  it("zapis to UPSERT z jawnym konfliktem `tenant_id,key` - nie UPDATE bez dopasowania", async () => {
    renderPanel();
    fireEvent.change(numberField("position"), { target: { value: "7" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    const chain = writeChains()[0];
    expect(chain?.calls.map((c) => c.method)).toEqual(["upsert"]);
    expect(chain?.calls[0]?.args[1]).toEqual({ onConflict: "tenant_id,key" });
  });

  it("do bazy idzie CAŁY szkic pod kluczem ustawienia, nie samo zmienione pole", async () => {
    renderPanel(tocDefaults({ position: 3, minHeadings: 3 }));
    fireEvent.change(numberField("minHeadings"), { target: { value: "6" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    const payload = writeChains()[0]?.calls[0]?.args[0] as {
      key: string;
      value: Record<string, unknown>;
    };
    expect(payload.key).toBe(TOC_SETTING_KEY);
    expect(payload.value).toMatchObject({ minHeadings: 6, position: 3, layout: "boxed" });
  });

  it("UDANY zapis melduje sukces i wygasza przycisk (szkic zrównał się z bazą)", async () => {
    const { queryClient } = renderPanel();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.change(numberField("position"), { target: { value: "7" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: SITE_SETTINGS_QUERY_KEY });
  });

  it("NIEUDANY zapis melduje błąd i NIE gubi szkicu (praca nie przepada)", async () => {
    from().setResponse("site_settings", fail("permission denied", "42501"));
    renderPanel();
    fireEvent.change(numberField("position"), { target: { value: "7" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(numberField("position")).toHaveValue(7);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("RESET podstawia wartości domyślne w szkicu, ale NIC nie zapisuje", () => {
    renderPanel(tocDefaults({ position: 9, ordered: true }));
    // Reset jest wyłączony przy czystym szkicu (patrz przypięcie niżej), więc
    // najpierw zmiana, potem przywrócenie domyślnych.
    fireEvent.change(numberField("position"), { target: { value: "11" } });
    fireEvent.click(resetButton());
    expect(numberField("position")).toHaveValue(TOC_DEFAULTS.position);
    expect(writeChains()).toHaveLength(0);
  });

  it("PRZYWRÓCENIE DOMYŚLNYCH działa, gdy baza różni się od domyślnych", () => {
    // Reset pyta o różnicę wobec WARTOŚCI DOMYŚLNYCH, zapis - wobec bazy.
    // Wcześniej oba dzieliły warunek zapisu, więc administrator z zapisanym
    // `position: 9` nie miał jak wrócić do domyślnej trójki: szkic był czysty,
    // a przycisk wyłączony.
    renderPanel(tocDefaults({ position: 9 }));
    expect(saveButton()).toBeDisabled();
    expect(resetButton()).not.toBeDisabled();
    fireEvent.click(resetButton());
    expect(numberField("position")).toHaveValue(TOC_DEFAULTS.position);
    expect(saveButton()).not.toBeDisabled();
  });

  it("szkic RÓWNY domyślnym wyłącza reset - nie ma czego przywracać", () => {
    renderPanel(tocDefaults());
    expect(resetButton()).toBeDisabled();
    expect(saveButton()).toBeDisabled();
  });

  it("przełącznik oddaje intencję do szkicu (widoczność globalna spisu treści)", () => {
    renderPanel(tocDefaults({ enabled: true }));
    const enabled = toggle("enabled");
    expect(enabled).toHaveAttribute("aria-checked", "true");
    fireEvent.click(enabled);
    expect(toggle("enabled")).toHaveAttribute("aria-checked", "false");
  });

  it("wybór karty kolumn zmienia szkic i przenosi stan wyboru", () => {
    renderPanel(tocDefaults({ columns: "col-1" }));
    fireEvent.click(screen.getByRole("button", { name: "admin.toc.columnsOption.half.label" }));
    expect(
      screen.getByRole("button", { name: "admin.toc.columnsOption.half.label" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "admin.toc.columnsOption.col-1.label" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("KAŻDY przełącznik sekcji ogólnej trafia do szkicu pod swoim kluczem", async () => {
    renderPanel(tocDefaults({ sticky: false, showInBody: false, ordered: false }));
    fireEvent.click(toggle("sticky"));
    fireEvent.click(toggle("showInBody"));
    fireEvent.click(toggle("ordered"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    const payload = writeChains()[0]?.calls[0]?.args[0] as { value: Record<string, unknown> };
    expect(payload.value).toMatchObject({ sticky: true, showInBody: true, ordered: true });
    expect(payload.value.enabled).toBe(true);
  });

  it("zmiana układu i GÓRNEJ granicy poziomu trafia do szkicu", async () => {
    renderPanel(tocDefaults({ layout: "boxed", maxLevel: 3 }));
    fireEvent.change(selectField("layout"), { target: { value: "sticky-sidebar" } });
    fireEvent.change(selectField("maxLevel"), { target: { value: "5" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    const payload = writeChains()[0]?.calls[0]?.args[0] as { value: Record<string, unknown> };
    expect(payload.value).toMatchObject({ layout: "sticky-sidebar", maxLevel: 5 });
    expect(selectField("layout")).toHaveValue("sticky-sidebar");
  });

  it("tytuł spisu treści jest edytowalny OSOBNO w każdym języku", async () => {
    renderPanel(tocDefaults({ titlePl: "Spis", titleEn: "Contents" }));
    fireEvent.change(screen.getByRole("textbox", { name: "admin.toc.titlePl" }), {
      target: { value: "Plan artykułu" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "admin.toc.titleEn" }), {
      target: { value: "Article plan" },
    });
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    const payload = writeChains()[0]?.calls[0]?.args[0] as { value: Record<string, unknown> };
    expect(payload.value).toMatchObject({ titlePl: "Plan artykułu", titleEn: "Article plan" });
  });

  it("wybór koloru wchodzi do ZAGNIEŻDŻONEJ mapy kolorów, nie na wierzch szkicu", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "admin.toc.colorField.accent" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    const payload = writeChains()[0]?.calls[0]?.args[0] as {
      value: { colors: Record<string, string> };
    };
    expect(payload.value.colors.accent).toBe("#101010");
    expect(payload.value.colors.bg).toBe(TOC_DEFAULTS.colors.bg);
  });
});

describe("TocSettingsPanel - podgląd na żywo", () => {
  const previewNav = () => screen.getByRole("navigation");

  it("podgląd bierze tytuł z pola w języku wybranej zakładki", () => {
    renderPanel(tocDefaults({ titlePl: "Spis treści", titleEn: "Contents" }));
    expect(previewNav()).toHaveAccessibleName("Spis treści");
    // Radix przełącza zakładkę na `mousedown`, nie na złożonym `click`.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "EN" }));
    expect(previewNav()).toHaveAccessibleName("Contents");
  });

  it("zakładki podglądu mają NAZWĘ GRUPY (kopie miały tylko emoji flagi)", () => {
    renderPanel();
    expect(screen.getByRole("tablist", { name: "admin.toc.previewLang" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("wyłączony spis treści zastępuje podgląd komunikatem, nie pustym miejscem", () => {
    renderPanel(tocDefaults({ enabled: false }));
    expect(screen.getByText("admin.toc.previewDisabled")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("wyłączenie w SZKICU natychmiast gasi podgląd (bez zapisu)", () => {
    renderPanel(tocDefaults({ enabled: true }));
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    fireEvent.click(toggle("enabled"));
    expect(screen.getByText("admin.toc.previewDisabled")).toBeInTheDocument();
  });

  it("numeracja zmienia ZNACZNIK listy podglądu, nie tylko klasę", () => {
    renderPanel(tocDefaults({ ordered: true }));
    expect(previewNav().querySelector("ol")).not.toBeNull();
    expect(previewNav().querySelector("ul")).toBeNull();
  });

  it("zakres poziomów przycina liczbę pozycji podglądu", () => {
    renderPanel(tocDefaults({ minLevel: 1, maxLevel: 3 }));
    expect(within(previewNav()).getAllByRole("listitem")).toHaveLength(6);
    fireEvent.change(selectField("minLevel"), { target: { value: "3" } });
    expect(within(previewNav()).getAllByRole("listitem")).toHaveLength(2);
  });

  it("każda pozycja podglądu prowadzi do kotwicy nagłówka", () => {
    renderPanel();
    const links = within(previewNav()).getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((a) => (a as HTMLAnchorElement).getAttribute("href")?.startsWith("#"))).toBe(
      true,
    );
  });

  it("wariant `half` i tryb `sticky` schodzą na klasy opakowania podglądu", () => {
    renderPanel(tocDefaults({ columns: "half", sticky: true }));
    expect(previewNav().className).toContain("md:max-w-[50%]");
    expect(previewNav().className).toContain("lg:sticky");
  });

  it("układ `inline` gubi ramkę podglądu, `boxed` ją ma", () => {
    renderPanel(tocDefaults({ layout: "inline" }));
    // happy-dom rozwija skrót `border`, stąd porównanie przez zawieranie.
    expect(previewNav().style.border).toContain("none");
    expect(previewNav().style.border).not.toContain("solid");
    expect(previewNav().className).not.toContain("rounded-lg");
  });

  it("kolory szkicu trafiają do zmiennych CSS podglądu", () => {
    renderPanel(tocDefaults({ colors: { ...TOC_DEFAULTS.colors, bg: "#123456" } }));
    expect(previewNav().style.getPropertyValue("--toc-bg")).toBe("#123456");
    expect(previewNav().style.background).toContain("#123456");
  });

  it("najechanie na pozycję zmienia kolor na akcent, zjechanie go cofa", () => {
    renderPanel(tocDefaults({ colors: { ...TOC_DEFAULTS.colors, accent: "#ff0000" } }));
    const link = within(previewNav()).getAllByRole("link")[0] as HTMLAnchorElement;
    fireEvent.mouseEnter(link);
    expect(link.style.color).toBe("#ff0000");
    fireEvent.mouseLeave(link);
    expect(link.style.color).toBe("inherit");
  });
});
