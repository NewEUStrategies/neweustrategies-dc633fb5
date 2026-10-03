// Atom `PodcastPlayer` - ZACHOWANIE: transport, arbitraż odtwarzaczy, tempo,
// wyciszenie, Media Session i odporność pamięci pozycji.
//
// DLACZEGO OSOBNY PLIK. `PodcastPlayer.test.tsx` jest o dostępności i świadomie
// nie dubluje zachowań (patrz jego nagłówek). Te zachowania stały jednak bez
// żadnego wykonania: 32 z 148 linii atomu, w tym CAŁE Media Session API
// (klawisze multimedialne i ekran blokady na telefonie), arbitraż szyny
// odtwarzania i ścieżki awarii `localStorage` (tryb prywatny Safari rzuca
// przy KAŻDYM zapisie).
//
// KONTRAKTY:
//   1. Dwa odtwarzacze na stronie nie grają naraz - start jednego pauzuje
//      drugi (szyna `playbackBus`), a ten, który wystartował, gra dalej.
//   2. Klawisze multimedialne robią to, co przyciski: odtwarzaj, pauza,
//      ±15 s z przycięciem do [0, długość], skok do wskazanej sekundy.
//   3. Awaria magazynu przeglądarki NIE wywraca odtwarzacza - pozycja się po
//      prostu nie pamięta.
//   4. Pozycja jest zapisywana w trakcie grania z ograniczeniem częstotliwości
//      (nie na każde `timeupdate`), a pozycja „prawie na końcu" nie wraca.
//
// ŚRODOWISKO. happy-dom nie ma `HTMLMediaElement.play()`, `navigator.mediaSession`
// ani `MediaMetadata` - test podstawia minimalne atrapy, wierne w tym, na
// czym stoją asercje (zapisane metadane i procedury akcji).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import "@/test/i18nReal";
import { PodcastPlayer } from "@/components/atoms/PodcastPlayer";

const SRC = "https://audio.example.org/odcinek.mp3";

type Handler = (details: { seekTime?: number }) => void;

interface FakeMediaSession {
  metadata: unknown;
  playbackState: string;
  handlers: Map<string, Handler | null>;
  setActionHandler: (action: string, handler: Handler | null) => void;
}

function audioOf(container: HTMLElement): HTMLMediaElement {
  const audio = container.querySelector("audio");
  if (!(audio instanceof HTMLMediaElement)) throw new Error("test: brak <audio>");
  return audio;
}

/** Podstawia stan elementu `<audio>`, którego happy-dom nie symuluje. */
function setMediaState(audio: HTMLMediaElement, state: { paused?: boolean; duration?: number }) {
  if (state.paused !== undefined) {
    Object.defineProperty(audio, "paused", { configurable: true, get: () => state.paused });
  }
  if (state.duration !== undefined) {
    Object.defineProperty(audio, "duration", { configurable: true, get: () => state.duration });
  }
}

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as never);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaSession");
});

