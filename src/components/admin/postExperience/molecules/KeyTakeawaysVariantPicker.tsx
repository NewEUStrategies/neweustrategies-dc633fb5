import { PanelSectionHeading, SelectableOptionCard } from "@/components/admin/postExperience/atoms";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-post-panes";
import { keyTakeawaysVariantDescriptors } from "@/lib/keyTakeaways/panelRules";
import type { KeyTakeawaysVariant } from "@/lib/keyTakeaways/settings";

interface KeyTakeawaysVariantPickerProps {
  value: KeyTakeawaysVariant;
  onChange: (value: KeyTakeawaysVariant) => void;
}

/**
 * Molekuła: wybór wariantu wizualnego sekcji (A: karta, B: nagłówek, C: ghost).
 *
 * Kopia w pliku trasy nie miała `aria-pressed` - stan wyboru istniał wyłącznie
 * jako obwódka. Atom domyka to za wszystkie trzy karty.
 */
export function KeyTakeawaysVariantPicker({ value, onChange }: KeyTakeawaysVariantPickerProps) {
  const { t } = useTranslation();
  return (
    <section>
      <PanelSectionHeading as="h3" tone="field" className="mb-2 block">
        {t("adminPostPanes.keyTakeaways.variantHeading")}
      </PanelSectionHeading>
      <div className="grid grid-cols-3 gap-2">
        {keyTakeawaysVariantDescriptors().map((variant) => (
          <SelectableOptionCard
            key={variant.value}
            label={t(variant.badgeKey)}
            ariaLabel={`${t(variant.badgeKey)} - ${t(variant.descKey)}`}
            selected={value === variant.value}
            onSelect={() => onChange(variant.value)}
            className="p-3"
          >
            <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              {t(variant.badgeKey)}
            </span>
            <span className="block text-sm font-medium">{t(variant.descKey)}</span>
          </SelectableOptionCard>
        ))}
      </div>
    </section>
  );
}
