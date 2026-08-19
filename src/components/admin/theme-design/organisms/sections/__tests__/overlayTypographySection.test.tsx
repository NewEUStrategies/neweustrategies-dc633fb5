// TYPOGRAFIA OVERLAY WPISU - dwunasta sekcja edytora, do 19.08.2026 na zerze
// (17-44 bez wykonania), razem z molekułą wiersza rozmiarów.
//
// Sekcja steruje CZTEREMA niezależnymi czwórkami pól (tytuł i podtytuł, osobno
// dla overlay na cover photo i dla klasycznego nagłówka), każda po trzy
// breakpointy - dwanaście liczb o niemal identycznych nazwach. Podpięcie
// wiersza pod cudzy prefiks nie daje błędu typów (wszystkie to `number`), nie
// wywraca renderu i objawia się dopiero na produkcji: redaktor ustawia rozmiar
// tytułu na komórce, a zmienia się podtytuł nagłówka klasycznego.
//
// Druga reguła to ŹRÓDŁO rozmiarów. Gdy sekcja dziedziczy z Opcji motywu,
// wszystkie dwanaście pól jest bez znaczenia - i musi być wyłączone, inaczej
// redaktor ustawia wartości, które nigdzie nie zadziałają.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@/lib/i18n-admin-theme-design";
import { OverlayTypographySection } from "../OverlayTypographySection";
import { defaultPostLayoutSettings, type PostLayoutSettings } from "@/lib/postLayouts";

function setup(overrides: Partial<PostLayoutSettings> = {}) {
  const draft: PostLayoutSettings = { ...defaultPostLayoutSettings(), ...overrides };
  const onChange = vi.fn();
  const view = render(<OverlayTypographySection draft={draft} onChange={onChange} />);
  return { draft, onChange, view };
}

/** Ostatnia wersja robocza zgłoszona do rodzica. */
function lastPatch(onChange: ReturnType<typeof vi.fn>): PostLayoutSettings {
  return onChange.mock.calls.at(-1)?.[0] as PostLayoutSettings;
}

/**
 * Pole liczbowe wskazanego breakpointu w wierszu o danej etykiecie.
 *
 * Etykiety wierszy („Tytuł", „Podtytuł / excerpt") POWTARZAJĄ się między
 * grupami, więc adresujemy przez nadrzędną sekcję („Overlay (na cover photo)"
 * albo „Nagłówek klasyczny (bez cover)") - dokładnie tak, jak robi to wzrokiem
 * redaktor.
 */
function sizeInput(grupa: string, wiersz: string, breakpoint: RegExp): HTMLInputElement {
  const blok = screen.getByText(grupa).closest("div");
  if (!blok) throw new Error(`brak grupy ${grupa}`);
  const wierszEl = within(blok).getByText(wiersz).closest("div");
  if (!wierszEl) throw new Error(`brak wiersza ${wiersz} w grupie ${grupa}`);
  const komorka = within(wierszEl).getByText(breakpoint).closest("div");
  const input = komorka?.querySelector("input");
  if (!input) throw new Error(`brak kontrolki ${String(breakpoint)} w wierszu ${wiersz}`);
  return input as HTMLInputElement;
}

const MOBILE = /Mobile/;
const TABLET = /Tablet/;
const DESKTOP = /Desktop/;
const OVERLAY = "Overlay (na cover photo)";
const KLASYCZNY = "Nagłówek klasyczny (bez cover)";

describe("OverlayTypographySection - źródło rozmiarów", () => {
  it("domyślnie DZIEDZICZY rozmiary z Opcji motywu", () => {
    setup();
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("wyłączenie przełącznika przestawia źródło na layout", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("switch"));

    expect(lastPatch(onChange).title_size_source).toBe("layout");
  });

  it("włączenie przełącznika wraca do motywu", () => {
    const { onChange } = setup({ title_size_source: "layout" });
    fireEvent.click(screen.getByRole("switch"));

    expect(lastPatch(onChange).title_size_source).toBe("theme");
  });

  it("przy dziedziczeniu pola rozmiarów są WYŁĄCZONE", () => {
    // Inaczej redaktor ustawia dwanaście liczb, które nigdzie nie zadziałają.
    const { view } = setup({ title_size_source: "theme" });
    const wylaczone = view.container.querySelectorAll('[aria-disabled="true"]');

    expect(wylaczone).toHaveLength(2);
    for (const blok of Array.from(wylaczone)) {
      expect(blok.className).toContain("pointer-events-none");
    }
  });

  it("po przestawieniu na layout pola są dostępne", () => {
    const { view } = setup({ title_size_source: "layout" });
    expect(view.container.querySelectorAll('[aria-disabled="true"]')).toHaveLength(0);
  });
});

describe("OverlayTypographySection - każdy wiersz pisze do WŁASNEJ czwórki pól", () => {
  it.each([
    [OVERLAY, "Tytuł", MOBILE, "overlay_title_size_base"],
    [OVERLAY, "Tytuł", TABLET, "overlay_title_size_md"],
    [OVERLAY, "Tytuł", DESKTOP, "overlay_title_size_lg"],
    [OVERLAY, "Podtytuł / excerpt", MOBILE, "overlay_excerpt_size_base"],
    [OVERLAY, "Podtytuł / excerpt", TABLET, "overlay_excerpt_size_md"],
    [OVERLAY, "Podtytuł / excerpt", DESKTOP, "overlay_excerpt_size_lg"],
    [KLASYCZNY, "Tytuł", MOBILE, "header_title_size_base"],
    [KLASYCZNY, "Tytuł", TABLET, "header_title_size_md"],
    [KLASYCZNY, "Tytuł", DESKTOP, "header_title_size_lg"],
    [KLASYCZNY, "Podtytuł / excerpt", MOBILE, "header_excerpt_size_base"],
    [KLASYCZNY, "Podtytuł / excerpt", TABLET, "header_excerpt_size_md"],
    [KLASYCZNY, "Podtytuł / excerpt", DESKTOP, "header_excerpt_size_lg"],
  ])("%s / %s / %s -> %s", (grupa, wiersz, breakpoint, klucz) => {
    const { onChange } = setup({ title_size_source: "layout" });
    // 41 nie jest domyślną wartością ŻADNEGO z dwunastu pól, więc kontrolka
    // sterowana na pewno zgłosi zmianę.
    fireEvent.change(sizeInput(grupa, wiersz, breakpoint as RegExp), { target: { value: "41" } });

    const patch = lastPatch(onChange);
    expect(patch[klucz as keyof PostLayoutSettings]).toBe(41);
  });

  it("zmiana JEDNEGO pola nie rusza pozostałych jedenastu", () => {
    // `patch` scala z całą wersją roboczą; gdyby zwracał sam fragment,
    // pierwsza edycja skasowałaby resztę ustawień layoutu wpisu.
    const { draft, onChange } = setup({ title_size_source: "layout" });
    fireEvent.change(sizeInput(OVERLAY, "Tytuł", MOBILE), { target: { value: "41" } });

    const patch = lastPatch(onChange);
    expect(patch.overlay_title_size_md).toBe(draft.overlay_title_size_md);
    expect(patch.header_excerpt_size_lg).toBe(draft.header_excerpt_size_lg);
    expect(patch.layout_sidebar_overrides).toEqual(draft.layout_sidebar_overrides);
  });

  it("pokazuje wartości z BIEŻĄCEJ wersji roboczej, nie z domyślnych", () => {
    setup({ title_size_source: "layout", overlay_title_size_lg: 77 });
    expect(sizeInput(OVERLAY, "Tytuł", DESKTOP).value).toBe("77");
  });
});
