// PANEL GLOBALNEJ TYPOGRAFII (`ThemeFontSizesPane`) - H1-H6, typografia bazowa,
// odstępy treści i migracja opublikowanych wpisów.
//
// CO TEN PLIK PRZYPINA (a czego montaż bez interakcji nie dowodzi):
//   1. PANEL PISZE DO DWÓCH RÓŻNYCH MIEJSC. Rozmiary jadą do
//      `site_settings.font_sizes`, a ODSTĘP MIĘDZY AKAPITAMI do
//      `post_layout_settings.paragraph_spacing_rem` - bo to samo pole edytuje
//      też `/admin/content-area`. Zapis odstępu leci TYLKO wtedy, gdy wartość
//      naprawdę się zmieniła; inaczej każde kliknięcie „Zapisz" biłoby w drugą
//      tabelę bez powodu.
//   2. PODGLĄD NA ŻYWO WYPRZEDZA ZAPIS. Znacznik `<style>` panelu emituje
//      tokeny `--fs-*` ze SZKICU, więc redaktor widzi zmianę, zanim cokolwiek
//      trafi do bazy.
//   3. WYCZYSZCZENIE POLA LICZBOWEGO SPADA NA MINIMUM, nie na `NaN`.
//      `NumField` robi `typeof v === "number" ? v : (min ?? 0)`; bez tego pusty
//      input zapisałby `NaN` i walidacja zod odrzuciłaby CAŁY zapis.
//   4. MIGRACJA OPUBLIKOWANYCH WPISÓW MA DWA PRZEBIEGI. „Skanuj" to `dryRun`
//      (nic nie zmienia), a „Zastosuj" jest ZABLOKOWANE, dopóki skan nie
//      znajdzie wpisów - bez tego jedno kliknięcie przepisywałoby treści.
//   5. JĘZYK PANELU STERUJE NAPISAMI FORMULARZA (`isPL` z `i18n.language`),
//      a nie tylko nagłówkiem sekcji.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   - `fontSizesToCss`, schemat zod i `deepMerge` mają własne testy; tutaj
//     sprawdzam, czy panel woła je ze szkicem, który redaktor widzi na ekranie.
//   - `applyTypographyToPublished` (server fn) jest ATRAPĄ - jej ciało ma
//     własną powierzchnię testową; tu liczy się WEJŚCIE (`dryRun`) i to, co
//     panel robi z wynikiem.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  mountSettingsPane,
  paneToastSpies,
  selectWithOption,
  type SettingsPaneSupabase,
} from "@/test/admin/settingsPaneHarness";
import { resetPendingWrites } from "@/lib/useSiteSetting";
import type { ApplyTypographyResult } from "@/lib/theme/typographyApply.functions";

/** Wejście, z jakim panel woła server fn migracji. */
interface ApplyInput {
  data: { dryRun: boolean };
}

const stubs = vi.hoisted(() => ({
  supabase: null as unknown,
  toasts: null as unknown,
  language: "pl",
  /** Funkcja podana do `useServerFn` - dowód, że to TA server fn. */
  serverFnArg: null as unknown,
  apply: null as unknown,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => stubs.language),
);

vi.mock("@/integrations/supabase/client", async () => {
  const { settingsPaneSupabase: make } = await import("@/test/admin/settingsPaneHarness");
  const sb = make();
  stubs.supabase = sb;
  return { supabase: sb.client };
});

// Cache SSR jest PER IZOLAT (60 s) - bez przezroczystej atrapy drugi test
// w pliku dostałby mapę ustawień pierwszego.
vi.mock("@/lib/ssrCache", () => ({
  edgeTtlCache: async <T,>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
  invalidateEdgeTtlCache: async () => {},
  clearEdgeTtlCache: () => {},
}));

// Panel woła DWA kanały powiadomień: `notify` (zapis rozmiarów) i `sonner`
// (migracja wpisów). Obie fabryki dzielą JEDEN komplet spy - kolejność ich
// wykonania zależy od kolejności importów w module produkcyjnym, więc komplet
// powstaje w tej, która trafi pierwsza.
async function sharedToasts(): Promise<ReturnType<typeof paneToastSpies>> {
  if (!stubs.toasts) {
    const { paneToastSpies: make } = await import("@/test/admin/settingsPaneHarness");
    stubs.toasts = make();
  }
  return stubs.toasts as ReturnType<typeof paneToastSpies>;
}

vi.mock("@/lib/notify", async () => (await sharedToasts()).notify());

vi.mock("sonner", async () => (await sharedToasts()).sonner());

vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(react);
});

