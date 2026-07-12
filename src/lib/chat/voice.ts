// Voice notes: MediaRecorder wrapper hook + pure duration formatting.
// The recorder produces a File whose type is the BASE container mime
// (";codecs=..." stripped) so the storage bucket allowlist matches exactly.
// The mic stream is always fully stopped on finish/cancel/unmount - no
// lingering recording indicator in the browser tab.
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_VOICE_SECONDS } from "./attachments";

/** mm:ss for player timers and the recording HUD. Pure - unit-tested. */
export function formatVoiceDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** First recording container this browser supports (Chrome/Firefox -> webm, Safari -> mp4). */
export function pickRecordingMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

export interface RecordedVoice {
  file: File;
  /** Whole seconds, >= 1 (DB CHECK requires a positive duration). */
  durationSeconds: number;
}

export type VoiceRecorderState = "idle" | "requesting" | "recording";

export interface VoiceRecorder {
  state: VoiceRecorderState;
  /** Elapsed seconds while recording (drives the HUD timer). */
  elapsed: number;
  /** True when this browser can record at all (API + container available). */
  supported: boolean;
  start: () => Promise<void>;
  /** Stop and resolve the recorded file; null when nothing was captured. */
  finish: () => Promise<RecordedVoice | null>;
  /** Stop and discard everything. */
  cancel: () => void;
}

export function useVoiceRecorder(options?: {
  onLimitReached?: (voice: RecordedVoice | null) => void;
  onError?: (kind: "denied" | "unsupported") => void;
}): VoiceRecorder {
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    pickRecordingMime() !== null;

  const teardown = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    chunksRef.current = [];
    setElapsed(0);
    setState("idle");
  }, []);

  // Collect chunks into a File; resolves via the recorder's onstop event so
  // the final dataavailable chunk is always included.
  const collect = useCallback((): Promise<RecordedVoice | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const baseMime = (recorder.mimeType || "audio/webm").split(";")[0] ?? "audio/webm";
        const ext = baseMime === "audio/mp4" ? "m4a" : (baseMime.split("/")[1] ?? "webm");
        const blob = new Blob(chunksRef.current, { type: baseMime });
        const durationSeconds = Math.min(
          MAX_VOICE_SECONDS,
          Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)),
        );
        if (blob.size === 0) {
          resolve(null);
          return;
        }
        resolve({
          file: new File([blob], `voice-${Date.now()}.${ext}`, { type: baseMime }),
          durationSeconds,
        });
      };
      recorder.stop();
    });
  }, []);

  const finish = useCallback(async (): Promise<RecordedVoice | null> => {
    const voice = await collect();
    teardown();
    return voice;
  }, [collect, teardown]);

  const finishRef = useRef(finish);
  finishRef.current = finish;

  const start = useCallback(async () => {
    if (state !== "idle") return;
    const mime = pickRecordingMime();
    if (!supported || !mime) {
      optionsRef.current?.onError?.("unsupported");
      return;
    }
    setState("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("idle");
      optionsRef.current?.onError?.("denied");
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    recorder.start(1000);
    setElapsed(0);
    setState("recording");
    tickRef.current = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsed(seconds);
      if (seconds >= MAX_VOICE_SECONDS) {
        // Hard cap mirrors the DB CHECK - auto-finish instead of failing later.
        void finishRef.current().then((voice) => optionsRef.current?.onLimitReached?.(voice));
      }
    }, 250);
  }, [state, supported]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    teardown();
  }, [teardown]);

  // Unmount safety: never leave the mic open.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  return { state, elapsed, supported, start, finish, cancel };
}
