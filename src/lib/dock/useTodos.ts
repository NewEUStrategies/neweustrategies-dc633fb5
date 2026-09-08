// Osobiste zadania (user_todos). Izolację pilnuje RLS (user_id + tenant_id),
// klient nie podaje tenant_id - baza wypełnia go z kontekstu żądania.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { dockKeys } from "./keys";
import { DOCK_GC_MS, DOCK_STALE_MS } from "./queryPolicy";
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

/**
 * Opcje zapytania WYCIĄGNIĘTE Z HAKA, żeby ten sam kształt (klucz, funkcja,
 * świeżość) mógł być użyty także do ROZGRZANIA danych przed otwarciem panelu
 * (`prefetchDockData`). Wcześniej opcje żyły tylko w ciele haka, więc nie
 * istniał sposób pobrania danych bez zamontowania panelu - czyli sieć
 * startowała po kliknięciu, szeregowo za pobraniem paczki panelu.
 * To ta sama konwencja, co `conversationsQueryOptions` w warstwie czatu.
 */
export function todosQueryOptions(userId: string | undefined) {
  return {
    queryKey: dockKeys.todos(userId),
    staleTime: DOCK_STALE_MS,
    gcTime: DOCK_GC_MS,
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
  };
}

export function useTodos() {
  const { user } = useAuth();
  return useQuery({ ...todosQueryOptions(user?.id), enabled: !!user });
}

/**
 * Licznik otwartych zadań przy ikonie na pasku.
 *
 * Liczy przez `select`, a NIE przez filtrowanie wyniku w ciele komponentu -
 * i to jest różnica wykonawcza, nie kosmetyczna. React Query przerysowuje
 * subskrybenta, gdy zmieni się WYNIK `select`; bez niego dok przerysowywał
 * się przy KAŻDYM odświeżeniu listy zadań (nowa tablica = nowa referencja),
 * także wtedy, gdy liczba otwartych pozycji była identyczna. Tu wynikiem jest
 * liczba, więc pasek nie rusza się, dopóki licznik się nie zmieni.
 * Wzorzec przeniesiony z `useChatUnreadTotal` w warstwie czatu.
 */
export function useOpenTodoCount(): number {
  const { user } = useAuth();
  const q = useQuery({
    ...todosQueryOptions(user?.id),
    enabled: !!user,
    select: (todos: UserTodo[]) => todos.reduce((sum, todo) => sum + (todo.done ? 0 : 1), 0),
  });
  return q.data ?? 0;
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
