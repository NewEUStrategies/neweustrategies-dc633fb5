// PANEL „Tła motywu" / „Kolory pól tekstowych" (`ThemeBackgroundsPane`).
//
// CO TEN PLIK PRZYPINA (a czego nie widać z samego montażu komponentu):
//   1. SZKIC JEST KOPIĄ WIERSZA Z BAZY, NIE JEGO REFERENCJĄ. Panel scala
//      zapisane kolory z `EMPTY_GLOBAL_COLORS`, a przycisk „Anuluj" wraca
//      DOKŁADNIE do tej scalonej wartości - nie do pustego zestawu. Bez tego
//      anulowanie edycji czyściłoby paletę zamiast ją przywracać.
//   2. ZAPIS WYSYŁA CAŁY ZESTAW KOLORÓW, nie samą zmienioną gałąź.
//      `site_design_tokens.global_colors` to JEDNA kolumna JSONB - wysłanie
//      samego delta wymazałoby wszystkie pozostałe sloty.
//   3. RESET POJEDYNCZEGO POLA ZAPISUJE PUSTY STRING, NIE `undefined`.
//      `ColorField` robi `onChange(v ?? "")`; gdyby przepuszczał `undefined`,
//      klucz zniknąłby z JSON-a i front wróciłby do wartości domyślnej motywu
//      bez śladu w panelu - czyli „reset" wyglądałby jak „nic się nie zapisało".
//   4. PODGLĄD NA ŻYWO JEST POCHODNĄ SZKICU, nie zapisanego wiersza: znacznik
//      `<style data-theme-backgrounds-preview>` przelicza `--gc-*` przy każdej
//      zmianie pola, jeszcze przed zapisem.
//   5. GRUPA „input" MA INNY UKŁAD niż pozostałe: dokłada podgląd pól
//      tekstowych (light + dark), a NIE rysuje kafli koloru pod slotami.
//   6. BŁĄD ZAPISU NIE KASUJE PRACY REDAKTORA - wpisane wartości zostają
//      w formularzu, a komunikat idzie kanałem `notifyError`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   - `AdminColorPicker` (własny komponent w `admin/blocks/`) jest ATRAPĄ:
//     potwierdza wyłącznie przekazane propy i daje przycisk resetu, bo tylko
//     tak da się wejść w gałąź `v ?? ""` panelu.
//   - `globalColorsToCss` / `GLOBAL_COLOR_GROUPS` mają własne testy
//     jednostkowe; tutaj sprawdzam, czy panel woła je z właściwym szkicem.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  colorPickerInputs,
  colorPickerResets,
  mountSettingsPane,
  paneToastSpies,
  type ColorPickerStubProps,
  type PropRecorder,
  type SettingsPaneSupabase,
} from "@/test/admin/settingsPaneHarness";
import type { SupabaseResult } from "@/test/supabase";

