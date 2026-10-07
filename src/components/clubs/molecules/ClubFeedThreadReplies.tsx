// Molekuła: najnowsze odpowiedzi wątku i odpowiedź wprost z karty strumienia.
//
// KARTA WĄTKU POKAZUJE ROZMOWĘ, NIE TYLKO JEJ TYTUŁ. „Komentuj" rozwija pod
// kartą dwie najnowsze odpowiedzi (`useClubReplyPreview`) i kompozytor
// odpowiedzi GŁÓWNEJ (`useReplyFromFeed`) - krótkie „zgadzam się, dorzucam
// źródło" nie wymaga już przejścia na stronę wątku. Pełna rozmowa (drzewo,
// rozstrzygnięcia, stanowiska, reakcje na odpowiedzi) zostaje tam, dokąd
// prowadzi „Zobacz całą dyskusję (N)".
//
// CZEGO TU NIE MA I DLACZEGO. Anonimowości: przełącznik ma warunki, które
// widać dopiero na stronie wątku (tryb atrybucji działu), więc z karty idzie
// zawsze odpowiedź jawna. Karty linku: `club_reply` nie przechowuje migawki
// podglądu, a karta w kompozytorze obiecywałaby coś, czego czytelnicy nie
// zobaczą - adres w treści i tak stanie się linkiem z podglądem po najechaniu.
//
// STRUMIEŃ SIĘ NIE PRZETASOWUJE. Odpowiedź z karty unieważnia wyłącznie
// odpowiedzi tego wątku i jego kartę (`feedReplyKeys`), a licznik na liście
// poprawia w miejscu - pełne unieważnienie klubu przestawiłoby karty pod
// kursorem w porządku „najgorętsze".
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MentionDirectoryProvider } from "@/components/mentions/MentionDirectory";
import {
  CLUB_FEED_DISCUSSION_ACTION,
  ClubFeedDiscussionComposer,
  ClubFeedDiscussionItem,
  ClubFeedDiscussionNotice,
} from "@/components/clubs/molecules/ClubFeedDiscussion";
import {
  appendMentionToDraft,
  discussionDirectorySlugs,
  type ClubFeedDiscussionMode,
} from "@/components/clubs/molecules/feedDiscussion";
import { clubCommentErrorKey } from "@/lib/clubs/postTypes";
import { CLUB_REPLY_BODY_MAX, canSubmitClubReply } from "@/lib/clubs/threadComposer";
import { toAuthorLabel, type ClubThreadListRow } from "@/lib/clubs/types";
import { useClubReplyPreview, useReplyFromFeed } from "@/lib/clubs/useClubs";
import { uiLang } from "@/lib/i18n/format";

/** Ile najnowszych odpowiedzi pokazuje karta. */
export const CLUB_FEED_REPLY_PREVIEW = 2;

export function ClubFeedThreadReplies({
  clubId,
  clubSlug,
  thread,
  mode,
  focusKey = 0,
}: {
  clubId: string;
  clubSlug: string;
  thread: Pick<ClubThreadListRow, "id" | "slug" | "reply_count">;
  mode: ClubFeedDiscussionMode;
  /** Każda zmiana (> 0) przenosi fokus do pola - rozwinięcie „Komentuj". */
  focusKey?: number;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const preview = useClubReplyPreview({
    threadId: thread.id,
    replyCount: thread.reply_count,
    limit: CLUB_FEED_REPLY_PREVIEW,
  });
  const send = useReplyFromFeed(clubId);
  const [draft, setDraft] = useState("");
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const writable = mode === "write";
  const canSubmit = writable && canSubmitClubReply(draft, send.isPending);

  useEffect(() => {
    if (focusKey > 0) fieldRef.current?.focus();
  }, [focusKey]);

  const rows = useMemo(() => preview.data?.rows ?? [], [preview.data]);
  const total = Math.max(preview.data?.total ?? 0, rows.length);
  const slugs = useMemo(() => discussionDirectorySlugs(rows), [rows]);

  const submit = (): void => {
    if (!canSubmit) return;
    const sent = draft;
    send.mutate(
      { threadId: thread.id, threadSlug: thread.slug, body: sent },
      {
        onSuccess: (outcome) => {
          setDraft((current) => (current === sent ? "" : current));
          toast.success(outcome.queued ? t("club.replyQueued") : t("club.replyPosted"));
        },
        onError: (error) => toast.error(t(clubCommentErrorKey(error))),
      },
    );
  };

  const reply = (slug: string): void => {
    setDraft((current) => appendMentionToDraft(current, slug));
    requestAnimationFrame(() => {
      const node = fieldRef.current;
      if (node === null) return;
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
  };

  return (
    <MentionDirectoryProvider slugs={slugs} lang={lang}>
      <div className="flex flex-col gap-3" data-testid="club-feed-thread-replies">
        {writable ? (
          <ClubFeedDiscussionComposer
            clubId={clubId}
            value={draft}
            onChange={setDraft}
            label={t("club.comments.threadFieldLabel")}
            placeholder={t("club.comments.threadPlaceholder")}
            maxLength={CLUB_REPLY_BODY_MAX}
            pending={send.isPending}
            canSubmit={canSubmit}
            onSubmit={submit}
            textareaRef={fieldRef}
            testId="club-feed-replies-composer"
          />
        ) : (
          <ClubFeedDiscussionNotice mode={mode} />
        )}

        {preview.isPending ? (
          <p
            role="status"
            className="flex items-center gap-1.5 text-xs leading-4 text-muted-foreground"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {t("club.comments.loading")}
          </p>
        ) : preview.isError ? (
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs leading-4 text-muted-foreground">
            <span>{t("club.comments.loadFailed")}</span>
            <button
              type="button"
              className={CLUB_FEED_DISCUSSION_ACTION}
              onClick={() => void preview.refetch()}
            >
              {t("club.comments.retry")}
            </button>
          </p>
        ) : rows.length === 0 ? (
          <p className="text-xs leading-4 text-muted-foreground">
            {t("club.comments.threadEmpty")}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {/* Starsze odpowiedzi żyją na stronie wątku - link stoi tam, gdzie
                pod wpisem stoi „Wczytaj wcześniejsze", czyli NAD listą. */}
            {total > rows.length ? (
              <Link
                to="/club/$clubSlug/t/$threadSlug"
                params={{ clubSlug, threadSlug: thread.slug }}
                className={CLUB_FEED_DISCUSSION_ACTION}
                data-testid="club-feed-replies-all"
              >
                {t("club.comments.viewAll", { n: total })}
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </Link>
            ) : null}
            <ul
              className="flex flex-col gap-2.5"
              aria-label={t("club.comments.threadSectionLabel")}
            >
              {rows.map((row) => {
                const author = toAuthorLabel(
                  row,
                  t("club.anonymousAuthor"),
                  t("club.deletedAuthor"),
                );
                const slug = author.profileSlug;
                return (
                  <ClubFeedDiscussionItem
                    key={row.id}
                    testId="club-feed-reply"
                    author={author}
                    createdAt={row.created_at}
                    body={row.body}
                    clubSlug={clubSlug}
                    pending={row.status === "pending"}
                    onReply={writable && slug !== null ? () => reply(slug) : undefined}
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
