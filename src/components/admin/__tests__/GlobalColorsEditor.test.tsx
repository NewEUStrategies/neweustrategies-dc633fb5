// EDYTOR KOLORÓW GLOBALNYCH - `GlobalColorsEditor` (Wygląd → Opcje motywu).
//
// CO TU JEST PRZYPINANE I DLACZEGO. Ten panel jest jedynym miejscem, w którym
// redakcja ustawia tokeny `--gc-*` dla CAŁEJ witryny: draft leci natychmiast do
// `<style data-global-colors-preview>` na stronie panelu, a po zapisie do
// `site_design_tokens`. Pomyłka nie kończy się brzydkim polem, tylko kolorem
// tła, tekstu albo przycisku na produkcji. Dlatego KAŻDY test renderuje panel,
// wykonuje interakcję (klik, wpisanie, przełączenie zakładki, skrót klawiszowy)
// i sprawdza SKUTEK - wartość pola, treść wygenerowanego CSS, argument mutacji
// zapisu albo wpis w localStorage - a nie samą obecność węzła.
//
// OSIEM KONTRAKTÓW, PO JEDNYM `describe` NA KAŻDY:
//   1. STANY WEJŚCIOWE: ładowanie i brak danych zatrzymują panel na komunikacie
//      (draft nie powstaje, nie ma ani jednej zakładki), pusta konfiguracja
//      pokazuje wartości domyślne jako PODPOWIEDZI (a nie jako wartości), a
//      zapisana konfiguracja wypełnia pola i buduje CSS podglądu.
//   2. `ColorRow`: trzy drogi ustawienia koloru (picker, próbka palety marki,
//      próbka „ostatnio użyte”) oraz rejestr ostatnio użytych - z deduplikacją,
//      limitem 10 i bramką `isHexColor` (wartość nie-hex NIE wchodzi do listy).
//   3. `TypographyRow` + `bumpFontSize`: krok zależy od jednostki (px = 1,
//      rem/em/% = 0,125), brak jednostki znaczy px, wartości nieliczbowej nie
//      rusza, a wynik nigdy nie schodzi poniżej zera.
//   4. `FormatRow`: grubość, kursywa i podkreślenie jako PRZEŁĄCZNIKI (drugie
//      kliknięcie zdejmuje), plus zbiorcze czyszczenie.
//   5. `BrandPaletteEditor`: dodanie, edycja, usunięcie i anulowanie - paleta
//      żyje w localStorage przeglądarki, więc asercje idą po localStorage.
//   6. HISTORIA I ZAPIS: undo/redo/anuluj, skróty ⌘/Ctrl+Z, +Shift+Z, +Y, +S,
//      trzy bramki `handleSave` (brak draftu, brak zmian, zapis w toku) oraz
//      zachowanie stanu przy nieudanym zapisie.
//   7. ZAKŁADKI I PODGLĄD: każda grupa z `GLOBAL_COLOR_GROUPS` renderuje własny
//      `SlotPreview`, a `getColor` schodzi po łańcuchu tryb → light → domyślne
//      → kolor awaryjny.
//   8. JĘZYK PANELU: etykiety kategorii i grup nie idą przez `t()`, tylko przez
//      `useBuilderLabel` (słownik `BUILDER_LABELS_EN`), więc PL i EN to dwa
//      OSOBNE przypadki z asercją na tekst ze słownika.
//   + REJESTR DEFEKTÓW (trzy `it.fails` na dole pliku, z opisem mechanizmu):
//      flaga `skipHistoryRef` po „Anuluj” nigdy nie zostaje skonsumowana, więc
//      pierwsza późniejsza zmiana wypada z historii; a oba przyciski „Wyczyść”
//      wołają `setSlotMeta` kilka razy w jednym handlerze, przez co zostaje
//      wyłącznie ostatnie wywołanie.
//
// GRANICE ATRAP. Panel czyta i zapisuje przez DWA haki - `useGlobalColors` /
// `useSaveGlobalColors` (kolory) oraz `useSettings("theme_options")` (styl
// sidebara i logotypy) - i to jest granica atrap; niżej leżą Supabase i
// react-query, których ten plik nie dotyka. `AdminColorPicker` (popover z kanwą
// HSL) i `ImageSlot` (upload do Storage) mają własnych właścicieli i są tu
// lekkimi atrapami wystawiającymi swój kontrakt jako `<input>`. i18n jest echem
// klucza (`src/test/i18nStub`), bo w tym panelu liczy się logika, nie napis -
// asercje na klucz z parametrami są przy tym MOCNIEJSZE niż na przetłumaczony
// tekst (widać w nich np. `count=2` przekazane do tytułu palety). Wyjątkiem
// jest `useBuilderLabel` - NIE jest atrapowany, bo etykiety kategorii i grup
// biorą się z prawdziwego słownika `BUILDER_LABELS_EN`, a nie z `t()`; dlatego
// kontrakt 8 mierzy słownik, a nie kopię napisu. Nakładka
// `@/lib/i18n-admin-global-colors-editor` jest wygaszona, bo dociąga prawdziwe
// `@/lib/i18n` (dynamiczny import słowników) - w atrapie i18n nie miałaby komu
// oddać zasobów.
//
// DETERMINIZM. `useLocalStorageState` czyta localStorage przy pierwszym
// renderze i zapisuje przy każdej zmianie, więc każdy test startuje z czystym
// magazynem, a testy zależne od zawartości palety same ją tam sadzą. Zero
// zegara, zero losowości, zero wyjścia do sieci.
//
// CZEGO NIE DA SIĘ TU DOSIĘGNĄĆ (zmierzone: 100% linii i funkcji, 97,9% gałęzi
// razem z `GlobalColorsEditor.catalog.test.tsx`). Zostaje sześć gałęzi bez
// drogi dojścia z interfejsu: strażnik SSR `typeof window === "undefined"` w
// `useLocalStorageState` (happy-dom zawsze ma `window`), `if (cur)` w `undo` i
// `redo` (draft nie bywa pusty, gdy historia nie jest pusta), `(current || "")`
// w `bumpFontSize` (wołane zawsze z niepustym ciągiem) oraz dwie bramki
// `commit` w `BrandPaletteEditor` - `if (!isHexColor(v))` i domyślna gałąź
// `if (adding) … else if (editingIdx !== null)` - bo przycisk zatwierdzenia
// jest wyłączony dokładnie wtedy, gdy któraś z nich mogłaby zadziałać.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { GlobalColorsValue } from "@/lib/builder/globalColors";

/** Propy, które panel przekazuje atrapie `AdminColorPicker`. */
interface PickerProbeProps {
  value?: string;
  onChange: (v: string | undefined) => void;
  inheritedValue?: string;
  placeholder?: string;
}

/** Propy, które `SidebarStylePicker` przekazuje atrapie `ImageSlot`. */
interface ImageSlotProbeProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  folder?: string;
}

/** Wycinek `theme_options`, którego dotyka zakładka „Sidebar”. */
interface ThemeOptsProbe {
  sidebars?: { style?: string };
  logo?: Record<string, string>;
}

