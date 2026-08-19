import { SelectableOptionCard } from "@/components/admin/postExperience/atoms/SelectableOptionCard";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { tocColumnDescriptors } from "@/lib/toc/panelRules";
import type { TocColumns } from "@/lib/toc/settings";

interface TocColumnsPickerProps {
  value: TocColumns;
  onChange: (value: TocColumns) => void;
}

/**
 * Molekuła: wybór układu kolumn spisu treści - trzy karty z miniaturą.
 *
 * Kształt miniatury (liczba pasków, szerokość) przychodzi z deskryptora reguły,
 * nie z warunków w JSX - dzięki temu test reguły sprawdza „`col-2` ma dwa
 * paski" bez renderowania panelu.
 */
export function TocColumnsPicker({ value, onChange }: TocColumnsPickerProps) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-3 gap-2 mt-1">
      {tocColumnDescriptors().map((column) => (
        <SelectableOptionCard
          key={column.value}
          label={t(column.labelKey)}
          selected={value === column.value}
          onSelect={() => onChange(column.value)}
          className="flex flex-col gap-1"
        >
          <span className="flex items-center gap-1.5 text-xs font-medium">
            <span
              className={cn(
                "grid gap-0.5",
                column.bars === 2 ? "grid-cols-2" : "grid-cols-1",
                column.narrowThumb ? "w-3" : "w-5",
              )}
              aria-hidden="true"
            >
              {Array.from({ length: column.bars }, (_, i) => (
                <span key={i} className="h-2 rounded-sm bg-current opacity-70" />
              ))}
            </span>
            {t(column.labelKey)}
          </span>
          <span className="text-[10px] text-muted-foreground">{t(column.hintKey)}</span>
        </SelectableOptionCard>
      ))}
    </div>
  );
}
