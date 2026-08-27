// Organizmy odtwarzacza: przycisk odsłuchu w treści, karta w sidebarze i dolny
// pasek. Wszystkie trzy stały na ZERZE pokrycia, mimo że są JEDYNĄ powierzchnią,
// przez którą czytelnik uruchamia PŁATNĄ syntezę mowy.
//
// Test wymienia WYŁĄCZNIE globalny player (jego własne reguły - pamięć pozycji,
// cache blobów, etapy TTS - mają osobne testy w `lib/audio`). Wszystko inne
// jedzie prawdziwą ścieżką: wybór etykiety regułą, atomy przycisków, kontrakty
// a11y, toast błędu.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { AudioStatus, TtsProgress } from "@/lib/audio/global-player";

const h = vi.hoisted(() => ({
  player: null as unknown,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  promptDialog: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: h.toastError, success: h.toastSuccess },
}));

// Ostateczny fallback udostępniania (schowek odmówił) otwiera dialog aplikacji.
// Podmieniamy tylko tę jedną funkcję - reszta modułu jedzie prawdziwa.
vi.mock("@/lib/appDialogs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/appDialogs")>()),
  promptDialog: h.promptDialog,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useRouter: () => ({ preloadRoute: vi.fn(), navigate: vi.fn() }),
}));

vi.mock("@/lib/audio/global-player", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audio/global-player")>();
  return { ...actual, useGlobalAudioPlayer: () => h.player };
});

import { ArticleListenButton } from "@/components/audio/ArticleListenButton";
import { SidebarListenCard } from "@/components/audio/SidebarListenCard";
import { GlobalAudioBar } from "@/components/audio/GlobalAudioBar";

const POST = "11111111-1111-1111-1111-111111111111";

const INITIAL_TTS: TtsProgress = {
  stage: "idle",
  percent: 0,
  bytes: 0,
  totalBytes: null,
  elapsedMs: 0,
};

interface PlayerOverrides {
  status?: AudioStatus;
  activePostId?: string | null;
  track?: Record<string, unknown> | null;
  tts?: Partial<TtsProgress>;
  duration?: number;
  currentTime?: number;
  error?: string | null;
}

function playerStub(overrides: PlayerOverrides = {}) {
  const activePostId = overrides.activePostId === undefined ? POST : overrides.activePostId;
  return {
    status: overrides.status ?? "idle",
    track: overrides.track === undefined ? null : overrides.track,
    currentTime: overrides.currentTime ?? 0,
    duration: overrides.duration ?? 0,
    progress: 0,
    error: overrides.error ?? null,
    tts: { ...INITIAL_TTS, ...(overrides.tts ?? {}) },
    isActive: (postId: string) => postId === activePostId,
    loadAndPlay: vi.fn().mockResolvedValue(undefined),
    toggle: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn(),
    seekPct: vi.fn(),
    skip: vi.fn(),
    playbackRate: 1,
    setPlaybackRate: vi.fn(),
    close: vi.fn(),
    download: vi.fn().mockResolvedValue(undefined),
  };
}

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

// ── PODSTAWIANIE API PRZEGLĄDARKI ────────────────────────────────────────────
// Odtwarzacz dotyka trzech rzeczy, których happy-dom nie ma albo ma bez
// implementacji: Web Share API, schowka i odtwarzacza mediów. Podstawiamy je
// RAZ, w helperach, bo inaczej każdy test musiałby sam pamiętać o sprzątaniu -
// a niesprzątnięty `navigator.share` zmienia wynik NASTĘPNEGO testu.

/** Kolejka przywróceń podmienionych globali - opróżniana w `afterEach`. */
const przywroc: Array<() => void> = [];

function podmien(target: object, name: string, value: unknown): void {
  const oryginal = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
  przywroc.push(() => {
    if (oryginal) Object.defineProperty(target, name, oryginal);
    else Reflect.deleteProperty(target, name);
  });
}

/** Schowek przyjmujący tekst - fallback udostępniania bez Web Share API. */
function schowek(writeText = vi.fn().mockResolvedValue(undefined)) {
  podmien(navigator, "clipboard", { writeText });
  return writeText;
}

/**
 * Obietnica rozwiązywana z testu. Bez niej stan „w trakcie" (pobieram audio)
 * jest niewidoczny: `download()` kończy się w tym samym tiku co klik, więc
 * spinner i zablokowany przycisk nigdy nie trafiają do DOM-u.
 */