// Stan sterujący atrapami. `vi.hoisted`, bo fabryki `vi.mock` są wynoszone nad
// importy i nie mogą domykać się na zwykłych zmiennych modułu.
const h = vi.hoisted(() => ({
  /** Język panelu - czytany getterem, jak realna instancja i18next. */
  language: "pl",
  /** Odpowiedź `useGlobalColors`. */
  colors: {} as GlobalColorsValue,
  hasData: true,
  isLoading: false,
  /** `useSaveGlobalColors`. */
  savePending: false,
  saveFails: false,
  saves: [] as GlobalColorsValue[],
  /** `useSettings("theme_options")`. */
  themeData: null as ThemeOptsProbe | null,
  themePending: false,
  themeSaves: [] as ThemeOptsProbe[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);

// Nakładka i18n panelu dociąga prawdziwe `@/lib/i18n` - przy atrapie
// `react-i18next` nie ma komu oddać zasobów, więc gaśnie w całości.
vi.mock("@/lib/i18n-admin-global-colors-editor", () => ({}));

// Granica danych #1: kolory globalne. `mutate` odwzorowuje kontrakt prawdziwego
// haka - po sukcesie ODŚWIEŻA źródło (query cache), więc panel przestaje być
// „brudny”; przy porażce nie woła `onSuccess` i nie rusza źródła.
vi.mock("@/hooks/useGlobalColors", () => ({
  useGlobalColors: () => ({
    data: h.hasData ? h.colors : undefined,
    isLoading: h.isLoading,
  }),
  useSaveGlobalColors: () => ({
    isPending: h.savePending,
    mutate: (next: GlobalColorsValue, options?: { onSuccess?: () => void }) => {
      h.saves.push(JSON.parse(JSON.stringify(next)) as GlobalColorsValue);
      if (h.saveFails) return;
      h.colors = next;
      options?.onSuccess?.();
    },
  }),
}));

// Granica danych #2: `site_settings.theme_options` (styl sidebara + logotypy).
vi.mock("@/lib/admin/useSettings", () => ({
  useSettings: () => ({
    query: { data: h.themeData ?? undefined },
    save: {
      isPending: h.themePending,
      mutate: (next: ThemeOptsProbe) => {
        h.themeSaves.push(next);
      },
    },
  }),
}));

// Picker koloru to popover z kanwą HSL i trzema notacjami - tu liczy się
// wyłącznie kontrakt wartości, więc wystawiamy go jako pole tekstowe. Puste
// pole oddaje `undefined`, bo tak robi oryginał (i tę gałąź panel obsługuje).
vi.mock("@/components/admin/blocks/AdminColorPicker", () => ({
  AdminColorPicker: ({ value, onChange, inheritedValue, placeholder }: PickerProbeProps) => (
    <input
      data-testid="gc-picker"
      data-inherited={inheritedValue ?? ""}
      placeholder={placeholder ?? ""}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
    />
  ),
}));

// `ImageSlot` wysyła plik do Storage i ma własnego właściciela - atrapa
// potwierdza wyłącznie przekazane propy i pozwala wywołać zmianę wartości.
vi.mock("@/components/admin/ImageSlot", () => ({
  ImageSlot: (props: ImageSlotProbeProps) => (
    <input
      data-testid="image-slot"
      data-hint={props.hint ?? ""}
      data-folder={props.folder ?? ""}
      aria-label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
}));

import { GlobalColorsEditor } from "@/components/admin/GlobalColorsEditor";
import { GLOBAL_COLOR_GROUPS } from "@/lib/builder/globalColors";
import { SIDEBAR_STYLES } from "@/lib/builder/sidebarStyles";
import { BRAND_PALETTE_STORAGE_KEY, RECENT_COLORS_STORAGE_KEY } from "@/lib/storageKeys";

const BRAND_KEY = BRAND_PALETTE_STORAGE_KEY.key;
const RECENT_KEY = RECENT_COLORS_STORAGE_KEY.key;

/** Domyślny font slotów typograficznych - używany jako placeholder pola „Font”. */
const DEFAULT_FONT = '"Red Hat Display", "Red Hat Display Fallback", system-ui, sans-serif';

/** Dwukolorowa paleta testowa - krótsza od produkcyjnej, więc łatwiej liczyć. */
const TEST_PALETTE = [
  { name: "Atrapa A", value: "#112233" },
  { name: "Atrapa B", value: "#AABBCC" },
];

// -------------------------------------------------------------- pomocniki

function asInput(el: HTMLElement): HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) throw new Error("oczekiwano <input>");
  return el;
}

function asElement(node: Element | null, what: string): HTMLElement {
  if (!(node instanceof HTMLElement)) throw new Error(`nie znaleziono: ${what}`);
  return node;
}

/** Blok jednego slotu (etykieta + podgląd + wiersze koloru i typografii). */
function slotBlock(label: string): HTMLElement {
  return asElement(screen.getByText(label).closest("div.space-y-2"), `blok slotu ${label}`);
}

/** Pola pickera w bloku slotu, w kolejności: light, dark, hover light, hover dark. */
function pickers(scope: HTMLElement): HTMLInputElement[] {
  return within(scope).getAllByTestId("gc-picker").map(asInput);
}

/** Wiersz `ColorRow`, w którym siedzi dany picker (potrzebny do próbek palety). */
function rowOf(picker: HTMLElement): HTMLElement {
  return asElement(picker.closest("div.space-y-2"), "wiersz ColorRow");
}

/** CSS wstrzykiwany przez panel jako podgląd na żywo. */
function previewCss(): string {
  return (
    asElement(document.querySelector("style[data-global-colors-preview]"), "style podglądu")
      .textContent ?? ""
  );
}

/** Pasek narzędzi (cofnij / ponów / anuluj / zapisz) - rodzic przycisku „Cofnij”. */
function toolbar(): HTMLElement {
  const undo = screen.getByRole("button", { name: "adminGCEditor.undo" });
  return asElement(undo.parentElement, "pasek narzędzi");
}

const undoBtn = () => screen.getByRole("button", { name: "adminGCEditor.undo" });
const redoBtn = () => screen.getByRole("button", { name: "adminGCEditor.redo" });
const saveBtn = () =>
  within(toolbar()).getByRole("button", { name: /^(common\.save|adminGCEditor\.saving)$/ });
const cancelBtn = () => within(toolbar()).getByRole("button", { name: "common.cancel" });

/** Karta „Paleta marki” - zakres dla przycisków o nazwach wspólnych z paskiem. */
function paletteCard(): HTMLElement {
  return asElement(
    screen.getByText(/^adminGCEditor\.paletteTitle/).closest("div.rounded-lg"),
    "karta palety marki",
  );
}

function openTab(label: string): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name: label }));
}

function readStored(key: string): unknown {
  const raw = window.localStorage.getItem(key);
  return raw === null ? null : (JSON.parse(raw) as unknown);
}

function renderEditor() {
  return render(<GlobalColorsEditor />);
}

beforeEach(() => {
  h.language = "pl";
  h.colors = {};
  h.hasData = true;
  h.isLoading = false;
  h.savePending = false;
  h.saveFails = false;
  h.saves = [];
  h.themeData = { sidebars: {}, logo: {} };
  h.themePending = false;
  h.themeSaves = [];
  window.localStorage.clear();
  window.localStorage.setItem(BRAND_KEY, JSON.stringify(TEST_PALETTE));
});

// ==========================================================================
// KONTRAKT 1: stany wejściowe
// ==========================================================================

