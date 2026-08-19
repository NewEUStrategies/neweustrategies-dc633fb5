import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-layouts";
import { PanelSectionHeading } from "@/components/admin/postExperience/atoms/PanelSectionHeading";
import { SelectableOptionCard } from "@/components/admin/postExperience/atoms/SelectableOptionCard";
import { LayoutPreview } from "@/components/admin/LayoutPreview";
import {
  pickVariantPatch,
  presetHasSidebar,
  presetSummary,
  recommendedImageBadge,
  selectedPreset,
  type LayoutGroupDescriptor,
} from "@/lib/post/layoutPanelRules";
import type { PostLayoutSettings } from "@/lib/postLayouts";

interface PostLayoutGroupProps {
  group: LayoutGroupDescriptor;
  settings: PostLayoutSettings;
  onPatch: (patch: Partial<PostLayoutSettings>) => void;
}

/**
 * Molekuła: jedna grupa układów wpisu (format standardowy / wideo / audio /
 * galeria) z podglądem wybranego presetu.
 *
 * Każdy preset stoi tu w DWÓCH wariantach - bez sidebara i z sidebarem - a
 * kliknięcie ustawia jedno i drugie jedną łatą stanu (`pickVariantPatch`).
 */
export function PostLayoutGroup({ group, settings, onPatch }: PostLayoutGroupProps) {
  const { t } = useTranslation();
  const value = String(settings[group.field] ?? "");
  const selected = selectedPreset(group.presets, value);
  if (!selected) return null;
  const selectedHasSidebar = presetHasSidebar(selected, settings, true);

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <PanelSectionHeading tone="display">{t(group.titleKey)}</PanelSectionHeading>
        <span className="text-[11px] text-muted-foreground">
          {t("adminLayouts.postLayouts.selectedPrefix")} <b>{selected.label}</b> (
          {selectedHasSidebar
            ? t("adminLayouts.postLayouts.withSidebar")
            : t("adminLayouts.postLayouts.withoutSidebar")}
          )
        </span>
      </div>

      <div className="grid md:grid-cols-[1fr_220px] gap-3 items-start">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {group.presets.map((preset) => {
            const isSelected = value === preset.id;
            const badge = recommendedImageBadge(preset);
            return (
              <div
                key={preset.id}
                className={`border rounded-md p-2 bg-background/50 ${isSelected ? "border-brand" : "border-border"}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-[11px] font-medium truncate">{preset.label}</p>
                  <span
                    className="text-[9px] px-1 py-px rounded bg-muted text-muted-foreground shrink-0"
                    title={badge ? t("adminLayouts.postLayouts.recommendedImageTitle") : undefined}
                  >
                    {badge ?? t("adminLayouts.postLayouts.none")}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[false, true].map((withSidebar) => (
                    <SelectableOptionCard
                      key={String(withSidebar)}
                      label={preset.label}
                      // NAZWA ZAWIERA GRUPĘ FORMATÓW. Ten sam preset stoi
                      // w kilku katalogach z identyczną etykietą wariantu, więc
                      // bez przedrostka na stronie stały cztery przyciski o tej
                      // samej nazwie dostępnej i użytkownik czytnika ekranu nie
                      // wiedział, czy ustawia wpis standardowy, wideo, audio czy
                      // galerię.
                      ariaLabel={`${t(group.titleKey)}: ${preset.label} - ${
                        withSidebar
                          ? t("adminLayouts.postLayouts.withSidebar")
                          : t("adminLayouts.postLayouts.withoutSidebar")
                      }`}
                      selected={
                        isSelected && presetHasSidebar(preset, settings, isSelected) === withSidebar
                      }
                      onSelect={() =>
                        onPatch(
                          pickVariantPatch(
                            group.field,
                            preset.id,
                            withSidebar,
                            settings.layout_sidebar_overrides,
                          ),
                        )
                      }
                      className="p-1"
                    >
                      <LayoutPreview
                        preset={preset}
                        settings={settings}
                        hasSidebarOverride={withSidebar}
                      />
                      <span className="block text-[9px] text-muted-foreground mt-1 leading-tight">
                        {withSidebar
                          ? t("adminLayouts.postLayouts.plusSidebar")
                          : t("adminLayouts.postLayouts.withoutSidebar")}
                      </span>
                    </SelectableOptionCard>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <aside
          className="sticky top-4 space-y-1.5 border border-border rounded-md p-2 bg-muted/30"
          aria-label={t("adminLayouts.postLayouts.livePreview")}
        >
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("adminLayouts.postLayouts.livePreview")}
          </div>
          <LayoutPreview
            preset={selected}
            settings={settings}
            hasSidebarOverride={selectedHasSidebar}
          />
          <ul className="text-[10px] text-muted-foreground space-y-0.5 pt-1">
            {presetSummary(selected, settings, selectedHasSidebar).map((row) => (
              <li key={row.labelKey}>
                {t(row.labelKey)} <b>{row.valueKey ? t(row.valueKey) : row.value}</b>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
