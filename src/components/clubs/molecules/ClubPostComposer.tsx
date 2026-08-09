// Kompozytor wpisu klubowego (A31) - krótka forma ze ściany.
//
// Osobny od `ClubComposer`, który zakłada wątek. Wątek wymaga tytułu i decyzji
// "o czym rozmawiamy"; wpis ma być jednym ruchem: napisz, dorzuć plik, wyślij.
// Zlanie obu w jeden formularz zawsze kończy się polem tytułu, którego nikt
// przy krótkiej formie nie chce wypełniać.
//
// PLIKI LECĄ OD RAZU po wybraniu, nie przy wysyłce: użytkownik widzi postęp i
// błąd (limit, typ) zanim napisze treść, a wysyłka jest już tylko zapisem
// metadanych.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, Loader2, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { HUB_SURFACE } from "@/components/clubs/atoms/ClubHubPrimitives";
import { useCreateClubPost } from "@/lib/clubs/useClubPosts";
import { removeClubPostMedia, uploadClubPostMedia } from "@/lib/clubs/postsApi";
import {
  CLUB_POST_ACCEPT_MIME,
  type ClubPostMediaAttachment,
} from "@/lib/clubs/postTypes";

export function ClubPostComposer({
  clubId,
  groupId,
  threadId = null,
  canPost,
  className,
}: {
  clubId: string;
  groupId?: string | null;
  /** Ustawione na widoku wątku - wpis wchodzi wtedy także do tej rozmowy. */
  threadId?: string | null;
  canPost: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const create = useCreateClubPost(clubId);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<ClubPostMediaAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  if (!canPost) return null;

  const handleFiles = async (files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const attachment = await uploadClubPostMedia(file);
        setMedia((current) => [...current, attachment]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("club.post.uploadFailed"));
    } finally {
      setUploading(false);
      if (fileRef.current !== null) fileRef.current.value = "";
    }
  };

  const removeMedia = (path: string): void => {
    setMedia((current) => current.filter((item) => item.path !== path));
    // Sprzątanie kubełka jest "best effort": wpis i tak nie wskaże tego pliku.
    void removeClubPostMedia(path).catch(() => undefined);
  };

  const submit = (): void => {
    const trimmed = body.trim();
    if (trimmed === "" && media.length === 0) return;
    create.mutate(
      { groupId: groupId ?? null, threadId, body: trimmed, attachments: media },
      {
        onSuccess: () => {
          setBody("");
          setMedia([]);
          toast.success(t("club.post.published"));
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const busy = uploading || create.isPending;

  return (
    <section className={cn(HUB_SURFACE, "p-3.5 sm:p-4", className)} data-testid="club-post-composer">
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={t("club.post.placeholder")}
        aria-label={t("club.post.placeholder")}
        className="min-h-[72px] resize-none rounded-lg border-border/70 text-sm"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
        }}
      />

      {media.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {media.map((item) => (
            <li
              key={item.path}
              className="flex max-w-full items-center gap-1.5 rounded-lg border border-border/70 px-2 py-1 text-xs"
            >
              <span className="truncate">{item.name}</span>
              <button
                type="button"
                aria-label={t("club.post.removeAttachment", { name: item.name })}
                onClick={() => removeMedia(item.path)}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={CLUB_POST_ACCEPT_MIME}
            className="sr-only"
            onChange={(event) => void handleFiles(event.target.files)}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {t("club.post.addMedia")}
          </Button>
          <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
            <Paperclip className="h-3 w-3" aria-hidden="true" />
            {t("club.post.mediaHint")}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5 rounded-lg px-3 text-xs"
          disabled={busy || (body.trim() === "" && media.length === 0)}
          onClick={submit}
        >
          {create.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {t("club.post.publish")}
        </Button>
      </div>
    </section>
  );
}
