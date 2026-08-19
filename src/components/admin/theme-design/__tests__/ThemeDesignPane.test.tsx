// KORZEŃ KOMPOZYCJI edytora Theme Design plus podgląd na żywo i pasek języka.
// Do 18.08.2026 wszystkie trzy na zerze.
//
// Pane sam nie liczy niczego - cały stan siedzi w `useThemeDesignDrafts`.
// Ale spina dwanaście sekcji z ich zakładkami i to spięcie psuje się po cichu:
// zakładka pokazująca cudzą sekcję, wersja robocza karuzeli podana sekcji
// nakładki, przycisk zapisu wywołujący przywrócenie domyślnych.
//
// PODGLĄD NA ŻYWO ma osobną, ważniejszą regułę: tokeny `--td-*` muszą być
// PRZESKALOWANE z `:root` na korzeń podglądu. Bez tego podgląd nadpisałby
// tokeny CAŁEGO panelu administracyjnego - redaktor zmieniałby kolor nagłówka
// wpisu i widział zmianę w interfejsie admina.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  controller: null as Record<string, unknown> | null,
}));

vi.mock("../hooks", () => ({ useThemeDesignDrafts: () => h.controller }));

import "@/lib/i18n-admin-theme-design";
import { ThemeDesignPane } from "../ThemeDesignPane";
import { I18nAndLiveToolbar } from "../organisms/I18nAndLiveToolbar";
import { LivePostPreview } from "../organisms/live-preview/LivePostPreview";
import { THEME_DESIGN_DEFAULTS } from "@/lib/theme/themeDesign";
import { CAROUSEL_DEFAULTS } from "@/lib/theme/carouselDefaults";
import { PREVIEW_SECTIONS, TAB_ITEMS, isPreviewSection } from "../lib";

function controller(overrides: Record<string, unknown> = {}) {
  return {
    loading: false,
    draft: THEME_DESIGN_DEFAULTS,
    carouselDraft: CAROUSEL_DEFAULTS,
    overlayDraft: { overlay_title_size_base: 24 },
    mode: "shared",
    onModeChange: vi.fn(),
    editLang: "pl",
    setEditLang: vi.fn(),
    liveSync: false,
    setLiveSync: vi.fn(),
    savingMode: false,
    previewLang: "pl",
    setPreviewLang: vi.fn(),
    previewMode: "light",
    setPreviewMode: vi.fn(),
    activeTab: "block-heading",
    setActiveTab: vi.fn(),
    set: vi.fn(),
    setColor: vi.fn(),
    setCarouselDraft: vi.fn(),
    setOverlayDraft: vi.fn(),
    saveAll: vi.fn(),
    saving: false,
    restoreDefaults: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  h.controller = controller();
});

