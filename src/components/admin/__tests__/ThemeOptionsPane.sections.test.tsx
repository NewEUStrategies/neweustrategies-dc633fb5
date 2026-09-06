// PANEL „Theme Options" (`ThemeOptionsPane`) - siedemnaście sekcji wyglądu
// serwisu zapisywanych w JEDNYM dokumencie `site_settings.theme_options`.
//
// CO TEN PLIK PRZYPINA (a czego nie widać z samego montażu drzewa - to dowodzi
// sąsiedni `ThemeOptionsPane.regression.test.tsx`):
//   1. KAŻDA KONTROLKA PISZE DO WŁASNEJ GAŁĘZI DOKUMENTU. Panel ma dziewięć
//      funkcji `patch*` operujących na jednym obiekcie; pomyłka w którejkolwiek
//      nadpisuje SĄSIEDNIĄ sekcję i znika dopiero po zapisie. Dlatego asercje
//      idą na ŁADUNEK wysłany do bazy, nie na stan kontrolki.
//   2. SEKCJE KOLORÓW TO TEN SAM KOMPONENT Z INNĄ GRUPĄ. „Tła", „Kolory pól",
//      „Kolory ikon" i „Kolory linków" renderują `ThemeBackgroundsPane`
//      z `groupId` odpowiednio `body`/`input`/`icons`/`links` - pomylenie
//      grupy daje panel, który wygląda dobrze i edytuje nie te kolory.
//   3. ZAPIS SCALA, NIE NADPISUJE. `useSettings` dociąga aktualny wiersz
//      i scala szkic na wierzchu, więc gałęzie, których panel nie dotyka
//      (np. `sidebars`), muszą przeżyć zapis.
//   4. PODGLĄDY SĄ POCHODNĄ FORMULARZA: `ButtonPreview` liczy `radius` z
//      wariantu (`pill` => 999), a `InputPreview` przełącza obramowanie i
//      etykietę wg stylu pola - to jedyne miejsce, gdzie redaktor widzi skutek
//      liczb, które wpisuje.
//   5. ADRES Z HASHEM OTWIERA KONKRETNĄ SEKCJĘ (deep-link z menu admina).
//   6. PODGLĄD LOGO PRZEŁĄCZA MOTYW CAŁEJ APLIKACJI - przycisk „słońce/księżyc"
//      woła `useTheme().toggle()`, a nie zmienia tylko własnego tła.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   - `GlobalColorsEditor`, `ThemeDesignPane`, `ThemeFontSizesPane`,
//     `ThemeBackgroundsPane`, `ImageSlot`, `AdminColorPicker`
//     i `SiteSettingsHistoryDialog` są ATRAPAMI: mają własne pakiety testowe,
//     a tutaj liczy się WYŁĄCZNIE, co panel im podaje i co od nich przyjmuje.
//   - `ThemeOptionsPane.regression.test.tsx` (kompletność sekcji przy
//     częściowym wierszu + brak `AuthProvider`) - tamtego nie powtarzam.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import {
  colorPickerInputs,
  colorPickerResets,
  controlFor,
  mountSettingsPane,
  paneToastSpies,
  switchFor,
  type ColorPickerStubProps,
  type ImageSlotStubProps,
  type PropRecorder,
  type SettingsPaneSupabase,
} from "@/test/admin/settingsPaneHarness";
import type { SupabaseResult } from "@/test/supabase";
import { ThemeProvider } from "@/components/ThemeProvider";

/** Propy, które panel podaje `ThemeBackgroundsPane` dla sekcji kolorów. */
interface BackgroundsProbeProps {
  groupId?: string;
  title?: string;
  description?: string;
}

/** Propy dialogu historii rewizji. */
interface HistoryProbeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settingsKey: string;
  currentValue: unknown;
  onRestore: (value: unknown) => Promise<void>;
}

const stubs = vi.hoisted(() => ({
  supabase: null as unknown,
  toasts: null as unknown,
  slots: null as unknown,
  colors: null as unknown,
  backgrounds: null as unknown,
  history: null as unknown,
  /** Wartość, którą atrapa dialogu historii oddaje przez `onRestore`. */
  restoreValue: null as unknown,
}));

// WŁASNA atrapa i18n zamiast wspólnej z `@/test/i18nStub`: `useLogoLocations`
// woła `t(key, { returnObjects: true })` i MAPUJE wynik, więc echo klucza
// (string) wywracałoby podgląd logo na `locations.map is not a function`.
// Prawdziwy i18next oddaje w tym miejscu tablicę - i tak samo robi ta atrapa.
vi.mock("react-i18next", async () => {
  const { translateKey } = await import("@/test/i18nStub");
  const t = (key: string, options?: Record<string, unknown>): string | string[] =>
    options?.returnObjects === true
      ? [`${key}[0]`, `${key}[1]`]
      : translateKey(key, options as Record<string, unknown> | undefined);
  const i18n = { language: "pl", t };
  return {
    useTranslation: () => ({ t, i18n }),
    initReactI18next: { type: "3rdParty", init: () => {} },
    Trans: (props: { children?: unknown }) => props.children ?? null,
  };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { settingsPaneSupabase: make } = await import("@/test/admin/settingsPaneHarness");
  const sb = make();
  stubs.supabase = sb;
  return { supabase: sb.client };
});

vi.mock("@/lib/ssrCache", () => ({
  edgeTtlCache: async <T,>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
  invalidateEdgeTtlCache: async () => {},
  clearEdgeTtlCache: () => {},
}));

vi.mock("sonner", async () => {
  const { paneToastSpies: make } = await import("@/test/admin/settingsPaneHarness");
  const spies = make();
  stubs.toasts = spies;
  return spies.sonner();
});

vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(react);
});

vi.mock("@/components/ui/switch", async () => {
  const react = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(react);
});

vi.mock("@/components/admin/ImageSlot", async () => {
  const { imageSlotStub, propRecorder: rec } = await import("@/test/admin/settingsPaneHarness");
  const recorder = rec<ImageSlotStubProps>();
  stubs.slots = recorder;
  return imageSlotStub(recorder);
});

vi.mock("@/components/admin/blocks/AdminColorPicker", async () => {
  const { colorPickerStub, propRecorder: rec } = await import("@/test/admin/settingsPaneHarness");
  const recorder = rec<ColorPickerStubProps>();
  stubs.colors = recorder;
  return colorPickerStub(recorder);
});

vi.mock("@/components/admin/GlobalColorsEditor", async () => {
  const { childPaneStub, propRecorder: rec } = await import("@/test/admin/settingsPaneHarness");
  return { GlobalColorsEditor: childPaneStub("global-colors", rec<Record<string, never>>()) };
});

vi.mock("@/components/admin/theme-design", async () => {
  const { childPaneStub, propRecorder: rec } = await import("@/test/admin/settingsPaneHarness");
  return { ThemeDesignPane: childPaneStub("theme-design", rec<Record<string, never>>()) };
});

vi.mock("@/components/admin/ThemeFontSizesPane", async () => {
  const { childPaneStub, propRecorder: rec } = await import("@/test/admin/settingsPaneHarness");
  return { ThemeFontSizesPane: childPaneStub("font-sizes", rec<Record<string, never>>()) };
});

vi.mock("@/components/admin/ThemeBackgroundsPane", async () => {
  const { childPaneStub, propRecorder: rec } = await import("@/test/admin/settingsPaneHarness");
  const recorder = rec<BackgroundsProbeProps>();
  stubs.backgrounds = recorder;
  return { ThemeBackgroundsPane: childPaneStub("backgrounds", recorder) };
});

vi.mock("@/components/admin/SiteSettingsHistoryDialog", async () => {
  const react = await import("react");
  const { propRecorder: rec } = await import("@/test/admin/settingsPaneHarness");
  const recorder = rec<HistoryProbeProps>();
  stubs.history = recorder;
  return {
    SiteSettingsHistoryDialog: (props: HistoryProbeProps) => {
      recorder.calls.push(props);
      return react.createElement(
        "div",
        { "data-testid": "history-dialog", "data-open": props.open ? "true" : "false" },
        react.createElement(
          "button",
          { type: "button", onClick: () => void props.onRestore(stubs.restoreValue) },
          "przywroc-rewizje",
        ),
      );
    },
  };
});

import { ThemeOptionsPane } from "@/components/admin/ThemeOptionsPane";

const sb = () => stubs.supabase as SettingsPaneSupabase;
const toasts = () => stubs.toasts as ReturnType<typeof paneToastSpies>;
const slots = () => stubs.slots as PropRecorder<ImageSlotStubProps>;
const pickers = () => stubs.colors as PropRecorder<ColorPickerStubProps>;
const backgrounds = () => stubs.backgrounds as PropRecorder<BackgroundsProbeProps>;
const history = () => stubs.history as PropRecorder<HistoryProbeProps>;

/** Wszystkie sekcje w kolejności, w jakiej rysuje je sidebar. */
const SECTION_KEYS = [
  "themeOptions.sections.logo",
  "themeOptions.sections.globalColors",
  "themeOptions.sections.backgrounds",
  "themeOptions.sections.headerLayout",
  "themeOptions.sections.mainMenu",
  "themeOptions.sections.headerSearch",
  "themeOptions.sections.alertBar",
  "themeOptions.sections.socialIcons",
  "themeOptions.sections.signinButtons",
  "themeOptions.sections.mobileHeader",
  "themeOptions.sections.buttons",
  "themeOptions.sections.textFields",
  "themeOptions.sections.toggles",
  "themeOptions.sections.inputColors",
  "themeOptions.sections.iconColors",
  "themeOptions.sections.linkColors",
  "themeOptions.sections.fontSizes",
  "themeOptions.sections.contentStylingAdvanced",
] as const;

const themeWrapper = (children: ReactNode): ReactElement => (
  <ThemeProvider>{children}</ThemeProvider>
);

/** Montaż z opcjonalnym wierszem `theme_options`; czeka na szkic. */
async function mountPane(stored?: Record<string, unknown>) {
  if (stored) sb().setSetting("theme_options", stored);
  const view = mountSettingsPane(<ThemeOptionsPane />, { wrapper: themeWrapper });
  await waitFor(() =>
    expect(view.container.querySelectorAll('[data-sidebar="menu-button"]')).toHaveLength(18),
  );
  return view;
}

/** Przejście do sekcji przez przycisk sidebara (tytuł = klucz etykiety). */
const goTo = (labelKey: string) =>
  fireEvent.click(
    screen
      .getAllByTitle(labelKey)
      .find((node) => node.getAttribute("data-sidebar") === "menu-button") as HTMLElement,
  );

const saveButton = () => screen.getByRole("button", { name: /themeOptions\.save/ });

/** Zapisz i oddaj dokument, który poszedł do bazy. */
async function saveAndRead(): Promise<Record<string, unknown>> {
  const before = toasts().success.mock.calls.length;
  fireEvent.click(saveButton());
  await waitFor(() => expect(toasts().success.mock.calls.length).toBe(before + 1));
  const row = sb().lastWrite("site_settings") as { key: string; value: Record<string, unknown> };
  expect(row.key).toBe("theme_options");
  return row.value;
}

