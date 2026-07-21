// Organism: editor for the social-media icon row.
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Facebook, Instagram, Youtube, Linkedin, Mail } from "lucide-react";
import { Section, FieldGrid, Field, PreviewFrame, PxStepper } from "../../atoms";
import { ColorControl } from "../../molecules";
import type { SectionEditorProps } from "../../types";
import "@/lib/i18n-admin-theme-design";

export function SocialSection({ draft, set, setColor, previewMode }: SectionEditorProps) {
  const { t } = useTranslation();
  const si = draft.socialIcons;

  const previewVars: CSSProperties = {
    ["--td-si-color" as string]: si.color,
    ["--td-si-hover-color" as string]: si.hoverColor,
    ["--td-si-bg" as string]: si.bgColor,
    ["--td-si-hover-bg" as string]: si.hoverBgColor,
    ["--td-si-size" as string]: si.size,
    ["--td-si-gap" as string]: si.gap,
    ["--td-si-radius" as string]: si.radius,
    ["--td-si-px" as string]: si.paddingX,
    ["--td-si-py" as string]: si.paddingY,
  };

  return (
    <Section title={t("adminThemeDesign.sections.social")}>
      <FieldGrid>
        <Field label={t("adminThemeDesign.f.iconColor")}>
          <ColorControl section="socialIcons" field="color" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.hoverColor")}>
          <ColorControl section="socialIcons" field="hoverColor" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.bg")}>
          <ColorControl section="socialIcons" field="bgColor" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.hoverBg")}>
          <ColorControl section="socialIcons" field="hoverBgColor" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.sizePx")}>
          <PxStepper value={si.size} onChange={(v) => set("socialIcons", { size: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.gap")}>
          <PxStepper value={si.gap} onChange={(v) => set("socialIcons", { gap: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.radius")}>
          <PxStepper value={si.radius} onChange={(v) => set("socialIcons", { radius: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.paddingX")}>
          <PxStepper value={si.paddingX} onChange={(v) => set("socialIcons", { paddingX: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.paddingY")}>
          <PxStepper value={si.paddingY} onChange={(v) => set("socialIcons", { paddingY: v })} />
        </Field>
      </FieldGrid>
      <PreviewFrame>
        <div style={previewVars}>
          <div className="cms-social">
            <button className="cms-social__btn" aria-label="Facebook">
              <Facebook />
            </button>
            <button className="cms-social__btn" aria-label="Instagram">
              <Instagram />
            </button>
            <button className="cms-social__btn" aria-label="YouTube">
              <Youtube />
            </button>
            <button className="cms-social__btn" aria-label="LinkedIn">
              <Linkedin />
            </button>
            <button className="cms-social__btn" aria-label="Email">
              <Mail />
            </button>
          </div>
        </div>
      </PreviewFrame>
    </Section>
  );
}
