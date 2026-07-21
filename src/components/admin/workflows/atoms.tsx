// Atomy modułu „Automatyzacje": statusy przebiegów/dostaw, chip typu
// zdarzenia, sformatowana data i podsumowanie kroków przepisu.
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-workflows";
import { CheckCircle2, XCircle, Clock3, Skull } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { parseWorkflowSteps } from "@/lib/admin/workflows";
import type { Json } from "@/integrations/supabase/types";
import { useActionName } from "./useActionName";

/** Status przebiegu workflow lub dostawy outboxu (wspólna paleta). */
export function RunStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<string, { icon: typeof CheckCircle2; className: string; label: string }> = {
    succeeded: {
      icon: CheckCircle2,
      className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
      label: t("adminWorkflows.runs.statusSucceeded"),
    },
    delivered: {
      icon: CheckCircle2,
      className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
      label: "delivered",
    },
    failed: {
      icon: XCircle,
      className: "bg-destructive/10 text-destructive border-destructive/30",
      label: t("adminWorkflows.runs.statusFailed"),
    },
    pending: {
      icon: Clock3,
      className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
      label: "pending",
    },
    retry: {
      icon: Clock3,
      className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
      label: "retry",
    },
    dead: {
      icon: Skull,
      className: "bg-muted text-muted-foreground border-border",
      label: "dead",
    },
  };
  const entry = map[status] ?? {
    icon: Clock3,
    className: "bg-muted text-muted-foreground border-border",
    label: status,
  };
  const Icon = entry.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 font-normal", entry.className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {entry.label}
    </Badge>
  );
}

/** Typ zdarzenia domenowego jako monospace'owy chip. */
export function EventTypeChip({ type, className }: { type: string; className?: string }) {
  return (
    <code
      className={cn(
        "rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/80",
        className,
      )}
    >
      {type}
    </code>
  );
}

/** Data lokalizowana wg języka panelu (krótko: dzień + godzina). */
export function DateTimeText({ iso, className }: { iso: string | null; className?: string }) {
  const { i18n, t } = useTranslation();
  if (!iso) {
    return (
      <span className={cn("text-muted-foreground", className)}>
        {t("adminWorkflows.common.never")}
      </span>
    );
  }
  const locale = i18n.language === "en" ? "en-GB" : "pl-PL";
  const formatted = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(iso));
  return (
    <time dateTime={iso} className={cn("tabular-nums", className)}>
      {formatted}
    </time>
  );
}

/** Podsumowanie kroków definicji jako sekwencja chipów „1. Akcja". */
export function StepChips({ steps, className }: { steps: Json; className?: string }) {
  const actionName = useActionName();
  const parsed = parseWorkflowSteps(steps);
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {parsed.map((step, index) => (
        <Badge key={`${step.action}-${index}`} variant="secondary" className="gap-1 font-normal">
          <span className="text-muted-foreground">{index + 1}.</span>
          {actionName(step.action)}
        </Badge>
      ))}
    </div>
  );
}