// Granica server fn: `useServerFn` zwraca wołalną atrapę, a my zapisujemy,
// KTÓRĄ funkcję panel jej podał.
// Podmieniamy WYŁĄCZNIE `useServerFn`: reszta modułu (`createIsomorphicFn`)
// stoi pod runtime'em języka (`lib/i18n/localeRuntime`), który wciąga ten sam
// import - pełna atrapa wywracała cały plik na starcie.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => {
    stubs.serverFnArg = fn;
    return stubs.apply;
  },
}));

vi.mock("@/lib/theme/typographyApply.functions", () => ({
  applyTypographyToPublished: { __serverFn: "applyTypographyToPublished" },
}));

import { ThemeFontSizesPane } from "@/components/admin/ThemeFontSizesPane";

const sb = () => stubs.supabase as SettingsPaneSupabase;
const toasts = () => stubs.toasts as ReturnType<typeof paneToastSpies>;
const applyFn = () => stubs.apply as ReturnType<typeof vi.fn>;

/** Pola `NumField` mają etykietę NIEZWIĄZANĄ z inputem - wiążemy ją strukturą. */
function numFields(container: HTMLElement, label: string): HTMLInputElement[] {
  return [...container.querySelectorAll("label")]
    .filter((node) => node.textContent === label)
    .map((node) => {
      const input = node.parentElement?.querySelector("input");
      if (!input) throw new Error(`test: pole "${label}" bez inputa`);
      return input;
    });
}

/** Pierwsze pole o danej etykiecie (nagłówki idą w kolejności H1..H6). */
const numField = (container: HTMLElement, label: string, index = 0): HTMLInputElement =>
  numFields(container, label)[index];

const styleCss = (container: HTMLElement): string =>
  container.querySelector("style")?.innerHTML ?? "";

/** Wynik skanu w kształcie, w jakim oddaje go server fn. */
function scanResult(overrides: Partial<ApplyTypographyResult> = {}): ApplyTypographyResult {
  return {
    dryRun: true,
    scanned: 12,
    affected: 2,
    updated: 0,
    posts: [
      { id: "p1", slug: "wpis-pierwszy", title: "Wpis pierwszy" },
      { id: "p2", slug: "wpis-drugi", title: "Wpis drugi" },
    ],
    ...overrides,
  };
}

/** Montaż z wierszami w bazie; czeka, aż szkic zassie zapisane wartości. */
async function mountPane(options: {
  fontSizes?: Record<string, unknown>;
  paragraphSpacing?: number;
}): Promise<ReturnType<typeof mountSettingsPane>> {
  if (options.fontSizes) sb().setSetting("font_sizes", options.fontSizes);
  sb().setTable(
    "post_layout_settings",
    options.paragraphSpacing === undefined
      ? null
      : { paragraph_spacing_rem: options.paragraphSpacing },
  );
  sb().rpc.setData("current_tenant_id", "tenant-test");
  const view = mountSettingsPane(<ThemeFontSizesPane />);
  await waitFor(() => expect(sb().chainsFor("site_settings").length).toBeGreaterThan(0));
  return view;
}

beforeEach(() => {
  resetPendingWrites();
  sb().reset();
  toasts().reset();
  stubs.language = "pl";
  stubs.serverFnArg = null;
  stubs.apply = vi.fn(async (_input: ApplyInput) => scanResult());
});

afterEach(() => {
  cleanup();
});

