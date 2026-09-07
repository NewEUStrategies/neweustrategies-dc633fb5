// Atom: chip priorytetu zadania. Kolory z tokenów semantycznych, żeby
// działały w trybie jasnym i ciemnym.
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { TodoPriority } from "@/lib/dock/types";

const TONE: Record<TodoPriority, string> = {
  urgent: "bg-destructive/10 text-destructive ring-destructive/30",
  high: "bg-primary/10 text-primary ring-primary/30",
  medium: "bg-muted text-muted-foreground ring-border",
  low: "bg-secondary text-secondary-foreground ring-border",
};

export function PriorityChip({
  priority,
  className,
}: {
  priority: TodoPriority;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[6px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
        TONE[priority],
        className,
      )}
    >
      {t(`dock.todos.priority.${priority}`)}
    </span>
  );
}
