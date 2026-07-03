import { useEffect, useRef, useState } from "react";
import { Loader2 } from "@/lib/lucide-shim";
import { supabase } from "@/integrations/supabase/client";

const PlayIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const PauseIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
  </svg>
);

interface TtsPlayerProps {
  text: string;
  voiceId: string;
  model: string;
  label: string;
}

export function TtsPlayer({ text, voiceId, model, label }: TtsPlayerProps) {
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setAudioUrl(null);
    setError(null);
    setPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, [text, voiceId, model]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const handleClick = async () => {
    if (!text || !text.trim()) {
      setError("Brak tekstu do odczytania");
      return;
    }
    if (audioRef.current && audioUrl) {
      if (playing) {
        audioRef.current.pause();
        setPlaying(false);
      } else {
        await audioRef.current.play();
        setPlaying(true);
      }
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // /api/tts requires an authenticated Supabase session. The bearer token
      // is attached explicitly - the browser doesn't send it automatically.
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error("Zaloguj się, aby odsłuchać wersję audio.");
      }
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ text: text.slice(0, 5000), voiceId, model }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `Błąd ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.addEventListener("ended", () => setPlaying(false));
      audio.addEventListener("pause", () => setPlaying(false));
      audio.addEventListener("play", () => setPlaying(true));
      await audio.play();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Nie udało się wygenerować audio";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card hover:bg-muted transition text-sm font-medium disabled:opacity-60"
        aria-label={label}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : playing ? (
          <PauseIcon className="w-4 h-4" />
        ) : (
          <PlayIcon className="w-4 h-4" />
        )}
        <span>{label}</span>
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