describe("GlobalColorsEditor - stany wejściowe", () => {
  it("w trakcie ładowania pokazuje komunikat i nie renderuje ani jednej zakładki", () => {
    h.isLoading = true;

    renderEditor();

    expect(screen.getByText("adminGCEditor.loading")).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(document.querySelector("style[data-global-colors-preview]")).toBeNull();
  });

  it("brak danych ze źródła zatrzymuje panel na komunikacie (draft nie powstaje)", () => {
    h.hasData = false;

    renderEditor();

    expect(screen.getByText("adminGCEditor.loading")).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("pusta konfiguracja renderuje komplet zakładek, a wartości domyślne są tylko podpowiedzią", () => {
    renderEditor();

    expect(screen.getAllByRole("tab")).toHaveLength(GLOBAL_COLOR_GROUPS.length);

    const [light, dark] = pickers(slotBlock("Header Icons & Menu Color"));
    // Pole jest PUSTE (slot nie ma zapisanej wartości), a kolor domyślny wchodzi
    // wyłącznie jako placeholder i wartość dziedziczona - inaczej pierwszy zapis
    // utrwaliłby domyślne odcienie jako wybór redakcji.
    expect(light.value).toBe("");
    expect(light.placeholder).toBe("#374151");
    expect(light.dataset.inherited).toBe("#374151");
    expect(dark.value).toBe("");
    expect(dark.placeholder).toBe("#e5e7eb");

    expect(saveBtn()).toBeDisabled();
    expect(cancelBtn()).toBeDisabled();
    expect(undoBtn()).toBeDisabled();
    expect(redoBtn()).toBeDisabled();
  });

  it("zapisana konfiguracja wypełnia pola i trafia do CSS podglądu", () => {
    h.colors = {
      "header-icon": {
        light: "#112233",
        dark: "#445566",
        fontFamily: "Inter, sans-serif",
        fontSize: "18px",
        fontWeight: "700",
      },
    };

    renderEditor();

    const [light, dark] = pickers(slotBlock("Header Icons & Menu Color"));
    expect(light.value).toBe("#112233");
    expect(dark.value).toBe("#445566");

    const css = previewCss();
    expect(css).toContain("--gc-header-icon: #112233;");
    expect(css).toContain("--gc-header-icon: #445566;");
    expect(css).toContain("--gc-header-icon-font: Inter, sans-serif;");
    expect(css).toContain("--gc-header-icon-size: 18px;");
    expect(css).toContain("--gc-header-icon-weight: 700;");
    // Wczytana konfiguracja to punkt odniesienia, a nie zmiana - zapis nieaktywny.
    expect(saveBtn()).toBeDisabled();
  });

  it("slot bez wartości domyślnych nie dostaje przycisku przywracania", () => {
    renderEditor();
    openTab("Button");

    const withoutDefaults = slotBlock("Primary Color (Background)");
    expect(
      within(withoutDefaults).queryByRole("button", { name: "adminGCEditor.defaultBtn" }),
    ).toBeNull();

    const withDefaults = slotBlock("Accent Color (Text)");
    expect(
      within(withDefaults).queryByRole("button", { name: "adminGCEditor.defaultBtn" }),
    ).toBeNull();
  });
});

// ==========================================================================
// KONTRAKT 2: ColorRow - trzy drogi ustawienia koloru i rejestr ostatnich
// ==========================================================================

describe("GlobalColorsEditor - wiersz koloru i ostatnio użyte", () => {
  it("wpisanie koloru w pickerze zmienia draft, CSS podglądu i odblokowuje zapis", () => {
    renderEditor();

    const [light] = pickers(slotBlock("Header Icons & Menu Color"));
    fireEvent.change(light, { target: { value: "#ff8800" } });

    expect(asInput(pickers(slotBlock("Header Icons & Menu Color"))[0]).value).toBe("#ff8800");
    expect(previewCss()).toContain("--gc-header-icon: #ff8800;");
    expect(saveBtn()).not.toBeDisabled();
    expect(cancelBtn()).not.toBeDisabled();
    expect(undoBtn()).not.toBeDisabled();
  });

  it("wyczyszczenie pola (picker oddaje undefined) zeruje wartość slotu", () => {
    h.colors = { "header-icon": { light: "#112233" } };

    renderEditor();

    const [light] = pickers(slotBlock("Header Icons & Menu Color"));
    fireEvent.change(light, { target: { value: "" } });

    expect(asInput(pickers(slotBlock("Header Icons & Menu Color"))[0]).value).toBe("");
    // Pusty slot wraca do wartości domyślnej motywu, a nie do pustego tokenu.
    expect(previewCss()).toContain("--gc-header-icon: #374151;");
  });

  it("kliknięcie próbki palety marki ustawia kolor i dopisuje go do ostatnio użytych", () => {
    renderEditor();

    const block = slotBlock("Header Icons & Menu Color");
    const row = rowOf(pickers(block)[0]);
    expect(within(row).getByText("adminGCEditor.recentEmpty")).toBeInTheDocument();

    fireEvent.click(within(row).getByTitle("Atrapa A - #112233"));

    expect(asInput(pickers(slotBlock("Header Icons & Menu Color"))[0]).value).toBe("#112233");
    expect(readStored(RECENT_KEY)).toEqual(["#112233"]);
    // Licznik pokazuje wykorzystanie limitu - to jedyna informacja o tym, że
    // lista jest skończona.
    expect(screen.getAllByText("(1/10)").length).toBeGreaterThan(0);
  });

  it("kliknięcie próbki „ostatnio użyte” ustawia kolor bez ponownego dopisywania", () => {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(["#0f0f0f", "#a1b2c3"]));

    renderEditor();

    const block = slotBlock("Header Icons & Menu Color");
    const row = rowOf(pickers(block)[0]);
    fireEvent.click(within(row).getByTitle("#a1b2c3"));

    expect(asInput(pickers(slotBlock("Header Icons & Menu Color"))[0]).value).toBe("#a1b2c3");
    // Kolor przeskakuje na początek listy, ale nie duplikuje się.
    expect(readStored(RECENT_KEY)).toEqual(["#a1b2c3", "#0f0f0f"]);
  });

  it("wartość nie będąca kolorem hex nie wchodzi do listy ostatnio użytych", () => {
    renderEditor();

    const [light] = pickers(slotBlock("Header Icons & Menu Color"));
    fireEvent.change(light, { target: { value: "var(--brand)" } });

    expect(asInput(pickers(slotBlock("Header Icons & Menu Color"))[0]).value).toBe("var(--brand)");
    expect(readStored(RECENT_KEY)).toEqual([]);
  });

  it("lista ostatnio użytych deduplikuje bez względu na wielkość liter i nie rośnie ponad 10", () => {
    const seeded = [
      "#000001",
      "#000002",
      "#000003",
      "#000004",
      "#000005",
      "#000006",
      "#000007",
      "#000008",
      "#000009",
      "#112233",
    ];
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(seeded));

    renderEditor();

    const row = rowOf(pickers(slotBlock("Header Icons & Menu Color"))[0]);
    // Paleta trzyma ten sam kolor WERSALIKAMI - po normalizacji ma zostać jeden wpis.
    fireEvent.click(within(row).getByTitle("Atrapa B - #AABBCC"));

    const after = readStored(RECENT_KEY);
    expect(after).toEqual([
      "#aabbcc",
      "#000001",
      "#000002",
      "#000003",
      "#000004",
      "#000005",
      "#000006",
      "#000007",
      "#000008",
      "#000009",
    ]);

    fireEvent.click(
      within(rowOf(pickers(slotBlock("Header Icons & Menu Color"))[0])).getByTitle(
        "Atrapa A - #112233",
      ),
    );
    expect(readStored(RECENT_KEY)).toEqual([
      "#112233",
      "#aabbcc",
      "#000001",
      "#000002",
      "#000003",
      "#000004",
      "#000005",
      "#000006",
      "#000007",
      "#000008",
    ]);
  });

  it("pusta paleta marki zamienia próbki na komunikat", () => {
    window.localStorage.setItem(BRAND_KEY, JSON.stringify([]));

    renderEditor();

    const row = rowOf(pickers(slotBlock("Header Icons & Menu Color"))[0]);
    expect(within(row).getByText("adminGCEditor.noBrandColors")).toBeInTheDocument();
  });

  it("slot z hoverem dostaje osobną parę pickerów, a każdy pisze do własnego pola", () => {
    renderEditor();
    openTab("Dark Accent");

    const block = slotBlock("Dark Accent Color");
    const rows = pickers(block);
    // light, dark, hover light, hover dark - dokładnie cztery.
    expect(rows).toHaveLength(4);
    expect(within(block).getByText("adminGCEditor.hoverLabel")).toBeInTheDocument();

    fireEvent.change(rows[2], { target: { value: "#010203" } });
    fireEvent.change(pickers(slotBlock("Dark Accent Color"))[3], {
      target: { value: "#040506" },
    });

    const css = previewCss();
    expect(css).toContain("--gc-dark-accent-hover: #010203;");
    expect(css).toContain("--gc-dark-accent-hover: #040506;");
  });

  it("przycisk „Domyślny” przywraca kolory i czyści typografię slotu", () => {
    h.colors = {
      "header-icon": {
        light: "#ff0000",
        dark: "#00ff00",
        fontSize: "40px",
        fontWeight: "700",
      },
    };

    renderEditor();

    const block = slotBlock("Header Icons & Menu Color");
    fireEvent.click(within(block).getByRole("button", { name: "adminGCEditor.defaultBtn" }));

    const after = slotBlock("Header Icons & Menu Color");
    const [light, dark] = pickers(after);
    expect(light.value).toBe("#374151");
    expect(dark.value).toBe("#e5e7eb");
    expect(asInput(within(after).getByPlaceholderText("14px")).value).toBe("14px");
    const css = previewCss();
    expect(css).toContain("--gc-header-icon-size: 14px;");
    expect(css).not.toContain("--gc-header-icon-weight:");
  });

  it("przywracanie slotu bez wartości domyślnej dla trybu ciemnego zeruje to pole", () => {
    // `review-bg` ma tylko `defaultLight` - przywrócenie musi wyczyścić dark
    // (a nie zostawić w nim starej wartości redakcji).
    h.colors = { "review-bg": { light: "#111111", dark: "#222222" } };

    renderEditor();
    openTab("Review Stars");

    const block = slotBlock("Background Color");
    fireEvent.click(within(block).getByRole("button", { name: "adminGCEditor.defaultBtn" }));

    const [light, dark] = pickers(slotBlock("Background Color"));
    expect(light.value).toBe("#ffc300");
    expect(dark.value).toBe("");
    expect(previewCss()).toContain("--gc-review-bg: #ffc300;");
  });
});