function odroczona() {
  let rozwiaz: () => void = () => {};
  const promise = new Promise<void>((res) => {
    rozwiaz = () => res();
  });
  return { promise, rozwiaz };
}

/**
 * happy-dom nie ma odtwarzacza mediów, a karta czyta długość nagrania
 * z elementu `<audio>` tworzonego POZA DOM-em (prefetch metadanych) - nie da
 * się go znaleźć zapytaniem. Przechwytujemy więc `createElement`, żeby test mógł
 * podstawić długość i wystrzelić `loadedmetadata`.
 */
function przechwycAudio(): HTMLAudioElement[] {
  const utworzone: HTMLAudioElement[] = [];
  const oryginal = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(
    (tag: string, opts?: ElementCreationOptions) => {
      const el = oryginal(tag, opts);
      if (tag === "audio") utworzone.push(el as HTMLAudioElement);
      return el;
    },
  );
  return utworzone;
}

beforeEach(() => {
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
  h.promptDialog.mockReset();
  h.promptDialog.mockResolvedValue(null);
  h.player = playerStub();
});

afterEach(() => {
  while (przywroc.length > 0) przywroc.pop()?.();
  vi.restoreAllMocks();
});

describe("ArticleListenButton", () => {
  function mount() {
    return renderWithQuery(
      <ArticleListenButton postId={POST} lang="pl" title="Analiza" audioUrl={null} />,
    );
  }

  it("w spoczynku zaprasza do odsłuchu (etykieta ODSŁUCHAJ, nie ODTWÓRZ)", () => {
    h.player = playerStub({ status: "idle", activePostId: null });
    mount();
    expect(screen.getByRole("button", { name: "Odsłuchaj artykuł" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wznów" })).toBeNull();
  });

  it("klik na NIEAKTYWNYM wpisie ŁADUJE ten wpis (nie przełącza cudzego audio)", async () => {
    const player = playerStub({ status: "idle", activePostId: null });
    h.player = player;
    mount();

    await act(async () => {
      screen.getByRole("button", { name: "Odsłuchaj artykuł" }).click();
    });

    expect(player.loadAndPlay).toHaveBeenCalledTimes(1);
    expect(player.toggle).not.toHaveBeenCalled();
  });

  it("metadane przekazane do playera niosą wpis, język i wgrane audio", async () => {
    const player = playerStub({ status: "idle", activePostId: null });
    h.player = player;
    renderWithQuery(
      <ArticleListenButton
        postId={POST}
        lang="en"
        title="Analysis"
        author="Anna"
        audioUrl="https://cdn/a.mp3"
      />,
    );

    await act(async () => {
      screen.getByRole("button", { name: "Listen to article" }).click();
    });

    expect(player.loadAndPlay.mock.calls[0][0]).toMatchObject({
      postId: POST,
      lang: "en",
      audioUrl: "https://cdn/a.mp3",
    });
    expect(player.loadAndPlay).toHaveBeenCalledTimes(1);
  });

  it("klik na AKTYWNYM wpisie PRZEŁĄCZA odtwarzanie (nie ładuje drugi raz)", async () => {
    const player = playerStub({ status: "playing" });
    h.player = player;
    mount();

    await act(async () => {
      screen.getByRole("button", { name: "Pauza" }).click();
    });

    expect(player.toggle).toHaveBeenCalledTimes(1);
    expect(player.loadAndPlay).not.toHaveBeenCalled();
  });

  it("w PAUZIE etykieta mówi WZNÓW - czytelnik wraca tam, gdzie przerwał", () => {
    h.player = playerStub({ status: "paused" });
    mount();
    expect(screen.getByRole("button", { name: "Wznów" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Odsłuchaj artykuł" })).toBeNull();
  });

  it("w trakcie GENEROWANIA przycisk ogłasza zajętość i NIE przełącza", async () => {
    const player = playerStub({ status: "loading" });
    h.player = player;
    mount();
    const button = screen.getByRole("button", { name: "Generuję audio…" });
    expect(button).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      button.click();
    });
    expect(player.toggle).not.toHaveBeenCalled();
  });

  it("PRZEJŚCIE w błąd pokazuje komunikat dokładnie raz", async () => {
    h.player = playerStub({ status: "idle" });
    const { rerender } = mount();
    expect(h.toastError).not.toHaveBeenCalled();

    h.player = playerStub({ status: "error", error: "Kwota wyczerpana" });
    await act(async () => {
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <ArticleListenButton postId={POST} lang="pl" title="Analiza" audioUrl={null} />
        </QueryClientProvider>,
      );
    });

    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.toastError.mock.calls[0][0]).toBe("Kwota wyczerpana");
  });

  it("stan innego wpisu NIE zmienia etykiety tego przycisku", () => {
    h.player = playerStub({ status: "playing", activePostId: "inny-wpis" });
    mount();
    expect(screen.getByRole("button", { name: "Odsłuchaj artykuł" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pauza" })).toBeNull();
  });

  it("błąd BEZ komunikatu od playera nie zostawia czytelnika z pustym toastem", async () => {
    // Player zgłasza `status: "error"` z `error: null` przy każdej awarii, która
    // nie ma własnego zdania (przerwane połączenie, timeout). Bez fallbacku do
    // słownika czytelnik dostawał toast z `undefined` w treści.
    h.player = playerStub({ status: "idle" });
    const { rerender } = mount();

    h.player = playerStub({ status: "error", error: null });
    await act(async () => {
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <ArticleListenButton postId={POST} lang="en" title="Analysis" audioUrl={null} />
        </QueryClientProvider>,
      );
    });

    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.toastError.mock.calls[0][0]).toBe("Could not generate audio");
  });
});

describe("SidebarListenCard", () => {
  function mount(props: Record<string, unknown> = {}) {
    return renderWithQuery(
      <SidebarListenCard postId={POST} lang="pl" title="Analiza" readMinutes={10} {...props} />,
    );
  }

  it("renderuje kartę odsłuchu jako obszar pomocniczy z nazwą", () => {
    h.player = playerStub({ activePostId: null });
    mount();
    // `<aside aria-label>` daje rolę `complementary` - karta jest treścią
    // towarzyszącą artykułowi, nie samodzielnym regionem.
    expect(screen.getByRole("complementary", { name: "Posłuchaj artykułu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Odtwórz" })).toBeInTheDocument();
  });

  it("etykieta przycisku to ODTWÓRZ/PAUZA - karta jest wariantem transportowym", () => {
    h.player = playerStub({ status: "playing" });
    mount();
    expect(screen.getByRole("button", { name: "Pauza" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wznów" })).toBeNull();
  });

  it("klik ładuje wpis, gdy karta nie jest aktywna", async () => {
    const player = playerStub({ activePostId: null });
    h.player = player;
    mount();

    await act(async () => {
      screen.getByRole("button", { name: "Odtwórz" }).click();
    });

    expect(player.loadAndPlay).toHaveBeenCalledTimes(1);
    expect(player.toggle).not.toHaveBeenCalled();
  });

  it("ETAP SYNTEZY jest pokazywany czytelnikowi (widzi, na co czeka)", () => {
    h.player = playerStub({ status: "loading", tts: { stage: "synthesizing" } });
    mount();
    expect(screen.getByText("ElevenLabs syntezuje głos")).toBeInTheDocument();
    expect(screen.queryByText("Z pamięci podręcznej")).toBeNull();
  });

  it("TRAFIENIE W CACHE ma własny komunikat (czytelnik widzi, że nie płacimy)", () => {
    h.player = playerStub({ status: "loading", tts: { stage: "cached", percent: 100 } });
    mount();
    expect(screen.getByText("Z pamięci podręcznej")).toBeInTheDocument();
    expect(screen.queryByText("ElevenLabs syntezuje głos")).toBeNull();
  });

  it("suwak przewijania jest WYŁĄCZONY, dopóki długość materiału jest nieznana", () => {
    h.player = playerStub({ status: "playing", duration: 0 });
    const { rerender } = mount();
    expect(screen.getByRole("slider")).toBeDisabled();

    h.player = playerStub({ status: "playing", duration: 600, currentTime: 120 });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <SidebarListenCard postId={POST} lang="pl" title="Analiza" readMinutes={10} />
      </QueryClientProvider>,
    );
    const slider = screen.getByRole("slider");
    expect(slider).toBeEnabled();
    expect(slider).toHaveAttribute("aria-valuetext", "2:00 / 10:00");
  });

  it("PRZEJŚCIE w błąd pokazuje komunikat", async () => {
    h.player = playerStub({ status: "idle" });
    const { rerender } = mount();
    h.player = playerStub({ status: "error", error: "Nie udało się" });

    await act(async () => {
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <SidebarListenCard postId={POST} lang="pl" title="Analiza" readMinutes={10} />
        </QueryClientProvider>,
      );
    });

    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.toastError.mock.calls[0][1]).toMatchObject({ id: "tts-error" });
  });

  it("wariant angielski używa angielskich etykiet", () => {
    h.player = playerStub({ activePostId: null });
    mount({ lang: "en" });
    expect(screen.getByRole("complementary")).toHaveAccessibleName(/[Ll]isten/);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("klik na AKTYWNEJ karcie PRZEŁĄCZA odtwarzanie (nie ładuje drugi raz)", async () => {
    // Drugie kliknięcie tej samej karty NIE MOŻE wołać syntezy - to jest cała
    // różnica między pauzą a ponownym opłaceniem tego samego nagrania.
    const player = playerStub({ status: "playing" });
    h.player = player;
    mount();

    await act(async () => {
      screen.getByRole("button", { name: "Pauza" }).click();
    });

    expect(player.toggle).toHaveBeenCalledTimes(1);
    expect(player.loadAndPlay).not.toHaveBeenCalled();
  });

  it("po błędzie karta oferuje PONOWNĄ próbę, która ładuje ten sam materiał", async () => {
    const player = playerStub({ status: "error" });
    h.player = player;
    mount();

    await act(async () => {
      screen.getByRole("button", { name: "Spróbuj ponownie" }).click();
    });

    expect(player.loadAndPlay).toHaveBeenCalledTimes(1);
    expect(player.loadAndPlay.mock.calls[0][0]).toMatchObject({ postId: POST, lang: "pl" });
  });

  it("błąd BEZ komunikatu od playera pokazuje zdanie ze słownika", async () => {
    h.player = playerStub({ status: "idle" });
    const { rerender } = mount();

    h.player = playerStub({ status: "error", error: null });
    await act(async () => {
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <SidebarListenCard postId={POST} lang="pl" title="Analiza" readMinutes={10} />
        </QueryClientProvider>,
      );
    });

    expect(h.toastError).toHaveBeenCalledWith("Nie udało się wygenerować audio", {
      id: "tts-error",
    });
  });

  it("PROCENT postępu pokazujemy tylko gdy jest wiarygodny (etap pobierania)", () => {
    h.player = playerStub({ status: "loading", tts: { stage: "streaming", percent: 42 } });
    const { container } = mount();
    // Etykieta etapu i procent stoją w jednym elemencie jako dwa węzły tekstowe.
    expect(container.textContent).toContain("Pobieram audio");
    expect(container.textContent).toContain("42%");
  });

  it("BEZ szacunku czytania i bez nagrania karta nie kłamie o czasie", () => {
    // `--:--` zamiast „ok. 0 min": czytelnik ma widzieć, że czas jest NIEZNANY,
    // a nie że materiał jest zerowej długości.
    h.player = playerStub({ activePostId: null });
    mount({ readMinutes: null });
    expect(screen.getByText(/--:--/)).toBeInTheDocument();
    expect(screen.queryByText(/ok\. /)).toBeNull();
  });

  it("wgrany MP3: karta pokazuje REALNY czas nagrania, nie szacunek z czytania", async () => {
    h.player = playerStub({ activePostId: null });
    const audio = przechwycAudio();
    mount({ audioUrl: "https://cdn.example/a.mp3" });

    // Przed metadanymi widać wyłącznie szacunek wyliczony z czasu czytania.
    expect(screen.getByText(/ok\. 12 min/)).toBeInTheDocument();
    // Wgrany MP3 = oryginał lektora, więc podpowiedź o narracji AI znika.
    expect(screen.queryByRole("button", { name: /Narracja generowana/ })).toBeNull();

    const el = audio[0];
    expect(el).toBeDefined();
    Object.defineProperty(el, "duration", { configurable: true, value: 754 });
    await act(async () => {
      el.dispatchEvent(new Event("loadedmetadata"));
    });

    expect(screen.getByText(/12:34/)).toBeInTheDocument();
    expect(screen.queryByText(/ok\. 12 min/)).toBeNull();
  });

  it("metadane BEZ długości nagrania NIE nadpisują szacunku", async () => {
    // `loadedmetadata` z `duration: NaN` przychodzi z serwerów bez `Content-Length`
    // i ze strumieni - wpisanie tego do widoku dałoby czytelnikowi „0:00".
    h.player = playerStub({ activePostId: null });
    const audio = przechwycAudio();
    mount({ audioUrl: "https://cdn.example/a.mp3" });

    await act(async () => {
      audio[0].dispatchEvent(new Event("loadedmetadata"));
    });

    expect(screen.getByText(/ok\. 12 min/)).toBeInTheDocument();
    // Oś czasu nadal nie istnieje: długość jest NIEZNANA, a nie zerowa.
    expect(screen.getByRole("slider")).toBeDisabled();
  });

  it("POBIERANIE ogłasza trwanie, blokuje przycisk i wraca do stanu gotowego", async () => {
    const { promise, rozwiaz } = odroczona();
    const player = playerStub({ activePostId: null });
    player.download.mockReturnValue(promise);
    h.player = player;
    mount();

    await act(async () => {
      screen.getByRole("button", { name: "Pobierz MP3" }).click();
    });

    const trwa = screen.getByRole("button", { name: "Pobieram audio…" });
    expect(trwa).toBeDisabled();
    expect(trwa.querySelector(".animate-spin")).not.toBeNull();
    expect(player.download.mock.calls[0][0]).toMatchObject({ postId: POST, lang: "pl" });

    await act(async () => {
      rozwiaz();
      await promise;
    });

    expect(screen.getByRole("button", { name: "Pobierz MP3" })).toBeEnabled();
  });

  it("nieudane pobranie mówi o tym czytelnikowi i ODBLOKOWUJE przycisk", async () => {
    const player = playerStub({ activePostId: null });
    player.download.mockRejectedValue(new Error("503"));
    h.player = player;
    mount();

    await act(async () => {
      screen.getByRole("button", { name: "Pobierz MP3" }).click();
    });

    expect(h.toastError).toHaveBeenCalledWith("Nie udało się pobrać audio");
    expect(screen.getByRole("button", { name: "Pobierz MP3" })).toBeEnabled();
  });

  it("przewinięcie suwakiem zatwierdza pozycję po opuszczeniu fokusu", () => {
    const player = playerStub({ status: "playing", duration: 600, currentTime: 30 });
    h.player = player;
    mount();

    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "180" } });
    // Sam ruch suwakiem NIE przestawia audio - inaczej każdy piksel gestu byłby
    // osobnym `seek`-iem na elemencie medialnym.
    expect(player.seek).not.toHaveBeenCalled();

    fireEvent.blur(slider);
    expect(player.seek).toHaveBeenCalledWith(180);
  });

  it("opuszczenie suwaka BEZ przewijania nie przestawia pozycji", () => {
    const player = playerStub({ status: "playing", duration: 600, currentTime: 30 });
    h.player = player;
    mount();

    fireEvent.blur(screen.getByRole("slider"));
    expect(player.seek).not.toHaveBeenCalled();
  });

  it("przewinięcie KLAWIATURĄ zatwierdza pozycję od razu i czyści gest", () => {
    const player = playerStub({ status: "playing", duration: 600, currentTime: 30 });
    h.player = player;
    mount();

    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "240" } });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(player.seek).toHaveBeenCalledWith(240);

    // Po zatwierdzeniu gest jest wyczyszczony, więc opuszczenie fokusu nie
    // wysyła DRUGIEGO `seek`-a na tę samą pozycję.
    fireEvent.blur(slider);
    expect(player.seek).toHaveBeenCalledTimes(1);
  });
});

