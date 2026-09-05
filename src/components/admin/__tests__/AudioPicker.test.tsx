// PANEL AUDIO WPISU (`AudioPicker`) - wgrywanie MP3 do bucketa `media`,
// wklejanie linku zewnętrznego i powrót do lektora AI.
//
// CO TEN PLIK PRZYPINA (a czego montaż bez interakcji nie dowodzi):
//   1. WALIDACJA MA TRZY ODRĘBNE POWODY ODMOWY i każdy ma własny komunikat:
//      zły format (MIME ALBO rozszerzenie), przekroczone 50 MB, plik zerowy.
//      Kolejność nie jest kosmetyczna: plik `.txt` o zerowej długości musi
//      dostać „nieprawidłowy format", a nie „uszkodzony".
//   2. SONDA METADANYCH BIEGNIE PRZED UPLOADEM. Panel liczy czas trwania na
//      lokalnym blobie i przy `null` NIE DOTYKA Storage (żeby nie płacić za
//      plik, który i tak się nie odtworzy). Sonda ma trzy wyjścia -
//      `loadedmetadata`, `error` i fail-safe 8 s - i wszystkie trzy prowadzą
//      do innego zachowania panelu.
//   3. ŚCIEŻKA W BUCKECIE JEST DZIERŻAWCOWA: `<folder>/<tenant>/<uid>/...`.
//      Zgubiony segment to wyciek plików między dzierżawcami, a `tsc` tego nie
//      widzi (cały klucz to jeden string).
//   4. BŁĄD STORAGE NIE GUBI STANU: komunikat zostaje na ekranie (`role=alert`),
//      przycisk wraca do stanu gotowego, a wartość rodzica się NIE zmienia.
//   5. POLE LINKU ZATWIERDZA SIĘ NA BLUR I NA ENTER, ale tylko gdy wartość
//      naprawdę się zmieniła - inaczej każde wyjście z pola raportowałoby
//      rodzicowi zmianę i brudziło formularz edytora.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   - `formatAudioTime` jest PRAWDZIWY (własne testy ma w `lib/audio`); tutaj
//     dowodzę, że panel karmi go czasem z sondy, a nie własnym licznikiem.
//   - Storage jest atrapą harnessu - liczy się ładunek uploadu i zwrócony
//     publiczny URL, nie zachowanie prawdziwego bucketa.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  controlledHost,
  mountSettingsPane,
  paneToastSpies,
  stubAudioMetadata,
  type AudioMetadataStub,
  type SettingsPaneSupabase,
} from "@/test/admin/settingsPaneHarness";

