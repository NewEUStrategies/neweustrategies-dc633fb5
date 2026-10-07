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
//
// ZDJĘCIE WIDAĆ TAK, JAK POKAŻE JE STRUMIEŃ. Miniatura ma ramę liczoną tą samą
// regułą, co karta (`clubFeedFrame`), a pod nią stoi rozpoznany format
// (poziome 1.91:1, kwadrat 1:1, pionowe 4:5) i uwagi jakości: za mała
// rozdzielczość, waga ponad 5 MB, proporcja spoza kadru. To są podpowiedzi,
// nie blokady - wpis z każdą z nich da się opublikować.
//
// TRZY DROGI DO PLIKU: przyciski (zdjęcie / wideo / plik), upuszczenie na
// kompozytor i wklejenie ze schowka (zrzut ekranu wykresu to najczęstszy
// załącznik w think tanku).
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  FileText,
  Film,
  Image as ImageIcon,
  Info,
  Loader2,
  Paperclip,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { applyListAutoformat } from "@/lib/text/listAutoformat";
import { HUB_SURFACE } from "@/components/clubs/atoms/ClubHubPrimitives";
import { useCreateClubPost } from "@/lib/clubs/useClubPosts";
import { removeClubPostMedia, uploadClubPostMedia } from "@/lib/clubs/postsApi";
import {
  CLUB_POST_ACCEPT_ATTR,
  CLUB_POST_IMAGE_MIME,
  CLUB_POST_VIDEO_MIME,
  type ClubPostMediaAttachment,
} from "@/lib/clubs/postTypes";
import {
  CLUB_POST_IMAGE_FORMATS,
  clubFeedFrame,
  clubImageAdvice,
  clubImageFormat,
} from "@/lib/clubs/feedMedia";

/** Co otwiera wybór plików: zdjęcia, nagrania albo wszystko, co przyjmuje kubełek. */
type MediaPick = "image" | "video" | "any";

const ACCEPT: Record<MediaPick, string> = {
  image: CLUB_POST_IMAGE_MIME.join(","),
  video: CLUB_POST_VIDEO_MIME.join(","),
  any: CLUB_POST_ACCEPT_ATTR,
};

/** Wysokość miniatury w kompozytorze; szerokość wynika z ramy strumienia. */
const THUMB_PX = 88;

function objectUrl(file: File): string | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