const header = (doc: Record<string, unknown>) => doc.header as Record<string, unknown>;
const branch = (doc: Record<string, unknown>, path: string) =>
  header(doc)[path] as Record<string, unknown>;

beforeEach(() => {
  sb().reset();
  toasts().reset();
  slots().reset();
  pickers().reset();
  backgrounds().reset();
  history().reset();
  stubs.restoreValue = null;
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
  window.location.hash = "";
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("ThemeOptionsPane - nawigacja po sekcjach", () => {
  it("dopóki wiersz ustawień nie dojedzie, panel pokazuje komunikat zamiast pustego formularza", async () => {
    const deferred: { release: ((value: SupabaseResult) => void) | null } = { release: null };
    sb().setTableResponder(
      "site_settings",
      () =>
        new Promise<SupabaseResult>((resolve) => {
          deferred.release = resolve;
        }),
    );

    mountSettingsPane(<ThemeOptionsPane />, { wrapper: themeWrapper });
    expect(screen.getByText("themeOptions.loading")).toBeInTheDocument();

    await waitFor(() => expect(deferred.release).not.toBeNull());
    deferred.release?.({ data: null, error: null });
    await waitFor(() => expect(screen.queryByText("themeOptions.loading")).toBeNull());
  });

  it("sidebar rysuje komplet sekcji, a kliknięcie przenosi zaznaczenie i treść", async () => {
    const { container } = await mountPane();

    const buttons = [...container.querySelectorAll('[data-sidebar="menu-button"]')];
    expect(buttons.map((node) => node.getAttribute("title"))).toEqual([...SECTION_KEYS]);
    expect(buttons[0].getAttribute("data-active")).toBe("true");

    goTo("themeOptions.sections.headerSearch");
    expect(
      screen.getByRole("heading", { name: "themeOptions.sections.headerSearch" }),
    ).toBeInTheDocument();
    const active = [...container.querySelectorAll('[data-sidebar="menu-button"]')].filter(
      (node) => node.getAttribute("data-active") === "true",
    );
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute("title")).toBe("themeOptions.sections.headerSearch");
  });

  it("hash adresu otwiera konkretną sekcję od startu (deep-link z menu admina)", async () => {
    window.location.hash = "#buttons";
    await mountPane();

    expect(screen.getByText("themeOptions.buttons.preview")).toBeInTheDocument();
  });

  it("nieznany hash spada na sekcję logo, a nie na pusty panel", async () => {
    window.location.hash = "#nie-ma-takiej-sekcji";
    await mountPane();

    expect(screen.getByRole("heading", { name: "themeOptions.sections.logo" })).toBeInTheDocument();
  });

  it("cztery sekcje kolorów to TEN SAM panel z różnym `groupId`", async () => {
    await mountPane();

    goTo("themeOptions.sections.backgrounds");
    expect(screen.getByTestId("backgrounds")).toBeInTheDocument();
    expect(backgrounds().last()).toEqual({});

    goTo("themeOptions.sections.inputColors");
    expect(backgrounds().last()).toEqual({
      groupId: "input",
      title: "themeOptions.sections.inputColors",
      description: "themeOptions.inputColorsDescription",
    });

    goTo("themeOptions.sections.iconColors");
    expect(backgrounds().last()?.groupId).toBe("icons");

    goTo("themeOptions.sections.linkColors");
    expect(backgrounds().last()?.groupId).toBe("links");

    // Sekcje kolorów NIE mają własnego przycisku zapisu - dokument zapisują
    // ich hooki, nie ten panel.
    expect(screen.queryByRole("button", { name: /themeOptions\.save/ })).toBeNull();
  });

  it("sekcje delegowane w całości oddają robotę własnym panelom", async () => {
    await mountPane();

    goTo("themeOptions.sections.globalColors");
    expect(screen.getByTestId("global-colors")).toBeInTheDocument();

    goTo("themeOptions.sections.fontSizes");
    expect(screen.getByTestId("font-sizes")).toBeInTheDocument();

    goTo("themeOptions.sections.contentStylingAdvanced");
    expect(screen.getByTestId("theme-design")).toBeInTheDocument();
  });

  it("styl sidebara `style-4` zwija nawigację do samych ikon", async () => {
    const { container } = await mountPane({ sidebars: { style: "style-4" } });

    const aside = container.querySelector('[data-sidebar="sidebar"]');
    expect(aside).toHaveAttribute("data-sidebar-style", "style-4");
    expect(aside?.className).toContain("w-14");
    // Etykiety zostają w DOM (dla czytnika ekranu), ale są schowane.
    const label = aside?.querySelector('[data-sidebar="menu-button"] span');
    expect(label?.className).toContain("hidden");
  });
});

describe("ThemeOptionsPane - logo", () => {
  it("zakładki logo przełączają zestaw slotów, a każdy slot zna swój folder i tryb podglądu", async () => {
    await mountPane();

    // Domyślna zakładka: logo główne light + dark.
    expect(slots().calls.map((call) => call.label)).toEqual([
      "themeOptions.slots.main",
      "themeOptions.slots.mainDark",
    ]);
    expect(slots().calls[0].folder).toBe("theme/logo");
    expect(slots().calls[1].previewMode).toBe("dark");

    slots().reset();
    fireEvent.click(screen.getByRole("button", { name: "themeOptions.logoTabs.sidebar" }));
    expect(slots().calls.map((call) => call.label)).toEqual([
      "themeOptions.slots.sidebarIcon",
      "themeOptions.slots.sidebarIconDark",
      "themeOptions.slots.sidebarExpanded",
      "themeOptions.slots.sidebarExpandedDark",
    ]);
    expect(screen.getByText("themeOptions.banners.sidebar")).toBeInTheDocument();

    slots().reset();
    fireEvent.click(screen.getByRole("button", { name: "themeOptions.logoTabs.bookmark" }));
    expect(slots().calls.map((call) => call.folder)).toEqual([
      "theme/icons",
      "theme/icons",
      "theme/icons",
      "theme/icons",
    ]);

    slots().reset();
    fireEvent.click(screen.getByRole("button", { name: "themeOptions.logoTabs.organization" }));
    expect(screen.getByText("themeOptions.banners.organization")).toBeInTheDocument();
    expect(slots().calls).toHaveLength(2);

    slots().reset();
    fireEvent.click(screen.getByRole("button", { name: "themeOptions.logoTabs.transparent" }));
    expect(slots().calls[0].label).toBe("themeOptions.slots.transparent");

    slots().reset();
    fireEvent.click(screen.getByRole("button", { name: "themeOptions.logoTabs.mobile" }));
    expect(slots().calls[0].label).toBe("themeOptions.slots.mobile");
  });

  it("adres wpisany w slocie trafia do gałęzi `logo` zapisanego dokumentu", async () => {
    await mountPane();

    fireEvent.change(screen.getByLabelText("themeOptions.slots.main"), {
      target: { value: "https://cdn.example.test/logo.svg" },
    });
    fireEvent.change(screen.getByLabelText("themeOptions.slots.mainDark"), {
      target: { value: "https://cdn.example.test/logo-dark.svg" },
    });

    const doc = await saveAndRead();
    expect(doc.logo).toMatchObject({
      main: "https://cdn.example.test/logo.svg",
      main_dark: "https://cdn.example.test/logo-dark.svg",
    });
  });

  it("KAŻDY slot z KAŻDEJ zakładki pisze do własnego pola gałęzi `logo`", async () => {
    // Zakładka -> pary (etykieta slotu, pole w dokumencie). Pomyłka w
    // którejkolwiek parze podmienia logotyp w innym miejscu serwisu i wychodzi
    // dopiero na produkcji.
    const slotMap: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
      [
        "mobile",
        [
          ["themeOptions.slots.mobile", "mobile"],
          ["themeOptions.slots.mobileDark", "mobile_dark"],
        ],
      ],
      [
        "transparent",
        [
          ["themeOptions.slots.transparent", "transparent"],
          ["themeOptions.slots.transparentDark", "transparent_dark"],
        ],
      ],
      [
        "organization",
        [
          ["themeOptions.slots.organization", "organization"],
          ["themeOptions.slots.organizationDark", "organization_dark"],
        ],
      ],
      [
        "sidebar",
        [
          ["themeOptions.slots.sidebarIcon", "sidebar_icon"],
          ["themeOptions.slots.sidebarIconDark", "sidebar_icon_dark"],
          ["themeOptions.slots.sidebarExpanded", "sidebar_expanded"],
          ["themeOptions.slots.sidebarExpandedDark", "sidebar_expanded_dark"],
        ],
      ],
      [
        "bookmark",
        [
          ["themeOptions.slots.iosTouchIcon", "bookmark_ios"],
          ["themeOptions.slots.iosTouchIconDark", "bookmark_ios_dark"],
          ["themeOptions.slots.windowsTile", "bookmark_windows"],
          ["themeOptions.slots.windowsTileDark", "bookmark_windows_dark"],
        ],
      ],
    ];

    await mountPane();
    const expected: Record<string, string> = {};
    for (const [tab, entries] of slotMap) {
      fireEvent.click(screen.getByRole("button", { name: `themeOptions.logoTabs.${tab}` }));
      for (const [label, field] of entries) {
        const url = `https://cdn.example.test/${field}.png`;
        fireEvent.change(screen.getByLabelText(label), { target: { value: url } });
        expected[field] = url;
      }
    }

    const doc = await saveAndRead();
    expect(doc.logo).toMatchObject(expected);
  });

  it("podgląd dziedziczy brakujący wariant: sam jasny logotyp trafia na OBA panele", async () => {
    const { container } = await mountPane({
      logo: { main: "https://cdn.example.test/only-light.png" },
    });

    const images = [...container.querySelectorAll("img")];
    expect(images).toHaveLength(2);
    expect(images.map((img) => img.getAttribute("src"))).toEqual([
      "https://cdn.example.test/only-light.png",
      "https://cdn.example.test/only-light.png",
    ]);
    // Lista miejsc użycia przychodzi ze słownika jako TABLICA.
    expect(screen.getByText("themeOptions.locations.mainItems[0]")).toBeInTheDocument();
  });

  it("bez logotypu podgląd mówi o braku obrazu zamiast pokazywać pustą ramkę", async () => {
    await mountPane();
    expect(screen.getAllByText("themeOptions.preview.noImage")).toHaveLength(2);
  });

  it("przycisk motywu w podglądzie przełącza motyw CAŁEJ aplikacji", async () => {
    await mountPane();

    const toDark = screen.getByTitle("themeOptions.preview.switchToDark");
    expect(toDark).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toDark);

    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(screen.getByTitle("themeOptions.preview.switchToLight")).toBeInTheDocument();

    // Kliknięcie panelu, który JUŻ jest aktywny, nie przełącza motywu z powrotem.
    fireEvent.click(screen.getByTitle("themeOptions.preview.activeTheme"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("zakładka zakładek: przełącznik ekranu głównego zapisuje się w gałęzi logo", async () => {
    const { container } = await mountPane();
    fireEvent.click(screen.getByRole("button", { name: "themeOptions.logoTabs.bookmark" }));

    const toggle = switchFor(container, "themeOptions.addToHomeScreen");
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);

    const doc = await saveAndRead();
    expect((doc.logo as Record<string, unknown>).add_to_home_screen).toBe(false);
  });
});

describe("ThemeOptionsPane - nagłówek", () => {
  it("menu główne: efekt, przełączniki, odstępy i kolory podmenu jadą do `header.main_menu`", async () => {
    const { container } = await mountPane();
    goTo("themeOptions.sections.mainMenu");

    fireEvent.change(
      controlFor<HTMLSelectElement>(container, "themeOptions.mainMenu.hoverEffect", "select"),
      {
        target: { value: "underline" },
      },
    );
    fireEvent.click(switchFor(container, "themeOptions.mainMenu.sticky"));
    fireEvent.click(switchFor(container, "themeOptions.mainMenu.smartSticky"));
    fireEvent.click(switchFor(container, "themeOptions.mainMenu.glass"));
    fireEvent.change(controlFor(container, "themeOptions.mainMenu.itemSpacing"), {
      target: { value: "20" },
    });
    fireEvent.change(controlFor(container, "themeOptions.mainMenu.iconSpacing"), {
      target: { value: "" },
    });
    fireEvent.change(colorPickerInputs(container)[0], { target: { value: "#101010" } });
    fireEvent.click(colorPickerResets(container)[1]);

    const doc = await saveAndRead();
    expect(branch(doc, "main_menu")).toEqual({
      hover_effect: "underline",
      sticky: false,
      smart_sticky: true,
      glass_effect: true,
      item_spacing: 20,
      // Puste pole liczbowe spada na zero, a nie na `NaN`.
      icon_spacing: 0,
      submenu_bg_from: "#101010",
      // Reset koloru wraca do bieli, nie do `undefined`.
      submenu_bg_to: "#ffffff",
    });
  });

  it("wyszukiwarka: limit podpowiedzi jest PRZYCINANY do zakresu 1-10", async () => {
    const { container } = await mountPane();
    goTo("themeOptions.sections.headerSearch");

    const limit = controlFor(container, "themeOptions.search.limit");
    fireEvent.change(limit, { target: { value: "99" } });
    expect(limit.value).toBe("10");
    fireEvent.change(limit, { target: { value: "" } });
    expect(limit.value).toBe("1");

    fireEvent.change(controlFor(container, "themeOptions.search.heading"), {
      target: { value: "Szukaj w serwisie" },
    });
    fireEvent.change(
      controlFor<HTMLSelectElement>(container, "themeOptions.search.mode", "select"),
      {
        target: { value: "fullscreen" },
      },
    );
    fireEvent.click(switchFor(container, "themeOptions.search.icon"));
    fireEvent.click(switchFor(container, "themeOptions.search.live"));
    fireEvent.click(switchFor(container, "themeOptions.search.moreMenu"));

    const doc = await saveAndRead();
    expect(branch(doc, "search")).toEqual({
      enabled: false,
      heading: "Szukaj w serwisie",
      mode: "fullscreen",
      live_results: false,
      live_limit: 1,
      more_menu_search: false,
    });
  });

  it("pasek alertu: komplet pól dwujęzycznych, styl i ikona jadą do `header.alert_bar`", async () => {
    const { container } = await mountPane();
    goTo("themeOptions.sections.alertBar");

    fireEvent.click(switchFor(container, "themeOptions.alertBar.enable"));
    fireEvent.change(controlFor(container, "themeOptions.alertBar.messagePl"), {
      target: { value: "Nowa analiza dostępna" },
    });
    fireEvent.change(controlFor(container, "themeOptions.alertBar.messageEn"), {
      target: { value: "New analysis available" },
    });
    fireEvent.change(controlFor(container, "themeOptions.alertBar.link"), {
      target: { value: "/analizy" },
    });
    fireEvent.change(
      controlFor<HTMLSelectElement>(container, "themeOptions.alertBar.style", "select"),
      {
        target: { value: "warning" },
      },
    );
    fireEvent.change(
      controlFor<HTMLSelectElement>(container, "themeOptions.alertBar.icon", "select"),
      {
        target: { value: "Bell" },
      },
    );
    fireEvent.change(controlFor(container, "themeOptions.alertBar.ctaPl"), {
      target: { value: "Czytaj" },
    });
    fireEvent.change(controlFor(container, "themeOptions.alertBar.ctaEn"), {
      target: { value: "Read" },
    });
    fireEvent.click(switchFor(container, "themeOptions.alertBar.dismissible"));

    const doc = await saveAndRead();
    expect(branch(doc, "alert_bar")).toEqual({
      enabled: true,
      message_pl: "Nowa analiza dostępna",
      message_en: "New analysis available",
      link_url: "/analizy",
      style: "warning",
      dismissible: false,
      icon: "Bell",
      cta_label_pl: "Czytaj",
      cta_label_en: "Read",
    });
  });

  it("nagłówek mobilny: pusty breakpoint spada na 1024, a przełączniki na swoje pola", async () => {
    const { container } = await mountPane();
    goTo("themeOptions.sections.mobileHeader");

    fireEvent.change(controlFor(container, "themeOptions.mobile.breakpoint"), {
      target: { value: "" },
    });
    fireEvent.click(switchFor(container, "themeOptions.mobile.useMobileLogo"));
    fireEvent.click(switchFor(container, "themeOptions.mobile.sticky"));
    fireEvent.click(switchFor(container, "themeOptions.mobile.showSearch"));

    const doc = await saveAndRead();
    expect(branch(doc, "mobile")).toEqual({
      breakpoint: 1024,
      use_mobile_logo: false,
      sticky: false,
      show_search: false,
    });
  });

  it("układ nagłówka: sześć wariantów z miniaturami, klik zapisuje wybrany", async () => {
    const { container } = await mountPane();
    goTo("themeOptions.sections.headerLayout");

    // Miniatury układów mają własny viewBox - ikony sidebara tego nie mają.
    const cards = [...container.querySelectorAll('svg[viewBox="0 0 200 90"]')];
    expect(cards).toHaveLength(6);
    expect(screen.getByText("Layout 1 - Classic Centered")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Layout 6 - Left Global Sidebar/ }));

    const doc = await saveAndRead();
    expect(header(doc).layout).toBe("layout-6");
  });

  it("ikony społecznościowe: rozmieszczenie, rozmiar i siedem adresów", async () => {
    const { container } = await mountPane();
    goTo("themeOptions.sections.socialIcons");

    fireEvent.change(
      controlFor<HTMLSelectElement>(container, "themeOptions.socials.placement", "select"),
      {
        target: { value: "both" },
      },
    );
    fireEvent.change(controlFor(container, "themeOptions.socials.size"), {
      target: { value: "" },
    });
    fireEvent.change(controlFor(container, "Facebook"), {
      target: { value: "https://facebook.example.test/nes" },
    });
    fireEvent.change(controlFor(container, "Email"), {
      target: { value: "kontakt@example.test" },
    });

    const doc = await saveAndRead();
    expect(branch(doc, "socials")).toMatchObject({
      placement: "both",
      size: 16,
      facebook: "https://facebook.example.test/nes",
      email: "kontakt@example.test",
    });
  });

  it("przyciski logowania: przełączniki, wariant i cztery etykiety dwujęzyczne", async () => {
    const { container } = await mountPane();
    goTo("themeOptions.sections.signinButtons");

    fireEvent.click(switchFor(container, "themeOptions.signin.enable"));
    fireEvent.click(switchFor(container, "themeOptions.signin.showSignup"));
    fireEvent.change(
      controlFor<HTMLSelectElement>(container, "themeOptions.signin.variant", "select"),
      {
        target: { value: "pill" },
      },
    );
    fireEvent.change(controlFor(container, "themeOptions.signin.signinPl"), {
      target: { value: "Wejdź" },
    });
    fireEvent.change(controlFor(container, "themeOptions.signin.signinEn"), {
      target: { value: "Enter" },
    });
    fireEvent.change(controlFor(container, "themeOptions.signin.signupPl"), {
      target: { value: "Załóż konto" },
    });
    fireEvent.change(controlFor(container, "themeOptions.signin.signupEn"), {
      target: { value: "Create account" },
    });

    const doc = await saveAndRead();
    expect(branch(doc, "signin")).toEqual({
      enabled: false,
      show_signup: false,
      variant: "pill",
      signin_label_pl: "Wejdź",
      signin_label_en: "Enter",
      signup_label_pl: "Załóż konto",
      signup_label_en: "Create account",
    });
  });
});