describe("PodcastPlayer - transport", () => {
  it("przycisk woła play() na pauzie i pause() w trakcie grania", () => {
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={600} />);
    const audio = audioOf(container);

    fireEvent.click(screen.getByRole("button", { name: "Odtwórz" }));
    expect(play).toHaveBeenCalledTimes(1);

    setMediaState(audio, { paused: false });
    fireEvent.click(screen.getByRole("button", { name: "Odtwórz" }));
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("przewinięcie wstecz nie schodzi poniżej zera, do przodu - nie poza koniec", () => {
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={600} />);
    const audio = audioOf(container);
    setMediaState(audio, { duration: 20 });
    audio.currentTime = 10;

    fireEvent.click(screen.getByRole("button", { name: "Cofnij o 15 sekund" }));
    expect(audio.currentTime).toBe(0);

    audio.currentTime = 10;
    fireEvent.click(screen.getByRole("button", { name: "Przewiń o 15 sekund" }));
    expect(audio.currentTime).toBe(20);
  });

  it("tempo idzie do elementu `<audio>` i jest pamiętane dla następnego odtwarzacza", () => {
    const { container, unmount } = render(<PodcastPlayer src={SRC} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1.5" } });
    expect(audioOf(container).playbackRate).toBe(1.5);
    unmount();

    render(<PodcastPlayer src={SRC} />);
    expect(screen.getByRole("combobox")).toHaveProperty("value", "1.5");
  });

  it("wyciszenie przestawia `muted` elementu w obie strony", () => {
    const { container } = render(<PodcastPlayer src={SRC} />);
    const audio = audioOf(container);
    fireEvent.click(screen.getByRole("button", { name: "Wycisz" }));
    expect(audio.muted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Włącz dźwięk" }));
    expect(audio.muted).toBe(false);
  });
});

describe("PodcastPlayer - arbitraż: dwa odtwarzacze nie grają naraz", () => {
  it("start jednego pauzuje drugi, a sam gra dalej", () => {
    const { container } = render(
      <>
        <PodcastPlayer src={SRC} title="Pierwszy" />
        <PodcastPlayer src="https://audio.example.org/drugi.mp3" title="Drugi" />
      </>,
    );
    const [first, second] = Array.from(container.querySelectorAll("audio"));
    if (!first || !second) throw new Error("test: brak dwóch odtwarzaczy");

    fireEvent(first, new Event("play"));

    // `pause` jest atrapą na prototypie, więc o tym, KTÓRY element zapauzowano,
    // mówi kontekst wywołania (`this`), a nie osobny szpieg na instancji.
    expect(pause.mock.contexts).toEqual([second]);
  });

  it("odtwarzacz, który już gra przy montażu (autoplay), przejmuje szynę od razu", () => {
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(false);
    render(<PodcastPlayer src={SRC} title="Autoplay" />);
    expect(screen.getByRole("button", { name: "Pauza" })).toBeTruthy();
  });
});

describe("PodcastPlayer - Media Session (klawisze multimedialne, ekran blokady)", () => {
  function installMediaSession(opts: { metadataThrows?: boolean; handlerThrows?: string } = {}) {
    const session: FakeMediaSession = {
      metadata: null,
      playbackState: "none",
      handlers: new Map(),
      setActionHandler(action, handler) {
        if (action === opts.handlerThrows) throw new Error("unsupported action");
        session.handlers.set(action, handler);
      },
    };
    Object.defineProperty(navigator, "mediaSession", { configurable: true, value: session });
    vi.stubGlobal(
      "MediaMetadata",
      class {
        constructor(public init: Record<string, unknown>) {
          if (opts.metadataThrows) throw new Error("no MediaMetadata");
        }
      },
    );
    return session;
  }

  function call(session: FakeMediaSession, action: string, details: { seekTime?: number } = {}) {
    const handler = session.handlers.get(action);
    if (!handler) throw new Error(`test: brak procedury ${action}`);
    act(() => handler(details));
  }

  it("przy starcie wystawia metadane z okładką i stan „gra”, przy pauzie - „pauza”", () => {
    const session = installMediaSession();
    const { container } = render(
      <PodcastPlayer src={SRC} title="Odcinek 7" coverUrl="https://cdn.example.com/c.jpg" />,
    );
    expect(session.playbackState).toBe("paused");

    fireEvent(audioOf(container), new Event("play"));
    expect(session.playbackState).toBe("playing");
    expect(session.metadata).toMatchObject({
      init: {
        title: "Odcinek 7",
        artwork: [{ src: "https://cdn.example.com/c.jpg", sizes: "512x512", type: "image/jpeg" }],
      },
    });

    fireEvent(audioOf(container), new Event("pause"));
    expect(session.playbackState).toBe("paused");
  });

  it("bez tytułu i okładki metadane mają tytuł zastępczy i brak grafiki", () => {
    const session = installMediaSession();
    const { container } = render(<PodcastPlayer src={SRC} />);
    fireEvent(audioOf(container), new Event("play"));
    expect(session.metadata).toEqual({ init: { title: "Podcast" } });
  });

  it("klawisze robią to, co przyciski: odtwórz, pauza, ±15 s z przycięciem, skok", () => {
    const session = installMediaSession();
    const { container } = render(<PodcastPlayer src={SRC} title="Odcinek" />);
    const audio = audioOf(container);
    setMediaState(audio, { duration: 100 });
    fireEvent(audio, new Event("play"));

    call(session, "play");
    expect(play).toHaveBeenCalled();
    call(session, "pause");
    expect(pause).toHaveBeenCalled();

    audio.currentTime = 10;
    call(session, "seekbackward");
    expect(audio.currentTime).toBe(0);

    audio.currentTime = 90;
    call(session, "seekforward");
    expect(audio.currentTime).toBe(100);

    call(session, "seekto", { seekTime: 42 });
    expect(audio.currentTime).toBe(42);
    // Skok bez wskazanej sekundy niczego nie przestawia.
    call(session, "seekto", {});
    expect(audio.currentTime).toBe(42);
  });

  it("przeglądarka bez `MediaMetadata` i bez części akcji nie wywraca odtwarzacza", () => {
    const session = installMediaSession({ metadataThrows: true, handlerThrows: "seekto" });
    const { container } = render(<PodcastPlayer src={SRC} title="Odcinek" />);
    fireEvent(audioOf(container), new Event("play"));
    expect(session.playbackState).toBe("playing");
    expect(session.metadata).toBeNull();
    expect(session.handlers.has("seekto")).toBe(false);
    expect(session.handlers.has("play")).toBe(true);
  });
});

describe("PodcastPlayer - pamięć pozycji: częstotliwość i odporność", () => {
  it("granie zapisuje pozycję, ale nie częściej niż co kilka sekund", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={1800} />);
    const audio = audioOf(container);

    audio.currentTime = 120;
    fireEvent(audio, new Event("timeupdate"));
    expect(window.localStorage.getItem(`audio-pos:${SRC}`)).toBe("120");

    now.mockReturnValue(1_002_000);
    audio.currentTime = 122;
    fireEvent(audio, new Event("timeupdate"));
    expect(window.localStorage.getItem(`audio-pos:${SRC}`)).toBe("120");

    now.mockReturnValue(1_006_000);
    audio.currentTime = 126;
    fireEvent(audio, new Event("timeupdate"));
    expect(window.localStorage.getItem(`audio-pos:${SRC}`)).toBe("126");
  });

  it("pozycja „prawie na końcu” nie wraca - odcinek nie startuje od napisów końcowych", () => {
    window.localStorage.setItem(`audio-pos:${SRC}`, "598");
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={600} />);
    const audio = audioOf(container);
    setMediaState(audio, { duration: 600 });
    fireEvent(audio, new Event("loadedmetadata"));
    expect(screen.getByRole("timer").textContent).toBe("0:00");
  });

  it("metadane dostępne JUŻ przy montażu (cache) - pozycja wraca bez czekania na zdarzenie", () => {
    window.localStorage.setItem(`audio-pos:${SRC}`, "300");
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(1);
    render(<PodcastPlayer src={SRC} initialDuration={1800} />);
    expect(screen.getByRole("timer").textContent).toBe("5:00");
  });

  it("źródło odrzucające przewinięcie nie wywraca przywracania", () => {
    window.localStorage.setItem(`audio-pos:${SRC}`, "300");
    vi.spyOn(HTMLMediaElement.prototype, "currentTime", "set").mockImplementation(() => {
      throw new Error("not seekable");
    });
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={1800} />);
    expect(() => fireEvent(audioOf(container), new Event("loadedmetadata"))).not.toThrow();
    expect(screen.getByRole("timer").textContent).toBe("0:00");
  });

  it("magazyn rzucający przy KAŻDYM dostępie (tryb prywatny) nie wywraca odtwarzacza", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={1800} />);
    const audio = audioOf(container);

    fireEvent(audio, new Event("loadedmetadata"));
    audio.currentTime = 400;
    fireEvent(audio, new Event("timeupdate"));
    fireEvent(audio, new Event("pause"));
    fireEvent(audio, new Event("ended"));

    expect(screen.getByRole("button", { name: "Odtwórz" })).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toBe("6:40");
  });

  it("nieliczbowy wpis w magazynie to brak pozycji, nie `NaN`", () => {
    window.localStorage.setItem(`audio-pos:${SRC}`, "abc");
    const { container } = render(<PodcastPlayer src={SRC} initialDuration={1800} />);
    fireEvent(audioOf(container), new Event("loadedmetadata"));
    expect(screen.getByRole("timer").textContent).toBe("0:00");
  });
});
