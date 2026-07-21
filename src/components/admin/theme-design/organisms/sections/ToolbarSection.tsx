// Organism: editor for CMS toolbar buttons (undo, redo, device, language).
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Monitor, Tablet, Smartphone, Undo, Redo } from "lucide-react";
import { Section, FieldGrid, Field, PreviewFrame, PxStepper } from "../../atoms";
import { ColorControl } from "../../molecules";
import type { SectionEditorProps } from "../../types";
import "@/lib/i18n-admin-theme-design";

export function ToolbarSection({ draft, set, setColor, previewMode }: SectionEditorProps) {
  const { t } = useTranslation();
  const tb = draft.toolbarButton;

  const previewVars: CSSProperties = {
    ["--td-tb-bg" as string]: tb.bgColor,
    ["--td-tb-color" as string]: tb.color,
    ["--td-tb-hover-bg" as string]: tb.hoverBgColor,
    ["--td-tb-hover-color" as string]: tb.hoverColor,
    ["--td-tb-active-bg" as string]: tb.activeBgColor,
    ["--td-tb-active-color" as string]: tb.activeColor,
    ["--td-tb-radius" as string]: tb.radius,
    ["--td-tb-px" as string]: tb.paddingX,
    ["--td-tb-py" as string]: tb.paddingY,
    ["--td-tb-size" as string]: tb.size,
  };

  return (
    <Section title={t("adminThemeDesign.sections.toolbar")}>
      <FieldGrid>
        <Field label={t("adminThemeDesign.f.bg")}>
          <ColorControl section="toolbarButton" field="bgColor" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.iconTextColor")}>
          <ColorControl section="toolbarButton" field="color" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.hoverBg")}>
          <ColorControl section="toolbarButton" field="hoverBgColor" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.hoverColor")}>
          <ColorControl section="toolbarButton" field="hoverColor" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.activeBg")}>
          <ColorControl section="toolbarButton" field="activeBgColor" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.activeColor")}>
          <ColorControl section="toolbarButton" field="activeColor" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.radius")}>
          <PxStepper value={tb.radius} onChange={(v) => set("toolbarButton", { radius: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.paddingX")}>
          <PxStepper value={tb.paddingX} onChange={(v) => set("toolbarButton", { paddingX: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.paddingY")}>
          <PxStepper value={tb.paddingY} onChange={(v) => set("toolbarButton", { paddingY: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.iconSizePx")}>
          <PxStepper value={tb.size} onChange={(v) => set("toolbarButton", { size: v })} />
        </Field>
      </FieldGrid>
      <PreviewFrame>
        <div style={previewVars} className="flex flex-wrap items-center gap-2">
          <button className="cms-tb-btn" data-active="true" title={t("adminThemeDesign.activeTitle")}>
            <Monitor />
          </button>
          <button className="cms-tb-btn">
            <Tablet />
          </button>
          <button className="cms-tb-btn">
            <Smartphone />
          </button>
          <button className="cms-tb-btn">
            <Undo />
          </button>
          <button className="cms-tb-btn">
            <Redo />
          </button>
          <button className="cms-tb-btn" disabled>
            <Redo />
          </button>
        </div>
      </PreviewFrame>
    </Section>
  );
}