describe("ThemeOptionsPane - przełączniki", () => {
  it.each([
    ["sm", 32, 18],
    ["md", 44, 24],
    ["lg", 56, 30],
  ])("preset %s zapisuje rozmiar %s × %s i odświeża podgląd", async (size, width, height) => {
    const { container } = await mountPane();
    goTo("themeOptions.sections.toggles");
    fireEvent.change(
      controlFor<HTMLSelectElement>(container, "themeOptions.toggles.size", "select"),
      {
        target: { value: size },
      },
    );
    const track = container.querySelector('[data-preview-track="on"]');
    expect(track).toHaveStyle({ width: `${width}px`, height: `${height}px` });
    expect((await saveAndRead()).toggles).toMatchObject({ size, width, height });
  });

  it("zapisuje własne wymiary, kolory i typografię bez nadpisania nagłówka", async () => {
    const { container } = await mountPane({ header: { layout: "layout-4" } });
    goTo("themeOptions.sections.toggles");
    for (const [field, value] of [
      ["width", "54"],
      ["height", "28"],
      ["radius", "12"],
      ["labelSize", "17"],
      ["labelWeight", "600"],
    ]) {
      fireEvent.change(controlFor(container, `themeOptions.toggles.${field}`), {
        target: { value },
      });
    }
    const colors = ["#112233", "#445566", "#778899"];
    colors.forEach((value, index) =>
      fireEvent.change(colorPickerInputs(container)[index], { target: { value } }),
    );
    const on = container.querySelector('[data-preview-track="on"]');
    const off = container.querySelector('[data-preview-track="off"]');
    expect(on).toHaveStyle({
      width: "54px",
      height: "28px",
      borderRadius: "12px",
      background: "#112233",
      justifyContent: "flex-end",
    });
    expect(off).toHaveStyle({ background: "#445566", justifyContent: "flex-start" });
    expect(on?.firstElementChild).toHaveStyle({
      width: "24px",
      height: "24px",
      borderRadius: "10px",
      background: "#778899",
    });
    expect(screen.getByText("themeOptions.toggles.previewOn")).toHaveStyle({
      fontSize: "17px",
      fontWeight: "600",
    });
    const doc = await saveAndRead();
    expect(doc.toggles).toMatchObject({
      width: 54,
      height: 28,
      radius: 12,
      on_color: colors[0],
      off_color: colors[1],
      thumb_color: colors[2],
      label_size: 17,
      label_weight: 600,
    });
    expect(header(doc).layout).toBe("layout-4");
  });

  it("puste pola liczbowe zapisuje jako bezpieczne wartości domyślne", async () => {
    const { container } = await mountPane();
    goTo("themeOptions.sections.toggles");
    for (const field of ["width", "height", "radius", "labelSize", "labelWeight"]) {
      fireEvent.change(controlFor(container, `themeOptions.toggles.${field}`), {
        target: { value: "" },
      });
    }
    expect(container.querySelector('[data-preview-track="on"]')).toHaveStyle({
      width: "44px",
      height: "24px",
      borderRadius: "0px",
    });
    expect((await saveAndRead()).toggles).toMatchObject({
      width: 44,
      height: 24,
      radius: 0,
      label_size: 14,
      label_weight: 500,
    });
  });
});