// ==========================================================================
// KONTRAKT 3: TypographyRow + bumpFontSize
// ==========================================================================

describe("GlobalColorsEditor - typografia i krok rozmiaru", () => {
  /** Pola typografii slotu „Header Icons & Menu Color” (defaultFontSize 14px). */
  function typography() {
    const block = slotBlock("Header Icons & Menu Color");
    return {
      block,
      font: asInput(within(block).getByPlaceholderText(DEFAULT_FONT)),
      size: asInput(within(block).getByPlaceholderText("14px")),
      up: within(block).getByRole("button", { name: "adminGCEditor.increaseSize" }),
      down: within(block).getByRole("button", { name: "adminGCEditor.decreaseSize" }),
    };
  }

  it("wpisany font i rozmiar trafiają do tokenów slotu", () => {
    renderEditor();

    fireEvent.change(typography().font, { target: { value: "Georgia, serif" } });
    fireEvent.change(typography().size, { target: { value: "21px" } });

    expect(typography().font.value).toBe("Georgia, serif");
    expect(typography().size.value).toBe("21px");
    const css = previewCss();
    expect(css).toContain("--gc-header-icon-font: Georgia, serif;");
    expect(css).toContain("--gc-header-icon-size: 21px;");
  });

  it("strzałki zmieniają rozmiar w px o jeden krok w każdą stronę", () => {
    renderEditor();

    fireEvent.change(typography().size, { target: { value: "16px" } });
    fireEvent.click(typography().up);
    expect(typography().size.value).toBe("17px");

    fireEvent.click(typography().down);
    fireEvent.click(typography().down);
    expect(typography().size.value).toBe("15px");
  });

  it("dla rem i em krok jest ułamkowy (0.125), a jednostka zostaje zachowana", () => {
    renderEditor();

    fireEvent.change(typography().size, { target: { value: "1.5rem" } });
    fireEvent.click(typography().up);
    expect(typography().size.value).toBe("1.625rem");

    fireEvent.change(typography().size, { target: { value: "2em" } });
    fireEvent.click(typography().down);
    expect(typography().size.value).toBe("1.875em");

    fireEvent.change(typography().size, { target: { value: "50%" } });
    fireEvent.click(typography().up);
    expect(typography().size.value).toBe("50.125%");
  });

  it("liczba bez jednostki dostaje px, a wartość nieliczbowa zostaje nietknięta", () => {
    renderEditor();

    fireEvent.change(typography().size, { target: { value: "20" } });
    fireEvent.click(typography().up);
    expect(typography().size.value).toBe("21px");

    fireEvent.change(typography().size, { target: { value: "inherit" } });
    fireEvent.click(typography().up);
    expect(typography().size.value).toBe("inherit");
  });

  it("zmniejszanie zatrzymuje się na zerze zamiast schodzić na wartość ujemną", () => {
    renderEditor();

    fireEvent.change(typography().size, { target: { value: "0.5px" } });
    fireEvent.click(typography().down);
    expect(typography().size.value).toBe("0px");

    fireEvent.click(typography().down);
    expect(typography().size.value).toBe("0px");
  });

  it("puste pole rozmiaru startuje od wartości domyślnej slotu", () => {
    renderEditor();

    expect(typography().size.value).toBe("");
    fireEvent.click(typography().up);
    // defaultFontSize slotu to 14px, więc pierwszy krok daje 15px.
    expect(typography().size.value).toBe("15px");
  });

  it("przycisk czyszczenia pojawia się dopiero przy ustawionej wartości i po użyciu znika", () => {
    renderEditor();

    expect(
      within(typography().block).queryByRole("button", { name: "adminGCEditor.clearFontSize" }),
    ).toBeNull();

    fireEvent.change(typography().size, { target: { value: "30px" } });
    fireEvent.click(
      within(typography().block).getByRole("button", { name: "adminGCEditor.clearFontSize" }),
    );

    expect(typography().size.value).toBe("");
    expect(previewCss()).not.toContain("--gc-header-icon-size:");
    expect(
      within(typography().block).queryByRole("button", { name: "adminGCEditor.clearFontSize" }),
    ).toBeNull();
  });
});

// ==========================================================================
// KONTRAKT 4: FormatRow
// ==========================================================================

