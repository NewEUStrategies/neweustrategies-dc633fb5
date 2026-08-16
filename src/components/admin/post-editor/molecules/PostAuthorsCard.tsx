// Karta "Autorzy" w edytorze wpisu: jedna uporządkowana lista, w której
// PIERWSZA pozycja jest autorem głównym (posts.author_id), a kolejne to
// współautorzy (post_authors, sort_order rosnąco). Zapis idzie przez funkcję
// serwerową setPostAuthors - niezależnie od formularza, jak taksonomie/seria.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { setPostAuthors } from "@/lib/content.functions";
import { MAX_POST_AUTHORS, moveAuthor, removeAuthor } from "@/lib/content/postAuthors";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTenantAuthors, authorLabel } from "@/components/admin/hooks/useTenantAuthors";
import "@/lib/i18n-admin-post-panes";

const ADD = "__add__";

function initials(label: string): string {
  return (
    label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function PostAuthorsCard({
  postId,
  tenantId,
  mainAuthorId,
}: {
  postId: string;
  tenantId: string | null | undefined;
  mainAuthorId: string | null | undefined;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const save$ = useServerFn(setPostAuthors);
  const [draft, setDraft] = useState<string[] | null>(null);

  const peopleQ = useTenantAuthors(tenantId);
  const coAuthorsKey = ["admin", "post-authors", postId] as const;
  const { data: coAuthorRows } = useQuery({
    queryKey: coAuthorsKey,
    enabled: !!postId,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("post_authors")
        .select("user_id, sort_order")
        .eq("post_id", postId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => r.user_id as string);
    },
  });

  const persisted = useMemo(() => {
    const ids: string[] = [];
    if (mainAuthorId) ids.push(mainAuthorId);
    for (const id of coAuthorRows ?? []) if (!ids.includes(id)) ids.push(id);
    return ids;
  }, [mainAuthorId, coAuthorRows]);

  const value = draft ?? persisted;
  const peopleById = useMemo(
    () => new Map((peopleQ.data ?? []).map((p) => [p.id, p] as const)),
    [peopleQ.data],
  );

  const saveM = useMutation({
    mutationFn: async (ids: string[]) => save$({ data: { id: postId, authorIds: ids } }),
    onSuccess: () => {
      setDraft(null);
      void qc.invalidateQueries({ queryKey: coAuthorsKey });
      void qc.invalidateQueries({ queryKey: ["post-by-slug"] });
      toast.success(t("adminPostPanes.authors.saved"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const dirty = draft !== null && draft.join(",") !== persisted.join(",");
  const available = (peopleQ.data ?? []).filter((p) => !value.includes(p.id));

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground -mt-1">{t("adminPostPanes.authors.hint")}</p>

      <ul className="space-y-1.5">
        {value.map((id, index) => {
          const person = peopleById.get(id);
          const label = person ? authorLabel(person) : t("adminPostPanes.authors.unknown");
          return (
            <li
              key={id}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5"
            >
              <Avatar className="h-6 w-6 rounded-[5px]">
                {person?.avatar_url ? <AvatarImage src={person.avatar_url} alt={label} /> : null}
                <AvatarFallback className="rounded-[5px] text-[10px]">
                  {initials(label)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{label}</p>
                <p className="text-[10px] text-muted-foreground">
                  {index === 0
                    ? t("adminPostPanes.authors.mainBadge")
                    : t("adminPostPanes.authors.coBadge", { n: index })}
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                aria-label={t("adminPostPanes.authors.moveUp")}
                disabled={index === 0}
                onClick={() => setDraft(moveAuthor(value, index, -1))}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                aria-label={t("adminPostPanes.authors.moveDown")}
                disabled={index === value.length - 1}
                onClick={() => setDraft(moveAuthor(value, index, 1))}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                aria-label={t("adminPostPanes.authors.remove")}
                disabled={value.length <= 1}
                onClick={() => setDraft(removeAuthor(value, id))}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          );
        })}
      </ul>

      {value.length < MAX_POST_AUTHORS && (
        <Select
          value={ADD}
          onValueChange={(v) => {
            if (v !== ADD) setDraft([...value, v]);
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={t("adminPostPanes.authors.addPlaceholder")}>
              {t("adminPostPanes.authors.addPlaceholder")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {available.length === 0 ? (
              <SelectItem value={ADD} disabled>
                {t("adminPostPanes.authors.noneAvailable")}
              </SelectItem>
            ) : (
              available.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {authorLabel(p)}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      )}

      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          disabled={!dirty || saveM.isPending}
          onClick={() => saveM.mutate(value)}
        >
          {t("adminPostPanes.authors.save")}
        </Button>
        {dirty && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
            {t("adminPostPanes.authors.cancel")}
          </Button>
        )}
      </div>
    </div>
  );
}
