// Organizm: panel zadań (osobiste TO-DO). Szybkie dodawanie, priorytety,
// odhaczanie i usuwanie - wszystko na user_todos przez RLS użytkownika.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckSquare, ListTodo, Trash2 } from "lucide-react";
import { DockPanelShell } from "../DockPanelShell";
import { DockEmptyState } from "../atoms/DockEmptyState";
import { PriorityChip } from "../atoms/PriorityChip";
import {
  useCreateTodo,
  useDeleteTodo,
  useToggleTodo,
  useUpdateTodoPriority,
  useTodos,
} from "@/lib/dock/useTodos";
import { TODO_PRIORITIES, type TodoPriority } from "@/lib/dock/types";
import { cn } from "@/lib/utils";

export function TodoPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const todosQ = useTodos();
  const create = useCreateTodo();
  const toggle = useToggleTodo();
  const remove = useDeleteTodo();
  const setPriority = useUpdateTodoPriority();

  const [title, setTitle] = useState("");
  const [priority, setPriorityDraft] = useState<TodoPriority>("medium");
  const [tab, setTab] = useState<"open" | "done">("open");

  const all = todosQ.data ?? [];
  const items = all.filter((todo) => (tab === "open" ? !todo.done : todo.done));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (title.trim().length === 0) return;
    create.mutate({ title, priority });
    setTitle("");
  };

  return (
    <DockPanelShell title={t("dock.todos.title")} icon={<ListTodo className="h-4 w-4" />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-2 border-b border-border p-3">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("dock.todos.placeholder")}
          aria-label={t("dock.todos.placeholder")}
          className="w-full rounded-[6px] border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center gap-2">
          <select
            value={priority}
            onChange={(event) => setPriorityDraft(event.target.value as TodoPriority)}
            aria-label={t("dock.todos.priority.label")}
            className="rounded-[6px] border border-input bg-background px-2 py-1.5 text-xs text-foreground"
          >
            {TODO_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {t(`dock.todos.priority.${value}`)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={title.trim().length === 0 || create.isPending}
            className="ml-auto rounded-[6px] bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t("dock.todos.add")}
          </button>
        </div>
      </form>

      <div className="flex gap-1 border-b border-border px-3 py-2">
        {(["open", "done"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
            className={cn(
              "rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors",
              tab === value
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t(`dock.todos.tabs.${value}`)}
          </button>
        ))}
        <span className="ml-auto self-center text-[11px] text-muted-foreground">
          {t("dock.todos.openCount", { count: all.filter((todo) => !todo.done).length })}
        </span>
      </div>

      {todosQ.isError ? (
        <DockEmptyState>{t("dock.error")}</DockEmptyState>
      ) : items.length === 0 ? (
        <DockEmptyState icon={<CheckSquare className="h-6 w-6" aria-hidden />}>
          {t("dock.todos.empty")}
        </DockEmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((todo) => (
            <li key={todo.id} className="flex items-start gap-2 px-3 py-2">
              <input
                type="checkbox"
                checked={todo.done}
                onChange={() => toggle.mutate({ id: todo.id, done: !todo.done })}
                aria-label={todo.title}
                className="mt-1 h-4 w-4 rounded-[4px] border-input accent-[var(--brand,theme(colors.primary.DEFAULT))]"
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "break-words text-sm text-foreground",
                    todo.done && "text-muted-foreground line-through",
                  )}
                >
                  {todo.title}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <PriorityChip priority={todo.priority} />
                  {!todo.done && (
                    <select
                      value={todo.priority}
                      onChange={(event) =>
                        setPriority.mutate({
                          id: todo.id,
                          priority: event.target.value as TodoPriority,
                        })
                      }
                      aria-label={t("dock.todos.priority.label")}
                      className="rounded-[6px] border border-input bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {TODO_PRIORITIES.map((value) => (
                        <option key={value} value={value}>
                          {t(`dock.todos.priority.${value}`)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove.mutate(todo.id)}
                aria-label={t("dock.todos.remove")}
                className="rounded-[6px] p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </DockPanelShell>
  );
}
