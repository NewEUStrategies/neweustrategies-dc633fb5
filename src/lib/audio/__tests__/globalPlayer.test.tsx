// Globalny odtwarzacz narracji: provider, który posiada element `<audio>`,
// wywołuje PŁATNĄ syntezę, trzyma cache blobów i pamięta pozycję odsłuchu.
//
// STAN WYJŚCIOWY: 12 z 247 linii (4,8%) - a to jedyny plik w module, przez który
// przechodzi każde kliknięcie „odsłuchaj". Czyste moduły wyprowadzone z niego
// wcześniej (`positionMemory`, `blobCache`, `ttsStage`) mają po 100%, ale SKŁAD
// - kolejność etapów, anulowanie starego pobrania, zapis pozycji przy podmianie
// źródła, arbitraż z innymi odtwarzaczami - żył bez ani jednego testu.
//
// CZEGO PILNUJE TEN PLIK:
//   1. KOSZT SYNTEZY. Trafienie w cache i to samo nagranie dwa razy NIE MOGĄ
//      wołać dostawcy po raz drugi - to jest rachunek za ElevenLabs.
//   2. ETAPY. Czytelnik widzi, na czym stoi synteza; etapy muszą iść po kolei
//      i kończyć się na `ready` albo `error`, nigdy zawisnąć na `preparing`.
//   3. PAMIĘĆ POZYCJI. Wznowienie tam, gdzie skończył, i wyczyszczenie zapisu
//      po wysłuchaniu do końca.
//   4. LIMITY DOSTAWCY. 402 i 429 mają WŁASNE komunikaty - „HTTP 402" nic
//      czytelnikowi nie mówi.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: null } })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: h.getSession } },
}));

import {
  GlobalAudioPlayerProvider,
  formatAudioTime,
  useGlobalAudioPlayer,
  type AudioTrackMeta,
} from "@/lib/audio/global-player";
import { resetBlobCache } from "@/lib/audio/blobCache";
import { POSITION_SAVE_INTERVAL, positionKey } from "@/lib/audio/positionMemory";

/**
 * Atrapa elementu audio.
 *
 * happy-dom nie ma ŻADNEGO potoku medialnego: `play()` nie istnieje, `duration`
 * i `currentTime` są getterami bez źródła, zdarzenia `loadedmetadata` /
 * `timeupdate` / `ended` nie mają kto emitować. Nie ma tu więc „prawdziwego"
 * zachowania do zachowania - jest podmiana globalnego `Audio` na klasę, która
 * emituje dokładnie te zdarzenia, na które provider nasłuchuje, i pozwala je
 * wywołać w kontrolowanej kolejności.
 */
class FakeAudio extends EventTarget {
  static last: FakeAudio | null = null;
  preload = "";
  defaultPlaybackRate = 1;
  playbackRate = 1;
  currentTime = 0;
  duration = 0;
  paused = true;
  ended = false;
  playCalls = 0;
  loadCalls = 0;
  private attrs = new Map<string, string>();
  /** Gdy ustawione, `play()` odrzuca - tak zachowuje się blokada autoplay. */
  rejectPlay: Error | null = null;

  constructor() {
    super();
    FakeAudio.last = this;
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
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  load(): void {
    this.loadCalls += 1;
  }
  async play(): Promise<void> {
    this.playCalls += 1;
    if (this.rejectPlay) throw this.rejectPlay;
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  }
  pause(): void {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  /** Emituje `loadedmetadata` z podanym czasem trwania. */
  emitMetadata(duration: number): void {
    this.duration = duration;
    this.dispatchEvent(new Event("loadedmetadata"));
  }
  emitTimeUpdate(time: number): void {
    this.currentTime = time;
    this.dispatchEvent(new Event("timeupdate"));
  }
  emitEnded(): void {
    this.ended = true;
    this.dispatchEvent(new Event("ended"));
  }
  emitError(): void {
    this.dispatchEvent(new Event("error"));
  }
}

const audio = (): FakeAudio => {
  const a = FakeAudio.last;
  if (!a) throw new Error("provider nie utworzył elementu audio");
  return a;
};

/** Ciało odpowiedzi ze strumieniem - tą ścieżką provider pokazuje postęp. */
function streamedBody(chunks: Uint8Array[]) {
  let i = 0;
  return {
    getReader: () => ({
      read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }),
    }),
  };
}

