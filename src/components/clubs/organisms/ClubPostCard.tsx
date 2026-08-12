// Karta wpisu klubowego (A31) - jednostka "ściany".
//
// CZYM SIĘ RÓŻNI OD KARTY WĄTKU. Wątek sprzedaje TEMAT: tytuł jest największym
// elementem, treść jest zajawką, a liczniki mówią, ile się dzieje. Wpis nie ma
// tytułu, więc pierwszym elementem jest AUTOR, a treść i załącznik są całym
// komunikatem. Dlatego ta karta jest cichsza typograficznie i szersza wizualnie:
// zdjęcie i podgląd linku sięgają krawędzi treści, bo to one niosą informację.
//
// PODPIĘCIE POD WĄTEK jest pokazane ZAWSZE, gdy istnieje - to jedyna rzecz,
// która łączy krótką formę ze strukturą klubu, i bez widocznego oznaczenia
// użytkownik nie ma jak się dowiedzieć, że jego wpis wylądował też w rozmowie.
//
// ADRESY PLIKÓW SĄ WSTRZYKIWANE, nie pobierane tutaj. Kubełek jest prywatny,
// więc każdy plik potrzebuje podpisu - a podpisywanie per karta znaczyłoby
// tyle żądań, ile wpisów na ekranie. Mapa `mediaUrls` przychodzi z jednego
// zbiorczego zapytania nad całym strumieniem.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ExternalLink,
  Eye,
  Maximize2,
  MessageSquarePlus,
  MessagesSquare,
  MoreHorizontal,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HUB_SURFACE } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { ClubInlineTitle } from "@/components/clubs/atoms/ClubInlineTitle";
import { ClubSourceChip } from "@/components/clubs/atoms/ClubSourceChip";
import { clubSourceOf, type ClubSourceMark } from "@/lib/clubs/threadSources";
import { fileLabel, isPreviewable } from "@/lib/files/fileKinds";
import { useDocumentViewer } from "@/components/files/useDocumentViewer";
import type { DocumentViewerFile } from "@/components/files/DocumentViewerDialog";
import {
  isLinkAttachment,
  parseClubPostAttachments,
  type ClubPostAttachment,
  type ClubPostLinkAttachment,
  type ClubPostMediaAttachment,
  type ClubPostRow,
} from "@/lib/clubs/postTypes";
import { formatDateShort } from "@/lib/i18n/format";

/** Stała pusta mapa - literał w domyślnej wartości propa tworzyłby NOWĄ mapę
 *  przy każdym renderze i psuł memoizację kart. */
const EMPTY_SOURCES: ReadonlyMap<string, ClubSourceMark> = new Map();

