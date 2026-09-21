// PODGLĄD LAYOUTU STRONY EKSPERTA w panelu admina (`ExpertLayoutPreview`).
//
// CO TEN PLIK PRZYPINA (rzeczy, których montaż bez interakcji nie dowodzi):
//   1. PRZEŁĄCZNIKI STERUJĄ TRZEMA RÓŻNYMI RZECZAMI NARAZ. `lang` zmienia
//      ścieżkę publiczną (`/author/...` kontra `/en/author/...`), `theme`
//      zmienia ZESTAW KOLORÓW podawany rendererowi (warianty `*_dark`),
//      a `Sample` decyduje o wypełniaczach. To trzy niezależne kontrakty na
//      jednym pasku i każdy z nich ma tu własną asercję.
//   2. PODGLĄD SZKICU KONSUMUJE WARIANT DARK Z FORMULARZA, nie klasę CSS.
//      Renderer dostaje `settings` z podmienionymi `hero_bg_color`,
//      `hero_text_color`, `accent_color`, `bio_bullet_color` - inaczej „dark"
//      w panelu pokazywałby jasne kolory na ciemnym tle.
//   3. TRYB „opublikowany" TO IFRAME Z NONCE. Kliknięcie „odśwież" MUSI
//      zmienić `src`, bo bez tego przeglądarka pokazuje wersję z cache i
//      redaktor „nie widzi" własnego zapisu.
//   4. ZAPIS (`savedAt`) SAM PRZERZUCA PODGLĄD NA OPUBLIKOWANY i podbija nonce.
//   5. SLUG Z FORMULARZA WYGRYWA nad przykładowym z bazy i jest przycinany;
//      brak jakiegokolwiek sluga daje komunikat, a nie zmyśloną ścieżkę
//      i NIE odpala zapytania o hub.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   - `ExpertLayoutHero` / `ExpertSectionsList` (1100 linii publicznego
//     renderera) są ATRAPAMI - mają własną powierzchnię testową; tu liczy się
//     wyłącznie, CO podgląd im podaje.
//   - `findExpertPreset` i `expertLayoutCssVars` mają własne testy jednostkowe;
//     preset jest tu prawdziwy (bo jego etykieta jest w widoku), a `cssVars`
//     atrapą, żeby dało się zmierzyć, że przelicza się na zmianę motywu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  mountSettingsPane,
  stubBrowserPageFetch,
  type PropRecorder,
  type SettingsPaneSupabase,
} from "@/test/admin/settingsPaneHarness";
import { defaultExpertLayoutSettings, type ExpertLayoutSettings } from "@/lib/expertLayouts";

/** Kształt hubu, jaki podgląd przekazuje dalej rendererowi. */
interface HubProbe {
  slug: string;
  display_name: string;
}

/** Propy, które podgląd przekazuje obu atrapom renderera. */
interface RendererProbeProps {
  hub: HubProbe;
  settings: ExpertLayoutSettings;
  lang: "pl" | "en";
  showPlaceholders: boolean;
}