describe("SidebarListenCard - wariant mobilny (full-width)", () => {
  function mount(props: Record<string, unknown> = {}) {
    return renderWithQuery(
      <SidebarListenCard
        postId={POST}
        lang="pl"
        title="Analiza"
        readMinutes={10}
        variant="full-width"
        {...props}
      />,
    );
  }

  it("na NIEAKTYWNYM wpisie zaprasza do odsłuchu, nie do odtworzenia", () => {
    h.player = playerStub({ activePostId: null });
    mount();
    const button = screen.getByRole("button", { name: "Odtwórz" });
    // Widoczny napis to ZAPROSZENIE („Odsłuchaj artykuł") - nazwa dostępna idzie
    // z reguły transportowej, wspólnej z dolnym paskiem.
    expect(button).toHaveTextContent("Odsłuchaj artykuł");
    expect(button).toHaveAttribute("data-playing", "false");
  });

  it("w trakcie ODTWARZANIA ogłasza pauzę i stan wciśnięcia", () => {
    h.player = playerStub({ status: "playing" });
    mount();
    const button = screen.getByRole("button", { name: "Pauza", pressed: true });
    expect(button).toHaveTextContent("Pauza");
    expect(button).toHaveAttribute("data-playing", "true");
  });

  it("na AKTYWNYM wpisie w pauzie mówi ODTWÓRZ, nie ODSŁUCHAJ", () => {
    // Materiał jest już wczytany, więc przycisk nie może zapraszać po raz drugi -
    // czytelnik wróci w miejsce, w którym przerwał.
    h.player = playerStub({ status: "paused" });
    mount();
    const button = screen.getByRole("button", { name: "Odtwórz" });
    expect(button).toHaveTextContent("Odtwórz");
    expect(button).not.toHaveTextContent("Odsłuchaj artykuł");
  });

  it("w trakcie GENEROWANIA jest wyłączony i mówi, na co czytelnik czeka", () => {
    const player = playerStub({ status: "loading" });
    h.player = player;
    mount();
    const button = screen.getByRole("button", { name: "Generuję audio…" });
    expect(button).toBeDisabled();
    expect(button.querySelector(".animate-spin")).not.toBeNull();

    button.click();
    expect(player.toggle).not.toHaveBeenCalled();
  });
});

