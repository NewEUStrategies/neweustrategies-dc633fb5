// Typy przestrzeni roboczej doku (pasek narzędzi nad dolną krawędzią ekranu).
//
// Jedno źródło prawdy dla warstwy danych (src/lib/dock/*) i prezentacji
// (src/components/dock/*). Wartości priorytetów i stanów kolejki czytania
// odpowiadają CHECK-om w bazie (user_todos.priority, user_read_later.state),
// więc rozjazd wychwytuje test, a nie użytkownik.

export const DOCK_TOOLS = ["chat", "todos", "notes", "saved", "calendar", "readLater"] as const;
export type DockToolId = (typeof DOCK_TOOLS)[number];

export const TODO_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type TodoPriority = (typeof TODO_PRIORITIES)[number];

export const READ_LATER_STATES = ["unread", "read", "archived"] as const;
export type ReadLaterState = (typeof READ_LATER_STATES)[number];

export const NOTE_COLORS = ["amber", "rose", "sky", "emerald", "violet", "slate"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export interface UserNote {
  id: string;
  title: string;
  body: string;
  color: NoteColor;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserTodo {
  id: string;
  title: string;
  priority: TodoPriority;
  due_at: string | null;
  done: boolean;
  done_at: string | null;
  source_task_id: string | null;
  created_at: string;
}

export interface ReadLaterItem {
  id: string;
  entity_type: "post" | "page" | "event" | "document" | "external";
  entity_id: string;
  title: string | null;
  url: string | null;
  state: ReadLaterState;
  note: string | null;
  read_at: string | null;
  created_at: string;
}

export function isTodoPriority(value: unknown): value is TodoPriority {
  return TODO_PRIORITIES.includes(value as TodoPriority);
}

export function normalizePriority(value: unknown): TodoPriority {
  return isTodoPriority(value) ? value : "medium";
}

export function normalizeNoteColor(value: unknown): NoteColor {
  return NOTE_COLORS.includes(value as NoteColor) ? (value as NoteColor) : "amber";
}

export function normalizeReadLaterState(value: unknown): ReadLaterState {
  return READ_LATER_STATES.includes(value as ReadLaterState)
    ? (value as ReadLaterState)
    : "unread";
}

/** Kolejność wyświetlania: pilne najpierw, potem termin, potem data dodania. */
export const PRIORITY_RANK: Record<TodoPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function sortTodos(items: readonly UserTodo[]): UserTodo[] {
  return [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (rank !== 0) return rank;
    const aDue = a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY;
    const bDue = b.due_at ? Date.parse(b.due_at) : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
}
