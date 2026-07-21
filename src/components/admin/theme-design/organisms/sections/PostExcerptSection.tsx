// Organism: editor for the post excerpt / lead style.
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Section, FieldGrid, Field, PreviewFrame, PxStepper, NumStepper } from "../../atoms";
import { ColorControl } from "../../molecules";
import type { SectionEditorProps } from "../../types";
import "@/lib/i18n-admin-theme-design";

export function PostExcerptSection({ draft, set, setColor, previewMode }: SectionEditorProps) {
  const { t } = useTranslation();
  const pe = draft.postExcerpt;

  const previewVars: CSSProperties = {
    ["--td-pe-family" as string]: pe.fontFamily,
    ["--td-pe-size" as string]: pe.fontSize,
    ["--td-pe-weight" as string]: String(pe.fontWeight),
    ["--td-pe-lh" as string]: String(pe.lineHeight),
    ["--td-pe-color" as string]: pe.color,
    ["--td-pe-mt" as string]: pe.marginTop,
  };

  return (
    <Section title={t("adminThemeDesign.sections.postExcerpt")}>
      <FieldGrid>
        <Field label={t("adminThemeDesign.f.fontFamily")}>
          <Input
            value={pe.fontFamily}
            onChange={(e) => set("postExcerpt", { fontFamily: e.target.value })}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.sizePx")}>
          <PxStepper value={pe.fontSize} onChange={(v) => set("postExcerpt", { fontSize: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.weight")}>
          <NumStepper value={pe.fontWeight} onChange={(v) => set("postExcerpt", { fontWeight: v })} />
        </Field>
        <Field label={t("adminThemeDesign.f.lineHeight")}>
          <Input
            value={String(pe.lineHeight)}
            onChange={(e) => set("postExcerpt", { lineHeight: e.target.value })}
          />
        </Field>
        <Field label={t("adminThemeDesign.f.color")}>
          <ColorControl section="postExcerpt" field="color" mode={previewMode} draft={draft} setColor={setColor} />
        </Field>
        <Field label={t("adminThemeDesign.f.marginTop")}>
          <PxStepper value={pe.marginTop} onChange={(v) => set("postExcerpt", { marginTop: v })} />
        </Field>
      </FieldGrid>
      <PreviewFrame>
        <div style={previewVars}>
          <p className="cms-post-excerpt">{t("adminThemeDesign.preview.sampleExcerpt")}</p>
        </div>
      </PreviewFrame>
    </Section>
  );
}
