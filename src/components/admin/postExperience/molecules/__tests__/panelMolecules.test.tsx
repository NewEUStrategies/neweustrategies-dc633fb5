// Dwie molekuły współdzielone przez WSZYSTKIE panele modułu: pasek zapisu i
// przełącznik języka podglądu. Obie scaliły kopie o rozjechanych umowach, więc
// test opisuje tu umowę, a nie wygląd.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// Fabryka importuje `@/test/i18nStub` - moduł BEZ importów z produkcji.
// Sięgnięcie tu po fixture'y obszaru domyka cykl inicjalizacji (fixture'y ->
// warstwa ustawień -> lib/i18n -> react-i18next -> ta fabryka) i ZAWIESZA plik.
vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { selectPrimitiveStub } = await import("@/test/postExperience/fixtures");
  return selectPrimitiveStub(React);
});

vi.mock("@/components/admin/RelatedLayoutPreview", () => ({
  RelatedLayoutPreview: ({ value }: { value: string }) => <div data-testid="preview">{value}</div>,
}));

vi.mock("@/components/admin/LayoutPreview", () => ({
  LayoutPreview: ({ preset }: { preset: { id: string } }) => (
    <span data-testid="layout-preview" data-preset={preset.id} />
  ),
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
      onClick={() => onChange(undefined)}
    >
      {value}
    </button>
  ),
}));

import { PanelSaveBar } from "@/components/admin/postExperience/molecules/PanelSaveBar";
import { PreviewLangTabs } from "@/components/admin/postExperience/molecules/PreviewLangTabs";
import { KeyTakeawaysHighlightSection } from "@/components/admin/postExperience/molecules/KeyTakeawaysHighlightSection";
import { RelatedPostsConfigSection } from "@/components/admin/postExperience/molecules/RelatedPostsConfigSection";
import { RelatedPostsEngineSection } from "@/components/admin/postExperience/molecules/RelatedPostsEngineSection";
import { PostLayoutGroup } from "@/components/admin/postExperience/molecules/PostLayoutGroup";
import { RELATED_POSTS_DEFAULTS } from "@/lib/relatedPosts";
import { STANDARD_LAYOUTS, defaultPostLayoutSettings } from "@/lib/postLayouts";
import type { KeyTakeawaysSettings } from "@/lib/keyTakeaways/settings";

const labels = {
  saveLabel: "Zapisz",
  savingLabel: "Zapisywanie…",
  resetLabel: "Przywróć domyślne",
};

function renderBar(over: Partial<Parameters<typeof PanelSaveBar>[0]> = {}) {
  const onSave = vi.fn();
  const onReset = vi.fn();
  render(
    <PanelSaveBar
      canSave={false}
      canReset={false}
      pending={false}
      {...labels}
      onSave={onSave}
      onReset={onReset}
      {...over}
    />,
  );
  return { onSave, onReset };
}

const save = () => screen.getByRole("button", { name: /Zapisz|Zapisywanie/ });
const reset = () => screen.getByRole("button", { name: "Przywróć domyślne" });