describe("ThemeFontSizesPane - wczytanie", () => {
  it("bez wiersza w bazie formularz stoi na wartościach domyślnych motywu", async () => {
    const { container } = await mountPane({});

    await waitFor(() => expect(numField(container, "Desktop").value).toBe("44"));
    expect(numField(container, "Mobile").value).toBe("32");
    expect(numField(container, "Desktop", 1).value).toBe("34");
    expect(numField(container, "Size").value).toBe("16");
    expect(numField(container, "Między akapitami").value).toBe("1.5");
    expect(styleCss(container)).toContain("--fs-h1:44px;");
  });

  it("zapisane rozmiary i odstęp z DRUGIEJ tabeli trafiają do formularza", async () => {
    const { container } = await mountPane({
      fontSizes: { headings: { h1: { desktop: 60, mobile: 40 } }, body: { size: 18 } },
      paragraphSpacing: 2.25,
    });

    await waitFor(() => expect(numField(container, "Desktop").value).toBe("60"));
    expect(numField(container, "Mobile").value).toBe("40");
    expect(numField(container, "Size").value).toBe("18");
    await waitFor(() => expect(numField(container, "Między akapitami").value).toBe("2.25"));
    expect(styleCss(container)).toContain("--fs-h1:60px;");
    expect(styleCss(container)).toContain("margin-bottom:2.25rem;");
  });

  it("po angielsku panel zmienia napisy formularza, nie tylko nagłówek", async () => {
    stubs.language = "en";
    await mountPane({});

    await waitFor(() => expect(screen.getByText("Headings H1-H6")).toBeInTheDocument());
    expect(screen.getByText("Base typography")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Scan posts/ })).toBeInTheDocument();
    expect(screen.queryByText("Nagłówki H1-H6")).toBeNull();
  });
});