function revoke(url: string | undefined): void {
  if (url !== undefined && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
}

export function ClubPostComposer({
  clubId,
  groupId,
  threadId = null,
  canPost,
  chromeless = false,
  className,
}: {
  clubId: string;
  groupId?: string | null;
  /** Ustawione na widoku wątku - wpis wchodzi wtedy także do tej rozmowy. */
  threadId?: string | null;
  canPost: boolean;
  /** Bez własnej ramki - kompozytor stoi wtedy wewnątrz karty z zakładkami. */
  chromeless?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const create = useCreateClubPost(clubId);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<ClubPostMediaAttachment[]>([]);
  // Lokalne podglądy zdjęć (blob:) - zanim kubełek odda podpisany adres.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  // Adresy blob: żyją, dopóki ich nie zwolnimy - rejestr pozwala posprzątać
  // te, które zostały, gdy kompozytor znika razem z niewysłanym wpisem.
  const blobUrls = useRef<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const created = blobUrls.current;
    return () => {
      created.forEach((url) => revoke(url));
      created.clear();
    };
  }, []);

  const release = (url: string | undefined): void => {
    if (url === undefined) return;
    revoke(url);
    blobUrls.current.delete(url);
  };

  if (!canPost) return null;

  const pick = (kind: MediaPick): void => {
    const input = fileRef.current;
    if (input === null) return;
    input.accept = ACCEPT[kind];
    input.click();
  };

  const handleFiles = async (files: FileList | File[] | null): Promise<void> => {
    if (files === null || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const attachment = await uploadClubPostMedia(file);
        setMedia((current) => [...current, attachment]);
        if (attachment.type === "image") {
          const url = objectUrl(file);
          if (url !== null) {
            blobUrls.current.add(url);
            setPreviews((current) => ({ ...current, [attachment.path]: url }));
          }
        }
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
    release(previews[path]);
    setPreviews((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
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
          Object.values(previews).forEach(release);
          setPreviews({});
          toast.success(t("club.post.published"));
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const busy = uploading || create.isPending;
  const images = media.filter((item) => item.type === "image");
  const others = media.filter((item) => item.type !== "image");
  const advice = images.flatMap((item) => clubImageAdvice(item).map((code) => ({ code, item })));
  const sizesHint = t("club.post.sizes.hint", {
    formats: CLUB_POST_IMAGE_FORMATS.map(
      (format) =>
        `${format.width}×${format.height} (${t(`club.post.sizes.format.${format.key}`)} ${format.ratio})`,
    ).join(" · "),
  });

  return (
    <section
      className={cn(chromeless ? "" : cn(HUB_SURFACE, "p-3.5 sm:p-4"), className)}
      data-testid="club-post-composer"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        // Upuszczenie zdjęcia na kompozytor - ten sam tor co wybór z dysku.
        // Domyślną akcję przeglądarki (otwarcie pliku zamiast strony, czyli
        // utrata szkicu) blokujemy ZAWSZE, także w trakcie wysyłki.
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        if (busy || event.dataTransfer.files.length === 0) return;
        void handleFiles(event.dataTransfer.files);
      }}
    >
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={t("club.post.placeholder")}
        aria-label={t("club.post.placeholder")}
        className="min-h-[72px] resize-none rounded-lg border-border/70 text-sm"
        onPaste={(event) => {
          // Zrzut ekranu wklejony skrótem trafia tym samym torem, co wybór
          // z dysku. Sam tekst wkleja się normalnie - przechwytujemy tylko pliki.
          const pasted = Array.from(event.clipboardData.files);
          if (pasted.length === 0 || busy) return;
          // Word, Excel i PowerPoint kładą obok tekstu jego OBRAZEK - wtedy
          // członek wkleja tekst, a nie zrzut, więc zostawiamy przeglądarce.
          if (event.clipboardData.getData("text/plain").trim() !== "") return;
          event.preventDefault();
          void handleFiles(pasted);
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            submit();
            return;
          }
          const target = event.currentTarget;
          const result = applyListAutoformat(
            target.value,
            target.selectionStart ?? target.value.length,
            target.selectionEnd ?? target.value.length,
            event.key,
          );
          if (result !== null) {
            event.preventDefault();
            setBody(result.value);
            requestAnimationFrame(() => target.setSelectionRange(result.cursor, result.cursor));
          }
        }}
      />

      {images.length > 0 ? (
        <div className="mt-2.5" data-testid="club-post-composer-images">
          <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {images.map((item) => {
              const frame = clubFeedFrame(item);
              const format = clubImageFormat(item);
              const flagged = clubImageAdvice(item).length > 0;
              const src = previews[item.path];
              return (
                <li key={item.path} className="club-reaction-pop shrink-0">
                  <div
                    className="group/thumb relative overflow-hidden rounded-lg border border-border/70 bg-muted"
                    style={{ height: THUMB_PX, width: Math.round(THUMB_PX * frame.ratio) }}
                  >
                    {src !== undefined ? (
                      <img
                        src={src}
                        alt=""
                        className={cn(
                          "h-full w-full",
                          frame.fit === "contain" ? "object-contain" : "object-cover",
                        )}
                      />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-muted-foreground">
                        <ImageIcon className="h-5 w-5" aria-hidden="true" />
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={t("club.post.removeAttachment", { name: item.name })}
                      onClick={() => removeMedia(item.path)}
                      className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md bg-background/90 text-foreground shadow-sm transition-colors hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    {format !== null ? (
                      <span
                        className={cn(
                          "absolute bottom-1 left-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                          flagged ? "bg-amber-700 text-white" : "bg-background/90 text-foreground",
                        )}
                      >
                        {flagged ? <AlertTriangle className="h-3 w-3" aria-hidden="true" /> : null}
                        {CLUB_POST_IMAGE_FORMATS.find((entry) => entry.key === format)?.ratio}
                      </span>
                    ) : null}
                  </div>
                  <span
                    className="mt-1 block truncate text-[11px] text-muted-foreground"
                    style={{ maxWidth: Math.max(THUMB_PX, Math.round(THUMB_PX * frame.ratio)) }}
                  >
                    {item.name}
                  </span>
                </li>
              );
            })}
          </ul>

          {advice.length > 0 ? (
            <ul className="mt-1.5 space-y-1" data-testid="club-post-image-advice">
              {advice.map(({ code, item }) => (
                <li
                  key={`${item.path}:${code}`}
                  className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {t(`club.post.sizes.advice.${code}`, {
                      name: item.name,
                      width:
                        CLUB_POST_IMAGE_FORMATS.find((entry) => entry.key === clubImageFormat(item))
                          ?.width ?? 1080,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{sizesHint}</span>
          </p>
        </div>
      ) : null}

      {others.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {others.map((item) => (
            <li
              key={item.path}
              className="flex max-w-full items-center gap-1.5 rounded-lg border border-border/70 px-2 py-1 text-xs"
            >
              {item.type === "video" ? (
                <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : (
                <FileText
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
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
        <div className="flex min-w-0 items-center gap-0.5">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={CLUB_POST_ACCEPT_ATTR}
            className="sr-only"
            onChange={(event) => void handleFiles(event.target.files)}
          />
          {/* Szybkie wejścia jak w każdym kompozytorze publikacji: zdjęcie,
              nagranie, plik. Zalecane rozmiary zdjęć stoją w podpowiedzi. */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-lg px-2 text-xs"
            disabled={busy}
            title={sizesHint}
            onClick={() => pick("image")}
            data-testid="club-post-pick-image"
          >
            <ImageIcon className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
            <span className="hidden sm:inline">{t("club.post.media.photo")}</span>
            <span className="sr-only sm:hidden">{t("club.post.media.photo")}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-lg px-2 text-xs"
            disabled={busy}
            onClick={() => pick("video")}
            data-testid="club-post-pick-video"
          >
            <Film className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span className="hidden sm:inline">{t("club.post.media.video")}</span>
            <span className="sr-only sm:hidden">{t("club.post.media.video")}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-lg px-2 text-xs"
            disabled={busy}
            title={t("club.post.mediaHint")}
            aria-label={t("club.post.addMedia")}
            onClick={() => pick("any")}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Paperclip
                className="h-4 w-4 text-orange-600 dark:text-orange-400"
                aria-hidden="true"
              />
            )}
            <span className="hidden sm:inline" aria-hidden="true">
              {t("club.post.media.file")}
            </span>
          </Button>
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