describe("ThemeOptionsPane - przyciski i pola tekstowe", () => {
  it("podgląd przycisków liczy zaokrąglenie z WARIANTU (pill => 999) i stosuje wersaliki", async () => {
    const { container } = await mountPane();
    goTo("themeOptions.sections.buttons");

    fireEvent.change(
      controlFor<HTMLSelectElement>(container, "themeOptions.buttons.defaultVariant", "select"),
      {
        target: { value: "pill" },
      },
    );
    fireEvent.change(
      controlFor<HTMLSelectElement>(container, "themeOptions.buttons.defaultSize", "select"),
      {
        target: { value: "lg" },
      },
    );
    fireEvent.click(switchFor(container, "themeOptions.buttons.uppercase"));

    const solid = screen.getByRole("button", { name: "Solid" });
    expect(solid.style.borderRadius).toBe("999px");
    expect(solid.style.textTransform).toBe("uppercase");
    expect(solid.style.fontSize).toBe("16px");

    fireEvent.change(controlFor(container, "themeOptions.buttons.radius"), {
      target: { value: "0" },
    });
    fireEvent.change(controlFor(container, "themeOptions.buttons.paddingX"), {
      target: { value: "24" },
    });
    fireEvent.change(controlFor(container, "themeOptions.buttons.paddingY"), {
      target: { value: "" },
    });
    fireEvent.change(
      controlFor<HTMLSelectElement>(container, "themeOptions.buttons.fontWeight", "select"),
      {
        target: { value: "700" },
      },
    );
    fireEvent.change(controlFor(container, "themeOptions.buttons.letterSpacing"), {
      target: { value: "1.5" },
    });

    const doc = await saveAndRead();
    expect(doc.buttons).toEqual({
      default_variant: "pill",
      default_size: "lg",
      radius: 0,
      padding_x: 24,
      padding_y: 0,
      font_weight: 700,
      uppercase: true,
      letter_spacing: 1.5,
    });
  });

  it("świeżo otwarty panel w stylu `underline` ma dolną krawędź podglądu", async () => {
    const { container } = await mountPane({ text_fields: { style: "underline" } });
    goTo("themeOptions.sections.textFields");

    const preview = container.querySelector<HTMLInputElement>('input[type="email"]');
    expect(preview?.style.borderBottomWidth).toBe("1px");
    expect(preview?.style.borderTopWidth).toBe("0px");
  });

  it.fails(
    "DEFEKT: przełączenie stylu na `underline` GUBI dolną krawędź podglądu - `InputPreview` miesza skrót `borderWidth` z `borderBottomWidth`, więc przy REDRAWIE React nadpisuje skrótem wartość szczegółową (ostrzega o tym własnym komunikatem)",
    async () => {
      const { container } = await mountPane();
      goTo("themeOptions.sections.textFields");

      fireEvent.change(
        controlFor<HTMLSelectElement>(container, "themeOptions.inputs.style", "select"),
        { target: { value: "underline" } },
      );

      const preview = container.querySelector<HTMLInputElement>('input[type="email"]');
      expect(preview?.style.borderBottomWidth).toBe("1px");
    },
  );

  it("mały rozmiar przycisku daje mniejszy tekst podglądu, a nie ten sam", async () => {
    const { container } = await mountPane();
    goTo("themeOptions.sections.buttons");

    fireEvent.change(
      controlFor<HTMLSelectElement>(container, "themeOptions.buttons.defaultSize", "select"),
      {
        target: { value: "sm" },
      },
    );
    expect(screen.getByRole("button", { name: "Outline" }).style.fontSize).toBe("12px");
    expect(screen.getByRole("button", { name: "Ghost" }).style.background).toBe("transparent");
  });

  it("podgląd pola tekstowego zmienia obramowanie i etykietę wraz ze stylem", async () => {
    const { container } = await mountPane();
    goTo("themeOptions.sections.textFields");

    const preview = () => container.querySelector<HTMLInputElement>('input[type="email"]');
    expect(screen.getByText("E-mail")).toBeInTheDocument();
    expect(preview()?.placeholder).toBe("twoj@email.pl");

    fireEvent.change(
      controlFor<HTMLSelectElement>(container, "themeOptions.inputs.style", "select"),
      {
        target: { value: "underline" },
      },
    );
    // Podkreślenie: zero zaokrąglenia, zero paddingu, ale dolna krawędź MUSI
    // zostać (inaczej pole znika wizualnie).
    expect(preview()?.style.borderRadius).toBe("0px");
    expect(preview()?.style.paddingLeft).toBe("0px");

    fireEvent.change(
      controlFor<HTMLSelectElement>(container, "themeOptions.inputs.style", "select"),
      {
        target: { value: "filled" },
      },
    );
    expect(preview()?.style.borderRadius).toBe("6px");
    expect(preview()?.style.paddingLeft).toBe("12px");

    fireEvent.click(switchFor(container, "themeOptions.inputs.showLabel"));
    expect(screen.queryByText("E-mail")).toBeNull();
    expect(preview()?.placeholder).toBe("E-mail");

    fireEvent.change(controlFor(container, "themeOptions.inputs.radius"), {
      target: { value: "" },
    });
    fireEvent.change(controlFor(container, "themeOptions.inputs.height"), {
      target: { value: "" },
    });
    fireEvent.change(controlFor(container, "themeOptions.inputs.borderWidth"), {
      target: { value: "2" },
    });
    fireEvent.change(
      controlFor<HTMLSelectElement>(container, "themeOptions.inputs.focusRing", "select"),
      {
        target: { value: "none" },
      },
    );
    fireEvent.change(controlFor(container, "themeOptions.inputs.ringWidth"), {
      target: { value: "" },
    });

    const doc = await saveAndRead();
    expect(doc.text_fields).toEqual({
      style: "filled",
      radius: 0,
      height: 40,
      border_width: 2,
      focus_ring: "none",
      focus_ring_width: 0,
      show_label_above: false,
    });
  });
});

