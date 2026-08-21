// Biblioteka ikon Lucide: wyszukiwanie + kategorie + siatka.
//
// Dwie rzeczy w tym pliku są nietypowe i obie są tu przypięte celowo:
//
//  1. Katalog nazw jest liczony LENIWIE (`getAllIconNames`), bo skan całej
//     przestrzeni nazw w czasie inicjalizacji modułu wywalał start route-modułu
//     na workerd i 500-ił cały serwis. Test podstawia własny, mały katalog -
//     dzięki temu sprawdza REGUŁY (filtr nazw, przypisanie do kategorii,
//     liczniki), a nie 1500 ikon Lucide, których zestaw i tak zmienia się
//     z każdą aktualizacją biblioteki.
//  2. `DynamicIcon` jest atrapą: renderuje nazwę w atrybucie. Prawdziwa ikona
//     dociąga osobny chunk i ma własne testy - tutaj liczy się WYŁĄCZNIE to,
//     którą nazwę picker do niej wysyła.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { LucideIconPicker } from "../LucideIconPicker";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/lib/icons/DynamicIcon", () => ({
  DynamicIcon: ({ name }: { name: string }) => <span data-icon={name} />,
}));
vi.mock("@/lib/icons/lucideIconNodes.generated", () => ({
  LUCIDE_ICON_NODES: {
    // strzałki
    "arrow-right": [],
    "chevron-down": [],
    // układ
    "layout-grid": [],
    // tekst
    type: [],
    // media
    film: [],
    // pogoda
    "cloud-sun": [],
    // bez kategorii -> „inne”
    "neweu-logo": [],
    // nazwy odrzucane przez filtr katalogu
    ArrowRight: [],
    icon_with_underscore: [],
    "icon.with.dot": [],
  },
}));

function renderPicker(initial?: string) {
  const onChange = vi.fn();
  function Host() {
    const [value, setValue] = useState<string | undefined>(initial);
    return (
      <LucideIconPicker
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Host />);
  return { onChange, trigger: () => screen.getByLabelText("builder.iconPicker.ariaOpen") };
}

const search = (): HTMLInputElement =>
  document.querySelector<HTMLInputElement>('input[placeholder="builder.iconPicker.searchPh"]')!;

const gridIcons = (): string[] =>
  Array.from(document.querySelectorAll<HTMLElement>(".grid button")).map(
    (b) => b.getAttribute("aria-label") ?? "",
  );

describe("LucideIconPicker - przycisk", () => {
  it("bez wybranej ikony pokazuje podpowiedź", () => {
    renderPicker();
    expect(screen.getByText("builder.iconPicker.placeholderDefault")).toBeInTheDocument();
  });

  it("własna podpowiedź nadpisuje słownikową", () => {
    render(<LucideIconPicker value={undefined} onChange={vi.fn()} placeholder="wybierz ikonę" />);
    expect(screen.getByText("wybierz ikonę")).toBeInTheDocument();
  });

  it("wybrana ikona pokazuje swoją nazwę i podglądem jest ona sama", () => {
    renderPicker("film");
    expect(screen.getByText("film")).toBeInTheDocument();
    expect(document.querySelector('[data-icon="film"]')).not.toBeNull();
  });

  it("wartość z samych spacji traktujemy jak brak ikony", () => {
    renderPicker("   ");
    expect(screen.getByText("builder.iconPicker.placeholderDefault")).toBeInTheDocument();
  });

  it("przyjmuje własną klasę", () => {
    render(<LucideIconPicker value={undefined} onChange={vi.fn()} className="w-full" />);
    expect(screen.getByLabelText("builder.iconPicker.ariaOpen").className).toContain("w-full");
  });
});

describe("LucideIconPicker - katalog nazw", () => {
  it("odsiewa nazwy niebędące kebab-case", () => {
    const { trigger } = renderPicker();
    fireEvent.click(trigger());
    const names = gridIcons();
    // Katalog wygenerowany zawiera także klucze pomocnicze - do siatki wchodzą
    // wyłącznie nazwy, które rozumie resolwer (`^[a-z0-9-]+$`).
    expect(names).not.toContain("ArrowRight");
    expect(names).not.toContain("icon_with_underscore");
    expect(names).not.toContain("icon.with.dot");
    expect(names).toContain("arrow-right");
  });

  it("sortuje nazwy alfabetycznie", () => {
    const { trigger } = renderPicker();
    fireEvent.click(trigger());
    const names = gridIcons();
    expect(names).toEqual([...names].sort());
  });

  it("stopka podaje liczbę widocznych i wszystkich ikon", () => {
    const { trigger } = renderPicker();
    fireEvent.click(trigger());
    expect(screen.getByText(/7 \/ 7 builder.iconPicker.iconsSuffix/)).toBeInTheDocument();
  });

  it("stopka dopisuje wybraną ikonę", () => {
    const { trigger } = renderPicker("film");
    fireEvent.click(trigger());
    expect(screen.getByText(/builder.iconPicker.selected: film/)).toBeInTheDocument();
  });
});

describe("LucideIconPicker - wyszukiwanie", () => {
  it("filtruje po fragmencie nazwy", () => {
    const { trigger } = renderPicker();
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "arrow" } });
    expect(gridIcons()).toEqual(["arrow-right"]);
  });

  it("ignoruje wielkość liter i spacje wokół frazy", () => {
    const { trigger } = renderPicker();
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "  FILM  " } });
    expect(gridIcons()).toEqual(["film"]);
  });

  it("wyczyszczenie frazy przywraca cały katalog", () => {
    const { trigger } = renderPicker();
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "arrow" } });
    fireEvent.change(search(), { target: { value: "" } });
    expect(gridIcons()).toHaveLength(7);
  });

  it("fraza bez trafień pokazuje komunikat, nie pustą siatkę", () => {
    const { trigger } = renderPicker();
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "zzz" } });
    expect(screen.getByText("builder.iconPicker.noResults")).toBeInTheDocument();
    expect(gridIcons()).toHaveLength(0);
  });
});