describe("ThemeFontSizesPane - edycja i zapis", () => {
  it("zmiana rozmiaru przelicza podgląd PRZED zapisem", async () => {
    const { container } = await mountPane({});
    await waitFor(() => expect(numField(container, "Desktop").value).toBe("44"));

    fireEvent.change(numField(container, "Desktop"), { target: { value: "72" } });

    expect(styleCss(container)).toContain("--fs-h1:72px;");
    expect(sb().writes("site_settings")).toHaveLength(0);
  });

  it("zapis wysyła ZWALIDOWANY komplet do `site_settings.font_sizes`", async () => {
    const { container } = await mountPane({});
    await waitFor(() => expect(numField(container, "Desktop").value).toBe("44"));

    fireEvent.change(numField(container, "Desktop"), { target: { value: "72" } });
    fireEvent.change(numField(container, "Interlinia"), { target: { value: "1.4" } });
    fireEvent.change(numField(container, "Breakpoint mobilny"), { target: { value: "900" } });
    fireEvent.change(selectWithOption(container, "uppercase"), {
      target: { value: "uppercase" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));

    await waitFor(() => expect(toasts().notifySuccess).toHaveBeenCalledTimes(1));
    const payload = sb().lastWrite("site_settings") as {
      key: string;
      value: { headings: { h1: { desktop: number; lineHeight: number; transform: string } } };
    };
    expect(payload.key).toBe("font_sizes");
    expect(payload.value.headings.h1.desktop).toBe(72);
    expect(payload.value.headings.h1.lineHeight).toBe(1.4);
    expect(payload.value.headings.h1.transform).toBe("uppercase");
    // Breakpoint mieszka OBOK nagłówków, w tym samym dokumencie ustawień.
    expect((payload.value as unknown as { mobileBreakpoint: number }).mobileBreakpoint).toBe(900);
  });

  it("KAŻDE pole formularza pisze do własnej gałęzi dokumentu, nie do sąsiedniej", async () => {
    const { container } = await mountPane({});
    await waitFor(() => expect(numField(container, "Desktop").value).toBe("44"));

    // Nagłówek H1 - pięć osobnych ścieżek `setHeading`.
    fireEvent.change(numField(container, "Mobile"), { target: { value: "30" } });
    fireEvent.change(numField(container, "Odst. znaków"), { target: { value: "1.5" } });
    fireEvent.change(numField(container, "Grubość"), { target: { value: "500" } });
    // Typografia bazowa - cztery pary `setBase` + dwa pola samodzielne.
    const sizes = numFields(container, "Size");
    const lineHeights = numFields(container, "Line-height");
    fireEvent.change(sizes[0], { target: { value: "17" } });
    fireEvent.change(lineHeights[0], { target: { value: "1.7" } });
    fireEvent.change(sizes[1], { target: { value: "12" } });
    fireEvent.change(lineHeights[1], { target: { value: "1.45" } });
    fireEvent.change(sizes[2], { target: { value: "20" } });
    fireEvent.change(lineHeights[2], { target: { value: "1.55" } });
    fireEvent.change(sizes[3], { target: { value: "21" } });
    fireEvent.change(lineHeights[3], { target: { value: "1.5" } });
    fireEvent.change(numField(container, "Code (inline)"), { target: { value: "15" } });
    // Odstępy treści - cztery ścieżki `setSpacing`.
    fireEvent.change(numField(container, "Nad nagłówkiem"), { target: { value: "2.5" } });
    fireEvent.change(numField(container, "Pod nagłówkiem"), { target: { value: "0.8" } });
    fireEvent.change(numField(container, "Listy"), { target: { value: "1.2" } });
    fireEvent.change(numField(container, "Cytaty"), { target: { value: "1.9" } });

    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));
    await waitFor(() => expect(toasts().notifySuccess).toHaveBeenCalledTimes(1));

    const value = (
      sb().lastWrite("site_settings") as {
        value: {
          headings: { h1: { mobile: number; letterSpacing: number; weight: number } };
          body: { size: number; lineHeight: number };
          small: { size: number; lineHeight: number };
          lead: { size: number; lineHeight: number };
          blockquote: { size: number; lineHeight: number };
          code: { size: number };
          spacing: {
            headingTopRem: number;
            headingBottomRem: number;
            listRem: number;
            blockquoteRem: number;
          };
        };
      }
    ).value;

    expect(value.headings.h1).toMatchObject({ mobile: 30, letterSpacing: 1.5, weight: 500 });
    expect(value.body).toEqual({ size: 17, lineHeight: 1.7 });
    expect(value.small).toEqual({ size: 12, lineHeight: 1.45 });
    expect(value.lead).toEqual({ size: 20, lineHeight: 1.55 });
    expect(value.blockquote).toEqual({ size: 21, lineHeight: 1.5 });
    expect(value.code).toEqual({ size: 15 });
    expect(value.spacing).toEqual({
      headingTopRem: 2.5,
      headingBottomRem: 0.8,
      listRem: 1.2,
      blockquoteRem: 1.9,
    });
  });

  it("odstęp akapitów leci OSOBNYM zapisem do `post_layout_settings` - i tylko gdy się zmienił", async () => {
    const { container } = await mountPane({ paragraphSpacing: 1.5 });
    await waitFor(() => expect(numField(container, "Desktop").value).toBe("44"));

    // Sam rozmiar czcionki nie ma prawa ruszyć drugiej tabeli.
    fireEvent.change(numField(container, "Desktop"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));
    await waitFor(() => expect(toasts().notifySuccess).toHaveBeenCalled());
    expect(sb().writes("post_layout_settings")).toHaveLength(0);

    // Zmiana odstępu - dopiero teraz.
    fireEvent.change(numField(container, "Między akapitami"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));

    await waitFor(() => expect(sb().writes("post_layout_settings")).toHaveLength(1));
    expect(sb().lastWrite("post_layout_settings")).toEqual({
      paragraph_spacing_rem: 2.5,
      tenant_id: "tenant-test",
    });
    expect(sb().rpc.names()).toContain("current_tenant_id");
  });

  it("wyczyszczenie pola liczbowego spada na minimum, a nie na NaN", async () => {
    const { container } = await mountPane({});
    await waitFor(() => expect(numField(container, "Desktop").value).toBe("44"));

    fireEvent.change(numField(container, "Desktop"), { target: { value: "" } });
    expect(numField(container, "Desktop").value).toBe("10");
    expect(styleCss(container)).toContain("--fs-h1:10px;");
  });

  it("Reset przywraca komplet wartości domyślnych razem z odstępem akapitów", async () => {
    const { container } = await mountPane({
      fontSizes: { headings: { h1: { desktop: 60 } } },
      paragraphSpacing: 2.25,
    });
    await waitFor(() => expect(numField(container, "Desktop").value).toBe("60"));

    fireEvent.click(screen.getByRole("button", { name: /Reset/ }));

    expect(numField(container, "Desktop").value).toBe("44");
    expect(numField(container, "Między akapitami").value).toBe("1.5");
  });

  it("błąd zapisu idzie kanałem `notifyError`, a szkic zostaje na ekranie", async () => {
    const { container } = await mountPane({});
    await waitFor(() => expect(numField(container, "Desktop").value).toBe("44"));
    sb().failWrite("site_settings", "RLS: brak uprawnień do site_settings", "42501");

    fireEvent.change(numField(container, "Desktop"), { target: { value: "55" } });
    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));

    await waitFor(() => expect(toasts().notifyError).toHaveBeenCalledTimes(1));
    expect(toasts().notifyError.mock.calls[0][0]).toContain("site_settings");
    expect(toasts().notifySuccess).not.toHaveBeenCalled();
    expect(numField(container, "Desktop").value).toBe("55");
  });
});

