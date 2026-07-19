// Atom: framed item with title + remove button. Used inside list editors.
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

export function ItemFrame({
  title,
  onRemove,
  children,
}: {
  title: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="border border-border rounded-md p-2 space-y-1.5 bg-background">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-[10px] text-muted-foreground hover:text-destructive"
        >
          {t("builder.common.delete")}
        </button>
      </div>
      {children}
    </div>
  );
}
