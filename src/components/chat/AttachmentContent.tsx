// Molecules: attachment rendering inside message bubbles.
// Images resolve short-lived signed URLs (private bucket) and open in a
// rich lightbox (zoom / rotate / pan). Files render as a download chip; PDFs
// gain a dedicated "Podgląd" action that opens an in-app iframe viewer.
// Voice notes render as a WhatsApp-style inline player.
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  Eye,
  FileText,
  FileSpreadsheet,
  Mic,
  Pause,
  Play,
  Presentation,
  File as FileIcon,
} from "lucide-react";
import { useAttachmentUrl, formatBytes } from "@/lib/chat/attachments";
import { formatVoiceDuration } from "@/lib/chat/voice";
import type { ChatLang } from "@/lib/chat/time";
import { cn } from "@/lib/utils";
import { ImageLightbox, PdfPreviewDialog } from "./AttachmentPreview";


export function AttachmentImage({
  path,
  name,
  mine,
}: {
  path: string;
  name: string | null;
  mine: boolean;
}) {
  const { t } = useTranslation();
  const urlQ = useAttachmentUrl(path);
  const [open, setOpen] = useState(false);

  if (urlQ.isLoading) {
    return (
      <div
        className="h-40 w-52 max-w-full animate-pulse rounded-[6px] bg-muted"
        aria-label={t("chat.photo")}
      />
    );
  }
  if (!urlQ.data) {
    return (
      <div className="rounded-[6px] bg-muted px-3 py-2 text-xs text-muted-foreground">
        {t("chat.uploadFailed")}
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "block overflow-hidden rounded-[6px] border border-border/40 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          mine ? "ml-auto" : "",
        )}
        aria-label={name ?? t("chat.photo")}
      >
        <img
          src={urlQ.data}
          alt={name ?? t("chat.photo")}
          loading="lazy"
          className="max-h-60 w-auto max-w-[240px] object-cover"
        />
      </button>
      <ImageLightbox
        open={open}
        onOpenChange={setOpen}
        images={[{ url: urlQ.data, name }]}
        index={0}
      />
    </>
  );
}


export function AttachmentAudio({
  path,
  duration,
  mine,
}: {
  path: string;
  duration: number | null;
  mine: boolean;
}) {
  const { t } = useTranslation();
  const urlQ = useAttachmentUrl(path);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [elapsed, setElapsed] = useState(0);

  // Callback ref: React calls it with null on unmount - pause mid-playback
  // audio there (a detached <audio> element can keep playing otherwise).
  const setAudioRef = useCallback((el: HTMLAudioElement | null) => {
    if (!el) audioRef.current?.pause();
    audioRef.current = el;
  }, []);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) el.pause();
    else void el.play();
  };

  const total = duration ?? Math.round(audioRef.current?.duration ?? 0) ?? 0;

  return (
    <div
      className={cn(
        "flex w-[220px] max-w-full items-center gap-2.5 rounded-[6px] border px-3 py-2.5",
        mine
          ? "border-primary/20 bg-primary text-primary-foreground"
          : "border-border/60 bg-muted text-foreground",
      )}
    >
      {urlQ.data && (
        <audio
          ref={setAudioRef}
          src={urlQ.data}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
            setElapsed(0);
          }}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            const totalSeconds = duration ?? el.duration ?? 0;
            setElapsed(el.currentTime);
            setProgress(totalSeconds > 0 ? Math.min(1, el.currentTime / totalSeconds) : 0);
          }}
        />
      )}
      <button
        type="button"
        onClick={toggle}
        disabled={!urlQ.data}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
          mine
            ? "bg-primary-foreground/15 hover:bg-primary-foreground/25"
            : "bg-background hover:bg-background/70",
        )}
        aria-label={playing ? t("chat.voice.pause") : t("chat.voice.play")}
        title={playing ? t("chat.voice.pause") : t("chat.voice.play")}
      >
        {playing ? (
          <Pause className="h-4 w-4" aria-hidden />
        ) : (
          <Play className="ml-0.5 h-4 w-4" aria-hidden />
        )}
      </button>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block h-1.5 overflow-hidden rounded-full",
            mine ? "bg-primary-foreground/20" : "bg-background",
          )}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label={t("chat.voice.message")}
        >
          <span
            className={cn(
              "block h-full rounded-full transition-[width] duration-150",
              mine ? "bg-primary-foreground/80" : "bg-[var(--brand)]",
            )}
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </span>
        <span
          className={cn(
            "mt-1 flex items-center gap-1 text-[10px] tabular-nums",
            mine ? "opacity-80" : "text-muted-foreground",
          )}
        >
          <Mic className="h-3 w-3" aria-hidden />
          {playing || elapsed > 0 ? formatVoiceDuration(elapsed) : formatVoiceDuration(total)}
        </span>
      </span>
    </div>
  );
}

function fileIconFor(mime: string | null) {
  if (!mime) return FileIcon;
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv")
    return FileSpreadsheet;
  if (mime.includes("presentation") || mime.includes("powerpoint")) return Presentation;
  return FileText;
}

export function AttachmentFile({
  path,
  name,
  mime,
  size,
  mine,
  lang,
}: {
  path: string;
  name: string | null;
  mime: string | null;
  size: number | null;
  mine: boolean;
  lang: ChatLang;
}) {
  const { t } = useTranslation();
  const urlQ = useAttachmentUrl(path);
  const Icon = fileIconFor(mime);
  const isPdf = mime === "application/pdf";
  const [pdfOpen, setPdfOpen] = useState(false);
  const label = name ?? t("chat.file");

  return (
    <>
      <div
        className={cn(
          "flex max-w-[260px] items-center gap-2.5 rounded-[6px] border px-3 py-2.5 transition-colors",
          mine
            ? "border-primary/20 bg-primary text-primary-foreground"
            : "border-border/60 bg-muted text-foreground",
        )}
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px]",
            mine ? "bg-primary-foreground/15" : "bg-background",
          )}
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{label}</span>
          {typeof size === "number" && size > 0 && (
            <span
              className={cn("block text-[10px]", mine ? "opacity-75" : "text-muted-foreground")}
            >
              {formatBytes(size, lang)}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {isPdf && (
            <button
              type="button"
              onClick={() => setPdfOpen(true)}
              disabled={!urlQ.data}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
                mine
                  ? "hover:bg-primary-foreground/20"
                  : "text-muted-foreground hover:bg-background hover:text-foreground",
              )}
              aria-label={t("chat.preview.previewPdf", { defaultValue: "Podgląd" })}
              title={t("chat.preview.previewPdf", { defaultValue: "Podgląd" })}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
          <a
            href={urlQ.data ?? "#"}
            download={name ?? undefined}
            target="_blank"
            rel="noreferrer noopener"
            aria-disabled={!urlQ.data}
            onClick={(e) => {
              if (!urlQ.data) e.preventDefault();
            }}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mine
                ? "hover:bg-primary-foreground/20"
                : "text-muted-foreground hover:bg-background hover:text-foreground",
            )}
            aria-label={t("chat.download")}
            title={t("chat.download")}
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
          </a>
        </span>
      </div>
      {isPdf && (
        <PdfPreviewDialog
          open={pdfOpen}
          onOpenChange={setPdfOpen}
          url={urlQ.data ?? null}
          name={name}
        />
      )}
    </>
  );
}

