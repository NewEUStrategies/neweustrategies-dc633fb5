// Ustawienia obramowania stopki - `FooterChromePane`.
//
// CO TEN PLIK PRZYPINA I DLACZEGO. Ten panel zapisuje JEDEN podklucz
// (`chrome`) wewnątrz wiersza `site_settings.key = 'footer'`, w którym leży
// też cały dokument buildera stopki. Zapis, który nadpisze wiersz zamiast go
// scalić, KASUJE stopkę zbudowaną w edytorze - i nie da się tego zauważyć
// w panelu, bo panel pokazuje tylko swoją część. Dlatego przypinam:
//   1. SCALANIE ZAMIAST NADPISANIA: ładunek `upsert` zawiera nietknięte
//      `builder_data` z odczytanego wiersza plus nowe `chrome`, a konflikt
//      rozstrzyga para `tenant_id,key` (bez tego zapis jednego serwisu
//      wywracałby wiersz drugiego).
//   2. WEJŚCIE Z BAZY PRZECHODZI PRZEZ SCHEMAT. Wartości z bazy są scalane
//      z domyślnymi (brakujące pola dostają wartości domyślne), a wiersz
//      NIEZGODNY ze schematem wraca do kompletu domyślnego zamiast wywrócić
//      panel - to jedyna bariera między ręczną edycją jsonb a błędem renderu.
//   3. KAŻDA KONTROLKA STERUJE WŁASNYM POLEM i przeżywa do zapisu (panel
//      trzyma cały obiekt w stanie i wysyła go dopiero przyciskiem).
//   4. PRÓG "DO GÓRY" JEST LICZBĄ I JEST WYŁĄCZANY RAZEM Z PRZYCISKIEM.
//      Wpis nieliczbowy daje `0`, a nie `NaN` - `NaN` w jsonb to `null`
//      i przycisk powrotu przestałby się pokazywać.
//   5. OBIE DROGI WYJŚCIA ZAPISU: sukces unieważnia klucz panelu ORAZ
//      zbiorczy klucz publiczny (bez tego druga zakładka i front pokazują
//      starą stopkę do czasu przeładowania), a błąd idzie do `toastError`
//      z etykietą operacji.
//
// GAŁĄŹ NIEOSIĄGALNA Z INTERFEJSU: osłona `...(data ?? {})` w `mutationFn` -
// formularz (a z nim przycisk zapisu) renderuje się dopiero po ustawieniu
// stanu `c`, który ustawia efekt zależny od `data`; przy błędzie odczytu panel
// stoi na stanie ładowania (osobny test niżej).
//
// Radix Select i Switch nie działają pod happy-dom bez pointer API - oba są
// podmienione na natywne odpowiedniki. Klient bazy jest atrapą; ZERO sieci.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { fail, ok, supabaseFromStub, type RecordedChain } from "@/test/supabase";
import { radixSelectStub, radixSwitchStub } from "@/test/reactStubs";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(error: unknown, operation: string) => void>(),
}));

const baza = supabaseFromStub();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => baza.from(table) },
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: vi.fn() },
  Toaster: () => null,
}));
vi.mock("@/lib/toastError", () => ({ toastError: h.toastError }));

const { FooterChromePane } = await import("@/components/admin/FooterChromePane");

/** Wiersz `site_settings` widziany przez panel (obok `chrome` żyje builder). */
function wiersz(chrome: Record<string, unknown> | undefined) {
  return { value: { builder_data: { sections: ["nietykalne"] }, chrome } };
}

/**
 * Odczyt zwraca wiersz, a zapis (`upsert`) - wynik podany przez test.
 * Rozróżnienie po ogniwie łańcucha, bo obie operacje idą przez tę samą tabelę.
 */
function ustawBaze(chrome: Record<string, unknown> | undefined, zapis = ok(null)) {
  baza.reset();
  baza.setResponse("site_settings", (chain: RecordedChain) =>
    chain.has("upsert") ? zapis : ok(wiersz(chrome)),
  );
}

async function renderuj(chrome: Record<string, unknown> | undefined, zapis = ok(null)) {
  ustawBaze(chrome, zapis);
  const utils = renderWithQueryClient(<FooterChromePane />);
  const invalidate = vi.spyOn(utils.queryClient, "invalidateQueries");
  await screen.findByRole("combobox");
  return { ...utils, invalidate };
}

