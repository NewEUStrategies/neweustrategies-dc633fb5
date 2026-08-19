// Panel globalnych ustawień sekcji „Z tego artykułu dowiesz się…" - CAŁY.
//
// STAN WYJŚCIOWY: `src/routes/admin.key-takeaways.tsx` miał 547 linii i 0 z 42
// funkcji pokrytych, a przy tym 31 rozgałęzień tekstu po języku wprost w JSX -
// niewidocznych dla bramki `check:i18n-hardcoded`, bo jej wzorzec zna zmienną
// `isPl`, nie `isPL`.
//
// CZEGO PILNUJE TEN PLIK: co widać (jedenaście pól koloru, dwanaście ikon, trzy
// warianty), co ogłasza stan wyboru, co jest wyłączone, co idzie do bazy pod
// kluczem `key_takeaways` i czy podgląd nadąża za szkicem BEZ zapisu.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

// Fabryka importuje `@/test/i18nStub` - moduł BEZ importów z produkcji.
// Sięgnięcie tu po fixture'y obszaru domyka cykl inicjalizacji (fixture'y ->
// warstwa ustawień -> lib/i18n -> react-i18next -> ta fabryka) i ZAWIESZA plik.
vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

// Ikony Lucide wchodzą przez rejestr wygenerowany z paczki; tutaj liczy się
// wyłącznie to, KTÓRA pozycja siatki jest wybrana, nie jak wygląda glif.
vi.mock("@/lib/icons/DynamicIcon", () => ({
  DynamicIcon: ({ name }: { name: string }) => <svg data-icon={name} aria-hidden="true" />,
}));

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

import { KeyTakeawaysSettingsPanel } from "@/components/admin/postExperience/organisms/KeyTakeawaysSettingsPanel";
import {
  KEY_TAKEAWAYS_DEFAULTS,
  KEY_TAKEAWAYS_SETTING_KEY,
  type KeyTakeawaysSettings,
} from "@/lib/keyTakeaways/settings";
import { KEY_TAKEAWAYS_ICON_CHOICES } from "@/lib/keyTakeaways/panelRules";
import {
  SITE_SETTINGS_QUERY_KEY,
  fail,
  ok,
  type SupabaseFromStub,
} from "@/test/postExperience/fixtures";
import { resetPendingWrites } from "@/lib/useSiteSetting";

const from = () => stubs.from as SupabaseFromStub;

const settings = (over: Partial<KeyTakeawaysSettings> = {}): KeyTakeawaysSettings => ({
  ...KEY_TAKEAWAYS_DEFAULTS,
  ...over,
});

