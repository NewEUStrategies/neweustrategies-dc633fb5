// MODEL DZIEDZICZENIA KOLORU w edytorze Theme Design. Do 18.08.2026: 0%.
//
// To jest reguła, nie ozdoba. Każde pole koloru ma trzy możliwe stany i dwa
// tryby, a od ich rozstrzygnięcia zależy, czy zmiana koloru marki w zakładce
// „Przyciski” dotrze do przycisku „czytaj więcej” na stronie publicznej:
//
//   tryb JASNY: wartość sekcji; pusta = dziedzicz token globalny
//   tryb CIEMNY: `darkOverrides[sekcja][pole]`; puste = dziedzicz wartość jasną
//                (która sama może być tokenem flipującym się w ciemnym motywie)
//
// Pomyłka w tej macierzy nie wywala nic - wpisuje literał tam, gdzie powinna
// zostać referencja, i po cichu ODCINA globalne kolory od tej jednej kontrolki.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Atrapa wybieraka: oddaje w DOM te trzy wartości, o które toczy się reguła
// (wartość własna, wartość dziedziczona, podpowiedź), i pozwala wywołać zmianę.
vi.mock("@/components/admin/blocks/AdminColorPicker", () => ({
  AdminColorPicker: ({
    value,
    inheritedValue,
    placeholder,
    onChange,
  }: {
    value?: string;
    inheritedValue?: string;
    placeholder?: string;
    onChange: (next: string | null) => void;
  }) => (
    <div>
      <span data-testid="value">{value ?? ""}</span>
      <span data-testid="inherited">{inheritedValue ?? ""}</span>
      <span data-testid="placeholder">{placeholder ?? ""}</span>
      <button type="button" onClick={() => onChange("#abcdef")}>
        ustaw
      </button>
      <button type="button" onClick={() => onChange(null)}>
        wyczyść
      </button>
    </div>
  ),
}));

import { ColorControl } from "../ColorControl";
import { THEME_DESIGN_COLOR_INHERITANCE, THEME_DESIGN_DEFAULTS } from "@/lib/theme/themeDesign";
import type { ThemeDesign } from "@/lib/theme/themeDesign";
import type { PreviewMode } from "../../types";

const RM_TOKEN = THEME_DESIGN_COLOR_INHERITANCE.readMoreButton.color.token;

function draftWith(patch: Partial<ThemeDesign> = {}): ThemeDesign {
  return { ...THEME_DESIGN_DEFAULTS, ...patch } as ThemeDesign;
}

function renderControl(opts: {
  mode?: PreviewMode;
  draft?: ThemeDesign;
  section?: string;
  field?: string;
}) {
  const setColor = vi.fn();
  render(
    <ColorControl
      section={opts.section ?? "readMoreButton"}
      field={opts.field ?? "color"}
      mode={opts.mode ?? "light"}
      draft={opts.draft ?? draftWith()}
      setColor={setColor}
    />,
  );
  return { setColor };
}

const text = (id: string) => screen.getByTestId(id).textContent;

describe("ColorControl - tryb JASNY", () => {
  it("pokazuje wartość sekcji jako wartość kontrolki", () => {
    renderControl({
      draft: draftWith({
        readMoreButton: { ...THEME_DESIGN_DEFAULTS.readMoreButton, color: "#123456" },
      }),
    });
    expect(text("value")).toBe("#123456");
  });

  it("podpowiada TOKEN dziedziczenia, a nie zgadnięty kolor", () => {
    // Podpowiedź musi wskazywać `var(--gc-*)`, bo to ona mówi redaktorowi,
    // skąd wartość przyjdzie, gdy pola nie ustawi.
    renderControl({});
    expect(text("inherited")).toBe(RM_TOKEN);
    expect(text("placeholder")).toBe(RM_TOKEN);
  });

  it("pole spoza mapy dziedziczenia podpowiada `auto`", () => {
    renderControl({ section: "nieznana", field: "color" });
    expect(text("placeholder")).toBe("auto");
  });

  it("pole o wartości innej niż napis czytane jest jako PUSTE", () => {
    // `readColor` broni się przed wierszem z bazy o złym typie: liczba w polu
    // koloru nie może trafić do CSS jako `--td-rm-color:42`.
    const broken = draftWith({
      readMoreButton: {
        ...THEME_DESIGN_DEFAULTS.readMoreButton,
        color: 42 as unknown as string,
      },
    });
    renderControl({ draft: broken });
    expect(text("value")).toBe("");
  });

  it("zapisuje wybrany kolor pod sekcją i polem", () => {
    const { setColor } = renderControl({});
    fireEvent.click(screen.getByRole("button", { name: "ustaw" }));
    expect(setColor).toHaveBeenCalledWith("readMoreButton", "color", "#abcdef");
  });

  it("wyczyszczenie w trybie jasnym WRACA DO TOKENU, nie do pustki", () => {
    // Pusta wartość w sekcji jasnej dałaby brak zmiennej CSS - element
    // straciłby kolor zamiast odziedziczyć globalny.
    const { setColor } = renderControl({});
    fireEvent.click(screen.getByRole("button", { name: "wyczyść" }));
    expect(setColor).toHaveBeenCalledWith("readMoreButton", "color", RM_TOKEN);
  });

  it("oferuje powrót do dziedziczenia, gdy kolor RÓŻNI SIĘ od tokenu", () => {
    const { setColor } = renderControl({
      draft: draftWith({
        readMoreButton: { ...THEME_DESIGN_DEFAULTS.readMoreButton, color: "#123456" },
      }),
    });
    const reset = screen.getByRole("button", { name: /dziedzicz|inherit|↩/i });
    fireEvent.click(reset);
    expect(setColor).toHaveBeenCalledWith("readMoreButton", "color", RM_TOKEN);
  });

  it("NIE oferuje powrotu, gdy kolor JEST tokenem dziedziczenia", () => {
    // Przycisk „wróć do dziedziczenia” przy wartości już odziedziczonej byłby
    // martwy - i sugerowałby, że coś jest nadpisane, choć nie jest.
    renderControl({});
    expect(screen.queryByRole("button", { name: /dziedzicz|inherit|↩/i })).toBeNull();
  });
});

