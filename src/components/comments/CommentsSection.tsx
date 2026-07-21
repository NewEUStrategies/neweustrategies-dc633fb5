// Public comments section rendered under a post. Uses tokens/utility classes
// consistent with the rest of the app. Threads nest up to MAX_COMMENT_DEPTH
// (enforced by the DB trigger `comments_before_insert`); with
// require_login_to_comment=false guests may post with a signature (server fn
// with IP rate limit + honeypot; the DB trigger stays the source of truth).
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { subscribeToTable } from "@/lib/realtime/tableChannelHub";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { Button } from "@/components/ui/button";
import { FloatingInput, FloatingTextarea } from "@/components/ui/floating-input";
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
import { createGuestComment } from "@/lib/comments/guest.functions";
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
  // Tożsamość czytamy z jedynego AuthProvider (__root.tsx) - bez osobnego
  // supabase.auth.getUser() na mount i bez własnego onAuthStateChange listenera.
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [limit, setLimit] = useState(COMMENTS_PAGE_SIZE);
  const discussion = useSiteSetting<DiscussionSettings>("discussion", DISCUSSION_DEFAULTS);
  const commentsOpen = discussion.allow_comments;
  // require_login_to_comment=false: goście komentują z podpisem (server fn).
  const guestsAllowed = commentsOpen && !discussion.require_login_to_comment;
  const guestCreate$ = useServerFn(createGuestComment);

  const moderationToast = () =>
    toast.success(
      t("comments.submittedPending", {
        defaultValue:
          lang === "pl"
            ? "Dziękujemy - komentarz pojawi się po zatwierdzeniu przez moderację."
            : "Thank you - your comment will appear once approved by moderation.",
      }),
    );

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
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: listKey });
      // Moderacja jest rozstrzygana w DB - uczciwy toast zamiast obietnicy,
      // że komentarz "jest już widoczny", gdy trafił do kolejki.
      if (row.status === "pending") moderationToast();
      else toast.success(t("comments.submitted"));
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

  const guestCreate = useMutation({
    mutationFn: (input: { body: string; authorName: string; parentId?: string | null }) =>
      guestCreate$({
        data: {
          postId,
          body: input.body,
          authorName: input.authorName,
          parentId: input.parentId ?? null,
        },
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: listKey });
      // Gość nie widzi własnych wierszy pending (RLS) - toast wyjaśnia los wpisu.
      if (res.status === "pending") moderationToast();
      else toast.success(t("comments.submitted"));
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "error";
      if (msg.includes("rate limited"))
        toast.error(
          t("comments.errors.rateLimited", {
            defaultValue:
              lang === "pl"
                ? "Zwolnij - za dużo komentarzy na raz."
                : "Slow down - too many comments at once.",
          }),
        );
      else if (msg.includes("auth required")) toast.error(t("comments.errors.authRequired"));
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
      ) : guestsAllowed ? (
        <GuestCommentComposer
          onSubmit={(input) => guestCreate.mutate(input)}
          submitting={guestCreate.isPending}
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
              depth={0}
              currentUserId={userId}
              lang={lang}
              allowReplies={commentsOpen}
              guestAllowed={guestsAllowed}
              onReply={(body, parentId) => create.mutate({ body, parentId })}
              onGuestReply={(input) => guestCreate.mutate(input)}
              onDelete={(id) => remove.mutate(id)}
              onEdit={(id, body) => edit.mutate({ id, body })}
              submittingReply={create.isPending || guestCreate.isPending}
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

interface GuestCommentInput {
  body: string;
  authorName: string;
  parentId?: string | null;
}

/**
 * Kompozytor dla gości (require_login_to_comment=false): podpis + treść
 * + honeypot (ukryte pole "website" - wypełnia je tylko bot; server fn
 * cicho ignoruje takie zgłoszenia).
 */
function GuestCommentComposer({
  onSubmit,
  submitting,
  lang,
  parentId,
  onCancel,
}: {
  onSubmit: (input: GuestCommentInput) => void;
  submitting: boolean;
  lang: "pl" | "en";
  parentId?: string | null;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [website, setWebsite] = useState("");
  const disabled =
    name.trim().length < 2 ||
    name.trim().length > 80 ||
    body.trim().length < 1 ||
    body.trim().length > 5000 ||
    submitting;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) return;
        if (website.trim().length > 0) {
          // Honeypot: bot wypełnił ukryte pole - udajemy sukces bez wysyłki.
          setBody("");
          return;
        }
        onSubmit({ body: body.trim(), authorName: name.trim(), parentId: parentId ?? null });
        setBody("");
      }}
      className="space-y-3"
    >
      <FloatingInput
        label={t("comments.guestName", {
          defaultValue: lang === "pl" ? "Twoje imię lub pseudonim" : "Your name or nickname",
        })}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={80}
        autoComplete="name"
        lang={lang}
      />
      <FloatingTextarea
        label={t("comments.placeholder")}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        maxLength={5000}
        lang={lang}
      />
      {/* Honeypot - niewidoczne dla ludzi, kuszące dla botów. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={disabled}>
          {t("comments.submit")}
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
      <FloatingTextarea
        label={placeholder ?? t("comments.placeholder")}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        maxLength={5000}
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
  depth,
  currentUserId,
  lang,
  allowReplies,
  guestAllowed,
  onReply,
  onGuestReply,
  onDelete,
  onEdit,
  submittingReply,
}: {
  node: Node;
  /** 0 = wątek główny; odpowiedzi wchodzą do MAX_COMMENT_DEPTH (rekurencja). */
  depth: number;
  currentUserId: string | null;
  lang: "pl" | "en";
  /** False when comments are globally closed - hides the reply affordance. */
  allowReplies: boolean;
  /** Goście (bez konta) mogą odpowiadać, gdy wyłączono wymóg logowania. */
  guestAllowed: boolean;
  onReply: (body: string, parentId: string) => void;
  onGuestReply: (input: GuestCommentInput) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, body: string) => void;
  submittingReply: boolean;
}) {
  const [replying, setReplying] = useState(false);
  const canReply =
    canReplyToComment(depth, allowReplies) && (currentUserId !== null || guestAllowed);
  return (
    <article className="space-y-3">
      <CommentItem
        c={node.comment}
        currentUserId={currentUserId}
        lang={lang}
        canReply={canReply}
        onReplyToggle={() => setReplying((v) => !v)}
        replyOpen={replying}
        onDelete={onDelete}
        onEdit={onEdit}
      />
      {replying && canReply && (
        <div className="ml-6 pl-4 border-l border-border">
          {currentUserId ? (
            <CommentComposer
              lang={lang}
              submitting={submittingReply}
              onSubmit={(body) => {
                onReply(body, node.comment.id);
                setReplying(false);
              }}
              onCancel={() => setReplying(false)}
            />
          ) : (
            <GuestCommentComposer
              lang={lang}
              submitting={submittingReply}
              parentId={node.comment.id}
              onSubmit={(input) => {
                onGuestReply(input);
                setReplying(false);
              }}
              onCancel={() => setReplying(false)}
            />
          )}
        </div>
      )}
      {node.children.length > 0 && (
        <div className="ml-6 pl-4 border-l border-border space-y-4">
          {node.children.map((child) => (
            <CommentNode
              key={child.comment.id}
              node={child}
              depth={depth + 1}
              currentUserId={currentUserId}
              lang={lang}
              allowReplies={allowReplies}
              guestAllowed={guestAllowed}
              onReply={onReply}
              onGuestReply={onGuestReply}
              onDelete={onDelete}
              onEdit={onEdit}
              submittingReply={submittingReply}
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
  const isGuest = !c.user_id;
  const name = c.author?.display_name?.trim() || c.author_name?.trim() || t("comments.anonymous");
  const initials = name.slice(0, 2).toUpperCase();
  const when = new Date(c.created_at).toLocaleString(lang === "pl" ? "pl-PL" : "en-GB");

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
          {isGuest && (
            <span className="text-xs text-muted-foreground/80">
              ({t("comments.guestBadge", { defaultValue: lang === "pl" ? "gość" : "guest" })})
            </span>
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
