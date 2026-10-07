// Molekuła: komentarze wpisu ściany wprost w karcie strumienia.
//
// PO CO. Do tej pory „Komentuj" pod wpisem prowadziło do wątku albo do
// zakładania wątku - czyli każde „dzięki, przeczytam" kosztowało zmianę
// ekranu, a wpis bez wątku nie miał gdzie zebrać odpowiedzi. Teraz rozmowa
// o wpisie toczy się pod nim: kompozytor na górze, pod nim najnowsze
// komentarze (domyślnie trzy), wyżej „Wczytaj wcześniejsze komentarze (N)".
//
// KOMENTARZE SĄ PŁASKIE. „Odpowiedz" wstawia `@slug ` autora do kompozytora:
// wzmianka powiadamia adresata, a lista nie buduje gałęzi, której karta
// i tak nie miałaby gdzie pokazać. Przy pseudonimie (Chatham House) nie ma
// czego wstawić - i nie ma przycisku.
//
// LINK W KOMENTARZU. Pierwszy adres https w szkicu dostaje podgląd (debounce,
// best-effort, „×" odrzuca); przy wysyłce MIGAWKA jedzie do bazy
// (`p_link_preview`), a czytelnicy dostają zapisane pięć pól - bez pytania
// serwera podglądów przy każdym odczycie.
//
// KATALOG WZMIANEK. Sekcja ma WŁASNY `MentionDirectoryProvider` z autorami
// komentarzy i wzmiankami w ich treści (`discussionDirectorySlugs`) -
// zagnieżdżony dostawca zastępuje zewnętrzny, więc zestaw musi być kompletny.
//
// INSTANCJE MUTACJI PER KARTA (komponent jest montowany w karcie), więc stan
// „w drodze" jednej karty nie blokuje kompozytorów pozostałych.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MentionDirectoryProvider } from "@/components/mentions/MentionDirectory";
import {
  CLUB_FEED_DISCUSSION_ACTION,
  ClubFeedDiscussionComposer,
  ClubFeedDiscussionItem,
  ClubFeedDiscussionNotice,
} from "@/components/clubs/molecules/ClubFeedDiscussion";
import { useComposerLinkPreview } from "@/components/clubs/molecules/useComposerLinkPreview";
import {
  appendMentionToDraft,
  discussionDirectorySlugs,
  type ClubFeedDiscussionMode,
} from "@/components/clubs/molecules/feedDiscussion";
import {
  CLUB_POST_COMMENT_MAX,
  canSubmitClubComment,
  clubCommentErrorKey,
  parseClubLinkSnapshot,
  type ClubPostRow,
} from "@/lib/clubs/postTypes";
import {
  useClubPostComments,
  useCreateClubPostComment,
  useDeleteClubPostComment,
} from "@/lib/clubs/useClubPosts";
import { toAuthorLabel } from "@/lib/clubs/types";
import { uiLang } from "@/lib/i18n/format";

