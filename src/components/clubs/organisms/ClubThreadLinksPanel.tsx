// Organizm: panel „Powiązane wątki".
//
// Kotwica (`club_threads.anchor_*`) łączy wątek z TREŚCIĄ PLATFORMY - aktem
// prawnym, wpisem, wydarzeniem. Nie łączy wątku z WĄTKIEM, a to jest inna
// relacja: bez niej dyskusja z maja i jej ciąg dalszy z września są dwoma
// niepowiązanymi ekranami.
//
// Relacja jest NAZWANA i SKIEROWANA, więc ten sam link czyta się inaczej
// z każdego końca: „kontynuuje" wychodzące jest „poprzedzone przez"
// przychodzącym. Kierunek jest widoczny, bo bez niego czytelnik nie wie,
// który wątek jest wcześniejszy.
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, Link2, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClubWorkspaceEmpty } from "@/components/clubs/atoms/ClubWorkspaceEmpty";
import { ClubThreadListSkeleton } from "@/components/clubs/atoms/ClubSkeletons";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { useClubThreadLinks, useRemoveClubThreadLink } from "@/lib/clubs/useClubWorkspace";
import { formatDateShort } from "@/lib/i18n/format";
import { toClubThreadRelation, toClubWorkspaceError } from "@/lib/clubs/workspaceTypes";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

export function ClubThreadLinksPanel({ threadId, lang }: { threadId: string; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const query = useClubThreadLinks({ threadId });
  const remove = useRemoveClubThreadLink(threadId);
  const rows = query.data ?? [];

  if (query.isPending) return <ClubThreadListSkeleton count={2} />;
  if (query.isError) return <ClubErrorNotice onRetry={() => void query.refetch()} />;

  if (rows.length === 0) {
    return (
      <ClubWorkspaceEmpty
        icon={<Link2 className="h-5 w-5" />}
        title={t("club.workspace.links.empty")}
        hint={t("club.workspace.links.emptyHint")}
      />
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const relation = toClubThreadRelation(row.relation);
        const incoming = row.direction === "incoming";
        return (
          <li
            key={row.id}
            className="group/link rounded-xl border border-border/60 bg-card p-3 transition-colors hover:border-primary/30 sm:p-4"
          >
            <div className="flex items-start gap-3">
              <span
                className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
                title={t(`club.workspace.linkDirection.${row.direction}`)}
              >
                {incoming ? (
                  <ArrowDownLeft className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[11px]">
                    {t(`club.workspace.relation.${incoming ? "incoming" : "outgoing"}.${relation}`)}
                  </Badge>
                  <Badge variant="secondary" className="text-[11px]">
                    {t(`club.kind.${row.kind}`)}
                  </Badge>
                </div>

                <Link
                  to="/club/$clubSlug/t/$threadSlug"
                  params={{ clubSlug: row.club_slug, threadSlug: row.thread_slug }}
                  className="mt-1 block text-sm font-medium underline-offset-4 hover:underline"
                >
                  {row.title}
                </Link>

                <p className="mt-1 text-xs text-muted-foreground">
                  {pickLocalized(row, "club_name", lang)}
                  {" · "}
                  {t("club.repliesCount", { count: row.reply_count })}
                  {row.last_reply_at !== null
                    ? ` · ${formatDateShort(row.last_reply_at, lang)}`
                    : ""}
                </p>

                {row.note !== null && row.note.length > 0 ? (
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{row.note}</p>
                ) : null}
              </div>

              {/* Krawędź zdejmuje się od strony wątku, który ją założył -
                  przychodzącej nie skasujemy stąd i baza też na to nie pozwoli. */}
              {row.can_remove && !incoming ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 p-0 text-destructive opacity-70 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/link:opacity-100"
                  aria-label={t("club.workspace.remove")}
                  onClick={() => {
                    if (!window.confirm(t("club.workspace.links.removeConfirm"))) return;
                    remove.mutate(row.id, {
                      onSuccess: () => toast.success(t("club.workspace.links.removed")),
                      onError: (error) =>
                        toast.error(t(`club.workspace.error.${toClubWorkspaceError(error)}`)),
                    });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
