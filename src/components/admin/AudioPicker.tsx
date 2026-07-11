// Audio (MP3) picker for posts. Wgrywa plik do bucketa `media` (folder
// `posts-audio/<tenant>/<uid>/`) i zwraca publiczny URL. Umożliwia też
// wklejenie zewnętrznego linku lub wyczyszczenie pola. Gdy wpis ma wgrane
// audio dla danego języka, sidebar player NIE angażuje ElevenLabs - odtwarza
// bezpośrednio ten plik.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Upload, Link as LinkIcon, X, Music } from "@/lib/lucide-shim";

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
    remove: "Usuń",
    empty: "Brak pliku audio - dla tego języka użyty zostanie lektor AI",
    fileTooLarge: "Plik jest za duży (max 50 MB)",
    invalidType: "Wybierz plik audio (MP3 / M4A / OGG / WAV)",
  },
  en: {
    upload: "Upload MP3",
    uploading: "Uploading…",
    remove: "Remove",
    empty: "No audio file - AI narration will be used for this language",
    fileTooLarge: "File is too large (max 50 MB)",
    invalidType: "Choose an audio file (MP3 / M4A / OGG / WAV)",
  },
} as const;

const MAX_BYTES = 50 * 1024 * 1024;
const ACCEPT_MIME = /^audio\/(mpeg|mp3|mp4|x-m4a|aac|ogg|wav|x-wav)$/i;

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

  const handleFile = async (file: File) => {
    setError(null);
    if (!ACCEPT_MIME.test(file.type)) {
      setError(t.invalidType);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t.fileTooLarge);
      return;
    }
    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? "anon";
      const ext = file.name.split(".").pop()?.toLowerCase() || "mp3";
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload error");
    } finally {
      setUploading(false);
    }
  };

  const clear = () => {
    onChange("");
    setUrlDraft("");
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
            <Music className="w-4 h-4 text-brand shrink-0" />
            <div className="flex-1 min-w-0 text-xs text-foreground truncate" title={value}>
              {value.split("/").pop() || value}
            </div>
            <button
              type="button"
              onClick={clear}
              className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-border hover:bg-destructive hover:text-destructive-foreground"
              title={t.remove}
              aria-label={t.remove}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <audio src={value} controls preload="none" className="w-full h-8" />
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
        accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/wav"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />

      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
      {error && <div className="text-[10px] text-destructive">{error}</div>}
    </div>
  );
}
