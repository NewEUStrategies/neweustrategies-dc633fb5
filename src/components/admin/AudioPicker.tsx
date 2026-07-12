// Audio (MP3) picker for posts. Wgrywa plik do bucketa `media` (folder
// `posts-audio/<tenant>/<uid>/`) i zwraca publiczny URL. Umożliwia też
// wklejenie zewnętrznego linku lub wyczyszczenie pola. Gdy wpis ma wgrane
// audio dla danego języka, sidebar player NIE angażuje ElevenLabs - odtwarza
// bezpośrednio ten plik. Walidacja obejmuje: MIME + rozszerzenie, limit 50 MB,
// wykrycie uszkodzonego pliku (metadata error). Po sukcesie prezentujemy
// czas trwania i toast, po błędach - jednoznaczne komunikaty PL/EN.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Upload, Link as LinkIcon, X, Mic, Clock } from "@/lib/lucide-shim";
import { formatAudioTime } from "@/lib/audio/global-player";

interface Props {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  /** Widoczna wskazówka pod polem (np. informacja o TTS fallback). */
  hint?: string;
  bucket?: string;
  folder?: string;
}

const COPY = {
  pl: {
    upload: "Wgraj MP3",
    uploading: "Wgrywam…",
    remove: "Usuń plik (powrót do lektora AI)",
    empty: "Brak pliku audio - dla tego języka użyty zostanie lektor AI (ElevenLabs)",
    fileTooLarge: "Plik jest za duży - maksymalnie 50 MB",
    invalidType: "Nieprawidłowy format. Dozwolone: MP3, M4A, AAC, OGG, WAV",
    corrupt: "Plik audio jest uszkodzony lub nieczytelny",
    uploadOk: "Plik audio wgrany",
    duration: "Czas trwania",
    removed: "Plik audio usunięty - wrócono do lektora AI",
  },
  en: {
    upload: "Upload MP3",
    uploading: "Uploading…",
    remove: "Remove file (fall back to AI narration)",
    empty: "No audio file - AI narration (ElevenLabs) will be used for this language",
    fileTooLarge: "File is too large - maximum 50 MB",
    invalidType: "Invalid format. Allowed: MP3, M4A, AAC, OGG, WAV",
    corrupt: "Audio file is corrupted or unreadable",
    uploadOk: "Audio file uploaded",
    duration: "Duration",
    removed: "Audio file removed - AI narration will be used",
  },
} as const;

const MAX_BYTES = 50 * 1024 * 1024;
const ACCEPT_MIME = /^audio\/(mpeg|mp3|mp4|x-m4a|aac|ogg|wav|x-wav)$/i;
const ACCEPT_EXT = /\.(mp3|m4a|aac|ogg|oga|wav)$/i;

async function probeAudioDuration(url: string): Promise<number | null> {
  if (typeof window === "undefined") return null;
  return new Promise((resolve) => {
    const el = document.createElement("audio");
    el.preload = "metadata";
    el.src = url;
    let done = false;
    const finish = (v: number | null) => {
      if (done) return;
      done = true;
      el.src = "";
      resolve(v);
    };
    el.addEventListener("loadedmetadata", () => {
      const d = Number.isFinite(el.duration) ? el.duration : null;
      finish(d);
    });
    el.addEventListener("error", () => finish(null));
    // Fail-safe: nie blokujemy UI, gdy przeglądarka nie doczyta metadanych.
    window.setTimeout(() => finish(null), 8000);
  });
}

export function AudioPicker({
  label,
  value,
  onChange,
  hint,
  bucket = "media",
  folder = "posts-audio",
}: Props) {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const t = COPY[lang];
  const tenantId = useRequiredTenant();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState(value ?? "");
  const [duration, setDuration] = useState<number | null>(null);

  // Wczytujemy metadane (czas trwania) dla aktualnego URL - zarówno po uploadzie
  // jak i po wklejeniu linku. Reset po usunięciu pliku.
  useEffect(() => {
    setUrlDraft(value ?? "");
    if (!value) {
      setDuration(null);
      return;
    }
    let cancelled = false;
    void probeAudioDuration(value).then((d) => {
      if (!cancelled) setDuration(d);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  const validate = (file: File): string | null => {
    const okMime = ACCEPT_MIME.test(file.type);
    const okExt = ACCEPT_EXT.test(file.name);
    // Niektóre przeglądarki nie ustawiają MIME (drag&drop z Findera). Wtedy
    // patrzymy na rozszerzenie - i odwrotnie, gdy MIME jest ok, ale plik
    // nazwany bez rozszerzenia.
    if (!okMime && !okExt) return t.invalidType;
    if (file.size > MAX_BYTES) return t.fileTooLarge;
    if (file.size === 0) return t.corrupt;
    return null;
  };

  const handleFile = async (file: File) => {
    setError(null);
    const problem = validate(file);
    if (problem) {
      setError(problem);
      toast.error(problem);
      return;
    }
    // Probe metadanych przed uploadem - łapie ewidentnie uszkodzone pliki
    // (np. zmienione rozszerzenie na .mp3), zanim zapłacimy za storage.
    const localUrl = URL.createObjectURL(file);
    const probed = await probeAudioDuration(localUrl);
    URL.revokeObjectURL(localUrl);
    if (probed === null) {
      setError(t.corrupt);
      toast.error(t.corrupt);
      return;
    }
    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? "anon";
      const ext = (file.name.split(".").pop() || "mp3").toLowerCase();
      const path = `${folder}/${tenantId}/${uid}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
        cacheControl: "31536000",
        upsert: false,
        contentType: file.type || "audio/mpeg",
      });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      onChange(data.publicUrl);
      setUrlDraft(data.publicUrl);
      setDuration(probed);
      toast.success(`${t.uploadOk} · ${formatAudioTime(probed)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload error";
      setError(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  const clear = () => {
    onChange("");
    setUrlDraft("");
    setDuration(null);
    setError(null);
    toast.success(t.removed);
  };

  const commitUrl = () => {
    const v = urlDraft.trim();
    if (v !== value) onChange(v);
  };

  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}

      {value ? (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-brand shrink-0" />
            <div className="flex-1 min-w-0 text-xs text-foreground truncate" title={value}>
              {value.split("/").pop() || value}
            </div>
            <button
              type="button"
              onClick={clear}
              className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-border hover:bg-destructive hover:text-destructive-foreground transition-colors"
              title={t.remove}
              aria-label={t.remove}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {duration !== null && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="w-3 h-3" aria-hidden />
              <span>
                {t.duration}:{" "}
                <span className="tabular-nums text-foreground">{formatAudioTime(duration)}</span>
              </span>
            </div>
          )}
          <audio src={value} controls preload="metadata" className="w-full h-8" />
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border p-3 text-[11px] text-muted-foreground text-center">
          {t.empty}
        </div>
      )}

      <div className="grid grid-cols-1 gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="h-8 text-xs"
        >
          <Upload className="w-3.5 h-3.5 mr-1" />
          {uploading ? t.uploading : t.upload}
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <LinkIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <Input
          type="url"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onBlur={commitUrl}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitUrl();
            }
          }}
          placeholder="https://…/audio.mp3"
          className="h-8 text-xs"
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/wav,.mp3,.m4a,.aac,.ogg,.wav"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />

      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
      {error && (
        <div className="text-[11px] text-destructive" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