const stubs = vi.hoisted(() => ({
  supabase: null as unknown,
  toasts: null as unknown,
  language: "pl",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => stubs.language),
);

vi.mock("@/integrations/supabase/client", async () => {
  const { settingsPaneSupabase: make } = await import("@/test/admin/settingsPaneHarness");
  const sb = make({ userId: "user-redaktor" });
  stubs.supabase = sb;
  return { supabase: sb.client };
});

vi.mock("sonner", async () => {
  const { paneToastSpies: make } = await import("@/test/admin/settingsPaneHarness");
  const toasts = make();
  stubs.toasts = toasts;
  return toasts.sonner();
});

// Panel woła `useRequiredTenant()` W RENDERZE - bez tego wywraca się cały.
vi.mock("@/hooks/useAuth", async () =>
  (await import("@/test/admin/settingsPaneHarness")).requiredTenantStub(
    "tenant-nes",
    "user-redaktor",
  ),
);

import { AudioPicker } from "@/components/admin/AudioPicker";

const sb = () => stubs.supabase as SettingsPaneSupabase;
const toasts = () => stubs.toasts as ReturnType<typeof paneToastSpies>;

const SAVED_URL = "https://storage.example.test/posts-audio/tenant-nes/wyklad-otwarcia.mp3";

let audio: AudioMetadataStub;

/** Plik o zadanym rozmiarze BEZ alokowania megabajtów. */
function fileOfSize(name: string, type: string, size: number): File {
  const file = new File(["a"], name, { type });
  Object.defineProperty(file, "size", { value: size, configurable: true });
  return file;
}

/** Montaż w rodzicu trzymającym stan - panel jest STEROWANY. */
function mountPicker(initial = "", extra: { label?: string; hint?: string } = {}) {
  const host = controlledHost<string>(initial, (value, onChange) => (
    <AudioPicker value={value} onChange={onChange} label={extra.label} hint={extra.hint} />
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

const alertText = (container: HTMLElement): string =>
  container.querySelector('[role="alert"]')?.textContent ?? "";

beforeEach(() => {
  sb().reset();
  toasts().reset();
  stubs.language = "pl";
  audio = stubAudioMetadata(95);
});

afterEach(() => {
  audio.restore();
  cleanup();
  vi.useRealTimers();
});

describe("AudioPicker - stan wyjściowy", () => {
  it("bez pliku panel zaprasza do wgrania i zapowiada lektora AI", () => {
    const { view } = mountPicker("", { label: "Audio (PL)", hint: "MP3 do 50 MB" });

    expect(screen.getByText("Audio (PL)")).toBeInTheDocument();
    expect(screen.getByText("MP3 do 50 MB")).toBeInTheDocument();
    expect(
      screen.getByText("Brak pliku audio - dla tego języka użyty zostanie lektor AI (ElevenLabs)"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wgraj MP3" })).toBeEnabled();
    expect(urlInput(view.container).value).toBe("");
    expect(view.container.querySelector("audio")).toBeNull();
    expect(audio.probed).toHaveLength(0);
  });

  it("zapisany plik daje nazwę, odtwarzacz i czas trwania z sondy metadanych", async () => {
    const { view } = mountPicker(SAVED_URL);

    expect(screen.getByText("wyklad-otwarcia.mp3")).toBeInTheDocument();
    expect(view.container.querySelector("audio")?.getAttribute("src")).toBe(SAVED_URL);
    expect(urlInput(view.container).value).toBe(SAVED_URL);

    await waitFor(() => expect(screen.getByText("1:35")).toBeInTheDocument());
    expect(screen.getByText(/Czas trwania/)).toBeInTheDocument();
    expect(audio.probed).toEqual([SAVED_URL]);
  });

  it("nieczytelne metadane nie pokazują czasu trwania, ale plik zostaje", async () => {
    audio.broken();
    const { view } = mountPicker(SAVED_URL);

    await waitFor(() => expect(audio.probed).toEqual([SAVED_URL]));
    expect(screen.queryByText(/Czas trwania/)).toBeNull();
    expect(view.container.querySelector("audio")).not.toBeNull();
  });

  it("po angielsku panel zmienia komplet napisów, nie tylko nagłówek", () => {
    stubs.language = "en";
    mountPicker(SAVED_URL);

    expect(screen.getByRole("button", { name: "Upload MP3" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove file (fall back to AI narration)" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Wgraj MP3")).toBeNull();
  });
});

describe("AudioPicker - upload pliku", () => {
  it("poprawny MP3 jedzie do bucketa dzierżawcy i wraca publicznym URL-em", async () => {
    const { host, view } = mountPicker();
    const file = new File(["id3-nagranie"], "Wykład Otwarcia.mp3", { type: "audio/mpeg" });

    fireEvent.change(fileInput(view.container), { target: { files: [file] } });

    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    // Sonda biegła po lokalnym blobie, PRZED uploadem.
    expect(audio.probed[0].startsWith("blob:")).toBe(true);
    expect(sb().storage.buckets[0]).toBe("media");
    const [path, uploaded, options] = sb().storage.upload.mock.calls[0];
    expect(String(path)).toMatch(/^posts-audio\/tenant-nes\/user-redaktor\/\d+-[a-z0-9]+\.mp3$/);
    expect(uploaded).toBe(file);
    expect(options).toEqual({
      cacheControl: "31536000",
      upsert: false,
      contentType: "audio/mpeg",
    });
    // Rodzic dostał publiczny URL, a panel od razu pokazuje plik i czas.
    expect(host.changes).toHaveLength(1);
    expect(host.current()).toBe(`https://storage.example.test/${String(path)}`);
    expect(toasts().success.mock.calls[0][0]).toBe("Plik audio wgrany · 1:35");
    await waitFor(() => expect(screen.getByText("1:35")).toBeInTheDocument());
    // Pole pliku jest czyszczone, żeby wybór TEGO SAMEGO pliku znów zadziałał.
    expect(fileInput(view.container).value).toBe("");
  });

  it("rozszerzenie ratuje plik bez MIME (drag&drop z Findera)", async () => {
    const { host, view } = mountPicker();
    const file = new File(["dane"], "podcast.m4a", { type: "" });

    fireEvent.change(fileInput(view.container), { target: { files: [file] } });

    await waitFor(() => expect(sb().storage.upload).toHaveBeenCalledTimes(1));
    expect(String(sb().storage.upload.mock.calls[0][0])).toMatch(/\.m4a$/);
    // Bez MIME panel deklaruje typ zastępczy, żeby bucket nie zapisał octet-stream.
    expect(sb().storage.upload.mock.calls[0][2]).toMatchObject({ contentType: "audio/mpeg" });
    expect(host.changes).toHaveLength(1);
  });

  it("stan Wgrywam blokuje przycisk do końca uploadu", async () => {
    const { view } = mountPicker();
    let release: (() => void) | null = null;
    sb().storage.upload.mockImplementationOnce(async (path: string) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { data: { path }, error: null };
    });

    fireEvent.change(fileInput(view.container), {
      target: { files: [new File(["dane"], "audycja.mp3", { type: "audio/mpeg" })] },
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Wgrywam…" })).toBeDisabled());
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Wgraj MP3" })).toBeEnabled());
  });

  it("kliknięcie przycisku uploadu otwiera ukryte pole pliku", () => {
    const { view } = mountPicker();
    const open = vi.spyOn(fileInput(view.container), "click");

    fireEvent.click(screen.getByRole("button", { name: "Wgraj MP3" }));

    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("AudioPicker - odmowy", () => {
  it("zły format odpada BEZ sondy i bez Storage", async () => {
    const { host, view } = mountPicker();

    fireEvent.change(fileInput(view.container), {
      target: { files: [new File(["notatka"], "notatka.txt", { type: "text/plain" })] },
    });

    await waitFor(() =>
      expect(alertText(view.container)).toBe(
        "Nieprawidłowy format. Dozwolone: MP3, M4A, AAC, OGG, WAV",
      ),
    );
    expect(toasts().error).toHaveBeenCalledWith(
      "Nieprawidłowy format. Dozwolone: MP3, M4A, AAC, OGG, WAV",
    );
    expect(audio.probed).toHaveLength(0);
    expect(sb().storage.upload).not.toHaveBeenCalled();
    expect(host.changes).toHaveLength(0);
  });

  it("plik powyżej 50 MB odpada z komunikatem o rozmiarze, nie o formacie", async () => {
    const { view } = mountPicker();

    fireEvent.change(fileInput(view.container), {
      target: { files: [fileOfSize("koncert.mp3", "audio/mpeg", 50 * 1024 * 1024 + 1)] },
    });

    await waitFor(() =>
      expect(alertText(view.container)).toBe("Plik jest za duży - maksymalnie 50 MB"),
    );
    expect(sb().storage.upload).not.toHaveBeenCalled();
  });

  it("plik zerowy jest uszkodzony, a nie w złym formacie", async () => {
    const { view } = mountPicker();

    fireEvent.change(fileInput(view.container), {
      target: { files: [fileOfSize("cisza.mp3", "audio/mpeg", 0)] },
    });

    await waitFor(() =>
      expect(alertText(view.container)).toBe("Plik audio jest uszkodzony lub nieczytelny"),
    );
    expect(audio.probed).toHaveLength(0);
    expect(sb().storage.upload).not.toHaveBeenCalled();
  });

  it("sonda z błędem zatrzymuje upload PRZED zapłatą za Storage", async () => {
    audio.broken();
    const { host, view } = mountPicker();

    fireEvent.change(fileInput(view.container), {
      target: { files: [new File(["zepsute"], "zepsute.mp3", { type: "audio/mpeg" })] },
    });

    await waitFor(() =>
      expect(alertText(view.container)).toBe("Plik audio jest uszkodzony lub nieczytelny"),
    );
    expect(audio.probed).toHaveLength(1);
    expect(audio.probed[0].startsWith("blob:")).toBe(true);
    expect(sb().storage.upload).not.toHaveBeenCalled();
    expect(host.changes).toHaveLength(0);
  });

  it("milcząca sonda kończy się fail-safe po 8 s, a nie zawieszeniem panelu", async () => {
    audio.silent();
    vi.useFakeTimers();
    const { view } = mountPicker();

    fireEvent.change(fileInput(view.container), {
      target: {
        files: [new File(["cisza-metadanych"], "bez-metadanych.mp3", { type: "audio/mp4" })],
      },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });

    expect(alertText(view.container)).toBe("Plik audio jest uszkodzony lub nieczytelny");
    expect(sb().storage.upload).not.toHaveBeenCalled();
  });

  it("sonda, która JUŻ oddała czas, ignoruje spóźniony fail-safe", async () => {
    vi.useFakeTimers();
    const { host, view } = mountPicker();

    fireEvent.change(fileInput(view.container), {
      target: { files: [new File(["dane"], "spotkanie.mp3", { type: "audio/mpeg" })] },
    });
    // Metadane dochodzą natychmiast, fail-safe dopiero po ośmiu sekundach -
    // gdyby drugie wywołanie `finish` nie było zablokowane, panel przestawiłby
    // czas trwania na null JUŻ PO udanym uploadzie.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });

    expect(toasts().success).toHaveBeenCalledWith("Plik audio wgrany · 1:35");
    expect(host.changes).toHaveLength(1);
    expect(screen.getByText("1:35")).toBeInTheDocument();
    expect(alertText(view.container)).toBe("");
  });

  it("odmowa Storage zostawia komunikat i nie zmienia wartości rodzica", async () => {
    const { host, view } = mountPicker();
    sb().storage.failUpload("new row violates row-level security policy for bucket media");

    fireEvent.change(fileInput(view.container), {
      target: { files: [new File(["dane"], "audycja.mp3", { type: "audio/mpeg" })] },
    });

    await waitFor(() =>
      expect(alertText(view.container)).toBe(
        "new row violates row-level security policy for bucket media",
      ),
    );
    expect(toasts().error).toHaveBeenCalledTimes(1);
    expect(toasts().success).not.toHaveBeenCalled();
    expect(host.changes).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Wgraj MP3" })).toBeEnabled();
  });
});

describe("AudioPicker - link i usunięcie", () => {
  it("wklejony link zatwierdza się na blur - przycięty i tylko raz", async () => {
    const { host, view } = mountPicker();
    const external = "https://audio.example.test/rozmowa.mp3";

    fireEvent.change(urlInput(view.container), { target: { value: `  ${external}  ` } });
    expect(host.changes).toHaveLength(0);
    fireEvent.blur(urlInput(view.container));

    expect(host.changes).toEqual([external]);
    await waitFor(() => expect(audio.probed).toEqual([external]));
    // Powtórny blur na tej samej wartości nie brudzi formularza edytora.
    fireEvent.blur(urlInput(view.container));
    expect(host.changes).toEqual([external]);
  });

  it("Enter w polu linku zatwierdza bez opuszczania pola", () => {
    const { host, view } = mountPicker();

    fireEvent.change(urlInput(view.container), {
      target: { value: "https://audio.example.test/wywiad.mp3" },
    });
    fireEvent.keyDown(urlInput(view.container), { key: "Enter" });

    expect(host.changes).toEqual(["https://audio.example.test/wywiad.mp3"]);
  });

  it("inny klawisz niż Enter nie zatwierdza linku", () => {
    const { host, view } = mountPicker();

    fireEvent.change(urlInput(view.container), {
      target: { value: "https://audio.example.test/x" },
    });
    fireEvent.keyDown(urlInput(view.container), { key: "a" });

    expect(host.changes).toHaveLength(0);
  });

  it("usunięcie pliku wraca do lektora AI: pusta wartość, brak czasu, toast", async () => {
    const { host, view } = mountPicker(SAVED_URL);
    await waitFor(() => expect(screen.getByText("1:35")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Usuń plik (powrót do lektora AI)" }));

    expect(host.current()).toBe("");
    expect(toasts().success).toHaveBeenCalledWith("Plik audio usunięty - wrócono do lektora AI");
    expect(
      screen.getByText("Brak pliku audio - dla tego języka użyty zostanie lektor AI (ElevenLabs)"),
    ).toBeInTheDocument();
    expect(screen.queryByText("1:35")).toBeNull();
    expect(urlInput(view.container).value).toBe("");
  });
});
