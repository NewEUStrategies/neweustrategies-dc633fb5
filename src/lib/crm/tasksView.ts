// Reguły widoku follow-upów CRM - to, co panele LICZĄ i FORMATUJĄ.
//
// Ta sama para funkcji (etykieta kontaktu przy zadaniu, format terminu) żyła
// osobno w `FollowUpsPanel.tsx` i `LeadTasksPanel.tsx`, w obu przypadkach
// wewnątrz komponentu - czyli bez możliwości sprawdzenia inaczej niż przez
// render panelu z zamockowanym zapytaniem. Tu są raz, jako czysta reguła.
//
// Tekst nie mieszka w tym module: funkcje zwracają DANE albo KLUCZ, a panel
// dokłada swój słownik PL/EN.

/** Minimum, jakiego etykieta potrzebuje od wiersza zadania. */
export interface TaskLeadLike {
  id?: string | null;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

/**
 * Etykieta kontaktu przy zadaniu: imię i nazwisko, a gdy ich brak - e-mail.
 * Zadanie bez wizytówki leada nie ma etykiety (pusty napis), bo panel pokazuje
 * ją tylko warunkowo.
 */
export function leadLabel(lead: TaskLeadLike | null | undefined): string {
  if (!lead) return "";
  const name = [lead.first_name, lead.last_name]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return name || (lead.email ?? "").trim();
}

/** Locale BCP-47 dla panelu - jedno miejsce, w którym język staje się locale. */
export function taskLocale(lang: "pl" | "en"): string {
  return lang === "en" ? "en-GB" : "pl-PL";
}

/**
 * Termin zadania w formacie panelu. Data nieparsowalna oddaje pusty napis
 * zamiast „Invalid Date" - lista zadań nie może pokazać takiego tekstu.
 */
export function formatDue(
  iso: string | null | undefined,
  lang: "pl" | "en",
  style: "short" | "medium" = "short",
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(taskLocale(lang), {
    dateStyle: style === "medium" ? "medium" : "short",
    timeStyle: "short",
  });
}

/** Czy termin zadania już minął. Brak terminu = nie po terminie. */
export function isOverdue(iso: string | null | undefined, now = Date.now()): boolean {
  if (!iso) return false;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) && ts < now;
}

export interface DueSplit {
  overdue: number;
  upcoming: number;
}

/** Podział zadań na zaległe i nadchodzące - liczby w pasku follow-upów. */
export function splitDueTasks(
  tasks: ReadonlyArray<{ due_at: string | null }>,
  now = Date.now(),
): DueSplit {
  const overdue = tasks.filter((task) => isOverdue(task.due_at, now)).length;
  return { overdue, upcoming: tasks.length - overdue };
}

/**
 * Domyślny termin nowego follow-upu: jutro o 9:00 czasu lokalnego. Wyliczany
 * z podanej chwili, żeby test nie zależał od tego, o której jest uruchamiany.
 */
export function defaultDueDate(now: Date = new Date()): Date {
  const date = new Date(now.getTime());
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}

/** Kolejność zadań w panelu: otwarte przed zamkniętymi, w każdej grupie po terminie. */
export function sortTasksForPanel<T extends { status: string; due_at: string | null }>(
  tasks: readonly T[],
): T[] {
  const rank = (status: string): number => (status === "open" ? 0 : 1);
  return [...tasks].sort((a, b) => {
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
    const ta = a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY;
    const tb = b.due_at ? Date.parse(b.due_at) : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
}
