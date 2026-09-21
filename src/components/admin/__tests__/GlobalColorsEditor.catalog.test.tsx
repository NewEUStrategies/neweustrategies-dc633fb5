// `GlobalColorsEditor` wobec KATALOGU slotów, którego dziś w repo nie ma.
//
// PO CO OSOBNY PLIK. Lista zakładek panelu jest generowana z dwóch tablic
// danych: `GLOBAL_COLOR_CATEGORIES` (nagłówki sekcji) i `GLOBAL_COLOR_GROUPS`
// (grupy slotów). Pole `category` w `GlobalColorGroup` jest OPCJONALNE, a panel
// ma na tę opcjonalność osobną gałąź: grupy bez kategorii dostają własny,
// bezimienny rząd zakładek na dole listy; jest też gałąź odwrotna - kategoria,
// do której nie należy żadna grupa, nie może zostawić po sobie pustego
// nagłówka. Dziś KAŻDA produkcyjna grupa ma kategorię i KAŻDA kategoria ma
// grupy, więc obie gałęzie stoją nietknięte - i pierwszy nowy slot dodany bez
// `category` (albo pierwsza kategoria wyprzedzająca swoje grupy) byłby
// jednocześnie ich premierą na produkcji.
//
// Dlatego ten plik - i tylko ten - podmienia sam KATALOG (`vi.mock` z
// `importOriginal`, więc reszta modułu, w tym `globalColorsToCss` i
// `isSlotHoverable`, zostaje prawdziwa) na trzyelementowy zestaw: kategoria z
// grupą, kategoria BEZ grup i grupa BEZ kategorii. Atrapy granic danych są te
// same, co w `GlobalColorsEditor.test.tsx`; ten plik nie dubluje żadnej z
// tamtejszych asercji - pilnuje wyłącznie generowania listy zakładek.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { GlobalColorsValue } from "@/lib/builder/globalColors";

interface PickerProbeProps {
  value?: string;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
}

const h = vi.hoisted(() => ({
  colors: {} as GlobalColorsValue,
  saves: [] as GlobalColorsValue[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/lib/i18n-admin-global-colors-editor", () => ({}));

// Syntetyczny katalog: „Sekcja z grupą” ma jedną grupę, „Sekcja pusta” nie ma
// żadnej, a „Grupa luzem” nie należy do żadnej sekcji.
vi.mock("@/lib/builder/globalColors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  GLOBAL_COLOR_CATEGORIES: [
    { id: "sekcja", label: "Sekcja z grupą" },
    { id: "sekcja-pusta", label: "Sekcja pusta" },
  ],
  GLOBAL_COLOR_GROUPS: [
    {
      id: "w-sekcji",
      category: "sekcja",
      label: "Grupa w sekcji",
      slots: [
        {
          key: "syn-a",
          label: "Slot w sekcji",
          description: "Slot należący do kategorii.",
          hasDark: true,
          defaultLight: "#101010",
          defaultDark: "#202020",
        },
      ],
    },
    {
      id: "luzem",
      label: "Grupa luzem",
      slots: [
        {
          key: "syn-b",
          label: "Slot bez kategorii",
          description: "Slot grupy spoza kategorii - typografia BEZ wartości domyślnych.",
          hasDark: true,
          defaultDark: "#303030",
          typography: true,
        },
      ],
    },
  ],
}));

vi.mock("@/hooks/useGlobalColors", () => ({
  useGlobalColors: () => ({ data: h.colors, isLoading: false }),
  useSaveGlobalColors: () => ({
    isPending: false,
    mutate: (next: GlobalColorsValue, options?: { onSuccess?: () => void }) => {
      h.saves.push(JSON.parse(JSON.stringify(next)) as GlobalColorsValue);
      h.colors = next;
      options?.onSuccess?.();
    },
  }),
}));

vi.mock("@/lib/admin/useSettings", () => ({
  useSettings: () => ({
    query: { data: { sidebars: {}, logo: {} } },
    save: { isPending: false, mutate: () => undefined },
  }),
}));

vi.mock("@/components/admin/blocks/AdminColorPicker", () => ({
  AdminColorPicker: ({ value, onChange, placeholder }: PickerProbeProps) => (
    <input
      data-testid="gc-picker"
      placeholder={placeholder ?? ""}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
    />
  ),
}));

vi.mock("@/components/admin/ImageSlot", () => ({
  ImageSlot: () => null,
}));

import { GlobalColorsEditor } from "@/components/admin/GlobalColorsEditor";
import { BRAND_PALETTE_STORAGE_KEY } from "@/lib/storageKeys";

function asInput(el: HTMLElement): HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) throw new Error("oczekiwano <input>");
  return el;
}