const stubs = vi.hoisted(() => ({
  supabase: null as unknown,
  hero: null as unknown,
  sections: null as unknown,
  /** Wynik zapytania o hub; `null` = brak danych, obietnica = wieczne ładowanie. */
  hub: null as unknown,
  /** Slugi, dla których zbudowano `expertHubQueryOptions`. */
  hubSlugs: [] as string[],
  /**
   * Slugi, dla których react-query NAPRAWDĘ odpalił `queryFn`. Zbudowanie
   * opcji zapytania dzieje się w renderze BEZWARUNKOWO (także dla pustego
   * sluga), więc tylko ta lista dowodzi działania `enabled`.
   */
  hubFetches: [] as string[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/lib/i18n-admin-layouts", () => ({}));

vi.mock("@/integrations/supabase/client", async () => {
  const { settingsPaneSupabase: make } = await import("@/test/admin/settingsPaneHarness");
  const sb = make();
  stubs.supabase = sb;
  return { supabase: sb.client };
});

// Granica danych hubu eksperta: podgląd woła `expertHubQueryOptions(slug)`.
// Atrapa zapisuje KAŻDY slug, dla którego zbudowano opcje - to jedyny sposób,
// żeby dowieść, że pole formularza wygrywa z przykładem z bazy.
vi.mock("@/lib/experts/queries", () => ({
  expertHubQueryOptions: (slug: string) => {
    stubs.hubSlugs.push(slug);
    return {
      queryKey: ["public", "expert", slug] as const,
      queryFn: async () => {
        stubs.hubFetches.push(slug);
        return stubs.hub;
      },
    };
  },
}));

vi.mock("@/components/experts/ExpertLayoutRenderer", async () => {
  const { childPaneStub, propRecorder: rec } = await import("@/test/admin/settingsPaneHarness");
  const hero = rec<RendererProbeProps>();
  const sections = rec<RendererProbeProps>();
  stubs.hero = hero;
  stubs.sections = sections;
  return {
    ExpertLayoutHero: childPaneStub("expert-hero", hero),
    ExpertSectionsList: childPaneStub("expert-sections", sections),
    // Atrapa zmiennych CSS: jedna zmienna wystarczy, żeby zmierzyć, że
    // `previewStyle` przelicza się na zmianę motywu.
    expertLayoutCssVars: (settings: ExpertLayoutSettings, theme: "light" | "dark") => ({
      "--expert-accent":
        theme === "dark" ? (settings.accent_color_dark ?? "") : (settings.accent_color ?? ""),
    }),
  };
});

import { ExpertLayoutPreview } from "@/components/admin/ExpertLayoutPreview";

const sb = () => stubs.supabase as SettingsPaneSupabase;
const hero = () => stubs.hero as PropRecorder<RendererProbeProps>;
const sections = () => stubs.sections as PropRecorder<RendererProbeProps>;

const HUB: HubProbe = { slug: "anna-kowalska", display_name: "Anna Kowalska" };

function settings(overrides: Partial<ExpertLayoutSettings> = {}): ExpertLayoutSettings {
  return {
    ...defaultExpertLayoutSettings("tenant-test"),
    hero_bg_color: "#ffffff",
    hero_bg_color_dark: "#141414",
    hero_text_color: "#141414",
    hero_text_color_dark: "#f5f5f5",
    accent_color: "#fa9346",
    accent_color_dark: "#fbbf24",
    bio_bullet_color: "#dddddd",
    bio_bullet_color_dark: "#333333",
    ...overrides,
  };
}

/** Montaż z przykładowym slugiem w bazie (albo bez niego, gdy `null`). */
function mountPreview(
  ui: ReactElement,
  sampleSlug: string | null = "anna-kowalska",
): ReturnType<typeof mountSettingsPane> {
  sb().setTable("profiles", sampleSlug === null ? null : { slug: sampleSlug });
  return mountSettingsPane(ui);
}

const toggle = (label: string) => fireEvent.click(screen.getByRole("button", { name: label }));

// happy-dom ładuje `<iframe src>` PRAWDZIWYM żądaniem HTTP - tryb
// "opublikowany" montuje ramkę na relatywnym adresie, więc bez podstawionego
// interceptora test wychodziłby na `http://localhost:3000/author/...`.
//
// Znacznik w treści atrapy jest DOWODEM, a nie ozdobą: `stubBrowserPageFetch`
// cicho oddaje pustą funkcję, gdy nie znajdzie ustawień happy-doma (zmiana
// wersji, inne środowisko), i wtedy ramka POSZŁABY do sieci, a testy nadal
// byłyby zielone. Test „ramka dostaje dokument z atrapy" niżej sprawdza, że ten
// znacznik jest w dokumencie ramki - czyli że odpowiedź przyszła z interceptora.
const FRAME_MARKER = "harness-offline-frame";
const FRAME_HTML = `<!doctype html><html><body><p id="${FRAME_MARKER}">atrapa</p></body></html>`;
let restoreFetch: () => void = () => {};

beforeEach(() => {
  restoreFetch = stubBrowserPageFetch(FRAME_HTML);
  sb().reset();
  hero().reset();
  sections().reset();
  stubs.hub = HUB;
  stubs.hubSlugs = [];
  stubs.hubFetches = [];
});

afterEach(() => {
  cleanup();
  restoreFetch();
});

describe("ExpertLayoutPreview - wybór eksperta", () => {
  it("bez sluga pokazuje komunikat (PL/EN), nie zmyśloną ścieżkę, i nie pyta o hub", async () => {
    mountPreview(<ExpertLayoutPreview settings={settings()} />, null);

    await waitFor(() => expect(sb().chainsFor("profiles")).toHaveLength(1));
    expect(
      screen.getByText(/Brak eksperta z ustawionym slug-iem/, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Otwórz")).toBeNull();

    toggle("EN");
    expect(screen.getByText(/No expert with a slug set/, { exact: false })).toBeInTheDocument();

    // `enabled: Boolean(effectiveSlug)` - opcje zapytania POWSTAŁY (render woła
    // `expertHubQueryOptions("")` bezwarunkowo), ale `queryFn` NIE poleciał.
    expect(stubs.hubSlugs).toContain("");
    expect(stubs.hubFetches).toEqual([]);
    expect(hero().calls).toHaveLength(0);
  });

  it("przykładowy slug bierze się z profilu z ustawionym slugiem (filtr `not is null`, limit 1)", async () => {
    mountPreview(<ExpertLayoutPreview settings={settings()} />);

    await waitFor(() => expect(screen.getByText("Otwórz")).toBeInTheDocument());
    const chain = sb().chainsFor("profiles")[0];
    expect(chain.argsOf("select")).toEqual(["slug"]);
    expect(chain.argsOf("not")).toEqual(["slug", "is", null]);
    expect(chain.argsOf("limit")).toEqual([1]);

    const link = screen.getByRole("link", { name: /Otwórz/ });
    expect(link).toHaveAttribute("href", "/author/anna-kowalska");
    // Placeholder pola podpowiada, którego eksperta widać.
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "anna-kowalska");
  });

  it("przełącznik EN zmienia ścieżkę publiczną na wariant `/en` i etykietę linku", async () => {
    mountPreview(<ExpertLayoutPreview settings={settings()} />);
    await waitFor(() => expect(screen.getByText("Otwórz")).toBeInTheDocument());

    toggle("EN");
    expect(screen.getByRole("link", { name: /Open/ })).toHaveAttribute(
      "href",
      "/en/author/anna-kowalska",
    );
  });

  it("slug wpisany ręcznie wygrywa z przykładowym i jest przycinany ze spacji", async () => {
    mountPreview(<ExpertLayoutPreview settings={settings()} />);
    await waitFor(() => expect(screen.getByText("Otwórz")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  jan-nowak  " } });

    expect(screen.getByRole("link", { name: /Otwórz/ })).toHaveAttribute(
      "href",
      "/author/jan-nowak",
    );
    // Nie wystarczy, że opcje zapytania powstały - hub dla ręcznego sluga musi
    // zostać NAPRAWDĘ pobrany, inaczej podgląd stałby na danych poprzednika.
    await waitFor(() => expect(stubs.hubFetches).toContain("jan-nowak"));
  });
});

describe("ExpertLayoutPreview - szkic", () => {
  it("czeka na hub komunikatem ładowania w języku paska (PL i EN)", async () => {
    stubs.hub = new Promise(() => {});
    mountPreview(<ExpertLayoutPreview settings={settings()} />);

    expect(await screen.findByText("Ładowanie podglądu...")).toBeInTheDocument();
    toggle("EN");
    expect(screen.getByText("Loading preview...")).toBeInTheDocument();
    expect(screen.queryByTestId("expert-hero")).toBeNull();
  });

  it("po dojściu hubu renderuje hero i sekcje TYM SAMYM rendererem, co strona publiczna", async () => {
    mountPreview(<ExpertLayoutPreview settings={settings()} />);

    expect(await screen.findByTestId("expert-hero")).toBeInTheDocument();
    expect(screen.getByTestId("expert-sections")).toBeInTheDocument();
    const props = hero().last();
    expect(props?.hub).toEqual(HUB);
    expect(props?.lang).toBe("pl");
    expect(props?.showPlaceholders).toBe(true);
    expect(sections().last()?.settings).toBe(props?.settings);
  });

  it("tryb dark podmienia warianty kolorów PRZED oddaniem ich rendererowi", async () => {
    const { container } = mountPreview(<ExpertLayoutPreview settings={settings()} />);
    await screen.findByTestId("expert-hero");

    expect(hero().last()?.settings.hero_bg_color).toBe("#ffffff");
    toggle("Dark");

    const dark = hero().last()?.settings;
    expect(dark?.hero_bg_color).toBe("#141414");
    expect(dark?.hero_text_color).toBe("#f5f5f5");
    expect(dark?.accent_color).toBe("#fbbf24");
    expect(dark?.bio_bullet_color).toBe("#333333");
    // Ramka podglądu dostaje klasę `dark` i przeliczone zmienne CSS.
    const frame = container.querySelector<HTMLElement>("div.shadow-sm");
    expect(frame?.className).toContain("dark");
    expect(frame?.getAttribute("style")).toContain("#fbbf24");
  });

  it("brak wariantu dark w formularzu spada na wartość light (nie na pustkę)", async () => {
    mountPreview(
      <ExpertLayoutPreview
        settings={settings({ hero_bg_color_dark: null, accent_color_dark: null })}
      />,
    );
    await screen.findByTestId("expert-hero");

    toggle("Dark");
    expect(hero().last()?.settings.hero_bg_color).toBe("#ffffff");
    expect(hero().last()?.settings.accent_color).toBe("#fa9346");
  });

  it("wyłączenie przykładowych treści przechodzi do obu części renderera", async () => {
    mountPreview(<ExpertLayoutPreview settings={settings()} />);
    await screen.findByTestId("expert-hero");

    toggle("Przykład: wył");
    expect(hero().last()?.showPlaceholders).toBe(false);
    expect(sections().last()?.showPlaceholders).toBe(false);

    toggle("Przykład: wł");
    expect(hero().last()?.showPlaceholders).toBe(true);
  });

  it("stopka nazywa aktywny preset w języku paska", async () => {
    mountPreview(<ExpertLayoutPreview settings={settings({ default_preset: "centered" })} />);
    await screen.findByTestId("expert-hero");

    expect(screen.getByText("Wycentrowany")).toBeInTheDocument();
    expect(
      screen.getByText(/Awatar okrągły, tytuł i bio wycentrowane/, { exact: false }),
    ).toBeInTheDocument();

    toggle("EN");
    expect(screen.getByText("Centered")).toBeInTheDocument();
    expect(screen.getByText(/Round avatar, centered title and bio/)).toBeInTheDocument();
  });
});

describe("ExpertLayoutPreview - tryb opublikowany", () => {
  it("przełączenie na opublikowany montuje ramkę z nonce, a odświeżenie ten nonce podbija", async () => {
    const { container } = mountPreview(<ExpertLayoutPreview settings={settings()} />);
    await screen.findByTestId("expert-hero");

    toggle("adminLayouts.expertPreview.modePublished");

    const iframe = container.querySelector("iframe");
    expect(iframe).toHaveAttribute("src", "/author/anna-kowalska?__preview=1");
    expect(iframe).toHaveAttribute(
      "sandbox",
      "allow-same-origin allow-scripts allow-forms allow-popups",
    );
    expect(screen.queryByTestId("expert-hero")).toBeNull();

    toggle("adminLayouts.expertPreview.refresh");
    expect(container.querySelector("iframe")).toHaveAttribute(
      "src",
      "/author/anna-kowalska?__preview=2",
    );
  });

  it("ramka dostaje dokument Z ATRAPY, a nie z sieci (dowód, że test jest offline)", async () => {
    const { container } = mountPreview(<ExpertLayoutPreview settings={settings()} />);
    await screen.findByTestId("expert-hero");
    toggle("adminLayouts.expertPreview.modePublished");

    const iframe = container.querySelector("iframe");
    await waitFor(() =>
      expect(iframe?.contentWindow?.document.getElementById(FRAME_MARKER)).not.toBeNull(),
    );
    // Gdyby żądanie poszło na `http://localhost:3000/author/...`, dokument ramki
    // byłby pusty albo zerwany - tego akapitu nie miałby skąd wziąć.
    expect(iframe?.contentWindow?.document.getElementById(FRAME_MARKER)?.textContent).toBe(
      "atrapa",
    );
  });

  it("panel wymusza motyw W ŚRODKU ramki (klasa `dark` + zapis w localStorage ramki)", async () => {
    const { container } = mountPreview(<ExpertLayoutPreview settings={settings()} />);
    await screen.findByTestId("expert-hero");
    toggle("adminLayouts.expertPreview.modePublished");

    const frameWindow = async () => {
      const iframe = container.querySelector("iframe");
      await waitFor(() => expect(iframe?.contentWindow?.document.documentElement).toBeTruthy());
      return iframe?.contentWindow ?? null;
    };

    const win = await frameWindow();
    expect(win?.document.documentElement.classList.contains("dark")).toBe(false);

    toggle("Dark");
    await waitFor(() =>
      expect(win?.document.documentElement.classList.contains("dark")).toBe(true),
    );
    expect(win?.document.documentElement.style.colorScheme).toBe("dark");
    expect(win?.localStorage.getItem("theme")).toBe("dark");

    toggle("Light");
    await waitFor(() =>
      expect(win?.document.documentElement.classList.contains("dark")).toBe(false),
    );
    expect(win?.localStorage.getItem("theme")).toBe("light");
  });

  it("bez sluga tryb opublikowany pokazuje komunikat zamiast pustej ramki", async () => {
    mountPreview(<ExpertLayoutPreview settings={settings()} />, null);
    await waitFor(() => expect(sb().chainsFor("profiles")).toHaveLength(1));

    toggle("adminLayouts.expertPreview.modePublished");
    expect(
      screen.getByText(/Brak eksperta z ustawionym slug-iem/, { exact: false }),
    ).toBeInTheDocument();
  });

  it("zapis (`savedAt`) sam przerzuca podgląd na opublikowany i podbija nonce", async () => {
    const { container, rerenderPane } = mountPreview(
      <ExpertLayoutPreview settings={settings()} savedAt={0} />,
    );
    await screen.findByTestId("expert-hero");

    rerenderPane(<ExpertLayoutPreview settings={settings()} savedAt={1730000000000} />);

    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    expect(container.querySelector("iframe")).toHaveAttribute(
      "src",
      "/author/anna-kowalska?__preview=1",
    );
    expect(
      screen.getByRole("button", { name: "adminLayouts.expertPreview.modePublished" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
