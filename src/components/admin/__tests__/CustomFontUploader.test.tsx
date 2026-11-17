// Wgrywanie własnych krojów pisma do motywu - `CustomFontUploader`.
//
// CO TEN PLIK PRZYPINA I DLACZEGO. Każdy wgrany krój staje się regułą
// `@font-face` na PUBLICZNEJ stronie (identyfikator kroju = nazwa rodziny
// w CSS), więc bramki przed wysyłką i przed dopisaniem do listy nie są
// kosmetyką. Przypinam pięć rzeczy:
//   1. TRZY BRAMKI PRZED WYSYŁKĄ, KAŻDA OSOBNO: brak pliku (redaktor zamknął
//      okno wyboru), brak tenanta (sesja bez serwisu - plik poleciałby do
//      cudzego katalogu) i pusta nazwa wyświetlana. Asercja stoi na tym, że
//      `uploadCustomFont` NIE zostało wywołane - komunikat sam w sobie
//      niczego nie gwarantuje.
//   2. DUPLIKAT IDENTYFIKATORA NIE WCHODZI NA LISTĘ. Dwa wpisy o tym samym
//      `id` dają dwie reguły `@font-face` dla jednej rodziny - wygrywa
//      ostatnia, więc redaktor widziałby "podmieniony" krój bez żadnej akcji.
//      Wgranie jest wtedy już ZROBIONE (plik siedzi w koszu), a mimo to lista
//      się nie zmienia - i dokładnie to jest przypięte.
//   3. NAZWA IDZIE DO BIBLIOTEKI OBCIĘTA Z BIAŁYCH ZNAKÓW, a waga tak, jak
//      ją wpisano (obsługuje też zapis zmienny w rodzaju "100 900").
//   4. PO UDANYM WGRANIU POLE NAZWY SIĘ CZYŚCI. Bez tego następny plik
//      dostaje nazwę poprzedniego, a przy identycznym slugu - duplikat.
//   5. TRWAJĄCE WGRYWANIE JEST WIDOCZNE I BLOKUJE PRZYCISK (podwójny wybór
//      pliku = dwa równoległe uploady tej samej nazwy).
// Oraz: usunięcie pozycji z listy oddaje rodzicowi listę BEZ tego kroju
// (komponent jest sterowany - sam niczego nie kasuje).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: samego wgrywania - `uploadCustomFont`
// (slug, ścieżka `<tenant>/fonts/<slug>-<czas>.<ext>`, biała lista rozszerzeń,
// limit 5 MB, komunikaty błędów Storage) ma własne testy w
// `src/lib/theme/__tests__/themeRemainder.test.tsx` (opis `uploadCustomFont`);
// tutaj jest ATRAPĄ, bo przedmiotem dowodu jest to, Z CZYM panel ją woła i co
// robi z jej wynikiem. ZERO ruchu sieciowego.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CustomFont } from "@/lib/theme/customFonts";

const h = vi.hoisted(() => ({
  tenantId: "tenant-1" as string | null,
  upload:
    vi.fn<
      (args: {
        file: File;
        label: string;
        tenantId: string;
        weight: string;
      }) => Promise<CustomFont | null>
    >(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ tenantId: h.tenantId }) }));
vi.mock("@/lib/theme/customFontUpload", () => ({ uploadCustomFont: h.upload }));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
  Toaster: () => null,
}));

const { CustomFontUploader } = await import("@/components/admin/CustomFontUploader");

function krój(over: Partial<CustomFont> = {}): CustomFont {
  return {
    id: "naglowkowy",
    label: "Nagłówkowy",
    url: "https://example.com/fonts/naglowkowy.woff2",
    weight: "400",
    ...over,
  };
}

function renderuj(value: CustomFont[] = []) {
  const onChange = vi.fn<(next: CustomFont[]) => void>();
  const utils = render(<CustomFontUploader value={value} onChange={onChange} />);
  return { ...utils, onChange };
}

/** Pole pliku jest ukryte (klika się je przez etykietę), więc szukamy po typie. */
function polePliku(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("test: brak pola pliku");
  return input;
}

/**
 * Treść pliku jest nieistotna (biblioteka wgrywająca jest atrapą), ale idzie
 * jako bajty binarne - i to ZAPISANE SEKWENCJAMI UCIECZKI, nie surowymi
 * bajtami w źródle: surowy NUL w kodzie czyni z pliku testowego plik binarny
 * dla gita, `grep`a i edytorów.
 */
function wybierzPlik(nazwa = "krój.woff2"): void {
  fireEvent.change(polePliku(), {
    target: { files: [new File(["\u0000\u0001"], nazwa, { type: "font/woff2" })] },
  });
}

function wpiszNazwe(nazwa: string): void {
  fireEvent.change(screen.getByPlaceholderText("adminPanesMisc.customFont.namePlaceholder"), {
    target: { value: nazwa },
  });
}