beforeEach(() => {
  h.colors = {};
  h.saves = [];
  window.localStorage.clear();
  window.localStorage.setItem(BRAND_PALETTE_STORAGE_KEY.key, JSON.stringify([]));
});

describe("GlobalColorsEditor - katalog grup i kategorii", () => {
  it("grupa bez kategorii dostaje zakładkę, a kategoria bez grup nie zostawia nagłówka", () => {
    render(<GlobalColorsEditor />);

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "Grupa w sekcji" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Grupa luzem" })).toBeInTheDocument();

    expect(screen.getByText("Sekcja z grupą")).toBeInTheDocument();
    // Pusta kategoria nie może wyrenderować własnego nagłówka nad niczym.
    expect(screen.queryByText("Sekcja pusta")).toBeNull();
  });

  it("slot z grupy bez kategorii jest w pełni edytowalny i trafia do zapisu", () => {
    render(<GlobalColorsEditor />);

    // Zakładka startowa to pierwsza grupa katalogu, więc slot luzem jest
    // schowany aż do przełączenia.
    expect(screen.queryByText("Slot bez kategorii")).toBeNull();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Grupa luzem" }));
    expect(screen.getByText("Slot bez kategorii")).toBeInTheDocument();

    const block = screen.getByText("Slot bez kategorii").closest("div.space-y-2");
    if (!(block instanceof HTMLElement)) throw new Error("brak bloku slotu");
    const picker = asInput(within(block).getAllByTestId("gc-picker")[0]);
    fireEvent.change(picker, { target: { value: "#abcdef" } });

    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    expect(h.saves).toHaveLength(1);
    expect(h.saves[0]["syn-b"]).toEqual({ light: "#abcdef" });
  });

  it("slot typograficzny bez wartości domyślnych podpowiada font motywu i rozmiar 16px", () => {
    render(<GlobalColorsEditor />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Grupa luzem" }));

    const block = screen.getByText("Slot bez kategorii").closest("div.space-y-2");
    if (!(block instanceof HTMLElement)) throw new Error("brak bloku slotu");

    const size = asInput(within(block).getByPlaceholderText("16px"));
    expect(
      within(block).getByPlaceholderText(
        '"Red Hat Display", "Red Hat Display Fallback", system-ui, sans-serif',
      ),
    ).toBeInTheDocument();

    // Bez `defaultFontSize` krokowanie startuje od zaszytego 16px - inaczej
    // strzałka przy pustym polu nie miałaby od czego liczyć.
    fireEvent.click(within(block).getByRole("button", { name: "adminGCEditor.increaseSize" }));
    expect(size.value).toBe("17px");

    fireEvent.change(size, { target: { value: "" } });
    fireEvent.click(within(block).getByRole("button", { name: "adminGCEditor.decreaseSize" }));
    expect(size.value).toBe("15px");
  });

  it("przywracanie slotu bez wartości domyślnej dla trybu jasnego zeruje to pole", () => {
    // Przycisk przywracania pojawia się już przy samym `defaultDark`, więc
    // slot bez `defaultLight` musi po przywróceniu wyczyścić pole „Light”.
    h.colors = { "syn-b": { light: "#aaaaaa", dark: "#bbbbbb" } };

    render(<GlobalColorsEditor />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Grupa luzem" }));

    const block = () => {
      const node = screen.getByText("Slot bez kategorii").closest("div.space-y-2");
      if (!(node instanceof HTMLElement)) throw new Error("brak bloku slotu");
      return node;
    };
    fireEvent.click(within(block()).getByRole("button", { name: "adminGCEditor.defaultBtn" }));

    const pickers = within(block()).getAllByTestId("gc-picker").map(asInput);
    expect(pickers[0].value).toBe("");
    expect(pickers[1].value).toBe("#303030");
  });
});
