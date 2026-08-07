// /club/$clubSlug/t/$threadSlug - widok wątku.
//
// Nowe odpowiedzi NIE WSKAKUJĄ same do widoku. Gdy przyjdą, pojawia się pasek
// "N nowych odpowiedzi - pokaż". Wstawianie treści pod kursorem czytającego to
// najczęstszy błąd UX w tej klasie produktów: czat może sobie na to pozwolić,
// długa deliberacja nie (V1 §5.4).
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Lock, MessageSquare, Pin, ShieldQuestion } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useClubBySlug,
  useClubReactions,
  useClubReplies,
  useClubThread,
  useReplyToThread,
  useResolveClubThread,
  useToggleClubReaction,
} from "@/lib/clubs/useClubs";
import { ClubReactionBar } from "@/components/clubs/ClubReactionBar";
import {
  buildClubReplyTree,
  toAuthorLabel,
  type ClubReactionKind,
  type ClubReactionTally,
  type ClubReplyNode,
} from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/t/$threadSlug")({
  head: () => ({ meta: [{ name: "robots", content: "noindex,nofollow" }] }),
  component: ClubThreadView,
});

function ClubThreadView() {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const { clubSlug, threadSlug } = Route.useParams();
  const { user } = useAuth();

  const clubQ = useClubBySlug(clubSlug);
  const club = clubQ.data ?? null;
  const threadQ = useClubThread({ clubId: club?.id, slug: threadSlug });
  const thread = threadQ.data ?? null;
  const repliesQ = useClubReplies({ threadId: thread?.id });

  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const replyM = useReplyToThread(club?.id ?? "", threadSlug);
  const resolveM = useResolveClubThread(club?.id ?? "", threadSlug);

  // Dwie partie, dwa zapytania wsadowe - nigdy jedno na wpis.
  const threadIds = thread ? [thread.id] : [];
  const replyIds = (repliesQ.data ?? []).map((r) => r.id);
  const threadReactionsQ = useClubReactions({ targetType: "thread", targetIds: threadIds });
  const replyReactionsQ = useClubReactions({ targetType: "reply", targetIds: replyIds });
  const toggleThreadReaction = useToggleClubReaction({
    targetType: "thread",
    targetIds: threadIds,
  });
  const toggleReplyReaction = useToggleClubReaction({ targetType: "reply", targetIds: replyIds });

  if (clubQ.isPending || threadQ.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <div className="h-64 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
      </div>
    );
  }

  if (!club || !thread) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">{t("club.reason.not_found")}</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/club/$clubSlug" params={{ clubSlug }}>
                {isPl ? club?.name_pl ?? t("club.title") : club?.name_en ?? t("club.title")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const author = toAuthorLabel(thread, t("club.anonymousAuthor"), t("club.deletedAuthor"));
  const replies = repliesQ.data ?? [];
  const tree = buildClubReplyTree(replies);
  // Autor pytania i moderacja mogą wskazać odpowiedź rozstrzygającą.
  const canResolve =
    thread.kind === "question" && (thread.can_moderate || thread.author_id === user?.id);
  // Anonimowość wolno włączyć wyłącznie tam, gdzie tryb klubu na to pozwala.
  const canGoAnonymous = thread.attribution_mode === "anonymous_allowed";

  const submitReply = () => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    replyM.mutate(
      { threadId: thread.id, body: trimmed, parentId: replyTo, anonymous },
      {
        onSuccess: () => {
          setBody("");
          setReplyTo(null);
          toast.success(t("club.replyPosted"));
        },
        onError: () => toast.error(t("adminClubs.saveFailed")),
      },
    );
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 h-8 px-2">
        <Link to="/club/$clubSlug" params={{ clubSlug }}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          {isPl ? club.name_pl : club.name_en}
        </Link>
      </Button>

      {/* --- post otwierający --- */}
      <article className="rounded-lg border border-border/60 bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          {thread.pinned_at !== null ? <Pin className="h-4 w-4 text-primary" /> : null}
          <Badge variant="outline">{t(`club.kind.${thread.kind}`)}</Badge>
          {thread.status === "resolved" ? (
            <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
              {t("club.threadStatus.resolved")}
            </Badge>
          ) : null}
          {thread.locked_at !== null ? (
            <Badge variant="outline" className="gap-1">
              <Lock className="h-3 w-3" />
              {t("club.threadStatus.locked")}
            </Badge>
          ) : null}
          {thread.attribution_mode === "chatham" ? (
            <Badge variant="outline" className="gap-1">
              <ShieldQuestion className="h-3 w-3" />
              {t("club.attribution.chatham")}
            </Badge>
          ) : null}
        </div>

        <h1 className="mt-2 text-2xl font-semibold leading-snug">{thread.title}</h1>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{author.name}</span>
          <span>{new Date(thread.created_at).toLocaleString(isPl ? "pl-PL" : "en-GB")}</span>
          {thread.edited_at !== null ? <span>({t("club.edited")})</span> : null}
        </div>

        <div className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed">{thread.body}</div>

        <div className="mt-4 border-t border-border/60 pt-3">
          <ClubReactionBar
            tallies={threadReactionsQ.data?.get(thread.id) ?? []}
            disabled={!thread.can_reply || toggleThreadReaction.isPending}
            variant="full"
            onToggle={(kind, active) =>
              toggleThreadReaction.mutate({ targetId: thread.id, kind, active })
            }
          />
        </div>
      </article>

      {/* --- odpowiedzi --- */}
      <section className="mt-6">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <MessageSquare className="h-4 w-4" />
          {t("club.repliesCount", { count: thread.reply_count })}
        </h2>

        {repliesQ.isPending ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
        ) : tree.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            {t("club.noReplies")}
          </p>
        ) : (
          <ul className="space-y-3">
            {tree.map((node) => (
              <ReplyBranch
                key={node.reply.id}
                node={node}
                isPl={isPl}
                canResolve={canResolve}
                canReact={thread.can_reply}
                reactions={replyReactionsQ.data ?? new Map()}
                onToggleReaction={(targetId, kind, active) =>
                  toggleReplyReaction.mutate({ targetId, kind, active })
                }
                onReply={setReplyTo}
                onResolve={(replyId) =>
                  resolveM.mutate(
                    { threadId: thread.id, replyId },
                    {
                      onSuccess: () => toast.success(t("club.resolvedToast")),
                      onError: () => toast.error(t("adminClubs.saveFailed")),
                    },
                  )
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/* --- kompozytor --- */}
      {thread.can_reply ? (
        <section className="mt-6 rounded-lg border border-border/60 bg-card p-4">
          {replyTo !== null ? (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">{t("club.replyingTo")}</span>
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setReplyTo(null)}>
                {t("club.cancelReplyTo")}
              </Button>
            </div>
          ) : null}

          <Label htmlFor="club-reply-body" className="sr-only">
            {t("club.replyPlaceholder")}
          </Label>
          <Textarea
            id="club-reply-body"
            rows={4}
            maxLength={10000}
            value={body}
            disabled={replyM.isPending}
            placeholder={t("club.replyPlaceholder")}
            onChange={(e) => setBody(e.target.value)}
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            {canGoAnonymous ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="club-reply-anon"
                  checked={anonymous}
                  disabled={replyM.isPending}
                  onCheckedChange={setAnonymous}
                />
                <Label htmlFor="club-reply-anon" className="text-sm">
                  {t("club.postAnonymously")}
                </Label>
              </div>
            ) : (
              <span />
            )}
            <Button onClick={submitReply} disabled={replyM.isPending || body.trim().length === 0}>
              {t("club.postReply")}
            </Button>
          </div>
        </section>
      ) : (
        <p className="mt-6 rounded-lg border border-border/60 bg-muted/30 p-4 text-center text-sm text-muted-foreground">
          {thread.reason ? t(`club.reason.${thread.reason}`) : t("club.cannotReply")}
        </p>
      )}
    </div>
  );
}

