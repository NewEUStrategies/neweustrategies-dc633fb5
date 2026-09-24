// Przycisk paska edytora bloków: „Firmy i osoby (N)" - otwiera menedżer encji
// materiału. Bez providera (edytor bez encji) nic nie renderuje.

import { useTranslation } from "react-i18next";
import { Contact } from "lucide-react";
import { useInlineEntities } from "./InlineEntitiesContext";
import "@/lib/i18n-admin-blocks";

export function InlineEntitiesManagerButton() {
  const { t } = useTranslation();
  const ctx = useInlineEntities();
  if (!ctx) return null;
  const count = Object.keys(ctx.entities).length;
  return (
    <button
      type="button"
      onClick={ctx.openManager}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      title={t("blocks.inlineEntity.manage")}
    >
      <Contact className="w-3.5 h-3.5" aria-hidden />
      <span>{t("blocks.inlineEntity.manageShort")}</span>
      {count > 0 ? (
        <span className="rounded-[4px] bg-muted px-1 tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
    </button>
  );
}
