// Czytnik kodów z aparatu - natywny `BarcodeDetector`, bez biblioteki.
//
// DLACZEGO BEZ ZALEŻNOŚCI. Dekodery QR w JS ważą 60-200 kB i robią to samo,
// co przeglądarka umie od dawna sama, w kodzie natywnym i poza wątkiem
// interfejsu. Skaner ma się uruchomić na telefonie wolontariusza przy słabym
// zasięgu - to jest dokładnie ten pakiet, którego nie chcemy dokładać.
//
// APARAT JEST WYGODĄ, NIE JEDYNĄ DROGĄ. `BarcodeDetector` nie istnieje
// w Safari, a zgody na aparat bywają odmówione. Dlatego ten hook mówi WPROST,
// czego brakuje (`support`, `error`), a ekran obok trzyma pole tekstowe -
// czytnik sprzętowy „na klawiaturę" i ręczne wpisanie kodu działają zawsze.
//
// TEN SAM KOD W POLU WIDZENIA NIE JEST DRUGIM SKANEM. Kamera widzi bilet przez
// kilka sekund i wykrywa go kilkanaście razy; bez wyciszenia powtórzeń bramka
// wysłałaby kilkanaście żądań na jedno piknięcie. Stąd `repeatDelayMs`.
//
// UKRYTA KARTA GASI APARAT. Wolontariusz przełącza się do listy uczestników
// i wraca; podtrzymywanie strumienia w tle zjada baterię i trzyma zapaloną
// diodę aparatu, co przy bramce wygląda jak nagrywanie.
import { useCallback, useEffect, useRef, useState } from "react";

interface DetectedBarcode {
  readonly rawValue: string;
  readonly format: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: readonly string[] }): BarcodeDetectorLike;
  getSupportedFormats?(): Promise<string[]>;
}

declare global {
  interface Window {
    /** Obecne w Chromium; w Safari i Firefoksie brak - stąd znak zapytania. */
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
  // Doświetlenie latarką nie weszło jeszcze do typów DOM, choć Chromium na
  // Androidzie obsługuje je od lat. Poszerzenie deklaracji zamiast rzutowania.
  interface MediaTrackConstraintSet {
    torch?: boolean;
  }
  interface MediaTrackCapabilities {
    torch?: boolean;
  }
}

/** Kody spotykane na wejściówkach: QR na telefonie, Code 128 na wydruku. */
const FORMATS = ["qr_code", "code_128", "data_matrix", "aztec", "pdf417"] as const;

/** Ośmiokrotnie na sekundę wystarczy oku i nie grzeje telefonu. */
const DETECT_INTERVAL_MS = 125;

export type BarcodeSupport = "checking" | "supported" | "unsupported" | "insecure";

export type BarcodeScannerError =
  "permission_denied" | "camera_unavailable" | "not_supported" | "insecure_context";

export interface BarcodeScanner {
  support: BarcodeSupport;
  active: boolean;
  starting: boolean;
  error: BarcodeScannerError | null;
  torchAvailable: boolean;
  torchOn: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  start: () => void;
  stop: () => void;
  toggleTorch: () => void;
}

export function useBarcodeScanner(options: {
  onCode: (code: string) => void;
  /** Ile ms ignorować ten sam kod po odczycie. Domyślnie 2,5 s. */
  repeatDelayMs?: number;
}): BarcodeScanner {
  const { onCode, repeatDelayMs = 2_500 } = options;

  const [support, setSupport] = useState<BarcodeSupport>("checking");
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<BarcodeScannerError | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastDetectRef = useRef(0);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);
  // Wywołanie zwrotne w referencji: zmiana handlera nie może restartować
  // strumienia, bo restart gasi aparat na pół sekundy w środku kolejki.
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.isSecureContext) {
      setSupport("insecure");
      return;
    }
    const hasDetector = typeof window.BarcodeDetector !== "undefined";
    const hasCamera = typeof navigator.mediaDevices?.getUserMedia === "function";
    setSupport(hasDetector && hasCamera ? "supported" : "unsupported");
  }, []);

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const stream = streamRef.current;
    if (stream !== null) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video !== null) video.srcObject = null;
    detectorRef.current = null;
    lastCodeRef.current = null;
    setActive(false);
    setTorchOn(false);
    setTorchAvailable(false);
  }, []);

  const tick = useCallback(() => {
    frameRef.current = requestAnimationFrame(tick);
    const detector = detectorRef.current;
    const video = videoRef.current;
    if (detector === null || video === null || video.readyState < 2) return;

    const now = performance.now();
    if (now - lastDetectRef.current < DETECT_INTERVAL_MS) return;
    lastDetectRef.current = now;

    void detector
      .detect(video)
      .then((codes) => {
        const value = codes[0]?.rawValue?.trim() ?? "";
        if (value === "") return;
        const last = lastCodeRef.current;
        if (last !== null && last.code === value && now - last.at < repeatDelayMs) return;
        lastCodeRef.current = { code: value, at: now };
        onCodeRef.current(value);
      })
      .catch(() => {
        // Pojedyncza nieudana klatka nie jest awarią - kolejna przyjdzie
        // za 125 ms. Gaszenie aparatu przy pierwszym potknięciu dekodera
        // kosztowałoby operatora restart w środku kolejki.
      });
  }, [repeatDelayMs]);

  const start = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!window.isSecureContext) {
      setError("insecure_context");
      return;
    }
    const Detector = window.BarcodeDetector;
    if (Detector === undefined || typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setError("not_supported");
      return;
    }

    setStarting(true);
    setError(null);
    navigator.mediaDevices
      .getUserMedia({
        video: {
          // Tylna kamera bez twardego wymogu: telefon bez tylnej kamery ma
          // wtedy działający skaner z przedniej, a nie odmowę.
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      .then((stream) => {
        streamRef.current = stream;
        const video = videoRef.current;
        if (video === null) {
          for (const track of stream.getTracks()) track.stop();
          streamRef.current = null;
          setStarting(false);
          return;
        }
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        const track = stream.getVideoTracks()[0];
        setTorchAvailable(track?.getCapabilities?.().torch === true);
        detectorRef.current = new Detector({ formats: FORMATS });
        return video.play().then(() => {
          setActive(true);
          setStarting(false);
          lastDetectRef.current = 0;
          frameRef.current = requestAnimationFrame(tick);
        });
      })
      .catch((cause: unknown) => {
        setStarting(false);
        const name = cause instanceof Error ? cause.name : "";
        setError(
          name === "NotAllowedError" || name === "SecurityError"
            ? "permission_denied"
            : "camera_unavailable",
        );
      });
  }, [tick]);

  const toggleTorch = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (track === undefined) return;
    const next = !torchOn;
    void track
      .applyConstraints({ advanced: [{ torch: next }] })
      .then(() => setTorchOn(next))
      .catch(() => setTorchAvailable(false));
  }, [torchOn]);

  // Ukryta karta gasi aparat - patrz nagłówek.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stop]);

  useEffect(() => stop, [stop]);

  return {
    support,
    active,
    starting,
    error,
    torchAvailable,
    torchOn,
    videoRef,
    start,
    stop,
    toggleTorch,
  };
}