describe("ThemeOptionsPane - zapis i historia", () => {
  it("zapis SCALA szkic na aktualnym wierszu - gałęzie spoza panelu przeżywają", async () => {
    sb().setSetting("theme_options", {
      sidebars: { style: "style-3" },
      eksperymentalne: { flaga: true },
    });
    await mountPane();

    fireEvent.change(screen.getByLabelText("themeOptions.slots.main"), {
      target: { value: "https://cdn.example.test/logo.svg" },
    });
    const doc = await saveAndRead();

    expect(doc.eksperymentalne).toEqual({ flaga: true });
    expect(doc.sidebars).toEqual({ style: "style-3" });
    expect(toasts().success).toHaveBeenCalledWith("Zapisano");
  });

  it("zapis DOCIĄGA aktualny wiersz: gałąź dopisana PO wczytaniu formularza przeżywa", async () => {
    // Test wyżej NIE dowodzi jeszcze scalania przy ZAPISIE: wczytanie robi
    // `deepMerge(DEFAULTS, wiersz)`, więc gałąź obecna w bazie PRZED montażem
    // siedzi już w szkicu i przeżyłaby nawet nadpisanie całego wiersza.
    // Dowodem na odczyt-przed-zapisem jest wyłącznie gałąź, która pojawia się
    // w wierszu PÓŹNIEJ - dokładnie tak wygląda równoległy zapis z innego
    // panelu (General, SEO i GlobalColorsEditor piszą do TEGO SAMEGO klucza
    // `theme_options` własnym, węższym kształtem).
    await mountPane();
    sb().setSetting("theme_options", { obca_galaz: { flaga: true } });

    fireEvent.change(screen.getByLabelText("themeOptions.slots.main"), {
      target: { value: "https://cdn.example.test/logo.svg" },
    });
    const doc = await saveAndRead();

    expect(doc.obca_galaz).toEqual({ flaga: true });
    // ...a szkic panelu nadal wygrywa tam, gdzie panel faktycznie edytuje.
    expect((doc.logo as Record<string, unknown>).main).toBe("https://cdn.example.test/logo.svg");
  });

  it("odmowa bazy pokazuje komunikat i NIE kasuje wpisanych wartości", async () => {
    await mountPane();
    sb().failWrite("site_settings", "RLS: brak uprawnien do site_settings", "42501");

    fireEvent.change(screen.getByLabelText("themeOptions.slots.main"), {
      target: { value: "https://cdn.example.test/logo.svg" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts().error).toHaveBeenCalledTimes(1));
    expect(toasts().error.mock.calls[0][0]).toContain("site_settings");
    expect(toasts().success).not.toHaveBeenCalled();
    expect(screen.getByLabelText("themeOptions.slots.main")).toHaveValue(
      "https://cdn.example.test/logo.svg",
    );
  });

  it("historia rewizji dostaje AKTUALNY szkic, a przywrócenie podmienia formularz i zapisuje", async () => {
    await mountPane();

    // Dialog startuje zamknięty i zna klucz ustawień.
    expect(history().last()?.settingsKey).toBe("theme_options");
    expect(screen.getByTestId("history-dialog")).toHaveAttribute("data-open", "false");

    fireEvent.change(screen.getByLabelText("themeOptions.slots.main"), {
      target: { value: "https://cdn.example.test/nowe.svg" },
    });
    fireEvent.click(screen.getByRole("button", { name: /themeOptions\.history\.button/ }));
    await waitFor(() =>
      expect(screen.getByTestId("history-dialog")).toHaveAttribute("data-open", "true"),
    );
    const current = history().last()?.currentValue as { logo: { main: string } };
    expect(current.logo.main).toBe("https://cdn.example.test/nowe.svg");

    // Rewizja: ten sam dokument z innym logotypem i innym układem nagłówka.
    stubs.restoreValue = {
      ...current,
      logo: { ...current.logo, main: "https://cdn.example.test/stare.svg" },
      header: {
        ...(current as unknown as { header: Record<string, unknown> }).header,
        layout: "layout-4",
      },
    };
    fireEvent.click(screen.getByRole("button", { name: "przywroc-rewizje" }));

    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("themeOptions.slots.main")).toHaveValue(
      "https://cdn.example.test/stare.svg",
    );
    const saved = sb().lastWrite("site_settings") as { value: Record<string, unknown> };
    expect(header(saved.value).layout).toBe("layout-4");
  });

  it("w trakcie zapisu przycisk mówi Zapisywanie i jest zablokowany", async () => {
    const deferred: { release: ((value: SupabaseResult) => void) | null } = { release: null };
    sb().setTableResponder("site_settings", (chain) => {
      if (!chain.has("upsert")) return { data: null, error: null };
      return new Promise<SupabaseResult>((resolve) => {
        deferred.release = resolve;
      });
    });
    await mountPane();

    fireEvent.click(saveButton());
    const saving = await screen.findByRole("button", { name: /themeOptions\.saving/ });
    expect(saving).toBeDisabled();

    deferred.release?.({ data: null, error: null });
    await waitFor(() => expect(toasts().success).toHaveBeenCalled());
  });
});
