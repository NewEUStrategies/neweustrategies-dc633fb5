import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Check, X, Trash2 } from "@/lib/lucide-shim";
import {
  bulkModerateComments,
  fetchAdminComments,
  moderateComment,
  type CommentStatus,
  type AdminCommentRow,
} from "@/lib/comments/api";
import {
  retainExisting,
  selectAllState,
  toggleSelectAll,
  toggleSelected,
} from "@/lib/comments/selection";
import { ensureI18n } from "@/lib/i18n-admin-comments";

ensureI18n();

export const Route = createFileRoute("/admin/comments")({
  component: AdminComments,
  head: () => ({ meta: [{ title: "Comments · Admin" }] }),
});

export function AdminComments() {
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

  // --- Moderacja zbiorcza ---------------------------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Po refetchu / zmianie filtra odsiej id, których już nie ma na liście, żeby
  // licznik nie kłamał, a akcja zbiorcza nie celowała w nieobecne wiersze.
  useEffect(() => {
    setSelected((prev) =>
      retainExisting(
        prev,
        rows.map((r) => r.id),
      ),
    );
    // Zależność od `data` (referencja zmienia się przy refetchu); rows z niej wynika.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const visibleIds = rows.map((r) => r.id);
  const headState = selectAllState(visibleIds, selected);
  // Destrukcyjne akcje zbiorcze (spam / usuń) przechodzą przez potwierdzenie.
  const [confirm, setConfirm] = useState<null | "spam" | "deleted">(null);

  const bulk = useMutation({
    mutationFn: ({ ids, newStatus }: { ids: string[]; newStatus: CommentStatus }) =>
      bulkModerateComments(ids, newStatus),
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["admin-comments"] });
      setSelected(new Set());
      toast.success(t("adminComments.bulk.done", { count }));
    },
    onError: () => toast.error(t("adminComments.error")),
  });

  function runBulk(newStatus: CommentStatus) {
    if (selected.size === 0) return;
    if (newStatus === "approved") bulk.mutate({ ids: [...selected], newStatus });
    else setConfirm(newStatus === "spam" ? "spam" : "deleted");
  }

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
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
            <Checkbox
              checked={headState === "all" ? true : headState === "some" ? "indeterminate" : false}
              onCheckedChange={() => setSelected(toggleSelectAll(visibleIds, selected))}
              aria-label={t("adminComments.selection.selectAll")}
            />
            <span className="text-sm text-muted-foreground">
              {t("adminComments.selection.count", { count: selected.size })}
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={selected.size === 0 || bulk.isPending}
                onClick={() => runBulk("approved")}
              >
                <Check className="w-4 h-4 mr-1" /> {t("adminComments.bulk.approve")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={selected.size === 0 || bulk.isPending}
                onClick={() => runBulk("spam")}
              >
                <X className="w-4 h-4 mr-1" /> {t("adminComments.bulk.spam")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={selected.size === 0 || bulk.isPending}
                onClick={() => runBulk("deleted")}
              >
                <Trash2 className="w-4 h-4 mr-1" /> {t("adminComments.bulk.delete")}
              </Button>
              {selected.size > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  {t("adminComments.selection.clear")}
                </Button>
              )}
            </div>
          </div>
          <ul className="space-y-3">
            {rows.map((r) => (
              <Row
                key={r.id}
                r={r}
                lang={lang}
                selected={selected.has(r.id)}
                onToggle={() => setSelected(toggleSelected(selected, r.id))}
                onModerate={(s) => moderate.mutate({ id: r.id, newStatus: s })}
                busy={moderate.isPending}
              />
            ))}
          </ul>
        </>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminComments.bulk.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "deleted"
                ? t("adminComments.bulk.confirmDeleteBody", { count: selected.size })
                : t("adminComments.bulk.confirmSpamBody", { count: selected.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminComments.bulk.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) bulk.mutate({ ids: [...selected], newStatus: confirm });
                setConfirm(null);
              }}
            >
              {t("adminComments.bulk.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({
  r,
  lang,
  selected,
  onToggle,
  onModerate,
  busy,
}: {
  r: AdminCommentRow;
  lang: "pl" | "en";
  selected: boolean;
  onToggle: () => void;
  onModerate: (status: CommentStatus) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const when = new Date(r.created_at).toLocaleString(lang === "pl" ? "pl-PL" : "en-GB");
  const title = (lang === "pl" ? r.post?.title_pl : r.post?.title_en) ?? r.post?.slug ?? "-";
  const variant: Record<CommentStatus, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "outline",
    approved: "default",
    spam: "destructive",
    deleted: "secondary",
  };
  return (
    <li
      className={`flex gap-3 rounded-lg border p-4 ${
        selected ? "border-primary/60 bg-primary/5" : "border-border bg-card"
      }`}
    >
      <Checkbox
        className="mt-1"
        checked={selected}
        onCheckedChange={onToggle}
        aria-label={t("adminComments.selection.selectRow")}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">
            {r.author?.display_name ?? r.author_name ?? "-"}
            {!r.user_id && r.author_name && (
              <span className="ml-1 font-normal text-xs text-muted-foreground">
                ({t("adminComments.guest", { defaultValue: "gość" })})
              </span>
            )}
          </span>
          <time className="text-xs text-muted-foreground" dateTime={r.created_at}>
            {when}
          </time>
          <Badge variant={variant[r.status as CommentStatus]}>
            {t(`adminComments.status.${r.status}`)}
          </Badge>
          <span
            className="ml-auto text-xs text-muted-foreground truncate max-w-[40%]"
            title={title}
          >
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
      </div>
    </li>
  );
}