function renderPanel(persisted?: Partial<KeyTakeawaysSettings>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(SITE_SETTINGS_QUERY_KEY, {
    [KEY_TAKEAWAYS_SETTING_KEY]: settings(persisted),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...render(<KeyTakeawaysSettingsPanel />, { wrapper }) };
}

/** Łańcuch ZAPISU, odsiany od odświeżenia mapy ustawień (patrz panel ToC). */
const writeChains = () =>
  from()
    .chainsFor("site_settings")
    .filter((chain) => chain.calls.some((call) => call.method === "upsert"));

const savedValue = () =>
  (writeChains()[0]?.calls[0]?.args[0] as { key: string; value: KeyTakeawaysSettings }).value;

const saveButton = () => screen.getByRole("button", { name: /keyTakeaways\.(save|saving)/ });
const resetButton = () => screen.getByRole("button", { name: /keyTakeaways\.reset/ });

beforeEach(() => {
  vi.clearAllMocks();
  from().reset();
  resetPendingWrites();
  from().setResponse("site_settings", ok(null));
});

describe("KeyTakeawaysSettingsPanel - co widać", () => {
  it("tytuł strony jest nagłówkiem pierwszego poziomu, a sekcje formularza nagłówkami niższymi", () => {
    renderPanel();
    expect(
      screen.getByRole("heading", { level: 1, name: "adminPostPanes.keyTakeaways.pageTitle" }),
    ).toBeInTheDocument();
    const sub = screen.getAllByRole("heading", { level: 3 }).map((n) => n.textContent);
    expect(sub).toEqual(
      expect.arrayContaining([
        "adminPostPanes.keyTakeaways.variantHeading",
        "adminPostPanes.keyTakeaways.labelHeading",
        "adminPostPanes.keyTakeaways.iconHeading",
        "adminPostPanes.keyTakeaways.colorsHeading",
      ]),
    );
  });

  it("TRZY warianty wizualne, wybrany ogłoszony przez `aria-pressed`", () => {
    renderPanel({ variant: "ghost" });
    const ghost = screen.getByRole("button", {
      name: /variant\.ghost\.badge - adminPostPanes\.keyTakeaways\.variant\.ghost\.desc/,
    });
    expect(ghost).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /variant\.card\.badge/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("DWANAŚCIE ikon w siatce, każda z własną nazwą, wybrana ogłoszona", () => {
    renderPanel({ icon: "lightbulb" });
    const icons = KEY_TAKEAWAYS_ICON_CHOICES.map((name) => screen.getByRole("button", { name }));
    expect(icons).toHaveLength(12);
    expect(screen.getByRole("button", { name: "lightbulb" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("DOMYŚLNA ikona `Search` jest zaznaczona w siatce pisanej kebab-case", () => {
    renderPanel({ icon: "Search" });
    expect(screen.getByRole("button", { name: "search" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "star" })).toHaveAttribute("aria-pressed", "false");
  });

  it("JEDENAŚCIE pól koloru, każde z nazwą i wartością z ustawień", () => {
    renderPanel({ colors: { ...KEY_TAKEAWAYS_DEFAULTS.colors, accent: "#abcdef" } });
    const pickers = screen.getAllByRole("button", {
      name: /adminPostPanes\.keyTakeaways\.colorField\./,
    });
    expect(pickers).toHaveLength(11);
    expect(
      screen.getByRole("button", { name: "adminPostPanes.keyTakeaways.colorField.accent" }),
    ).toHaveAttribute("data-color", "#abcdef");
  });

  it("pola koloru ramki z PUSTĄ wartością pokazują `transparent`, nie puste okienko", () => {
    renderPanel({ colors: { ...KEY_TAKEAWAYS_DEFAULTS.colors, border: "" } });
    expect(
      screen.getByRole("button", { name: "adminPostPanes.keyTakeaways.colorField.border" }),
    ).toHaveAttribute("data-color", "transparent");
    expect(
      screen.getByRole("button", { name: "adminPostPanes.keyTakeaways.colorField.borderDark" }),
    ).toHaveAttribute("data-color", "transparent");
  });

  it("etykieta ma osobne pole na każdy język, z wartością z bazy", () => {
    renderPanel({ labelPl: "Dowiesz się", labelEn: "You will learn" });
    expect(
      screen.getByRole("textbox", { name: "adminPostPanes.keyTakeaways.labelPl" }),
    ).toHaveValue("Dowiesz się");
    expect(
      screen.getByRole("textbox", { name: "adminPostPanes.keyTakeaways.labelEn" }),
    ).toHaveValue("You will learn");
  });

  it("SUWAKI mają STAŁĄ nazwę i osobny odczyt wartości", () => {
    // Kopia w pliku trasy wpisywała wartość w tekst etykiety
    // („Rozmiar napisu (1.25x)"), więc nazwa kontrolki zmieniała się przy każdym
    // ruchu suwaka - czytnik ekranu ogłaszał nową nazwę pola, nie nową wartość.
    renderPanel({ highlight: { ...KEY_TAKEAWAYS_DEFAULTS.highlight, sizeScale: 1.25 } });
    const slider = screen.getByRole("slider", {
      name: "adminPostPanes.keyTakeaways.highlightSize",
    });
    expect(slider).toHaveValue("1.25");
    expect(screen.getByText("1.25×")).toBeInTheDocument();
  });

  it("NIEPOPRAWNY wiersz w bazie degraduje do wartości domyślnych", () => {
    renderPanel({ variant: "wymyslony" as never });
    expect(screen.getByRole("button", { name: /variant\.card\.badge/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "search" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("KeyTakeawaysSettingsPanel - chipy podświetlenia słów", () => {
  it("każde słowo etykiety dostaje chip, osobno dla PL i EN", () => {
    renderPanel({ labelPl: "Z tego dowiesz", labelEn: "You will learn" });
    expect(screen.getByRole("button", { name: "tego" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "learn" })).toBeInTheDocument();
  });

  it("podświetlone słowo ogłasza `aria-pressed`, niepodświetlone nie", () => {
    renderPanel({
      labelPl: "Z tego",
      highlight: { ...KEY_TAKEAWAYS_DEFAULTS.highlight, indicesPl: [1] },
    });
    expect(screen.getByRole("button", { name: "tego" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Z" })).toHaveAttribute("aria-pressed", "false");
  });

  it("kliknięcie chipa dorzuca indeks, drugie kliknięcie go zdejmuje", async () => {
    renderPanel({ labelPl: "Z tego", labelEn: "" });
    fireEvent.click(screen.getByRole("button", { name: "tego" }));
    expect(screen.getByRole("button", { name: "tego" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "tego" }));
    expect(screen.getByRole("button", { name: "tego" })).toHaveAttribute("aria-pressed", "false");
  });

  it("indeksy jadą do bazy w kolejności ROSNĄCEJ, niezależnie od kolejności klikania", async () => {
    renderPanel({ labelPl: "Zero jeden dwa", labelEn: "" });
    fireEvent.click(screen.getByRole("button", { name: "dwa" }));
    fireEvent.click(screen.getByRole("button", { name: "Zero" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedValue().highlight.indicesPl).toEqual([0, 2]);
    expect(savedValue().highlight.indicesEn).toEqual([]);
  });

  it("podświetlenie PL nie przecieka na EN", async () => {
    renderPanel({ labelPl: "Z tego", labelEn: "From this" });
    fireEvent.click(screen.getByRole("button", { name: "tego" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedValue().highlight.indicesPl).toEqual([1]);
    expect(savedValue().highlight.indicesEn).toEqual([]);
  });

  it("PUSTA etykieta nie rysuje żadnego chipa (przycisk bez nazwy byłby nieużywalny)", () => {
    renderPanel({ labelPl: "", labelEn: "" });
    expect(screen.queryByText("adminPostPanes.keyTakeaways.highlightWords.pl")).toBeNull();
    expect(screen.queryByText("adminPostPanes.keyTakeaways.highlightWords.en")).toBeNull();
  });

  it("skrót wyzerowania przesunięcia wraca do zera i nie rusza pozostałych pól", async () => {
    renderPanel({ highlight: { ...KEY_TAKEAWAYS_DEFAULTS.highlight, offsetY: -80, sizeScale: 2 } });
    fireEvent.click(
      screen.getByRole("button", { name: "adminPostPanes.keyTakeaways.highlightOffsetReset" }),
    );
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedValue().highlight.offsetY).toBe(0);
    expect(savedValue().highlight.sizeScale).toBe(2);
  });
});

describe("KeyTakeawaysSettingsPanel - co jest wyłączone i co idzie do bazy", () => {
  it("BEZ ZMIAN zapis i reset są wyłączone", () => {
    renderPanel();
    expect(saveButton()).toBeDisabled();
    expect(resetButton()).toBeDisabled();
  });

  it("etykieta EN jest edytowalna OSOBNO i idzie do bazy obok polskiej", async () => {
    renderPanel({ labelPl: "Dowiesz sie", labelEn: "You will learn" });
    fireEvent.change(screen.getByRole("textbox", { name: "adminPostPanes.keyTakeaways.labelEn" }), {
      target: { value: "What you get" },
    });
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedValue().labelEn).toBe("What you get");
    expect(savedValue().labelPl).toBe("Dowiesz sie");
  });

  it("zmiana odblokowuje zapis, powrót do wartości z bazy znowu go wyłącza", () => {
    renderPanel({ labelPl: "Dowiesz się" });
    const field = screen.getByRole("textbox", { name: "adminPostPanes.keyTakeaways.labelPl" });
    fireEvent.change(field, { target: { value: "Inaczej" } });
    expect(saveButton()).not.toBeDisabled();
    fireEvent.change(field, { target: { value: "Dowiesz się" } });
    expect(saveButton()).toBeDisabled();
  });

  it("zapis to UPSERT z jawnym konfliktem `tenant_id,key` pod kluczem sekcji", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "star" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    const chain = writeChains()[0];
    expect(chain?.calls[0]?.args[1]).toEqual({ onConflict: "tenant_id,key" });
    expect((chain?.calls[0]?.args[0] as { key: string }).key).toBe(KEY_TAKEAWAYS_SETTING_KEY);
  });

  it("do bazy idzie CAŁY szkic, także pola nietknięte w tej sesji", async () => {
    renderPanel({ labelPl: "Dowiesz się", icon: "search" });
    fireEvent.click(screen.getByRole("button", { name: "flag" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedValue()).toMatchObject({ icon: "flag", labelPl: "Dowiesz się", enabled: true });
    expect(savedValue().colors.bg).toBe(KEY_TAKEAWAYS_DEFAULTS.colors.bg);
  });

  it("kolor wchodzi do ZAGNIEŻDŻONEJ mapy, nie na wierzch szkicu", async () => {
    renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "adminPostPanes.keyTakeaways.colorField.iconBg" }),
    );
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedValue().colors.iconBg).toBe("#101010");
    expect(savedValue().colors.icon).toBe(KEY_TAKEAWAYS_DEFAULTS.colors.icon);
  });

  it("grubość ramki jest LICZBĄ w mapie kolorów, nie barwą", async () => {
    renderPanel();
    fireEvent.change(
      screen.getByRole("slider", { name: "adminPostPanes.keyTakeaways.borderWidth" }),
      { target: { value: "4" } },
    );
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedValue().colors.borderWidth).toBe(4);
    expect(typeof savedValue().colors.borderWidth).toBe("number");
  });

  it("mnożnik rozmiaru zachowuje UŁAMEK - suwak nie zamienia się w przełącznik", async () => {
    renderPanel();
    fireEvent.change(
      screen.getByRole("slider", { name: "adminPostPanes.keyTakeaways.highlightSize" }),
      { target: { value: "1.35" } },
    );
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedValue().highlight.sizeScale).toBe(1.35);
    expect(Number.isInteger(savedValue().highlight.sizeScale)).toBe(false);
  });

  it("przesunięcie UJEMNE przechodzi bez zmiany znaku", async () => {
    renderPanel();
    fireEvent.change(
      screen.getByRole("slider", { name: "adminPostPanes.keyTakeaways.highlightOffset" }),
      { target: { value: "-120" } },
    );
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedValue().highlight.offsetY).toBe(-120);
    expect(savedValue().highlight.sizeScale).toBe(1);
  });

  it("nazwa ikony wpisana z ręki trafia do szkicu tak jak wybór z siatki", async () => {
    renderPanel();
    fireEvent.change(
      screen.getByRole("textbox", { name: "adminPostPanes.keyTakeaways.iconNameLabel" }),
      { target: { value: "rocket" } },
    );
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedValue().icon).toBe("rocket");
    expect(screen.getByRole("button", { name: "search" })).toHaveAttribute("aria-pressed", "false");
  });

  it("UDANY zapis melduje sukces i unieważnia mapę ustawień", async () => {
    const { queryClient } = renderPanel();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "info" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: SITE_SETTINGS_QUERY_KEY });
  });

  it("NIEUDANY zapis melduje błąd i NIE gubi szkicu", async () => {
    from().setResponse("site_settings", fail("permission denied", "42501"));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "target" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "target" })).toHaveAttribute("aria-pressed", "true");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("RESET podstawia wartości domyślne i NIC nie zapisuje", () => {
    renderPanel({ icon: "flag" });
    fireEvent.click(screen.getByRole("button", { name: "star" }));
    fireEvent.click(resetButton());
    expect(screen.getByRole("button", { name: "search" })).toHaveAttribute("aria-pressed", "true");
    expect(writeChains()).toHaveLength(0);
  });

  it("wyłączenie widoczności globalnej trafia do szkicu", async () => {
    renderPanel({ enabled: true });
    fireEvent.click(screen.getByRole("switch", { name: /adminPostPanes\.keyTakeaways\.enabled/ }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedValue().enabled).toBe(false);
    expect(savedValue().variant).toBe(KEY_TAKEAWAYS_DEFAULTS.variant);
  });
});

describe("KeyTakeawaysSettingsPanel - podgląd na żywo", () => {
  it("zakładki języka i wariantu podglądu mają NAZWY GRUP", () => {
    renderPanel();
    expect(
      screen.getByRole("tablist", { name: "adminPostPanes.keyTakeaways.previewLang" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: "adminPostPanes.keyTakeaways.previewVariant" }),
    ).toBeInTheDocument();
  });

  it("podgląd startuje na wariancie ZAPISANYM, nie zawsze na pierwszym", () => {
    renderPanel({ variant: "ghost" });
    const variants = screen.getByRole("tablist", {
      name: "adminPostPanes.keyTakeaways.previewVariant",
    });
    expect(within(variants).getByRole("tab", { name: "C" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(variants).getByRole("tab", { name: "A" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("wybór wariantu w formularzu PRZESTAWIA także zakładkę podglądu", () => {
    renderPanel({ variant: "card" });
    fireEvent.click(screen.getByRole("button", { name: /variant\.heading\.badge/ }));
    const variants = screen.getByRole("tablist", {
      name: "adminPostPanes.keyTakeaways.previewVariant",
    });
    expect(within(variants).getByRole("tab", { name: "B" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: /variant\.heading\.badge/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("zakładka podglądu zmienia wariant BEZ zmiany ustawienia (nic nie leci do bazy)", () => {
    renderPanel({ variant: "card" });
    const variants = screen.getByRole("tablist", {
      name: "adminPostPanes.keyTakeaways.previewVariant",
    });
    fireEvent.mouseDown(within(variants).getByRole("tab", { name: "C" }));
    expect(within(variants).getByRole("tab", { name: "C" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(saveButton()).toBeDisabled();
  });

  it("podgląd bierze etykietę z pola w języku wybranej zakładki", () => {
    renderPanel({ labelPl: "Dowiesz sie z tego", labelEn: "You will learn" });
    expect(screen.getByText("Dowiesz sie z tego")).toBeInTheDocument();
    const langs = screen.getByRole("tablist", {
      name: "adminPostPanes.keyTakeaways.previewLang",
    });
    fireEvent.mouseDown(within(langs).getByRole("tab", { name: "EN" }));
    expect(screen.getByText("You will learn")).toBeInTheDocument();
  });

  it("zmiana etykiety w formularzu natychmiast przechodzi do podglądu", () => {
    renderPanel({ labelPl: "Stara" });
    fireEvent.change(screen.getByRole("textbox", { name: "adminPostPanes.keyTakeaways.labelPl" }), {
      target: { value: "Nowa etykieta" },
    });
    expect(screen.getByText("Nowa etykieta")).toBeInTheDocument();
    expect(screen.queryByText("Stara")).toBeNull();
  });

  it("wyłączenie sekcji GASI podgląd (ten sam komponent co strona publiczna)", () => {
    renderPanel({ enabled: true, labelPl: "Dowiesz sie" });
    expect(screen.getByText("Dowiesz sie")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: /adminPostPanes\.keyTakeaways\.enabled/ }));
    expect(screen.queryByText("Dowiesz sie")).toBeNull();
  });

  it("podgląd pokazuje TRZY przykładowe punkty z klucza, nie tekst z kodu", () => {
    renderPanel();
    for (const key of [
      "adminPostPanes.keyTakeaways.sample.first",
      "adminPostPanes.keyTakeaways.sample.second",
      "adminPostPanes.keyTakeaways.sample.third",
    ]) {
      expect(screen.getByText(new RegExp(key))).toBeInTheDocument();
    }
    expect(screen.getByText("adminPostPanes.keyTakeaways.previewNote")).toBeInTheDocument();
  });
});
