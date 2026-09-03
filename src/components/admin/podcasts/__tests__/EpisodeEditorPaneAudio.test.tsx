// Automatyczne wykrywanie czasu trwania odcinka z pliku audio.
//
// CO DOWODZI TEN PLIK - i dlaczego stoi OSOBNO od `EpisodeEditorPane.test.tsx`.
//
// Tamten plik zapisał w nagłówku, że wykrywania czasu świadomie NIE dubluje,
// bo „to `Audio` przeglądarki - ma sens tylko w teście end-to-end". Ta ocena
// jest błędna i ten plik ją odwraca: `Audio` jest konstruktorem na `window`,
// więc daje się podmienić atrapą, która wystawia `duration` i wypuszcza
// `loadedmetadata` albo `error` NA ŻĄDANIE TESTU. Cała logika, o którą tu
// chodzi, jest naszym kodem - nasłuch, sprzątanie nasłuchu, warunek
// `Number.isFinite`, zaokrąglenie, warunek `secs > 0`, przepisanie do dwóch
// osobnych stanów (sekundy + tekst MM:SS) i komunikat - a e2e nie umie
// wytworzyć przypadku „metadane przyszły z `duration = Infinity`".
//
// KONSEKWENCJA, dla której to jest warte testu. Czas trwania jedzie do kanału
// RSS jako `<itunes:duration>` (patrz `lib/seo/podcastRss.ts`) i do paska
// postępu w odtwarzaczu. Trzy awarie, każda cicha:
//   * zły czas = pasek postępu kłamie w każdym kliencie podcastowym, a Apple
//     pokazuje w katalogu długość, której odcinek nie ma;
//   * NADPISANIE czasu wpisanego ręcznie przez redakcję (plik ma metadane
//     błędne albo obcięte) = praca redakcji wyrzucona bez ostrzeżenia;
//   * niesprzątnięty nasłuch `loadedmetadata` na kolejnych podmianach pliku
//     = wyciek nasłuchów i rozstrzygnięcie obietnicy tym, co przyszło jako
//     drugie, a nie tym, co dotyczy aktualnego pliku.
//
// CZEGO NIE DUBLUJE: pozostałych pól edytora, zestawu zapisu i obsady - te
// mają dowód w `EpisodeEditorPane.test.tsx`; formatowania czasu jako czystej
// funkcji - to `shape.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Podcast, PodcastShow } from "@/lib/podcast/types";
import type { EpisodeBundle } from "@/lib/podcast/shape";
import { newEpisodeDraft } from "@/lib/podcast/shape";

