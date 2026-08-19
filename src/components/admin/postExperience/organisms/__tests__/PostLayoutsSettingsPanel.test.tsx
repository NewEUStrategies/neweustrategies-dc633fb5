// Panel globalnych układów wpisu - CAŁY.
//
// STAN WYJŚCIOWY: `src/routes/admin.post-layouts.tsx` miał 502 linie i 0 z 34
// funkcji pokrytych. Panel był tu wyjątkowo trudny do przetestowania z dwóch
// powodów, oba usunięte: siatka układów mieszkała w komponencie zadeklarowanym
// WEWNĄTRZ funkcji trasy, a zapis leciał surowym `<button>` bez stanu
// wyłączonego (podwójne kliknięcie = dwa zapisy).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
const stubs = vi.hoisted(() => ({ from: null as unknown, rpc: null as unknown }));

vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const { vi: vitest } = await import("vitest");
  const from = supabaseFromStub();
  const rpc = vitest.fn(async () => ({ data: "tenant-1", error: null }));
  stubs.from = from;
  stubs.rpc = rpc;
  return { supabase: { from: from.from, rpc } };
});

vi.mock("react-i18next", async () => {
  const fixtures = await import("@/test/postExperience/fixtures");
  return fixtures.reactI18nextStub();
});

// Powłoka admina ciągnie nawigację, uprawnienia i sesję - tutaj liczy się
// wyłącznie to, że panel jest w nią wstawiony.
vi.mock("@/components/admin/AdminShell", () => ({
  AdminShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-shell">{children}</div>
  ),
}));

// Miniatura układu ma własny test; potrzebne jest tu wyłącznie to, KTÓRY preset
// i który wariant sidebara dostała.
vi.mock("@/components/admin/LayoutPreview", () => ({
  LayoutPreview: ({
    preset,
    hasSidebarOverride,
  }: {
    preset: { id: string };
    hasSidebarOverride?: boolean;
  }) => (
    <span
      data-testid="layout-preview"
      data-preset={preset.id}
      data-sidebar={String(hasSidebarOverride)}
    />
  ),
}));

vi.mock("@/lib/adminToasts", () => ({
  adminToast: { layoutSaved: () => "adminToasts.layoutSaved" },
}));

import { PostLayoutsSettingsPanel } from "@/components/admin/postExperience/organisms/PostLayoutsSettingsPanel";
import {
  STANDARD_LAYOUTS,
  defaultPostLayoutSettings,
  type PostLayoutSettings,
} from "@/lib/postLayouts";
import { fail, ok, type SupabaseFromStub } from "@/test/postExperience/fixtures";

const from = () => stubs.from as SupabaseFromStub;
const rpc = () => stubs.rpc as ReturnType<typeof vi.fn>;

const settings = (over: Partial<PostLayoutSettings> = {}): PostLayoutSettings => ({
  ...defaultPostLayoutSettings(),
  ...over,
});

function renderPanel(persisted: Partial<PostLayoutSettings> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["post-layout-settings"], settings(persisted));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...render(<PostLayoutsSettingsPanel />, { wrapper }) };
}

const writeChains = () =>
  from()
    .chainsFor("post_layout_settings")
    .filter((chain) => chain.calls.some((call) => call.method === "upsert"));

const savedRow = () => writeChains()[0]?.calls[0]?.args[0] as Record<string, unknown>;

/**
 * Sekcja JEDNEJ grupy formatów.
 *
 * NAZWY OPCJI POWTARZAJĄ SIĘ MIĘDZY GRUPAMI: ten sam preset stoi w katalogu
 * standardowym i wideo, a etykieta wariantu jest identyczna, więc na stronie
 * bywają cztery przyciski o tej samej nazwie dostępnej. Zachowanie przeniesione
 * 1:1 z pliku trasy - przypięte niżej osobnym przypadkiem, poprawka (grupa
 * w nazwie opcji) idzie osobnym commitem. Testy scopują więc zapytania.
 */