function formatBytes(size: number): string {
  if (size <= 0) return "";
  const units = ["B", "kB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Treść wpisu z klikalnymi adresami. Bez HTML-a: wpis jest tekstem, a
 *  wstrzykiwanie znaczników z pola użytkownika to gotowy XSS. */
function PostBody({ body }: { body: string }) {
  const parts = body.split(/(\bhttps?:\/\/[^\s<>"')]+)/g);
  return (
    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
      {parts.map((part, index) =>
        /^https?:\/\//i.test(part) ? (
          <a
            key={`${part}-${index}`}
            href={part}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
          >
            {part.replace(/^https?:\/\//, "")}
          </a>
        ) : (
          <span key={`t-${index}`}>{part}</span>
        ),
      )}
    </p>
  );
}

/** Karta podglądu linku + popup po najechaniu (Radix HoverCard). */
function LinkAttachmentCard({ attachment }: { attachment: ClubPostLinkAttachment }) {
  const { t } = useTranslation();
  let host = attachment.siteName;
  try {
    host = attachment.siteName ?? new URL(attachment.url).hostname;
  } catch {
    /* zostaje to, co przyszło z serwera */
  }

  const card = (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="mt-3 block overflow-hidden rounded-lg border border-border/70 transition-colors hover:border-primary/40"
      data-testid="club-post-link"
    >
      {attachment.image !== null ? (
        <img
          src={attachment.image}
          alt=""
          loading="lazy"
          className="h-40 w-full object-cover sm:h-48"
        />
      ) : null}
      <span className="block px-3 py-2">
        <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
          {host ?? t("club.post.link")}
        </span>
        <span className="mt-0.5 block truncate text-sm font-medium text-foreground">
          {attachment.title ?? attachment.url}
        </span>
        {attachment.description !== null ? (
          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
            {attachment.description}
          </span>
        ) : null}
      </span>
    </a>
  );

  if (attachment.description === null && attachment.image === null) return card;

  return (
    <HoverCardPrimitive.Root openDelay={120} closeDelay={80}>
      <HoverCardPrimitive.Trigger asChild>{card}</HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-50 w-80 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
        >
          {attachment.image !== null ? (
            <img src={attachment.image} alt="" className="h-36 w-full object-cover" />
          ) : null}
          <div className="p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {host ?? t("club.post.link")}
            </p>
            <p className="mt-0.5 text-sm font-medium">{attachment.title ?? attachment.url}</p>
            {attachment.description !== null ? (
              <p className="mt-1 text-xs text-muted-foreground">{attachment.description}</p>
            ) : null}
          </div>
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}

function MediaGrid({
  media,
  mediaUrls,
  onPreview,
}: {
  media: readonly ClubPostMediaAttachment[];
  mediaUrls: Record<string, string>;
  onPreview: (file: DocumentViewerFile) => void;
}) {
  const { t } = useTranslation();
  const images = media.filter((item) => item.type === "image");
  const videos = media.filter((item) => item.type === "video");
  const files = media.filter((item) => item.type === "file");

  const open = (item: ClubPostMediaAttachment, url: string | undefined): void => {
    if (url === undefined) return;
    onPreview({ url, name: item.name, mime: item.mime, size: item.size });
  };

  return (
    <>
      {images.length > 0 ? (
        <div
          className={cn(
            "mt-3 grid gap-1.5 overflow-hidden rounded-lg",
            images.length === 1 ? "grid-cols-1" : "grid-cols-2",
          )}
          data-testid="club-post-images"
        >
          {images.map((item) => {
            const url = mediaUrls[item.path];
            return (
              // Zdjęcie otwiera podgląd W PLATFORMIE, nie nową kartę: wyjście
              // do surowego podpisanego adresu gubi kontekst wpisu i pokazuje
              // użytkownikowi techniczny URL magazynu.
              <button
                key={item.path}
                type="button"
                disabled={url === undefined}
                onClick={() => open(item, url)}
                aria-label={`${t("club.post.preview")}: ${item.name}`}
                className={cn(
                  "group/img relative block overflow-hidden rounded-lg bg-muted",
                  images.length === 3 ? "first:col-span-2" : undefined,
                )}
                // Proporcja z metadanych: bez niej strumień skacze, gdy zdjęcia
                // dojeżdżają po podpisaniu adresów.
                style={
                  item.width !== null && item.height !== null
                    ? { aspectRatio: `${item.width} / ${item.height}` }
                    : { aspectRatio: "16 / 9" }
                }
              >
                {url === undefined ? (
                  <span className="block h-full w-full animate-pulse bg-muted" />
                ) : (
                  <>
                    <img
                      src={url}
                      alt={item.name}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover/img:scale-[1.02]"
                    />
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/0 opacity-0 transition-opacity duration-200 group-hover/img:bg-background/25 group-hover/img:opacity-100">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium shadow-sm">
                        <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("club.post.preview")}
                      </span>
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      ) : null}

      {videos.map((item) => {
        const url = mediaUrls[item.path];
        return (
          <div key={item.path} className="mt-3 overflow-hidden rounded-lg bg-black">
            {url === undefined ? (
              <div className="aspect-video w-full animate-pulse bg-muted" />
            ) : (
              // DŁUG DOSTĘPNOŚCI: nagranie wgrane przez członka nie ma ścieżki
              // napisów (`<track kind="captions">`), bo nie ma jej skąd wziąć -
              // przesyłający podaje sam plik. Do domknięcia razem z transkrypcją
              // po stronie serwera. Directive `eslint-disable` w tym miejscu był
              // MARTWY: reguła `jsx-a11y/media-has-caption` nie jest w tym repo
              // skonfigurowana, więc niczego nie wyciszał, a sam odwołaniem do
              // nieistniejącej reguły wywracał bramkę lintu.
              <video src={url} controls preload="metadata" className="aspect-video w-full" />
            )}
          </div>
        );
      })}

      {files.map((item) => {
        const url = mediaUrls[item.path];
        const previewable = isPreviewable(item.mime, item.name);
        return (
          <div
            key={item.path}
            className="group/file mt-3 flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2.5 transition-colors hover:border-primary/40"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-[10px] font-bold uppercase tracking-wider text-primary">
              {fileLabel(item.name, item.mime)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{item.name}</span>
              <span className="block text-xs text-muted-foreground">
                {formatBytes(item.size)}
                {previewable ? ` · ${t("club.post.preview")}` : ""}
              </span>
            </span>
            {previewable ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
                disabled={url === undefined}
                onClick={() => open(item, url)}
              >
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                {t("club.post.preview")}
              </Button>
            ) : null}
            <a
              href={url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${t("club.post.openFile")}: ${item.name}`}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        );
      })}
    </>
  );
}

export function ClubPostCard({
  post,
  clubSlug,
  isPl,
  mediaUrls,
  sourceIndex = EMPTY_SOURCES,
  activeGroupId = null,
  onSourceSelect,
  onLike,
  onDelete,
  canComment = true,
  /** Ukrywa plakietkę wątku tam, gdzie wątek JEST kontekstem ekranu. */
  hideThreadLink = false,
  className,
}: {
  post: ClubPostRow;
  clubSlug: string;
  isPl: boolean;
  mediaUrls: Record<string, string>;
  /** Kolory i ikony działów - budowane RAZ nad listą, nie per karta. */
  sourceIndex?: ReadonlyMap<string, ClubSourceMark>;
  activeGroupId?: string | null;
  onSourceSelect?: (groupId: string | null) => void;
  onLike?: (postId: string) => void;
  onDelete?: (postId: string) => void;
  /** Wyłącza wejście w dyskusję dla użytkownika bez prawa głosu w klubie. */
  canComment?: boolean;
  hideThreadLink?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const lang = isPl ? "pl" : "en";
  const [menuOpen, setMenuOpen] = useState(false);
  const { openFile, viewer } = useDocumentViewer();

  const attachments: ClubPostAttachment[] = parseClubPostAttachments(post.attachments);
  const links = attachments.filter(isLinkAttachment);
  const media = attachments.filter(
    (item): item is ClubPostMediaAttachment => !isLinkAttachment(item),
  );
  const authorName = post.author_name ?? t("club.deletedAuthor");
  const source = clubSourceOf(post, sourceIndex, isPl);

  return (
    <article
      className={cn(HUB_SURFACE, "p-3.5 sm:p-4", className)}
      data-testid="club-feed-post"
      data-post-id={post.id}
    >
      <div className="flex items-start gap-2.5">
        <ClubAuthorAvatar
          name={authorName}
          avatarUrl={post.author_avatar}
          size="sm"
          muted={post.author_id === null}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {post.author_slug !== null ? (
              <Link
                to="/author/$slug"
                params={{ slug: post.author_slug }}
                className="font-medium text-foreground hover:underline"
              >
                {authorName}
              </Link>
            ) : (
              <span className="font-medium text-foreground">{authorName}</span>
            )}
            {/* Ten sam znacznik źródła, co na karcie wątku - wpis ze ściany
                należy do działu dokładnie tak samo jak wątek i nie ma powodu,
                żeby jego pochodzenie wyglądało inaczej. */}
            {source !== null ? (
              <ClubSourceChip
                source={source}
                active={source.id !== null && source.id === activeGroupId}
                onSelect={onSourceSelect}
              />
            ) : null}
            <span aria-hidden="true">·</span>
            <time dateTime={post.created_at}>{formatDateShort(post.created_at, lang)}</time>
            {post.edited_at !== null ? <span>({t("club.post.edited")})</span> : null}
          </div>

          {!hideThreadLink && post.thread_slug !== null ? (
            <Link
              to="/club/$clubSlug/t/$threadSlug"
              params={{ clubSlug, threadSlug: post.thread_slug }}
              className="mt-1.5 inline-flex max-w-full items-center gap-1.5"
              data-testid="club-post-thread-link"
            >
              <MessagesSquare
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <ClubInlineTitle tone="thread" size="sm" interactive>
                {post.thread_title ?? t("club.post.inThread")}
              </ClubInlineTitle>
            </Link>
          ) : null}
        </div>

        {post.can_manage && onDelete !== undefined ? (
          <div className="relative">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg"
              aria-label={t("club.post.menu")}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
            {menuOpen ? (
              <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-destructive hover:bg-muted"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(post.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("club.post.delete")}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {post.body.trim() !== "" ? <PostBody body={post.body} /> : null}

      <MediaGrid media={media} mediaUrls={mediaUrls} onPreview={openFile} />
      {viewer}
      {links.map((link) => (
        <LinkAttachmentCard key={link.url} attachment={link} />
      ))}

      <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-2.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 gap-1.5 rounded-lg px-2.5 text-xs",
            post.liked_by_me && "text-primary",
          )}
          aria-pressed={post.liked_by_me}
          onClick={onLike === undefined ? undefined : () => onLike(post.id)}
          disabled={onLike === undefined}
        >
          <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
          {post.like_count > 0 ? post.like_count : t("club.post.like")}
        </Button>
        {/* KOMENTARZ PROWADZI DO WĄTKU. Wpis jest krótką formą i celowo nie ma
            własnej nitki komentarzy - pogłębiona dyskusja ma jedno miejsce.
            Gdy wpis jest już podpięty pod wątek, idziemy prosto do kompozytora
            odpowiedzi; gdy nie jest, jedyną uczciwą propozycją jest ZAŁOŻENIE
            wątku, a nie martwy przycisk. */}
        {canComment && !hideThreadLink ? (
          post.thread_slug !== null ? (
            <Button
              asChild
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
            >
              <Link
                to="/club/$clubSlug/t/$threadSlug"
                params={{ clubSlug, threadSlug: post.thread_slug }}
                search={{ reply: true }}
                data-testid="club-post-comment"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
                {t("club.post.comment")}
              </Link>
            </Button>
          ) : (
            <Button
              asChild
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
            >
              <Link
                to="/club/$clubSlug/new"
                params={{ clubSlug }}
                search={post.group_id === null ? {} : { groupId: post.group_id }}
                data-testid="club-post-start-thread"
              >
                <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />
                {t("club.post.startThread")}
              </Link>
            </Button>
          )
        ) : null}
        {media.length > 0 ? (
          <Badge variant="outline" className="rounded-lg text-[11px]">
            {t("club.post.attachmentsCount", { count: media.length })}
          </Badge>
        ) : null}
      </div>
    </article>
  );
}
