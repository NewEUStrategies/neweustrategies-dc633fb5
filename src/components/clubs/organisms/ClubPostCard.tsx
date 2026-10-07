// Karta wpisu klubowego (A31) - jednostka "ściany".
//
// CZYM SIĘ RÓŻNI OD KARTY WĄTKU. Wątek sprzedaje TEMAT: tytuł jest największym
// elementem, treść jest zajawką, a liczniki mówią, ile się dzieje. Wpis nie ma
// tytułu, więc pierwszym elementem jest AUTOR (twarz, nazwisko z firmą,
// stanowisko, czas), a treść i załącznik są całym komunikatem. Dlatego
// zdjęcia, nagrania i podgląd linku sięgają krawędzi karty - to one niosą
// informację (`ClubFeedGallery`, kadrowanie w `lib/clubs/feedMedia.ts`).
//
// PODPIĘCIE POD WĄTEK jest pokazane ZAWSZE, gdy istnieje - w linii kontekstu
// nad kartą, bo to jedyna rzecz, która łączy krótką formę ze strukturą klubu,
// i bez widocznego oznaczenia użytkownik nie ma jak się dowiedzieć, że jego
// wpis wylądował też w rozmowie.
//
// ADRESY PLIKÓW SĄ WSTRZYKIWANE, nie pobierane tutaj. Kubełek jest prywatny,
// więc każdy plik potrzebuje podpisu - a podpisywanie per karta znaczyłoby
// tyle żądań, ile wpisów na ekranie. Mapa `mediaUrls` przychodzi z jednego
// zbiorczego zapytania nad całym strumieniem.
//
// KOMENTARZE SĄ POD WPISEM, NIE W WĄTKU. Wpis ma własną, płaską rozmowę
// (`ClubFeedComments`): „Komentuj" i licznik komentarzy rozwijają ją w karcie,
// z fokusem w polu. Gość i członek bez prawa głosu w dziale też ją rozwijają -
// czytają komentarze i dostają powód zamiast kompozytora, nie martwy przycisk.
// Adres powiadomienia (`?post=<id>`) rozwija komentarze tej karty sam
// (`focusComments`), bez kradzieży fokusu.
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ExternalLink,
  Eye,
  MessageSquareText,
  MessagesSquare,
  MoreHorizontal,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { ClubAuthorIdentity } from "@/components/clubs/atoms/ClubAuthorIdentity";
import { ClubFeedText } from "@/components/clubs/atoms/ClubFeedText";
import { HUB_LABEL } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubInlineTitle } from "@/components/clubs/atoms/ClubInlineTitle";
import { ClubProse } from "@/components/clubs/atoms/ClubProse";
import { clubReactionInkClass } from "@/components/clubs/atoms/ClubReactionGlyph";
import { ClubSourceChip } from "@/components/clubs/atoms/ClubSourceChip";
import {
  CLUB_FEED_ACTION_ICON,
  CLUB_FEED_ACTION_LABEL,
  CLUB_FEED_COUNTER,
  CLUB_FEED_COUNTER_LABEL,
  CLUB_FEED_PAD,
  ClubFeedActionBar,
  ClubFeedActor,
  ClubFeedCard,
  ClubFeedCommentsZone,
  ClubFeedContext,
  ClubFeedMedia,
  ClubFeedSocialRow,
  ClubFeedTime,
  clubFeedActionClass,
} from "@/components/clubs/molecules/ClubFeedCard";
import { ClubFeedGallery, ClubFeedVideo } from "@/components/clubs/molecules/ClubFeedGallery";
import { ClubFeedShareAction } from "@/components/clubs/molecules/ClubFeedShareAction";
import { ClubReactionSummary } from "@/components/clubs/molecules/ClubEngagementBar";
import { ClubFeedComments } from "@/components/clubs/molecules/ClubFeedComments";
import { clubFeedDiscussionMode } from "@/components/clubs/molecules/feedDiscussion";
import { hasFeedDraft, postDraftKey } from "@/components/clubs/molecules/feedDrafts";
import { useMentionEntity } from "@/components/mentions/MentionDirectory";
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
import { uiLang } from "@/lib/i18n/format";

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

