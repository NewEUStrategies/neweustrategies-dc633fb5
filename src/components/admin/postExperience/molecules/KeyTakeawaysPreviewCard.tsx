import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-post-panes";
import { KeyTakeaways } from "@/components/molecules/KeyTakeaways";
import { KEY_TAKEAWAYS_SAMPLE_KEYS } from "@/lib/keyTakeaways/panelRules";
import type { KeyTakeawaysSettings, KeyTakeawaysVariant } from "@/lib/keyTakeaways/settings";

interface KeyTakeawaysPreviewCardProps {
  settings: KeyTakeawaysSettings;
  variant: KeyTakeawaysVariant;
  lang: "pl" | "en";
}

/**
 * Molekuła: podgląd sekcji renderowany TYM SAMYM komponentem, którego używa
 * publiczna strona wpisu.
 *
 * Poprzednia wersja panelu trzymała trzy zakładki z trzema kopiami tego samego
 * wywołania, po jednej na wariant, i tylko jedna była widoczna. Tutaj wariant
 * jest argumentem - jedno wywołanie, brak trzech ścieżek do rozejścia.
 */
export function KeyTakeawaysPreviewCard({ settings, variant, lang }: KeyTakeawaysPreviewCardProps) {
  const { t } = useTranslation();
  return (
    <KeyTakeaways
      items={KEY_TAKEAWAYS_SAMPLE_KEYS.map((key) => t(key, { lng: lang }))}
      settingsOverride={settings}
      variantOverride={variant}
      langOverride={lang}
    />
  );
}
