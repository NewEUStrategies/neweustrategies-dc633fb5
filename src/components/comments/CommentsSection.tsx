// Public comments section rendered under a post. Uses tokens/utility classes
// consistent with the rest of the app. Supports one level of nested replies
// (enforced by the DB trigger `comments_before_insert`).
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { subscribeToTable } from "@/lib/realtime/tableChannelHub";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Trash2 } from "@/lib/lucide-shim";
import { MessageCircle, Pencil, Reply } from "lucide-react";
import {
  canEditComment,
  createComment,
  editComment,
  fetchPostComments,
  softDeleteComment,
  type CommentWithAuthor,
} from "@/lib/comments/api";
import { buildCommentTree, canReplyToComment, type CommentTreeNode } from "@/lib/comments/tree";

interface Props {
  postId: string;
  lang: "pl" | "en";
}

/** Top-level threads fetched per page; "load more" grows the window by this amount. */
const COMMENTS_PAGE_SIZE = 50;

/** Shape of the admin "discussion" site_settings key (admin.settings.discussion.tsx). */
interface DiscussionSettings {
  allow_comments: boolean;
  require_login_to_comment: boolean;
  moderate_new_comments: boolean;
}

// Module-level so the reference stays stable across renders (useSiteSetting
// memoizes on the defaults object). Mirrors the DB seed: comments off by default.
const DISCUSSION_DEFAULTS: DiscussionSettings = {
  allow_comments: false,
  require_login_to_comment: true,
  moderate_new_comments: true,
};