function ReplyBranch({
  node,
  isPl,
  canResolve,
  canReact,
  reactions,
  onToggleReaction,
  onReply,
  onResolve,
}: {
  node: ClubReplyNode;
  isPl: boolean;
  canResolve: boolean;
  canReact: boolean;
  reactions: Map<string, ClubReactionTally[]>;
  onToggleReaction: (targetId: string, kind: ClubReactionKind, active: boolean) => void;
  onReply: (replyId: string) => void;
  onResolve: (replyId: string) => void;
}) {
  const { t } = useTranslation();
  const { reply, children } = node;
  const author = toAuthorLabel(reply, t("club.anonymousAuthor"), t("club.deletedAuthor"));

  return (
    <li>
      <div
        className={
          "rounded-lg border p-4 " +
          (reply.is_resolution
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-border/60 bg-card")
        }
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-medium">{author.name}</span>
          <span className="text-xs text-muted-foreground">
            {new Date(reply.created_at).toLocaleString(isPl ? "pl-PL" : "en-GB")}
          </span>
          {reply.edited_at !== null ? (
            <span className="text-xs text-muted-foreground">({t("club.edited")})</span>
          ) : null}
          {reply.is_resolution ? (
            <Badge className="gap-1 bg-emerald-500/15 text-[11px] text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3" />
              {t("club.resolution")}
            </Badge>
          ) : null}
          {reply.status === "pending" ? (
            <Badge variant="outline" className="text-[11px] text-amber-700 dark:text-amber-300">
              {t("club.threadStatus.pending")}
            </Badge>
          ) : null}
        </div>

        <div className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{reply.body}</div>

        {/* Pasek zwinięty: przy trzydziestu odpowiedziach sześć pustych
            przycisków pod każdą byłoby ścianą szumu. */}
        <div className="mt-2">
          <ClubReactionBar
            tallies={reactions.get(reply.id) ?? []}
            disabled={!canReact}
            variant="compact"
            onToggle={(kind, active) => onToggleReaction(reply.id, kind, active)}
          />
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {/* Poziom 2 nie dostaje przycisku "Odpowiedz": drzewo jest przycięte,
              a przycisk, który po cichu przypina odpowiedź gdzie indziej,
              wprowadza w błąd. */}
          {reply.depth < 2 ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => onReply(reply.id)}
            >
              {t("club.reply")}
            </Button>
          ) : null}
          {canResolve && !reply.is_resolution ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => onResolve(reply.id)}
            >
              {t("club.markResolution")}
            </Button>
          ) : null}
        </div>
      </div>

      {children.length > 0 ? (
        <ul className="mt-2 space-y-2 border-l-2 border-border/40 pl-3 sm:pl-5">
          {children.map((child) => (
            <ReplyBranch
              key={child.reply.id}
              node={child}
              isPl={isPl}
              canResolve={canResolve}
              canReact={canReact}
              reactions={reactions}
              onToggleReaction={onToggleReaction}
              onReply={onReply}
              onResolve={onResolve}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