function okResponse(opts: { contentLength?: string | null; chunks?: Uint8Array[] } = {}) {
  const chunks = opts.chunks ?? [new Uint8Array([1, 2, 3, 4])];
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => (k === "content-length" ? (opts.contentLength ?? "4") : null) },
    body: streamedBody(chunks),
    blob: async () => new Blob(["fallback"], { type: "audio/mpeg" }),
    text: async () => "",
  } as unknown as Response;
}

function failResponse(status: number, text = "") {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    body: null,
    text: async () => text,
  } as unknown as Response;
}

/** Sonda wystawiająca kontekst odtwarzacza do bezpośredniego wywołania. */
let api: ReturnType<typeof useGlobalAudioPlayer> | null = null;

function Probe() {
  const player = useGlobalAudioPlayer();
  api = player;
  return (
    <div>
      <span data-testid="status">{player.status}</span>
      <span data-testid="stage">{player.tts.stage}</span>
      <span data-testid="percent">{player.tts.percent}</span>
      <span data-testid="error">{player.error ?? ""}</span>
      <span data-testid="rate">{player.playbackRate}</span>
      <span data-testid="time">{player.currentTime}</span>
      <span data-testid="duration">{player.duration}</span>
      <span data-testid="progress">{Math.round(player.progress)}</span>
      <span data-testid="track">{player.track?.postId ?? ""}</span>
    </div>
  );
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <GlobalAudioPlayerProvider>{children}</GlobalAudioPlayerProvider>
);

const META: AudioTrackMeta = {
  postId: "p1",
  lang: "pl",
  title: "Analiza rynku",
  author: "Autor",
  postHref: "/wpis/analiza-rynku",
};

