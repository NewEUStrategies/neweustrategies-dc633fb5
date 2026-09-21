// Odtwarzacz lektora AI - przycisk, który wywołuje PŁATNĄ syntezę mowy.
//
// CO TU JEST PRZYPINANE I DLACZEGO. `TtsPlayer` jest cienki, ale każde jego
// kliknięcie kosztuje pieniądze u dostawcy i wymaga zalogowanej sesji. Pięć
// rzeczy potrafi tu pójść źle tak, że nikt tego nie zauważy w code review:
//
//   1. DRUGIE POBRANIE TEGO SAMEGO NAGRANIA. Po pierwszej syntezie przycisk
//      ma WYŁĄCZNIE pauzować i wznawiać istniejące audio. Gdyby wracał do
//      `/api/tts`, każda pauza byłaby nowym rachunkiem. Mierzymy LICZBĘ
//      wywołań `fetch`, bo tylko ona jest skutkiem.
//
//   2. TOKEN. `/api/tts` wymaga sesji Supabase, a przeglądarka nie dokłada
//      nagłówka sama. Brak tokenu musi kończyć się komunikatem, a nie
//      żądaniem bez autoryzacji - dlatego asercja jest i na komunikacie,
//      i na tym, że `fetch` NIE poszedł.
//
//   3. TREŚĆ BŁĘDU SERWERA NIE TRAFIA DO CZYTELNIKA. Komponent czyta
//      `res.text()` i go PORZUCA; pokazanie surowej odpowiedzi wystawiłoby
//      wewnętrzne komunikaty dostawcy. Test sprawdza obie połowy: że treść
//      została odczytana i że w DOM jej nie ma.
//
//   4. LIMIT DŁUGOŚCI. Do dostawcy idzie najwyżej 5 000 znaków - to jest
//      granica kosztu jednego wywołania.
//
//   5. SPRZĄTANIE PAMIĘCI. Każde nagranie żyje jako `blob:` URL; brak
//      `revokeObjectURL` przy odmontowaniu (albo przy zmianie tekstu) to
//      wyciek na każdy artykuł, przez który przewinie się czytelnik.
//
// ŚRODOWISKO. happy-dom nie ma potoku medialnego (`play()` nie istnieje,
// zdarzenia `play`/`pause`/`ended` nie mają kto emitować), a `fetch` i
// `URL.createObjectURL` wychodziłyby na zewnątrz. Cały plik biegnie więc na
// podmienionych globalach: klasa `FakeAudio` (ten sam wzorzec, co
// `src/lib/audio/__tests__/globalPlayer.test.tsx`), atrapa `fetch`, która
// NIGDY nie dotyka sieci, i licznikowe `createObjectURL`. Osobny przypadek
// dowodzi, że przy braku sesji nie poszło ani jedno żądanie.
//
// `react-i18next` jest podmieniony na PRAWDZIWY tłumacz (`realT`), żeby
// asercje mierzyły słownik `@/lib/i18n-tts-player`, a nie napis przepisany
// do testu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  /** Prawdziwy `getFixedT`, wstrzyknięty pod importami - fabryka nic nie importuje. */
  fixedT: null as null | typeof realT,
  getSession: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: h.getSession } },
}));

import { TtsPlayer } from "@/components/TtsPlayer";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-tts-player";

h.fixedT = realT;

/**
 * Atrapa elementu audio - happy-dom nie implementuje `play()`, `pause()` ani
 * zdarzeń medialnych, więc nie ma tu „prawdziwego" zachowania do zachowania.
 * Ta klasa emituje DOKŁADNIE te zdarzenia, na które komponent nasłuchuje.
 */
class FakeAudio extends EventTarget {
  static last: FakeAudio | null = null;
  static created = 0;
  readonly src: string;
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  /** Gdy ustawione, `play()` odrzuca - tak zachowuje się blokada autoplay. */
  rejectPlay: Error | null = null;

  constructor(src: string) {
    super();
    this.src = src;
    FakeAudio.last = this;
    FakeAudio.created += 1;
  }

  async play(): Promise<void> {
    this.playCalls += 1;
    if (this.rejectPlay) throw this.rejectPlay;
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  }

  pause(): void {
    this.pauseCalls += 1;
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }

  emitEnded(): void {
    this.dispatchEvent(new Event("ended"));
  }
}

function audio(): FakeAudio {
  const a = FakeAudio.last;
  if (a === null) throw new Error("test: komponent nie utworzył elementu audio");
  return a;
}

/** Odpowiedź `/api/tts` w kształcie, z którego komponent naprawdę korzysta. */
function okResponse(): Response {
  return {
    ok: true,
    blob: async () => new Blob(["udawane-mp3"], { type: "audio/mpeg" }),
    text: async () => "",
  } as unknown as Response;
}