describe("PanelSaveBar - umowa paska zapisu", () => {
  it("BEZ ZMIAN oba przyciski są wyłączone (zapis przy zerowej zmianie nie leci do bazy)", () => {
    renderBar();
    expect(save()).toBeDisabled();
    expect(reset()).toBeDisabled();
  });

  it("ZMIANA odblokowuje zapis i reset", () => {
    renderBar({ canSave: true, canReset: true });
    expect(save()).not.toBeDisabled();
    expect(reset()).not.toBeDisabled();
  });

  it("W TRAKCIE ZAPISU oba przyciski są wyłączone, także przy niezapisanych zmianach", () => {
    // Kopia z panelu układów wpisu była surowym `<button>` bez stanu
    // wyłączonego - podwójne kliknięcie posyłało dwa zapisy.
    renderBar({ canSave: true, canReset: true, pending: true });
    expect(save()).toBeDisabled();
    expect(reset()).toBeDisabled();
  });

  it("W TRAKCIE ZAPISU napis ogłasza stan, a nie zaprasza do kliknięcia", () => {
    renderBar({ canSave: true, pending: true });
    expect(screen.getByRole("button", { name: "Zapisywanie…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zapisz" })).toBeNull();
  });

  it("DWIE OSOBNE FLAGI: reset może być czynny, gdy zapis nie ma sensu", () => {
    // „Zapisz" pyta o różnicę wobec bazy, „przywróć domyślne" - wobec wartości
    // domyślnych. Molekuła nie liczy żadnej z nich, tylko je rozdziela.
    renderBar({ canSave: false, canReset: true });
    expect(save()).toBeDisabled();
    expect(reset()).not.toBeDisabled();
  });

  it("kliknięcie zapisu zgłasza intencję dokładnie raz", () => {
    const { onSave, onReset } = renderBar({ canSave: true });
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onReset).not.toHaveBeenCalled();
  });

  it("kliknięcie resetu zgłasza intencję dokładnie raz", () => {
    const { onSave, onReset } = renderBar({ canReset: true });
    fireEvent.click(reset());
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("ikony są UKRYTE dla czytnika ekranu - nazwą przycisku jest napis", () => {
    const { onSave } = renderBar({ canSave: true, canReset: true });
    const icons = document.querySelectorAll("svg[aria-hidden='true']");
    expect(icons.length).toBe(2);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("PreviewLangTabs - przełącznik języka podglądu", () => {
  it("lista zakładek ma NAZWĘ GRUPY, a aktywna zakładka jest zaznaczona", () => {
    render(<PreviewLangTabs value="pl" onChange={() => {}} label="Język podglądu" />);
    expect(screen.getByRole("tablist", { name: "Język podglądu" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "PL" })).toHaveAttribute("aria-selected", "true");
  });

  it("wybór EN zgłasza `en`", () => {
    const onChange = vi.fn();
    render(<PreviewLangTabs value="pl" onChange={onChange} label="Język podglądu" />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "EN" }));
    expect(onChange).toHaveBeenCalledWith("en");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("wybór PL zgłasza `pl` - NORMALIZACJA pilnuje obu kierunków", () => {
    // Radix oddaje `string`, więc cokolwiek innego niż `en` musi zejść do `pl`.
    // Bez tego stan podglądu mógłby wyjść poza dwa dozwolone języki.
    const onChange = vi.fn();
    render(<PreviewLangTabs value="en" onChange={onChange} label="Język podglądu" />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "PL" }));
    expect(onChange).toHaveBeenCalledWith("pl");
    expect(screen.getByRole("tab", { name: "EN" })).toHaveAttribute("aria-selected", "true");
  });

  it("NIE pokazuje flagi państwa jako nazwy języka", () => {
    // Kopia z panelu ToC miała emoji flag, więc czytnik ekranu ogłaszał
    // „flaga Polski PL". Flaga nie jest nazwą języka.
    render(<PreviewLangTabs value="pl" onChange={() => {}} label="Język podglądu" />);
    const names = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(names).toEqual(["PL", "EN"]);
    expect(names.join("")).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("KeyTakeawaysHighlightSection - STARSZY wiersz bez pól podświetlenia", () => {
  // Pola `indicesEn`, `color`, `sizeScale` i `offsetY` doszły do schematu
  // później. Wiersz zapisany wcześniej ich nie ma, a molekuła musi wtedy podać
  // wartości domyślne - inaczej suwak dostaje `undefined` i staje się
  // kontrolką niekontrolowaną, a selektor barwy pokazuje puste okienko.
  const legacy = { indicesPl: [0] } as unknown as KeyTakeawaysSettings["highlight"];

  it("BRAK listy indeksów dla języka czyta się jako pusta lista", () => {
    const onChange = vi.fn();
    render(
      <KeyTakeawaysHighlightSection
        labelPl="Z tego"
        labelEn="From this"
        highlight={legacy}
        accent="#fa9346"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("button", { name: "From" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "this" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ indicesEn: [1] }));
  });

  it("BRAK koloru podświetlenia schodzi do koloru akcentu sekcji", () => {
    render(
      <KeyTakeawaysHighlightSection
        labelPl="Z tego"
        labelEn=""
        highlight={legacy}
        accent="#fa9346"
        onChange={() => {}}
      />,
    );
    const picker = screen.getByRole("button", {
      name: "adminPostPanes.keyTakeaways.highlightColor",
    });
    expect(picker).toHaveAttribute("data-color", "#fa9346");
    expect(screen.getByRole("slider", { name: /highlightSize/ })).toHaveValue("1");
  });

  it("WYCZYSZCZENIE koloru wraca do akcentu, a nie do pustej wartości", () => {
    const onChange = vi.fn();
    render(
      <KeyTakeawaysHighlightSection
        labelPl="Z tego"
        labelEn=""
        highlight={legacy}
        accent="#fa9346"
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "adminPostPanes.keyTakeaways.highlightColor" }),
    );
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ color: "#fa9346" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("BRAK przesunięcia czyta się jako zero i suwak zostaje kontrolowany", () => {
    render(
      <KeyTakeawaysHighlightSection
        labelPl="Z tego"
        labelEn=""
        highlight={legacy}
        accent="#fa9346"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("slider", { name: /highlightOffset/ })).toHaveValue("0");
    expect(screen.getByText("0px")).toBeInTheDocument();
  });
});

describe("sekcje rekomendacji - stan zapisu w toku", () => {
  // Napis „zapisuję" jest jedynym sygnałem, że kliknięcie zadziałało: panel nie
  // ma osobnego wskaźnika postępu, a zapis idzie przez sieć.
  it("konfiguracja podstawowa ogłasza stan zapisu i blokuje przycisk", () => {
    render(
      <RelatedPostsConfigSection
        form={RELATED_POSTS_DEFAULTS}
        onChange={() => {}}
        onSave={() => {}}
        pending
      />,
    );
    const button = screen.getByRole("button", { name: "adminRelatedPosts.actions.saving" });
    expect(button).toBeDisabled();
    expect(screen.queryByRole("button", { name: "adminRelatedPosts.actions.save" })).toBeNull();
  });

  it("zakładka silnika ogłasza ten sam stan pod własnym napisem zapisu", () => {
    render(
      <RelatedPostsEngineSection
        form={RELATED_POSTS_DEFAULTS}
        onChange={() => {}}
        onSave={() => {}}
        pending
      />,
    );
    expect(screen.getByRole("button", { name: "adminRelatedPosts.actions.saving" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "adminRelatedPosts.actions.saveWeights" }),
    ).toBeNull();
  });
});

describe("PostLayoutGroup - przypadki brzegowe katalogu presetów", () => {
  const settings = defaultPostLayoutSettings();

  it("PUSTY katalog presetów nie renderuje sekcji zamiast się przewracać", () => {
    // Katalog może wyjść pusty po migracji albo po wycięciu formatu. Molekuła
    // musi wtedy zniknąć, a nie sięgnąć po `selected.label` z `undefined`.
    const { container } = render(
      <PostLayoutGroup
        group={{ field: "standard_layout", titleKey: "grupa", presets: [] }}
        settings={settings}
        onPatch={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("BRAK wybranego układu w ustawieniach schodzi na pierwszy preset katalogu", () => {
    const bare = { ...settings, standard_layout: undefined } as never;
    render(
      <PostLayoutGroup
        group={{ field: "standard_layout", titleKey: "grupa", presets: STANDARD_LAYOUTS }}
        settings={bare}
        onPatch={() => {}}
      />,
    );
    const preview = screen.getByRole("complementary", {
      name: "adminLayouts.postLayouts.livePreview",
    });
    expect(within(preview).getByTestId("layout-preview")).toHaveAttribute(
      "data-preset",
      STANDARD_LAYOUTS[0].id,
    );
    expect(screen.getAllByText(STANDARD_LAYOUTS[0].label).length).toBeGreaterThan(0);
  });
});
