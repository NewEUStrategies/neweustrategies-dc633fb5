import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Check, X, Trash2 } from "@/lib/lucide-shim";
import {
  fetchAdminComments,
  moderateComment,
  type CommentStatus,
  type AdminCommentRow,
} from "@/lib/comments/api";

export const Route = createFileRoute("/admin/comments")({
  component: AdminComments,
  head: () => ({ meta: [{ title: "Comments · Admin" }] }),
});

function AdminComments() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language.startsWith("pl") ? "pl" : "en") as "pl" | "en";
  const qc = useQueryClient();
  const [status, setStatus] = useState<CommentStatus | "all">("pending");
  const [q, setQ] = useState("");

  const queryKey = ["admin-comments", status, q] as const;
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchAdminComments({ status, q }),
    staleTime: 15_000,
  });

  const moderate = useMutation({
    mutationFn: ({ id, newStatus }: { id: string; newStatus: CommentStatus }) =>
      moderateComment(id, newStatus),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-comments"] });
      toast.success(t("adminComments.saved"));
    },
    onError: () => toast.error(t("adminComments.error")),
  });

  const rows = data ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("adminComments.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("adminComments.subtitle")}</p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={status} onValueChange={(v) => setStatus(v as CommentStatus | "all")}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("adminComments.status.all")}</SelectItem>
            <SelectItem value="pending">{t("adminComments.status.pending")}</SelectItem>
            <SelectItem value="approved">{t("adminComments.status.approved")}</SelectItem>
            <SelectItem value="spam">{t("adminComments.status.spam")}</SelectItem>
            <SelectItem value="deleted">{t("adminComments.status.deleted")}</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("adminComments.searchPlaceholder")}
          className="max-w-md"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("adminComments.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("adminComments.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <Row
              key={r.id}
              r={r}
              lang={lang}
              onModerate={(s) => moderate.mutate({ id: r.id, newStatus: s })}
              busy={moderate.isPending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({
  r,
  lang,
  onModerate,
  busy,
}: {
  r: AdminCommentRow;
  lang: "pl" | "en";
  onModerate: (status: CommentStatus) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const when = new Date(r.created_at).toLocaleString(lang === "pl" ? "pl-PL" : "en-US");
  const title = (lang === "pl" ? r.post?.title_pl : r.post?.title_en) ?? r.post?.slug ?? "—";
  const variant: Record<CommentStatus, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "outline",
    approved: "default",
    spam: "destructive",
    deleted: "secondary",
  };
  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-medium">{r.author?.display_name ?? "—"}</span>
        <time className="text-xs text-muted-foreground" dateTime={r.created_at}>
          {when}
        </time>
        <Badge variant={variant[r.status as CommentStatus]}>
          {t(`adminComments.status.${r.status}`)}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground truncate max-w-[40%]" title={title}>
          {title}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{r.body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {r.status !== "approved" && (
          <Button size="sm" onClick={() => onModerate("approved")} disabled={busy}>
            <Check className="w-4 h-4 mr-1" /> {t("adminComments.actions.approve")}
          </Button>
        )}
        {r.status !== "spam" && (
          <Button size="sm" variant="outline" onClick={() => onModerate("spam")} disabled={busy}>
            <X className="w-4 h-4 mr-1" /> {t("adminComments.actions.spam")}
          </Button>
        )}
        {r.status !== "deleted" && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onModerate("deleted")}
            disabled={busy}
          >
            <Trash2 className="w-4 h-4 mr-1" /> {t("adminComments.actions.delete")}
          </Button>
        )}
      </div>
    </li>
  );
}
