import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Link as LinkIcon, Info, X } from "@/lib/lucide-shim";
import { useContentAccess, type AccessEntityType } from "@/hooks/useContentAccess";
import { Paywall } from "@/components/Paywall";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMediaUsage, type MediaUsageArea } from "@/lib/media.functions";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// Usage areas arrive from the server as stable keys - the UI owns the words.
const USAGE_AREA_LABELS: Record<"pl" | "en", Record<MediaUsageArea, string>> = {
  pl: {
    cover: "Okładka",
    excerpt: "Zajawka",
    content: "Treść",
    builder: "Builder",
    blocks: "Bloki",
    layout: "Layout",
  },
  en: {
    cover: "Cover",
    excerpt: "Excerpt",
    content: "Content",
    builder: "Builder",
    blocks: "Blocks",
    layout: "Layout",
  },
};

const DownloadIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" x2="12" y1="15" y2="3" />
  </svg>
);

export interface PreviewableMedia {
  id: string;
  filename: string;
  public_url: string;
  mime_type: string | null;
  size_bytes?: number | null;
}

interface Props {
  item: PreviewableMedia | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When true, respect paywall rules for this media before showing the file/download */
  gated?: boolean;
  /** When true, show the "Used in" panel with links to CMS edit pages (admin only) */
  showUsage?: boolean;
}

export function MediaPreviewDialog({
  item,
  open,
  onOpenChange,
  gated = true,
  showUsage = false,
}: Props) {
  const { i18n } = useTranslation();
  const lang = (i18n.language?.startsWith("en") ? "en" : "pl") as "pl" | "en";
  // Hook needs a stable entity type; pass id only when gated + open
  const entityId = gated && open && item ? item.id : null;
  const { hasAccess, loading, rule } = useContentAccess("media" as AccessEntityType, entityId);

  const [downloading, setDownloading] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const mediaContainerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const download = async () => {
    if (!item) return;
    setDownloading(true);
    try {
      const res = await fetch(item.public_url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.filename || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(item.public_url, "_blank", "noopener");
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setDownloading(false);
      setInfoOpen(false);
    }
  }, [open]);

  useEffect(() => {
    setNaturalSize(null);
    setDuration(null);
  }, [item?.id]);

  if (!item) return null;

  const mime = item.mime_type ?? "";
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf" || item.filename.toLowerCase().endsWith(".pdf");
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");
  const isText = mime.startsWith("text/") || /\.(txt|md|csv|json|xml|log)$/i.test(item.filename);

  const blocked = gated && !loading && !hasAccess;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b border-border flex-row items-center justify-between space-y-0">
          <DialogTitle className="truncate pr-4">{item.filename}</DialogTitle>
          <div className="flex items-center gap-2 shrink-0 mr-10">
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {mime || "plik"}
              {item.size_bytes ? ` · ${formatBytes(item.size_bytes)}` : ""}
            </span>
            <Button
              size="sm"
              variant={infoOpen ? "default" : "outline"}
              onClick={() => setInfoOpen((o) => !o)}
              title={lang === "pl" ? "Informacje o pliku" : "File info"}
              aria-label={lang === "pl" ? "Informacje" : "Info"}
            >
              <Info className="w-4 h-4" />
            </Button>
            {!blocked && (
              <Button size="sm" onClick={download} disabled={downloading}>
                <DownloadIcon className="w-4 h-4 mr-2" />
                {downloading ? "..." : lang === "pl" ? "Pobierz" : "Download"}
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex overflow-hidden">
          <div
            className="flex-1 min-w-0 min-h-0 overflow-auto bg-muted/30"
            ref={mediaContainerRef}
          >
            {blocked && rule ? (
              <div className="p-6">
                <Paywall rule={rule} lang={lang} fallbackText={null} />
              </div>
            ) : loading && gated ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                {lang === "pl" ? "Sprawdzanie dostępu…" : "Checking access…"}
              </div>
            ) : isImage ? (
              <div className="h-full w-full flex items-center justify-center p-4">
                <img
                  ref={imgRef}
                  src={item.public_url}
                  alt={item.filename}
                  className="max-h-full max-w-full object-contain"
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight });
                  }}
                />
              </div>
            ) : isPdf ? (
              <iframe
                src={`${item.public_url}#toolbar=1&navpanes=0`}
                title={item.filename}
                className="w-full h-full border-0 bg-white"
              />
            ) : isVideo ? (
              <div className="h-full w-full flex items-center justify-center bg-black">
                <video
                  ref={videoRef}
                  src={item.public_url}
                  controls
                  className="max-h-full max-w-full"
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget;
                    setNaturalSize({ w: v.videoWidth, h: v.videoHeight });
                    setDuration(v.duration);
                  }}
                />
              </div>
            ) : isAudio ? (
              <div className="h-full flex items-center justify-center p-8">
                <audio
                  ref={audioRef}
                  src={item.public_url}
                  controls
                  className="w-full max-w-xl"
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                />
              </div>
            ) : isText ? (
              <iframe
                src={item.public_url}
                title={item.filename}
                className="w-full h-full border-0 bg-white"
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-8 text-muted-foreground">
                <FileText className="w-12 h-12 opacity-60" />
                <p className="text-sm">
                  {lang === "pl"
                    ? "Podgląd nie jest dostępny dla tego typu pliku."
                    : "Preview not available for this file type."}
                </p>
                <Button onClick={download} disabled={downloading}>
                  <DownloadIcon className="w-4 h-4 mr-2" />{" "}
                  {lang === "pl" ? "Pobierz plik" : "Download file"}
                </Button>
              </div>
            )}
          </div>

          {infoOpen && (
            <InfoSidebar
              item={item}
              lang={lang}
              naturalSize={naturalSize}
              duration={duration}
              onClose={() => setInfoOpen(false)}
            />
          )}
        </div>

        {showUsage && item && <UsagePanel mediaId={item.id} lang={lang} />}
      </DialogContent>
    </Dialog>
  );
}

