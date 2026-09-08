// Organizm: panel zadań (osobiste TO-DO). Szybkie dodawanie, priorytety,
// odhaczanie i usuwanie - wszystko na user_todos przez RLS użytkownika.
//
// STAN OCZEKIWANIA MÓWI PRAWDĘ. Panel pokazywał „Brak zadań. Dodaj pierwsze
// powyżej", gdy zapytanie było jeszcze w drodze - czyli zapraszał do
// dopisania zadania, które już istnieje i zaraz się pojawi. Kolejność gałęzi
// to teraz błąd -> oczekiwanie -> puste -> lista, a wiersze oczekiwania mają
// geometrię wiersza realnego, więc podmiana nie rusza układu.
import { useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import "@/lib/i18n-dock";

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

  // Zależnością jest `todosQ.data`, a NIE `data ?? []`: drugie tworzy nową
  // tablicę przy każdym renderze, więc `useMemo` nigdy by nie trafił, a jego
  // obecność byłaby ozdobą.
  const todos = todosQ.data;
  const items = useMemo(
    () => (todos ?? []).filter((todo) => (tab === "open" ? !todo.done : todo.done)),
    [todos, tab],
  );
  const openCount = useMemo(
    () => (todos ?? []).reduce((sum, todo) => sum + (todo.done ? 0 : 1), 0),
    [todos],
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (title.trim().length === 0) return;
    create.mutate({ title, priority });
    setTitle("");
  };

  return (
    <DockPanelShell
      title={t("dock.todos.title")}
      icon={<ListTodo className="h-4 w-4" />}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-2 border-b border-border p-3">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("dock.todos.placeholder")}
          aria-label={t("dock.todos.placeholder")}
          className="w-full rounded-[6px] border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center gap-2">
          <Select
            value={priority}
            onValueChange={(value) => setPriorityDraft(value as TodoPriority)}
          >
            <SelectTrigger
              aria-label={t("dock.todos.priority.label")}
              className="h-8 w-auto gap-1 rounded-[6px] border-input bg-background px-2 py-0 text-xs text-foreground"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-[6px]">
              {TODO_PRIORITIES.map((value) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {t(`dock.todos.priority.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

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
          {t("dock.todos.openCount", { count: openCount })}
        </span>
      </div>

      {todosQ.isError ? (
        <DockEmptyState>{t("dock.error")}</DockEmptyState>
      ) : todosQ.isPending ? (
        <ul aria-busy="true" className="divide-y divide-border">
          {["w-11/12", "w-2/3", "w-5/6", "w-1/2"].map((width) => (
            <li key={width} className="flex items-start gap-2 px-3 py-2">
              <span className="skeleton-shimmer mt-1 h-4 w-4 shrink-0 rounded-[4px]" />
              <span className="min-w-0 flex-1 space-y-1.5">
                <span className={cn("skeleton-shimmer block h-4 rounded-[6px]", width)} />
                <span className="skeleton-shimmer block h-4 w-16 rounded-[6px]" />
              </span>
            </li>
          ))}
        </ul>
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
                    <Select
                      value={todo.priority}
                      onValueChange={(value) =>
                        setPriority.mutate({ id: todo.id, priority: value as TodoPriority })
                      }
                    >
                      <SelectTrigger
                        aria-label={t("dock.todos.priority.label")}
                        className="h-6 w-auto gap-1 rounded-[6px] border-input bg-background px-1.5 py-0 text-[11px] text-muted-foreground"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-[6px]">
                        {TODO_PRIORITIES.map((value) => (
                          <SelectItem key={value} value={value} className="text-xs">
                            {t(`dock.todos.priority.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