/**
 * Podgląd linku: obraz 1.91:1 od krawędzi do krawędzi, pod nim tytuł i host na
 * stonowanym pasie - kształt, w jakim serwisy podają `og:image` (1200 x 627).
 * Opis nie mieści się na karcie, więc żyje w dymku po najechaniu.
 */
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
      className="group/link block bg-muted/50 transition-colors hover:bg-muted"
      data-testid="club-post-link"
    >
      {attachment.image !== null ? (
        <span className="block overflow-hidden bg-muted" style={{ aspectRatio: 1.91 }}>
          <img
            src={attachment.image}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover/link:scale-[1.02] motion-reduce:transition-none"
          />
        </span>
      ) : null}
      <span className={cn("block py-2.5", CLUB_FEED_PAD)}>
        {/* Pełny tytuł i host - bez przycinania; goły adres (brak tytułu)
            łamie się w dowolnym miejscu zamiast rozpychać kartę. */}
        <span className="block text-sm font-semibold leading-5 text-foreground [overflow-wrap:anywhere] group-hover/link:underline">
          {attachment.title ?? attachment.url}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {host ?? t("club.post.link")}
        </span>
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

/** Dokument wpisu - kafel strony z rodzajem pliku, nazwą, wagą i akcjami. */
function FileAttachmentRow({
  item,
  url,
  onPreview,
}: {
  item: ClubPostMediaAttachment;
  url: string | undefined;
  onPreview: (file: DocumentViewerFile) => void;
}) {
  const { t } = useTranslation();
  const previewable = isPreviewable(item.mime, item.name);
  const size = formatBytes(item.size);
  return (
    <div className="group/file flex items-center gap-3 rounded-lg border border-border/70 bg-muted/30 p-2.5 transition-colors hover:border-primary/40">
      {/* Kafel strony z zagiętym rogiem - dokument rozpoznawalny bez czytania.
          Szerokość rośnie z etykietą (`PAGES`, `MPEG4`), zamiast ciąć jej
          pierwszą i ostatnią literę zagiętym rogiem. */}
      <span className="relative grid h-12 min-w-10 shrink-0 px-1 place-items-center rounded-md border border-primary/20 bg-primary/10 text-[10px] font-bold uppercase tracking-wider text-primary [clip-path:polygon(0_0,72%_0,100%_22%,100%_100%,0_100%)]">
        {fileLabel(item.name, item.mime)}
      </span>
      <span className="min-w-0 flex-1">
        {/* Nazwa pliku zawija się (także bez spacji) - rozszerzenie i numer
            wersji na końcu nazwy to często jedyne, czym pliki się różnią. */}
        <span className="block text-sm font-medium [overflow-wrap:anywhere]">{item.name}</span>
        <span className="block text-xs text-muted-foreground">
          {size}
          {previewable ? `${size !== "" ? " · " : ""}${t("club.post.preview")}` : ""}
        </span>
      </span>
      {previewable ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs"
          disabled={url === undefined}
          onClick={() => {
            if (url !== undefined) {
              onPreview({ url, name: item.name, mime: item.mime, size: item.size });
            }
          }}
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
}

/** Menu zarządzania wpisem - zamyka się po wyborze, kliknięciu obok i Escape. */
function PostMenu({ onDelete }: { onDelete: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
        aria-label={t("club.post.menu")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </Button>
      {open ? (
        <div className="club-feed-picker-in absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg [transform-origin:top_right]">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-destructive hover:bg-muted"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t("club.post.delete")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ClubPostCard({
  post,
  clubSlug,
  mediaUrls,
  sourceIndex = EMPTY_SOURCES,
  activeGroupId = null,
  onSourceSelect,
  onLike,
  onDelete,
  canComment = true,
  signedIn = false,
  focusComments = false,
  /** Ukrywa plakietkę wątku tam, gdzie wątek JEST kontekstem ekranu. */
  hideThreadLink = false,
  index = 0,
  className,
}: {
  post: ClubPostRow;
  clubSlug: string;
  mediaUrls: Record<string, string>;
  /** Kolory i ikony działów - budowane RAZ nad listą, nie per karta. */
  sourceIndex?: ReadonlyMap<string, ClubSourceMark>;
  activeGroupId?: string | null;
  onSourceSelect?: (groupId: string | null) => void;
  onLike?: (postId: string) => void;
  onDelete?: (postId: string) => void;
  /** Prawo głosu w klubie (sesja i `can_reply`). Iloczyn z `post.can_comment`
   *  (prawo w DZIALE wpisu, liczone przez bazę) decyduje o kompozytorze. */
  canComment?: boolean;
  /** Sesja czytelnika - gość dostaje w sekcji drogę do logowania. */
  signedIn?: boolean;
  /** Wpis wskazany adresem - komentarze rozwijają się same. */
  focusComments?: boolean;
  hideThreadLink?: boolean;
  /** Pozycja w strumieniu - kaskada wejścia. */
  index?: number;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { openFile, viewer } = useDocumentViewer();
  const entity = useMentionEntity(post.author_slug);
  // Zmiana klucza restartuje odbicie piktogramu po docenieniu.
  const [tapKey, setTapKey] = useState(0);

  const attachments: ClubPostAttachment[] = parseClubPostAttachments(post.attachments);
  const links = attachments.filter(isLinkAttachment);
  const media = attachments.filter(
    (item): item is ClubPostMediaAttachment => !isLinkAttachment(item),
  );
  const images = media.filter((item) => item.type === "image");
  const videos = media.filter((item) => item.type === "video");
  const files = media.filter((item) => item.type === "file");
  const authorName = post.author_name ?? t("club.deletedAuthor");
  const source = clubSourceOf(post, sourceIndex, lang);
  const jobTitle = entity !== null && entity.kind === "person" ? entity.jobTitle : null;
  const showThread = !hideThreadLink && post.thread_slug !== null;
  const threadPath = post.thread_slug !== null ? `/club/${clubSlug}/t/${post.thread_slug}` : null;

  const openMedia = (item: ClubPostMediaAttachment, url: string): void =>
    openFile({ url, name: item.name, mime: item.mime, size: item.size });

  const likeOthers = post.like_count - (post.liked_by_me ? 1 : 0);

  const commentsId = useId();
  // `mounted` zostaje po zwinięciu, a szkic żyje w rejestrze poza kartą
  // (`feedDrafts`): karta, która wraca do strumienia z niewysłanym
  // komentarzem, sama rozwija rozmowę, w której ten szkic czeka.
  const [comments, setComments] = useState(() => {
    const open = focusComments || hasFeedDraft(postDraftKey(post.id));
    return { open, mounted: open, focusKey: 0 };
  });
  const openComments = (focus: boolean): void =>
    setComments((current) => ({
      open: true,
      mounted: true,
      focusKey: focus ? current.focusKey + 1 : current.focusKey,
    }));
  const toggleComments = (): void =>
    comments.open ? setComments((current) => ({ ...current, open: false })) : openComments(true);
  // Wejście z powiadomienia (karta już stała w strumieniu, zmienił się adres):
  // rozwinięcie BEZ fokusu - czytelnik przyszedł czytać, a fokus w polu
  // otwierałby klawiaturę na telefonie.
  useEffect(() => {
    if (!focusComments) return;
    setComments((current) =>
      current.open && current.mounted ? current : { ...current, open: true, mounted: true },
    );
  }, [focusComments]);
  const commentCount = Math.max(0, post.comment_count);

  return (
    <ClubFeedCard
      tone="post"
      index={index}
      testId="club-feed-post"
      postId={post.id}
      className={className}
    >
      {showThread && post.thread_slug !== null ? (
        <ClubFeedContext>
          <span className="inline-flex items-center gap-1.5">
            <MessagesSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("club.hub.feed.postInThread")}
          </span>
          {/* Tytuł wątku jest etykietą jak dział na karcie wątku - pełny,
              zawinięty do kolejnej linii, a nie ucięty wielokropkiem. */}
          <Link
            to="/club/$clubSlug/t/$threadSlug"
            params={{ clubSlug, threadSlug: post.thread_slug }}
            className="inline-flex min-w-0 max-w-full items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="club-post-thread-link"
          >
            <ClubInlineTitle tone="thread" size="sm" interactive className={HUB_LABEL}>
              {post.thread_title ?? t("club.post.inThread")}
            </ClubInlineTitle>
          </Link>
        </ClubFeedContext>
      ) : null}

      <ClubFeedActor
        avatar={
          <ClubAuthorAvatar
            name={authorName}
            avatarUrl={post.author_avatar}
            size="lg"
            muted={post.author_id === null}
          />
        }
        name={
          <ClubAuthorIdentity
            author={{
              kind: post.author_id === null ? "unknown" : "named",
              name: authorName,
              avatarUrl: post.author_avatar,
              profileSlug: post.author_slug,
            }}
            nameClassName="text-sm font-semibold leading-5 text-foreground [overflow-wrap:anywhere]"
            wrap
          />
        }
        headline={jobTitle ?? undefined}
        meta={
          <>
            <ClubFeedTime iso={post.created_at} lang={lang} />
            {post.edited_at !== null ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{t("club.post.edited")}</span>
              </>
            ) : null}
            {/* Ten sam znacznik źródła, co na karcie wątku - wpis ze ściany
                należy do działu dokładnie tak samo jak wątek. Bez kropki
                przed nim: etykieta ma własną ramkę, a kropka zostawała sama
                na końcu linii, gdy etykieta schodziła do następnej. */}
            {source !== null ? (
              <ClubSourceChip
                source={source}
                active={source.id !== null && source.id === activeGroupId}
                onSelect={onSourceSelect}
              />
            ) : null}
          </>
        }
        trailing={
          post.can_manage && onDelete !== undefined ? (
            <PostMenu onDelete={() => onDelete(post.id)} />
          ) : undefined
        }
      />

      {post.body.trim() !== "" ? (
        <div className={cn("pt-2.5", CLUB_FEED_PAD)}>
          <ClubFeedText className="text-sm leading-6">
            <ClubProse body={post.body} clubSlug={clubSlug} size="sm" className="max-w-none" />
          </ClubFeedText>
        </div>
      ) : null}

      {images.length > 0 ? (
        <ClubFeedMedia>
          <ClubFeedGallery images={images} mediaUrls={mediaUrls} onOpen={openMedia} />
        </ClubFeedMedia>
      ) : null}

      {videos.map((item) => (
        <ClubFeedMedia key={item.path}>
          <ClubFeedVideo item={item} url={mediaUrls[item.path]} />
        </ClubFeedMedia>
      ))}

      {files.length > 0 ? (
        <div className={cn("mt-3 flex flex-col gap-2", CLUB_FEED_PAD)}>
          {files.map((item) => (
            <FileAttachmentRow
              key={item.path}
              item={item}
              url={mediaUrls[item.path]}
              onPreview={openFile}
            />
          ))}
        </div>
      ) : null}

      {links.map((link) => (
        <ClubFeedMedia key={link.url}>
          <LinkAttachmentCard attachment={link} />
        </ClubFeedMedia>
      ))}
      {viewer}

      <ClubFeedSocialRow
        left={
          post.like_count > 0 ? (
            <ClubReactionSummary
              kinds={["agree"]}
              total={post.like_count}
              // Docenienie stawia się raz na osobę - licznik JEST liczbą osób.
              people={post.like_count}
              mine={post.liked_by_me}
            />
          ) : null
        }
        right={
          media.length > 0 || commentCount > 0 ? (
            <>
              {commentCount > 0 ? (
                <button
                  type="button"
                  onClick={() => openComments(true)}
                  aria-expanded={comments.open}
                  aria-controls={commentsId}
                  className={CLUB_FEED_COUNTER}
                  data-testid="club-post-comment-count"
                >
                  <span className={CLUB_FEED_COUNTER_LABEL}>
                    {t("club.comments.count", { count: commentCount })}
                  </span>
                </button>
              ) : null}
              {commentCount > 0 && media.length > 0 ? <span aria-hidden="true">·</span> : null}
              {media.length > 0 ? (
                <span>{t("club.post.attachmentsCount", { count: media.length })}</span>
              ) : null}
            </>
          ) : null
        }
      />

      <ClubFeedActionBar label={t("club.hub.feed.actionsLabel")}>
        <button
          type="button"
          className={clubFeedActionClass({
            className: post.liked_by_me ? clubReactionInkClass("agree") : undefined,
          })}
          aria-pressed={post.liked_by_me}
          aria-label={
            likeOthers > 0
              ? t("club.hub.feed.likeWithCount", { count: post.like_count })
              : t("club.post.like")
          }
          onClick={
            onLike === undefined
              ? undefined
              : () => {
                  if (!post.liked_by_me) setTapKey((key) => key + 1);
                  onLike(post.id);
                }
          }
          disabled={onLike === undefined}
          data-testid="club-post-like"
        >
          <span key={tapKey} className={cn("inline-flex", tapKey > 0 && "club-reaction-tap")}>
            <ThumbsUp
              className={CLUB_FEED_ACTION_ICON}
              strokeWidth={post.liked_by_me ? 2.4 : 2}
              aria-hidden="true"
            />
          </span>
          <span className={CLUB_FEED_ACTION_LABEL}>{t("club.post.like")}</span>
        </button>

        {/* KOMENTARZ ZOSTAJE POD WPISEM - przełącznik sekcji rozmowy karty.
            Stoi także u gościa i u członka bez prawa głosu: rozwinięcie pokazuje
            komentarze i powód braku kompozytora, a nie martwy przycisk. */}
        <button
          type="button"
          onClick={toggleComments}
          aria-expanded={comments.open}
          aria-controls={commentsId}
          aria-label={
            commentCount > 0
              ? t("club.hub.feed.commentWithCount", { n: commentCount })
              : t("club.hub.feed.comment")
          }
          className={clubFeedActionClass({
            className: comments.open ? "bg-secondary text-foreground" : undefined,
          })}
          data-testid="club-post-comment"
        >
          <MessageSquareText className={CLUB_FEED_ACTION_ICON} aria-hidden="true" />
          <span className={CLUB_FEED_ACTION_LABEL}>{t("club.hub.feed.comment")}</span>
        </button>

        {/* Wpis nie ma własnego adresu - udostępnia się rozmowę, w której stoi. */}
        {threadPath !== null && !hideThreadLink ? (
          <ClubFeedShareAction path={threadPath} title={post.thread_title ?? ""} />
        ) : null}
      </ClubFeedActionBar>

      <ClubFeedCommentsZone
        id={commentsId}
        open={comments.open}
        label={t("club.comments.sectionLabel")}
      >
        {comments.mounted ? (
          <ClubFeedComments
            post={post}
            clubSlug={clubSlug}
            focusKey={comments.focusKey}
            mode={clubFeedDiscussionMode({
              signedIn,
              canWrite: canComment && post.can_comment,
            })}
          />
        ) : null}
      </ClubFeedCommentsZone>
    </ClubFeedCard>
  );
}
