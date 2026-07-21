// Organism: editor for the "Read more" button.
import { useTranslation } from "react-i18next";
import {
  Section,
  FieldGrid,
  Field,
  ToggleField,
  PreviewFrame,
  PxStepper,
  NumStepper,
} from "../../atoms";
import { ColorControl } from "../../molecules";
import type { SectionEditorProps } from "../../types";
import "@/lib/i18n-admin-theme-design";

export function ReadMoreSection({ draft, set, setColor, previewMode }: SectionEditorProps) {
  const { t } = useTranslation();
  const btn = draft.readMoreButton;
  return (
    <Section title={t("adminThemeDesign.sections.readMore")}>
      <FieldGrid>
        <Field label={t("adminThemeDesign.f.bgColor")}>
          <ColorControl
            section="readMoreButton"
            field="bgColor"
            mode={previewMode}
            draft={draft}
            setColor={setColor}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.textColor")}>
          <ColorControl
            section="readMoreButton"
            field="color"
            mode={previewMode}
            draft={draft}
            setColor={setColor}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.borderColor")}>
          <ColorControl
            section="readMoreButton"
            field="borderColor"
            mode={previewMode}
            draft={draft}
            setColor={setColor}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.radius")}>
          <PxStepper value={btn.radius} onChange={(v) => set("readMoreButton", { radius: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.paddingX")}>
          <PxStepper
            value={btn.paddingX}
            onChange={(v) => set("readMoreButton", { paddingX: v })}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.paddingY")}>
          <PxStepper
            value={btn.paddingY}
            onChange={(v) => set("readMoreButton", { paddingY: v })}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.weight")}>
          <NumStepper
            value={btn.fontWeight}
            onChange={(v) => set("readMoreButton", { fontWeight: v })}
          />
        </Field>
        <ToggleField
          label={t("adminThemeDesign.toggle.uppercase")}
          checked={btn.uppercase}
          onChange={(v) => set("readMoreButton", { uppercase: v })}
        />
        <ToggleField
          label={t("adminThemeDesign.toggle.arrow")}
          checked={btn.arrow}
          onChange={(v) => set("readMoreButton", { arrow: v })}
        />
      </FieldGrid>
      <PreviewFrame>
        <button
          type="button"
          className="cms-read-more inline-flex items-center gap-1 border"
          style={{
            backgroundColor: btn.bgColor,
            color: btn.color,
            borderColor: btn.borderColor,
            borderRadius: btn.radius,
            padding: `${btn.paddingY} ${btn.paddingX}`,
            fontWeight: btn.fontWeight,
            textTransform: btn.uppercase ? "uppercase" : "none",
          }}
        >
          {t("adminThemeDesign.preview.readMore")} {btn.arrow && <span aria-hidden>→</span>}
        </button>
      </PreviewFrame>
    </Section>
  );
}
