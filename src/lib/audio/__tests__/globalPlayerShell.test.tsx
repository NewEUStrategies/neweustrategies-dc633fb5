// POWŁOKA globalnego odtwarzacza (`GlobalAudioPlayerProvider`) - leniwa
// granica wokół silnika, który do 2026-10-02 jechał w chunku wejściowym
// każdej strony.
//
// CZEGO TEN PLIK DOWODZI:
//   1. BOOT BEZ SILNIKA: montaż providera (i hydratacja HTML-a z serwera) nie
//      tworzy elementu `<audio>`, nie woła sieci i nie powoduje rozjazdu
//      hydratacji - identyczne poddrzewo po obu stronach;
//   2. KONTRAKT API: fasada, atrapa poza providerem i wartość silnika mają TEN
//      SAM zestaw kluczy - konsumenci (`ArticleListenButton`, `GlobalAudioBar`,
//      `SidebarListenCard`) nie widzą, kto za nimi stoi;
//   3. ZIMNE KLIKNIĘCIE: `loadAndPlay` przez fasadę natychmiast zgłasza
//      `loading` + etap `preparing` (ten sam stan, który silnik przyjmuje
//      przed pobraniem nagrania), dociąga silnik, a ten wykonuje
//      zakolejkowane polecenie - synteza rusza, nagranie gra;
//   4. AWARIA CHUNKU silnika kończy się stanem `error` fasady, a nie wyjątkiem
//      do globalnej granicy błędu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";

const h = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: null } })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: h.getSession } },
}));

import {
  GlobalAudioPlayerProvider,
  useGlobalAudioPlayer,
  type AudioTrackMeta,
} from "@/lib/audio/global-player";

type ShellModule = typeof import("@/lib/audio/global-player");

/** Minimalna atrapa elementu audio - liczy wyłącznie SAM FAKT utworzenia i `play()`. */
class FakeAudio extends EventTarget {
  static created = 0;
  preload = "";
  defaultPlaybackRate = 1;
  playbackRate = 1;
  currentTime = 0;
  duration = 0;
  paused = true;
  ended = false;
  playCalls = 0;
  private attrs = new Map<string, string>();
  constructor() {
    super();
    FakeAudio.created += 1;
  }
  get src(): string {
    return this.attrs.get("src") ?? "";
  }
  set src(value: string) {
    this.attrs.set("src", value);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  load(): void {}
  async play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  }
  pause(): void {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
}

const META: AudioTrackMeta = {
  postId: "p1",
  lang: "pl",
  title: "Analiza",
  postHref: "/wpis/analiza",
};

let api: ReturnType<typeof useGlobalAudioPlayer> | null = null;

/**
 * Sonda związana z KONKRETNĄ instancją modułu powłoki. Test awarii chunku
 * ładuje świeżą instancję (`vi.resetModules`), a kontekst Reacta jest
 * tożsamością obiektu - sonda ze starej instancji czytałaby atrapę „poza
 * providerem" zamiast fasady.
 */
function makeProbe(useHook: ShellModule["useGlobalAudioPlayer"]) {
  return function Probe() {
    const player = useHook();
    api = player;
    return (
      <div>
        <span data-testid="status">{player.status}</span>
        <span data-testid="active">{String(player.isActive("p1", "pl"))}</span>
        <span data-testid="error">{player.error ?? ""}</span>
        <span data-testid="stage">{player.tts.stage}</span>
      </div>
    );
  };
}

const Probe = makeProbe(useGlobalAudioPlayer);

let fetchMock: ReturnType<typeof vi.fn>;
let roots: Root[] = [];
// `URL` zostaje PRAWDZIWE (podmiana całej klasy psuje `new URL()` w samym
// mechanizmie dynamicznych importów vitesta, a ten plik je testuje) - tylko
// dwie metody blobów dostają atrapy, zdejmowane w `afterEach`.
const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  api = null;
  FakeAudio.created = 0;
  window.localStorage.clear();
  vi.stubGlobal("Audio", FakeAudio);
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  fetchMock = vi.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: null,
        blob: async () => new Blob(["a"], { type: "audio/mpeg" }),
        text: async () => "",
      }) as unknown as Response,
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount());
  roots = [];
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  URL.createObjectURL = realCreateObjectURL;
  URL.revokeObjectURL = realRevokeObjectURL;
});

function mountShell() {
  return render(
    <GlobalAudioPlayerProvider>
      <Probe />
    </GlobalAudioPlayerProvider>,
  );
}