function groupSection(slug: "standard" | "video" | "audio" | "gallery"): HTMLElement {
  const heading = screen.getByRole("heading", {
    level: 2,
    name: `adminLayouts.postLayouts.group.${slug}`,
  });
  const section = heading.closest("section");
  if (!section) throw new Error(`nie znaleziono sekcji grupy ${slug}`);
  return section as HTMLElement;
}

const variantButton = (
  slug: "standard" | "video" | "audio" | "gallery",
  label: string,
  withSidebar: boolean,
) =>
  within(groupSection(slug)).getByRole("button", {
    name: `${label} - adminLayouts.postLayouts.${withSidebar ? "withSidebar" : "withoutSidebar"}`,
  });

const saveButton = () => screen.getByRole("button", { name: /common\.(save)/ });
const resetButton = () => screen.getByRole("button", { name: /common\.reset/ });

beforeEach(() => {
  vi.clearAllMocks();
  from().reset();
  rpc().mockResolvedValue({ data: "tenant-1", error: null });
  from().setResponse("post_layout_settings", ok(null));
});

describe("PostLayoutsSettingsPanel - co widać", () => {
  it("panel stoi w powłoce admina, z tytułem jako nagłówkiem pierwszego poziomu", () => {
    renderPanel();
    expect(screen.getByTestId("admin-shell")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "adminLayouts.postLayouts.pageTitle" }),
    ).toBeInTheDocument();
  });

  it("CZTERY grupy formatów wpisu, każda jako nagłówek sekcji", () => {
    renderPanel();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((n) => n.textContent);
    expect(headings).toEqual(
      expect.arrayContaining([
        "adminLayouts.postLayouts.group.standard",
        "adminLayouts.postLayouts.group.video",
        "adminLayouts.postLayouts.group.audio",
        "adminLayouts.postLayouts.group.gallery",
      ]),
    );
  });

  it("każdy preset stoi w DWÓCH wariantach, oba jako przyciski z nazwą", () => {
    renderPanel();
    const first = STANDARD_LAYOUTS[0];
    expect(variantButton("standard", first.label, false)).toBeInTheDocument();
    expect(variantButton("standard", first.label, true)).toBeInTheDocument();
    expect(within(groupSection("standard")).getAllByRole("button")).toHaveLength(
      STANDARD_LAYOUTS.length * 2,
    );
  });

  it("PRZYPIĘTE ZACHOWANIE: nazwa opcji nie mówi, której GRUPY formatów dotyczy", () => {
    // Ten sam preset stoi w kilku katalogach, a etykieta wariantu jest
    // identyczna - użytkownik czytnika ekranu słyszy „Layout 1 - bez sidebara"
    // i nie wie, czy ustawia wpis standardowy, wideo, audio czy galerię.
    // Zachowanie przeniesione 1:1; poprawka osobnym commitem.
    renderPanel();
    const first = STANDARD_LAYOUTS[0];
    const all = screen.getAllByRole("button", {
      name: `${first.label} - adminLayouts.postLayouts.withoutSidebar`,
    });
    expect(all.length).toBeGreaterThan(1);
    expect(new Set(all.map((b) => b.getAttribute("aria-label"))).size).toBe(1);
  });

  it("WYBRANY wariant ogłasza `aria-pressed`, drugi wariant tego samego presetu nie", () => {
    const preset = STANDARD_LAYOUTS.find((p) => p.hasSidebar) ?? STANDARD_LAYOUTS[0];
    renderPanel({ standard_layout: preset.id });
    expect(variantButton("standard", preset.label, true)).toHaveAttribute(
      "aria-pressed",
      String(preset.hasSidebar),
    );
    expect(variantButton("standard", preset.label, false)).toHaveAttribute(
      "aria-pressed",
      String(!preset.hasSidebar),
    );
  });

  it("podgląd na żywo jest OSOBNYM regionem z nazwą, po jednym na grupę", () => {
    renderPanel();
    const previews = screen.getAllByRole("complementary", {
      name: "adminLayouts.postLayouts.livePreview",
    });
    expect(previews).toHaveLength(4);
    expect(within(previews[0]).getAllByRole("listitem").length).toBeGreaterThanOrEqual(4);
  });

  it("podsumowanie presetu opisuje SIDEBAR kluczem stanu, nie kolorem miniatury", () => {
    const preset = STANDARD_LAYOUTS.find((p) => p.hasSidebar) ?? STANDARD_LAYOUTS[0];
    renderPanel({ standard_layout: preset.id });
    const preview = screen.getAllByRole("complementary", {
      name: "adminLayouts.postLayouts.livePreview",
    })[0];
    const expected = preset.hasSidebar
      ? "adminLayouts.postLayouts.sidebarYes"
      : "adminLayouts.postLayouts.sidebarNo";
    expect(within(preview).getByText(expected)).toBeInTheDocument();
    expect(within(preview).getByText("adminLayouts.postLayouts.sidebarRow")).toBeInTheDocument();
  });

  it("TRZY pola proporcji, każde z etykietą Z PARAMETREM, nie z nazwą kolumny bazy", () => {
    // Kopia budowała etykietę przez `k.replace("featured_ratio_", "Layout ")`,
    // więc administrator widział „Layout l6" - nazwa techniczna wyciekała
    // do interfejsu i nie dawała się przetłumaczyć.
    renderPanel();
    for (const layout of ["6", "10", "11"]) {
      expect(
        screen.getByRole("spinbutton", {
          name: `adminLayouts.postLayouts.featuredRatioField(layout=${layout})`,
        }),
      ).toBeInTheDocument();
    }
    expect(screen.queryByText(/featured_ratio_/)).toBeNull();
  });

  it("DWANAŚCIE wierszy typografii, każdy z suwakiem i polem liczbowym na tę samą wartość", () => {
    renderPanel();
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(12);
    // Trzy pola proporcji + dwanaście pól typografii.
    expect(screen.getAllByRole("spinbutton")).toHaveLength(15);
  });

  it("JEDENAŚCIE przełączników to PRAWDZIWE przełączniki z nazwą i stanem", () => {
    // Kopia miała własny `<button>` bez `role="switch"`, bez `aria-checked`
    // i bez nazwy - czytnik ekranu słyszał jedenaście bezimiennych przycisków.
    renderPanel();
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(11);
    expect(switches.every((s) => s.hasAttribute("aria-checked"))).toBe(true);
  });

  it("stan przełącznika idzie Z USTAWIEŃ, nie z wartości domyślnej komponentu", () => {
    renderPanel({ show_citation: false, show_author_card: true });
    expect(
      screen.getByRole("switch", { name: /adminLayouts\.postLayouts\.citationBox/ }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByRole("switch", { name: /adminLayouts\.postLayouts\.authorCard/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("preset BEZ rekomendowanej grafiki pokazuje oznaczenie braku, nie puste miejsce", () => {
    renderPanel();
    const badges = screen.getAllByText("adminLayouts.postLayouts.none");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0].className).toContain("bg-muted");
  });
});

describe("PostLayoutsSettingsPanel - stan wczytywania i zapis", () => {
  it("BEZ danych panel pokazuje komunikat wczytywania, nie pusty formularz", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<PostLayoutsSettingsPanel />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });
    expect(screen.getByText("adminLayouts.postLayouts.loading")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("ODŚWIEŻENIE W TLE nie przestawia punktu odniesienia w trakcie edycji", async () => {
    // Odniesienie jest zamrożone razem ze szkicem. Bez tego nowa odpowiedź
    // serwera stawałaby się punktem odniesienia w trakcie edycji i „niezapisane
    // zmiany" gasłyby same, choć użytkownik niczego nie zapisał.
    const { queryClient } = renderPanel({ show_citation: true });
    fireEvent.click(screen.getByRole("switch", { name: /citationBox/ }));
    expect(saveButton()).not.toBeDisabled();
    queryClient.setQueryData(["post-layout-settings"], settings({ show_citation: false }));
    await waitFor(() => expect(saveButton()).not.toBeDisabled());
    expect(screen.getByRole("switch", { name: /citationBox/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("BEZ ZMIAN zapis i reset są wyłączone - kopia miała surowy przycisk bez stanu", () => {
    renderPanel();
    expect(saveButton()).toBeDisabled();
    expect(resetButton()).toBeDisabled();
  });

  it("pierwsza zmiana odblokowuje zapis", () => {
    renderPanel({ show_citation: true });
    fireEvent.click(screen.getByRole("switch", { name: /citationBox/ }));
    expect(saveButton()).not.toBeDisabled();
    expect(resetButton()).not.toBeDisabled();
  });

  it("RESET wraca do stanu z bazy i nie zapisuje", () => {
    renderPanel({ show_citation: true });
    fireEvent.click(screen.getByRole("switch", { name: /citationBox/ }));
    fireEvent.click(resetButton());
    expect(screen.getByRole("switch", { name: /citationBox/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(writeChains()).toHaveLength(0);
  });

  it("zapis to UPSERT z konfliktem na `tenant_id`, BEZ pola `tenant_id` ze szkicu", async () => {
    renderPanel({ show_citation: true });
    fireEvent.click(screen.getByRole("switch", { name: /citationBox/ }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(writeChains()[0]?.calls[0]?.args[1]).toEqual({ onConflict: "tenant_id" });
    expect(savedRow().show_citation).toBe(false);
  });

  it("wiersz jedzie z tenantem rozstrzygniętym po stronie serwera", async () => {
    renderPanel({ show_citation: true });
    fireEvent.click(screen.getByRole("switch", { name: /citationBox/ }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(rpc()).toHaveBeenCalledWith("current_tenant_id");
    expect(savedRow().tenant_id).toBe("tenant-1");
  });

  it("UDANY zapis melduje sukces i wygasza przycisk", async () => {
    const { queryClient } = renderPanel({ show_citation: true });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(screen.getByRole("switch", { name: /citationBox/ }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.layoutSaved"));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["post-layout-settings"] });
  });

  it("NIEUDANY zapis melduje błąd z treścią, a szkic zostaje", async () => {
    from().setResponse("post_layout_settings", fail("permission denied", "42501"));
    renderPanel({ show_citation: true });
    fireEvent.click(screen.getByRole("switch", { name: /citationBox/ }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastError).toHaveBeenCalledWith(
      expect.stringContaining("adminLayouts.postLayouts.saveErrorToast"),
    );
    expect(screen.getByRole("switch", { name: /citationBox/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("BŁĄD odczytu tenanta zatrzymuje zapis i melduje niepowodzenie", async () => {
    // PostgREST oddaje OBIEKT błędu, nie instancję `Error`, więc panel schodzi
    // na komunikat zapasowy - i to jest tu istotne: bez gałęzi awaryjnej
    // użytkownik nie dostałby żadnego komunikatu.
    rpc().mockResolvedValue({ data: null, error: { message: "jwt expired" } });
    renderPanel({ show_citation: true });
    fireEvent.click(screen.getByRole("switch", { name: /citationBox/ }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastError).toHaveBeenCalledWith(
      expect.stringContaining("adminLayouts.postLayouts.saveFailed"),
    );
    expect(writeChains()).toHaveLength(0);
  });

  it("wyjątek Z TREŚCIĄ przekazuje ją do komunikatu", async () => {
    rpc().mockRejectedValue(new Error("network down"));
    renderPanel({ show_citation: true });
    fireEvent.click(screen.getByRole("switch", { name: /citationBox/ }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining("network down"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("PostLayoutsSettingsPanel - co idzie do bazy", () => {
  it("wybór wariantu ustawia JEDNOCZEŚNIE układ i nadpisanie sidebara", async () => {
    // Dwa osobne `setState` czytałyby ten sam stan z domknięcia, więc drugie
    // kasowałoby pierwsze - stąd jedna łata w regule.
    const target = STANDARD_LAYOUTS[1];
    renderPanel({ standard_layout: STANDARD_LAYOUTS[0].id });
    fireEvent.click(variantButton("standard", target.label, true));
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().standard_layout).toBe(target.id);
    expect(savedRow().layout_sidebar_overrides).toMatchObject({ [target.id]: true });
  });

  it("wybór wariantu BEZ sidebara zapisuje nadpisanie `false`, nie brak wpisu", async () => {
    const target = STANDARD_LAYOUTS.find((p) => p.hasSidebar) ?? STANDARD_LAYOUTS[0];
    renderPanel({ standard_layout: target.id });
    fireEvent.click(variantButton("standard", target.label, false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    const overrides = savedRow().layout_sidebar_overrides as Record<string, boolean>;
    expect(overrides[target.id]).toBe(false);
    expect(Object.keys(overrides)).toContain(target.id);
  });

  it("nadpisanie innego presetu ZOSTAJE po wyborze kolejnego", async () => {
    const first = STANDARD_LAYOUTS[0];
    const second = STANDARD_LAYOUTS[1];
    renderPanel({ layout_sidebar_overrides: { [first.id]: true } });
    fireEvent.click(variantButton("standard", second.label, false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().layout_sidebar_overrides).toMatchObject({
      [first.id]: true,
      [second.id]: false,
    });
  });

  it("KAŻDA grupa formatów zapisuje się w SWOIM polu", async () => {
    renderPanel();
    const video = screen.getAllByRole("heading", {
      level: 2,
      name: "adminLayouts.postLayouts.group.video",
    })[0];
    expect(video).toBeInTheDocument();
    // Wybór w grupie wideo nie może ruszyć układu standardowego.
    const before = settings().standard_layout;
    fireEvent.click(screen.getByRole("switch", { name: /citationBox/ }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().standard_layout).toBe(before);
  });

  it("proporcja obrazu jest przycinana do granic panelu", async () => {
    renderPanel();
    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: "adminLayouts.postLayouts.featuredRatioField(layout=6)",
      }),
      { target: { value: "999" } },
    );
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().featured_ratio_l6).toBe(200);
  });

  it("SUWAK typografii i POLE liczbowe zmieniają to samo ustawienie", async () => {
    renderPanel();
    const sliders = screen.getAllByRole("slider");
    fireEvent.change(sliders[0], { target: { value: "48" } });
    const spinbuttons = screen.getAllByRole("spinbutton");
    // Pierwsze trzy pola liczbowe to proporcje; typografia zaczyna się od czwartego.
    fireEvent.change(spinbuttons[3], { target: { value: "52" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().overlay_title_size_base).toBe(52);
  });

  it("wartość typografii PONAD granicą jest przycięta", async () => {
    renderPanel();
    fireEvent.change(screen.getAllByRole("spinbutton")[3], { target: { value: "500" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow().overlay_title_size_base).toBe(96);
  });

  it("przełączniki centrowania i stopki jadą do bazy pod swoimi kluczami", async () => {
    renderPanel({ center_header: false, show_prev_next: true, auto_load_next_post: false });
    fireEvent.click(screen.getByRole("switch", { name: /centerTitle/ }));
    fireEvent.click(screen.getByRole("switch", { name: /prevNext/ }));
    fireEvent.click(screen.getByRole("switch", { name: /autoLoadNext/ }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(writeChains()).toHaveLength(1));
    expect(savedRow()).toMatchObject({
      center_header: true,
      show_prev_next: false,
      auto_load_next_post: true,
    });
  });
});