function failedResponse(body = "ElevenLabs: quota exceeded for workspace nes-test"): Response {
  return {
    ok: false,
    status: 402,
    blob: async () => new Blob([]),
    text: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;

const LABEL = "Odsłuchaj artykuł";

function renderPlayer(overrides: Partial<Parameters<typeof TtsPlayer>[0]> = {}) {
  return render(
    <TtsPlayer
      text="Unia planuje nowy mechanizm finansowania."
      voiceId="voice-atrapa"
      model="model-atrapa"
      label={LABEL}
      {...overrides}
    />,
  );
}

/** Przycisk odsłuchu - dostępna nazwa idzie z `aria-label`. */
function button(): HTMLElement {
  return screen.getByRole("button", { name: LABEL });
}

/** Kształt ikony w przycisku - jedyny sygnał stanu odtwarzania w DOM. */
function iconPath(container: HTMLElement): string {
  return container.querySelector("svg path")?.getAttribute("d") ?? "";
}

const PLAY_ICON = "M8 5v14l11-7z";
const PAUSE_ICON = "M6 5h4v14H6zM14 5h4v14h-4z";

beforeEach(() => {
  vi.clearAllMocks();
  h.lang = "pl";
  FakeAudio.last = null;
  FakeAudio.created = 0;
  vi.stubGlobal("Audio", FakeAudio);
  let n = 0;
  createObjectURL = vi.fn(() => `blob:nagranie-${++n}`);
  revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
  fetchMock = vi.fn(async () => okResponse());
  vi.stubGlobal("fetch", fetchMock);
  h.getSession.mockResolvedValue({ data: { session: { access_token: "token-atrapa" } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Klik + domknięcie łańcucha obietnic (sesja -> fetch -> blob -> play). */
async function clickPlayer(): Promise<void> {
  await act(async () => {
    fireEvent.click(button());
  });
}

describe("bramki przed wywołaniem płatnej syntezy", () => {
  it("pusty tekst kończy się komunikatem i ZEREM żądań", async () => {
    renderPlayer({ text: "   " });

    await clickPlayer();

    expect(screen.getByText(realT("pl")("ttsPlayer.errors.noText"))).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.getSession).not.toHaveBeenCalled();
  });

  it("brak sesji nie wysyła żądania bez autoryzacji, tylko prosi o logowanie", async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    renderPlayer();

    await clickPlayer();

    expect(await screen.findByText(realT("pl")("ttsPlayer.errors.signInRequired"))).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prośba o logowanie mówi po angielsku na angielskiej stronie", async () => {
    h.lang = "en";
    h.getSession.mockResolvedValue({ data: { session: null } });
    renderPlayer();

    await clickPlayer();

    expect(await screen.findByText("Sign in to listen to the audio version.")).toBeVisible();
    expect(screen.queryByText(realT("pl")("ttsPlayer.errors.signInRequired"))).toBeNull();
  });
});

describe("żądanie syntezy niesie token, parametry głosu i przycięty tekst", () => {
  it("token sesji jedzie w nagłówku Authorization, bo przeglądarka go nie dokłada", async () => {
    renderPlayer();

    await clickPlayer();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/tts");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer token-atrapa",
    });
  });

  it("ładunek niesie głos i model podane przez wołającego", async () => {
    renderPlayer({ voiceId: "glos-pl-1", model: "model-v2" });

    await clickPlayer();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      text: "Unia planuje nowy mechanizm finansowania.",
      voiceId: "glos-pl-1",
      model: "model-v2",
    });
  });

  it("tekst dłuższy niż 5 000 znaków jest PRZYCINANY - to granica kosztu", async () => {
    renderPlayer({ text: "a".repeat(6_000) });

    await clickPlayer();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { text: string };
    expect(body.text).toHaveLength(5_000);
  });

  it("w trakcie pobierania przycisk jest wyłączony, więc nie da się zamówić drugi raz", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    renderPlayer();

    fireEvent.click(button());

    await waitFor(() => expect(button()).toBeDisabled());
    fireEvent.click(button());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      release(okResponse());
    });
    await waitFor(() => expect(button()).toBeEnabled());
  });
});

describe("po pierwszej syntezie przycisk tylko pauzuje i wznawia", () => {
  it("udana synteza tworzy nagranie z adresu blob i je odtwarza", async () => {
    const { container } = renderPlayer();

    await clickPlayer();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(audio().src).toBe("blob:nagranie-1");
    expect(audio().playCalls).toBe(1);
    expect(iconPath(container)).toBe(PAUSE_ICON);
  });

  it("drugi klik PAUZUJE bez ponownego rachunku u dostawcy", async () => {
    const { container } = renderPlayer();
    await clickPlayer();

    await clickPlayer();

    expect(audio().pauseCalls).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(iconPath(container)).toBe(PLAY_ICON);
  });

  it("trzeci klik WZNAWIA to samo nagranie, nadal bez nowego żądania", async () => {
    const { container } = renderPlayer();
    await clickPlayer();
    await clickPlayer();

    await clickPlayer();

    expect(audio().playCalls).toBe(2);
    expect(FakeAudio.created).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(iconPath(container)).toBe(PAUSE_ICON);
  });

  it("koniec nagrania sam wraca do ikony odtwarzania", async () => {
    // Bez nasłuchu na `ended` przycisk zostawałby na „pauzie" po wysłuchaniu
    // całości, a kolejny klik pauzowałby zatrzymane audio.
    const { container } = renderPlayer();
    await clickPlayer();

    await act(async () => {
      audio().emitEnded();
    });

    expect(iconPath(container)).toBe(PLAY_ICON);
  });
});