describe("GlobalColorsEditor - formatowanie tekstu", () => {
  const block = () => slotBlock("Header Icons & Menu Color");

  it("wybór grubości zapisuje token i podświetla aktywny przycisk", () => {
    renderEditor();

    const bold = within(block()).getByTitle("adminGCEditor.weightTitle(label=Bold)");
    expect(bold.className).not.toContain("bg-foreground");

    fireEvent.click(bold);

    expect(previewCss()).toContain("--gc-header-icon-weight: 700;");
    expect(within(block()).getByTitle("adminGCEditor.weightTitle(label=Bold)").className).toContain(
      "bg-foreground",
    );
  });

  it("wybór „Brak” zdejmuje grubość z tokenów", () => {
    h.colors = { "header-icon": { fontWeight: "600" } };

    renderEditor();

    expect(previewCss()).toContain("--gc-header-icon-weight: 600;");
    fireEvent.click(
      within(block()).getByTitle("adminGCEditor.weightTitle(label=adminGCEditor.weightNone)"),
    );
    expect(previewCss()).not.toContain("--gc-header-icon-weight:");
  });

  it("kursywa i podkreślenie są przełącznikami - drugie kliknięcie je zdejmuje", () => {
    renderEditor();

    fireEvent.click(within(block()).getByTitle("adminGCEditor.italic"));
    expect(previewCss()).toContain("--gc-header-icon-style: italic;");

    fireEvent.click(within(block()).getByTitle("adminGCEditor.italic"));
    expect(previewCss()).not.toContain("--gc-header-icon-style:");

    fireEvent.click(within(block()).getByTitle("adminGCEditor.underline"));
    expect(previewCss()).toContain("--gc-header-icon-decoration: underline;");

    fireEvent.click(within(block()).getByTitle("adminGCEditor.underline"));
    expect(previewCss()).not.toContain("--gc-header-icon-decoration:");
  });

  it("„Wyczyść” pojawia się dopiero przy ustawionym formatowaniu i zdejmuje je", () => {
    renderEditor();

    expect(within(block()).queryByRole("button", { name: "adminGCEditor.clear" })).toBeNull();

    fireEvent.click(within(block()).getByTitle("adminGCEditor.underline"));
    fireEvent.click(within(block()).getByRole("button", { name: "adminGCEditor.clear" }));

    expect(previewCss()).not.toContain("--gc-header-icon-decoration:");
    expect(within(block()).queryByRole("button", { name: "adminGCEditor.clear" })).toBeNull();
  });
});

// ==========================================================================
// KONTRAKT 5: BrandPaletteEditor (paleta w localStorage)
// ==========================================================================

describe("GlobalColorsEditor - paleta marki", () => {
  const addBtn = () =>
    within(paletteCard()).getByRole("button", { name: "adminGCEditor.addColor" });

  /** Pole hex formularza palety - jedyny picker WEWNĄTRZ karty palety. */
  const paletteHex = () => asInput(within(paletteCard()).getAllByTestId("gc-picker")[0]);
  const paletteName = () =>
    asInput(within(paletteCard()).getByPlaceholderText("adminGCEditor.namePlaceholder"));

  it("tytuł karty niesie liczbę kolorów przekazaną do tłumaczenia", () => {
    renderEditor();

    expect(screen.getByText("adminGCEditor.paletteTitle(count=2)")).toBeInTheDocument();
  });

  it("dodanie koloru dopisuje próbkę i utrwala paletę w localStorage", () => {
    renderEditor();

    fireEvent.click(addBtn());
    expect(paletteHex().value).toBe("#000000");

    fireEvent.change(paletteHex(), { target: { value: "#654321" } });
    fireEvent.change(paletteName(), { target: { value: "Atrapa C" } });
    fireEvent.click(within(paletteCard()).getByRole("button", { name: "adminGCEditor.add" }));

    expect(readStored(BRAND_KEY)).toEqual([
      ...TEST_PALETTE,
      { name: "Atrapa C", value: "#654321" },
    ]);
    expect(screen.getByText("adminGCEditor.paletteTitle(count=3)")).toBeInTheDocument();
    // Nowy kolor jest od razu do wzięcia w każdym wierszu koloru.
    expect(
      within(rowOf(pickers(slotBlock("Header Icons & Menu Color"))[0])).getByTitle(
        "Atrapa C - #654321",
      ),
    ).toBeInTheDocument();
    // Formularz zamyka się po zatwierdzeniu.
    expect(within(paletteCard()).queryAllByTestId("gc-picker")).toHaveLength(0);
  });

  it("pusta nazwa zastępowana jest wartością hex", () => {
    renderEditor();

    fireEvent.click(addBtn());
    fireEvent.change(paletteHex(), { target: { value: "#0abcde" } });
    fireEvent.click(within(paletteCard()).getByRole("button", { name: "adminGCEditor.add" }));

    expect(readStored(BRAND_KEY)).toEqual([...TEST_PALETTE, { name: "#0abcde", value: "#0abcde" }]);
  });

  it("wartość nie będąca hexem blokuje zapis i nie zmienia palety", () => {
    renderEditor();

    fireEvent.click(addBtn());
    fireEvent.change(paletteHex(), { target: { value: "rgb(1,2,3)" } });

    const commit = within(paletteCard()).getByRole("button", { name: "adminGCEditor.add" });
    expect(commit).toBeDisabled();
    // Nawet wymuszone kliknięcie nie może przepchnąć wartości przez bramkę.
    fireEvent.click(commit);
    expect(readStored(BRAND_KEY)).toEqual(TEST_PALETTE);

    // Wyczyszczenie pola (picker oddaje `undefined`) też zostawia bramkę zamkniętą.
    fireEvent.change(paletteHex(), { target: { value: "" } });
    expect(paletteHex().value).toBe("");
    expect(within(paletteCard()).getByRole("button", { name: "adminGCEditor.add" })).toBeDisabled();
    expect(readStored(BRAND_KEY)).toEqual(TEST_PALETTE);
  });

  it("kliknięcie próbki otwiera edycję z jej wartościami, a zapis podmienia wpis", () => {
    renderEditor();

    fireEvent.click(
      within(paletteCard()).getByTitle(
        "adminGCEditor.swatchEditTitle(name=Atrapa B,value=#AABBCC)",
      ),
    );
    expect(paletteHex().value).toBe("#AABBCC");
    expect(paletteName().value).toBe("Atrapa B");

    fireEvent.change(paletteName(), { target: { value: "Atrapa B2" } });
    fireEvent.change(paletteHex(), { target: { value: "#ddeeff" } });
    fireEvent.click(within(paletteCard()).getByRole("button", { name: "common.save" }));

    expect(readStored(BRAND_KEY)).toEqual([
      TEST_PALETTE[0],
      { name: "Atrapa B2", value: "#ddeeff" },
    ]);
  });

  it("anulowanie zamyka formularz bez zmiany palety", () => {
    renderEditor();

    fireEvent.click(addBtn());
    fireEvent.change(paletteHex(), { target: { value: "#123456" } });
    fireEvent.click(within(paletteCard()).getByRole("button", { name: "common.cancel" }));

    expect(within(paletteCard()).queryAllByTestId("gc-picker")).toHaveLength(0);
    expect(readStored(BRAND_KEY)).toEqual(TEST_PALETTE);
  });

  it("usunięcie próbki wycina dokładnie ją", () => {
    renderEditor();

    const removals = within(paletteCard()).getAllByTitle("adminGCEditor.remove");
    expect(removals).toHaveLength(2);
    fireEvent.click(removals[0]);

    expect(readStored(BRAND_KEY)).toEqual([TEST_PALETTE[1]]);
    expect(screen.getByText("adminGCEditor.paletteTitle(count=1)")).toBeInTheDocument();
  });

  it("pusta paleta pokazuje komunikat, który znika po otwarciu formularza", () => {
    window.localStorage.setItem(BRAND_KEY, JSON.stringify([]));

    renderEditor();

    expect(screen.getByText("adminGCEditor.emptyPalette")).toBeInTheDocument();
    fireEvent.click(addBtn());
    expect(screen.queryByText("adminGCEditor.emptyPalette")).toBeNull();
  });

  it("uszkodzony wpis w localStorage nie wywraca panelu - wraca paleta domyślna", () => {
    window.localStorage.setItem(BRAND_KEY, "{to nie jest JSON");

    renderEditor();

    // Domyślna paleta produkcyjna ma 12 pozycji; liczy się to, że panel wstał
    // z sensowną paletą, a uszkodzona wartość została nadpisana poprawnym JSON-em.
    expect(screen.getByText("adminGCEditor.paletteTitle(count=12)")).toBeInTheDocument();
    const restored = readStored(BRAND_KEY);
    expect(Array.isArray(restored)).toBe(true);
  });
});