describe("LucideIconPicker - kategorie", () => {
  const catButton = (key: string) =>
    screen.getByText(`builder.iconPicker.${key}`).closest("button") as HTMLButtonElement;

  it("startuje na kategorii „wszystkie” z licznikiem całego katalogu", () => {
    const { trigger } = renderPicker();
    fireEvent.click(trigger());
    const all = catButton("all");
    expect(all.className).toContain("bg-primary");
    expect(all.textContent).toContain("7");
  });

  it("kliknięcie kategorii zawęża siatkę", () => {
    const { trigger } = renderPicker();
    fireEvent.click(trigger());
    fireEvent.click(catButton("arrows"));
    // „chevron-down” też jest strzałką - kategoria dopasowuje wzorcem, nie
    // dosłowną nazwą.
    expect(gridIcons()).toEqual(["arrow-right", "chevron-down"]);
  });

  it("kategoria „inne” zbiera to, co nie wpadło do żadnej", () => {
    const { trigger } = renderPicker();
    fireEvent.click(trigger());
    fireEvent.click(catButton("other"));
    expect(gridIcons()).toEqual(["neweu-logo"]);
  });

  it("kategoria bez ikon jest wyłączona", () => {
    const { trigger } = renderPicker();
    fireEvent.click(trigger());
    const empty = catButton("shopping");
    // Wyłączona, a nie ukryta: lista kategorii ma być stabilna, żeby redakcja
    // uczyła się jej układu.
    expect(empty).toBeDisabled();
    expect(empty.className).toContain("cursor-not-allowed");
    expect(empty.textContent).toContain("0");
  });

  it("liczniki kategorii idą za frazą wyszukiwania", () => {
    const { trigger } = renderPicker();
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "arrow" } });
    expect(catButton("arrows").textContent).toContain("1");
    expect(catButton("all").textContent).toContain("1");
    expect(catButton("other")).toBeDisabled();
  });

  it("wybrana kategoria bez trafień w nowej frazie daje pustą siatkę", () => {
    const { trigger } = renderPicker();
    fireEvent.click(trigger());
    fireEvent.click(catButton("arrows"));
    fireEvent.change(search(), { target: { value: "film" } });
    // Kategoria zostaje wybrana - komunikat „brak wyników” jest tu poprawną
    // odpowiedzią, a nie cichym przeskokiem na „wszystkie”.
    expect(screen.getByText("builder.iconPicker.noResults")).toBeInTheDocument();
  });
});

describe("LucideIconPicker - wybór ikony", () => {
  it("klik w ikonę zapisuje jej nazwę i zamyka bibliotekę", () => {
    const { onChange, trigger } = renderPicker();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByLabelText("film"));
    expect(onChange).toHaveBeenCalledWith("film");
    expect(screen.queryByPlaceholderText("builder.iconPicker.searchPh")).toBeNull();
  });

  it("aktualnie wybrana ikona jest wyróżniona w siatce", () => {
    const { trigger } = renderPicker("film");
    fireEvent.click(trigger());
    expect(screen.getByLabelText("film").className).toContain("border-primary");
    expect(screen.getByLabelText("type").className).toContain("border-transparent");
  });

  it("przycisk czyszczenia pojawia się tylko przy wybranej ikonie", () => {
    const { trigger } = renderPicker();
    fireEvent.click(trigger());
    expect(screen.queryByLabelText("builder.iconPicker.clearIcon")).toBeNull();
  });

  it("czyszczenie zdejmuje ikonę i zamyka bibliotekę", () => {
    const { onChange, trigger } = renderPicker("film");
    fireEvent.click(trigger());
    fireEvent.click(screen.getByLabelText("builder.iconPicker.clearIcon"));
    // `undefined`, nie pusty napis - pole ikony rozumie brak wartości.
    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(screen.queryByPlaceholderText("builder.iconPicker.searchPh")).toBeNull();
  });
});
