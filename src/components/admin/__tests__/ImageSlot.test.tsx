// Uniwersalne pole obrazka w panelu - `ImageSlot`.
//
// CO TEN PLIK PRZYPINA I DLACZEGO. To pole jest wspólną windą do kubełka
// `media` dla logotypów, teł motywu i kart OG. Dwie rzeczy w nim są
// nieodwracalne, więc muszą być przypięte, a nie oglądane:
//   1. ŚCIEŻKA W KUBEŁKU. Plik ląduje pod
//      `<tenant>/<uid>/<folder>/<znacznik czasu>-<losowy>.<rozszerzenie>`.
//      Brak segmentu tenanta znaczy plik w cudzym katalogu (polityki Storage
//      są tenantowe), a brak segmentu użytkownika - kolizję nazw. Sesja bez
//      użytkownika daje `anon`, bo panel bywa otwarty na wygasłej sesji.
//      Znacznik czasu i losowy sufiks są tu ZAMROŻONE, żeby ścieżkę dało się
//      przypiąć w całości.
//   2. WALIDACJA PRZED WYSYŁKĄ (`transformFile`). Odrzucony plik NIE MOŻE
//      dojechać do Storage - inaczej karta OG w złym formacie trafia do
//      `<head>` i do podglądu w mediach społecznościowych. Ostrzeżenia
//      (plik przyjęty, ale przeskalowany) są komunikatem `role="status"`,
//      błędy - `role="alert"`; to są dwa różne kanały dla czytnika ekranu.
//   3. BRAK TENANTA ZATRZYMUJE WYSYŁKĘ NA WEJŚCIU - przed transformacją
//      i przed sesją.
//   4. BŁĄD STORAGE JEST POKAZANY TREŚCIĄ, a pole wraca do stanu gotowego
//      (przycisk odblokowany) - inaczej redaktor zostaje z zablokowanym polem
//      i bez informacji, co się stało.
//   5. POLE JEST STEROWANE: adres wpisany ręcznie i przycisk czyszczenia
//      idą tą samą drogą co wynik wysyłki (`onChange`), a podgląd pojawia
//      się tylko wtedy, gdy wartość jest niepusta.
//
// ZAREJESTROWANY DEFEKT (`it.fails` niżej): zapasowe rozszerzenie `|| "png"`
// nie odpala się dla pliku BEZ kropki w nazwie - do klucza w kubełku wchodzi
// wtedy cała nazwa jako końcówka. Kontrola dodatnia stoi obok.
//
// ZERO SIECI: klient Supabase (auth + storage) jest atrapą; `File` powstaje
// lokalnie, żaden adres nie wskazuje realnego serwisu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ImageSlotTransform } from "@/components/admin/ImageSlot";

interface WynikUploadu {
  error: Error | null;
}

const h = vi.hoisted(() => ({
  tenantId: "tenant-1" as string | null,
  userId: "user-7" as string | null,
  upload: vi.fn<(path: string, file: File, opts: Record<string, unknown>) => Promise<unknown>>(),
  getPublicUrl: vi.fn<(path: string) => { data: { publicUrl: string } }>(),
  storageFrom: vi.fn<(bucket: string) => unknown>(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ tenantId: h.tenantId }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: h.userId ? { user: { id: h.userId } } : null },
      }),
    },
    storage: { from: h.storageFrom },
  },
}));

const { ImageSlot } = await import("@/components/admin/ImageSlot");

/** Znacznik czasu i losowy sufiks są zamrożone - ścieżka ma być przewidywalna. */
const CZAS = 1_700_000_000_000;
/** `(0.5).toString(36).slice(2, 8)` = "i". */
const SCIEZKA_BAZOWA = `tenant-1/user-7/theme/${CZAS}-i`;