describe("GlobalAudioBar", () => {
  const track = {
    postId: POST,
    lang: "pl" as const,
    title: "Analiza o UE",
    author: "Anna Nowak",
    authorHref: "/author/anna-nowak",
    postHref: "/post/analiza",
    audioUrl: null,
  };

  function mount() {
    return renderWithQuery(<GlobalAudioBar />);
  }

  it("BEZ aktywnego materiału pasek nie renderuje się wcale", async () => {
    h.player = playerStub({ track: null });
    const { container } = mount();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("z aktywnym materiałem renderuje pasek jako region z nazwą", async () => {
    h.player = playerStub({ track, status: "playing", duration: 600 });
    mount();
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Odtwarzacz audio" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("region")).toBeInTheDocument();
  });

  it("rząd transportu ma trzy przyciski o RÓŻNYCH nazwach dostępnych", async () => {
    h.player = playerStub({ track, status: "playing", duration: 600 });
    mount();
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Cofnij 15 sekund" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Do przodu 15 sekund" })).toBeInTheDocument();
  });

  it("przycisk odtwarzania OGŁASZA stan wciśnięcia, ±15 s nie", async () => {
    h.player = playerStub({ track, status: "playing", duration: 600 });
    mount();
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Pauza", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cofnij 15 sekund" })).not.toHaveAttribute(
      "aria-pressed",
    );
  });

  it("±15 s są WYŁĄCZONE, dopóki długość materiału jest nieznana", async () => {
    h.player = playerStub({ track, status: "playing", duration: 0 });
    mount();
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Cofnij 15 sekund" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Do przodu 15 sekund" })).toBeDisabled();
  });

  it("±15 s wołają przeskok o właściwy znak", async () => {
    const player = playerStub({ track, status: "playing", duration: 600 });
    h.player = player;
    mount();
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());

    await act(async () => {
      screen.getByRole("button", { name: "Cofnij 15 sekund" }).click();
      screen.getByRole("button", { name: "Do przodu 15 sekund" }).click();
    });

    expect(player.skip).toHaveBeenNthCalledWith(1, -15);
    expect(player.skip).toHaveBeenNthCalledWith(2, 15);
  });

  it("zamknięcie paska woła `close`, nie pauzę", async () => {
    const player = playerStub({ track, status: "playing", duration: 600 });
    h.player = player;
    mount();
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());

    await act(async () => {
      screen.getByRole("button", { name: "Zamknij odtwarzacz" }).click();
    });

    expect(player.close).toHaveBeenCalledTimes(1);
    expect(player.toggle).not.toHaveBeenCalled();
  });

  it("tempo odtwarzania jest przełącznikiem z widoczną wartością", async () => {
    const player = playerStub({ track, status: "playing", duration: 600 });
    h.player = player;
    mount();
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());

    const speed = screen.getByRole("button", { name: /Tempo odtwarzania/ });
    await act(async () => {
      speed.click();
    });

    expect(player.setPlaybackRate).toHaveBeenCalledTimes(1);
    // Format używa ZNAKU MNOŻENIA (×), nie litery „x" - to samo w etykiecie
    // dostępnej i w widocznej wartości.
    expect(speed).toHaveTextContent("1×");
  });

  it("pasek pokazuje TYTUŁ materiału i prowadzi do wpisu", async () => {
    h.player = playerStub({ track, status: "playing", duration: 600 });
    mount();
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());
    expect(screen.getByText("Analiza o UE")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Analiza o UE/ })).toHaveAttribute(
      "href",
      "/post/analiza",
    );
  });

  it("ETAP SYNTEZY jest widoczny w trakcie generowania", async () => {
    h.player = playerStub({
      track,
      status: "loading",
      tts: { stage: "streaming", percent: 42 },
    });
    const { container } = mount();
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());
    // Etykieta etapu i procent stoją w jednym elemencie jako dwa węzły tekstowe,
    // więc sprawdzamy zawartość regionu, nie pojedynczy napis.
    expect(container.textContent).toContain("Pobieram audio");
    expect(container.textContent).toContain("42%");
    expect(screen.getByRole("button", { name: "Generuję audio…" })).toBeDisabled();
  });

  it("PRZEJŚCIE w błąd pokazuje komunikat ze WSPÓLNYM identyfikatorem (dedup)", async () => {
    h.player = playerStub({ track: null, status: "idle" });
    const { rerender } = mount();
    h.player = playerStub({ track: null, status: "error", error: "Kwota wyczerpana" });

    await act(async () => {
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <GlobalAudioBar />
        </QueryClientProvider>,
      );
    });

    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.toastError.mock.calls[0][1]).toMatchObject({ id: "tts-error" });
  });

  it("wariant angielski materiału zmienia etykiety paska", async () => {
    h.player = playerStub({
      track: { ...track, lang: "en", title: "EU analysis" },
      status: "playing",
      duration: 600,
    });
    mount();
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Audio player" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Back 15 seconds" })).toBeInTheDocument();
  });

  /** Pasek montuje się leniwie (`mounted`), więc każdy test czeka na region. */
  async function mountReady() {
    const utils = mount();
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());
    return utils;
  }

  const shareButton = () => screen.getByRole("button", { name: "Udostępnij link do artykułu" });
  const linkDoWpisu = () => new URL(track.postHref, window.location.origin).toString();

  it("autor BEZ własnej strony jest tekstem, nie linkiem prowadzącym w pustkę", async () => {
    h.player = playerStub({
      track: { ...track, authorHref: null },
      status: "playing",
      duration: 600,
    });
    await mountReady();

    expect(screen.getByText(/Anna Nowak/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Anna Nowak" })).toBeNull();
  });

  it("etap syntezy BEZ wiarygodnego procentu nie pokazuje zera", async () => {
    // 0% przez pół minuty syntezy czyta się jako „zawieszone" - reguła
    // `ttsStagePercent` zwraca wtedy `null`, a pasek nie może tego zignorować.
    h.player = playerStub({ track, status: "loading", tts: { stage: "preparing", percent: 0 } });
    const { container } = await mountReady();

    expect(container.textContent).toContain("Przygotowuję tekst");
    expect(container.textContent).not.toContain("%");
  });

  it("udostępnianie BEZ Web Share API kopiuje link do artykułu (nie plik audio)", async () => {
    h.player = playerStub({ track, status: "playing", duration: 600 });
    const writeText = schowek();
    await mountReady();

    await act(async () => {
      shareButton().click();
    });

    expect(writeText).toHaveBeenCalledWith(linkDoWpisu());
    expect(h.toastSuccess).toHaveBeenCalledWith("Skopiowano link do artykułu");
  });

  it("Web Share API wygrywa nad schowkiem i dostaje tytuł oraz adres wpisu", async () => {
    h.player = playerStub({ track, status: "playing", duration: 600 });
    const writeText = schowek();
    const share = vi.fn().mockResolvedValue(undefined);
    podmien(navigator, "share", share);
    await mountReady();

    await act(async () => {
      shareButton().click();
    });

    expect(share).toHaveBeenCalledWith({ title: "Analiza o UE", url: linkDoWpisu() });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("ANULOWANIE udostępniania nie kopiuje linku po cichu", async () => {
    // Bez rozpoznania `AbortError` zamknięcie systemowego arkusza udostępniania
    // kończyło się cichym wpisem do schowka i toastem „skopiowano" - czyli
    // akcją, której czytelnik właśnie zrezygnował.
    h.player = playerStub({ track, status: "playing", duration: 600 });
    const writeText = schowek();
    podmien(
      navigator,
      "share",
      vi.fn().mockRejectedValue(new DOMException("anulowano", "AbortError")),
    );
    await mountReady();

    await act(async () => {
      shareButton().click();
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.promptDialog).not.toHaveBeenCalled();
  });

  it("AWARIA Web Share (nie anulowanie) spada do schowka", async () => {
    h.player = playerStub({ track, status: "playing", duration: 600 });
    const writeText = schowek();
    podmien(navigator, "share", vi.fn().mockRejectedValue(new Error("brak uprawnień")));
    await mountReady();

    await act(async () => {
      shareButton().click();
    });

    expect(writeText).toHaveBeenCalledWith(linkDoWpisu());
    expect(h.toastSuccess).toHaveBeenCalledWith("Skopiowano link do artykułu");
  });

  it("gdy i schowek odmówi, adres trafia do dialogu do ręcznego skopiowania", async () => {
    h.player = playerStub({ track, status: "playing", duration: 600 });
    schowek(vi.fn().mockRejectedValue(new Error("odmowa uprawnienia")));
    await mountReady();

    await act(async () => {
      shareButton().click();
    });

    expect(h.promptDialog).toHaveBeenCalledTimes(1);
    expect(h.promptDialog.mock.calls[0][0]).toMatchObject({ defaultValue: linkDoWpisu() });
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("POBIERANIE ogłasza trwanie, blokuje przycisk i wraca do stanu gotowego", async () => {
    const { promise, rozwiaz } = odroczona();
    const player = playerStub({ track, status: "playing", duration: 600 });
    player.download.mockReturnValue(promise);
    h.player = player;
    await mountReady();

    await act(async () => {
      screen.getByRole("button", { name: "Pobierz MP3" }).click();
    });

    const trwa = screen.getByRole("button", { name: "Pobieram audio…" });
    expect(trwa).toBeDisabled();
    expect(trwa.querySelector(".animate-spin")).not.toBeNull();

    await act(async () => {
      rozwiaz();
      await promise;
    });

    expect(screen.getByRole("button", { name: "Pobierz MP3" })).toBeEnabled();
  });

  it("nieudane pobranie mówi o tym czytelnikowi i ODBLOKOWUJE przycisk", async () => {
    const player = playerStub({ track, status: "playing", duration: 600 });
    player.download.mockRejectedValue(new Error("504"));
    h.player = player;
    await mountReady();

    await act(async () => {
      screen.getByRole("button", { name: "Pobierz MP3" }).click();
    });

    expect(h.toastError).toHaveBeenCalledWith("Nie udało się pobrać audio");
    expect(screen.getByRole("button", { name: "Pobierz MP3" })).toBeEnabled();
  });

  it("przewinięcie suwakiem zatwierdza pozycję po opuszczeniu fokusu", async () => {
    const player = playerStub({ track, status: "playing", duration: 600, currentTime: 30 });
    h.player = player;
    await mountReady();

    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "300" } });
    expect(player.seek).not.toHaveBeenCalled();

    fireEvent.blur(slider);
    expect(player.seek).toHaveBeenCalledWith(300);
  });

  it("opuszczenie suwaka BEZ przewijania nie przestawia pozycji", async () => {
    const player = playerStub({ track, status: "playing", duration: 600, currentTime: 30 });
    h.player = player;
    await mountReady();

    fireEvent.blur(screen.getByRole("slider"));
    expect(player.seek).not.toHaveBeenCalled();
  });

  it("błąd BEZ komunikatu od playera pokazuje zdanie w JĘZYKU MATERIAŁU", async () => {
    // Wcześniejsza wersja sklejała OBA języki w jeden komunikat, więc każdy
    // czytelnik dostawał połowę zdania w obcym języku.
    h.player = playerStub({ track: { ...track, lang: "en" }, status: "error", error: null });
    mount();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastError.mock.calls[0][0]).toBe("Could not generate audio");
    expect(h.toastError.mock.calls[0][1]).toMatchObject({ id: "tts-error" });
  });
});