export function CommentsSection({ postId, lang }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [limit, setLimit] = useState(COMMENTS_PAGE_SIZE);
  const discussion = useSiteSetting<DiscussionSettings>("discussion", DISCUSSION_DEFAULTS);
  const commentsOpen = discussion.allow_comments;

  useEffect(() => {
    // Sync current user id so we can show controls for own rows; the auth
    // listener keeps it fresh and MUST be unsubscribed on unmount (a useMemo
    // "cleanup" is never invoked by React and leaked one subscription per mount).
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setUserId(data.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Base key (no limit) so mutations can invalidate every fetched window at once.
  const listKey = ["post-comments", postId] as const;
  const { data, isLoading, isFetching } = useQuery({
    queryKey: [...listKey, limit] as const,
    queryFn: () => fetchPostComments(postId, limit),
    staleTime: 30_000,
  });

  // Realtime: any insert/update to this post's comments refreshes the list, so
  // a peer's new (approved) comment or an edit shows up without a manual reload.
  // RLS still gates what non-owners can read (only `approved` streams to them).
  useEffect(() => {
    return subscribeToTable(
      { table: "comments", filter: `post_id=eq.${postId}` },
      () => void qc.invalidateQueries({ queryKey: listKey }),
    );
    // listKey is derived from postId; qc is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, qc]);

  const create = useMutation({
    mutationFn: (input: { body: string; parentId?: string | null }) =>
      createComment({ postId, body: input.body, parentId: input.parentId ?? null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      toast.success(t("comments.submitted"));
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "error";
      if (msg === "auth_required") toast.error(t("comments.errors.authRequired"));
      else if (msg === "comments_disabled") toast.error(t("comments.errors.disabled"));
      else if (msg.includes("rate limited"))
        // DB trigger rejects >5 comments/min - map the raw message to friendly copy.
        toast.error(
          t("comments.errors.rateLimited", {
            defaultValue:
              lang === "pl"
                ? "Zwolnij - za dużo komentarzy na raz."
                : "Slow down - too many comments at once.",
          }),
        );
      else toast.error(t("comments.errors.generic"));
    },
  });

  const remove = useMutation({
    mutationFn: softDeleteComment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      toast.success(t("comments.deleted"));
    },
    onError: () => toast.error(t("comments.errors.generic")),
  });

  const edit = useMutation({
    mutationFn: (input: { id: string; body: string }) => editComment(input.id, input.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      toast.success(t("comments.editSaved", { defaultValue: "Komentarz zaktualizowany" }));
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "error";
      if (msg.includes("edit window expired"))
        toast.error(
          t("comments.errors.editExpired", {
            defaultValue:
              lang === "pl"
                ? "Komentarz można edytować tylko przez 15 minut od dodania."
                : "Comments can only be edited within 15 minutes of posting.",
          }),
        );
      else toast.error(t("comments.errors.generic"));
    },
  });

  const tree = useMemo(() => buildCommentTree(data?.comments ?? []), [data]);
  // Honest server-side count (was: count of fetched rows, lying beyond the window).
  const totalApproved = data?.approvedCount ?? 0;
  // More top-level threads exist beyond the current window.
  const canLoadMore = (data?.topLevelCount ?? 0) > limit;

  // Comments globally disabled and nothing approved to show (also while the
  // list is still loading) -> render no section at all instead of a dead composer.
  if (!commentsOpen && totalApproved === 0) return null;

  return (
    <section
      id="comments"
      aria-labelledby="comments-heading"
      className="mt-10 border-t border-border pt-8"
    >
      <header className="flex items-center gap-2 mb-6">
        <MessageCircle className="w-5 h-5 text-muted-foreground" aria-hidden />
        <h2 id="comments-heading" className="text-xl font-semibold">
          {t("comments.title", { count: totalApproved })}
        </h2>
      </header>

      {!commentsOpen ? (
        <p role="note" className="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">
          {t("comments.closed", {
            defaultValue:
              lang === "pl"
                ? "Komentarze pod tym wpisem są zamknięte."
                : "Comments are closed for this post.",
          })}
        </p>
      ) : userId ? (
        <CommentComposer
          onSubmit={(body) => create.mutate({ body })}
          submitting={create.isPending}
          lang={lang}
        />
      ) : (
        <div className="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">
          {t("comments.signInPrompt")}{" "}
          <Link to="/login" className="underline hover:text-foreground">
            {t("comments.signInLink")}
          </Link>
        </div>
      )}

      <div className="mt-8 space-y-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("comments.loading")}</p>
        ) : tree.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("comments.empty")}</p>
        ) : (
          tree.map((node) => (
            <CommentNode
              key={node.comment.id}
              node={node}
              currentUserId={userId}
              lang={lang}
              allowReplies={commentsOpen}
              onReply={(body, parentId) => create.mutate({ body, parentId })}
              onDelete={(id) => remove.mutate(id)}
              onEdit={(id, body) => edit.mutate({ id, body })}
              submittingReply={create.isPending}
            />
          ))
        )}
        {!isLoading && canLoadMore && (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isFetching}
              onClick={() => setLimit((n) => n + COMMENTS_PAGE_SIZE)}
            >
              {isFetching
                ? t("comments.loading")
                : t("comments.loadMore", {
                    defaultValue:
                      lang === "pl" ? "Załaduj więcej komentarzy" : "Load more comments",
                  })}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

type Node = CommentTreeNode;

function CommentComposer({
  onSubmit,
  submitting,
  lang,
  placeholder,
  onCancel,
  initialValue,
  submitLabel,
}: {
  onSubmit: (body: string) => void;
  submitting: boolean;
  lang: "pl" | "en";
  placeholder?: string;
  onCancel?: () => void;
  /** Non-empty seeds edit mode (prefills the current body). */
  initialValue?: string;
  submitLabel?: string;
}) {
  const { t } = useTranslation();
  const [body, setBody] = useState(initialValue ?? "");
  const disabled =
    body.trim().length < 1 ||
    body.trim().length > 5000 ||
    submitting ||
    body.trim() === (initialValue ?? "").trim();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) return;
        onSubmit(body);
        setBody("");
      }}
      className="space-y-3"
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder ?? t("comments.placeholder")}
        rows={4}
        maxLength={5000}
        aria-label={t("comments.placeholder")}
        lang={lang}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={disabled}>
          {submitLabel ?? t("comments.submit")}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("common.cancel", { defaultValue: lang === "pl" ? "Anuluj" : "Cancel" })}
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {body.length}/5000
        </span>
      </div>
    </form>
  );
}