describe("awarie nie pokazują czytelnikowi wnętrza serwera", () => {
  it("odmowa serwera daje komunikat ze słownika, a nie treść odpowiedzi", async () => {
    fetchMock.mockResolvedValue(failedResponse());
    const { container } = renderPlayer();

    await clickPlayer();

    expect(await screen.findByText(realT("pl")("ttsPlayer.errors.loadFailed"))).toBeVisible();
    expect(container.textContent).not.toContain("quota exceeded");
    expect(FakeAudio.created).toBe(0);
  });

  it("nieczytelne ciało odpowiedzi nie psuje obsługi błędu", async () => {
    // Komponent czyta `res.text()` tylko po to, żeby domknąć strumień, i
    // porzuca wynik. Gdyby ten odczyt mógł rzucić w górę, awaria sieci
    // w połowie odpowiedzi zamieniałaby komunikat w wyjątek bez obsługi.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      blob: async () => new Blob([]),
      text: async () => {
        throw new Error("stream zerwany");
      },
    } as unknown as Response);
    renderPlayer();

    await clickPlayer();

    expect(await screen.findByText(realT("pl")("ttsPlayer.errors.loadFailed"))).toBeVisible();
    expect(screen.queryByText("stream zerwany")).toBeNull();
  });

  it("odmowa serwera po angielsku też idzie ze słownika", async () => {
    h.lang = "en";
    fetchMock.mockResolvedValue(failedResponse());
    renderPlayer();

    await clickPlayer();

    expect(
      await screen.findByText("Could not load the audio version. Please try again."),
    ).toBeVisible();
  });

  it("awaria sieci nie zostawia przycisku w stanie ładowania", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    renderPlayer();

    await clickPlayer();

    expect(await screen.findByText("network down")).toBeVisible();
    await waitFor(() => expect(button()).toBeEnabled());
  });

  it("odrzucenie BEZ obiektu Error też kończy się zdaniem, a nie białym ekranem", async () => {
    // Napis rzucony zamiast `Error` nie ma `.message`, więc komponent musi
    // spaść na własny komunikat zapasowy.
    fetchMock.mockRejectedValue("cokolwiek");
    renderPlayer();

    await clickPlayer();

    expect(await screen.findByText("Nie udało się wygenerować audio")).toBeVisible();
  });

  it("blokada autoodtwarzania jest komunikatem, a nie cichą ciszą", async () => {
    renderPlayer();
    const original = FakeAudio.prototype.play;
    FakeAudio.prototype.play = async function blocked(this: FakeAudio) {
      this.playCalls += 1;
      throw new Error("NotAllowedError");
    };

    await clickPlayer();
    FakeAudio.prototype.play = original;

    expect(await screen.findByText("NotAllowedError")).toBeVisible();
  });
});

describe("zmiana materiału i odmontowanie sprzątają po sobie", () => {
  it("zmiana tekstu zatrzymuje bieżące nagranie i wymusza nową syntezę", async () => {
    const { rerender } = renderPlayer({ text: "Pierwszy akapit." });
    await clickPlayer();
    const first = audio();

    rerender(
      <TtsPlayer
        text="Drugi, zupełnie inny akapit."
        voiceId="voice-atrapa"
        model="model-atrapa"
        label={LABEL}
      />,
    );
    await clickPlayer();

    expect(first.pauseCalls).toBe(1);
    expect(FakeAudio.created).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ text: "Drugi, zupełnie inny akapit." });
  });

  it("zmiana głosu kasuje komunikat błędu poprzedniej próby", async () => {
    fetchMock.mockResolvedValue(failedResponse());
    const { rerender } = renderPlayer({ voiceId: "glos-1" });
    await clickPlayer();
    expect(screen.getByText(realT("pl")("ttsPlayer.errors.loadFailed"))).toBeInTheDocument();

    rerender(
      <TtsPlayer
        text="Unia planuje nowy mechanizm finansowania."
        voiceId="glos-2"
        model="model-atrapa"
        label={LABEL}
      />,
    );

    expect(screen.queryByText(realT("pl")("ttsPlayer.errors.loadFailed"))).toBeNull();
  });

  it("odmontowanie ZWALNIA adres blob - inaczej każdy artykuł zostawia wyciek", async () => {
    const { unmount } = renderPlayer();
    await clickPlayer();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:nagranie-1");
  });
});
