// Atom-level shell for list editors (header + add button + empty state).
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Item } from "./shared";
import "@/lib/i18n-builder";

interface Props {
  title: string;
  items: Item[];
  onAdd: () => void;
  children: ReactNode;
}

export function ListShell({ title, items, onAdd, children }: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <button type="button" onClick={onAdd} className="text-[11px] text-brand hover:underline">
          + {t("common.add")}
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">{t("builder.listShell.empty")}</p>
      ) : (
        children
      )}
    </div>
  );
}
