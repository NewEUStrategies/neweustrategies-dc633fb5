// Osobiste zadania (user_todos). Izolację pilnuje RLS (user_id + tenant_id),
// klient nie podaje tenant_id - baza wypełnia go z kontekstu żądania.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { dockKeys } from "./keys";
import { normalizePriority, sortTodos, type TodoPriority, type UserTodo } from "./types";

const SELECT = "id, title, priority, due_at, done, done_at, source_task_id, created_at";

interface TodoRowDb {
  id: string;
  title: string;
  priority: string;
  due_at: string | null;
  done: boolean;
  done_at: string | null;
  source_task_id: string | null;
  created_at: string;
}

export function useTodos() {
  const { user } = useAuth();
  return useQuery({
    queryKey: dockKeys.todos(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<UserTodo[]> => {
      const { data, error } = await supabase
        .from("user_todos")
        .select(SELECT)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      const rows = (data ?? []).map((row) => {
        const r = row as TodoRowDb;
        return { ...r, priority: normalizePriority(r.priority) } satisfies UserTodo;
      });
      return sortTodos(rows);
    },
  });
}

export function useOpenTodoCount(): number {
  const { data } = useTodos();
  return (data ?? []).filter((todo) => !todo.done).length;
}

export interface TodoDraft {
  title: string;
  priority?: TodoPriority;
  dueAt?: string | null;
}

export function useCreateTodo() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (draft: TodoDraft) => {
      if (!user) throw new Error("Not authenticated");
      const title = draft.title.trim().slice(0, 500);
      if (title.length === 0) throw new Error("Empty title");
      const { error } = await supabase.from("user_todos").insert({
        user_id: user.id,
        title,
        priority: normalizePriority(draft.priority),
        due_at: draft.dueAt ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dockKeys.todos(user?.id) }),
  });
}

export function useToggleTodo() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      const { error } = await supabase
        .from("user_todos")
        .update({ done, done_at: done ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dockKeys.todos(user?.id) }),
  });
}

export function useUpdateTodoPriority() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, priority }: { id: string; priority: TodoPriority }) => {
      const { error } = await supabase
        .from("user_todos")
        .update({ priority: normalizePriority(priority) })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dockKeys.todos(user?.id) }),
  });
}

export function useDeleteTodo() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_todos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dockKeys.todos(user?.id) }),
  });
}