// ==========================================================================
// KONTRAKT 6: historia, skróty klawiszowe i zapis
// ==========================================================================

describe("GlobalColorsEditor - historia, skróty i zapis", () => {
  const light = () => pickers(slotBlock("Header Icons & Menu Color"))[0];

  it("cofnij i ponów wędrują po kolejnych stanach draftu", () => {
    renderEditor();

    fireEvent.change(light(), { target: { value: "#111111" } });
    fireEvent.change(light(), { target: { value: "#222222" } });
    expect(light().value).toBe("#222222");

    fireEvent.click(undoBtn());
    expect(light().value).toBe("#111111");
    expect(redoBtn()).not.toBeDisabled();

    fireEvent.click(undoBtn());
    expect(light().value).toBe("");
    expect(undoBtn()).toBeDisabled();

    fireEvent.click(redoBtn());
    expect(light().value).toBe("#111111");
    fireEvent.click(redoBtn());
    expect(light().value).toBe("#222222");
    expect(redoBtn()).toBeDisabled();
  });

  it("nowa zmiana po cofnięciu kasuje gałąź „ponów”", () => {
    renderEditor();

    fireEvent.change(light(), { target: { value: "#111111" } });
    fireEvent.click(undoBtn());
    expect(redoBtn()).not.toBeDisabled();

    fireEvent.change(light(), { target: { value: "#333333" } });
    expect(redoBtn()).toBeDisabled();
  });

  it("skróty ⌘/Ctrl+Z, +Shift+Z i +Y obsługują historię i wstrzymują domyślną akcję przeglądarki", () => {
    renderEditor();

    fireEvent.change(light(), { target: { value: "#111111" } });

    expect(fireEvent.keyDown(window, { key: "z", ctrlKey: true })).toBe(false);
    expect(light().value).toBe("");

    expect(fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(light().value).toBe("#111111");

    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(light().value).toBe("");

    expect(fireEvent.keyDown(window, { key: "y", ctrlKey: true })).toBe(false);
    expect(light().value).toBe("#111111");
  });

  it("klawisz bez modyfikatora i modyfikator z obcą literą nie ruszają historii", () => {
    renderEditor();

    fireEvent.change(light(), { target: { value: "#111111" } });

    expect(fireEvent.keyDown(window, { key: "z" })).toBe(true);
    expect(fireEvent.keyDown(window, { key: "q", ctrlKey: true })).toBe(true);
    expect(light().value).toBe("#111111");
  });

  it("skrót na pustej historii jest bezpiecznym no-opem", () => {
    h.colors = { "header-icon": { light: "#abcabc" } };

    renderEditor();

    // Przyciski są wyszarzone, ale SKRÓTY nie mają własnej bramki - obie
    // funkcje muszą same wytrzymać pusty stos, inaczej pierwszy odruchowy
    // ⌘Z po wejściu w panel wywraca cały widok.
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });

    expect(light().value).toBe("#abcabc");
    expect(undoBtn()).toBeDisabled();
    expect(redoBtn()).toBeDisabled();
  });

  it("„Anuluj” wraca do stanu wczytanego i wygasza historię", () => {
    h.colors = { "header-icon": { light: "#abcabc" } };

    renderEditor();

    fireEvent.change(light(), { target: { value: "#111111" } });
    expect(undoBtn()).not.toBeDisabled();

    fireEvent.click(cancelBtn());

    expect(light().value).toBe("#abcabc");
    expect(undoBtn()).toBeDisabled();
    expect(redoBtn()).toBeDisabled();
    expect(saveBtn()).toBeDisabled();
  });

  it("zapis wysyła cały draft, czyści historię i gasi przycisk", () => {
    renderEditor();

    fireEvent.change(light(), { target: { value: "#111111" } });
    fireEvent.click(saveBtn());

    expect(h.saves).toHaveLength(1);
    expect(h.saves[0]["header-icon"]).toEqual({ light: "#111111" });
    expect(undoBtn()).toBeDisabled();
    expect(redoBtn()).toBeDisabled();
    expect(saveBtn()).toBeDisabled();
  });

  it("skrót ⌘/Ctrl+S zapisuje tak samo jak przycisk", () => {
    renderEditor();

    fireEvent.change(light(), { target: { value: "#0b0b0b" } });
    expect(fireEvent.keyDown(window, { key: "s", metaKey: true })).toBe(false);

    expect(h.saves).toHaveLength(1);
    expect(h.saves[0]["header-icon"]).toEqual({ light: "#0b0b0b" });
  });

  it("bez zmian zapis nie leci - ani z przycisku, ani ze skrótu", () => {
    renderEditor();

    expect(saveBtn()).toBeDisabled();
    fireEvent.click(saveBtn());
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    expect(h.saves).toHaveLength(0);
  });

  it("zapis w toku blokuje przycisk, pokazuje komunikat i odrzuca kolejne żądanie", () => {
    h.savePending = true;

    renderEditor();

    fireEvent.change(light(), { target: { value: "#0c0c0c" } });

    const btn = saveBtn();
    expect(btn).toHaveTextContent("adminGCEditor.saving");
    expect(btn).toBeDisabled();
    expect(cancelBtn()).toBeDisabled();

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(h.saves).toHaveLength(0);
  });

  it("nieudany zapis nie kasuje ani draftu, ani historii", () => {
    h.saveFails = true;

    renderEditor();

    fireEvent.change(light(), { target: { value: "#d00d00" } });
    fireEvent.click(saveBtn());

    expect(h.saves).toHaveLength(1);
    // Redakcja nie może stracić pracy tylko dlatego, że zapis nie doszedł:
    // wartość zostaje w polu, cofanie działa, a przycisk zapisu jest znów żywy.
    expect(light().value).toBe("#d00d00");
    expect(undoBtn()).not.toBeDisabled();
    expect(saveBtn()).not.toBeDisabled();
  });
});

// ==========================================================================
// KONTRAKT 7: zakładki, podgląd slotów i łańcuch getColor
// ==========================================================================