beforeEach(() => {
  h.tenantId = "tenant-1";
  h.upload.mockReset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("CustomFontUploader - bramki przed wysyłką pliku", () => {
  it("zamknięcie okna wyboru (brak pliku) nie robi nic", async () => {
    const { onChange } = renderuj();
    wpiszNazwe("Nagłówkowy");

    fireEvent.change(polePliku(), { target: { files: [] } });

    await waitFor(() => expect(h.upload).not.toHaveBeenCalled());
    expect(h.toastError).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("sesja bez serwisu zatrzymuje wysyłkę - plik nie ma dokąd trafić", async () => {
    h.tenantId = null;
    const { onChange } = renderuj();
    wpiszNazwe("Nagłówkowy");

    wybierzPlik();

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminPanesMisc.customFont.errNoTenant"),
    );
    expect(h.upload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ["pusta nazwa", ""],
    ["same spacje", "   "],
  ])(
    "%s zatrzymuje wysyłkę - krój bez nazwy jest nie do wybrania w pickerze",
    async (_o, nazwa) => {
      const { onChange } = renderuj();
      if (nazwa) wpiszNazwe(nazwa);

      wybierzPlik();

      await waitFor(() =>
        expect(h.toastError).toHaveBeenCalledWith("adminPanesMisc.customFont.errNoName"),
      );
      expect(h.upload).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    },
  );
});

describe("CustomFontUploader - udane wgranie", () => {
  it("woła bibliotekę z obciętą nazwą, wagą, tenantem i wybranym plikiem", async () => {
    h.upload.mockResolvedValue(krój());
    renderuj();
    wpiszNazwe("  Nagłówkowy  ");
    fireEvent.change(screen.getByPlaceholderText("400"), { target: { value: "100 900" } });

    wybierzPlik("naglowkowy.woff2");

    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    const argumenty = h.upload.mock.calls[0][0];
    expect(argumenty.label).toBe("Nagłówkowy");
    expect(argumenty.weight).toBe("100 900");
    expect(argumenty.tenantId).toBe("tenant-1");
    expect(argumenty.file.name).toBe("naglowkowy.woff2");
  });

  it("dopisuje krój NA KONIEC listy, zachowując dotychczasowe", async () => {
    const istniejacy = krój({ id: "tekstowy", label: "Tekstowy" });
    h.upload.mockResolvedValue(krój());
    const { onChange } = renderuj([istniejacy]);
    wpiszNazwe("Nagłówkowy");

    wybierzPlik();

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith([istniejacy, krój()]);
    expect(h.toastSuccess).toHaveBeenCalledWith(
      "adminPanesMisc.customFont.addedToast(label=Nagłówkowy)",
    );
  });

  it("czyści pole nazwy, żeby następny plik nie odziedziczył poprzedniej", async () => {
    h.upload.mockResolvedValue(krój());
    renderuj();
    wpiszNazwe("Nagłówkowy");

    wybierzPlik();

    await waitFor(() =>
      expect(screen.getByPlaceholderText("adminPanesMisc.customFont.namePlaceholder")).toHaveValue(
        "",
      ),
    );
    // Waga zostaje - to ustawienie sesji redaktora, nie własność pliku.
    expect(screen.getByPlaceholderText("400")).toHaveValue("400");
  });

  it("w trakcie wgrywania pokazuje stan i blokuje przycisk wyboru", async () => {
    let zakoncz: (font: CustomFont | null) => void = () => {};
    h.upload.mockReturnValue(
      new Promise<CustomFont | null>((resolve) => {
        zakoncz = resolve;
      }),
    );
    renderuj();
    wpiszNazwe("Nagłówkowy");

    wybierzPlik();

    expect(await screen.findByText("adminPanesMisc.customFont.uploading")).toBeInTheDocument();
    zakoncz(krój());
    expect(await screen.findByText("adminPanesMisc.customFont.pickFile")).toBeInTheDocument();
  });
});

describe("CustomFontUploader - odmowy po stronie wysyłki", () => {
  it("gdy biblioteka odda `null` (błąd Storage), lista się nie zmienia i nie ma sukcesu", async () => {
    h.upload.mockResolvedValue(null);
    const { onChange } = renderuj();
    wpiszNazwe("Nagłówkowy");

    wybierzPlik();

    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    expect(onChange).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
    // Nazwa zostaje w polu - redaktor poprawia i próbuje ponownie.
    expect(screen.getByPlaceholderText("adminPanesMisc.customFont.namePlaceholder")).toHaveValue(
      "Nagłówkowy",
    );
  });

  it("duplikat identyfikatora nie wchodzi na listę - dwie reguły @font-face na rodzinę", async () => {
    h.upload.mockResolvedValue(krój());
    const { onChange } = renderuj([krój({ label: "Stara nazwa" })]);
    wpiszNazwe("Nagłówkowy");

    wybierzPlik();

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "adminPanesMisc.customFont.errDuplicate(id=naglowkowy)",
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("CustomFontUploader - lista wgranych krojów", () => {
  it("bez krojów nie renderuje listy", () => {
    renderuj([]);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("pokazuje identyfikator, próbkę z nazwą i wagę każdego kroju", () => {
    renderuj([krój(), krój({ id: "tekstowy", label: "Tekstowy", weight: "700" })]);

    expect(screen.getByText("naglowkowy")).toBeInTheDocument();
    expect(screen.getByText("Nagłówkowy - Aa Bb Cc 123")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
    expect(screen.getByText("Tekstowy - Aa Bb Cc 123")).toBeInTheDocument();
    expect(screen.getByText("700")).toBeInTheDocument();
  });

  it("próbka jest pisana WGRANYM krojem - inaczej podgląd nic nie pokazuje", () => {
    renderuj([krój()]);

    const probka = screen.getByText("Nagłówkowy - Aa Bb Cc 123");
    expect(probka).toHaveStyle({ fontFamily: '"naglowkowy", system-ui' });
  });

  it("usunięcie oddaje rodzicowi listę BEZ tego kroju", () => {
    const zostaje = krój({ id: "tekstowy", label: "Tekstowy" });
    const { onChange } = renderuj([krój(), zostaje]);

    fireEvent.click(
      screen.getByRole("button", {
        name: "adminPanesMisc.customFont.removeAria(label=Nagłówkowy)",
      }),
    );

    expect(onChange).toHaveBeenCalledWith([zostaje]);
  });
});