export function ClubFeedComments({
  post,
  clubSlug,
  mode,
  focusKey = 0,
}: {
  post: Pick<ClubPostRow, "id" | "club_id">;
  clubSlug: string;
  mode: ClubFeedDiscussionMode;
  /** Każda zmiana (> 0) przenosi fokus do pola - rozwinięcie „Komentuj". */
  focusKey?: number;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const clubId = post.club_id;
  const thread = useClubPostComments({ clubId, postId: post.id });
  const create = useCreateClubPostComment(clubId);
  const remove = useDeleteClubPostComment(clubId);
  const [draft, setDraft] = useState("");
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const writable = mode === "write";
  const link = useComposerLinkPreview(draft, writable);
  const canSubmit = writable && canSubmitClubComment(draft, create.isPending);

  useEffect(() => {
    if (focusKey > 0) fieldRef.current?.focus();
  }, [focusKey]);

  const slugs = useMemo(() => discussionDirectorySlugs(thread.comments), [thread.comments]);

  const submit = (): void => {
    if (!canSubmit) return;
    const sent = draft;
    create.mutate(
      { postId: post.id, body: sent, linkPreview: link.snapshot },
      {
        onSuccess: (outcome) => {
          // Czyścimy TYLKO wtedy, gdy autor nie zaczął w międzyczasie kolejnej
          // myśli - pole nie jest blokowane w trakcie wysyłki.
          setDraft((current) => (current === sent ? "" : current));
          link.reset();
          toast.success(outcome.queued ? t("club.comments.queued") : t("club.comments.posted"));
        },
        onError: (error) => toast.error(t(clubCommentErrorKey(error))),
      },
    );
  };

  const reply = (slug: string): void => {
    setDraft((current) => appendMentionToDraft(current, slug));
    // Fokus i kursor na końcu PO renderze nowej wartości.
    requestAnimationFrame(() => {
      const node = fieldRef.current;
      if (node === null) return;
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
  };

  const deletingId = remove.isPending ? (remove.variables?.commentId ?? null) : null;

  return (
    <MentionDirectoryProvider slugs={slugs} lang={lang}>
      <div className="flex flex-col gap-3" data-testid="club-feed-comments">
        {writable ? (
          <ClubFeedDiscussionComposer
            clubId={clubId}
            value={draft}
            onChange={setDraft}
            label={t("club.comments.fieldLabel")}
            placeholder={t("club.comments.placeholder")}
            maxLength={CLUB_POST_COMMENT_MAX}
            pending={create.isPending}
            canSubmit={canSubmit}
            onSubmit={submit}
            textareaRef={fieldRef}
            link={link}
            testId="club-feed-comments-composer"
          />
        ) : (
          <ClubFeedDiscussionNotice mode={mode} />
        )}

        {thread.isLoading ? (
          <p
            role="status"
            className="flex items-center gap-1.5 text-xs leading-4 text-muted-foreground"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {t("club.comments.loading")}
          </p>
        ) : thread.isError ? (
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs leading-4 text-muted-foreground">
            <span>{t("club.comments.loadFailed")}</span>
            <button
              type="button"
              className={CLUB_FEED_DISCUSSION_ACTION}
              onClick={() => void thread.query.refetch()}
            >
              {t("club.comments.retry")}
            </button>
          </p>
        ) : thread.comments.length === 0 ? (
          <p className="text-xs leading-4 text-muted-foreground">{t("club.comments.empty")}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {thread.hasOlder ? (
              <button
                type="button"
                className={CLUB_FEED_DISCUSSION_ACTION}
                onClick={thread.loadOlder}
                disabled={thread.isLoadingOlder}
                aria-busy={thread.isLoadingOlder || undefined}
                data-testid="club-feed-comments-older"
              >
                {thread.isLoadingOlder ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                {thread.isLoadingOlder
                  ? t("club.comments.loadingOlder")
                  : t("club.comments.loadOlder", { n: thread.olderCount })}
              </button>
            ) : null}
            <ul className="flex flex-col gap-2.5" aria-label={t("club.comments.sectionLabel")}>
              {thread.comments.map((comment) => {
                const author = toAuthorLabel(
                  comment,
                  t("club.anonymousAuthor"),
                  t("club.deletedAuthor"),
                );
                const slug = author.profileSlug;
                return (
                  <ClubFeedDiscussionItem
                    key={comment.id}
                    testId="club-feed-comment"
                    author={author}
                    createdAt={comment.created_at}
                    body={comment.body}
                    clubSlug={clubSlug}
                    pending={comment.status === "pending"}
                    link={parseClubLinkSnapshot(comment.link_preview)}
                    onReply={writable && slug !== null ? () => reply(slug) : undefined}
                    onDelete={
                      comment.can_manage
                        ? () =>
                            remove.mutate(
                              { postId: post.id, commentId: comment.id },
                              {
                                onSuccess: () => toast.success(t("club.comments.deleted")),
                                onError: () => toast.error(t("club.comments.deleteFailed")),
                              },
                            )
                        : undefined
                    }
                    deleting={deletingId === comment.id}
                  />
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </MentionDirectoryProvider>
  );
}