describe("GlobalColorsEditor - zakładki i podgląd slotów", () => {
  it("każda grupa ma zakładkę, a jej otwarcie renderuje wszystkie sloty grupy", () => {
    renderEditor();

    for (const group of GLOBAL_COLOR_GROUPS) {
      openTab(group.label);
      for (const slot of group.slots) {
        expect(screen.getByText(slot.label)).toBeInTheDocument();
      }
      // Podgląd rysuje się dwa razy na slot: w trybie jasnym i ciemnym.
      expect(screen.getAllByText("light").length).toBe(group.slots.length);
      expect(screen.getAllByText("dark").length).toBe(group.slots.length);
    }
  });

  it("zawartość zakładki znika po przejściu do innej grupy", () => {
    renderEditor();

    expect(screen.getByText("Header Icons & Menu Color")).toBeInTheDocument();
    openTab("Live Blogging");

    expect(screen.queryByText("Header Icons & Menu Color")).toBeNull();
    expect(screen.getByText("Color")).toBeInTheDocument();
  });

  it("slot bez wartości i bez wartości domyślnych dostaje w podglądzie kolor awaryjny", () => {
    renderEditor();
    openTab("Button");

    const preview = asElement(
      slotBlock("Primary Color (Background)").querySelector("div.grid.grid-cols-2"),
      "podgląd slotu btn-bg",
    );
    const buttons = within(preview).getAllByText("adminGCEditor.preview.normal");
    // Panel jasny bierze #374151, ciemny #e5e7eb - to ostatnie ogniwo łańcucha
    // getColor (brak wartości, brak defaultLight, brak defaultDark).
    expect(buttons[0].getAttribute("style")).toContain("background: #374151");
    expect(buttons[1].getAttribute("style")).toContain("background: #e5e7eb");
  });

  it("wartość light przecieka do podglądu ciemnego, gdy slot nie ma własnego dark", () => {
    h.colors = { "btn-bg": { light: "#123456" } };

    renderEditor();
    openTab("Button");

    const preview = asElement(
      slotBlock("Primary Color (Background)").querySelector("div.grid.grid-cols-2"),
      "podgląd slotu btn-bg",
    );
    const buttons = within(preview).getAllByText("adminGCEditor.preview.normal");
    expect(buttons[0].getAttribute("style")).toContain("background: #123456");
    expect(buttons[1].getAttribute("style")).toContain("background: #123456");
  });

  it("zmiana koloru natychmiast przemalowuje oba panele podglądu nagłówka", () => {
    renderEditor();

    fireEvent.change(pickers(slotBlock("Header Icons & Menu Color"))[0], {
      target: { value: "#00ff00" },
    });

    // Sam wpis w polu „Light" wystarczy, żeby przemalować OBA panele: łańcuch
    // getColor schodzi z trybu ciemnego na wartość light ZANIM sięgnie po
    // domyślny odcień dark slotu (#e5e7eb).
    const afterLight = screen.getAllByText("adminGCEditor.preview.home");
    expect(afterLight[0].getAttribute("style")).toContain("color: #00ff00");
    expect(afterLight[1].getAttribute("style")).toContain("color: #00ff00");

    fireEvent.change(pickers(slotBlock("Header Icons & Menu Color"))[1], {
      target: { value: "#0000ff" },
    });

    const afterDark = screen.getAllByText("adminGCEditor.preview.home");
    expect(afterDark[0].getAttribute("style")).toContain("color: #00ff00");
    expect(afterDark[1].getAttribute("style")).toContain("color: #0000ff");
  });
});

// ==========================================================================
// KONTRAKT 8: język panelu (PL/EN) dla etykiet z modułów danych
// ==========================================================================

describe("GlobalColorsEditor - język panelu", () => {
  it("po polsku nagłówki kategorii i etykiety grup zostają w brzmieniu źródłowym", () => {
    h.language = "pl";

    renderEditor();

    expect(screen.getByText("Widgety treści")).toBeInTheDocument();
    expect(screen.getByText("Formularze i przyciski")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tła motywu" })).toBeInTheDocument();
  });

  it("po angielsku te same etykiety idą ze słownika buildera", () => {
    h.language = "en";

    renderEditor();

    // Wartości oczekiwane pochodzą z `BUILDER_LABELS_EN`, a nie z kopii napisu
    // źródłowego - gdyby wpis zniknął ze słownika, `builderLabel` cofnąłby się
    // do polskiego oryginału i te asercje by upadły.
    expect(screen.getByText("Content widgets")).toBeInTheDocument();
    expect(screen.getByText("Forms and buttons")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Theme backgrounds" })).toBeInTheDocument();

    expect(screen.queryByText("Widgety treści")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Tła motywu" })).toBeNull();
  });
});

// ==========================================================================
// Zakładka Sidebar: wybór stylu i logotypy (SidebarStylePicker)
// ==========================================================================

describe("GlobalColorsEditor - styl sidebara", () => {
  function openSidebar() {
    renderEditor();
    openTab("Sidebar");
  }

  it("bez zapisanego wyboru aktywny jest style-1, a klik w inny styl zapisuje ustawienie", () => {
    openSidebar();

    const first = screen.getByRole("button", { name: /Style 1 - Solid Classic/ });
    expect(within(first).getByText("adminGCEditor.active")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Style 4 - Compact Icon Rail/ }));

    expect(h.themeSaves).toHaveLength(1);
    expect(h.themeSaves[0].sidebars).toEqual({ style: "style-4" });
  });

  it("zapisany styl jest oznaczony jako aktywny dokładnie raz", () => {
    h.themeData = { sidebars: { style: "style-6" }, logo: {} };

    openSidebar();

    expect(screen.getAllByText("adminGCEditor.active")).toHaveLength(1);
    const active = screen.getByRole("button", { name: /Style 6 - Bold Dark/ });
    expect(within(active).getByText("adminGCEditor.active")).toBeInTheDocument();
    // Wszystkie warianty są do wzięcia, nie tylko aktywny.
    for (const style of SIDEBAR_STYLES) {
      expect(screen.getByRole("button", { name: new RegExp(style.label) })).toBeInTheDocument();
    }
  });

  it("zapis w toku pokazuje komunikat i wycisza wybór stylu oraz logotypy", () => {
    h.themePending = true;

    openSidebar();

    expect(screen.getAllByText("adminGCEditor.saving").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Style 3 - Floating Card/ }));

    const block = asElement(
      screen.getByText("Ikona sidebaru - compact").closest("div.space-y-3"),
      "blok logotypu",
    );
    const slots = within(block).getAllByTestId("image-slot");
    fireEvent.change(slots[0], { target: { value: "https://example.com/l.svg" } });
    fireEvent.change(slots[1], { target: { value: "https://example.com/d.svg" } });

    // Trzy próby zapisu w trakcie trwającego zapisu - żadna nie może przejść,
    // bo `useSettings` scala draft z bieżącym wierszem i wyścig nadpisałby go.
    expect(h.themeSaves).toHaveLength(0);
  });

  it("brak wczytanych ustawień wstrzymuje zapis stylu i logotypów", () => {
    h.themeData = null;

    openSidebar();

    fireEvent.click(screen.getByRole("button", { name: /Style 2 - Minimal Borderless/ }));
    const block = asElement(
      screen.getByText("Ikona sidebaru - compact").closest("div.space-y-3"),
      "blok logotypu",
    );
    const slots = within(block).getAllByTestId("image-slot");
    fireEvent.change(slots[0], { target: { value: "https://example.com/ikona.svg" } });
    fireEvent.change(slots[1], { target: { value: "https://example.com/ikona-dark.svg" } });

    // Zapis bez wczytanego wiersza skasowałby wszystkie pozostałe gałęzie
    // `theme_options`, więc obie ścieżki (jasna i ciemna) muszą milczeć.
    expect(h.themeSaves).toHaveLength(0);
  });

  it("logotypy jasny i ciemny zapisują się pod własnymi kluczami", () => {
    h.themeData = { sidebars: { style: "style-1" }, logo: { sidebar_icon: "" } };

    openSidebar();

    const compact = asElement(
      screen.getByText("Ikona sidebaru - compact").closest("div.space-y-3"),
      "blok ikony sidebaru",
    );
    const slots = within(compact).getAllByTestId("image-slot");
    expect(slots[0].getAttribute("data-hint")).toBe("adminGCEditor.variantLight");
    expect(slots[1].getAttribute("data-hint")).toBe("adminGCEditor.variantDark");
    expect(slots[0].getAttribute("data-folder")).toBe("theme/logo");

    fireEvent.change(slots[0], { target: { value: "https://example.com/light.svg" } });
    fireEvent.change(slots[1], { target: { value: "https://example.com/dark.svg" } });

    expect(h.themeSaves).toHaveLength(2);
    expect(h.themeSaves[0].logo?.sidebar_icon).toBe("https://example.com/light.svg");
    expect(h.themeSaves[1].logo?.sidebar_icon_dark).toBe("https://example.com/dark.svg");

    const expanded = asElement(
      screen.getByText("Logo sidebaru - expanded").closest("div.space-y-3"),
      "blok logo sidebaru",
    );
    fireEvent.change(within(expanded).getAllByTestId("image-slot")[0], {
      target: { value: "https://example.com/expanded.svg" },
    });
    expect(h.themeSaves[2].logo?.sidebar_expanded).toBe("https://example.com/expanded.svg");
  });

  it("częściowy wiersz ustawień (bez gałęzi sidebars i logo) daje się uzupełnić", () => {
    // Wiersz `site_settings` bywa starszy od kodu i nie musi mieć wszystkich
    // gałęzi - panel dokłada brakujące zamiast wywracać się na `undefined`.
    h.themeData = {};

    openSidebar();

    fireEvent.click(screen.getByRole("button", { name: /Style 5 - Glass \/ Frosted/ }));
    expect(h.themeSaves[0].sidebars).toEqual({ style: "style-5" });

    const block = asElement(
      screen.getByText("Logo sidebaru - expanded").closest("div.space-y-3"),
      "blok logo sidebaru",
    );
    const slots = within(block).getAllByTestId("image-slot");
    expect(asInput(slots[0]).value).toBe("");
    fireEvent.change(slots[0], { target: { value: "https://example.com/e.svg" } });
    fireEvent.change(slots[1], { target: { value: "https://example.com/e-dark.svg" } });

    expect(h.themeSaves[1].logo).toEqual({ sidebar_expanded: "https://example.com/e.svg" });
    expect(h.themeSaves[2].logo).toEqual({
      sidebar_expanded_dark: "https://example.com/e-dark.svg",
    });
  });

  it("wybierak stylu pojawia się wyłącznie w grupie Sidebar", () => {
    renderEditor();

    expect(screen.queryByText("adminGCEditor.sidebarStyleTitle")).toBeNull();
    openTab("Sidebar");
    expect(screen.getByText("adminGCEditor.sidebarStyleTitle")).toBeInTheDocument();
    openTab("Links");
    expect(screen.queryByText("adminGCEditor.sidebarStyleTitle")).toBeNull();
  });
});

