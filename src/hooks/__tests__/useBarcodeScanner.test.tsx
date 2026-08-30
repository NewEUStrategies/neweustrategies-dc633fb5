// Czytnik kodow z aparatu przy bramce - to, co po zepsuciu gasi skaner
// wolontariusza w srodku kolejki albo zostawia zapalona diode aparatu.
//
// PO CO TEN PLIK ISTNIEJE. `useBarcodeScanner` stoi na trzech rzeczach, ktorych
// w happy-dom nie ma i ktorych w CI nikt nigdy nie klika: natywnym
// `BarcodeDetector`, zgodzie na aparat i petli klatek. Kazda z nich psuje sie
// cicho - operator widzi ten sam przycisk i ten sam czarny prostokat.
//
// CO PSUJE SIE BEZ TEGO PLIKU:
//   1. brak `BarcodeDetector` (Safari) albo brak HTTPS przestaje byc NAZWANY
//      i ekran nie umie powiedziec, czego brakuje - wolontariusz probuje
//      w kolko zamiast przejsc na pole tekstowe;
//   2. odmowa zgody na aparat miesza sie z awaria sprzetu, wiec komunikat
//      nie mowi, czy klikac „zezwol”, czy szukac innego telefonu;
//   3. wyciszenie powtorzen przestaje dzialac i JEDNO pikniecie biletu
//      zamienia sie w kilkanascie zadan do bazy;
//   4. pusty odczyt (albo same biale znaki) leci dalej jako „kod” i podbija
//      licznik nieudanych rozpoznan urzadzenia, ktory blokuje bramke;
//   5. ukryta karta albo odmontowanie ekranu nie gasza aparatu - bateria
//      znika, a zapalona dioda przy bramce wyglada jak nagrywanie.
//
// APARAT, ZEGAR I PETLA KLATEK SA ZASLEPIONE. `requestAnimationFrame` steruje
// test (jedna klatka = jedno wywolanie), `performance.now` jest jawnym
// licznikiem, a strumien z aparatu to atrapa, ktora zapisuje, czy tracki
// zostaly zgaszone. Test nie wychodzi do sieci i nie prosi o zadne uprawnienia.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useBarcodeScanner, type BarcodeScanner } from "@/hooks/useBarcodeScanner";

/* --------------------------------------------------------------- atrapy --- */

/** Odczyt, ktory „widzi” atrapa dekodera. */
interface FakeCode {
  rawValue: string;
  format: string;
}

const detect = vi.fn<(source: CanvasImageSource) => Promise<FakeCode[]>>();

/** Formaty, o ktore poprosil hook - lista jest czescia kontraktu z bilet-ami. */
let requestedFormats: readonly string[] = [];

class FakeBarcodeDetector {
  constructor(options?: { formats?: readonly string[] }) {
    requestedFormats = options?.formats ?? [];
  }
  detect(source: CanvasImageSource): Promise<FakeCode[]> {
    return detect(source);
  }
}

/**
 * Sciezka wideo w atrapie nosi DOKLADNIE te trzy metody, ktorych hook uzywa.
 * Nie udajemy calego `MediaStreamTrack` - atrapa przechodzi do produkcji przez
 * deskryptor `navigator.mediaDevices`, wiec nie ma tu czego rzutowac, a wlasny
 * typ pilnuje, ze test nie siegnie po nic, czego atrapa nie ma.
 */
interface FakeTrack {
  stop(): void;
  getCapabilities(): { torch?: boolean };
  applyConstraints(constraints: { advanced?: Array<{ torch?: boolean }> }): Promise<void>;
}

interface FakeStream {
  getTracks(): FakeTrack[];
  getVideoTracks(): FakeTrack[];
}

/** Slad tego, co stalo sie ze sciezka wideo - to on mowi, czy dioda zgasla. */
interface TrackState {
  stopped: boolean;
  torchApplied: boolean[];
}

function fakeTrack(options: { torch?: boolean; torchFails?: boolean } = {}): {
  track: FakeTrack;
  state: TrackState;
} {
  const state: TrackState = { stopped: false, torchApplied: [] };
  return {
    state,
    track: {
      stop: () => {
        state.stopped = true;
      },
      getCapabilities: () => (options.torch === undefined ? {} : { torch: options.torch }),
      applyConstraints: (constraints) => {
        for (const set of constraints.advanced ?? []) {
          if (set.torch !== undefined) state.torchApplied.push(set.torch);
        }
        return options.torchFails === true
          ? Promise.reject(new Error("torch: nie da sie zapalic"))
          : Promise.resolve();
      },
    },
  };
}

