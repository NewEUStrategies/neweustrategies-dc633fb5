// Side panel with Photos/Files tabs showing every attachment ever sent in
// this conversation. Feeds off useConversationAttachments (server-side
// filtered by attachment_path IS NOT NULL) so it works regardless of how
// far back the visible message pagination has scrolled.
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileText, ImageIcon, X } from "lucide-react";
import { useAttachmentUrl, formatBytes } from "@/lib/chat/attachments";
import { useConversationAttachments, type ChatAttachmentRow } from "@/lib/chat/useMessages";
import { cn } from "@/lib/utils";

type Tab = "photos" | "files";

interface Props {
  readonly conversationId: string;
  readonly enabled: boolean;
  readonly onClose: () => void;
  readonly className?: string;
  /** Pre-supplied rows (bot mode: always empty). */
  readonly localRows?: ReadonlyArray<ChatAttachmentRow>;
}

function isImageRow(r: ChatAttachmentRow): boolean {
  if (r.kind === "image") return true;
  const mime = r.attachment_mime ?? "";
  return mime.startsWith("image/");
}

function PhotoTile({ row }: { row: ChatAttachmentRow }) {
  const urlQ = useAttachmentUrl(row.attachment_path);
  return (
    <a
      href={urlQ.data ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group relative aspect-square overflow-hidden rounded-[8px] bg-muted",
        !urlQ.data && "pointer-events-none",
      )}
      aria-label={row.attachment_name ?? "photo"}
    >
      {urlQ.data ? (
        <img
          src={urlQ.data}
          alt={row.attachment_name ?? ""}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-muted" />
      )}
    </a>
  );
}

function FileRow({ row, lang }: { row: ChatAttachmentRow; lang: string }) {
  const urlQ = useAttachmentUrl(row.attachment_path);
  const date = new Date(row.created_at).toLocaleDateString(lang === "en" ? "en-US" : "pl-PL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return (
    <a
      href={urlQ.data ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      download={row.attachment_name ?? undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-[8px] border border-border/60 bg-background px-2.5 py-2 text-left transition-colors hover:bg-muted/60",
        !urlQ.data && "pointer-events-none opacity-60",
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-muted text-muted-foreground">
        <FileText className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium">
          {row.attachment_name ?? row.attachment_path.split("/").pop()}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {row.attachment_size ? formatBytes(row.attachment_size, lang === "en" ? "en" : "pl") : ""}
          {row.attachment_size ? " - " : ""}
          {date}
        </span>
      </span>
      <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </a>
  );
}

export const ChatMediaPanel = memo(function ChatMediaPanel({
  conversationId,
  enabled,
  onClose,
  className,
  localRows,
}: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const [tab, setTab] = useState<Tab>("photos");
  const remoteQ = useConversationAttachments(conversationId, enabled && !localRows);
  const rows: ReadonlyArray<ChatAttachmentRow> = localRows ?? remoteQ.data ?? [];

  const { photos, files } = useMemo(() => {
    const p: ChatAttachmentRow[] = [];
    const f: ChatAttachmentRow[] = [];
    for (const r of rows) (isImageRow(r) ? p : f).push(r);
    return { photos: p, files: f };
  }, [rows]);

  const loading = !localRows && remoteQ.isLoading;

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col border-l border-border/60 bg-background/60",
        className,
      )}
      aria-label={t("chat.mediaPanel.title")}
    >
      <header className="flex items-center gap-2 border-b border-border/60 px-2.5 py-1.5">
        <p className="flex-1 truncate text-[12px] font-semibold">{t("chat.mediaPanel.title")}</p>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("chat.mediaPanel.close")}
          title={t("chat.mediaPanel.close")}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </header>
      <div
        role="tablist"
        aria-label={t("chat.mediaPanel.title")}
        className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "photos"}
          onClick={() => setTab("photos")}
          className={cn(
            "inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium transition-colors",
            tab === "photos"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <ImageIcon className="h-3 w-3" aria-hidden />
          {t("chat.mediaPanel.tabPhotos")}
          <span className="tabular-nums opacity-70">({photos.length})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "files"}
          onClick={() => setTab("files")}
          className={cn(
            "inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium transition-colors",
            tab === "files"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <FileText className="h-3 w-3" aria-hidden />
          {t("chat.mediaPanel.tabFiles")}
          <span className="tabular-nums opacity-70">({files.length})</span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        {loading ? (
          <p className="py-6 text-center text-[11px] text-muted-foreground">
            {t("chat.mediaPanel.loading")}
          </p>
        ) : tab === "photos" ? (
          photos.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-muted-foreground">
              {t("chat.mediaPanel.emptyPhotos")}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {photos.map((r) => (
                <PhotoTile key={r.id} row={r} />
              ))}
            </div>
          )
        ) : files.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-muted-foreground">
            {t("chat.mediaPanel.emptyFiles")}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {files.map((r) => (
              <FileRow key={r.id} row={r} lang={lang} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
});