// ==========================================================================
// REJESTR DEFEKTÓW
// ==========================================================================
//
// DEFEKT 1 - flaga pomijania historii nigdy nie zostaje skonsumowana.
// `skipHistoryRef` ma jedno zadanie: nie zapisywać w historii stanu, który sam
// jest cofnięciem. Ustawia ją WYŁĄCZNIE przycisk „Anuluj”, po czym woła
// `setDraft(baseline)` - czyli wersję z WARTOŚCIĄ, a nie z funkcją aktualizującą.
// Flagę czyta i zeruje tylko `applyDraft`, więc po anulowaniu zostaje ona
// podniesiona aż do NASTĘPNEJ zmiany koloru - i to ta zmiana (zwykła edycja
// redakcji, nie żadne cofnięcie) wypada z historii. Lekarstwem po stronie
// produkcji jest wyzerowanie flagi w samym handlerze „Anuluj” (albo wywołanie
// `setDraft` z funkcją, która ją konsumuje) - ale tego test nie zmienia.
//
// DEFEKTY 2 i 3 - dwa wywołania `setSlotMeta` w JEDNYM handlerze gubią pierwsze.
// `setSlot` i `setSlotMeta` budują następny draft z ZAMKNIĘTEJ W RENDERZE
// zmiennej `draft` (`applyDraft({ ...draft, ... })`), a `applyDraft` przekazuje
// do `setDraft` gotową WARTOŚĆ, nie funkcję aktualizującą. Handler, który woła
// je kilka razy pod rząd, liczy więc każdą zmianę od TEGO SAMEGO stanu
// wyjściowego i zapisuje wyłącznie ostatnią. Dotyczy to dokładnie dwóch
// przycisków panelu:
//   - „Wyczyść font/size” (`TypographyRow`): `onFontFamily("")` + `onFontSize("")`
//     - font zostaje na miejscu, znika sam rozmiar,
//   - „Wyczyść” (`FormatRow`): `onWeight("")` + `onStyle("")` + `onDecoration("")`
//     - grubość i kursywa zostają, znika samo podkreślenie.
// Redakcja widzi przycisk, który „nie działa do końca”, a przy kolejnym
// kliknięciu (przycisk nadal jest widoczny, bo pozostałe wartości są ustawione)
// czyści następną wartość - czyli pełne wyczyszczenie wymaga tylu kliknięć, ile
// ustawionych pól. Lekarstwem po stronie produkcji jest jedno wywołanie
// `applyDraft` z kompletem pól albo funkcyjna postać `setDraft` - ale tego test
// nie zmienia.

describe("GlobalColorsEditor - rejestr defektów", () => {
  it.fails("DEFEKT: pierwsza zmiana po „Anuluj” nie trafia do historii cofania", () => {
    h.colors = { "header-icon": { light: "#abcabc" } };

    renderEditor();

    const light = () => pickers(slotBlock("Header Icons & Menu Color"))[0];
    fireEvent.change(light(), { target: { value: "#111111" } });
    fireEvent.click(cancelBtn());
    expect(light().value).toBe("#abcabc");

    // Zwykła edycja, nie cofnięcie - musi być odwracalna.
    fireEvent.change(light(), { target: { value: "#222222" } });
    expect(undoBtn()).not.toBeDisabled();
  });

  it.fails("DEFEKT: „Wyczyść font/size” zostawia font, kasuje tylko rozmiar", () => {
    h.colors = { "header-icon": { fontFamily: "Inter, sans-serif", fontSize: "30px" } };

    renderEditor();

    const block = () => slotBlock("Header Icons & Menu Color");
    fireEvent.click(within(block()).getByRole("button", { name: "adminGCEditor.clearFontSize" }));

    const css = previewCss();
    expect(css).not.toContain("--gc-header-icon-size:");
    expect(css).not.toContain("--gc-header-icon-font:");
  });

  it.fails("DEFEKT: „Wyczyść” w formatowaniu zdejmuje tylko podkreślenie", () => {
    h.colors = {
      "header-icon": { fontWeight: "600", fontStyle: "italic", textDecoration: "underline" },
    };

    renderEditor();

    const block = () => slotBlock("Header Icons & Menu Color");
    fireEvent.click(within(block()).getByRole("button", { name: "adminGCEditor.clear" }));

    const css = previewCss();
    expect(css).not.toContain("--gc-header-icon-decoration:");
    expect(css).not.toContain("--gc-header-icon-weight:");
    expect(css).not.toContain("--gc-header-icon-style:");
  });
});
