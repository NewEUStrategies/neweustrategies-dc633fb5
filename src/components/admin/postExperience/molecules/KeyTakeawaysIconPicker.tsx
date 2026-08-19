import { PanelSectionHeading, SelectableOptionCard } from "@/components/admin/postExperience/atoms";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-post-panes";
import { Input } from "@/components/ui/input";
import { DynamicIcon, type IconName } from "@/lib/icons/DynamicIcon";
import { KEY_TAKEAWAYS_ICON_CHOICES, iconMatches } from "@/lib/keyTakeaways/panelRules";

interface KeyTakeawaysIconPickerProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Molekuła: siatka dwunastu sugerowanych ikon plus pole na dowolną nazwę
 * z lucide.dev.
 *
 * Kopia w pliku trasy dawała każdemu kafelkowi `aria-label` z nazwą ikony, ale
 * NIE ogłaszała, która jest wybrana - czytnik ekranu słyszał dwanaście
 * jednakowych przycisków.
 */
export function KeyTakeawaysIconPicker({ value, onChange }: KeyTakeawaysIconPickerProps) {
  const { t } = useTranslation();
  return (
    <section>
      <PanelSectionHeading as="h3" tone="field" className="mb-2 block">
        {t("adminPostPanes.keyTakeaways.iconHeading")}
      </PanelSectionHeading>
      <div className="grid grid-cols-6 gap-1.5 mb-2">
        {KEY_TAKEAWAYS_ICON_CHOICES.map((name) => (
          <SelectableOptionCard
            key={name}
            label={name}
            selected={iconMatches(value, name)}
            onSelect={() => onChange(name)}
            className="aspect-square flex items-center justify-center"
          >
            <DynamicIcon name={name as IconName} size={18} />
          </SelectableOptionCard>
        ))}
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="search"
        aria-label={t("adminPostPanes.keyTakeaways.iconNameLabel")}
        className="text-xs font-mono"
      />
      <p className="text-[11px] text-muted-foreground mt-1">
        {t("adminPostPanes.keyTakeaways.iconHint")}
      </p>
    </section>
  );
}