describe("ThemeDesignPane - stan wczytywania", () => {
  it("do czasu wczytania NIE renderuje edytora", () => {
    h.controller = controller({ loading: true });
    render(<ThemeDesignPane />);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it.each(["draft", "carouselDraft", "overlayDraft"])(
    "brak wersji roboczej %s wstrzymuje render",
    (missing) => {
      // Trzy niezależne wersje robocze - brak którejkolwiek oznacza sekcję
      // renderowaną na `undefined`, czyli wywrócony panel.
      h.controller = controller({ [missing]: null });
      render(<ThemeDesignPane />);
      expect(screen.queryByRole("tablist")).toBeNull();
    },
  );
});

describe("ThemeDesignPane - kompozycja zakładek", () => {
  it("renderuje zakładkę dla KAŻDEJ sekcji z katalogu", () => {
    // Katalog `TAB_ITEMS` jest jedynym źródłem prawdy; brakująca zakładka to
    // sekcja, do której nie da się dojść z panelu.
    render(<ThemeDesignPane />);
    expect(screen.getAllByRole("tab")).toHaveLength(TAB_ITEMS.length);
  });

  it("pokazuje sekcję odpowiadającą AKTYWNEJ zakładce", () => {
    const { unmount } = render(<ThemeDesignPane />);
    expect(screen.getByRole("tabpanel").textContent).toContain("Nagłówki bloków");
    unmount();

    h.controller = controller({ activeTab: "carousel" });
    render(<ThemeDesignPane />);
    expect(screen.getByRole("tabpanel").textContent).toMatch(/karuzel/i);
  });

  it("zapis i przywrócenie domyślnych to DWA różne przyciski", () => {
    // Zamiana tych dwóch kasuje pracę redaktora zamiast ją zapisać.
    render(<ThemeDesignPane />);
    fireEvent.click(screen.getByRole("button", { name: /zapisz wszystko|save all/i }));
    expect(h.controller?.saveAll).toHaveBeenCalledTimes(1);
    expect(h.controller?.restoreDefaults).not.toHaveBeenCalled();

    // Dokładna nazwa, nie fragment: sekcje mają własne „Przywróć domyślny"
    // przy każdym kolorze - to przycisk o zupełnie innym zasięgu.
    fireEvent.click(screen.getByRole("button", { name: /^(Przywróć domyślne|Restore defaults)$/ }));
    expect(h.controller?.restoreDefaults).toHaveBeenCalledTimes(1);
  });

  it("przycisk zapisu jest zablokowany w trakcie zapisywania", () => {
    h.controller = controller({ saving: true });
    render(<ThemeDesignPane />);
    expect(screen.getByRole("button", { name: /zapisz wszystko|save all/i })).toBeDisabled();
  });
});

describe("katalog sekcji", () => {
  it("każdej sekcji odpowiada dokładnie jedna zakładka", () => {
    expect(TAB_ITEMS.map((t) => t.value).sort()).toEqual([...PREVIEW_SECTIONS].sort());
  });

  it("strażnik typu przepuszcza znane sekcje i odrzuca resztę", () => {
    // Wartość wraca z DOM-u przez Radix jako zwykły napis - bez strażnika
    // dowolna wartość trafiłaby do stanu i wygasiła wszystkie panele.
    for (const section of PREVIEW_SECTIONS) expect(isPreviewSection(section)).toBe(true);
    for (const bad of ["", "nieznana", "BLOCK-HEADING"]) {
      expect(isPreviewSection(bad)).toBe(false);
    }
  });

  it("klucze etykiet są unikalne", () => {
    const keys = TAB_ITEMS.map((t) => t.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("I18nAndLiveToolbar", () => {
  function setup(overrides: Record<string, unknown> = {}) {
    const spies = {
      onModeChange: vi.fn(),
      onEditLangChange: vi.fn(),
      onLiveSyncChange: vi.fn(),
    };
    render(
      <I18nAndLiveToolbar
        mode="shared"
        editLang="pl"
        liveSync={false}
        savingMode={false}
        {...spies}
        {...(overrides as Record<string, never>)}
      />,
    );
    return spies;
  }

  it("w trybie WSPÓLNYM nie pokazuje wyboru edytowanego języka", () => {
    setup();
    expect(screen.queryByRole("group", { name: /Edytuję|Editing/ })).toBeNull();
  });

  it("oferuje wybór trybu WSPÓLNY / OSOBNY", () => {
    const { onModeChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: /osobno|split|per lang/i }));
    expect(onModeChange).toHaveBeenCalledWith("split");
  });

  it("wybór edytowanego języka zgłasza KOD języka", () => {
    // Wybór języka pojawia się WYŁĄCZNIE w trybie osobnym - we wspólnym nie ma
    // czego wybierać, bo obie wersje dzielą jeden zestaw stylów.
    const { onEditLangChange } = setup({ mode: "split" });
    // Zawężamy do grupy „Edytuję:" - napis „EN" pada też w etykiecie trybu
    // wspólnego („Wspólne PL + EN"), a to zupełnie inny przełącznik.
    const group = within(screen.getByRole("group", { name: /Edytuję|Editing/ }));
    fireEvent.click(group.getByRole("button", { name: /EN/ }));
    expect(onEditLangChange).toHaveBeenCalledWith("en");
  });

  it("przełącznik podglądu w CMS przekazuje wartość logiczną", () => {
    const { onLiveSyncChange } = setup();
    fireEvent.click(screen.getByRole("switch"));
    expect(onLiveSyncChange).toHaveBeenCalledWith(true);
  });
});

describe("LivePostPreview - izolacja tokenów", () => {
  function setup(overrides: Record<string, unknown> = {}) {
    const spies = { onLangChange: vi.fn(), onModeChange: vi.fn() };
    const view = render(
      <LivePostPreview
        draft={THEME_DESIGN_DEFAULTS}
        previewLang="pl"
        previewMode="light"
        activeTab="block-heading"
        {...spies}
        {...(overrides as Record<string, never>)}
      />,
    );
    return { ...spies, view };
  }

  it("PRZESKALOWUJE tokeny z :root na korzeń podglądu", () => {
    // Bez rescope'u podgląd nadpisałby tokeny CAŁEGO panelu administracyjnego -
    // redaktor zmieniałby kolor nagłówka wpisu i widział zmianę w adminie.
    const { view } = setup();
    const css = view.container.querySelector("style")?.innerHTML ?? "";
    expect(css).toContain("--td-");
    expect(css).not.toMatch(/(^|})\s*:root\s*,\s*\.light\s*{/);
  });

  it("wypisuje tokeny TAKŻE jako zmienne inline na korzeniu", () => {
    // Druga, równoległa ścieżka: React przepisuje je przy każdej zmianie
    // wersji roboczej, więc podgląd nie utyka na nieaktualnym <style>.
    const { view } = setup();
    const root = view.container.querySelector<HTMLElement>("[style*='--td-']");
    expect(root).toBeTruthy();
  });

  it("styl podglądu przechodzi przez bramkę przed wyjściem z bloku", () => {
    const { view } = setup({
      draft: {
        ...THEME_DESIGN_DEFAULTS,
        blockHeading: { ...THEME_DESIGN_DEFAULTS.blockHeading, color: "red</style>" },
      },
    });
    expect(view.container.querySelector("style")?.innerHTML ?? "").not.toContain("</style>");
  });

  it("przełączniki języka i trybu zgłaszają wybraną wartość", () => {
    const { onLangChange, onModeChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: /EN/ }));
    expect(onLangChange).toHaveBeenCalledWith("en");

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(onModeChange).toHaveBeenCalledWith("dark");
  });

  it("tryb CIEMNY podglądu zmienia emitowane tokeny", () => {
    const draft = {
      ...THEME_DESIGN_DEFAULTS,
      darkOverrides: { blockHeading: { color: "#ffffff" } },
    };
    const light = setup({ draft, previewMode: "light" });
    const lightRoot = light.view.container
      .querySelector<HTMLElement>("[style*='--td-bh-color']")
      ?.getAttribute("style");
    light.view.unmount();

    const dark = setup({ draft, previewMode: "dark" });
    const darkRoot = dark.view.container
      .querySelector<HTMLElement>("[style*='--td-bh-color']")
      ?.getAttribute("style");

    expect(darkRoot).not.toBe(lightRoot);
  });
});
