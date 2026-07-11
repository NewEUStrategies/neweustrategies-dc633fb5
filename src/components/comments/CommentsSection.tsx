// Public comments section rendered under a post. Uses tokens/utility classes
// consistent with the rest of the app. Supports one level of nested replies
// (enforced by the DB trigger `comments_before_insert`).
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { MessageCircle, Reply, Trash2 } from "@/lib/lucide-shim";
import {
  createComment,
  fetchPostComments,
  softDeleteComment,
  type CommentWithAuthor,
} from "@/lib/comments/api";

interface Props {
  postId: string;
  lang: "pl" | "en";
}

export function CommentsSection({ postId, lang }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);

  useMemo(() => {
    // Sync current user id once per mount so we can show controls for own rows.
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const queryKey = ["post-comments", postId] as const;
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchPostComments(postId),
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: (input: { body: string; parentId?: string | null }) =>
      createComment({ postId, body: input.body, parentId: input.parentId ?? null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success(t("comments.submitted"));
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "error";
      if (msg === "auth_required") toast.error(t("comments.errors.authRequired"));
      else if (msg === "comments_disabled") toast.error(t("comments.errors.disabled"));
      else toast.error(t("comments.errors.generic"));
    },
  });

  const remove = useMutation({
    mutationFn: softDeleteComment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success(t("comments.deleted"));
    },
    onError: () => toast.error(t("comments.errors.generic")),
  });

  const tree = useMemo(() => buildTree(data ?? []), [data]);
  const totalApproved = (data ?? []).filter((c) => c.status === "approved").length;

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

      {userId ? (
        <CommentComposer
          onSubmit={(body) => create.mutate({ body })}
          submitting={create.isPending}
          lang={lang}
        />
      ) : (
        <div className="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">
          {t("comments.signInPrompt")}{" "}
          <Link to="/auth" className="underline hover:text-foreground">
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
              onReply={(body, parentId) => create.mutate({ body, parentId })}
              onDelete={(id) => remove.mutate(id)}
              submittingReply={create.isPending}
            />
          ))
        )}
      </div>
    </section>
  );
}

type Node = { comment: CommentWithAuthor; children: CommentWithAuthor[] };

function buildTree(rows: CommentWithAuthor[]): Node[] {
  const byParent = new Map<string, CommentWithAuthor[]>();
  const roots: CommentWithAuthor[] = [];
  for (const r of rows) {
    if (r.parent_id) {
      const arr = byParent.get(r.parent_id) ?? [];
      arr.push(r);
      byParent.set(r.parent_id, arr);
    } else {
      roots.push(r);
    }
  }
  return roots.map((c) => ({ comment: c, children: byParent.get(c.id) ?? [] }));
}

function CommentComposer({
  onSubmit,
  submitting,
  lang,
  placeholder,
  onCancel,
}: {
  onSubmit: (body: string) => void;
  submitting: boolean;
  lang: "pl" | "en";
  placeholder?: string;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [body, setBody] = useState("");
  const disabled = body.trim().length < 1 || body.trim().length > 5000 || submitting;
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

function CommentNode({
  node,
  currentUserId,
  lang,
  onReply,
  onDelete,
  submittingReply,
}: {
  node: Node;
  currentUserId: string | null;
  lang: "pl" | "en";
  onReply: (body: string, parentId: string) => void;
  onDelete: (id: string) => void;
  submittingReply: boolean;
}) {
  const [replying, setReplying] = useState(false);
  return (
    <article className="space-y-3">
      <CommentItem
        c={node.comment}
        currentUserId={currentUserId}
        lang={lang}
        canReply
        onReplyToggle={() => setReplying((v) => !v)}
        replyOpen={replying}
        onDelete={onDelete}
      />
      {replying && (
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
              canReply={false}
              onReplyToggle={undefined}
              replyOpen={false}
              onDelete={onDelete}
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
}: {
  c: CommentWithAuthor;
  currentUserId: string | null;
  lang: "pl" | "en";
  canReply: boolean;
  onReplyToggle?: () => void;
  replyOpen: boolean;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const isOwn = currentUserId && c.user_id === currentUserId;
  const isPending = c.status === "pending";
  const isDeleted = c.status === "deleted";
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
          // eslint-disable-next-line @next/next/no-img-element
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
          {isPending && (
            <span className="text-xs rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5">
              {t("comments.pendingBadge")}
            </span>
          )}
        </header>
        <div className="mt-1 text-sm leading-relaxed whitespace-pre-wrap break-words">
          {isDeleted ? (
            <em className="text-muted-foreground">{t("comments.deletedPlaceholder")}</em>
          ) : (
            c.body
          )}
        </div>
        {!isDeleted && (
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
