// PANEL OKŁADKI WPISU (`CoverImagePicker`) - trzy drogi do jednego pola:
// upload z dysku, wybór z biblioteki mediów i wklejony link.
//
// CO TEN PLIK PRZYPINA (a czego montaż bez interakcji nie dowodzi):
//   1. TRZY DROGI KOŃCZĄ SIĘ TĄ SAMĄ WARTOŚCIĄ. Upload, biblioteka i link
//      muszą oddać rodzicowi adres ORAZ przestawić szkic pola linku - inaczej
//      redaktor widzi okładkę, a w polu adresu poprzedni URL.
//   2. ŚCIEŻKA W BUCKECIE JEST DZIERŻAWCOWA I MA INNY UKŁAD NIŻ AUDIO:
//      `<tenant>/<uid>/<folder>/...` (AudioPicker: `<folder>/<tenant>/<uid>`).
//      Rozjazd nie jest kosmetyczny - polityki RLS bucketa czytają PIERWSZY
//      segment klucza, więc pomyłka w kolejności to odmowa zapisu albo wyciek.
//   3. PODGLĄD MA TRZY RAMKI URZĄDZEŃ i przełącznik zmienia PROPORCJE, nie
//      tylko podświetlenie przycisku (`aria-pressed` + styl ramki).
//   4. BIBLIOTEKA JEST DIALOGIEM STEROWANYM: panel go otwiera, dialog oddaje
//      adres i panel go ZAMYKA. Dialog jest atrapą - prawdziwy ma własną
//      powierzchnię (upload, ALT, foldery, dwie server fn).
//   5. BŁĄD UPLOADU ZOSTAJE NA EKRANIE, a wartość rodzica się nie zmienia.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   - `MediaPickerDialog` (własny pakiet testowy) - tu liczy się KONTRAKT:
//     `open`, `accept="image"`, tytuł i to, co panel robi z `onPick`.
//   - Napisy: `t` jest echem klucza, więc asercje mierzą KLUCZ i18n
//     (`admin.posts.coverEmpty`), a nie kopię polskiego tekstu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  controlledHost,
  mountSettingsPane,
  stubBrowserPageFetch,
  type MediaPickerStubProps,
  type PropRecorder,
  type SettingsPaneSupabase,
} from "@/test/admin/settingsPaneHarness";

const LIBRARY_URL = "https://media.example.test/biblioteka/okladka.jpg";