function UsagePanel({ mediaId, lang }: { mediaId: string; lang: "pl" | "en" }) {
  const fetchUsage = useServerFn(getMediaUsage);
  const { data, isLoading, error } = useQuery({
    queryKey: ["media-usage", mediaId],
    queryFn: () => fetchUsage({ data: { mediaId } }),
  });
  const items = data?.items ?? [];
  return (
    <div className="border-t border-border bg-background p-3 max-h-[28vh] overflow-auto shrink-0">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {lang === "pl" ? "Używane w" : "Used in"}
        </h3>
        <span className="text-[10px] text-muted-foreground">
          {isLoading ? "…" : `${items.length}`}
        </span>
      </div>
      {error && (
        <p className="text-xs text-destructive">
          {error instanceof Error ? error.message : String(error)}
        </p>
      )}
      {!isLoading && !error && items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {lang === "pl"
            ? "Ten materiał nie jest jeszcze używany w żadnym poście ani stronie."
            : "This media is not used in any post or page yet."}
        </p>
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-border border border-border rounded-md overflow-hidden">
          {items.map((it) => (
            <li
              key={`${it.kind}-${it.id}`}
              className="p-2 flex items-center justify-between gap-3 hover:bg-muted/40 text-xs"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{it.title}</div>
                <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                  <span className="uppercase">
                    {it.kind === "post"
                      ? lang === "pl"
                        ? "Post"
                        : "Post"
                      : lang === "pl"
                        ? "Strona"
                        : "Page"}
                  </span>
                  <span>·</span>
                  <span className="truncate">/{it.slug}</span>
                  <span>·</span>
                  <span className="truncate">
                    {it.where.map((area) => USAGE_AREA_LABELS[lang][area]).join(", ")}
                  </span>
                </div>
              </div>
              <Link
                to={it.kind === "post" ? "/admin/posts/$slug" : "/admin/pages/$slug"}
                params={{ slug: it.slug }}
                className="shrink-0 inline-flex items-center gap-1 text-brand hover:underline"
              >
                {lang === "pl" ? "Edytuj" : "Edit"} <LinkIcon className="w-3 h-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- helpers ----------
function formatBytes(n: number | null | undefined): string {
  if (!n && n !== 0) return "-";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v = v / 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function formatDuration(sec: number | null): string {
  if (sec == null || !isFinite(sec)) return "-";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

/** Human-friendly file kind for a MIME + filename combo (PL/EN). */
function fileKind(mime: string, filename: string, lang: "pl" | "en"): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const T = (pl: string, en: string) => (lang === "pl" ? pl : en);
  if (mime.startsWith("image/gif") || ext === "gif") return T("GIF", "GIF");
  if (mime.startsWith("image/")) return T("Obraz", "Image");
  if (mime.startsWith("video/")) return T("Wideo", "Video");
  if (mime.startsWith("audio/")) return T("Audio", "Audio");
  if (mime === "application/pdf" || ext === "pdf") return T("PDF", "PDF");
  if (
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "doc" ||
    ext === "docx" ||
    ext === "rtf"
  )
    return T("Word", "Word");
  if (
    mime === "application/vnd.ms-excel" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    ext === "xls" ||
    ext === "xlsx" ||
    ext === "csv"
  )
    return T("Excel", "Excel");
  if (
    mime === "application/vnd.ms-powerpoint" ||
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    ext === "ppt" ||
    ext === "pptx"
  )
    return T("PowerPoint", "PowerPoint");
  if (
    ext === "epub" ||
    ext === "mobi" ||
    ext === "azw" ||
    ext === "azw3" ||
    mime === "application/epub+zip"
  )
    return T("E-book", "E-book");
  if (
    ext === "zip" ||
    ext === "rar" ||
    ext === "7z" ||
    ext === "tar" ||
    ext === "gz" ||
    mime === "application/zip" ||
    mime === "application/x-7z-compressed"
  )
    return T("Archiwum", "Archive");
  if (mime.startsWith("text/") || ["txt", "md", "json", "xml", "log", "csv"].includes(ext))
    return T("Tekst", "Text");
  return ext ? ext.toUpperCase() : T("Plik", "File");
}

// ---------- Info sidebar ----------
interface MediaDetailsRow {
  id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
  created_at: string;
  uploader_id: string | null;
  alt_text: string | null;
  folder_path: string | null;
}

function InfoSidebar({
  item,
  lang,
  naturalSize,
  duration,
  onClose,
}: {
  item: PreviewableMedia;
  lang: "pl" | "en";
  naturalSize: { w: number; h: number } | null;
  duration: number | null;
  onClose: () => void;
}) {
  const T = (pl: string, en: string) => (lang === "pl" ? pl : en);

  // Fetch full row (uploader, folder, created_at) - RLS scopes to tenant.
  const { data: details } = useQuery({
    queryKey: ["media-details", item.id],
    queryFn: async (): Promise<MediaDetailsRow | null> => {
      const { data, error } = await supabase
        .from("media")
        .select(
          "id, filename, mime_type, size_bytes, storage_path, created_at, uploader_id, alt_text, folder_path",
        )
        .eq("id", item.id)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  const uploaderId = details?.uploader_id ?? null;
  const { data: uploader } = useQuery({
    queryKey: ["media-uploader", uploaderId],
    enabled: !!uploaderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, email")
        .eq("id", uploaderId!)
        .maybeSingle();
      if (error) return null;
      return data;
    },
  });

  const mime = item.mime_type ?? details?.mime_type ?? "";
  const size = details?.size_bytes ?? item.size_bytes ?? null;
  const kind = useMemo(() => fileKind(mime, item.filename, lang), [mime, item.filename, lang]);

  const created = details?.created_at ? new Date(details.created_at) : null;
  const dpr =
    naturalSize && size ? (size / (naturalSize.w * naturalSize.h)).toFixed(2) : null;

  return (
    <aside className="w-80 shrink-0 border-l border-border bg-background overflow-y-auto">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Info className="w-4 h-4" /> {T("Informacje", "Info")}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-muted"
          aria-label={T("Zamknij", "Close")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <dl className="p-3 space-y-2 text-xs">
        <InfoRow label={T("Nazwa pliku", "Filename")} value={item.filename} title />
        <InfoRow label={T("Typ", "Kind")} value={kind} />
        <InfoRow label="MIME" value={mime || "-"} mono />
        {size != null && (
          <InfoRow
            label={T("Rozmiar", "Size")}
            value={`${formatBytes(size)} · ${size.toLocaleString(lang)} B`}
          />
        )}
        {naturalSize && (
          <InfoRow
            label={T("Wymiary", "Dimensions")}
            value={`${naturalSize.w} × ${naturalSize.h} px`}
          />
        )}
        {duration != null && (
          <InfoRow label={T("Czas trwania", "Duration")} value={formatDuration(duration)} />
        )}
        {dpr && (
          <InfoRow
            label={T("Bajtów na piksel", "Bytes / pixel")}
            value={dpr}
          />
        )}
        {details?.folder_path && (
          <InfoRow label={T("Folder", "Folder")} value={details.folder_path} mono />
        )}
        {details?.alt_text && (
          <InfoRow label={T("Tekst alternatywny", "Alt text")} value={details.alt_text} />
        )}
        {created && (
          <>
            <InfoRow
              label={T("Utworzono", "Created")}
              value={created.toLocaleString(lang === "pl" ? "pl-PL" : "en-US")}
            />
            <InfoRow
              label={T("Relatywnie", "Relative")}
              value={relativeTime(created, lang)}
            />
          </>
        )}
        {uploader && (
          <InfoRow
            label={T("Autor", "Uploaded by")}
            value={uploader.display_name || uploader.email || uploaderId || "-"}
          />
        )}
        {details?.storage_path && (
          <InfoRow label={T("Ścieżka", "Storage path")} value={details.storage_path} mono />
        )}
        <InfoRow label="ID" value={item.id} mono />
        <div className="pt-2 border-t border-border">
          <a
            href={item.public_url}
            target="_blank"
            rel="noreferrer"
            className="text-brand hover:underline break-all"
          >
            {item.public_url}
          </a>
        </div>
      </dl>
    </aside>
  );
}

function InfoRow({
  label,
  value,
  mono,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  title?: boolean;
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`min-w-0 break-words ${mono ? "font-mono text-[11px]" : ""} ${
          title ? "font-medium" : ""
        }`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function relativeTime(date: Date, lang: "pl" | "en"): string {
  const diff = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(lang === "pl" ? "pl-PL" : "en-US", {
    numeric: "auto",
  });
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 2592000) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 31536000) return rtf.format(Math.round(diff / 2592000), "month");
  return rtf.format(Math.round(diff / 31536000), "year");
}
