// Organizm: panel „Harmonogram" - lista i kalendarz nad JEDNYM zbiorem danych.
//
// Przełącznik widoku nie pobiera nic ponownie: obie prezentacje czytają tę samą
// odpowiedź RPC, więc przejście lista <-> kalendarz jest natychmiastowe i nie
// może pokazać dwóch różnych harmonogramów.
//
// Lista dzieli terminy na „dziś", „wkrótce" i „minione", w tej kolejności -
// harmonogram odpowiada na pytanie „co dalej", a nie „co było". Minione idą
// od najnowszych, bo ostatnie ustalenie waży więcej niż pierwsze spotkanie
// sprzed pół roku.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarDays, List, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClubWorkspaceEmpty } from "@/components/clubs/atoms/ClubWorkspaceEmpty";
import { ClubThreadListSkeleton } from "@/components/clubs/atoms/ClubSkeletons";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { ClubMilestoneRow } from "@/components/clubs/molecules/ClubMilestoneRow";
import { ClubMilestoneForm } from "@/components/clubs/molecules/ClubMilestoneForm";
import { ClubThreadCalendar } from "@/components/clubs/organisms/ClubThreadCalendar";
import {
  useClubThreadMilestones,
  useRemoveClubThreadMilestone,
  useUpsertClubThreadMilestone,
} from "@/lib/clubs/useThreadWorkspace";
import {
  groupSchedule,
  toClubWorkspaceError,
  type ClubThreadMilestoneRow,
} from "@/lib/clubs/threadWorkspaceTypes";

type ScheduleView = "list" | "calendar";

export function ClubThreadSchedulePanel({
  threadId,
  lang,
  canCurate,
}: {
  threadId: string;
  lang: "pl" | "en";
  canCurate: boolean;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<ScheduleView>("list");
  const [editing, setEditing] = useState<ClubThreadMilestoneRow | null>(null);
  const [adding, setAdding] = useState(false);

  const query = useClubThreadMilestones({ threadId });
  const upsert = useUpsertClubThreadMilestone(threadId);
  const remove = useRemoveClubThreadMilestone(threadId);

  const rows = useMemo(() => query.data ?? [], [query.data]);
  // Chwila odniesienia liczona RAZ na render listy: gdyby każdy wiersz pytał
  // o `Date.now()`, pozycja na granicy doby mogłaby wpaść do dwóch kubełków.
  const groups = useMemo(() => groupSchedule(rows, new Date()), [rows]);

  const closeForm = () => {
    setAdding(false);
    setEditing(null);
  };

  if (query.isPending) return <ClubThreadListSkeleton count={3} />;
  if (query.isError) return <ClubErrorNotice onRetry={() => void query.refetch()} />;

  const formOpen = adding || editing !== null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label={t("club.threadHub.schedule.viewLabel")}
          className="inline-flex rounded-lg border border-border/60 p-0.5"
        >
          {(["list", "calendar"] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={view === option ? "secondary" : "ghost"}
              className="h-7 gap-1.5 px-2.5 text-xs"
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >
              {option === "list" ? (
                <List className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {t(`club.threadHub.schedule.view.${option}`)}
            </Button>
          ))}
        </div>

        {canCurate && !formOpen ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("club.threadHub.schedule.add")}
          </Button>
        ) : null}
      </div>

      {formOpen ? (
        <ClubMilestoneForm
          threadId={threadId}
          initial={editing}
          pending={upsert.isPending}
          onCancel={closeForm}
          onSubmit={(input) =>
            upsert.mutate(input, {
              onSuccess: () => {
                closeForm();
                toast.success(t("club.threadHub.schedule.saved"));
              },
              onError: (error) =>
                toast.error(t(`club.threadHub.error.${toClubWorkspaceError(error)}`)),
            })
          }
        />
      ) : null}

      {rows.length === 0 ? (
        <ClubWorkspaceEmpty
          icon={<CalendarDays className="h-5 w-5" />}
          title={t("club.threadHub.schedule.empty")}
          hint={
            canCurate
              ? t("club.threadHub.schedule.emptyHint")
              : t("club.threadHub.schedule.emptyReadonly")
          }
          action={
            canCurate && !formOpen ? (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t("club.threadHub.schedule.addFirst")}
              </Button>
            ) : undefined
          }
        />
      ) : view === "calendar" ? (
        <ClubThreadCalendar
          rows={rows}
          lang={lang}
          onSelect={
            canCurate
              ? (row) => {
                  setAdding(false);
                  setEditing(row);
                }
              : undefined
          }
        />
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.key}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`club.threadHub.schedule.group.${group.key}`)}
              </h3>
              <ul className="space-y-2">
                {group.items.map((row) => (
                  <ClubMilestoneRow
                    key={row.id}
                    row={row}
                    lang={lang}
                    onEdit={(target) => {
                      setAdding(false);
                      setEditing(target);
                    }}
                    onRemove={(target) => {
                      if (!window.confirm(t("club.threadHub.schedule.removeConfirm"))) return;
                      remove.mutate(target.id, {
                        onSuccess: () => toast.success(t("club.threadHub.schedule.removed")),
                        onError: (error) =>
                          toast.error(t(`club.threadHub.error.${toClubWorkspaceError(error)}`)),
                      });
                    }}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