function renderuj(
  props: Partial<{
    value: string;
    hint: string;
    bucket: string;
    folder: string;
    previewMode: "auto" | "light" | "dark";
    accept: string;
    transformFile: ImageSlotTransform;
  }> = {},
) {
  const onChange = vi.fn<(v: string) => void>();
  const utils = render(
    <ImageSlot label="Logo serwisu" value={props.value ?? ""} onChange={onChange} {...props} />,
  );
  return { ...utils, onChange };
}

function polePliku(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("test: brak pola pliku");
  return input;
}

function wybierzPlik(nazwa = "logo.png", typ = "image/png"): File {
  const plik = new File(["x"], nazwa, { type: typ });
  fireEvent.change(polePliku(), { target: { files: [plik] } });
  return plik;
}

beforeEach(() => {
  h.tenantId = "tenant-1";
  h.userId = "user-7";
  h.upload.mockReset().mockResolvedValue({ error: null } satisfies WynikUploadu);
  h.getPublicUrl.mockReset().mockImplementation((path: string) => ({
    data: { publicUrl: `https://cdn.example.com/${path}` },
  }));
  h.storageFrom.mockReset().mockReturnValue({ upload: h.upload, getPublicUrl: h.getPublicUrl });
  vi.spyOn(Date, "now").mockReturnValue(CZAS);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ImageSlot - pole sterowane adresem", () => {
  it("bez wartości nie ma podglądu ani przycisku czyszczenia", () => {
    renderuj({ value: "" });

    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByTitle("adminPanesMisc.imageSlot.remove")).not.toBeInTheDocument();
    expect(screen.getByText("Logo serwisu")).toBeInTheDocument();
  });

  it("adres wpisany ręcznie idzie prosto do `onChange`", () => {
    const { onChange } = renderuj();

    fireEvent.change(screen.getByPlaceholderText("adminPanesMisc.imageSlot.urlPlaceholder"), {
      target: { value: "https://cdn.example.com/logo.svg" },
    });

    expect(onChange).toHaveBeenCalledWith("https://cdn.example.com/logo.svg");
  });

  it("z wartością pokazuje podgląd i czyści pole przyciskiem", () => {
    const { onChange } = renderuj({ value: "https://cdn.example.com/logo.png" });

    expect(document.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.example.com/logo.png",
    );
    fireEvent.click(screen.getByTitle("adminPanesMisc.imageSlot.remove"));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("podpowiedź pod polem renderuje się tylko wtedy, gdy ją podano", () => {
    const { unmount } = renderuj({ hint: "Zalecane 512x512" });
    expect(screen.getByText("Zalecane 512x512")).toBeInTheDocument();
    unmount();

    renderuj({});
    expect(screen.queryByText("Zalecane 512x512")).not.toBeInTheDocument();
  });

  it.each([
    ["dark", "#141414"],
    ["light", "#f8f6f4"],
  ] as const)("tryb podglądu %s maluje własne tło ramki", (tryb, tlo) => {
    renderuj({ value: "https://cdn.example.com/logo.png", previewMode: tryb });

    const ramka = document.querySelector<HTMLElement>("[data-preview-mode]");
    expect(ramka).toHaveAttribute("data-preview-mode", tryb);
    expect(ramka?.style.background).toBe(tlo);
  });

  it("tryb domyślny (auto) zostawia neutralne tło z klasy, bez stylu inline", () => {
    renderuj({ value: "https://cdn.example.com/logo.png" });

    const ramka = document.querySelector<HTMLElement>("[data-preview-mode]");
    expect(ramka).toHaveAttribute("data-preview-mode", "auto");
    expect(ramka?.className).toContain("bg-muted/30");
    expect(ramka?.style.background).toBe("");
  });

  it("filtr pickera plików idzie z propa, a domyślnie przyjmuje każdy obrazek", () => {
    const { unmount } = renderuj({});
    expect(polePliku()).toHaveAttribute("accept", "image/*");
    unmount();

    renderuj({ accept: ".jpg,.png" });
    expect(polePliku()).toHaveAttribute("accept", ".jpg,.png");
  });
});

describe("ImageSlot - wysyłka pliku do kubełka", () => {
  it("buduje ścieżkę z tenanta, użytkownika, katalogu, czasu i rozszerzenia", async () => {
    const { onChange } = renderuj({});

    wybierzPlik("Logo.PNG");

    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    expect(h.storageFrom).toHaveBeenCalledWith("media");
    const [sciezka, , opcje] = h.upload.mock.calls[0];
    expect(sciezka).toBe(`${SCIEZKA_BAZOWA}.png`);
    expect(opcje).toEqual({ cacheControl: "3600", upsert: false, contentType: "image/png" });
    expect(onChange).toHaveBeenCalledWith(`https://cdn.example.com/${SCIEZKA_BAZOWA}.png`);
  });

  it("kubełek i katalog idą z propów, a nie na sztywno", async () => {
    renderuj({ bucket: "brand", folder: "og" });

    wybierzPlik("karta.webp", "image/webp");

    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    expect(h.storageFrom).toHaveBeenCalledWith("brand");
    expect(h.upload.mock.calls[0][0]).toBe(`tenant-1/user-7/og/${CZAS}-i.webp`);
  });

  it("pusta końcówka nazwy daje `png`, a sesja bez użytkownika - segment `anon`", async () => {
    h.userId = null;
    renderuj({});

    // Nazwa kończąca się kropką: `split(".").pop()` daje pusty łańcuch,
    // więc wchodzi zapasowe rozszerzenie. To jest KONTROLA DODATNIA do
    // `it.fails` niżej: mechanizm zapasowy DZIAŁA, tylko nie budzi się dla
    // nazwy bez kropki - czyli dla przypadku, dla którego istnieje.
    wybierzPlik("bez-koncowki.", "image/png");

    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    expect(h.upload.mock.calls[0][0]).toBe(`tenant-1/anon/theme/${CZAS}-i.png`);
  });

  it.fails(
    "DEFEKT: plik BEZ rozszerzenia nie dostaje zapasowego `.png` - cała nazwa wchodzi jako końcówka",
    async () => {
      // `ext = file.name.split(".").pop()?.toLowerCase() || "png"` ma zapasowe
      // rozszerzenie DOKŁADNIE dla pliku bez kropki - i właśnie dla niego się
      // nie odpala: `"bezkropki".split(".").pop()` zwraca `"bezkropki"`, a nie
      // pusty łańcuch. Bramka `|| "png"` jest więc martwa dla przypadku, dla
      // którego ją napisano (dziś budzi ją tylko nazwa KOŃCZĄCA się kropką -
      // patrz kontrola dodatnia wyżej), a do klucza w kubełku trafia dowolny
      // łańcuch spod kontroli użytkownika. Nazwa ze znakiem `#` albo `?` daje
      // publiczny adres urwany na fragmencie/zapytaniu, czyli martwy obrazek
      // w motywie. ZMIERZONE dziś: `${SCIEZKA_BAZOWA}.bezkropki`.
      renderuj({});

      wybierzPlik("bezkropki", "image/png");

      await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
      expect(h.upload.mock.calls[0][0]).toBe(`${SCIEZKA_BAZOWA}.png`);
    },
  );

  it("zamknięcie okna wyboru (brak pliku) nie rusza Storage", async () => {
    const { onChange } = renderuj({});

    fireEvent.change(polePliku(), { target: { files: [] } });

    await waitFor(() => expect(polePliku().value).toBe(""));
    expect(h.storageFrom).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("po wyborze pole pliku jest czyszczone - ten sam plik da się wybrać ponownie", async () => {
    renderuj({});

    wybierzPlik();

    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    expect(polePliku().value).toBe("");
  });

  it("przycisk wysyłki otwiera UKRYTE pole pliku - to jedyna droga do pickera", () => {
    renderuj({});
    const otwarcie = vi.spyOn(polePliku(), "click");

    fireEvent.click(screen.getByRole("button", { name: "adminPanesMisc.imageSlot.uploadBtn" }));

    expect(otwarcie).toHaveBeenCalledTimes(1);
  });

  it("w trakcie wysyłki przycisk jest zablokowany i pokazuje stan", async () => {
    let zakoncz: (wynik: WynikUploadu) => void = () => {};
    h.upload.mockReturnValue(
      new Promise((resolve) => {
        zakoncz = resolve;
      }),
    );
    renderuj({});

    wybierzPlik();

    const przycisk = await screen.findByRole("button", {
      name: "adminPanesMisc.imageSlot.uploadingBtn",
    });
    expect(przycisk).toBeDisabled();
    zakoncz({ error: null });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "adminPanesMisc.imageSlot.uploadBtn" }),
      ).toBeEnabled(),
    );
  });
});

