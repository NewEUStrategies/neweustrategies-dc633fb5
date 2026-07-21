// Face-aware object-position for avatar crops.
//
// Strategy:
// 1. Try the browser's native `FaceDetector` (Chromium). If a face is found,
//    center the crop on that face.
// 2. Fallback: portrait-friendly `50% 30%` (upper-center) — much better than
//    the CSS default `50% 50%` for headshots where the face sits above center.
//
// Results are cached in-memory per URL so the same avatar is not re-analyzed
// across message bubbles / list rows.
import { useEffect, useState } from "react";

type FaceBox = { top: number; left: number; width: number; height: number };
type DetectedFace = { boundingBox: FaceBox };
type FaceDetectorCtor = new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => {
  detect: (source: CanvasImageSource) => Promise<DetectedFace[]>;
};

const FALLBACK = "50% 30%";
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function getDetector(): InstanceType<FaceDetectorCtor> | null {
  const Ctor = (globalThis as unknown as { FaceDetector?: FaceDetectorCtor }).FaceDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ fastMode: true, maxDetectedFaces: 1 });
  } catch {
    return null;
  }
}

async function analyze(url: string): Promise<string> {
  const cached = cache.get(url);
  if (cached) return cached;
  const running = inflight.get(url);
  if (running) return running;

  const task = (async () => {
    try {
      const detector = getDetector();
      if (!detector) return FALLBACK;

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.src = url;
      await img.decode();

      const faces = await detector.detect(img);
      const face = faces[0];
      if (!face || !img.naturalWidth || !img.naturalHeight) return FALLBACK;

      const cx = face.boundingBox.left + face.boundingBox.width / 2;
      const cy = face.boundingBox.top + face.boundingBox.height / 2;
      const x = Math.min(100, Math.max(0, (cx / img.naturalWidth) * 100));
      const y = Math.min(100, Math.max(0, (cy / img.naturalHeight) * 100));
      return `${x.toFixed(1)}% ${y.toFixed(1)}%`;
    } catch {
      return FALLBACK;
    }
  })();

  inflight.set(url, task);
  const result = await task;
  cache.set(url, result);
  inflight.delete(url);
  return result;
}

export function useFaceAwarePosition(url?: string | null): string {
  const [position, setPosition] = useState<string>(() => (url && cache.get(url)) || FALLBACK);

  useEffect(() => {
    if (!url) {
      setPosition(FALLBACK);
      return;
    }
    const cached = cache.get(url);
    if (cached) {
      setPosition(cached);
      return;
    }
    let cancelled = false;
    void analyze(url).then((next) => {
      if (!cancelled) setPosition(next);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return position;
}
