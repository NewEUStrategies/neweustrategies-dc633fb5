// Molekuła "Checklista publikacji" w sidebarze edytora wpisu. Czysta
// prezentacja wyniku buildPublishChecklist - ta sama ocena zasila bramkę przy
// przejściu w published/scheduled (usePostEditorForm), więc karta i dialog
// nigdy się nie rozjeżdżają.
import { useTranslation } from "react-i18next";
import type { PublishChecklist } from "@/lib/content/publishChecklist";
import { ChecklistItemRow } from "../atoms";
import "@/lib/i18n-admin-post-panes";

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
            <ChecklistItemRow key={item.id} item={item} />
          ))}
        </ul>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
          {t("adminPostPanes.publishChecklist.recommendedHeading")}
        </p>
        <ul>
          {recommended.map((item) => (
            <ChecklistItemRow key={item.id} item={item} />
          ))}
        </ul>
      </div>
    </div>
  );
}