describe("boot bez silnika", () => {
  it("SSR i hydratacja: identyczne poddrzewo, zero elementów audio, zero sieci", async () => {
    const tree = (
      <GlobalAudioPlayerProvider>
        <Probe />
      </GlobalAudioPlayerProvider>
    );
    const html = renderToString(tree);
    expect(html).toContain("idle");
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const recoverable = vi.fn();
    await act(async () => {
      roots.push(hydrateRoot(host, tree, { onRecoverableError: recoverable }));
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(FakeAudio.created).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="status"]')?.textContent).toBe("idle");
    host.remove();
  });

  it("montaż po stronie klienta też NIE dociąga silnika - dopiero interakcja", async () => {
    mountShell();
    await vi.dynamicImportSettled();
    expect(FakeAudio.created).toBe(0);
    expect(screen.getByTestId("status").textContent).toBe("idle");
  });
});

describe("kontrakt API", () => {
  it("fasada, atrapa poza providerem i silnik wystawiają ten sam zestaw kluczy", async () => {
    let outside: ReturnType<typeof useGlobalAudioPlayer> | undefined;
    const Orphan = () => {
      outside = useGlobalAudioPlayer();
      return null;
    };
    render(<Orphan />);
    mountShell();
    const facadeKeys = Object.keys(api!).sort();
    expect(facadeKeys).toEqual(Object.keys(outside!).sort());
    act(() => {
      void api!.loadAndPlay(META);
    });
    await vi.dynamicImportSettled();
    await waitFor(() => expect(FakeAudio.created).toBe(1));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(Object.keys(api!).sort()).toEqual(facadeKeys);
  });
});

describe("zimne kliknięcie", () => {
  it("fasada od razu zgłasza `loading` + `preparing`, silnik wykonuje zakolejkowane `loadAndPlay`", async () => {
    // ŚWIEŻA instancja modułu: `React.lazy` trzyma rozstrzygnięty moduł na
    // obiekcie z poziomu modułu, więc po poprzednim teście silnik montowałby
    // się synchronicznie i test nie mierzyłby zimnego startu.
    vi.resetModules();
    const fresh: ShellModule = await import("@/lib/audio/global-player");
    const FreshProbe = makeProbe(fresh.useGlobalAudioPlayer);
    render(
      <fresh.GlobalAudioPlayerProvider>
        <FreshProbe />
      </fresh.GlobalAudioPlayerProvider>,
    );
    expect(screen.getByTestId("active").textContent).toBe("false");
    act(() => {
      void api!.loadAndPlay(META);
    });
    // Natychmiast, PRZED załadowaniem chunku silnika - i w tym samym kształcie,
    // w jakim silnik sam zaczyna `loadAndPlay` (status, etap, brak nagrania).
    expect(screen.getByTestId("status").textContent).toBe("loading");
    expect(screen.getByTestId("active").textContent).toBe("false");
    expect(screen.getByTestId("stage").textContent).toBe("preparing");
    expect(FakeAudio.created).toBe(0);

    await vi.dynamicImportSettled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("playing"));
    expect(FakeAudio.created).toBe(1);
    expect(screen.getByTestId("active").textContent).toBe("true");
    // Pierwsza synteza - ten sam endpoint i payload co zawsze.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/public/post-tts");
    expect(JSON.parse(String(init.body))).toEqual({ postId: "p1", lang: "pl" });
  });

  it("`toggle` i `close` na fasadzie NIE budzą silnika - nie mają po co", async () => {
    mountShell();
    act(() => {
      void api!.toggle();
    });
    act(() => api!.close());
    await vi.dynamicImportSettled();
    expect(FakeAudio.created).toBe(0);
    expect(screen.getByTestId("status").textContent).toBe("idle");
  });
});

describe("awaria chunku silnika", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/audio/global-player-engine");
    vi.resetModules();
  });

  it("kończy się stanem `error` fasady, nie wyjątkiem do globalnej granicy", async () => {
    vi.resetModules();
    vi.doMock("@/lib/audio/global-player-engine", () => {
      throw new Error("ChunkLoadError: sieć leży");
    });
    const fresh: ShellModule = await import("@/lib/audio/global-player");
    const FreshProbe = makeProbe(fresh.useGlobalAudioPlayer);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <fresh.GlobalAudioPlayerProvider>
        <FreshProbe />
      </fresh.GlobalAudioPlayerProvider>,
    );
    act(() => {
      void api!.loadAndPlay(META);
    });
    await vi.dynamicImportSettled();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
    expect(screen.getByTestId("error").textContent).not.toBe("");
    expect(screen.getByTestId("active").textContent).toBe("false");
    // Strona pod providerem żyje dalej - sonda nadal jest w dokumencie.
    expect(screen.getByTestId("stage").textContent).toBe("idle");
    quiet.mockRestore();
  });
});
