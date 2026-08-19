import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-layouts";
import { PanelSectionHeading } from "@/components/admin/postExperience/atoms/PanelSectionHeading";
import { SettingToggle } from "@/components/admin/atoms/SettingToggle";
import { footerToggles, headerToggles } from "@/lib/post/layoutPanelRules";
import type { PostLayoutSettings } from "@/lib/postLayouts";

interface PostLayoutTogglesSectionProps {
  settings: PostLayoutSettings;
  onPatch: (patch: Partial<PostLayoutSettings>) => void;
}

/**
 * Molekuła: przełączniki centrowania nagłówka i elementów stopki wpisu.
 *
 * CO SCALIŁA. Panel miał WŁASNY, ręcznie zbudowany przełącznik: `<button>` bez
 * `role="switch"`, bez `aria-checked` i bez nazwy - dla czytnika ekranu
 * jedenaście bezimiennych przycisków bez stanu. Wszystkie jadą teraz przez
 * wspólny atom `SettingToggle`, który daje prawdziwy przełącznik z etykietą.
 */
export function PostLayoutTogglesSection({ settings, onPatch }: PostLayoutTogglesSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <section className="space-y-1">
        <PanelSectionHeading tone="display" className="mb-1">
          {t("adminLayouts.postLayouts.centeringHeading")}
        </PanelSectionHeading>
        {headerToggles().map((toggle) => (
          <SettingToggle
            key={String(toggle.field)}
            label={t(toggle.labelKey)}
            checked={settings[toggle.field] === true}
            onCheckedChange={(v) => onPatch({ [toggle.field]: v } as Partial<PostLayoutSettings>)}
          />
        ))}
      </section>

      <section className="space-y-1">
        <PanelSectionHeading tone="display" className="mb-1">
          {t("adminLayouts.postLayouts.footerHeading")}
        </PanelSectionHeading>
        {footerToggles().map((toggle) => (
          <SettingToggle
            key={String(toggle.field)}
            label={t(toggle.labelKey)}
            checked={settings[toggle.field] === true}
            onCheckedChange={(v) => onPatch({ [toggle.field]: v } as Partial<PostLayoutSettings>)}
          />
        ))}
      </section>
    </div>
  );
}