const stubs = vi.hoisted(() => ({
  supabase: null as unknown,
  picker: null as unknown,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/integrations/supabase/client", async () => {
  const { settingsPaneSupabase: make } = await import("@/test/admin/settingsPaneHarness");
  const sb = make({ userId: "user-redaktor" });
  stubs.supabase = sb;
  return { supabase: sb.client };
});

vi.mock("@/hooks/useAuth", async () =>
  (await import("@/test/admin/settingsPaneHarness")).requiredTenantStub(
    "tenant-nes",
    "user-redaktor",
  ),
);

vi.mock("@/components/admin/media/MediaPickerDialog", async () => {
  const { mediaPickerStub: make, propRecorder: rec } =
    await import("@/test/admin/settingsPaneHarness");
  const recorder = rec<MediaPickerStubProps>();
  stubs.picker = recorder;
  return make(recorder, "https://media.example.test/biblioteka/okladka.jpg");
});

import { CoverImagePicker } from "@/components/admin/CoverImagePicker";

const sb = () => stubs.supabase as SettingsPaneSupabase;
const picker = () => stubs.picker as PropRecorder<MediaPickerStubProps>;

const SAVED_URL = "https://storage.example.test/tenant-nes/user-redaktor/posts/okladka.webp";

let restoreFetch: () => void;

function mountPicker(initial = "", label?: string) {
  const host = controlledHost<string>(initial, (value, onChange) => (
    <CoverImagePicker value={value} onChange={onChange} label={label} />
  ));
  return { host, view: mountSettingsPane(host.node) };
}

const fileInput = (container: HTMLElement): HTMLInputElement => {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("test: panel nie wyrenderował pola pliku");
  return input;
};

const urlInput = (container: HTMLElement): HTMLInputElement => {
  const input = container.querySelector<HTMLInputElement>('input[type="url"]');
  if (!input) throw new Error("test: panel nie wyrenderował pola linku");
  return input;
};

/** Ramka podglądu - jedyny element, który niesie proporcje urządzenia. */
const frame = (container: HTMLElement): HTMLElement => {
  const node = container.querySelector<HTMLElement>("img")?.parentElement;
  if (!node) throw new Error("test: brak ramki podglądu okładki");
  return node;
};

/** Przycisk atrapy dialogu (`data-media-pick` / `data-media-close`). */
const dialogButton = (attribute: string): HTMLButtonElement => {
  const node = screen
    .getByTestId("media-picker")
    .querySelector<HTMLButtonElement>(`[${attribute}]`);
  if (!node) throw new Error(`test: atrapa dialogu bez przycisku [${attribute}]`);
  return node;
};

beforeEach(() => {
  // happy-dom wykonuje prawdziwe żądania dla zasobów okna - podgląd okładki
  // nie ma prawa dotknąć sieci.
  restoreFetch = stubBrowserPageFetch();
  sb().reset();
  picker().reset();
});

afterEach(() => {
  restoreFetch();
  cleanup();
});

describe("CoverImagePicker - stan wyjściowy", () => {
  it("bez okładki panel pokazuje pustkę i obie drogi wyboru", () => {
    const { view } = mountPicker("", "admin.posts.cover");

    expect(screen.getByText("admin.posts.cover")).toBeInTheDocument();
    expect(screen.getByText("admin.posts.coverEmpty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /admin.posts.coverUpload/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /admin.posts.coverLibrary/ })).toBeInTheDocument();
    expect(view.container.querySelector("img")).toBeNull();
    expect(urlInput(view.container).value).toBe("");
    // Dialog istnieje w drzewie, ale ZAMKNIĘTY.
    expect(picker().last()?.open).toBe(false);
    expect(screen.queryByTestId("media-picker")).toBeNull();
  });

  it("zapisana okładka daje podgląd, pole adresu i przycisk usunięcia", () => {
    const { view } = mountPicker(SAVED_URL);

    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(SAVED_URL);
    expect(urlInput(view.container).value).toBe(SAVED_URL);
    expect(screen.getByRole("button", { name: "admin.remove" })).toBeInTheDocument();
    expect(screen.queryByText("admin.posts.coverEmpty")).toBeNull();
  });
});

describe("CoverImagePicker - ramki urządzeń", () => {
  it("start jest na desktopie: 16/9 i wciśnięty przycisk Desktop", () => {
    const { view } = mountPicker(SAVED_URL);

    expect(screen.getByRole("button", { name: "Desktop" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Desktop - 16:9")).toBeInTheDocument();
    expect(frame(view.container).style.aspectRatio).toBe("16 / 9");
    expect(frame(view.container).style.maxWidth).toBe("100%");
  });

  it("przełącznik zmienia PROPORCJE podglądu, nie tylko podświetlenie", () => {
    const { view } = mountPicker(SAVED_URL);

    fireEvent.click(screen.getByRole("button", { name: "Tablet" }));

    expect(screen.getByText("Tablet - 4:3")).toBeInTheDocument();
    expect(frame(view.container).style.aspectRatio).toBe("4 / 3");
    expect(frame(view.container).style.maxWidth).toBe("62%");
    expect(screen.getByRole("button", { name: "Desktop" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));

    expect(screen.getByText("Mobile - 9:16")).toBeInTheDocument();
    expect(frame(view.container).style.aspectRatio).toBe("9 / 16");
    expect(frame(view.container).style.maxWidth).toBe("34%");
    expect(screen.getByRole("button", { name: "Mobile" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("CoverImagePicker - upload z dysku", () => {
  it("plik jedzie pod klucz `<tenant>/<uid>/<folder>` i wraca publicznym URL-em", async () => {
    const { host, view } = mountPicker();
    const file = new File(["binarne-jpeg"], "Okładka Główna.JPG", { type: "image/jpeg" });

    fireEvent.change(fileInput(view.container), { target: { files: [file] } });

    await waitFor(() => expect(sb().storage.upload).toHaveBeenCalledTimes(1));
    expect(sb().storage.buckets[0]).toBe("media");
    const [path, uploaded, options] = sb().storage.upload.mock.calls[0];
    expect(String(path)).toMatch(/^tenant-nes\/user-redaktor\/posts\/\d+-[a-z0-9]+\.jpg$/);
    expect(uploaded).toBe(file);
    expect(options).toEqual({ cacheControl: "3600", upsert: false, contentType: "image/jpeg" });
    expect(host.current()).toBe(`https://storage.example.test/${String(path)}`);
    // Szkic pola linku idzie za wartością - inaczej podgląd i pole rozjeżdżają się.
    expect(urlInput(view.container).value).toBe(host.current());
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(host.current());
    expect(fileInput(view.container).value).toBe("");
  });

  // DEFEKT PRODUKCYJNY (rejestr): `file.name.split(".").pop()` na nazwie BEZ
  // kropki oddaje CAŁĄ nazwę, więc `|| "png"` nigdy się nie odpala i klucz
  // dostaje rozszerzenie „.zrzut". Zabezpieczenie działa wyłącznie dla nazwy
  // z kropką na końcu (`"zrzut."` -> pusty string -> `png`), czyli dla
  // przypadku, którego nikt nie tworzy. IDENTYCZNY kształt ma
  // `AudioPicker.tsx:154` (`|| "mp3"`). Poprawka: `split(".")` daje jeden
  // element -> brak rozszerzenia.
  it.fails(
    "DEFEKT: plik bez rozszerzenia zamiast `.png` dostaje `.<nazwa>` w kluczu bucketa",
    async () => {
      const { view } = mountPicker();

      fireEvent.change(fileInput(view.container), {
        target: { files: [new File(["dane"], "zrzut", { type: "image/png" })] },
      });

      await waitFor(() => expect(sb().storage.upload).toHaveBeenCalledTimes(1));
      expect(String(sb().storage.upload.mock.calls[0][0])).toMatch(/\.png$/);
    },
  );

  it("nazwa z kropką na końcu jest JEDYNĄ, dla której odpala się `png`", async () => {
    const { view } = mountPicker();

    fireEvent.change(fileInput(view.container), {
      target: { files: [new File(["dane"], "zrzut.", { type: "image/png" })] },
    });

    await waitFor(() => expect(sb().storage.upload).toHaveBeenCalledTimes(1));
    expect(String(sb().storage.upload.mock.calls[0][0])).toMatch(/\.png$/);
  });

  it("odmowa Storage zostawia komunikat, a wartość rodzica bez zmian", async () => {
    const { host, view } = mountPicker();
    sb().storage.failUpload("mime type image/svg+xml is not supported");

    fireEvent.change(fileInput(view.container), {
      target: { files: [new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" })] },
    });

    await waitFor(() =>
      expect(screen.getByText("mime type image/svg+xml is not supported")).toBeInTheDocument(),
    );
    expect(host.changes).toHaveLength(0);
    expect(screen.getByText("admin.posts.coverEmpty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /admin.posts.coverUpload/ })).toBeEnabled();
  });

  it("kliknięcie przycisku uploadu otwiera ukryte pole pliku", () => {
    const { view } = mountPicker();
    const open = vi.spyOn(fileInput(view.container), "click");

    fireEvent.click(screen.getByRole("button", { name: /admin.posts.coverUpload/ }));

    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("CoverImagePicker - biblioteka mediów", () => {
  it("panel otwiera dialog, przyjmuje adres i sam go zamyka", () => {
    const { host, view } = mountPicker();

    fireEvent.click(screen.getByRole("button", { name: /admin.posts.coverLibrary/ }));

    expect(picker().last()?.open).toBe(true);
    expect(picker().last()?.accept).toBe("image");
    expect(picker().last()?.title).toBe("admin.posts.coverLibraryTitle");
    expect(screen.getByTestId("media-picker").getAttribute("data-accept")).toBe("image");

    fireEvent.click(dialogButton("data-media-pick"));

    expect(host.changes).toEqual([LIBRARY_URL]);
    expect(urlInput(view.container).value).toBe(LIBRARY_URL);
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(LIBRARY_URL);
    // Dialog zamknięty PRZEZ PANEL, nie przez własny stan atrapy.
    expect(picker().last()?.open).toBe(false);
    expect(screen.queryByTestId("media-picker")).toBeNull();
    expect(sb().storage.upload).not.toHaveBeenCalled();
  });

  it("zamknięcie dialogu bez wyboru nie rusza wartości", () => {
    const { host } = mountPicker(SAVED_URL);

    fireEvent.click(screen.getByRole("button", { name: /admin.posts.coverLibrary/ }));
    fireEvent.click(dialogButton("data-media-close"));

    expect(picker().last()?.open).toBe(false);
    expect(host.changes).toHaveLength(0);
    expect(host.current()).toBe(SAVED_URL);
  });
});

describe("CoverImagePicker - link i usunięcie", () => {
  it("wklejony link zatwierdza się na blur - przycięty i tylko raz", () => {
    const { host, view } = mountPicker();
    const external = "https://cdn.example.test/foto/plenerowe.jpg";

    fireEvent.change(urlInput(view.container), { target: { value: `  ${external} ` } });
    expect(host.changes).toHaveLength(0);

    fireEvent.blur(urlInput(view.container));
    expect(host.changes).toEqual([external]);

    fireEvent.blur(urlInput(view.container));
    expect(host.changes).toEqual([external]);
  });

  it("Enter zatwierdza link, inny klawisz nie", () => {
    const { host, view } = mountPicker();

    fireEvent.change(urlInput(view.container), {
      target: { value: "https://cdn.example.test/foto/portret.jpg" },
    });
    fireEvent.keyDown(urlInput(view.container), { key: "Escape" });
    expect(host.changes).toHaveLength(0);

    fireEvent.keyDown(urlInput(view.container), { key: "Enter" });
    expect(host.changes).toEqual(["https://cdn.example.test/foto/portret.jpg"]);
  });

  it("usunięcie okładki czyści podgląd i pole adresu", () => {
    const { host, view } = mountPicker(SAVED_URL);

    fireEvent.click(screen.getByRole("button", { name: "admin.remove" }));

    expect(host.current()).toBe("");
    expect(view.container.querySelector("img")).toBeNull();
    expect(urlInput(view.container).value).toBe("");
    expect(screen.getByText("admin.posts.coverEmpty")).toBeInTheDocument();
  });
});