function CommentNode({
  node,
  currentUserId,
  lang,
  allowReplies,
  onReply,
  onDelete,
  onEdit,
  submittingReply,
}: {
  node: Node;
  currentUserId: string | null;
  lang: "pl" | "en";
  /** False when comments are globally closed - hides the reply affordance. */
  allowReplies: boolean;
  onReply: (body: string, parentId: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, body: string) => void;
  submittingReply: boolean;
}) {
  const [replying, setReplying] = useState(false);
  return (
    <article className="space-y-3">
      <CommentItem
        c={node.comment}
        currentUserId={currentUserId}
        lang={lang}
        canReply={canReplyToComment(0, allowReplies)}
        onReplyToggle={() => setReplying((v) => !v)}
        replyOpen={replying}
        onDelete={onDelete}
        onEdit={onEdit}
      />
      {replying && allowReplies && (
        <div className="ml-6 pl-4 border-l border-border">
          <CommentComposer
            lang={lang}
            submitting={submittingReply}
            onSubmit={(body) => {
              onReply(body, node.comment.id);
              setReplying(false);
            }}
            onCancel={() => setReplying(false)}
          />
        </div>
      )}
      {node.children.length > 0 && (
        <div className="ml-6 pl-4 border-l border-border space-y-4">
          {node.children.map((child) => (
            <CommentItem
              key={child.id}
              c={child}
              currentUserId={currentUserId}
              lang={lang}
              canReply={canReplyToComment(1, allowReplies)}
              onReplyToggle={undefined}
              replyOpen={false}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function CommentItem({
  c,
  currentUserId,
  lang,
  canReply,
  onReplyToggle,
  replyOpen,
  onDelete,
  onEdit,
}: {
  c: CommentWithAuthor;
  currentUserId: string | null;
  lang: "pl" | "en";
  canReply: boolean;
  onReplyToggle?: () => void;
  replyOpen: boolean;
  onDelete: (id: string) => void;
  onEdit?: (id: string, body: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const isOwn = currentUserId && c.user_id === currentUserId;
  const isPending = c.status === "pending";
  const isDeleted = c.status === "deleted";
  const canEdit = !!onEdit && canEditComment(c, currentUserId);
  const name = c.author?.display_name?.trim() || t("comments.anonymous");
  const initials = name.slice(0, 2).toUpperCase();
  const when = new Date(c.created_at).toLocaleString(lang === "pl" ? "pl-PL" : "en-US");

  return (
    <div className="flex gap-3">
      <div
        aria-hidden
        className="w-9 h-9 rounded-full bg-muted flex-shrink-0 flex items-center justify-center text-xs font-medium text-muted-foreground overflow-hidden"
      >
        {c.author?.avatar_url ? (
          <img src={c.author.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          initials
        )}
      </div>
      <div className="flex-1 min-w-0">
        <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          {c.author?.slug ? (
            <Link
              to="/author/$slug"
              params={{ slug: c.author.slug }}
              className="font-medium hover:underline"
            >
              {name}
            </Link>
          ) : (
            <span className="font-medium">{name}</span>
          )}
          <time className="text-xs text-muted-foreground" dateTime={c.created_at}>
            {when}
          </time>
          {c.edited_at && !isDeleted && (
            <span
              className="text-xs text-muted-foreground/70"
              title={t("comments.edited", { defaultValue: "edytowano" })}
            >
              ({t("comments.edited", { defaultValue: "edytowano" })})
            </span>
          )}
          {isPending && (
            <span className="text-xs rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5">
              {t("comments.pendingBadge")}
            </span>
          )}
        </header>
        {editing && !isDeleted ? (
          <div className="mt-2">
            <CommentComposer
              lang={lang}
              submitting={false}
              initialValue={c.body ?? ""}
              submitLabel={t("comments.saveEdit", { defaultValue: "Zapisz zmiany" })}
              onSubmit={(body) => {
                onEdit?.(c.id, body);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <div className="mt-1 text-sm leading-relaxed whitespace-pre-wrap break-words">
            {isDeleted ? (
              <em className="text-muted-foreground">{t("comments.deletedPlaceholder")}</em>
            ) : (
              c.body
            )}
          </div>
        )}
        {!isDeleted && !editing && (
          <footer className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            {canReply && onReplyToggle && (
              <button
                type="button"
                onClick={onReplyToggle}
                className="inline-flex items-center gap-1 hover:text-foreground"
                aria-expanded={replyOpen}
              >
                <Reply className="w-3.5 h-3.5" aria-hidden />
                {t("comments.reply")}
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden />
                {t("comments.edit", { defaultValue: lang === "pl" ? "Edytuj" : "Edit" })}
              </button>
            )}
            {isOwn && (
              <button
                type="button"
                onClick={() => onDelete(c.id)}
                className="inline-flex items-center gap-1 hover:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden />
                {t("comments.delete")}
              </button>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