describe("ThemeFontSizesPane - migracja opublikowanych wpisów", () => {
  it("skan to `dryRun`, a Zastosuj odblokowuje się dopiero po znalezieniu wpisów", async () => {
    const { container } = await mountPane({});
    await waitFor(() => expect(numField(container, "Desktop").value).toBe("44"));

    // Panel podał `useServerFn` DOKŁADNIE tę server fn.
    expect(stubs.serverFnArg).toEqual({ __serverFn: "applyTypographyToPublished" });

    const applyButton = screen.getByRole("button", { name: /Zastosuj typografię/ });
    expect(applyButton).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Skanuj wpisy/ }));
    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));

    expect(applyFn()).toHaveBeenCalledWith({ data: { dryRun: true } });
    expect(toasts().success.mock.calls[0][0]).toContain("12");
    expect(screen.getByText("Wpis pierwszy")).toBeInTheDocument();
    expect(screen.getByText("/wpis-drugi")).toBeInTheDocument();

    applyFn().mockResolvedValueOnce(scanResult({ dryRun: false, affected: 2, updated: 2 }));
    fireEvent.click(screen.getByRole("button", { name: /Zastosuj typografię/ }));

    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(2));
    expect(applyFn()).toHaveBeenLastCalledWith({ data: { dryRun: false } });
    expect(toasts().success.mock.calls[1][0]).toContain("2");
  });

  it("zero wpisów do migracji: komunikat o synchronizacji i przycisk nadal zablokowany", async () => {
    const { container } = await mountPane({});
    await waitFor(() => expect(numField(container, "Desktop").value).toBe("44"));
    applyFn().mockResolvedValueOnce(scanResult({ scanned: 40, affected: 0, posts: [] }));

    fireEvent.click(screen.getByRole("button", { name: /Skanuj wpisy/ }));

    await waitFor(() => expect(toasts().success).toHaveBeenCalled());
    expect(
      screen.getByText(/Wszystkie opublikowane wpisy dziedziczą już typografię motywu/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Zastosuj typografię/ })).toBeDisabled();
  });

  it("po angielsku podsumowanie skanu jest angielskie", async () => {
    stubs.language = "en";
    await mountPane({});
    await waitFor(() => expect(screen.getByText("Headings H1-H6")).toBeInTheDocument());
    applyFn().mockResolvedValueOnce(scanResult({ scanned: 7, affected: 0, posts: [] }));

    fireEvent.click(screen.getByRole("button", { name: /Scan posts/ }));

    await waitFor(() => expect(toasts().success).toHaveBeenCalled());
    expect(toasts().success.mock.calls[0][0]).toContain("Scanned 7 posts");
    expect(
      screen.getByText(/Every published article already inherits the theme typography/),
    ).toBeInTheDocument();
  });

  it("odmowa serwera pokazuje komunikat błędu, a nie ciszę", async () => {
    const { container } = await mountPane({});
    await waitFor(() => expect(numField(container, "Desktop").value).toBe("44"));
    applyFn().mockRejectedValueOnce(new Error("Brak uprawnień administratora"));

    fireEvent.click(screen.getByRole("button", { name: /Skanuj wpisy/ }));

    await waitFor(() => expect(toasts().error).toHaveBeenCalledTimes(1));
    expect(toasts().error).toHaveBeenCalledWith("Brak uprawnień administratora");
    expect(screen.getByRole("button", { name: /Zastosuj typografię/ })).toBeDisabled();
  });
});
