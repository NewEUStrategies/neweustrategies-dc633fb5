// Zakładka "Zadania" w karcie leada: lista follow-upów + szybkie dodawanie.
//
// Dane przez server fn (requireStaff + RLS), realtime przez szynę zdarzeń
// (crm_task.* w eventInvalidationMap odświeża ["crm-tasks"]). Przypomnienie
// wysyła skaner bazodanowy o terminie - panel tylko zarządza zadaniami.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlarmClock, CalendarPlus, Check, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePickerField } from "@/components/admin/coupons/DatePickerField";
import { newIdempotencyKey } from "@/lib/http/idempotency";
import {
  createCrmTask,
  deleteCrmTask,
  listCrmLeadTasks,
  updateCrmTask,
  type CrmTaskRow,
} from "@/lib/crm-tasks.functions";

const TXT = {
  pl: {
    add: "Dodaj follow-up",
    titlePh: "Co jest do zrobienia? (np. oddzwonić po webinarze)",
    notePh: "Notatka (opcjonalnie)",
    due: "Termin",
    save: "Dodaj",
    empty: "Brak zadań dla tego leada. Dodaj pierwszy follow-up powyżej.",
    open: "Otwarte",
    closed: "Zakończone",
    markDone: "Oznacz jako wykonane",
    reopen: "Przywróć jako otwarte",
    delete: "Usuń",
    overdue: "po terminie",
    reminded: "przypomnienie wysłane",
    added: "Dodano follow-up - przypomnimy o terminie",
  },
  en: {
    add: "Add follow-up",
    titlePh: "What needs doing? (e.g. call back after the webinar)",
    notePh: "Note (optional)",
    due: "Due",
    save: "Add",
    empty: "No tasks for this lead yet. Add the first follow-up above.",
    open: "Open",
    closed: "Completed",
    markDone: "Mark as done",
    reopen: "Reopen",
    delete: "Delete",
    overdue: "overdue",
    reminded: "reminder sent",
    added: "Follow-up added - we will remind you at the due time",
  },
};

