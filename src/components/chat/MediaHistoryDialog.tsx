// Historia załączników w rozmowie: galeria zdjęć + lista plików.
// Prosty widok bez paginacji - dla podglądu wątku i realnych konwersacji,
// gdzie liczba załączników mieści się w oknie sesji. Otwarcie obrazka
// w nowej karcie (blob: / signed URL działa tak samo, bo używamy
// `useAttachmentUrl` per pozycja).
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileText, ImageIcon, Download } from "lucide-react";
import type { ChatMessage } from "@/lib/chat/types";
import type { ChatLang } from "@/lib/chat/time";
import { formatBytes } from "@/lib/chat/attachments";
import { clockTime, dayLabel } from "@/lib/chat/time";
import { useAttachmentUrl } from "@/lib/chat/attachments";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface MediaHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: readonly ChatMessage[];
  lang: ChatLang;
}

interface Entry {
  message: ChatMessage;
  kind: "image" | "file";
}

function ImageTile({ entry, lang }: { entry: Entry; lang: ChatLang }) {
  const { t } = useTranslation();
  const url = useAttachmentUrl(entry.message.attachment_path);
  const label = entry.message.attachment_name ?? "";
  const time = clockTime(entry.message.created_at, lang);
  if (!url) {
    return (
      <div
        className="aspect-square animate-pulse rounded-[6px] bg-muted"
        aria-label={t("chat.mediaHistory.loading", { defaultValue: "Ładowanie..." })}
      />
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block aspect-square overflow-hidden rounded-[6px] border border-border/60 bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={`${label} - ${time}`}
    >
      <img
        src={url}
        alt={label}
        loading="lazy"
        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
      />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
        {time}
      </span>
    </a>
  );
}

function FileRow({ entry, lang }: { entry: Entry; lang: ChatLang }) {
  const { t } = useTranslation();
  const url = useAttachmentUrl(entry.message.attachment_path);
  const name = entry.message.attachment_name ?? "";
  const size = entry.message.attachment_size ?? 0;
  const time = `${dayLabel(entry.message.created_at, lang)} - ${clockTime(entry.message.created_at, lang)}`;
  return (
    <div className="flex items-center gap-2.5 rounded-[6px] border border-border/60 bg-muted/30 px-2.5 py-2">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-background text-muted-foreground"
        aria-hidden
      >
        <FileText className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 text-[12px]">
        <span className="block truncate font-medium text-foreground">{name}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {formatBytes(size, lang)} - {time}
        </span>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          download={name}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("chat.mediaHistory.download", { defaultValue: "Pobierz plik" })}
          title={t("chat.mediaHistory.download", { defaultValue: "Pobierz plik" })}
        >
          <Download className="h-4 w-4" aria-hidden />
        </a>
      )}
    </div>
  );
}

export function MediaHistoryDialog({
  open,
  onOpenChange,
  messages,
  lang,
}: MediaHistoryDialogProps) {
  const { t } = useTranslation();

  const { images, files } = useMemo(() => {
    const imgs: Entry[] = [];
    const fls: Entry[] = [];
    for (const m of messages) {
      if (m.deleted_at || !m.attachment_path) continue;
      if (m.kind === "image") imgs.push({ message: m, kind: "image" });
      else if (m.kind === "file" || m.kind === "video" || m.kind === "audio") {
        fls.push({ message: m, kind: "file" });
      }
    }
    // Najnowsze u góry.
    imgs.reverse();
    fls.reverse();
    return { images: imgs, files: fls };
  }, [messages]);

  const totalCount = images.length + files.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-3 p-4 sm:p-5">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-base">
            {t("chat.mediaHistory.title", { defaultValue: "Multimedia i pliki" })}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("chat.mediaHistory.subtitle", {
              defaultValue: "Historia załączników wysłanych w tej rozmowie",
              count: totalCount,
            })}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="media" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="media" className="gap-1.5 text-xs">
              <ImageIcon className="h-3.5 w-3.5" aria-hidden />
              {t("chat.mediaHistory.tabMedia", { defaultValue: "Multimedia" })}
              <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                {images.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="files" className="gap-1.5 text-xs">
              <FileText className="h-3.5 w-3.5" aria-hidden />
              {t("chat.mediaHistory.tabFiles", { defaultValue: "Pliki" })}
              <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                {files.length}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="media" className="mt-3">
            {images.length === 0 ? (
              <div className="rounded-[6px] border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
                {t("chat.mediaHistory.emptyMedia", {
                  defaultValue: "Brak zdjęć w tej rozmowie",
                })}
              </div>
            ) : (
              <ScrollArea className="h-[52vh] pr-2">
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                  {images.map((entry) => (
                    <ImageTile key={entry.message.id} entry={entry} lang={lang} />
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="files" className="mt-3">
            {files.length === 0 ? (
              <div className="rounded-[6px] border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
                {t("chat.mediaHistory.emptyFiles", {
                  defaultValue: "Brak plików w tej rozmowie",
                })}
              </div>
            ) : (
              <ScrollArea className="h-[52vh] pr-2">
                <div className="flex flex-col gap-1.5">
                  {files.map((entry) => (
                    <FileRow key={entry.message.id} entry={entry} lang={lang} />
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
