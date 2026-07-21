// Organism: editor for the public light/dark mode switcher pill.
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Sun, Moon } from "lucide-react";
import { Section, FieldGrid, Field, ToggleField, PreviewFrame, PxStepper } from "../../atoms";
import { ColorControl } from "../../molecules";
import type { SectionEditorProps } from "../../types";
import "@/lib/i18n-admin-theme-design";

export function ModeSwitchSection({ draft, set, setColor, previewMode }: SectionEditorProps) {
  const { t } = useTranslation();
  const ms = draft.modeSwitcher;

  const previewVars: CSSProperties = {
    ["--td-ms-track-bg" as string]: ms.trackBg,
    ["--td-ms-track-border" as string]: ms.trackBorder,
    ["--td-ms-inactive" as string]: ms.inactiveColor,
    ["--td-ms-active-bg" as string]: ms.activeBg,
    ["--td-ms-active-color" as string]: ms.activeColor,
    ["--td-ms-radius" as string]: ms.radius,
  };

  return (
    <Section title={t("adminThemeDesign.sections.modeSwitch")}>
      <FieldGrid>
        <Field label={t("adminThemeDesign.f.trackBg")}>
          <ColorControl section="modeSwitcher" field="trackBg" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.trackBorder")}>
          <ColorControl section="modeSwitcher" field="trackBorder" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.inactiveColor")}>
          <ColorControl section="modeSwitcher" field="inactiveColor" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.activeBg")}>
          <ColorControl section="modeSwitcher" field="activeBg" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.activeColor")}>
          <ColorControl section="modeSwitcher" field="activeColor" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.radius")}>
          <PxStepper value={ms.radius} onChange={(v) => set("modeSwitcher", { radius: v })} />
        </Field>
        <ToggleField
          label={t("adminThemeDesign.toggle.showLabels")}
          checked={ms.showLabel}
          onChange={(v) => set("modeSwitcher", { showLabel: v })}
        />
      </FieldGrid>
      <PreviewFrame>
        <div style={previewVars}>
          <div className="cms-mode-switch">
            <button className="cms-mode-switch__btn" data-active="true">
              <Sun className="w-3.5 h-3.5" /> {ms.showLabel && t("adminThemeDesign.lightLabel")}
            </button>
            <button className="cms-mode-switch__btn">
              <Moon className="w-3.5 h-3.5" /> {ms.showLabel && t("adminThemeDesign.darkLabel")}
            </button>
          </div>
        </div>
      </PreviewFrame>
    </Section>
  );
}
