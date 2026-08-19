import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-layouts";
import { PanelNumberField } from "@/components/admin/postExperience/atoms/PanelNumberField";
import { PanelRangeField } from "@/components/admin/postExperience/atoms/PanelRangeField";
import { PanelSectionHeading } from "@/components/admin/postExperience/atoms/PanelSectionHeading";
import { numericSetting, typographyGroups } from "@/lib/post/layoutPanelRules";
import type { PostLayoutSettings } from "@/lib/postLayouts";

interface PostLayoutTypographySectionProps {
  settings: PostLayoutSettings;
  onPatch: (patch: Partial<PostLayoutSettings>) => void;
}

/**
 * Molekuła: typografia nagłówka i zapowiedzi w czterech grupach po trzy punkty
 * przełamania.
 *
 * Dwanaście wierszy jedzie z deskryptorów, więc nazwa kolumny nie ma jak się
 * rozjechać z etykietą punktu przełamania. Każdy wiersz ma SUWAK i pole
 * liczbowe na tę samą wartość - suwak do zgrubnego ustawienia, pole do
 * dokładnego, oba przycięte tymi samymi granicami.
 */
export function PostLayoutTypographySection({
  settings,
  onPatch,
}: PostLayoutTypographySectionProps) {
  const { t } = useTranslation();
  return (
    <section className="space-y-4">
      <div>
        <PanelSectionHeading tone="display">
          {t("adminLayouts.postLayouts.typoHeading")}
        </PanelSectionHeading>
        <p className="text-[11px] text-muted-foreground">
          {t("adminLayouts.postLayouts.typoIntro")}
        </p>
      </div>

      {typographyGroups().map((group) => (
        <div key={group.headingKey} className="space-y-2">
          <div>
            <PanelSectionHeading as="h3" tone="field" className="text-xs text-foreground/80">
              {t(group.headingKey)}
            </PanelSectionHeading>
            <p className="text-[10px] text-muted-foreground">{t(group.hintKey)}</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {group.rows.map((row) => {
              const value = numericSetting(settings, row.field);
              const label = `${t(group.headingKey)} - ${t(row.labelKey)}`;
              return (
                <div key={String(row.field)} className="space-y-1">
                  <PanelRangeField
                    label={label}
                    readout={`${value}px`}
                    value={value}
                    bounds={row.bounds}
                    onChange={(next) =>
                      onPatch({ [row.field]: next } as Partial<PostLayoutSettings>)
                    }
                  />
                  <PanelNumberField
                    label={label}
                    value={value}
                    bounds={row.bounds}
                    onChange={(next) =>
                      onPatch({ [row.field]: next } as Partial<PostLayoutSettings>)
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
