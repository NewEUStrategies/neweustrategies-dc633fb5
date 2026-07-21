// Pasek "Follow-upy do zrobienia" nad skrzynką leadów: zaległe + nadchodzące
// otwarte zadania całego tenanta (okno 72 h), posortowane po terminie.
//
// Znika, gdy nie ma nic do zrobienia - skrzynka bez zadań wygląda jak dotąd.
// Odświeżanie na żywo: crm_task.* w eventInvalidationMap trafia w ["crm-tasks"].
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlarmClock, Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listCrmDueTasks, updateCrmTask, type CrmDueTaskRow } from "@/lib/crm-tasks.functions";

const TXT = {
  pl: {
    heading: "Follow-upy do zrobienia",
    overdue: (n: number) => `${n} po terminie`,
    upcoming: (n: number) => `${n} nadchodzące`,
    done: "Wykonane",
    openLead: "Otwórz leada",
  },
  en: {
    heading: "Follow-ups due",
    overdue: (n: number) => `${n} overdue`,
    upcoming: (n: number) => `${n} upcoming`,
    done: "Done",
    openLead: "Open lead",
  },
};

function leadLabel(task: CrmDueTaskRow): string {
  const lead = task.lead;
  if (!lead) return "";
  return [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email;
}

function formatDue(iso: string, lang: "pl" | "en"): string {
  return new Date(iso).toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function FollowUpsPanel({
  lang,
  onOpenLead,
}: {
  lang: "pl" | "en";
  onOpenLead: (leadId: string, taskId: string) => void;
}) {
  const t = TXT[lang];
  const qc = useQueryClient();

  const dueQ = useQuery({
    queryKey: ["crm-tasks", "due"],
    queryFn: async () => {
      const r = await listCrmDueTasks({ data: { limit: 8, horizon_hours: 72 } });
      return JSON.parse((r as { json: string }).json) as CrmDueTaskRow[];
    },
    staleTime: 30_000,
  });

  const doneMut = useMutation({
    mutationFn: async (id: string) => updateCrmTask({ data: { id, status: "done" } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["crm-tasks"] });
      void qc.invalidateQueries({ queryKey: ["crm-leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tasks = dueQ.data ?? [];
  if (tasks.length === 0) return null;

  const now = Date.now();
  const overdueCount = tasks.filter((task) => new Date(task.due_at).getTime() < now).length;
  const upcomingCount = tasks.length - overdueCount;

  return (
    <section
      className="rounded-md border border-brand/30 bg-brand/5 p-3 space-y-2"
      aria-label={t.heading}
    >
      <div className="flex flex-wrap items-center gap-2">
        <AlarmClock className="w-4 h-4 text-brand" aria-hidden />
        <h2 className="text-[13px] font-semibold">{t.heading}</h2>
        {overdueCount > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            {t.overdue(overdueCount)}
          </Badge>
        )}
        {upcomingCount > 0 && (
          <Badge variant="outline" className="text-[10px]">
            {t.upcoming(upcomingCount)}
          </Badge>
        )}
      </div>
      <ul className="divide-y divide-border/60">
        {tasks.map((task) => {
          const overdue = new Date(task.due_at).getTime() < now;
          return (
            <li key={task.id} className="flex items-center gap-2 py-1.5">
              <span
                className={
                  "shrink-0 tabular-nums text-[11px] " +
                  (overdue ? "text-destructive font-medium" : "text-muted-foreground")
                }
              >
                {formatDue(task.due_at, lang)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]">
                <span className="font-medium">{task.title}</span>
                {task.lead && <span className="text-muted-foreground"> · {leadLabel(task)}</span>}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => doneMut.mutate(task.id)}
                disabled={doneMut.isPending}
                title={t.done}
              >
                <Check className="w-3.5 h-3.5" aria-hidden />
                <span className="ml-1 hidden sm:inline">{t.done}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-1.5"
                onClick={() => onOpenLead(task.lead_id, task.id)}
                aria-label={t.openLead}
                title={t.openLead}
              >
                <ChevronRight className="w-4 h-4" aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
