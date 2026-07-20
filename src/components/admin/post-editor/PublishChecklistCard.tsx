// Karta "Checklista publikacji" w sidebarze edytora wpisu. Czysta prezentacja
// wyniku buildPublishChecklist - ta sama ocena zasila bramkę przy przejściu
// w published/scheduled (admin.posts.$slug.tsx), więc karta i dialog nigdy
// się nie rozjeżdżają.
import { useTranslation } from "react-i18next";
import { Check, X, Circle } from "lucide-react";
import type { PublishChecklist, ChecklistItem } from "@/lib/content/publishChecklist";
import "@/lib/i18n-admin-post-panes";

function ItemRow({ item }: { item: ChecklistItem }) {
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

export function PublishChecklistCard({ checklist }: { checklist: PublishChecklist }) {
  const { t } = useTranslation();
  const required = checklist.items.filter((i) => i.level === "required");
  const recommended = checklist.items.filter((i) => i.level === "recommended");
  const barColor =
    checklist.score >= 80
      ? "bg-emerald-500"
      : checklist.score >= 50
        ? "bg-amber-500"
        : "bg-destructive";

  return (
    <div className="space-y-2">
      <div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
          <span>{t("adminPostPanes.publishChecklist.scoreLabel")}</span>
          <span className="tabular-nums font-medium">{checklist.score}/100</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={checklist.score}
          aria-label={t("adminPostPanes.publishChecklist.scoreLabel")}
          className="h-1.5 w-full rounded-full bg-muted overflow-hidden"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${barColor}`}
            style={{ width: `${checklist.score}%` }}
          />
        </div>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
          {t("adminPostPanes.publishChecklist.requiredHeading")}
        </p>
        <ul>
          {required.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
          {t("adminPostPanes.publishChecklist.recommendedHeading")}
        </p>
        <ul>
          {recommended.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      </div>
    </div>
  );
}
