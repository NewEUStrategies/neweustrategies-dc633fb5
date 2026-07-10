// Molecules: attachment rendering inside message bubbles.
// Images resolve short-lived signed URLs (private bucket) and open in a
// lightbox dialog; files render as a download chip.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileText, FileSpreadsheet, Presentation, File as FileIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAttachmentUrl, formatBytes } from "@/lib/chat/attachments";
import type { ChatLang } from "@/lib/chat/time";
import { cn } from "@/lib/utils";

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
        className="h-40 w-52 max-w-full animate-pulse rounded-2xl bg-muted"
        aria-label={t("chat.photo")}
      />
    );
  }
  if (!urlQ.data) {
    return (
      <div className="rounded-2xl bg-muted px-3 py-2 text-xs text-muted-foreground">
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
          "block overflow-hidden rounded-2xl border border-border/40 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl border-none bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">{name ?? t("chat.photo")}</DialogTitle>
          <img
            src={urlQ.data}
            alt={name ?? t("chat.photo")}
            className="max-h-[80vh] w-full rounded-lg object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
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
  return (
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
        "group/file flex max-w-[240px] items-center gap-2.5 rounded-2xl border px-3 py-2.5 transition-colors",
        mine
          ? "border-primary/20 bg-primary text-primary-foreground hover:bg-primary/90"
          : "border-border/60 bg-muted text-foreground hover:bg-muted/70",
      )}
      title={t("chat.download")}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          mine ? "bg-primary-foreground/15" : "bg-background",
        )}
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{name ?? t("chat.file")}</span>
        {typeof size === "number" && size > 0 && (
          <span className={cn("block text-[10px]", mine ? "opacity-75" : "text-muted-foreground")}>
            {formatBytes(size, lang)}
          </span>
        )}
      </span>
      <Download
        className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover/file:opacity-70"
        aria-hidden
      />
    </a>
  );
}