function fakeStream(tracks: FakeTrack[]): FakeStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks,
  };
}

const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<FakeStream>>();

/* ------------------------------------------------------- petla i zegar --- */

let clock = 0;
let nextFrameId = 0;
const scheduledFrames = new Map<number, FrameRequestCallback>();

/** Jedno „odswiezenie ekranu”: wykonuje zaplanowane klatki i mikrozadania. */
async function runFrame(): Promise<void> {
  const pending = [...scheduledFrames.values()];
  scheduledFrames.clear();
  await act(async () => {
    for (const frame of pending) frame(clock);
    // Dekoder oddaje wynik przez lancuch obietnic (`detect().then().catch()`),
    // wiec jedna klatka to kilka mikrozadan, nie jedno.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/* ----------------------------------------------------------- srodowisko --- */

interface EnvironmentOptions {
  secure?: boolean;
  detector?: boolean;
  camera?: boolean;
}

let visibility: DocumentVisibilityState = "visible";

function installEnvironment(options: EnvironmentOptions = {}): void {
  const { secure = true, detector = true, camera = true } = options;
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: secure });
  if (detector) {
    window.BarcodeDetector = FakeBarcodeDetector;
  } else {
    delete window.BarcodeDetector;
  }
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: camera ? { getUserMedia } : undefined,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
}

/**
 * Podglad z aparatu - PRAWDZIWY element `<video>`, ale z wlasnym `readyState`,
 * `srcObject` i `play`.
 *
 * happy-dom nie implementuje `srcObject` do zapisu, a `readyState` jest tam
 * tylko do odczytu; bez wlasnych deskryptorow przypisanie strumienia rzucaloby
 * `TypeError` w srodku `start()` i test „udowadnialby”, ze aparat sie nie
 * wlacza, choc w przegladarce wlacza sie bez problemu.
 */
function fakeVideo(options: { readyState?: number; playFails?: boolean } = {}): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "readyState", {
    configurable: true,
    value: options.readyState ?? 4,
  });
  Object.defineProperty(video, "srcObject", {
    configurable: true,
    writable: true,
    value: null,
  });
  Object.defineProperty(video, "play", {
    configurable: true,
    writable: true,
    value: () =>
      options.playFails === true
        ? Promise.reject(new Error("NotAllowedError: autoodtwarzanie zablokowane"))
        : Promise.resolve(),
  });
  return video;
}

function mount(onCode: (code: string) => void, repeatDelayMs?: number) {
  return renderHook(
    (props: { onCode: (code: string) => void }) =>
      useBarcodeScanner({ onCode: props.onCode, repeatDelayMs }),
    { initialProps: { onCode } },
  );
}

/** Podpina podglad i uruchamia aparat, czekajac na pelny cykl `getUserMedia`. */
async function startWith(
  scanner: { current: BarcodeScanner },
  video: HTMLVideoElement,
): Promise<void> {
  scanner.current.videoRef.current = video;
  await act(async () => {
    scanner.current.start();
  });
}

beforeEach(() => {
  clock = 1_000;
  nextFrameId = 0;
  visibility = "visible";
  scheduledFrames.clear();
  requestedFormats = [];
  detect.mockReset();
  detect.mockResolvedValue([]);
  getUserMedia.mockReset();
  getUserMedia.mockImplementation(() => Promise.resolve(fakeStream([fakeTrack().track])));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
    nextFrameId += 1;
    scheduledFrames.set(nextFrameId, callback);
    return nextFrameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
    scheduledFrames.delete(id);
  });
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  installEnvironment();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ----------------------------------------------------- czego brakuje --- */