describe("ColorControl - tryb CIEMNY", () => {
  const withDark = (value: string) =>
    draftWith({ darkOverrides: { readMoreButton: { color: value } } });

  it("pokazuje nadpisanie ciemne, nie wartość jasną", () => {
    renderControl({ mode: "dark", draft: withDark("#000000") });
    expect(text("value")).toBe("#000000");
  });

  it("bez nadpisania pokazuje PUSTE pole - to znaczy „dziedzicz”", () => {
    renderControl({ mode: "dark" });
    expect(text("value")).toBe("");
  });

  it("dziedziczy WARTOŚĆ JASNĄ, gdy redaktor ją ustawił", () => {
    renderControl({
      mode: "dark",
      draft: draftWith({
        readMoreButton: { ...THEME_DESIGN_DEFAULTS.readMoreButton, color: "#123456" },
      }),
    });
    expect(text("inherited")).toBe("#123456");
    expect(text("placeholder")).toBe("#123456");
  });

  it("dziedziczy TOKEN, gdy wartość jasna jest pusta", () => {
    renderControl({
      mode: "dark",
      draft: draftWith({
        readMoreButton: { ...THEME_DESIGN_DEFAULTS.readMoreButton, color: "" },
      }),
    });
    expect(text("inherited")).toBe(RM_TOKEN);
  });

  it("wyczyszczenie w trybie ciemnym USUWA nadpisanie (null), nie wpisuje tokenu", () => {
    // Wpisanie tokenu utrwaliłoby nadpisanie na zawsze; `null` przywraca
    // dziedziczenie po wartości jasnej.
    const { setColor } = renderControl({ mode: "dark", draft: withDark("#000000") });
    fireEvent.click(screen.getByRole("button", { name: "wyczyść" }));
    expect(setColor).toHaveBeenCalledWith("readMoreButton", "color", null);
  });

  it("powrót do dziedziczenia w trybie ciemnym też usuwa nadpisanie", () => {
    const { setColor } = renderControl({ mode: "dark", draft: withDark("#000000") });
    fireEvent.click(screen.getByRole("button", { name: /dziedzicz|inherit|↩/i }));
    expect(setColor).toHaveBeenCalledWith("readMoreButton", "color", null);
  });

  it("BEZ nadpisania nie oferuje powrotu do dziedziczenia", () => {
    renderControl({ mode: "dark" });
    expect(screen.queryByRole("button", { name: /dziedzicz|inherit|↩/i })).toBeNull();
  });

  it("oferuje powrót nawet wtedy, gdy nadpisanie równa się wartości jasnej", () => {
    // W trybie ciemnym liczy się SAM FAKT nadpisania - identyczna wartość i tak
    // odcina automatyczne przełączanie tokenu w motywie ciemnym.
    renderControl({
      mode: "dark",
      draft: draftWith({
        readMoreButton: { ...THEME_DESIGN_DEFAULTS.readMoreButton, color: "#123456" },
        darkOverrides: { readMoreButton: { color: "#123456" } },
      }),
    });
    expect(screen.getByRole("button", { name: /dziedzicz|inherit|↩/i })).toBeTruthy();
  });
});
