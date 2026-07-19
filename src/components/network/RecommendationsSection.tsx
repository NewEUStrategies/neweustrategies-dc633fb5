// Rekomendacje na publicznym profilu autora. Widoczne dla wszystkich, ale
// napisać rekomendację może tylko zalogowany kontakt (RPC egzekwuje warunek
// zaakceptowanej znajomości). Odbiorca (właściciel profilu) widzi zakładkę
// „do akceptacji" z akcjami approve/hide/delete.
import * as React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Quote, Loader2, Check, EyeOff, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FloatingInput } from "@/components/ui/floating-input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useConnectionStatuses } from "@/lib/network/useConnections";
import {
  useRecommendations,
  useRespondRecommendation,
  useWriteRecommendation,
  type Recommendation,
} from "@/lib/network/useRecommendations";
import { formatDate } from "@/lib/i18n/format";
import { toast } from "sonner";
import "@/lib/i18n-network";

interface Props {
  recipientId: string;
  recipientName: string;
}

const MAX_LEN = 1200;
const MIN_LEN = 40;

export function RecommendationsSection({
  recipientId,
  recipientName,
}: Props): React.ReactElement | null {
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = (i18n.language ?? "pl").startsWith("pl") ? "pl" : "en";
  const { user } = useAuth();
  const isOwner = user?.id === recipientId;
  const listQ = useRecommendations(recipientId);
  const rows = listQ.data ?? [];
  const visible = rows.filter((r) => r.status === "visible");
  const pending = isOwner ? rows.filter((r) => r.status === "pending") : [];

  const statusesQ = useConnectionStatuses(user && !isOwner ? [recipientId] : []);
  const isConnected =
    !!user && !isOwner && statusesQ.data?.get(recipientId)?.status === "connected";

  if (!visible.length && !pending.length && !isConnected) return null;

  return (
    <section className="mx-auto max-w-[1200px] px-4 py-10 lg:px-8">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Quote className="h-5 w-5 text-brand" aria-hidden />
          <h2 className="font-display text-xl lg:text-2xl">
            {t("network.recommendations.heading")}
          </h2>
          {visible.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {visible.length}
            </span>
          )}
        </div>
        {isConnected && (
          <WriteRecommendationDialog recipientId={recipientId} recipientName={recipientName} />
        )}
      </header>

      {pending.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-300/50 bg-amber-50/40 p-4 dark:border-amber-500/30 dark:bg-amber-950/20">
          <div className="mb-3 text-sm font-medium">
            {t("network.recommendations.pendingHeading", { count: pending.length })}
          </div>
          <ul className="space-y-3">
            {pending.map((r) => (
              <PendingRow key={r.id} rec={r} recipientId={recipientId} />
            ))}
          </ul>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("network.recommendations.empty")}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visible.map((r) => (
            <RecommendationCard key={r.id} rec={r} lang={lang} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RecommendationCard({
  rec,
  lang,
}: {
  rec: Recommendation;
  lang: "pl" | "en";
}): React.ReactElement {
  const created = new Date(rec.created_at);
  const initials = rec.author_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <article className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        {rec.author_avatar ? (
          <img
            src={rec.author_avatar}
            alt=""
            className="h-11 w-11 shrink-0 rounded-full border border-border object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium"
          >
            {initials || "?"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link
              to="/author/$slug"
              params={{ slug: rec.author_id }}
              className="font-semibold hover:text-brand"
            >
              {rec.author_name}
            </Link>
            {rec.author_headline && (
              <span className="text-xs text-muted-foreground">· {rec.author_headline}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {rec.relationship ? <span>{rec.relationship} · </span> : null}
            {formatDate(created, lang, { year: "numeric", month: "long" })}
          </div>
        </div>
      </div>
      <blockquote className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground/90">
        {rec.body}
      </blockquote>
    </article>
  );
}

function PendingRow({
  rec,
  recipientId,
}: {
  rec: Recommendation;
  recipientId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const respond = useRespondRecommendation();
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-3 sm:flex-row sm:items-start">
      <div className="flex-1">
        <div className="text-sm font-medium">{rec.author_name}</div>
        {rec.relationship && (
          <div className="text-xs text-muted-foreground">{rec.relationship}</div>
        )}
        <p className="mt-2 whitespace-pre-line text-sm text-foreground/90">{rec.body}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            respond.mutate(
              { id: rec.id, action: "approve", recipientId },
              {
                onSuccess: () => toast.success(t("network.recommendations.toastPublished")),
                onError: (e) => toast.error(e.message),
              },
            )
          }
          disabled={respond.isPending}
        >
          <Check className="mr-1 h-4 w-4" />
          {t("network.recommendations.publish")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            respond.mutate(
              { id: rec.id, action: "hide", recipientId },
              {
                onSuccess: () => toast.success(t("network.recommendations.toastHidden")),
                onError: (e) => toast.error(e.message),
              },
            )
          }
          disabled={respond.isPending}
        >
          <EyeOff className="mr-1 h-4 w-4" />
          {t("network.recommendations.hide")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            respond.mutate(
              { id: rec.id, action: "delete", recipientId },
              {
                onSuccess: () => toast.success(t("network.recommendations.toastDeleted")),
                onError: (e) => toast.error(e.message),
              },
            )
          }
          disabled={respond.isPending}
        >
          <Trash2 className="mr-1 h-4 w-4" />
          {t("network.recommendations.remove")}
        </Button>
      </div>
    </li>
  );
}

function WriteRecommendationDialog({
  recipientId,
  recipientName,
}: {
  recipientId: string;
  recipientName: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [relationship, setRelationship] = useState("");
  const [body, setBody] = useState("");
  const write = useWriteRecommendation(recipientId);
  const bodyLen = body.trim().length;
  const relLen = relationship.trim().length;
  const canSubmit = bodyLen >= MIN_LEN && bodyLen <= MAX_LEN && relLen >= 2 && relLen <= 120;

  const submit = () => {
    if (!canSubmit) return;
    write.mutate(
      { body: body.trim(), relationship: relationship.trim() },
      {
        onSuccess: () => {
          toast.success(t("network.recommendations.toastSent"));
          setOpen(false);
          setBody("");
          setRelationship("");
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Quote className="mr-1 h-4 w-4" />
          {t("network.recommendations.writeCta")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("network.recommendations.dialogTitle", { name: recipientName })}
          </DialogTitle>
          <DialogDescription>
            {t("network.recommendations.dialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FloatingInput
            id="rec-rel"
            label={t("network.recommendations.relationshipLabel")}
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            maxLength={120}
          />
          <div>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              maxLength={MAX_LEN}
              placeholder={t("network.recommendations.bodyPlaceholder")}
              className="resize-none"
            />
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>{t("network.recommendations.minChars", { count: MIN_LEN })}</span>
              <span>
                {bodyLen}/{MAX_LEN}
              </span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={write.isPending}>
            {t("network.recommendations.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit || write.isPending}>
            {write.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t("network.recommendations.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