describe("ImageSlot - odmowy i błędy", () => {
  it("sesja bez serwisu zatrzymuje wysyłkę PRZED dotknięciem Storage", async () => {
    h.tenantId = null;
    const { onChange } = renderuj({});

    wybierzPlik();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "adminPanesMisc.imageSlot.uploadError",
    );
    expect(h.storageFrom).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("odrzucenie przez walidację NIE wysyła pliku i pokazuje zebrane błędy", async () => {
    const transformFile = vi.fn<ImageSlotTransform>(async () => ({
      file: null,
      errors: ["Za mały obrazek.", "Wymagane 1200x630."],
      warnings: [],
    }));
    const { onChange } = renderuj({ transformFile });

    wybierzPlik();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Za mały obrazek. Wymagane 1200x630.",
    );
    expect(h.upload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("odrzucenie BEZ treści błędu spada na komunikat ogólny", async () => {
    const transformFile = vi.fn<ImageSlotTransform>(async () => ({
      file: null,
      errors: [],
      warnings: [],
    }));
    renderuj({ transformFile });

    wybierzPlik();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "adminPanesMisc.imageSlot.uploadError",
    );
  });

  it("plik PRZEROBIONY jedzie do Storage zamiast oryginału, a ostrzeżenia są statusem", async () => {
    const przerobiony = new File(["yy"], "karta-1200x630.png", { type: "image/png" });
    const transformFile = vi.fn<ImageSlotTransform>(async () => ({
      file: przerobiony,
      errors: [],
      warnings: ["Obrazek przeskalowano do 1200x630."],
    }));
    renderuj({ transformFile });

    const oryginal = wybierzPlik("oryginal.jpg", "image/jpeg");

    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    expect(transformFile).toHaveBeenCalledWith(oryginal);
    expect(h.upload.mock.calls[0][1]).toBe(przerobiony);
    // Rozszerzenie i typ biorą się z pliku PO transformacji.
    expect(h.upload.mock.calls[0][0]).toBe(`${SCIEZKA_BAZOWA}.png`);
    expect(screen.getByRole("status")).toHaveTextContent("Obrazek przeskalowano do 1200x630.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("błąd Storage pokazuje treść i odblokowuje przycisk", async () => {
    h.upload.mockResolvedValue({ error: new Error("bucket not found") });
    const { onChange } = renderuj({});

    wybierzPlik();

    expect(await screen.findByRole("alert")).toHaveTextContent("bucket not found");
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "adminPanesMisc.imageSlot.uploadBtn" }),
    ).toBeEnabled();
  });

  it("awaria spoza klasy Error spada na komunikat ogólny", async () => {
    h.upload.mockRejectedValue("zerwane połączenie");
    renderuj({});

    wybierzPlik();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "adminPanesMisc.imageSlot.uploadError",
    );
  });

  it("kolejna próba czyści poprzedni błąd i ostrzeżenia", async () => {
    h.upload.mockResolvedValueOnce({ error: new Error("bucket not found") });
    renderuj({});

    wybierzPlik();
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    wybierzPlik();

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