/** Ładunek ostatniego zapisu - to on ląduje w kolumnie jsonb. */
function ostatniZapis(): Record<string, unknown> {
  const upsert = baza
    .chainsFor("site_settings")
    .filter((c) => c.has("upsert"))
    .at(-1)
    ?.argsOf("upsert");
  if (!upsert) throw new Error("test: panel nie wykonał zapisu");
  return upsert[0] as Record<string, unknown>;
}

function zapisz(): void {
  fireEvent.click(screen.getByRole("button", { name: /common\.save/ }));
}

beforeEach(() => {
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("FooterChromePane - wczytanie ustawień", () => {
  it("do czasu odpowiedzi pokazuje stan ładowania, a nie pusty formularz", () => {
    ustawBaze({});
    renderWithQueryClient(<FooterChromePane />);

    expect(screen.getByText("adminPanesMisc.loading")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("BRAK WIERSZA w bazie (pierwsze otwarcie) daje komplet wartości domyślnych", async () => {
    // `maybeSingle()` oddaje `null`, a nie błąd - panel musi to znieść.
    baza.reset();
    baza.setResponse("site_settings", (chain: RecordedChain) =>
      chain.has("upsert") ? ok(null) : ok(null),
    );
    renderWithQueryClient(<FooterChromePane />);

    expect(await screen.findByRole("combobox")).toHaveValue("default");
    expect(screen.getByRole("spinbutton")).toHaveValue(400);
  });

  it("błąd odczytu NIE pokazuje formularza z wartościami zmyślonymi", async () => {
    baza.reset();
    baza.setResponse("site_settings", fail("permission denied for table site_settings", "42501"));
    renderWithQueryClient(<FooterChromePane />);

    await waitFor(() => expect(baza.chainsFor("site_settings").length).toBeGreaterThan(0));
    expect(screen.getByText("adminPanesMisc.loading")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("brak podklucza `chrome` daje komplet wartości domyślnych", async () => {
    await renderuj(undefined);

    expect(screen.getByRole("combobox")).toHaveValue("default");
    expect(screen.getByLabelText("Separator")).toBeChecked();
    expect(screen.getByLabelText("adminPanesMisc.footer.showYear")).toBeChecked();
    expect(screen.getByLabelText("adminPanesMisc.footer.backToTop")).toBeChecked();
    expect(screen.getByRole("spinbutton")).toHaveValue(400);
  });

  it("wartości z bazy wygrywają z domyślnymi, a brakujące pola dostają domyślne", async () => {
    await renderuj({ layout: "dark", show_separator: false, copyright_pl: "© Redakcja" });

    expect(screen.getByRole("combobox")).toHaveValue("dark");
    expect(screen.getByLabelText("Separator")).not.toBeChecked();
    expect(screen.getByDisplayValue("© Redakcja")).toBeInTheDocument();
    // Pola, których w bazie nie było, pochodzą ze schematu.
    expect(screen.getByLabelText("adminPanesMisc.footer.backToTop")).toBeChecked();
    expect(screen.getByRole("spinbutton")).toHaveValue(400);
  });

  it("wiersz NIEZGODNY ze schematem wraca do kompletu domyślnego zamiast wywracać panel", async () => {
    await renderuj({ layout: "kosmos", back_to_top_threshold_px: 99999 });

    expect(screen.getByRole("combobox")).toHaveValue("default");
    expect(screen.getByRole("spinbutton")).toHaveValue(400);
  });

  it("lista układów wystawia wszystkie warianty stopki", async () => {
    await renderuj({});

    expect(screen.getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual([
      "default",
      "centered",
      "minimal",
      "dark",
      "light",
    ]);
  });
});

describe("FooterChromePane - kontrolki sterują własnymi polami", () => {
  it("zmiana układu trafia do klucza `layout`", async () => {
    await renderuj({});

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "centered" } });
    zapisz();

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const zapisane = ostatniZapis().value as Record<string, unknown>;
    expect((zapisane.chrome as Record<string, unknown>).layout).toBe("centered");
  });

  it("oba przełączniki paska i przycisk powrotu trafiają do własnych kluczy", async () => {
    await renderuj({});

    fireEvent.click(screen.getByLabelText("Separator"));
    fireEvent.click(screen.getByLabelText("adminPanesMisc.footer.showYear"));
    zapisz();

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const chrome = (ostatniZapis().value as Record<string, unknown>).chrome as Record<
      string,
      unknown
    >;
    expect(chrome.show_separator).toBe(false);
    expect(chrome.show_year).toBe(false);
    expect(chrome.back_to_top).toBe(true);
  });

  it("oba pola praw autorskich są niezależne (PL i EN)", async () => {
    await renderuj({});

    const pola = screen.getAllByRole("textbox");
    fireEvent.change(pola[0], { target: { value: "© {year} Redakcja" } });
    fireEvent.change(pola[1], { target: { value: "© {year} Newsroom" } });
    zapisz();

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const chrome = (ostatniZapis().value as Record<string, unknown>).chrome as Record<
      string,
      unknown
    >;
    expect(chrome.copyright_pl).toBe("© {year} Redakcja");
    expect(chrome.copyright_en).toBe("© {year} Newsroom");
  });

  it("wyłączenie przycisku powrotu BLOKUJE pole progu", async () => {
    await renderuj({});
    expect(screen.getByRole("spinbutton")).toBeEnabled();

    fireEvent.click(screen.getByLabelText("adminPanesMisc.footer.backToTop"));

    expect(screen.getByRole("spinbutton")).toBeDisabled();
  });

  it("próg zapisuje się jako LICZBA, a wpis nieliczbowy daje 0 zamiast NaN", async () => {
    await renderuj({});

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1200" } });
    zapisz();
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(1));
    let chrome = (ostatniZapis().value as Record<string, unknown>).chrome as Record<
      string,
      unknown
    >;
    expect(chrome.back_to_top_threshold_px).toBe(1200);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } });
    zapisz();
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(2));
    chrome = (ostatniZapis().value as Record<string, unknown>).chrome as Record<string, unknown>;
    expect(chrome.back_to_top_threshold_px).toBe(0);
  });
});

describe("FooterChromePane - zapis do site_settings", () => {
  it("scala `chrome` z resztą wiersza i nie rusza dokumentu buildera", async () => {
    await renderuj({ layout: "minimal" });

    zapisz();

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const ladunek = ostatniZapis();
    expect(ladunek.key).toBe("footer");
    const value = ladunek.value as Record<string, unknown>;
    expect(value.builder_data).toEqual({ sections: ["nietykalne"] });
    expect((value.chrome as Record<string, unknown>).layout).toBe("minimal");
  });

  it("konflikt rozstrzyga para `tenant_id,key`", async () => {
    await renderuj({});

    zapisz();

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const opcje = baza
      .chainsFor("site_settings")
      .filter((c) => c.has("upsert"))
      .at(-1)
      ?.argsOf("upsert")?.[1];
    expect(opcje).toEqual({ onConflict: "tenant_id,key" });
  });

  it("sukces unieważnia klucz panelu ORAZ zbiorczy klucz publiczny", async () => {
    const { invalidate } = await renderuj({});

    zapisz();

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminPanesMisc.savedToast"));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["site_settings", "footer"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["site_settings_public", "all"] });
  });

  it("błąd zapisu idzie do `toastError` z etykietą operacji, bez fałszywego sukcesu", async () => {
    await renderuj({}, fail("permission denied for table site_settings", "42501"));

    zapisz();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    const [blad, operacja] = h.toastError.mock.calls[0];
    expect(blad).toBeInstanceOf(Error);
    expect(operacja).toBe("save");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("trwający zapis pokazuje stan i blokuje przycisk przed drugim kliknięciem", async () => {
    let zakoncz: () => void = () => {};
    baza.reset();
    baza.setResponse("site_settings", (chain: RecordedChain) =>
      chain.has("upsert")
        ? new Promise((resolve) => {
            zakoncz = () => resolve(ok(null));
          })
        : ok(wiersz({})),
    );
    renderWithQueryClient(<FooterChromePane />);
    await screen.findByRole("combobox");

    zapisz();

    const przycisk = await screen.findByRole("button", { name: /adminPanesMisc\.saving/ });
    expect(przycisk).toBeDisabled();
    zakoncz();
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
  });
});
