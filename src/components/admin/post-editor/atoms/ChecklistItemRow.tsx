// Atom: a single publish-checklist line. The icon encodes state - satisfied
// (check), missing-required (destructive x) or missing-recommended (amber
// circle) - and the label is looked up from the shared i18n item id.
import { useTranslation } from "react-i18next";
import { Check, X, Circle } from "lucide-react";
import type { ChecklistItem } from "@/lib/content/publishChecklist";
import "@/lib/i18n-admin-post-panes";

export function ChecklistItemRow({ item }: { item: ChecklistItem }) {
  const { t } = useTranslation();
  const label = t(`adminPostPanes.publishChecklist.items.${item.id}`);
  return (
    <li className="flex items-center gap-2 text-xs py-0.5">
      {item.ok ? (
        <Check
          className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-500"
          aria-hidden
        />
      ) : item.level === "required" ? (
        <X className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
      ) : (
        <Circle className="h-3 w-3 shrink-0 text-amber-500" aria-hidden />
      )}
      <span className={item.ok ? "text-muted-foreground line-through decoration-border" : ""}>
        {label}
      </span>
    </li>
  );
}
