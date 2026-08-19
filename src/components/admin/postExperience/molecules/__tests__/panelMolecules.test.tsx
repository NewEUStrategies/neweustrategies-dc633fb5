// Dwie molekuły współdzielone przez WSZYSTKIE panele modułu: pasek zapisu i
// przełącznik języka podglądu. Obie scaliły kopie o rozjechanych umowach, więc
// test opisuje tu umowę, a nie wygląd.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PanelSaveBar } from "@/components/admin/postExperience/molecules/PanelSaveBar";
import { PreviewLangTabs } from "@/components/admin/postExperience/molecules/PreviewLangTabs";

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