describe("useBarcodeScanner - czego brakuje na TYM telefonie", () => {
  it("brak `BarcodeDetector` (Safari) jest NAZWANY, a nie udawany", async () => {
    // Ekran obok trzyma pole tekstowe: czytnik sprzetowy „na klawiature”
    // i reczne wpisanie kodu dzialaja zawsze. Warunek jest taki, ze hook
    // powie WPROST, czego brakuje.
    installEnvironment({ detector: false });
    const { result } = mount(vi.fn());

    expect(result.current.support).toBe("unsupported");

    act(() => {
      result.current.start();
    });

    expect(result.current.error).toBe("not_supported");
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
  });

  it("brak HTTPS to osobny powod niz brak dekodera", async () => {
    // Aparat bez bezpiecznego kontekstu nie ruszy w zadnej przegladarce,
    // a komunikat „nieobslugiwane” wyslalby administratora na polowanie
    // na przegladarke zamiast na certyfikat.
    installEnvironment({ secure: false });
    const { result } = mount(vi.fn());

    expect(result.current.support).toBe("insecure");

    act(() => {
      result.current.start();
    });

    expect(result.current.error).toBe("insecure_context");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("brak samego aparatu tez konczy sie `unsupported`, mimo dekodera", async () => {
    installEnvironment({ camera: false });
    const { result } = mount(vi.fn());
    expect(result.current.support).toBe("unsupported");

    act(() => {
      result.current.start();
    });
    expect(result.current.error).toBe("not_supported");
  });

  it("przy komplecie mozliwosci wsparcie jest POTWIERDZONE, a nie „sprawdzane”", () => {
    const { result } = mount(vi.fn());
    expect(result.current.support).toBe("supported");
    expect(result.current.error).toBeNull();
  });

  it("ODMOWA ZGODY to `permission_denied`, awaria sprzetu to `camera_unavailable`", async () => {
    // Dwa rozne zdania dla operatora: „kliknij zezwol” kontra „wez inny
    // telefon". Jedna wspolna nazwa bledu kosztuje telefon do biura.
    const denied = new Error("odmowa");
    denied.name = "NotAllowedError";
    getUserMedia.mockRejectedValueOnce(denied);
    const first = mount(vi.fn());
    await startWith(first.result, fakeVideo());
    expect(first.result.current.error).toBe("permission_denied");
    expect(first.result.current.starting).toBe(false);
    expect(first.result.current.active).toBe(false);

    const blocked = new Error("polityka");
    blocked.name = "SecurityError";
    getUserMedia.mockRejectedValueOnce(blocked);
    const second = mount(vi.fn());
    await startWith(second.result, fakeVideo());
    expect(second.result.current.error).toBe("permission_denied");

    const missing = new Error("brak urzadzenia");
    missing.name = "NotFoundError";
    getUserMedia.mockRejectedValueOnce(missing);
    const third = mount(vi.fn());
    await startWith(third.result, fakeVideo());
    expect(third.result.current.error).toBe("camera_unavailable");
  });
});

/* ------------------------------------------------------------ podglad --- */

describe("useBarcodeScanner - uruchomienie podgladu", () => {
  it("prosi o TYLNA kamere bez twardego wymogu i nie nagrywa dzwieku", async () => {
    // Telefon bez tylnej kamery ma miec dzialajacy skaner z przedniej,
    // a nie odmowe. Dzwiek przy bramce to nagrywanie rozmow uczestnikow.
    const { result } = mount(vi.fn());
    const video = fakeVideo();
    await startWith(result, video);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const constraints = getUserMedia.mock.calls[0][0];
    expect(constraints.audio).toBe(false);
    expect(constraints.video).toMatchObject({ facingMode: { ideal: "environment" } });
    expect(result.current.active).toBe(true);
    expect(result.current.starting).toBe(false);
    expect(video.getAttribute("playsinline")).toBe("true");
    expect(video.srcObject).not.toBeNull();
  });

  it("dekoder dostaje formaty spotykane na wejsciowkach - QR i Code 128", async () => {
    const { result } = mount(vi.fn());
    await startWith(result, fakeVideo());
    expect(requestedFormats).toContain("qr_code");
    expect(requestedFormats).toContain("code_128");
  });

  it("latarka pojawia sie TYLKO wtedy, gdy sciezka wideo ja ma", async () => {
    const withTorch = fakeTrack({ torch: true });
    getUserMedia.mockImplementationOnce(() => Promise.resolve(fakeStream([withTorch.track])));
    const lit = mount(vi.fn());
    await startWith(lit.result, fakeVideo());
    expect(lit.result.current.torchAvailable).toBe(true);

    const plain = fakeTrack();
    getUserMedia.mockImplementationOnce(() => Promise.resolve(fakeStream([plain.track])));
    const dark = mount(vi.fn());
    await startWith(dark.result, fakeVideo());
    expect(dark.result.current.torchAvailable).toBe(false);
  });

  it("latarka gasnie z ekranu, gdy urzadzenie odmowi jej zapalenia", async () => {
    const flaky = fakeTrack({ torch: true, torchFails: true });
    getUserMedia.mockImplementationOnce(() => Promise.resolve(fakeStream([flaky.track])));
    const { result } = mount(vi.fn());
    await startWith(result, fakeVideo());
    expect(result.current.torchAvailable).toBe(true);

    await act(async () => {
      result.current.toggleTorch();
    });

    expect(flaky.state.torchApplied).toEqual([true]);
    expect(result.current.torchOn).toBe(false);
    // Przycisk, ktory nic nie robi, jest gorszy od jego braku.
    expect(result.current.torchAvailable).toBe(false);
  });

  it("latarka zapala sie i gasnie tym samym przyciskiem", async () => {
    const torch = fakeTrack({ torch: true });
    getUserMedia.mockImplementationOnce(() => Promise.resolve(fakeStream([torch.track])));
    const { result } = mount(vi.fn());
    await startWith(result, fakeVideo());

    await act(async () => {
      result.current.toggleTorch();
    });
    expect(result.current.torchOn).toBe(true);

    await act(async () => {
      result.current.toggleTorch();
    });
    expect(result.current.torchOn).toBe(false);
    expect(torch.state.torchApplied).toEqual([true, false]);
  });

  it("brak podgladu na ekranie GASI strumien, zamiast zostawiac zapalona diode", async () => {
    const track = fakeTrack();
    getUserMedia.mockImplementationOnce(() => Promise.resolve(fakeStream([track.track])));
    const { result } = mount(vi.fn());

    // `videoRef.current` zostaje `null` - tak wyglada start w chwili, gdy
    // ekran wlasnie sie przemontowal.
    await act(async () => {
      result.current.start();
    });

    expect(track.state.stopped).toBe(true);
    expect(result.current.active).toBe(false);
    expect(result.current.starting).toBe(false);
  });
});

/* -------------------------------------------------------------- odczyt --- */

describe("useBarcodeScanner - odczyt kodu", () => {
  it("wykryty kod jedzie do wywolania zwrotnego PRZYCIETY z bialych znakow", async () => {
    const onCode = vi.fn();
    const { result } = mount(onCode);
    await startWith(result, fakeVideo());

    detect.mockResolvedValue([{ rawValue: "  BILET-1  ", format: "qr_code" }]);
    await runFrame();

    expect(onCode).toHaveBeenCalledTimes(1);
    expect(onCode).toHaveBeenCalledWith("BILET-1");
  });

  it("KOD PUSTY i kod z samych bialych znakow NIE sa skanem", async () => {
    // Kazdy taki „odczyt” poszedlby do bazy jako nieznany kod i podbil licznik
    // nieudanych rozpoznan urzadzenia - po serii baza blokuje bramke, ktora
    // dziala poprawnie. Kamera oddaje takie klatki przy zlym swietle.
    const onCode = vi.fn();
    const { result } = mount(onCode);
    await startWith(result, fakeVideo());

    detect.mockResolvedValue([{ rawValue: "", format: "qr_code" }]);
    await runFrame();
    clock += 200;

    detect.mockResolvedValue([{ rawValue: "   \n\t ", format: "qr_code" }]);
    await runFrame();
    clock += 200;

    detect.mockResolvedValue([]);
    await runFrame();

    expect(onCode).not.toHaveBeenCalled();
    expect(result.current.active).toBe(true);
  });

  it("TEN SAM kod w polu widzenia nie jest drugim skanem, dopoki nie minie okno", async () => {
    // Kamera widzi bilet przez kilka sekund i wykrywa go kilkanascie razy.
    // Bez wyciszenia powtorzen bramka wyslalaby kilkanascie zadan na jedno
    // pikniecie, a dziennik pokazalby kilkanascie odpraw jednej osoby.
    const onCode = vi.fn();
    const { result } = mount(onCode, 2_500);
    await startWith(result, fakeVideo());
    detect.mockResolvedValue([{ rawValue: "BILET-2", format: "qr_code" }]);

    await runFrame();
    expect(onCode).toHaveBeenCalledTimes(1);

    // Kolejne klatki w oknie wyciszenia - kod ten sam, wiec cisza.
    for (let i = 0; i < 8; i += 1) {
      clock += 200;
      await runFrame();
    }
    expect(onCode).toHaveBeenCalledTimes(1);

    // Po oknie ten sam bilet liczy sie znowu - ktos wrocil do bramki.
    clock += 2_600;
    await runFrame();
    expect(onCode).toHaveBeenCalledTimes(2);
    expect(onCode).toHaveBeenLastCalledWith("BILET-2");
  });

  it("INNY kod zaraz po poprzednim jest osobnym skanem", async () => {
    // Wyciszenie dotyczy TEGO SAMEGO kodu. Kolejka przy bramce idzie szybciej
    // niz 2,5 s na osobe, wiec globalne dlawienie zgubiloby co drugiego gosca.
    const onCode = vi.fn();
    const { result } = mount(onCode, 2_500);
    await startWith(result, fakeVideo());

    detect.mockResolvedValue([{ rawValue: "BILET-A", format: "qr_code" }]);
    await runFrame();
    clock += 200;
    detect.mockResolvedValue([{ rawValue: "BILET-B", format: "qr_code" }]);
    await runFrame();

    expect(onCode.mock.calls.map((call) => call[0])).toEqual(["BILET-A", "BILET-B"]);
  });

  it("klatki sa DLAWIONE - osiem odczytow na sekunde wystarczy oku i nie grzeje telefonu", async () => {
    const onCode = vi.fn();
    const { result } = mount(onCode);
    await startWith(result, fakeVideo());

    await runFrame();
    expect(detect).toHaveBeenCalledTimes(1);

    // 100 ms to mniej niz odstep 125 ms - dekoder nie dostaje pracy.
    clock += 100;
    await runFrame();
    expect(detect).toHaveBeenCalledTimes(1);

    clock += 50;
    await runFrame();
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it("nieudana klatka dekodera NIE gasi aparatu", async () => {
    // Gaszenie przy pierwszym potknieciu kosztowaloby operatora restart
    // w srodku kolejki, a kolejna klatka przychodzi za 125 ms.
    const onCode = vi.fn();
    const { result } = mount(onCode);
    await startWith(result, fakeVideo());

    detect.mockRejectedValueOnce(new Error("dekoder: klatka nieczytelna"));
    await runFrame();
    expect(result.current.active).toBe(true);
    expect(result.current.error).toBeNull();

    clock += 200;
    detect.mockResolvedValue([{ rawValue: "BILET-3", format: "qr_code" }]);
    await runFrame();
    expect(onCode).toHaveBeenCalledWith("BILET-3");
  });

  it("podglad, ktory jeszcze nie ma klatki, nie idzie do dekodera", async () => {
    const onCode = vi.fn();
    const { result } = mount(onCode);
    await startWith(result, fakeVideo({ readyState: 1 }));

    await runFrame();
    expect(detect).not.toHaveBeenCalled();
  });

  it("zmiana wywolania zwrotnego NIE restartuje aparatu", async () => {
    // Restart gasi aparat na pol sekundy w srodku kolejki. Panel przekazuje
    // nowa funkcje przy kazdym renderze, wiec to jest przypadek codzienny.
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = mount(first);
    await startWith(result, fakeVideo());
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    rerender({ onCode: second });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.active).toBe(true);

    detect.mockResolvedValue([{ rawValue: "BILET-4", format: "qr_code" }]);
    await runFrame();

    expect(second).toHaveBeenCalledWith("BILET-4");
    expect(first).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------ gaszenie --- */

describe("useBarcodeScanner - gaszenie aparatu", () => {
  it("UKRYTA KARTA gasi aparat - dioda przy bramce wyglada jak nagrywanie", async () => {
    const track = fakeTrack();
    getUserMedia.mockImplementationOnce(() => Promise.resolve(fakeStream([track.track])));
    const { result } = mount(vi.fn());
    const video = fakeVideo();
    await startWith(result, video);
    expect(result.current.active).toBe(true);

    visibility = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(track.state.stopped).toBe(true);
    expect(result.current.active).toBe(false);
    expect(video.srcObject).toBeNull();
  });

  it("powrot do karty NIE wskrzesza aparatu sam z siebie", async () => {
    // Wznowienie bez zgody operatora zapalaloby diode w kieszeni.
    const { result } = mount(vi.fn());
    await startWith(result, fakeVideo());

    visibility = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current.active).toBe(false);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("`stop` gasi tracki, czysci podglad i kasuje pamiec ostatniego kodu", async () => {
    const track = fakeTrack({ torch: true });
    getUserMedia.mockImplementation(() => Promise.resolve(fakeStream([track.track])));
    const onCode = vi.fn();
    const { result } = mount(onCode, 2_500);
    const video = fakeVideo();
    await startWith(result, video);

    detect.mockResolvedValue([{ rawValue: "BILET-5", format: "qr_code" }]);
    await runFrame();
    expect(onCode).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.stop();
    });

    expect(track.state.stopped).toBe(true);
    expect(video.srcObject).toBeNull();
    expect(result.current.active).toBe(false);
    expect(result.current.torchAvailable).toBe(false);
    expect(result.current.torchOn).toBe(false);

    // Po ponownym wlaczeniu ten sam bilet jest NOWYM skanem: to inna sesja
    // przy bramce, a nie ta sama klatka w polu widzenia.
    await startWith(result, video);
    clock += 10;
    await runFrame();
    expect(onCode).toHaveBeenCalledTimes(2);
  });

  it("ODMONTOWANIE ekranu gasi aparat", async () => {
    const track = fakeTrack();
    getUserMedia.mockImplementationOnce(() => Promise.resolve(fakeStream([track.track])));
    const { result, unmount } = mount(vi.fn());
    await startWith(result, fakeVideo());

    unmount();

    expect(track.state.stopped).toBe(true);
  });
});

/* ------------------------------------------------------------- defekty --- */

// -----------------------------------------------------------------------------
// DEFEKT: odmowa odtwarzania podgladu ZOSTAWIA WLACZONY APARAT.
//
// `start()` zapisuje strumien do `streamRef` PRZED `video.play()`. Gdy
// `play()` odmawia - a to jest codziennosc mobilnych przegladarek, ktore
// blokuja autoodtwarzanie - sterowanie leci do wspolnego `catch`, ktory ustawia
// `error` i `starting = false`, ale NIE wola `stop()`. Skutek: `active` zostaje
// `false` (wiec przycisk pokazuje „wlacz aparat”, a nie „wylacz”), tracki
// nadal zyja, dioda aparatu sie pali, a kolejne klikniecie „wlacz” nadpisuje
// `streamRef` i gubi poprzedni strumien BEZPOWROTNIE - nic go juz nie zgasi
// do konca zycia karty.
//
// To jest dokladnie ta klasa bledu, przed ktora broni sie naglowek modulu
// („podtrzymywanie strumienia w tle zjada baterie i trzyma zapalona diode
// aparatu, co przy bramce wyglada jak nagrywanie") - tyle ze na sciezce
// bledu, a nie na sciezce ukrytej karty.
//
// Naprawa nalezy do produkcji: `catch` w `start()` musi zgasic tracki, ktore
// zdazyl przejac (albo `play()` ma miec wlasny `catch` z `stop()`).
// -----------------------------------------------------------------------------
describe("useBarcodeScanner - znane defekty", () => {
  it.fails(
    "odmowa odtwarzania podgladu (`play()` odrzucone przez polityke autoodtwarzania) powinna ZGASIC przejety strumien, a zostawia zapalony aparat bez sposobu na jego wylaczenie",
    async () => {
      const track = fakeTrack();
      getUserMedia.mockImplementationOnce(() => Promise.resolve(fakeStream([track.track])));
      const { result } = mount(vi.fn());

      await startWith(result, fakeVideo({ playFails: true }));

      expect(result.current.active).toBe(false);
      expect(result.current.error).not.toBeNull();
      expect(track.state.stopped).toBe(true);
    },
  );
});