/** Domyślny termin: jutro o 9:00 lokalnie. */
function defaultDueValue(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

function formatDue(iso: string, lang: "pl" | "en"): string {
  return new Date(iso).toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function LeadTasksPanel({
  leadId,
  lang,
  highlightTaskId,
}: {
  leadId: string;
  lang: "pl" | "en";
  highlightTaskId?: string | null;
}) {
  const t = TXT[lang];
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState(defaultDueValue);

  const tasksQ = useQuery({
    queryKey: ["crm-tasks", "lead", leadId],
    queryFn: async () => {
      const r = await listCrmLeadTasks({ data: { lead_id: leadId } });
      return JSON.parse((r as { json: string }).json) as CrmTaskRow[];
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["crm-tasks"] });
    void qc.invalidateQueries({ queryKey: ["crm-lead", leadId] });
    void qc.invalidateQueries({ queryKey: ["crm-leads"] });
  };

  const createMut = useMutation({
    mutationFn: async () =>
      createCrmTask({
        data: {
          lead_id: leadId,
          title: title.trim(),
          note: note.trim() || undefined,
          due_at: new Date(due).toISOString(),
          idempotency_key: newIdempotencyKey("crm.add_task"),
        },
      }),
    onSuccess: () => {
      toast.success(t.added);
      setTitle("");
      setNote("");
      setDue(defaultDueValue());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CrmTaskRow["status"] }) =>
      updateCrmTask({ data: { id, status } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => deleteCrmTask({ data: { id } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const tasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);
  const { openTasks, closedTasks } = useMemo(
    () => ({
      openTasks: tasks.filter((task) => task.status === "open"),
      closedTasks: tasks.filter((task) => task.status !== "open"),
    }),
    [tasks],
  );

  const canSave = title.trim().length > 0 && due.length > 0 && !createMut.isPending;

  return (
    <div className="space-y-4">
      <form
        className="space-y-2 rounded-md border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) createMut.mutate();
        }}
      >
        <div className="flex items-center gap-2 text-[12px] font-medium">
          <CalendarPlus className="w-3.5 h-3.5" aria-hidden />
          {t.add}
        </div>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t.titlePh}
          className="h-8 text-[13px]"
          maxLength={200}
        />
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t.notePh}
          rows={2}
          className="text-[13px]"
          maxLength={2000}
        />
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="crm-task-due" className="text-[11px] text-muted-foreground">
              {t.due}
            </Label>
            <Input
              id="crm-task-due"
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="h-8 text-[13px] w-[210px]"
            />
          </div>
          <Button type="submit" size="sm" disabled={!canSave}>
            {t.save}
          </Button>
        </div>
      </form>

      {tasks.length === 0 && !tasksQ.isLoading ? (
        <p className="text-[12px] text-muted-foreground">{t.empty}</p>
      ) : (
        <div className="space-y-3">
          <TaskGroup
            heading={`${t.open} (${openTasks.length})`}
            tasks={openTasks}
            lang={lang}
            highlightTaskId={highlightTaskId}
            actionLabel={t.markDone}
            actionIcon={<Check className="w-3.5 h-3.5" aria-hidden />}
            onAction={(id) => statusMut.mutate({ id, status: "done" })}
            onDelete={(id) => deleteMut.mutate(id)}
            deleteLabel={t.delete}
            overdueLabel={t.overdue}
            remindedLabel={t.reminded}
          />
          {closedTasks.length > 0 && (
            <TaskGroup
              heading={`${t.closed} (${closedTasks.length})`}
              tasks={closedTasks}
              lang={lang}
              highlightTaskId={highlightTaskId}
              actionLabel={t.reopen}
              actionIcon={<RotateCcw className="w-3.5 h-3.5" aria-hidden />}
              onAction={(id) => statusMut.mutate({ id, status: "open" })}
              onDelete={(id) => deleteMut.mutate(id)}
              deleteLabel={t.delete}
              overdueLabel={t.overdue}
              remindedLabel={t.reminded}
              muted
            />
          )}
        </div>
      )}
    </div>
  );
}

function TaskGroup({
  heading,
  tasks,
  lang,
  highlightTaskId,
  actionLabel,
  actionIcon,
  onAction,
  onDelete,
  deleteLabel,
  overdueLabel,
  remindedLabel,
  muted = false,
}: {
  heading: string;
  tasks: CrmTaskRow[];
  lang: "pl" | "en";
  highlightTaskId?: string | null;
  actionLabel: string;
  actionIcon: React.ReactNode;
  onAction: (id: string) => void;
  onDelete: (id: string) => void;
  deleteLabel: string;
  overdueLabel: string;
  remindedLabel: string;
  muted?: boolean;
}) {
  if (tasks.length === 0) return null;
  const now = Date.now();
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">{heading}</h3>
      <ul className="space-y-1.5">
        {tasks.map((task) => {
          const overdue = task.status === "open" && new Date(task.due_at).getTime() < now;
          return (
            <li
              key={task.id}
              className={
                "flex flex-col gap-1 rounded-md border p-2.5 " +
                (task.id === highlightTaskId ? "border-brand ring-1 ring-brand/40 " : "") +
                (muted ? "opacity-70" : "")
              }
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div
                    className={
                      "text-[13px] font-medium " +
                      (task.status !== "open" ? "line-through text-muted-foreground" : "")
                    }
                  >
                    {task.title}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span
                      className={
                        "inline-flex items-center gap-1 " +
                        (overdue ? "text-destructive font-medium" : "")
                      }
                    >
                      <AlarmClock className="w-3 h-3" aria-hidden />
                      {formatDue(task.due_at, lang)}
                      {overdue ? ` · ${overdueLabel}` : ""}
                    </span>
                    {task.reminded_at && <span>· {remindedLabel}</span>}
                  </div>
                  {task.note && (
                    <p className="mt-1 text-[12px] text-muted-foreground whitespace-pre-wrap">
                      {task.note}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => onAction(task.id)}
                    title={actionLabel}
                  >
                    {actionIcon}
                    <span className="ml-1 hidden sm:inline">{actionLabel}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5"
                    onClick={() => onDelete(task.id)}
                    aria-label={deleteLabel}
                    title={deleteLabel}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-destructive" aria-hidden />
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
