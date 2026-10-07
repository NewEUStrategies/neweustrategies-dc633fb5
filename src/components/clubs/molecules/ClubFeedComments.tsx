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
//
// SZKIC POZA KARTĄ (`useFeedDraft`). Hub podmienia strumień na wyniki
// wyszukiwania albo szkielet, a karta odmontowuje się razem ze stanem - szkic
// w rejestrze modułu wraca, gdy karta wróci.
//
// AWARIA NIE ZJADA LISTY. Pełne „nie udało się wczytać" stoi tylko wtedy, gdy
// nie ma czego pokazać (pierwsze wczytanie). Nieudane „wcześniejsze" zostawia
// pokazane komentarze i mówi o sobie przy przycisku, który jest zarazem
// ponowieniem; nieudane odświeżenie w tle nie mówi nic - dane zostają.
//
// MODERACJA W KARCIE. Komentarz w kolejce ma u moderatora (`can_approve`)
// „Zatwierdź" i „Ukryj" - decyzja bez wychodzenia do panelu, a licznik
// w karcie poprawia się w miejscu (`useModerateClubPostComment`).
import { useEffect, useId, useMemo, useRef } from "react";
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
import { postDraftKey, useFeedDraft } from "@/components/clubs/molecules/feedDrafts";
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
  type ClubPostCommentModerationAction,
  type ClubPostCommentRow,
  type ClubPostRow,
} from "@/lib/clubs/postTypes";
import {
  useClubPostComments,
  useCreateClubPostComment,
  useDeleteClubPostComment,
  useModerateClubPostComment,
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
  const moderate = useModerateClubPostComment(clubId);
  const [draft, setDraft] = useFeedDraft(postDraftKey(post.id));
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  // Cel fokusu, który przetrwa wszystko: zniknięcie wiersza, ostatniego
  // komentarza (lista ustępuje zdaniu o pustce) i brak pola (tryb bez głosu).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const olderRef = useRef<HTMLButtonElement | null>(null);
  const olderHadFocus = useRef(false);
  const olderErrorId = useId();
  const writable = mode === "write";
  const link = useComposerLinkPreview(draft, writable);
  const canSubmit = writable && canSubmitClubComment(draft, create.isPending);

  useEffect(() => {
    if (focusKey > 0) fieldRef.current?.focus();
  }, [focusKey]);

  // „Wczytaj wcześniejsze" znika po ostatniej stronie - fokus, który na nim
  // stał, przechodzi na listę (tam właśnie przybyły starsze komentarze).
  // Tylko gdy fokus naprawdę przepadł: czytelnik mógł już pójść dalej.
  useEffect(() => {
    if (thread.hasOlder || !olderHadFocus.current) return;
    olderHadFocus.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      listRef.current?.focus({ preventScroll: true });
    }
  }, [thread.hasOlder]);

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
  const moderatingId = moderate.isPending ? (moderate.variables?.commentId ?? null) : null;

  const removeComment = (comment: ClubPostCommentRow): void => {
    // Potwierdzenie, a po odświeżeniu cały wiersz, znikają - fokus idzie
    // na sekcję, zanim React zdejmie przycisk (wołane w obsłudze kliknięcia).
    rootRef.current?.focus({ preventScroll: true });
    remove.mutate(
      { postId: post.id, commentId: comment.id, status: comment.status },
      {
        onSuccess: () => toast.success(t("club.comments.deleted")),
        onError: () => toast.error(t("club.comments.deleteFailed")),
      },
    );
  };

  const decide = (comment: ClubPostCommentRow, action: ClubPostCommentModerationAction): void => {
    // Ukryty komentarz znika z listy - fokus na sekcję. Zatwierdzony zostaje
    // (fokus przenosi sam wiersz, bo znika tylko przycisk).
    if (action === "hide") rootRef.current?.focus({ preventScroll: true });
    moderate.mutate(
      { postId: post.id, commentId: comment.id, action, status: comment.status },
      {
        onSuccess: (changed) => {
          // `false` = ktoś (inny moderator, autor) zdecydował w międzyczasie.
          if (!changed) {
            toast.info(t("club.comments.moderationStale"));
            return;
          }
          toast.success(
            t(action === "approve" ? "club.comments.approved" : "club.comments.hidden"),
          );
        },
        onError: () =>
          toast.error(
            t(action === "approve" ? "club.comments.approveFailed" : "club.comments.hideFailed"),
          ),
      },
    );
  };

  return (
    <MentionDirectoryProvider slugs={slugs} lang={lang}>
      <div
        ref={rootRef}
        tabIndex={-1}
        className="flex flex-col gap-3 focus:outline-none"
        data-testid="club-feed-comments"
      >
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
          // Tylko PIERWSZE wczytanie (nie ma czego pokazać) - patrz nagłówek.
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
              <div className="flex flex-wrap items-center gap-x-1.5">
                {/* `aria-disabled`, nie `disabled`: w trakcie wczytywania
                    przycisk zostaje z fokusem (drugie kliknięcie i tak nie
                    wysyła żądania - pilnuje tego `loadOlder`). Po błędzie
                    ten sam przycisk ponawia. */}
                <button
                  ref={olderRef}
                  type="button"
                  className={CLUB_FEED_DISCUSSION_ACTION}
                  onClick={() => {
                    olderHadFocus.current = document.activeElement === olderRef.current;
                    if (thread.olderError) thread.retryOlder();
                    else thread.loadOlder();
                  }}
                  aria-disabled={thread.isLoadingOlder || undefined}
                  aria-busy={thread.isLoadingOlder || undefined}
                  aria-describedby={olderErrorId}
                  data-testid="club-feed-comments-older"
                >
                  {thread.isLoadingOlder ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : null}
                  {thread.isLoadingOlder
                    ? t("club.comments.loadingOlder")
                    : t("club.comments.loadOlder", { n: thread.olderCount })}
                </button>
                {/* Region stoi razem z przyciskiem - ogłaszana jest dopiero
                    ZMIANA treści istniejącego regionu, nie nowy węzeł. */}
                <span
                  id={olderErrorId}
                  role="status"
                  className="text-xs leading-4 text-muted-foreground empty:hidden"
                  data-testid="club-feed-comments-older-error"
                >
                  {thread.olderError && !thread.isLoadingOlder
                    ? t("club.comments.loadOlderFailed")
                    : null}
                </span>
              </div>
            ) : null}
            <ul
              ref={listRef}
              tabIndex={-1}
              className="flex flex-col gap-2.5 focus:outline-none"
              aria-label={t("club.comments.sectionLabel")}
            >
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
                    onDelete={comment.can_manage ? () => removeComment(comment) : undefined}
                    deleting={deletingId === comment.id}
                    onApprove={comment.can_approve ? () => decide(comment, "approve") : undefined}
                    onHide={comment.can_approve ? () => decide(comment, "hide") : undefined}
                    moderating={moderatingId === comment.id}
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
