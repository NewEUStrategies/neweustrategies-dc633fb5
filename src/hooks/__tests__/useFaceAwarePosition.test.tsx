// KADR AWATARA NA TWARZY - `object-position` z natywnego `FaceDetector`.
//
// CO DOWODZI TEN PLIK. Ścieżka wykrycia twarzy nie miała ani jednego
// wykonania (happy-dom nie ma `FaceDetector`, więc każdy test spadał na
// zapas). Kontrakty:
//   * bez detektora, bez adresu, bez twarzy albo przy błędzie dekodowania -
//     ZAWSZE zapas „50% 30%" (górna środkowa część - portret), nigdy wyjątek;
//   * znaleziona twarz centruje kadr na środku jej ramki, w procentach
//     wymiarów obrazu, przyciętych do 0-100;
//   * wynik jest pamiętany per adres, a równoległe prośby o ten sam adres
//     dzielą JEDNĄ analizę (lista rozmów pokazuje ten sam awatar wiele razy).
//
// Pamięć podręczna żyje na poziomie modułu, więc każdy test używa WŁASNEGO
// adresu - inaczej wynik jednego testu byłby wejściem drugiego.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useFaceAwarePosition } from "../useFaceAwarePosition";

type Face = { boundingBox: { top: number; left: number; width: number; height: number } };

const detect = vi.fn<(source: unknown) => Promise<Face[]>>();
const decode = vi.fn<() => Promise<void>>();
let detectorCtorThrows = false;

class FakeDetector {
  constructor() {
    if (detectorCtorThrows) throw new Error("unsupported");
  }
  detect = detect;
}

class FakeImage {
  crossOrigin = "";
  decoding = "";
  src = "";
  naturalWidth = 400;
  naturalHeight = 200;
  decode = decode;
}

let urlSeq = 0;
const nextUrl = () => `https://cdn.example.com/avatar-${(urlSeq += 1)}.jpg`;

beforeEach(() => {
  detect.mockReset();
  decode.mockReset().mockResolvedValue(undefined);
  detectorCtorThrows = false;
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("FaceDetector", FakeDetector);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useFaceAwarePosition", () => {
  it("bez adresu - zapas portretowy od razu", () => {
    const { result } = renderHook(() => useFaceAwarePosition(null));
    expect(result.current).toBe("50% 30%");
  });

  it("twarz centruje kadr na środku jej ramki", async () => {
    // Ramka 100x50 od (200, 50): środek (250, 75) w obrazie 400x200.
    detect.mockResolvedValue([{ boundingBox: { left: 200, top: 50, width: 100, height: 50 } }]);
    const { result } = renderHook(() => useFaceAwarePosition(nextUrl()));
    await waitFor(() => expect(result.current).toBe("62.5% 37.5%"));
  });

  it("ramka wystająca poza obraz jest przycinana do 0-100%", async () => {
    detect.mockResolvedValue([{ boundingBox: { left: 380, top: -100, width: 100, height: 20 } }]);
    const { result } = renderHook(() => useFaceAwarePosition(nextUrl()));
    await waitFor(() => expect(result.current).toBe("100.0% 0.0%"));
  });

  it.each([
    ["brak twarzy", () => detect.mockResolvedValue([])],
    ["błąd detekcji", () => detect.mockRejectedValue(new Error("boom"))],
    ["błąd dekodowania obrazu", () => decode.mockRejectedValue(new Error("CORS"))],
    ["brak detektora w przeglądarce", () => vi.stubGlobal("FaceDetector", undefined)],
    [
      "konstruktor detektora odmawia",
      () => {
        detectorCtorThrows = true;
      },
    ],
  ])("%s - zapas portretowy, bez wyjątku", async (_label, arrange) => {
    arrange();
    const { result } = renderHook(() => useFaceAwarePosition(nextUrl()));
    // Analiza jest asynchroniczna - dwa przejścia kolejki wystarczą, żeby
    // ewentualny (błędny) wynik zdążył dojść do stanu.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBe("50% 30%");
  });

  it("wynik jest pamiętany - drugi awatar z tym samym adresem nie analizuje ponownie", async () => {
    detect.mockResolvedValue([{ boundingBox: { left: 0, top: 0, width: 40, height: 40 } }]);
    const url = nextUrl();
    const first = renderHook(() => useFaceAwarePosition(url));
    await waitFor(() => expect(first.result.current).toBe("5.0% 10.0%"));

    const second = renderHook(() => useFaceAwarePosition(url));
    // Z pamięci już przy pierwszym renderze - bez mignięcia zapasem.
    expect(second.result.current).toBe("5.0% 10.0%");
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("równoległe prośby o ten sam adres dzielą JEDNĄ analizę", async () => {
    let resolveDetect: (faces: Face[]) => void = () => {};
    detect.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDetect = resolve;
        }),
    );
    const url = nextUrl();
    const a = renderHook(() => useFaceAwarePosition(url));
    const b = renderHook(() => useFaceAwarePosition(url));
    await waitFor(() => expect(detect).toHaveBeenCalledTimes(1));
    resolveDetect([{ boundingBox: { left: 100, top: 100, width: 0, height: 0 } }]);
    await waitFor(() => expect(a.result.current).toBe("25.0% 50.0%"));
    await waitFor(() => expect(b.result.current).toBe("25.0% 50.0%"));
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("zmiana adresu na pusty wraca do zapasu, a odmontowanie przed wynikiem go nie stosuje", async () => {
    let resolveDetect: (faces: Face[]) => void = () => {};
    detect.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDetect = resolve;
        }),
    );
    const { result, rerender, unmount } = renderHook(({ url }) => useFaceAwarePosition(url), {
      initialProps: { url: nextUrl() as string | null },
    });
    await waitFor(() => expect(detect).toHaveBeenCalledTimes(1));
    rerender({ url: null });
    expect(result.current).toBe("50% 30%");
    unmount();
    resolveDetect([{ boundingBox: { left: 0, top: 0, width: 0, height: 0 } }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBe("50% 30%");
  });
});
