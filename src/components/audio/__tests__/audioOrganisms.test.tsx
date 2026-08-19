// Organizmy odtwarzacza: przycisk odsłuchu w treści, karta w sidebarze i dolny
// pasek. Wszystkie trzy stały na ZERZE pokrycia, mimo że są JEDYNĄ powierzchnią,
// przez którą czytelnik uruchamia PŁATNĄ syntezę mowy.
//
// Test wymienia WYŁĄCZNIE globalny player (jego własne reguły - pamięć pozycji,
// cache blobów, etapy TTS - mają osobne testy w `lib/audio`). Wszystko inne
// jedzie prawdziwą ścieżką: wybór etykiety regułą, atomy przycisków, kontrakty
// a11y, toast błędu.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { AudioStatus, TtsProgress } from "@/lib/audio/global-player";

const h = vi.hoisted(() => ({
  player: null as unknown,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: h.toastError, success: h.toastSuccess },
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

beforeEach(() => {
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
  h.player = playerStub();
});

afterEach(() => {
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
});