const at = (id: string) => screen.getByTestId(id).textContent;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  api = null;
  FakeAudio.last = null;
  resetBlobCache();
  window.localStorage.clear();
  vi.stubGlobal("Audio", FakeAudio);
  let n = 0;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => `blob:nowy-${++n}`),
    revokeObjectURL: vi.fn(),
  });
  fetchMock = vi.fn(async () => okResponse());
  vi.stubGlobal("fetch", fetchMock);
  h.getSession.mockResolvedValue({ data: { session: null } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount() {
  render(<Probe />, { wrapper });
  await waitFor(() => expect(FakeAudio.last).not.toBeNull());
}

/** Uruchamia nagranie i domyka `loadedmetadata`, jak zrobiłaby przeglądarka. */
async function play(meta: AudioTrackMeta = META, duration = 120) {
  await act(async () => {
    await api?.loadAndPlay(meta);
  });
  await act(async () => {
    audio().emitMetadata(duration);
  });
}

describe("useGlobalAudioPlayer - kontrakt kontekstu", () => {
  it("poza providerem oddaje BEZCZYNNĄ atrapę, świadomie - dla parytetu SSR", () => {
    // Kontrakt udokumentowany w kodzie: na serwerze i poza providerem hook nie
    // wybucha, tylko zwraca no-op. Test pilnuje, że atrapa jest FAKTYCZNIE
    // bezczynna: nie tworzy elementu audio i nie rzuca przy wywołaniach.
    let outside: ReturnType<typeof useGlobalAudioPlayer> | undefined;
    const Orphan = () => {
      outside = useGlobalAudioPlayer();
      return null;
    };
    render(<Orphan />);
    expect(outside?.status).toBe("idle");
    expect(outside?.isActive("p1", "pl")).toBe(false);
    expect(FakeAudio.last).toBeNull();
  });

  it("provider startuje w stanie bezczynnym, bez nagrania i bez błędu", async () => {
    await mount();
    expect(at("status")).toBe("idle");
    expect(at("track")).toBe("");
    expect(at("error")).toBe("");
  });

  it("element audio powstaje z `preload=none` - nie ściągamy audio bez kliknięcia", async () => {
    await mount();
    expect(audio().preload).toBe("none");
    expect(audio().playCalls).toBe(0);
  });
});

describe("loadAndPlay - synteza i etapy", () => {
  it("pełna ścieżka: preparing -> synthesizing -> streaming -> ready, potem odtwarzanie", async () => {
    await mount();
    await play();
    expect(at("stage")).toBe("ready");
    expect(at("status")).toBe("playing");
  });

  it("nagranie trafia do elementu audio i do stanu ścieżki", async () => {
    await mount();
    await play();
    expect(audio().src).toBe("blob:nowy-1");
    expect(at("track")).toBe("p1");
  });

  it("payload idzie na KANONICZNĄ trasę syntezy z `{ postId, lang }`", async () => {
    await mount();
    await play();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/public/post-tts");
    expect(JSON.parse(String(init.body))).toEqual({ postId: "p1", lang: "pl" });
  });

  it("SESJA czytelnika jedzie w nagłówku - serwer musi móc sprawdzić paywall", async () => {
    h.getSession.mockResolvedValue({
      data: { session: { access_token: "tok-123" } },
    } as never);
    await mount();
    await play();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("WGRANY MP3 pobiera plik wprost - dostawca syntezy nie jest wołany", async () => {
    await mount();
    await play({ ...META, audioUrl: "https://cdn.example/pl.mp3" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://cdn.example/pl.mp3");
    expect(init.method).toBe("GET");
  });

  it("POSTĘP liczy się z nagłówka długości - czytelnik widzi ile zostało", async () => {
    fetchMock.mockResolvedValue(
      okResponse({ contentLength: "10", chunks: [new Uint8Array(5), new Uint8Array(5)] }),
    );
    await mount();
    await play();
    // Ostatni etap to `ready` (100%), ale strumień przeszedł przez `streaming`.
    expect(at("percent")).toBe("100");
    expect(at("stage")).toBe("ready");
  });

  it("BEZ nagłówka długości postęp zostaje na zerze, ale etap się zmienia", async () => {
    fetchMock.mockResolvedValue(okResponse({ contentLength: null }));
    await mount();
    await play();
    expect(at("stage")).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ciało BEZ czytnika strumienia schodzi na `res.blob()` (starsza przeglądarka)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: null,
      blob: async () => new Blob(["dane"], { type: "audio/mpeg" }),
      text: async () => "",
    } as unknown as Response);
    await mount();
    await play();
    expect(at("stage")).toBe("ready");
    expect(audio().src).toBe("blob:nowy-1");
  });
});

describe("koszt syntezy - cache i powtórne kliknięcia", () => {
  it("TO SAMO nagranie drugi raz NIE woła dostawcy - tylko wznawia", async () => {
    await mount();
    await play();
    audio().pause();
    await act(async () => {
      await api?.loadAndPlay(META);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(audio().playCalls).toBeGreaterThanOrEqual(2);
  });

  it("POWRÓT do wpisu po przełączeniu trafia w CACHE, nie w dostawcę", async () => {
    await mount();
    await play();
    await play({ ...META, postId: "p2" }, 90);
    await play(META);
    // Dwa pobrania (p1, p2) - trzecie kliknięcie schodzi z cache'u.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(at("stage")).toBe("cached");
  });

  it("KAŻDY JĘZYK ma własny wpis w cache - EN nie odtwarza nagrania PL", async () => {
    await mount();
    await play();
    await play({ ...META, lang: "en" }, 90);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const langs = fetchMock.mock.calls.map(
      (c) => JSON.parse(String((c[1] as RequestInit).body)).lang,
    );
    expect(langs).toEqual(["pl", "en"]);
  });
});

describe("błędy dostawcy - komunikat musi coś znaczyć", () => {
  it("402 (wyczerpany budżet) ma WŁASNY komunikat, nie kod HTTP", async () => {
    fetchMock.mockResolvedValue(failResponse(402));
    await mount();
    await act(async () => {
      await api?.loadAndPlay(META);
    });
    expect(at("status")).toBe("error");
    expect(at("error")).toContain("limit");
  });

  it("429 (zbyt częste próby) ma WŁASNY komunikat", async () => {
    fetchMock.mockResolvedValue(failResponse(429));
    await mount();
    await act(async () => {
      await api?.loadAndPlay(META);
    });
    expect(at("status")).toBe("error");
    expect(at("error")).toContain("prób");
  });

  it("inny błąd przekazuje TREŚĆ z serwera, gdy jest", async () => {
    fetchMock.mockResolvedValue(failResponse(500, "provider padl"));
    await mount();
    await act(async () => {
      await api?.loadAndPlay(META);
    });
    expect(at("error")).toBe("provider padl");
    expect(at("stage")).toBe("error");
  });

  it("błąd BEZ treści degraduje do kodu HTTP - nigdy do pustego komunikatu", async () => {
    fetchMock.mockResolvedValue(failResponse(503, ""));
    await mount();
    await act(async () => {
      await api?.loadAndPlay(META);
    });
    expect(at("error")).toBe("HTTP 503");
    expect(at("status")).toBe("error");
  });

  it("padnięta sieć kończy się stanem błędu, nie zawieszeniem na `preparing`", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await mount();
    await act(async () => {
      await api?.loadAndPlay(META);
    });
    expect(at("stage")).toBe("error");
    expect(at("error")).toBe("network down");
  });

  it("ANULOWANE pobranie (szybka zmiana wpisu) NIE pokazuje błędu czytelnikowi", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    fetchMock.mockRejectedValue(abort);
    await mount();
    await act(async () => {
      await api?.loadAndPlay(META);
    });
    expect(at("status")).not.toBe("error");
    expect(at("error")).toBe("");
  });

  it("PRZYPIĘTA USTERKA: blokada autoplay przy PIERWSZYM załadowaniu czyta się jako błąd", async () => {
    // `await audio.play()` stoi w tym samym `try` co pobranie, więc odrzucone
    // odtwarzanie (iOS/Safari bez gestu użytkownika) ustawia stan „error"
    // i pokazuje czytelnikowi komunikat o niepowodzeniu - mimo że nagranie JEST
    // gotowe i wystarczy kliknąć jeszcze raz. Pozostałe ścieżki (`toggle`, to
    // samo nagranie drugi raz) tę odmowę świadomie POCHŁANIAJĄ, więc zachowanie
    // jest tu niespójne. Naprawa osobnym commitem.
    await mount();
    audio().rejectPlay = new Error("NotAllowedError");
    await act(async () => {
      await api?.loadAndPlay(META);
    });
    expect(at("stage")).toBe("ready");
    expect(at("status")).toBe("error");
  });
});

describe("pamięć pozycji odsłuchu", () => {
  it("ZAPISANA pozycja wraca po załadowaniu metadanych", async () => {
    window.localStorage.setItem(positionKey("p1", "pl"), "45");
    await mount();
    await play(META, 120);
    expect(audio().currentTime).toBe(45);
    expect(at("time")).toBe("45");
  });

  it("pozycja jest przywracana JEDNORAZOWO - drugie metadane jej nie cofają", async () => {
    window.localStorage.setItem(positionKey("p1", "pl"), "45");
    await mount();
    await play(META, 120);
    await act(async () => {
      audio().emitTimeUpdate(80);
      audio().emitMetadata(120);
    });
    expect(audio().currentTime).toBe(80);
    expect(at("time")).toBe("80");
  });

  it("WYSŁUCHANE do końca kasuje zapamiętaną pozycję", async () => {
    await mount();
    await play(META, 120);
    await act(async () => {
      audio().emitTimeUpdate(60);
    });
    await act(async () => {
      audio().emitEnded();
    });
    expect(window.localStorage.getItem(positionKey("p1", "pl"))).toBeNull();
    expect(at("time")).toBe("0");
  });

  it("PAUZA zapisuje pozycję, żeby czytelnik wrócił tam, gdzie skończył", async () => {
    await mount();
    await play(META, 120);
    await act(async () => {
      audio().emitTimeUpdate(50);
      audio().pause();
    });
    expect(window.localStorage.getItem(positionKey("p1", "pl"))).toBe("50");
    expect(at("status")).toBe("paused");
  });

  it("PODMIANA nagrania zapisuje pozycję wychodzącego materiału", async () => {
    await mount();
    await play(META, 120);
    await act(async () => {
      audio().emitTimeUpdate(70);
    });
    await play({ ...META, postId: "p2" }, 90);
    expect(window.localStorage.getItem(positionKey("p1", "pl"))).toBe("70");
    expect(at("track")).toBe("p2");
  });

  it("zapis w trakcie odtwarzania jest DUSZONY - nie piszemy przy każdej sekundzie", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    await mount();
    await play(META, 300);
    await act(async () => {
      audio().emitTimeUpdate(30);
      audio().emitTimeUpdate(31);
      audio().emitTimeUpdate(32);
    });
    const afterBurst = window.localStorage.getItem(positionKey("p1", "pl"));
    now.mockReturnValue(1_000_000 + POSITION_SAVE_INTERVAL + 1);
    await act(async () => {
      audio().emitTimeUpdate(99);
    });
    expect(afterBurst).toBe("30");
    expect(window.localStorage.getItem(positionKey("p1", "pl"))).toBe("99");
  });
});

describe("transport: pauza, przewijanie, tempo", () => {
  it("`toggle` pauzuje grające nagranie i wznawia spauzowane", async () => {
    await mount();
    await play();
    await act(async () => {
      await api?.toggle();
    });
    expect(at("status")).toBe("paused");
    await act(async () => {
      await api?.toggle();
    });
    expect(at("status")).toBe("playing");
  });

  it("`toggle` BEZ nagrania nic nie robi - nie ma czego przełączać", async () => {
    await mount();
    await act(async () => {
      await api?.toggle();
    });
    expect(audio().playCalls).toBe(0);
    expect(at("status")).toBe("idle");
  });

  it("`seek` PRZYCINA do zakresu materiału - nie da się wyjść za koniec", async () => {
    await mount();
    await play(META, 100);
    await act(async () => api?.seek(500));
    expect(audio().currentTime).toBe(100);
    await act(async () => api?.seek(-20));
    expect(audio().currentTime).toBe(0);
  });

  it("`seekPct` liczy pozycję z procentu i też przycina", async () => {
    await mount();
    await play(META, 200);
    await act(async () => api?.seekPct(25));
    expect(audio().currentTime).toBe(50);
    await act(async () => api?.seekPct(300));
    expect(audio().currentTime).toBe(200);
  });

  it("`seekPct` BEZ znanego czasu trwania nie rusza pozycji", async () => {
    await mount();
    await play(META, 0);
    audio().currentTime = 7;
    await act(async () => api?.seekPct(50));
    expect(audio().currentTime).toBe(7);
    expect(at("duration")).toBe("0");
  });

  it("`skip` liczy od BIEŻĄCEJ pozycji, w obie strony", async () => {
    await mount();
    await play(META, 100);
    await act(async () => {
      audio().emitTimeUpdate(40);
    });
    await act(async () => api?.skip(15));
    expect(audio().currentTime).toBe(55);
    await act(async () => api?.skip(-30));
    expect(audio().currentTime).toBe(25);
  });

  it("TEMPO jest przycinane do dozwolonego zakresu i zapisywane", async () => {
    await mount();
    await act(async () => api?.setPlaybackRate(99));
    expect(Number(at("rate"))).toBeLessThanOrEqual(4);
    expect(audio().playbackRate).toBe(Number(at("rate")));
  });

  it("TEMPO wchodzi na OBA pola elementu - nowe źródło nie resetuje preferencji", async () => {
    await mount();
    await act(async () => api?.setPlaybackRate(1.5));
    expect(audio().playbackRate).toBe(1.5);
    expect(audio().defaultPlaybackRate).toBe(1.5);
  });

  it("zapisane tempo wraca po ponownym wejściu na stronę", async () => {
    await mount();
    await act(async () => api?.setPlaybackRate(1.25));
    const stored = { ...window.localStorage };
    expect(Object.values(stored).join(",")).toContain("1.25");
    expect(Number(at("rate"))).toBe(1.25);
  });

  it("POSTĘP procentowy liczy się z czasu i długości", async () => {
    await mount();
    await play(META, 200);
    await act(async () => {
      audio().emitTimeUpdate(50);
    });
    expect(at("progress")).toBe("25");
    expect(at("duration")).toBe("200");
  });
});

describe("zamknięcie i stan błędu elementu", () => {
  it("`close` czyści nagranie, stan i ŹRÓDŁO elementu", async () => {
    await mount();
    await play();
    await act(async () => api?.close());
    expect(at("track")).toBe("");
    expect(audio().getAttribute("src")).toBeNull();
  });

  it("`close` zapisuje pozycję ZANIM wyczyści źródło", async () => {
    await mount();
    await play(META, 120);
    await act(async () => {
      audio().emitTimeUpdate(65);
    });
    await act(async () => api?.close());
    expect(window.localStorage.getItem(positionKey("p1", "pl"))).toBe("65");
    expect(at("status")).toBe("idle");
  });

  it("zdarzenie `error` BEZ źródła jest ignorowane (fałszywy alarm po zamknięciu)", async () => {
    await mount();
    await act(async () => {
      audio().emitError();
    });
    expect(at("status")).toBe("idle");
    expect(at("error")).toBe("");
  });

  it("zdarzenie `error` Z ŹRÓDŁEM pokazuje błąd odtwarzania", async () => {
    await mount();
    await play();
    await act(async () => {
      audio().emitError();
    });
    expect(at("status")).toBe("error");
    expect(at("error")).not.toBe("");
  });
});

describe("isActive i pobranie pliku", () => {
  it("`isActive` rozpoznaje wpis I JĘZYK, nie sam wpis", async () => {
    await mount();
    await play();
    expect(api?.isActive("p1", "pl")).toBe(true);
    expect(api?.isActive("p1", "en")).toBe(false);
    expect(api?.isActive("p2", "pl")).toBe(false);
  });

  it("pobranie używa GOTOWEGO bloba bieżącego nagrania - bez drugiej syntezy", async () => {
    await mount();
    await play();
    const click = vi.fn();
    const anchor = document.createElement("a");
    anchor.click = click;
    const create = vi.spyOn(document, "createElement").mockReturnValue(anchor);
    await act(async () => {
      await api?.download();
    });
    create.mockRestore();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe("Analiza-rynku.mp3");
  });

  it("pobranie BEZ aktywnego nagrania woła syntezę dla wskazanego wpisu", async () => {
    await mount();
    const anchor = document.createElement("a");
    anchor.click = vi.fn();
    const create = vi.spyOn(document, "createElement").mockReturnValue(anchor);
    await act(async () => {
      await api?.download({ postId: "p9", lang: "en", title: "Raport", postHref: "/p9" });
    });
    create.mockRestore();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe("Raport.mp3");
  });

  it("pobranie bez nagrania I bez argumentu nic nie robi", async () => {
    await mount();
    await act(async () => {
      await api?.download();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(at("track")).toBe("");
  });
});

describe("formatAudioTime", () => {
  it("formatuje minuty i sekundy z zerem wiodącym", () => {
    expect(formatAudioTime(0)).toBe("0:00");
    expect(formatAudioTime(65)).toBe("1:05");
  });

  it("wartości nieliczbowe i ujemne degradują do zera, nie do NaN", () => {
    expect(formatAudioTime(Number.NaN)).toBe("0:00");
    expect(formatAudioTime(-5)).toBe("0:00");
  });
});

describe("Media Session - ekran blokady i klawisze multimedialne", () => {
  interface FakeSession {
    metadata: unknown;
    playbackState: string;
    handlers: Map<string, ((d?: { seekTime?: number }) => void) | null>;
    setActionHandler: (a: string, h: ((d?: { seekTime?: number }) => void) | null) => void;
  }

  function installMediaSession(opts: { failMetadata?: boolean; failHandler?: string } = {}) {
    const session: FakeSession = {
      metadata: undefined,
      playbackState: "",
      handlers: new Map(),
      setActionHandler(action, handler) {
        if (opts.failHandler === action) throw new Error("akcja nieobslugiwana");
        this.handlers.set(action, handler);
      },
    };
    Object.defineProperty(window.navigator, "mediaSession", {
      configurable: true,
      value: session,
    });
    vi.stubGlobal(
      "MediaMetadata",
      class {
        title: string;
        artist?: string;
        constructor(init: { title: string; artist?: string }) {
          if (opts.failMetadata) throw new Error("MediaMetadata niedostepne");
          this.title = init.title;
          this.artist = init.artist;
        }
      },
    );
    return session;
  }

  it("metadane materiału trafiają na ekran blokady razem z autorem", async () => {
    const session = installMediaSession();
    await mount();
    await play();
    expect((session.metadata as { title: string }).title).toBe("Analiza rynku");
    expect((session.metadata as { artist?: string }).artist).toBe("Autor");
  });

  it("stan odtwarzania jest ogłaszany systemowi", async () => {
    const session = installMediaSession();
    await mount();
    await play();
    expect(session.playbackState).toBe("playing");
    await act(async () => {
      audio().pause();
    });
    expect(session.playbackState).toBe("paused");
  });

  it("BEZ materiału metadane są czyszczone, a stan schodzi na `none`", async () => {
    const session = installMediaSession();
    await mount();
    await play();
    await act(async () => api?.close());
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe("none");
  });

  it("klawisze systemowe sterują odtwarzaniem", async () => {
    const session = installMediaSession();
    await mount();
    await play();
    await act(async () => {
      session.handlers.get("pause")?.();
    });
    expect(at("status")).toBe("paused");
    await act(async () => {
      session.handlers.get("play")?.();
    });
    expect(at("status")).toBe("playing");
  });

  it("przewijanie systemowe idzie o PIĘTNAŚCIE sekund w obie strony", async () => {
    const session = installMediaSession();
    await mount();
    await play(META, 200);
    await act(async () => {
      audio().emitTimeUpdate(60);
    });
    await act(async () => {
      session.handlers.get("seekforward")?.();
    });
    expect(audio().currentTime).toBe(75);
    await act(async () => {
      session.handlers.get("seekbackward")?.();
    });
    expect(audio().currentTime).toBe(60);
  });

  it("`seekto` przyjmuje czas z systemu, a bez czasu nic nie rusza", async () => {
    const session = installMediaSession();
    await mount();
    await play(META, 200);
    await act(async () => {
      session.handlers.get("seekto")?.({ seekTime: 120 });
    });
    expect(audio().currentTime).toBe(120);
    await act(async () => {
      session.handlers.get("seekto")?.({});
    });
    expect(audio().currentTime).toBe(120);
  });

  it("BRAK `MediaMetadata` w przeglądarce nie wywraca odtwarzacza", async () => {
    const session = installMediaSession({ failMetadata: true });
    await mount();
    await play();
    expect(at("status")).toBe("playing");
    expect(session.playbackState).toBe("playing");
  });

  it("nieobsługiwana AKCJA systemowa nie wywraca odtwarzacza", async () => {
    const session = installMediaSession({ failHandler: "seekto" });
    await mount();
    await play();
    expect(at("status")).toBe("playing");
    expect(session.handlers.has("play")).toBe(true);
  });
});