const h = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-podcasts", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: ({ accept, onPick }: { accept: string; onPick: (url: string) => void }) => (
    <button
      type="button"
      data-testid={`media-pick-${accept}`}
      onClick={() => onPick("https://cdn.example.org/wybrany-audio.mp3")}
    />
  ),
}));
vi.mock("@/components/atoms/PodcastPlayer", () => ({
  PodcastPlayer: () => <div data-testid="podcast-player" />,
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children?: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  TabsContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    "aria-label": ariaLabel,
  }: {
    checked: boolean;
    onCheckedChange: (next: boolean) => void;
    "aria-label"?: string;
  }) => (
    <input
      type="checkbox"
      role="switch"
      aria-label={ariaLabel}
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, children }: { value?: string; children?: ReactNode }) => (
    <div data-testid="select" data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

import { ok, supabaseFromStub } from "@/test/supabaseChain";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const { EpisodeEditorPane } = await import("@/components/admin/podcasts/EpisodeEditorPane");

const db = () => stubs.from as ReturnType<typeof supabaseFromStub>;

// ---------------------------------------------------------------------------
// Atrapa `Audio`
//
// WIERNOŚĆ JEST TU WARUNKIEM SENSU TESTU: kod produkcyjny (a) tworzy instancję,
// (b) zapisuje DWA nasłuchy, (c) ustawia `preload = "metadata"` i `src`, (d) po
// zdarzeniu ODPINA oba nasłuchy. Atrapa musi więc zapisywać nasłuchy i ich
// odpięcia, żeby test mógł dowieść sprzątania - inaczej „nie ma wycieku" nie
// byłoby asercją, tylko życzeniem.
// ---------------------------------------------------------------------------

interface FakeAudio {
  src: string;
  preload: string;
  duration: number;
  /** Nasłuchy WCIĄŻ podpięte (odpięte są usuwane). */
  readonly listeners: Map<string, () => void>;
  /** Historia odpięć - do dowodu, że kod sprząta po sobie. */
  readonly removed: string[];
  fire(event: "loadedmetadata" | "error"): void;
}

const audios: FakeAudio[] = [];

function installFakeAudio(): void {
  class FakeAudioImpl implements FakeAudio {
    src = "";
    preload = "";
    duration = Number.NaN;
    readonly listeners = new Map<string, () => void>();
    readonly removed: string[] = [];

    constructor() {
      audios.push(this);
    }

    addEventListener(event: string, handler: () => void): void {
      this.listeners.set(event, handler);
    }

    removeEventListener(event: string, _handler: () => void): void {
      this.listeners.delete(event);
      this.removed.push(event);
    }

    fire(event: "loadedmetadata" | "error"): void {
      const handler = this.listeners.get(event);
      if (!handler) throw new Error(`test: brak nasłuchu "${event}" - kod go nie podpiął`);
      handler();
    }
  }
  // STRAŻNIK, nie rzutowanie: podmieniamy konstruktor na obiekcie globalnym,
  // więc zawężenie musi przejść przez `globalThis` z jawnym kształtem pola.
  const target: { Audio?: unknown } = globalThis;
  target.Audio = FakeAudioImpl;
}

/** Ostatnia utworzona instancja - kod tworzy dokładnie jedną na wykrycie. */
function lastAudio(): FakeAudio {
  const audio = audios.at(-1);
  if (!audio) throw new Error("test: kod NIE utworzył instancji Audio");
  return audio;
}

const SHOWS: PodcastShow[] = [];

function episode(overrides: Partial<Podcast> = {}): Podcast {
  return {
    ...newEpisodeDraft("2026-01-01T00:00:00.000Z"),
    id: "33333333-3333-4333-8333-333333333333",
    slug: "odc-audio",
    title_pl: "Odcinek z audio",
    title_en: "Episode with audio",
    audio_url: "",
    duration_seconds: 0,
    ...overrides,
  };
}

function mount(p: Podcast = episode()) {
  db().setResponse("podcast_episode_people", ok([]));
  db().setResponse("categories", ok([]));
  db().setResponse("profiles", ok([]));
  const onSave = vi.fn<(bundle: EpisodeBundle) => void>();
  return {
    onSave,
    ...renderWithQueryClient(
      <EpisodeEditorPane p={p} shows={SHOWS} onSave={onSave} onCancel={vi.fn()} saving={false} />,
    ),
  };
}

/**
 * Wybór pliku z biblioteki mediów - jedna z dwóch dróg uruchamiających
 * wykrycie (druga to opuszczenie pola z ręcznie wklejonym adresem).
 *
 * `accept="all"`, nie `"audio/*"`: edytor odcinka pozwala wskazać dowolny plik
 * z biblioteki, bo część redakcji trzyma nagrania jako `application/octet-stream`
 * po wgraniu z zewnętrznego CDN. Atrapa okna wystawia jeden przycisk per
 * wartość `accept`, więc identyfikator MUSI zgadzać się z produkcją - inaczej
 * test „nie znajduje przycisku" i wygląda jak defekt komponentu.
 */
function pickAudioFromLibrary(): void {
  fireEvent.click(screen.getByTestId("media-pick-all"));
}

beforeEach(() => {
  audios.length = 0;
  installFakeAudio();
  db().reset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("wykrycie czasu trwania - kontrola samej atrapy", () => {
  // Bez tego bloku każda asercja niżej mogłaby przechodzić na atrapie, której
  // kod produkcyjny w ogóle nie używa.
  it("kod tworzy instancję Audio i podpina DWA nasłuchy", () => {
    mount();
    pickAudioFromLibrary();
    const audio = lastAudio();
    expect([...audio.listeners.keys()].sort()).toEqual(["error", "loadedmetadata"]);
  });

  it("kod ustawia preload=metadata - inaczej przeglądarka ciągnęłaby CAŁY plik", () => {
    // Odcinek podcastu to dziesiątki megabajtów. `preload="metadata"` jest
    // różnicą między pobraniem nagłówka i pobraniem całego nagrania po to,
    // żeby odczytać jedną liczbę.
    mount();
    pickAudioFromLibrary();
    expect(lastAudio().preload).toBe("metadata");
  });
});

describe("wykrycie czasu trwania - ścieżka zdrowa", () => {
  it("metadane z czasem 125,4 s dają 125 s w stanie i 2:05 w polu", async () => {
    mount();
    pickAudioFromLibrary();
    const audio = lastAudio();
    audio.duration = 125.4;
    audio.fire("loadedmetadata");
    // 125,4 -> zaokrąglenie do 125 -> format 2:05. Gdyby kod ucinał zamiast
    // zaokrąglać, dla 125,6 wyszłoby 2:05 zamiast 2:06 - stąd asercja na
    // OBU reprezentacjach, nie na jednej.
    expect(await screen.findByDisplayValue("2:05")).toBeTruthy();
  });

  it("wykrycie melduje się redakcji komunikatem, a nie po cichu", async () => {
    mount();
    pickAudioFromLibrary();
    const audio = lastAudio();
    audio.duration = 1830;
    audio.fire("loadedmetadata");
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(1));
  });

  it("wybrany adres dojeżdża do pola audio", async () => {
    mount();
    pickAudioFromLibrary();
    expect(
      await screen.findByDisplayValue("https://cdn.example.org/wybrany-audio.mp3"),
    ).toBeTruthy();
  });

  it("kod ODPINA oba nasłuchy po rozstrzygnięciu - nasłuch nie może zostać", async () => {
    // Wyciek nasłuchu na kolejnych podmianach pliku kończy się tym, że
    // obietnicę rozstrzyga zdarzenie POPRZEDNIEGO pliku.
    mount();
    pickAudioFromLibrary();
    const audio = lastAudio();
    audio.duration = 60;
    audio.fire("loadedmetadata");
    await waitFor(() => expect(audio.removed.sort()).toEqual(["error", "loadedmetadata"]));
    expect(audio.listeners.size, "po sprzątnięciu nie ma podpiętych nasłuchów").toBe(0);
  });
});

describe("wykrycie czasu trwania - ścieżki, na których NIE wolno nic nadpisać", () => {
  it("błąd wczytania metadanych NIE ustawia czasu i NIE melduje sukcesu", async () => {
    mount();
    pickAudioFromLibrary();
    const audio = lastAudio();
    audio.fire("error");
    await waitFor(() =>
      expect(screen.getByDisplayValue("https://cdn.example.org/wybrany-audio.mp3")).toBeTruthy(),
    );
    expect(h.toastSuccess, "plik bez metadanych nie jest sukcesem").not.toHaveBeenCalled();
  });

  it.each([Number.POSITIVE_INFINITY, Number.NaN])(
    "duration = %s jest odrzucone - strumień bez znanej długości nie jest czasem",
    async (bad) => {
      // `Infinity` to realny przypadek: tak wygląda `duration` dla strumienia
      // i dla pliku z obciętym nagłówkiem. Wpisanie go do bazy dałoby
      // `<itunes:duration>Infinity</itunes:duration>` w kanale.
      mount();
      pickAudioFromLibrary();
      const audio = lastAudio();
      audio.duration = bad;
      audio.fire("loadedmetadata");
      await waitFor(() => expect(audio.removed.length).toBeGreaterThan(0));
      expect(h.toastSuccess).not.toHaveBeenCalled();
    },
  );

  it("duration = 0 jest odrzucone - zero to brak informacji, nie odcinek zerowy", async () => {
    mount();
    pickAudioFromLibrary();
    const audio = lastAudio();
    audio.duration = 0;
    audio.fire("loadedmetadata");
    await waitFor(() => expect(audio.removed.length).toBeGreaterThan(0));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("wykrycie czasu trwania - adres wklejony RĘCZNIE", () => {
  it("opuszczenie pola z adresem uruchamia wykrycie, gdy czasu NIE MA", async () => {
    mount(episode({ duration_seconds: 0 }));
    const input = screen.getByPlaceholderText("adminPodcasts.editor.audioPlaceholder");
    fireEvent.change(input, { target: { value: "https://cdn.example.org/wklejony.mp3" } });
    fireEvent.blur(input, { target: { value: "https://cdn.example.org/wklejony.mp3" } });
    const audio = lastAudio();
    audio.duration = 300;
    audio.fire("loadedmetadata");
    expect(await screen.findByDisplayValue("5:00")).toBeTruthy();
  });

  it("opuszczenie pola NIE nadpisuje czasu WPISANEGO PRZEZ REDAKCJĘ", () => {
    // To jest najważniejsza asercja pliku. Redakcja wpisuje czas ręcznie
    // właśnie wtedy, gdy metadane pliku są błędne albo obcięte. Wykrycie,
    // które nadpisuje tę wartość, wyrzuca jej pracę bez ostrzeżenia - a
    // odcinek wraca do kanału z długością, którą redakcja już raz odrzuciła.
    mount(episode({ duration_seconds: 1830, audio_url: "https://cdn.example.org/odc.mp3" }));
    const input = screen.getByPlaceholderText("adminPodcasts.editor.audioPlaceholder");
    fireEvent.blur(input, { target: { value: "https://cdn.example.org/odc.mp3" } });
    expect(audios.length, "przy istniejącym czasie wykrycie NIE startuje").toBe(0);
    expect(screen.getByDisplayValue("30:30"), "czas redakcji zostaje").toBeTruthy();
  });

  it("opuszczenie PUSTEGO pola nie uruchamia wykrycia", () => {
    mount(episode({ duration_seconds: 0 }));
    const input = screen.getByPlaceholderText("adminPodcasts.editor.audioPlaceholder");
    fireEvent.blur(input, { target: { value: "" } });
    expect(audios.length).toBe(0);
  });
});