const stubs = vi.hoisted(() => ({
  supabase: null as unknown,
  toasts: null as unknown,
  colors: null as unknown,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

// Rejestracja słowników paneli - side-effect, który w teście nie ma nic do
// zrobienia (atrapa `react-i18next` i tak echuje klucze).
vi.mock("@/lib/i18n-admin-panes-misc", () => ({}));

vi.mock("@/integrations/supabase/client", async () => {
  const { settingsPaneSupabase: make } = await import("@/test/admin/settingsPaneHarness");
  const sb = make();
  stubs.supabase = sb;
  return { supabase: sb.client };
});

// Cache SSR jest PER IZOLAT i trzyma wiersz 60 s - bez przezroczystej atrapy
// drugi test w tym pliku dostałby paletę pierwszego.
vi.mock("@/lib/ssrCache", () => ({
  edgeTtlCache: async <T,>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
  invalidateEdgeTtlCache: async () => {},
  clearEdgeTtlCache: () => {},
}));

vi.mock("@/lib/notify", async () => {
  const { paneToastSpies: make } = await import("@/test/admin/settingsPaneHarness");
  const spies = make();
  stubs.toasts = spies;
  return spies.notify();
});

vi.mock("@/components/admin/blocks/AdminColorPicker", async () => {
  const { colorPickerStub, propRecorder: rec } = await import("@/test/admin/settingsPaneHarness");
  const recorder = rec<ColorPickerStubProps>();
  stubs.colors = recorder;
  return colorPickerStub(recorder);
});

import { ThemeBackgroundsPane } from "@/components/admin/ThemeBackgroundsPane";

const sb = () => stubs.supabase as SettingsPaneSupabase;
const toasts = () => stubs.toasts as ReturnType<typeof paneToastSpies>;
const pickers = () => stubs.colors as PropRecorder<ColorPickerStubProps>;

/** Zapisany wiersz `site_design_tokens` w kształcie, w jakim czyta go hook. */
function tokensRow(globalColors: Record<string, { light?: string; dark?: string }>) {
  return { colors: [], fonts: {}, scale: {}, global_colors: globalColors };
}

/** Czeka, aż panel wyjdzie ze stanu ładowania (szkic zasiany z bazy). */
async function waitForDraft(): Promise<void> {
  await waitFor(() => expect(screen.queryByText("adminPanesMisc.loading")).toBeNull());
}

beforeEach(() => {
  sb().reset();
  toasts().reset();
  pickers().reset();
});

afterEach(() => {
  cleanup();
});

describe("ThemeBackgroundsPane - wczytanie i wartości domyślne", () => {
  it("do czasu odpowiedzi bazy pokazuje komunikat ładowania zamiast pustego formularza", async () => {
    const deferred: { release: ((value: SupabaseResult) => void) | null } = { release: null };
    sb().setTableResponder(
      "site_design_tokens",
      () =>
        new Promise<SupabaseResult>((resolve) => {
          deferred.release = resolve;
        }),
    );

    mountSettingsPane(<ThemeBackgroundsPane />);
    expect(screen.getByText("adminPanesMisc.loading")).toBeInTheDocument();

    await waitFor(() => expect(deferred.release).not.toBeNull());
    deferred.release?.({ data: tokensRow({}), error: null });
    await waitForDraft();
    expect(screen.getByText("Body Background")).toBeInTheDocument();
  });

  it("bez zapisanych kolorów pola są puste, a domyślne wartości slotu jadą jako dziedziczone", async () => {
    sb().setTable("site_design_tokens", tokensRow({}));
    const { container } = mountSettingsPane(<ThemeBackgroundsPane />);
    await waitForDraft();

    // Grupa "body" ma cztery sloty, każdy z parą light/dark.
    const inputs = colorPickerInputs(container);
    expect(inputs).toHaveLength(8);
    expect(inputs.map((input) => input.value)).toEqual(["", "", "", "", "", "", "", ""]);
    expect(inputs[0].getAttribute("data-inherited")).toBe("#fcfcf9");
    expect(inputs[1].getAttribute("data-inherited")).toBe("#141414");

    // Kafle podglądu spadają na wartości domyślne slotu, nie na biel.
    const tiles = [...container.querySelectorAll<HTMLElement>("div[style]")].filter((node) =>
      node.textContent?.startsWith("Light preview"),
    );
    expect(tiles[0].style.background).toBe("#fcfcf9");

    // Nic nie zmienione => oba przyciski nieaktywne.
    expect(screen.getByRole("button", { name: /common.cancel/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /common.save/ })).toBeDisabled();
  });

  it("nieznane id grupy nie wywraca panelu - rysuje nagłówek i zero slotów", async () => {
    sb().setTable("site_design_tokens", tokensRow({}));
    const { container } = mountSettingsPane(<ThemeBackgroundsPane groupId="nie-ma-takiej" />);
    await waitForDraft();

    expect(colorPickerInputs(container)).toHaveLength(0);
    expect(screen.getByText("adminPanesMisc.themeBg.title")).toBeInTheDocument();
  });

  it("tytuł i opis wolno nadpisać propem (ta sama powierzchnia obsługuje cztery sekcje)", async () => {
    sb().setTable("site_design_tokens", tokensRow({}));
    mountSettingsPane(
      <ThemeBackgroundsPane
        groupId="icons"
        title="Kolory ikon"
        description="Ikony SVG w treści strony"
      />,
    );
    await waitForDraft();

    expect(screen.getByText("Kolory ikon")).toBeInTheDocument();
    expect(screen.getByText("Ikony SVG w treści strony")).toBeInTheDocument();
    expect(screen.queryByText("adminPanesMisc.themeBg.title")).toBeNull();
  });
});

describe("ThemeBackgroundsPane - wartości zapisane i podgląd", () => {
  it("zapisane kolory trafiają do pól ORAZ do zmiennych `--gc-*` podglądu", async () => {
    sb().setTable(
      "site_design_tokens",
      tokensRow({ "body-bg": { light: "#101010", dark: "#202020" } }),
    );
    const { container } = mountSettingsPane(<ThemeBackgroundsPane />);
    await waitForDraft();

    const inputs = colorPickerInputs(container);
    expect(inputs[0].value).toBe("#101010");
    expect(inputs[1].value).toBe("#202020");

    const style = container.querySelector("style[data-theme-backgrounds-preview]");
    expect(style?.innerHTML).toContain("--gc-body-bg: #101010;");
    expect(style?.innerHTML).toContain("--gc-body-bg: #202020;");
  });

  it("podgląd przelicza się PRZED zapisem - zmiana pola natychmiast zmienia `--gc-*`", async () => {
    sb().setTable("site_design_tokens", tokensRow({}));
    const { container } = mountSettingsPane(<ThemeBackgroundsPane />);
    await waitForDraft();

    fireEvent.change(colorPickerInputs(container)[0], { target: { value: "#abcdef" } });

    const style = container.querySelector("style[data-theme-backgrounds-preview]");
    expect(style?.innerHTML).toContain("--gc-body-bg: #abcdef;");
    expect(sb().writes("site_design_tokens")).toHaveLength(0);
  });
});

describe("ThemeBackgroundsPane - zapis", () => {
  it("zapis wysyła CAŁY zestaw kolorów, nie samą zmienioną gałąź", async () => {
    sb().setTable(
      "site_design_tokens",
      tokensRow({
        "body-bg": { light: "#101010", dark: "#202020" },
        "header-icon": { light: "#333333" },
      }),
    );
    const { container } = mountSettingsPane(<ThemeBackgroundsPane />);
    await waitForDraft();

    fireEvent.change(colorPickerInputs(container)[0], { target: { value: "#123456" } });
    // Wariant dark to OSOBNA gałąź `setSlot` - light i dark muszą trafić do
    // tego samego obiektu slotu, a nie nadpisywać się nawzajem.
    fireEvent.change(colorPickerInputs(container)[1], { target: { value: "#654321" } });
    const save = screen.getByRole("button", { name: /common.save/ });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(toasts().notifySuccess).toHaveBeenCalledTimes(1));
    const payload = sb().lastWrite("site_design_tokens") as {
      global_colors: Record<string, { light?: string; dark?: string }>;
    };
    expect(payload.global_colors["body-bg"]).toEqual({ light: "#123456", dark: "#654321" });
    // Slot spoza edytowanej grupy MUSI przetrwać zapis.
    expect(payload.global_colors["header-icon"]).toEqual({ light: "#333333" });
  });

  it("reset pojedynczego pola zapisuje PUSTY STRING, nie `undefined`", async () => {
    sb().setTable(
      "site_design_tokens",
      tokensRow({ "body-bg": { light: "#101010", dark: "#202020" } }),
    );
    const { container } = mountSettingsPane(<ThemeBackgroundsPane />);
    await waitForDraft();

    fireEvent.click(colorPickerResets(container)[0]);
    expect(colorPickerInputs(container)[0].value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: /common.save/ }));
    await waitFor(() => expect(toasts().notifySuccess).toHaveBeenCalled());
    const payload = sb().lastWrite("site_design_tokens") as {
      global_colors: Record<string, { light?: string; dark?: string }>;
    };
    expect(payload.global_colors["body-bg"]).toEqual({ light: "", dark: "#202020" });
  });

  it("przycisk domyslnych przy slocie przywraca OBA warianty z definicji slotu", async () => {
    sb().setTable(
      "site_design_tokens",
      tokensRow({ "body-bg": { light: "#101010", dark: "#202020" } }),
    );
    const { container } = mountSettingsPane(<ThemeBackgroundsPane />);
    await waitForDraft();

    const resetSlot = screen.getAllByTitle("adminPanesMisc.themeBg.resetTitle")[0];
    fireEvent.click(resetSlot);

    const inputs = colorPickerInputs(container);
    expect(inputs[0].value).toBe("#fcfcf9");
    expect(inputs[1].value).toBe("#141414");
  });

  it("Anuluj wraca do wiersza z bazy i znów wyłącza oba przyciski", async () => {
    sb().setTable(
      "site_design_tokens",
      tokensRow({ "body-bg": { light: "#101010", dark: "#202020" } }),
    );
    const { container } = mountSettingsPane(<ThemeBackgroundsPane />);
    await waitForDraft();

    fireEvent.change(colorPickerInputs(container)[0], { target: { value: "#000001" } });
    const cancel = screen.getByRole("button", { name: /common.cancel/ });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);

    expect(colorPickerInputs(container)[0].value).toBe("#101010");
    expect(screen.getByRole("button", { name: /common.cancel/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /common.save/ })).toBeDisabled();
  });

  it("w trakcie zapisu przycisk mówi Zapisywanie i blokuje ponowne kliknięcie", async () => {
    const deferred: { release: ((value: SupabaseResult) => void) | null } = { release: null };
    sb().setTableResponder("site_design_tokens", (chain) => {
      if (!chain.has("upsert")) return { data: tokensRow({}), error: null };
      return new Promise<SupabaseResult>((resolve) => {
        deferred.release = resolve;
      });
    });
    const { container } = mountSettingsPane(<ThemeBackgroundsPane />);
    await waitForDraft();

    fireEvent.change(colorPickerInputs(container)[0], { target: { value: "#0f0f0f" } });
    fireEvent.click(screen.getByRole("button", { name: /common.save/ }));

    const saving = await screen.findByRole("button", { name: /adminPanesMisc.saving/ });
    expect(saving).toBeDisabled();
    expect(screen.getByRole("button", { name: /common.cancel/ })).toBeDisabled();

    deferred.release?.({ data: null, error: null });
    await waitFor(() => expect(toasts().notifySuccess).toHaveBeenCalled());
  });

  it("błąd zapisu NIE kasuje wpisanych wartości i idzie kanałem `notifyError`", async () => {
    sb().setTable("site_design_tokens", tokensRow({}));
    sb().failWrite("site_design_tokens", "brak uprawnień do site_design_tokens", "42501");
    const { container } = mountSettingsPane(<ThemeBackgroundsPane />);
    await waitForDraft();

    fireEvent.change(colorPickerInputs(container)[0], { target: { value: "#654321" } });
    fireEvent.click(screen.getByRole("button", { name: /common.save/ }));

    await waitFor(() => expect(toasts().notifyError).toHaveBeenCalledTimes(1));
    expect(toasts().notifyError.mock.calls[0][0]).toContain("site_design_tokens");
    expect(toasts().notifySuccess).not.toHaveBeenCalled();
    expect(colorPickerInputs(container)[0].value).toBe("#654321");
  });
});

describe("ThemeBackgroundsPane - grupa `input`", () => {
  it("dokłada podgląd pól tekstowych i NIE rysuje kafli koloru", async () => {
    sb().setTable(
      "site_design_tokens",
      tokensRow({ "input-bg": { light: "#fefefe", dark: "#0a0a0a" } }),
    );
    const { container } = mountSettingsPane(<ThemeBackgroundsPane groupId="input" />);
    await waitForDraft();

    expect(screen.getByText("adminPanesMisc.themeBg.inputPreview")).toBeInTheDocument();
    // Trzy stany (placeholder / hover / focus) razy dwa tryby.
    expect(container.querySelectorAll("input[readonly]")).toHaveLength(6);
    expect(screen.queryByText("Light preview")).toBeNull();

    // Zapisany kolor wygrywa z domyślnym slotu w trybie light...
    const lightBox = container.querySelector<HTMLElement>(
      "[style*='--gc-input-bg: rgb(254, 254, 254)'], [style*='--gc-input-bg: #fefefe']",
    );
    expect(lightBox).not.toBeNull();
    // ...a nieustawiony slot spada na wartość domyślną z definicji.
    expect(container.innerHTML).toContain("#94a3b8");
  });
});
