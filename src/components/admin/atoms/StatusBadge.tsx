import { Check, Pencil, Lock, Circle, Clock, Send } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";

export type ContentStatus =
  | "published"
  | "draft"
  | "archived"
  | "pending_review"
  | "scheduled";

interface StatusBadgeProps {
  status: ContentStatus | string;
  label: string;
  className?: string;
  title?: string;
}

/**
 * Atom: prominent status pill matching the LangCoverageBadges visual language.
 * Used across admin list pages (posts, pages, media, categories, tags).
 */
export function StatusBadge({ status, label, className, title }: StatusBadgeProps) {
  const tone = getTone(status);
  const Icon = tone.icon;
  return (
    <span
      title={title ?? label}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border",
        tone.classes,
        className,
      )}
    >
      <Icon className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

function getTone(status: string): {
  classes: string;
  icon: typeof Check;
} {
  switch (status) {
    case "published":
      return {
        classes:
          "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
        icon: Check,
      };
    case "draft":
      return {
        classes:
          "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400",
        icon: Pencil,
      };
    case "pending_review":
      return {
        classes:
          "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-400",
        icon: Send,
      };
    case "scheduled":
      return {
        classes:
          "border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-400",
        icon: Clock,
      };
    case "archived":
      return {
        classes:
          "border-slate-500/40 bg-slate-500/15 text-slate-700 dark:text-slate-300",
        icon: Lock,
      };
    default:
      return {
        classes:
          "border-border bg-muted text-muted-foreground",
        icon: Circle,
      };
  }
}
